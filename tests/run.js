const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
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
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: urlPath, method }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
}

function requestJson(urlPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers }
    }, res => {
      let raw = ''; res.on('data', chunk => { raw += chunk; });
      res.on('end', () => { let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch {} resolve({ status: res.statusCode, data }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

let TEST_GM_TOKEN = '';
let TEST_PLAYER_TOKEN = '';
let TEST_PLAYER_ID = '';

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
    ws.once('error', reject);
    ws.on('message', function protocolHandshake(data) {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type === 'protocol:hello') {
        ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        return;
      }
      if (message.type === 'protocol:ready') {
        ws.off('message', protocolHandshake);
        resolve(ws);
      }
    });
  });
}

async function createRoom(host) {
  const response = waitForMessage(host, m => m.type === 'room:created', 'room:created');
  host.send(JSON.stringify({ type: 'room:create', gameId: 'sample-game', gmToken: TEST_GM_TOKEN }));
  return response;
}

function closeWs(ws) {
  if (!ws) return;
  try { ws.close(); } catch {}
}

function testShadowBrokerTiming() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'skeleton.js'), 'utf8');
  const context = {
    window: {},
    CSS: { supports: () => true },
    document: { createElement: () => ({ textContent: '', innerHTML: '' }) }
  };
  vm.runInNewContext(source, context, { filename: 'js/skeleton.js' });
  const skeleton = context.window.Skeleton;
  assert.ok(skeleton);
  assert.equal(skeleton.BROKER_LINE_HOLD_MIN_MS, 3000);
  assert.equal(skeleton.BROKER_LINE_HOLD_MAX_MS, 8000);
  assert.equal(skeleton.BROKER_LINE_HOLD_PER_CHAR_MS, 50);

  const short = 'HELLO';
  const shortReveal = short.length * skeleton.BROKER_LINE_CHAR_MS;
  const shortHold = 3000 + short.length * 50;
  assert.ok(skeleton.shadowBrokerLineState(short, 0, shortReveal + shortHold - 1));
  assert.equal(
    skeleton.shadowBrokerLineState(short, 0, shortReveal + shortHold + skeleton.BROKER_LINE_FADE_MS),
    null
  );

  const long = 'X'.repeat(100);
  const longReveal = long.length * skeleton.BROKER_LINE_CHAR_MS;
  assert.ok(skeleton.shadowBrokerLineState(long, 0, longReveal + 7999));
  assert.equal(
    skeleton.shadowBrokerLineState(long, 0, longReveal + 8000 + skeleton.BROKER_LINE_FADE_MS),
    null
  );

  console.log('PASS Shadow Broker adaptive timing');
}

async function setupAuth() {
  const gm = await requestJson('/api/auth/gm/login', 'POST', { password: 'test-gm-password' });
  assert.equal(gm.status, 200);
  TEST_GM_TOKEN = gm.data.token;
  const credentials = { email: `regression-${process.pid}@asoc.test`, password: 'test-player-password', name: 'REGRESSION TEST' };
  let player = await requestJson('/api/auth/player/register', 'POST', credentials);
  if (player.status === 400) player = await requestJson('/api/auth/player/login', 'POST', credentials);
  assert.ok(player.status === 200 || player.status === 201);
  TEST_PLAYER_TOKEN = player.data.token;
  TEST_PLAYER_ID = player.data.player.id;
}

async function testAuthEnforcement() {
  assert.equal((await requestJson('/api/games')).status, 401);
  assert.equal((await requestJson('/api/games', 'GET', null, { 'x-gm-token': TEST_GM_TOKEN })).status, 200);
  const rogueHost = await openWs();
  const deniedHost = waitForMessage(rogueHost, m => m.type === 'auth:required' && m.role === 'gm', 'unauthenticated host denial');
  rogueHost.send(JSON.stringify({ type: 'room:create', gameId: 'sample-game' }));
  await deniedHost;
  closeWs(rogueHost);
  const host = await openWs();
  const room = await createRoom(host);
  const roguePlayer = await openWs();
  const deniedPlayer = waitForMessage(roguePlayer, m => m.type === 'auth:required' && m.role === 'player', 'unauthenticated player denial');
  roguePlayer.send(JSON.stringify({ type: 'room:join', roomCode: room.roomCode, name: 'ROGUE' }));
  await deniedPlayer;
  closeWs(roguePlayer); closeWs(host);
  console.log('PASS authentication enforcement');
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
    authToken: TEST_PLAYER_TOKEN,
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
    authToken: TEST_PLAYER_TOKEN,
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

async function testChatTransportHygiene() {
  const host = await openWs();
  const room = await createRoom(host);

  const player = await openWs();
  const joined = waitForMessage(player, m => m.type === 'join:success', 'chat hygiene player join');
  player.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
    roomCode: room.roomCode,
    name: 'CHAT HYGIENE',
    avatarData: 'data:image/png;base64,iVBORw0KGgo=',
    frameColor: '#123ABC'
  }));
  await joined;

  const firstUpdate = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === 'FIRST MESSAGE'),
    'first chat message'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: 'FIRST MESSAGE' }));
  const chat = await firstUpdate;
  const first = chat.messages.find(x => x.text === 'FIRST MESSAGE');
  assert.ok(first);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'avatarData'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'frameColor'), false);

  const cooldownError = waitForMessage(
    player,
    m => m.type === 'error' && /cooling down/i.test(m.message || ''),
    'chat flood rejection'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: 'TOO FAST' }));
  await cooldownError;

  await delay(400);
  const thirdUpdate = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === 'AFTER COOLDOWN'),
    'chat after cooldown'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: 'AFTER COOLDOWN' }));
  await thirdUpdate;

  console.log('PASS chat payload normalization and flood protection');
  closeWs(player);
  closeWs(host);
}

