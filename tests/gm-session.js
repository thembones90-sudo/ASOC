// Shadow Broker logins survive restarts/deploys: GM sessions are persisted
// (hashed), SIGN OUT clears them durably, a GM password change invalidates
// them, and expired sessions are rejected. Private server, throwaway data.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_GM_SESSION_TEST_PORT) || 18760;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-gm-session-'));
const SESSIONS_FILE = path.join(DATA, '.gm-auth-sessions.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let server = null;
async function start(password) {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: password, ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  for (let i = 0; i < 60; i++) { try { if ((await request('/health')).status === 200) return; } catch {} await sleep(150); }
  throw new Error('server did not become healthy');
}
async function stop() {
  if (!server) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await exited;
  server = null;
}
const login = async password => (await request('/api/auth/gm/login', { body: { password } })).data.token;
// Any GM-only endpoint: 200 with a valid GM token, 401 without.
const gmStatus = async token => (await request('/api/tweaks', { headers: { 'x-gm-token': token } })).status;

async function run() {
  try {
    await start('first-password');
    const token = await login('first-password');
    assert.equal(await gmStatus(token), 200);
    const saved = fs.readFileSync(SESSIONS_FILE, 'utf8');
    assert.ok(!saved.includes(token), 'the raw GM token is never written to disk');
    assert.ok(!saved.includes('first-password'), 'the GM password is never written to disk');

    await stop();
    await start('first-password');
    assert.equal(await gmStatus(token), 200, 'a GM login survives a restart');

    assert.equal((await request('/api/auth/gm/logout', { body: {} })).status, 401, 'a stranger cannot sign the GM out');
    assert.equal((await request('/api/auth/gm/logout', { body: {}, headers: { 'x-gm-token': 'gm-forged' } })).status, 401);
    assert.equal(await gmStatus(token), 200, 'the GM is still signed in');
    assert.equal((await request('/api/auth/gm/logout', { body: {}, headers: { 'x-gm-token': token } })).status, 200);
    assert.equal(await gmStatus(token), 401, 'SIGN OUT revokes the login');
    await stop();
    await start('first-password');
    assert.equal(await gmStatus(token), 401, 'SIGN OUT stays revoked after a restart');

    const second = await login('first-password');
    await stop();
    await start('changed-password');
    assert.equal(await gmStatus(second), 401, 'changing the GM password invalidates saved logins');

    const third = await login('changed-password');
    await stop();
    const file = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    for (const record of Object.values(file.sessions)) record.expiresAt = Date.now() - 1000;
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(file));
    await start('changed-password');
    assert.equal(await gmStatus(third), 401, 'an expired saved login is rejected');

    assert.equal(server.errors.trim(), '', 'no server errors');
    console.log('PASS GM sessions: survive restart, hashed at rest, sign-out GM-only and durable, password change and expiry invalidate');
  } finally {
    await stop();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('FAIL GM sessions:', error);
  process.exit(1);
});
