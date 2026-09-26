// FORGOT PASSWORD (Little Hero):
//   - the request always answers generically (no account enumeration),
//     unknown emails send nothing, repeat requests are cooled down;
//   - the emailed link lands on /join.html?reset=<token>;
//   - the token is single-use, expires, and is stored only as a digest;
//   - a reset sets the new password, kills the old one and every existing
//     session, and completes a pending email verification;
//   - weak passwords and bad tokens are refused; requests are throttled.
const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.ASOC_RESET_TEST_PORT) || 18331;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-password-reset-'));
const outbox = path.join(tempDir, 'outbox.jsonl');
const authFile = path.join(tempDir, 'auth-store.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(urlPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers }
    }, res => {
      let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => {
        let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch {}
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

function mail() {
  if (!fs.existsSync(outbox)) return [];
  return fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
const resetMails = () => mail().filter(m => m.kind === 'reset');
const tokenFrom = m => new URL(m.resetUrl).searchParams.get('reset');

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env, PORT: String(PORT), ASOC_DATA_DIR: tempDir, ASOC_GM_PASSWORD: 'reset-test-gm',
        ASOC_EMAIL_PROVIDER: 'test', ASOC_EMAIL_TEST_OUTBOX: outbox, ASOC_EMAIL_VERIFICATION: '1',
        ASOC_EMAIL_RESEND_COOLDOWN_MS: '15000', ASOC_PUBLIC_BASE_URL: 'http://127.0.0.1:' + PORT
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('server startup timeout: ' + stderr)); }, 12000);
    child.stderr.on('data', c => { stderr += c.toString(); });
    child.stdout.on('data', c => { if (c.toString().includes('ASOC Engine server running')) { clearTimeout(timer); resolve(child); } });
    child.once('exit', code => { clearTimeout(timer); if (code && code !== 0) reject(Error('server exited ' + code + ': ' + stderr)); });
  });
}