async function testChatEmojiReactions() {
  const host = await openWs();
  const room = await createRoom(host);

  const player = await openWs();
  const joinedPromise = waitForMessage(player, m => m.type === 'join:success', 'reaction player join');
  player.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
    roomCode: room.roomCode,
    name: 'REACTION TEST'
  }));
  const joined = await joinedPromise;

  const emojiMessageUpdate = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === 'EMOJI 😂💀'),
    'emoji chat transport'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: 'EMOJI 😂💀' }));
  const emojiState = await emojiMessageUpdate;
  const emojiMessage = emojiState.messages.find(x => x.text === 'EMOJI 😂💀');
  assert.ok(emojiMessage);
  assert.deepEqual(emojiMessage.reactions, {});

  const reactedUpdate = waitForMessage(
    player,
    m => {
      const target = m.type === 'chat:update' && m.messages?.find(x => x.id === emojiMessage.id);
      return Array.isArray(target?.reactions?.['💀']) && target.reactions['💀'].includes(joined.playerId);
    },
    'reaction add'
  );
  player.send(JSON.stringify({ type: 'chat:react', messageId: emojiMessage.id, emoji: '💀' }));
  const reactedState = await reactedUpdate;
  const reactedMessage = reactedState.messages.find(x => x.id === emojiMessage.id);
  assert.equal(reactedMessage.reactions['💀'].length, 1);

  await delay(150);
  const unreactedUpdate = waitForMessage(
    player,
    m => {
      const target = m.type === 'chat:update' && m.messages?.find(x => x.id === emojiMessage.id);
      return target && !target.reactions?.['💀'];
    },
    'reaction remove'
  );
  player.send(JSON.stringify({ type: 'chat:react', messageId: emojiMessage.id, emoji: '💀' }));
  await unreactedUpdate;

  const brokerUpdate = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.source === 'shadowBroker' && x.text === 'REACT TO BROKER'),
    'broker reaction target'
  );
  host.send(JSON.stringify({ type: 'gm:broadcast', text: 'REACT TO BROKER' }));
  const brokerState = await brokerUpdate;
  const brokerMessage = brokerState.messages.find(x => x.source === 'shadowBroker' && x.text === 'REACT TO BROKER');

  await delay(150);
  const brokerReactedUpdate = waitForMessage(
    player,
    m => {
      const target = m.type === 'chat:update' && m.messages?.find(x => x.id === brokerMessage.id);
      return Array.isArray(target?.reactions?.['🔥']) && target.reactions['🔥'].includes(joined.playerId);
    },
    'broker reaction add'
  );
  player.send(JSON.stringify({ type: 'chat:react', messageId: brokerMessage.id, emoji: '🔥' }));
  await brokerReactedUpdate;

  const gmReactedUpdate = waitForMessage(
    player,
    m => {
      const target = m.type === 'chat:update' && m.messages?.find(x => x.id === brokerMessage.id);
      return Array.isArray(target?.reactions?.['👀']) && target.reactions['👀'].includes('__GM__');
    },
    'gm reaction add'
  );
  host.send(JSON.stringify({ type: 'chat:react', messageId: brokerMessage.id, emoji: '👀' }));
  await gmReactedUpdate;

  const invalidReaction = waitForMessage(
    player,
    m => m.type === 'error' && /invalid reaction/i.test(m.message || ''),
    'invalid reaction rejection'
  );
  await delay(150);
  player.send(JSON.stringify({ type: 'chat:react', messageId: emojiMessage.id, emoji: '🚂' }));
  await invalidReaction;

  console.log('PASS emoji chat and server-authoritative reactions');
  closeWs(player);
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

