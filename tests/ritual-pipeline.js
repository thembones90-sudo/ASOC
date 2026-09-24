const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-ritual-pipeline-'));
const PORT = 19200 + (process.pid % 500);
let server;

function requestJson(urlPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
    }, response => {
      let raw = '';
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        resolve({ status: response.statusCode, data });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function waitForMessage(ws, predicate, label, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeout);
    function onMessage(raw) {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

async function openWs() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(ws, 'open');
  const hello = await waitForMessage(ws, message => message.type === 'protocol:hello', 'protocol hello');
  assert.equal(hello.protocolVersion, 1);
  const ready = waitForMessage(ws, message => message.type === 'protocol:ready', 'protocol ready');
  ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
  await ready;
  return ws;
}

async function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      ASOC_DATA_DIR: DATA,
      ASOC_GM_PASSWORD: 'ritual-pipeline-password',
      ASOC_EMAIL_VERIFICATION: '0',
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 7000);
    const inspect = chunk => {
      if (!String(chunk).includes('ASOC Engine server running')) return;
      clearTimeout(timer);
      resolve();
    };
    server.stdout.on('data', inspect);
    server.stderr.on('data', inspect);
    server.once('exit', code => reject(new Error(`Server exited during startup (${code})`)));
  });
}

async function main() {
  await startServer();

  const gmLogin = await requestJson('/api/auth/gm/login', 'POST', { password: 'ritual-pipeline-password' });
  assert.equal(gmLogin.status, 200);

  const host = await openWs();
  const roomCreated = waitForMessage(host, message => message.type === 'room:created', 'room creation');
  host.send(JSON.stringify({ type: 'room:create', gameId: 'sample-game', gmToken: gmLogin.data.token }));
  await roomCreated;

  const players = [];
  for (let index = 1; index <= 5; index++) {
    const name = `RITUAL HERO ${index}`;
    const registration = await requestJson('/api/auth/player/register', 'POST', {
      email: `ritual-${process.pid}-${index}@asoc.test`,
      password: 'ritual-player-password',
      name
    });
    assert.ok([200, 201].includes(registration.status), `player ${index} registered`);

    const ws = await openWs();
    const joined = waitForMessage(ws, message => message.type === 'join:success', `player ${index} join`);
    const initialRitual = waitForMessage(ws, message => message.type === 'ritual:update' && message.ritual?.active, `player ${index} ritual hydration`);
    ws.send(JSON.stringify({ type: 'room:join', authToken: registration.data.token, name }));
    await Promise.all([joined, initialRitual]);
    players.push({ ws, name });
  }

  for (let index = 0; index < players.length; index++) {
    const expectedCount = index + 1;
    const gmUpdate = waitForMessage(host, message => (
      message.type === 'ritual:gmUpdate' && message.ritual?.joinedCount === expectedCount
    ), `GM ritual count ${expectedCount}`);
    const playerUpdate = waitForMessage(players[index].ws, message => (
      message.type === 'ritual:update' && message.ritual?.joinedCount === expectedCount && message.ritual?.iJoined === true
    ), `player ritual count ${expectedCount}`);

    players[index].ws.send(JSON.stringify({ type: 'ritual:join' }));
    const [gmState, playerState] = await Promise.all([gmUpdate, playerUpdate]);

    assert.equal(gmState.ritual.joined.length, expectedCount);
    assert.equal(gmState.ritual.joined[index].name, players[index].name);
    assert.equal(playerState.ritual.fulfilled, expectedCount === 5);
    assert.equal(gmState.ritual.fulfilled, expectedCount === 5);
    assert.equal(gmState.ritual.fulfilledBy, expectedCount === 5 ? 'VOTES' : null);
  }

  const ritualSource = fs.readFileSync(path.join(ROOT, 'js', 'ritual.js'), 'utf8');
  assert.match(ritualSource, /nowActive \? runeImage\.dataset\.activeSrc : runeImage\.dataset\.idleSrc/);
  assert.match(ritualSource, /const nowActive = byBlood \? true : index < joinedCount/);

  players.forEach(({ ws }) => ws.close());
  host.close();
  console.log('PASS ritual vote pipeline and beacon asset switching');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  fs.rmSync(DATA, { recursive: true, force: true });
});
