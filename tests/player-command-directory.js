// Focused smoke test for /command and /commands on the production baseline.
// Isolated server and throwaway identities. No production data is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_COMMAND_TEST_PORT) || 18993;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-command-private-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];

function request(route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: route,
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitFor(client, predicate, label, after = 0, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = client.messages.slice(after).find(predicate);
    if (hit) return hit;
    await sleep(25);
  }
  throw new Error('Timed out waiting for ' + label);
}

function connect(joinPayload, successType) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT);
    const client = { ws, messages: [], chat: [] };
    clients.push(client);
    ws.once('error', reject);
    ws.on('message', bytes => {
      const m = JSON.parse(bytes.toString());
      if (m.type === 'protocol:hello') {
        ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        return;
      }
      if (m.type === 'protocol:ready') {
        ws.send(JSON.stringify(joinPayload));
        return;
      }
      client.messages.push(m);
      if (m.type === 'chat:update') client.chat = m.messages || [];
      if (m.type === successType) {
        client.playerId = m.playerId;
        resolve(client);
      }
      if (m.type === 'error' && !client.playerId && successType === 'join:success') {
        reject(new Error('Join failed: ' + m.message));
      }
    });
  });
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA,
      ASOC_GM_PASSWORD: 'command-smoke-password', ASOC_EMAIL_VERIFICATION: '0'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = '';
  server.stderr.on('data', chunk => { errors += chunk.toString(); });
  try {
    let healthy = false;
    for (let i = 0; i < 70; i++) {
      try { if ((await request('/health')).status === 200) { healthy = true; break; } }
      catch {}
      await sleep(150);
    }
    assert.ok(healthy, 'isolated ASOC server booted: ' + errors.slice(-400));
    const gmLogin = await request('/api/auth/gm/login', { password: 'command-smoke-password' });
    assert.equal(gmLogin.status, 200);
    const gm = await connect({ type: 'host:recover', gmToken: gmLogin.data.token }, 'host:recovered');
    const users = [];
    for (const name of ['Alias Alpha', 'Alias Beta']) {
      const slug = name.toLowerCase().replace(/ /g, '-');
      const signup = await request('/api/auth/player/register', {
        email: slug + '@command-smoke.test',
        password: 'command-smoke-player', name
      });
      assert.ok([200, 201].includes(signup.status), 'registered ' + name);
      users.push(await connect({
        type: 'room:join', authToken: signup.data.token, roomCode: 'MASTER', name
      }, 'join:success'));
    }
    const [actor, bystander] = users;
    gm.ws.send(JSON.stringify({ type: 'gm:setRoomMode', mode: 'CASUAL' }));
    await waitFor(gm, m => m.type === 'state:public' && m.roomMode === 'CASUAL', 'CASUAL mode');

    async function directory(verb) {
      const start = actor.messages.length;
      const observerStart = bystander.messages.length;
      const gmStart = gm.messages.length;
      actor.ws.send(JSON.stringify({ type: 'chat:guess', text: verb }));
      const msg = await waitFor(actor, m => m.type === 'commands:private', verb + ' private directory', start);
      assert.ok(Array.isArray(msg.commands) && msg.commands.some(c => c.name === '/roll'));
      assert.ok(msg.commands.some(c => c.name === '/command'), 'singular alias is listed');
      await sleep(120);
      assert.ok(!bystander.messages.slice(observerStart).some(m => m.type === 'commands:private'), 'not sent to peers');
      assert.ok(!gm.messages.slice(gmStart).some(m => m.type === 'commands:private'), 'not sent to GM');
    }

    await directory('/command');
    await directory('/commands');

    const modeStart = gm.messages.length;
    gm.ws.send(JSON.stringify({ type: 'gm:setRoomMode', mode: 'BATTLE' }));
    await waitFor(gm, m => m.type === 'state:public'
      && (m.roomMode === 'BATTLE_ARMED' || m.roomMode === 'BATTLE'), 'armed battle mode', modeStart);
    await directory('/command');
    await directory('/commands');

    const deniedStart = actor.messages.length;
    actor.ws.send(JSON.stringify({ type: 'chat:guess', text: '/dice 2d6' }));
    const denied = await waitFor(actor, m => m.type === 'error' && /BATTLE COMMANDS FORBIDDEN/.test(m.message || ''), 'battle slash restriction', deniedStart);
    assert.match(denied.message, /SHADOW BROKER ONLY/);
    const gmCommandStart = gm.messages.length;
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/command' }));
    const gmDirectory = await waitFor(gm, m => m.type === 'commands:private', 'GM alias', gmCommandStart);
    assert.ok(gmDirectory.commands.some(c => c.name === '/dennis'), 'GM-only commands stay in GM directory');

    console.log('PASS private /command + /commands in AMUSE and ABUSE; player isolation, GM authority and battle ban retained');
  } finally {
    for (const client of clients) { try { client.ws.close(); } catch {} }
    server.kill();
  }
}

run().then(() => process.exit(0)).catch(error => { console.error('FAIL private command smoke:', error); process.exit(1); });