async function testShadowBrokerControls() {
  const host = await openWs();
  const room = await createRoom(host);

  const player = await openWs();
  const joined = waitForMessage(player, m => m.type === 'join:success', 'broker player join');
  player.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
    roomCode: room.roomCode,
    name: 'BROKER TEST'
  }));
  await joined;

  const longBrokerText = 'X'.repeat(512);
  const longBroadcastOnHost = waitForMessage(
    host,
    m => m.type === 'chat:update' && m.messages?.some(x => x.source === 'shadowBroker' && x.text === longBrokerText),
    'long broker broadcast on host'
  );
  const longBroadcastOnPlayer = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.source === 'shadowBroker' && x.text === longBrokerText),
    'long broker broadcast on player'
  );
  host.send(JSON.stringify({ type: 'gm:broadcast', text: longBrokerText }));
  await Promise.all([longBroadcastOnHost, longBroadcastOnPlayer]);

  const replacementText = 'SECOND TRANSMISSION';
  const replacementUpdate = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.source === 'shadowBroker' && x.text === replacementText),
    'replacement broker broadcast'
  );
  host.send(JSON.stringify({ type: 'gm:broadcast', text: replacementText }));
  await replacementUpdate;

  const clearOnHost = waitForMessage(host, m => m.type === 'shadowBroker:clear', 'broker clear on host');
  const clearOnPlayer = waitForMessage(player, m => m.type === 'shadowBroker:clear', 'broker clear on player');
  host.send(JSON.stringify({ type: 'gm:clearBroadcast' }));
  await Promise.all([clearOnHost, clearOnPlayer]);

  const unauthorizedClear = waitForMessage(
    player,
    m => m.type === 'error' && /only host can clear/i.test(m.message || ''),
    'non-host broker clear rejection'
  );
  player.send(JSON.stringify({ type: 'gm:clearBroadcast' }));
  await unauthorizedClear;

  const reconnect = await openWs();
  const reconnectChat = waitForMessage(reconnect, m => m.type === 'chat:update', 'broker reconnect chat hydration');
  reconnect.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
    roomCode: room.roomCode,
    name: 'BROKER RECONNECT'
  }));
  const hydrated = await reconnectChat;
  assert.ok(hydrated.messages.some(m => m.source === 'shadowBroker' && m.text === longBrokerText));
  assert.ok(hydrated.messages.some(m => m.source === 'shadowBroker' && m.text === replacementText));

  console.log('PASS Shadow Broker broadcast/clear/boundary regression');
  closeWs(reconnect);
  closeWs(player);
  closeWs(host);
}

async function testCrashRecovery(server) {
  const host = await openWs();
  const room = await createRoom(host);

  const player = await openWs();
  const joinedPromise = waitForMessage(player, m => m.type === 'join:success', 'recovery player join');
  const recoveryAvatar = 'data:image/png;base64,iVBORw0KGgo=';
  const recoveryFrame = '#12ABCD';
  player.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
    roomCode: room.roomCode,
    name: 'RECOVERY TEST',
    avatarData: recoveryAvatar,
    frameColor: recoveryFrame
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
  await setupAuth();

  const host2 = await openWs();
  const statePromise = waitForMessage(host2, m => m.type === 'state:public', 'restored state');
  const chatPromise = waitForMessage(host2, m => m.type === 'chat:update', 'restored chat');
  const playersPromise = waitForMessage(host2, m => m.type === 'players:update', 'restored players');
  const reconnectPromise = waitForMessage(host2, m => m.type === 'host:reconnected', 'host reconnect');

  host2.send(JSON.stringify({
    type: 'host:reconnect',
    roomCode: room.roomCode,
    hostToken: room.hostToken,
    gmToken: TEST_GM_TOKEN
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
  assert.equal(restoredPlayer.avatarData, recoveryAvatar);
  assert.equal(restoredPlayer.frameColor, recoveryFrame);

  const player2 = await openWs();
  const rejoinPromise = waitForMessage(player2, m => m.type === 'join:success', 'restored player reconnect');
  player2.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
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
        ASOC_SESSION_FILE: TEST_SESSION,
        ASOC_AUTH_FILE: path.join(os.tmpdir(), `asoc-test-auth-${process.pid}.json`),
        ASOC_GM_PASSWORD: 'test-gm-password'
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
    testShadowBrokerTiming();
    server = await startServer();
    await setupAuth();
    await testAuthEnforcement();
    await testStaticLockdown();
    await testReconnectIdentity();
    await testChatTransportHygiene();
    await testChatEmojiReactions();
    await testResetBroadcast();
    await testShadowBrokerControls();
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
