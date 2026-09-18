const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_PLAYERS = path.join(os.tmpdir(), `asoc-test-players-${process.pid}.json`);
const TEST_SESSION = path.join(os.tmpdir(), `asoc-test-session-${process.pid}.json`);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requestStatus(urlPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

function waitForMessage(ws, predicate, label, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeout);

    function onMessage(data) {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    }

    ws.on('message', onMessage);
  });
}

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function createRoom(host) {
  const response = waitForMessage(host, m => m.type === 'room:created', 'room:created');
  host.send(JSON.stringify({ type: 'room:create', gameId: 'sample-game' }));
  return response;
}

function closeWs(ws) {
  if (!ws) return;
  try { ws.close(); } catch {}
}

async function testStaticLockdown() {
  assert.equal(await requestStatus('/'), 200);
  assert.equal(await requestStatus('/join.html'), 200);
  assert.equal(await requestStatus('/css/asoc.css'), 200);
  assert.equal(await requestStatus('/js/app.js'), 200);

  assert.equal(await requestStatus('/HANDOFF.md'), 404);
  assert.equal(await requestStatus('/server.js'), 404);
  assert.equal(await requestStatus('/.git/config'), 404);
  assert.equal(await requestStatus('/games/kurac-test.json'), 404);
  assert.equal(await requestStatus('/node_modules/ws/index.js'), 404);
  assert.equal(await requestStatus('/js/%2e%2e/server.js'), 404);
  assert.equal(await requestStatus('/index.html', 'POST'), 405);

  console.log('PASS static file lockdown');
}

async function testReconnectIdentity() {
  const host = await openWs();
  const room = await createRoom(host);

  const p1 = await openWs();
  const firstJoin = waitForMessage(p1, m => m.type === 'join:success', 'first join');
  p1.send(JSON.stringify({
    type: 'room:join',
    roomCode: room.roomCode,
    name: 'REGRESSION TEST'
  }));
  const first = await firstJoin;
  closeWs(p1);
  await delay(150);

  const p2 = await openWs();
  const secondJoin = waitForMessage(p2, m => m.type === 'join:success', 'reconnect');
  p2.send(JSON.stringify({
    type: 'room:join',
    roomCode: room.roomCode,
    name: 'REGRESSION TEST',
    playerId: first.playerId
  }));
  const second = await secondJoin;

  assert.equal(second.playerId, first.playerId);
  console.log('PASS stable player reconnect ID');

  closeWs(p2);
  closeWs(host);
}

async function testResetBroadcast() {
  const host = await openWs();
  const messages = [];
  host.on('message', data => {
    try { messages.push(JSON.parse(data.toString())); } catch {}
  });

  await createRoom(host);
  await delay(100);
  const start = messages.length;

  host.send(JSON.stringify({
    type: 'gm:command',
    command: 'resetBoard',
    payload: {},
    cmdId: 1
  }));

  const ack = await waitForMessage(
    host,
    m => m.type === 'command:ack' && m.cmdId !== 999999,
    'reset command ack'
  );
  await delay(100);

  const resetMessages = messages.slice(start);
  assert.equal(ack.unchanged, undefined);
  assert.ok(resetMessages.some(m => m.type === 'state:public'));
  assert.ok(resetMessages.some(m => m.type === 'chat:update'));
  assert.ok(resetMessages.some(m => m.type === 'players:update'));

  console.log('PASS reset board broadcast');
  closeWs(host);
}

async function testCrashRecovery(server) {
  const host = await openWs();
  const room = await createRoom(host);

  const player = await openWs();
  const joinedPromise = waitForMessage(player, m => m.type === 'join:success', 'recovery player join');
  player.send(JSON.stringify({
    type: 'room:join',
    roomCode: room.roomCode,
    name: 'RECOVERY TEST'
  }));
  const joined = await joinedPromise;

  const revealAck = waitForMessage(host, m => m.type === 'command:ack', 'reveal ack');
  host.send(JSON.stringify({
    type: 'gm:command',
    command: 'revealCell',
    payload: { cell: 'A3', reveal: true },
    cmdId: 77
  }));
  await revealAck;

  const brokerUpdate = waitForMessage(
    host,
    m => m.type === 'chat:update' && Array.isArray(m.messages) &&
      m.messages.some(x => x.source === 'shadowBroker' && x.text === 'RECOVERY CHECK'),
    'broker recovery message'
  );
  host.send(JSON.stringify({ type: 'gm:broadcast', text: 'RECOVERY CHECK' }));
  await brokerUpdate;
  await delay(100);

  await new Promise(resolve => {
    server.once('exit', resolve);
    server.kill();
  });

  const restarted = await startServer();

  const host2 = await openWs();
  const statePromise = waitForMessage(host2, m => m.type === 'state:public', 'restored state');
  const chatPromise = waitForMessage(host2, m => m.type === 'chat:update', 'restored chat');
  const playersPromise = waitForMessage(host2, m => m.type === 'players:update', 'restored players');
  const reconnectPromise = waitForMessage(host2, m => m.type === 'host:reconnected', 'host reconnect');

  host2.send(JSON.stringify({
    type: 'host:reconnect',
    roomCode: room.roomCode,
    hostToken: room.hostToken
  }));

  const [state, chat, players] = await Promise.all([
    statePromise,
    chatPromise,
    playersPromise,
    reconnectPromise
  ]).then(values => values.slice(0, 3));

  assert.equal(state.cells.A3.revealed, true);
  assert.ok(Array.isArray(state.clueOrder.A) && state.clueOrder.A.includes(3));
  assert.ok(chat.messages.some(m => m.source === 'shadowBroker' && m.text === 'RECOVERY CHECK'));

  const restoredPlayer = players.players.find(p => p.id === joined.playerId);
  assert.ok(restoredPlayer);
  assert.equal(restoredPlayer.connected, false);

  const player2 = await openWs();
  const rejoinPromise = waitForMessage(player2, m => m.type === 'join:success', 'restored player reconnect');
  player2.send(JSON.stringify({
    type: 'room:join',
    roomCode: room.roomCode,
    name: 'RECOVERY TEST',
    playerId: joined.playerId
  }));
  const rejoined = await rejoinPromise;
  assert.equal(rejoined.playerId, joined.playerId);

  console.log('PASS session crash recovery');

  closeWs(player2);
  closeWs(host2);
  return restarted;
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        ASOC_PLAYERS_FILE: TEST_PLAYERS,
        ASOC_SESSION_FILE: TEST_SESSION
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Test server did not start in time' + (stderr ? `: ${stderr}` : '')));
    }, 5000);

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('ASOC Engine server running')) {
        clearTimeout(timer);
        resolve(child);
      }
    });

    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== null && code !== 0) {
        reject(new Error(`Test server exited early with code ${code}${stderr ? `: ${stderr}` : ''}`));
      }
    });
  });
}

(async () => {
  let server;
  try {
    server = await startServer();
    await testStaticLockdown();
    await testReconnectIdentity();
    await testResetBroadcast();
    server = await testCrashRecovery(server);
    console.log('ALL ASOC REGRESSION TESTS PASSED');
  } catch (error) {
    console.error('TEST FAILURE:', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
    try { fs.unlinkSync(TEST_PLAYERS); } catch {}
    try { fs.unlinkSync(TEST_SESSION); } catch {}
  }
})();
