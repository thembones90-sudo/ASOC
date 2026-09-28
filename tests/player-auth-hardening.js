// LITTLE HERO AUTH HARDENING -- H2 regression coverage.
//   - an account hashed by the original synchronous code still signs in
//   - wrong password / unknown account both answer 401, with comparable timing
//   - registration works; per-address registration limit
//   - per-account and per-address failed-login throttles (429 + Retry-After)
//   - a burst of logins does not stall the event loop (/health stays fast)
//   - Shadow Broker login is untouched by the player throttle
//   - baseline security headers are present
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_AUTH_HARDENING_TEST_PORT) || 18894;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers: payload ? { 'content-type': 'application/json' } : {} }, res => {
      let text = ''; res.on('data', c => { text += c; });
      res.on('end', () => {
        let data = text; try { data = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, data, headers: res.headers, ms: Number(process.hrtime.bigint() - started) / 1e6 });
      });
    });
    req.on('error', reject);
    if (payload) req.write(JSON.stringify(payload));
    req.end();
  });
}
const post = (p, body) => request('POST', p, body);

async function withServer(env, fn, seed) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-auth-hard-'));
  if (seed) seed(DATA);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'auth-gm-pass', ASOC_EMAIL_VERIFICATION: '0', ...env },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  try {
    for (let i = 0; i < 80; i++) { try { if ((await request('GET', '/health')).status === 200) break; } catch {} await sleep(150); }
    await fn();
    assert.equal(errors.trim(), '', 'no server errors');
  } finally {
    await require('./lib/stop-process')(server);
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

// Writes an account with the ORIGINAL synchronous hashing path, in a child
// process so this test's own module cache is untouched.
function seedLegacyAccount(DATA) {
  const script = `
    process.env.ASOC_DATA_DIR = ${JSON.stringify(DATA)};
    const store = require(${JSON.stringify(path.join(ROOT, 'auth-store.js'))});
    store.register('veteran@auth.test', 'veteran-pass', 'Veteran', { requireVerification: false });`;
  require('child_process').execFileSync(process.execPath, ['-e', script], { cwd: ROOT });
}

(async () => {
  // 1. Compatibility, failures, timing parity, account + address throttles.
  await withServer({ ASOC_AUTH_ACCOUNT_FAILURES: '3', ASOC_AUTH_IP_FAILURES: '8', ASOC_AUTH_IP_REGISTRATIONS: '4' }, async () => {
    const page = await request('GET', '/join.html');
    assert.equal(page.headers['x-content-type-options'], 'nosniff', 'nosniff on every response');
    assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN', 'no cross-site framing');
    assert.match(page.headers['content-security-policy'] || '', /frame-ancestors 'self'/);

    const ok = await post('/api/auth/player/login', { email: 'veteran@auth.test', password: 'veteran-pass' });
    assert.equal(ok.status, 200, 'pre-existing (sync-hashed) account signs in');
    assert.ok(ok.data.token);

    const reg = await post('/api/auth/player/register', { email: 'fresh@auth.test', password: 'fresh-pass', name: 'Fresh' });
    assert.equal(reg.status, 201, 'registration works');
    assert.equal((await post('/api/auth/player/login', { email: 'fresh@auth.test', password: 'fresh-pass' })).status, 200, 'new account signs in');
    assert.equal((await post('/api/auth/player/register', { email: 'fresh@auth.test', password: 'x-pass-x' })).status, 400, 'duplicate refused');

    const wrong = await post('/api/auth/player/login', { email: 'fresh@auth.test', password: 'nope-nope' });
    const unknown = await post('/api/auth/player/login', { email: 'ghost@auth.test', password: 'nope-nope' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(unknown.data.error, wrong.data.error, 'same answer for unknown account and wrong password');
    // Unknown accounts pay a full dummy hash: comparable, not instant.
    assert.ok(unknown.ms > wrong.ms * 0.4, `unknown account is not trivially faster (${unknown.ms.toFixed(0)}ms vs ${wrong.ms.toFixed(0)}ms)`);

    // Per-account: 3 failures lock that account, even for the right password.
    await post('/api/auth/player/login', { email: 'fresh@auth.test', password: 'nope-2' });
    await post('/api/auth/player/login', { email: 'fresh@auth.test', password: 'nope-3' });
    const locked = await post('/api/auth/player/login', { email: 'fresh@auth.test', password: 'fresh-pass' });
    assert.equal(locked.status, 429, 'account throttled after repeated failures');
    assert.equal(locked.data.code, 'RATE_LIMITED');
    assert.ok(Number(locked.headers['retry-after']) > 0);
    assert.equal((await post('/api/auth/player/login', { email: 'veteran@auth.test', password: 'veteran-pass' })).status, 200, 'other accounts unaffected');

    // Per-address: failures spread over many accounts still hit the cap.
    for (let i = 0; i < 6; i++) await post('/api/auth/player/login', { email: `spray${i}@auth.test`, password: 'x-x-x-x' });
    assert.equal((await post('/api/auth/player/login', { email: 'veteran@auth.test', password: 'veteran-pass' })).status, 429, 'address throttled after a failure spray');

    // Registrations per address (1 success + 1 duplicate already counted).
    assert.equal((await post('/api/auth/player/register', { email: 'r3@auth.test', password: 'r-pass-3' })).status, 201);
    assert.equal((await post('/api/auth/player/register', { email: 'r4@auth.test', password: 'r-pass-4' })).status, 201);
    assert.equal((await post('/api/auth/player/register', { email: 'r5@auth.test', password: 'r-pass-5' })).status, 429, 'registration limit per address');

    // Shadow Broker auth is separate and unaffected.
    assert.equal((await post('/api/auth/gm/login', { password: 'auth-gm-pass' })).status, 200, 'GM login unaffected by player throttles');
  }, seedLegacyAccount);

  // 2. Event-loop responsiveness under a login burst.
  await withServer({ ASOC_AUTH_IP_FAILURES: '1000', ASOC_AUTH_ACCOUNT_FAILURES: '1000' }, async () => {
    await post('/api/auth/player/register', { email: 'load@auth.test', password: 'load-pass', name: 'Load' });
    const burst = Array.from({ length: 16 }, (_, i) => post('/api/auth/player/login', { email: 'load@auth.test', password: 'wrong-' + i }));
    await sleep(30);
    const probes = [];
    for (let i = 0; i < 8; i++) { probes.push((await request('GET', '/health')).ms); await sleep(25); }
    const results = await Promise.all(burst);
    assert.ok(results.every(r => r.status === 401 || r.status === 503), 'burst answered (401, or 503 when the hash queue is full)');
    const worst = Math.max(...probes);
    // 16 synchronous PBKDF2 runs would block ~1.5s+; async keeps /health quick.
    assert.ok(worst < 400, `/health stays responsive during a login burst (worst ${worst.toFixed(0)}ms)`);
  });

  console.log('PASS player auth hardening: legacy hashes verify, async hashing keeps the loop responsive, unknown-account timing normalized, per-account/per-address login and registration throttles, GM auth untouched');
})().catch(error => {
  console.error('FAIL player auth hardening:', error);
  process.exit(1);
});
