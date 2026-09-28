// CHAT UPLOAD GUARD -- H1 regression coverage.
//   unit:  throttle (gap, count, bytes), capacity budget, conservative sweep
//          (keeps every referenced / marked / young file, never deletes on a
//          partial view of state)
//   live:  a Little Hero is throttled on /api/chat/image, the Shadow Broker
//          is not, a full budget refuses safely with 507, and the server keeps
//          serving the game afterwards
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { createChatUploadGuard } = require('../chat-upload-guard');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_UPLOAD_GUARD_TEST_PORT) || 18893;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const name = () => require('crypto').randomBytes(16).toString('hex') + '.png';

function unitThrottleAndCapacity() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-upload-unit-'));
  try {
    const guard = createChatUploadGuard({ dir, windowMs: 60000, maxCount: 3, maxBytes: 1000, minGapMs: 1000, budgetBytes: 500, minFreeBytes: 0, graceMs: 0 });
    let t = 1_000_000;
    assert.equal(guard.checkActor('p1', t).ok, true);
    const slot = guard.reserve('p1', t);
    assert.equal(guard.checkActor('p1', t + 10).ok, false, 'minimum gap between uploads');
    assert.ok(guard.checkActor('p1', t + 10).retryAfterMs > 0);
    assert.equal(guard.checkActor('p2', t + 10).ok, true, 'throttle is per actor');
    guard.reserve('p1', t += 1500); guard.reserve('p1', t += 1500);
    assert.equal(guard.checkActor('p1', t += 1500).ok, false, 'count per window');
    assert.equal(guard.checkActor('p1', t + 60000).ok, true, 'window slides');

    const heavy = createChatUploadGuard({ dir, windowMs: 60000, maxCount: 99, maxBytes: 1000, minGapMs: 0, budgetBytes: 1e9, minFreeBytes: 0 });
    heavy.recordStored(heavy.reserve('p3', t), 1000);
    assert.equal(heavy.checkActor('p3', t + 1).ok, false, 'bytes per window');

    assert.equal(guard.checkCapacity(400).ok, true);
    guard.recordStored(slot, 400);
    assert.equal(guard.checkCapacity(200).ok, false, 'global budget refuses past capacity');
    const floor = createChatUploadGuard({ dir, budgetBytes: 1e12, minFreeBytes: Number.MAX_SAFE_INTEGER });
    if (typeof fs.statfsSync === 'function') assert.equal(floor.checkCapacity(1).ok, false, 'free-disk floor refuses');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function unitSweep() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-upload-sweep-'));
  const dir = path.join(root, 'chat-uploads');
  fs.mkdirSync(dir);
  try {
    const old = Date.now() / 1000 - 3 * 86400;
    const make = (file, age = old) => { fs.writeFileSync(path.join(dir, file), PNG); fs.utimesSync(path.join(dir, file), age, age); return file; };
    const inChat = make(name());
    const inVault = make(name());
    const inDms = make(name());
    const tribute = make(name());
    fs.writeFileSync(path.join(dir, tribute + '.tribute'), 'tribute-1');
    const young = make(name(), Date.now() / 1000);
    const orphan = make(name());
    const vaultFile = path.join(root, 'active-rooms.json');
    fs.writeFileSync(vaultFile, JSON.stringify({ rooms: [{ bloodTributes: [{ imageUrlOrStoragePath: '/uploads/chat/' + inVault }] }] }));
    const dmFile = path.join(root, 'direct-messages.json');
    fs.writeFileSync(dmFile, JSON.stringify({ threads: { x: [{ imageUrl: '/uploads/chat/' + inDms.toUpperCase() }] } }));
    const liveState = JSON.stringify({ chat: { messages: [{ imageUrl: '/uploads/chat/' + inChat }] } });

    const guard = createChatUploadGuard({ dir, graceMs: 24 * 60 * 60 * 1000 });
    // An unreadable store means a partial view: nothing may be deleted.
    const blocked = path.join(root, 'broken.json');
    fs.mkdirSync(blocked);
    const refused = guard.sweep({ texts: [liveState], files: [vaultFile, dmFile, blocked] });
    assert.equal(refused.ok, false, 'sweep refuses when a store cannot be read');
    assert.ok(fs.existsSync(path.join(dir, orphan)), 'nothing deleted on a partial view');

    const result = guard.sweep({ texts: [liveState], files: [vaultFile, dmFile, path.join(root, 'missing.json')] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.removed, [orphan], 'only the unreferenced, old, unmarked file is removed');
    for (const kept of [inChat, inVault, inDms, tribute, young]) assert.ok(fs.existsSync(path.join(dir, kept)), `${kept} kept`);
    assert.ok(fs.existsSync(path.join(dir, tribute + '.tribute')), 'tribute marker untouched');
    assert.equal(guard.usedBytes(), PNG.length * 5, 'usage re-measured after sweep');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function request(method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, res => {
      let text = ''; res.on('data', c => { text += c; });
      res.on('end', () => { let data = text; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, data, headers: res.headers }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const json = (urlPath, payload, headers = {}) => request('POST', urlPath, { body: JSON.stringify(payload), headers: { 'content-type': 'application/json', ...headers } });
const upload = (headers) => request('POST', '/api/chat/image', { body: PNG, headers: { 'content-type': 'image/png', ...headers } });

function openSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const msgs = [];
    ws.once('error', reject);
    ws.on('message', data => {
      const m = JSON.parse(data.toString());
      if (m.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
      if (m.type === 'protocol:ready') return resolve({ ws, msgs });
      msgs.push(m);
    });
  });
}
async function waitFor(client, predicate, label) {
  for (let i = 0; i < 300; i++) { const hit = client.msgs.find(predicate); if (hit) return hit; await sleep(20); }
  throw new Error('timed out: ' + label);
}

async function live(extraEnv, scenario) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-upload-live-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'up-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_MIN_FREE_DISK_BYTES: '0', ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  const sockets = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await request('GET', '/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await json('/api/auth/gm/login', { password: 'up-pass' })).data.token;
    const creds = { email: 'uploader@up.test', password: 'up-password', name: 'Uploader' };
    await json('/api/auth/player/register', creds);
    const playerToken = (await json('/api/auth/player/login', creds)).data.token;
    const player = await openSocket(); sockets.push(player.ws);
    player.ws.send(JSON.stringify({ type: 'room:join', authToken: playerToken, roomCode: 'MASTER', name: 'Uploader' }));
    await waitFor(player, m => m.type === 'join:success', 'join');
    await scenario({ player: { 'x-player-token': playerToken }, gm: { 'x-gm-token': gmToken }, DATA });
    assert.equal((await request('GET', '/health')).status, 200, 'server still healthy');
    assert.equal(errors.replace(/\[chat-image\] upload failed[^\n]*\n?(\s+at [^\n]*\n?)*/g, '').trim(), '', 'no unexpected server errors');
  } finally {
    sockets.forEach(ws => { try { ws.close(); } catch {} });
    await require('./lib/stop-process')(server);
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

(async () => {
  unitThrottleAndCapacity();
  unitSweep();

  await live({ ASOC_CHAT_UPLOAD_MIN_GAP_MS: '60000', ASOC_CHAT_UPLOAD_MAX_COUNT: '5' }, async ({ player, gm }) => {
    assert.equal((await upload(player)).status, 201, 'first upload accepted');
    const second = await upload(player);
    assert.equal(second.status, 429, 'rapid repeat upload throttled');
    assert.equal(second.data.code, 'UPLOAD_THROTTLED');
    assert.ok(Number(second.headers['retry-after']) > 0, 'Retry-After provided');
    const viaUrl = await json('/api/chat/image-url', { url: 'https://example.invalid/x.png' }, player);
    assert.equal(viaUrl.status, 429, 'image-url path shares the same throttle');
    assert.equal((await upload(gm)).status, 201, 'Shadow Broker is not throttled');
    assert.equal((await upload(gm)).status, 201);
  });

  await live({ ASOC_CHAT_UPLOAD_BUDGET_BYTES: String(PNG.length + 10), ASOC_CHAT_UPLOAD_MIN_GAP_MS: '0' }, async ({ gm, DATA }) => {
    // Admission reserves the 5 MB worst case, so a tiny budget refuses up front.
    const refused = await upload(gm);
    assert.equal(refused.status, 507, 'capacity exhausted refuses safely');
    assert.equal(refused.data.code, 'UPLOAD_CAPACITY');
    assert.deepEqual(fs.readdirSync(path.join(DATA, 'chat-uploads')).filter(n => n.endsWith('.png')), [], 'nothing written when refused');
  });

  console.log('PASS chat upload guard: per-player throttle (gap/count/bytes, both upload routes), GM exempt, capacity budget + disk floor refuse with 507, sweep keeps chat/vault/DM/tribute/young files and refuses on a partial view');
})().catch(error => {
  console.error('FAIL chat upload guard:', error);
  process.exit(1);
});
