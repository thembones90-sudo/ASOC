// /lurk: GM-only, ephemeral room-wide dread. Every surface gets one 'lurk:gaze'
// event, no chat message is created, and a second /lurk waits for the dark to lift.
// Private server on throwaway data.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_LURK_TEST_PORT) || 18795;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-lurk-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function connect(onReady) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const client = { ws, msgs: [], chat: [] };
    ws.once('error', reject);
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
      if (message.type === 'protocol:ready') return onReady(ws);
      client.msgs.push(message);
      if (message.type === 'chat:update') client.chat = message.messages || [];
      if (message.type === 'join:success' || message.type === 'host:recovered') { client.playerId = message.playerId; resolve(client); }
    });
  });
}

async function waitMessage(client, from, predicate, label) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const found = client.msgs.slice(from).find(predicate);
    if (found) return found;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'lurk-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'lurk-pass' })).data.token;
    const playerToken = (await api('/api/auth/player/register', { email: 'watched@lurk.test', password: 'lurk-password', name: 'Watched' })).data.token;
    const gm = await connect(ws => ws.send(JSON.stringify({ type: 'host:recover', gmToken })));
    const player = await connect(ws => ws.send(JSON.stringify({ type: 'room:join', authToken: playerToken, roomCode: 'MASTER', name: 'Watched' })));
    clients.push(gm, player);

    const playerMark = player.msgs.length;
    const gmMark = gm.msgs.length;
    const chatBefore = player.chat.length;
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/lurk' }));
    const gaze = await waitMessage(player, playerMark, m => m.type === 'lurk:gaze', 'player lurk gaze');
    assert.equal(gaze.durationMs, 9400);
    await waitMessage(gm, gmMark, m => m.type === 'lurk:gaze', 'GM lurk gaze');
    await sleep(300);
    assert.equal(player.chat.length, chatBefore, 'lurk creates no chat message');

    // a second one inside the window is refused, and so is any argument
    const againMark = gm.msgs.length;
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/lurk' }));
    const refused = await waitMessage(gm, againMark, m => m.type === 'error', 'second lurk refusal');
    assert.match(refused.message, /ALREADY WATCHING/);
    assert.equal(player.msgs.slice(playerMark).filter(m => m.type === 'lurk:gaze').length, 1, 'players see exactly one gaze');

    // players cannot lurk
    const playerLurkMark = gm.msgs.length;
    player.ws.send(JSON.stringify({ type: 'chat:guess', text: '/lurk' }));
    await sleep(500);
    assert.equal(gm.msgs.slice(playerLurkMark).filter(m => m.type === 'lurk:gaze').length, 0, 'a Little Hero cannot trigger /lurk');

    for (const [rel, re] of [['js/lurk.js', /lurk:gaze/], ['css/lurk.css', /prefers-reduced-motion/], ['js/app.js', /case 'lurk:gaze'/], ['js/player.js', /case 'lurk:gaze'/]]) {
      assert.match(fs.readFileSync(path.join(ROOT, rel), 'utf8'), re, rel);
    }
    for (const rel of ['index.html', 'join.html']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.match(src, /js\/lurk\.js/, `${rel} loads lurk.js`);
      assert.match(src, /css\/lurk\.css/, `${rel} loads lurk.css`);
    }
    assert.equal(serverErrors.trim(), '', 'server stderr stays clean');
    console.log('PASS lurk: GM-only ephemeral gaze reaches every surface once, no chat noise, repeat is refused, players cannot trigger it');
  } finally {
    clients.forEach(c => { try { c.ws.close(); } catch {} });
    server.kill();
    try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

run().catch(error => { console.error(error); process.exit(1); });