(async () => {
  const server = await startServer();
  try {
    const email = 'reset.hero@asoc.test';
    const register = await request('/api/auth/player/register', 'POST', { email, password: 'old-password', name: 'Reset Hero' });
    assert.equal(register.status, 201, JSON.stringify(register.data));
    // Unverified: login is refused.
    assert.equal((await request('/api/auth/player/login', 'POST', { email, password: 'old-password' })).status, 403);

    // Unknown email: same generic answer, nothing sent.
    const unknown = await request('/api/auth/player/forgot-password', 'POST', { email: 'nobody@asoc.test' });
    assert.equal(unknown.status, 200);
    assert.equal(resetMails().length, 0);

    // Real email: same answer, one reset mail with a join.html?reset= link.
    const forgot = await request('/api/auth/player/forgot-password', 'POST', { email: '  Reset.Hero@ASOC.test ' });
    assert.equal(forgot.status, 200);
    assert.equal(forgot.data.message, unknown.data.message, 'answers never reveal whether an account exists');
    assert.equal(resetMails().length, 1);
    const first = resetMails()[0];
    assert.equal(first.to, email);
    assert.equal(new URL(first.resetUrl).pathname, '/join.html');
    const token1 = tokenFrom(first);
    assert.ok(token1 && token1.length >= 40);
    // Stored only as a digest.
    const stored = JSON.parse(fs.readFileSync(authFile, 'utf8')).players[email];
    assert.ok(/^[a-f0-9]{64}$/.test(stored.resetTokenHash));
    assert.ok(!JSON.stringify(stored).includes(token1), 'the raw token is never stored');

    // Cooldown: an immediate second request sends nothing new.
    assert.equal((await request('/api/auth/player/forgot-password', 'POST', { email })).status, 200);
    assert.equal(resetMails().length, 1, 'repeat requests are cooled down');

    // Bad token / weak password are refused and leave the token usable.
    assert.equal((await request('/api/auth/player/reset-password', 'POST', { token: 'nope', password: 'whatever1' })).data.code, 'RESET_INVALID');
    assert.equal((await request('/api/auth/player/reset-password', 'POST', { token: token1, password: '123' })).data.code, 'WEAK_PASSWORD');

    // Expiry: age the token on disk.
    const aged = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    const keep = aged.players[email].resetExpiresAt;
    aged.players[email].resetExpiresAt = Date.now() - 1000;
    fs.writeFileSync(authFile, JSON.stringify(aged));
    assert.equal((await request('/api/auth/player/reset-password', 'POST', { token: token1, password: 'new-password' })).data.code, 'RESET_EXPIRED');
    assert.equal(JSON.parse(fs.readFileSync(authFile, 'utf8')).players[email].resetTokenHash, undefined, 'an expired token is discarded');
    void keep;

    // A fresh link (after the cooldown window is cleared on disk).
    const cooled = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    cooled.players[email].resetSentAt = Date.now() - 60000;
    fs.writeFileSync(authFile, JSON.stringify(cooled));
    assert.equal((await request('/api/auth/player/forgot-password', 'POST', { email })).status, 200);
    assert.equal(resetMails().length, 2);
    const token2 = tokenFrom(resetMails()[1]);
    assert.notEqual(token2, token1);

    // Verify the account by its verification mail, sign in -> a live session.
    const verifyMail = mail().find(m => m.verifyUrl);
    const verifyUrl = new URL(verifyMail.verifyUrl);
    await request(verifyUrl.pathname + verifyUrl.search);
    const login = await request('/api/auth/player/login', 'POST', { email, password: 'old-password' });
    assert.equal(login.status, 200);
    const oldSession = login.data.token;
    assert.equal((await request('/api/auth/player/session', 'GET', null, { 'x-player-token': oldSession })).status, 200);

    // Reset succeeds.
    const reset = await request('/api/auth/player/reset-password', 'POST', { token: token2, password: 'brand-new-pass' });
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    assert.equal(reset.data.email, email);
    // Old password dead, new password works, old session ended.
    assert.equal((await request('/api/auth/player/login', 'POST', { email, password: 'old-password' })).status, 401);
    assert.equal((await request('/api/auth/player/login', 'POST', { email, password: 'brand-new-pass' })).status, 200);
    assert.equal((await request('/api/auth/player/session', 'GET', null, { 'x-player-token': oldSession })).status, 401, 'existing sessions are signed out');
    // Single use.
    assert.equal((await request('/api/auth/player/reset-password', 'POST', { token: token2, password: 'another-pass' })).data.code, 'RESET_INVALID');

    // A reset also proves the mailbox: an unverified account becomes verified.
    const other = 'unverified.hero@asoc.test';
    assert.equal((await request('/api/auth/player/register', 'POST', { email: other, password: 'first-pass', name: 'Unverified' })).status, 201);
    await request('/api/auth/player/forgot-password', 'POST', { email: other });
    const otherToken = tokenFrom(resetMails().find(m => m.to === other));
    assert.equal((await request('/api/auth/player/reset-password', 'POST', { token: otherToken, password: 'second-pass' })).status, 200);
    assert.equal((await request('/api/auth/player/login', 'POST', { email: other, password: 'second-pass' })).status, 200);

    // Throttle: a burst from one client is cut off.
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      limited = (await request('/api/auth/player/forgot-password', 'POST', { email: `burst${i}@asoc.test` })).status === 429;
    }
    assert.ok(limited, 'reset requests are rate limited per client');

    // The login page wires the flow.
    const join = fs.readFileSync(path.join(ROOT, 'join.html'), 'utf8');
    assert.match(join, /id="player-auth-forgot"[^>]*>FORGOT PASSWORD\?/);
    assert.match(join, /\/api\/auth\/player\/forgot-password/);
    assert.match(join, /\/api\/auth\/player\/reset-password/);
    assert.match(join, /verificationParams\.get\('reset'\)[\s\S]{0,200}history\.replaceState/, 'the token is scrubbed from the address bar');
    console.log('PASS forgot password: generic answers, cooldown, digest-only single-use expiring tokens, new password + session sign-out, verification completion, throttling, login-page wiring');
  } finally {
    server.kill();
    await sleep(250);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL forgot password:', error);
  process.exit(1);
});
