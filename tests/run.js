const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
// Overridable so two agents/terminals can run the suite at the same time
// without colliding on one fixed port (e.g. ASOC_TEST_PORT=18190 npm test).
const PORT = Number(process.env.ASOC_TEST_PORT) || 18080;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_PLAYERS = path.join(os.tmpdir(), `asoc-test-players-${process.pid}.json`);
const TEST_SESSION = path.join(os.tmpdir(), `asoc-test-session-${process.pid}.json`);
const TEST_PLAYER_AUTH_SESSIONS = path.join(os.tmpdir(), `asoc-test-player-auth-sessions-${process.pid}.json`);
const TEST_MATCHES = path.join(os.tmpdir(), `asoc-test-matches-${process.pid}.json`);
const TEST_AUTH_FILE = path.join(os.tmpdir(), `asoc-test-auth-${process.pid}.json`);

function readArchive(roomCode) {
  try {
    const archive = JSON.parse(fs.readFileSync(TEST_MATCHES, 'utf8'));
    return Object.values(archive.matches || {}).filter(record => !roomCode || record.roomCode === roomCode);
  } catch {
    return [];
  }
}

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

async function startBattle(host) {
  const started = waitForMessage(host, m => m.type === 'state:public' && m.roomMode === 'BATTLE', 'battle mode start');
  host.send(JSON.stringify({ type: 'gm:timerStart' }));
  return started;
}

async function createRoom(host, { startBattle: shouldStartBattle = true } = {}) {
  const arm = async () => {
    const response = waitForMessage(
      host,
      m => m.type === 'room:created' || (m.type === 'error' && m.code === 'MASTER_ALREADY_ARMED'),
      'room:create response'
    );
    host.send(JSON.stringify({ type: 'room:create', gameId: 'sample-game', gmToken: TEST_GM_TOKEN }));
    return response;
  };
  const finishArm = async response => {
    if (response.type === 'room:created' && shouldStartBattle) await startBattle(host);
    return response;
  };

  let response = await arm();
  if (response.type === 'room:created') return finishArm(response);

  for (let attempt = 0; attempt < 5; attempt++) {
    const recovered = waitForMessage(
      host,
      m => m.type === 'host:recovered' || (m.type === 'error' && m.code === 'recover_host_already_connected'),
      'host recovery before test arm'
    );
    host.send(JSON.stringify({ type: 'host:recover', gmToken: TEST_GM_TOKEN }));
    const recovery = await recovered;
    if (recovery.type === 'host:recovered') {
      const casual = waitForMessage(host, m => m.type === 'room:casual', 'test cleanup return to casual');
      host.send(JSON.stringify({ type: 'room:close' }));
      await casual;
      response = await arm();
      if (response.type === 'room:created') return finishArm(response);
    }
    await delay(100);
  }

  throw new Error('Could not obtain a clean CASUAL MASTER for test');
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

  const renamed = await requestJson('/api/auth/player/profile', 'PATCH',
    { name: 'REGRESSION RENAMED' }, { 'x-player-token': TEST_PLAYER_TOKEN });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.player.id, TEST_PLAYER_ID, 'renaming keeps the stable account identity');
  assert.equal(renamed.data.player.name, 'REGRESSION RENAMED');

  const renamedSession = await requestJson('/api/auth/player/session', 'GET', null,
    { 'x-player-token': TEST_PLAYER_TOKEN });
  assert.equal(renamedSession.status, 200);
  assert.equal(renamedSession.data.player.name, 'REGRESSION RENAMED', 'renamed designation persists through session hydration');

  const restored = await requestJson('/api/auth/player/profile', 'PATCH',
    { name: 'REGRESSION TEST' }, { 'x-player-token': TEST_PLAYER_TOKEN });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.player.name, 'REGRESSION TEST');
}

async function testMasterRoomLifecycle() {
  const player = await openWs();
  const joined = waitForMessage(player, m => m.type === 'join:success', 'Master Room player join');
  const unarmed = waitForMessage(player, m => m.type === 'state:public' && m.armed === false, 'Master Room unarmed state');
  player.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
    name: 'MASTER ROOM TEST'
  }));
  const [joinAck, initialState] = await Promise.all([joined, unarmed]);
  assert.equal(joinAck.roomCode, 'MASTER', 'players always join the canonical Master Room');
  assert.equal(initialState.roomCode, 'MASTER');
  assert.equal(initialState.armed, false, 'Master Room is available while no game is armed');

  const beforeText = 'MASTER ROOM UNARMED CHAT';
  const beforeChat = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === beforeText),
    'unarmed Master Room chat'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: beforeText }));
  const beforeChatState = await beforeChat;
  const historicalMessage = beforeChatState.messages.find(x => x.text === beforeText);
  assert.equal(historicalMessage.adjudicable, false, 'unarmed chat is never an active-game answer');

  const host = await openWs();
  const armedState = waitForMessage(player, m => m.type === 'state:public' && m.armed === true, 'Master Room armed in place');
  const armedChat = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === beforeText),
    'Master Room chat survives arm'
  );
  const room = await createRoom(host, { startBattle: false });
  assert.equal(room.roomCode, 'MASTER');
  const armedSnapshot = await armedState;
  assert.equal(armedSnapshot.roomMode, 'BATTLE_ARMED');
  const armedChatState = await armedChat;
  assert.equal(
    armedChatState.messages.find(x => x.id === historicalMessage.id)?.adjudicable,
    false,
    'pre-game chat remains archival after ARM GAME'
  );

  const historicalReject = waitForMessage(
    host,
    m => m.type === 'error' && /historical transmission/i.test(m.message || ''),
    'historical message adjudication rejection'
  );
  host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId: historicalMessage.id, verdict: 'wrong' }));
  await historicalReject;

  const liveState = await startBattle(host);
  assert.equal(liveState.roomMode, 'BATTLE');

  await delay(400);
  const activeText = 'MASTER ROOM ACTIVE GUESS';
  const activeChat = waitForMessage(
    host,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === activeText),
    'active game chat'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: activeText }));
  const activeMessage = (await activeChat).messages.filter(x => x.text === activeText).at(-1);
  assert.equal(activeMessage.adjudicable, true, 'current-board player chat is judgeable');
  const activeJudgeAck = waitForMessage(host, m => m.type === 'gm:judge:ack' && m.messageId === activeMessage.id, 'active guess judge');
  host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId: activeMessage.id, verdict: 'wrong' }));
  await activeJudgeAck;

  const womfCharged = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 1, 'WOMF charge before disarm');
  host.send(JSON.stringify({ type: 'gm:failColumn', column: 'A' }));
  await womfCharged;

  const disarmedState = waitForMessage(player, m => m.type === 'state:public' && m.armed === false, 'Master Room disarmed in place');
  const disarmedChat = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === beforeText),
    'Master Room chat survives disarm'
  );
  const disarmedAck = waitForMessage(host, m => m.type === 'room:casual', 'Master Room disarm acknowledgement');
  host.send(JSON.stringify({ type: 'room:close' }));
  const [idleState] = await Promise.all([disarmedState, disarmedChat, disarmedAck]);
  assert.equal(idleState.womf.charge, 1, 'KILL SESSION must preserve Master Room WOMF charge');
  assert.equal(player.readyState, WebSocket.OPEN, 'disarming gameplay must not disconnect players');

  const rearmedState = waitForMessage(player, m => m.type === 'state:public' && m.armed === true, 'Master Room rearmed');
  await createRoom(host, { startBattle: false });
  assert.equal((await rearmedState).womf.charge, 1, 'ARM BATTLE must preserve accumulated WOMF charge');
  const womfReset = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 0, 'WOMF cleanup for later tests');
  host.send(JSON.stringify({ type: 'gm:womfReset' }));
  await womfReset;
  const redisarmed = waitForMessage(host, m => m.type === 'room:casual', 'Master Room second disarm');
  host.send(JSON.stringify({ type: 'room:close' }));
  await redisarmed;

  await delay(400);
  const afterText = 'MASTER ROOM POST GAME CHAT';
  const afterChat = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === afterText),
    'post-game Master Room chat'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: afterText }));
  await afterChat;

  console.log('PASS permanent Master Room: no code, unarmed chat, arm/disarm in place');
  closeWs(player);
  closeWs(host);
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
  await delay(400); // identity-scoped chat cooldown survives socket churn

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

  // Cooldowns are identity-scoped now, so reconnecting/new sockets cannot
  // bypass them. The preceding transport test intentionally used this same
  // authenticated identity and ended with a chat message.
  await delay(400);

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

async function testGameWonReward() {
  const host = await openWs();
  const room = await createRoom(host);

  const player = await openWs();
  const firstState = waitForMessage(player, m => m.type === 'state:public', 'game won player initial state');
  const joined = waitForMessage(player, m => m.type === 'join:success', 'game won player join');
  player.send(JSON.stringify({
    type: 'room:join',
    authToken: TEST_PLAYER_TOKEN,
    roomCode: room.roomCode,
    name: 'GAME WON TEST'
  }));
  await joined;
  assert.equal((await firstState).gameWon, false, 'a fresh board is not won');

  const stateWhere = (ws, predicate, label) =>
    waitForMessage(ws, m => m.type === 'state:public' && predicate(m), label);
  const bothSee = (predicate, label) => Promise.all([
    stateWhere(host, predicate, `${label} on host`),
    stateWhere(player, predicate, `${label} on player`)
  ]);
  const command = (name, cmdId) =>
    host.send(JSON.stringify({ type: 'gm:command', command: name, payload: {}, cmdId }));

  // 1. A player can never trigger it: rejected, and no victory state leaks.
  const rejected = waitForMessage(
    player,
    m => m.type === 'error' && /only host can trigger game won/i.test(m.message || ''),
    'non-host GAME WON rejection'
  );
  let leaked = false;
  const leakWatch = raw => { try { const m = JSON.parse(raw); if (m.type === 'state:public' && m.gameWon) leaked = true; } catch {} };
  host.on('message', leakWatch);
  player.on('message', leakWatch);
  player.send(JSON.stringify({ type: 'gm:gameWon' }));
  await rejected;
  await delay(150);
  assert.equal(leaked, false, 'GAME WON must not be set by a non-host');

  // 2. REVEAL ALL opens the whole field (which ends the MATCH) but is NOT a
  //    victory: victory is only ever the host's manual GAME WON.
  const revealed = bothSee(m => m.finalSolution?.revealed === true, 'reveal all');
  command('revealAll', 901);
  const [revealedState] = await revealed;
  assert.equal(revealedState.gameWon, false, 'REVEAL ALL must not set gameWon');
  const cleared = bothSee(m => m.finalSolution?.revealed !== true, 'reset after reveal all');
  command('resetBoard', 902);
  await cleared;
  await startBattle(host);

  // 3. Accepting the FINAL is NOT the end of the game -- columns can still be
  //    solved -- so it must never trigger the victory. GAME WON is the host's
  //    manual call.
  const guessSeen = waitForMessage(
    host,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === 'THE FINAL ANSWER'),
    'final guess chat'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: 'THE FINAL ANSWER' }));
  const guessId = (await guessSeen).messages.find(x => x.text === 'THE FINAL ANSWER').id;
  let wonEarly = false;
  const earlyWatch = raw => { try { const m = JSON.parse(raw); if (m.type === 'state:public' && m.gameWon) wonEarly = true; } catch {} };
  host.on('message', earlyWatch);
  player.on('message', earlyWatch);
  const judgeAck = waitForMessage(host, m => m.type === 'gm:judge:ack' && m.messageId === guessId, 'final judge ack');
  host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId: guessId, verdict: 'correct', target: 'FINAL', reveal: true }));
  await judgeAck;
  await delay(200);
  host.off('message', earlyWatch);
  player.off('message', earlyWatch);
  assert.equal(wonEarly, false, 'accepting the Final must NOT trigger GAME WON');

  // 4. The host's manual button is the only way to enter the victory state.
  const wonManually = bothSee(m => m.gameWon === true, 'manual GAME WON');
  host.send(JSON.stringify({ type: 'gm:gameWon' }));
  const [hostWon, playerWon] = await wonManually;
  assert.equal(hostWon.matchResult?.outcome, 'WON');
  assert.equal(hostWon.matchResult.message, playerWon.matchResult.message, 'all clients receive one server-selected win message');
  assert.equal(hostWon.matchResult.finalSolution, hostWon.finalSolution.value);
  assert.ok(hostWon.matchResult.columnSolutions?.A !== undefined);
  assert.deepEqual(hostWon.matchResult.columnResults, { A: false, B: false, C: false, D: false },
    'GAME WON preserves independent per-column misses');

  // 5. A late-joining client (a different player) hydrates straight into the
  //    completed state. (Re-using the first player's token would replace that
  //    player's socket via stable reconnect identity -- not what this models.)
  const lateAuth = await requestJson('/api/auth/player/register', 'POST', {
    email: `gamewon-late-${process.pid}@asoc.test`, password: 'test-player-password', name: 'GAME WON LATE'
  });
  assert.ok(lateAuth.status === 200 || lateAuth.status === 201);
  const joinLate = async () => {
    const late = await openWs();
    const lateState = waitForMessage(late, m => m.type === 'state:public', 'late joiner state');
    late.send(JSON.stringify({ type: 'room:join', authToken: lateAuth.data.token, roomCode: room.roomCode, name: 'GAME WON LATE' }));
    const state = await lateState;
    closeWs(late);
    return state;
  };
  assert.equal((await joinLate()).gameWon, true, 'a reconnecting client must hydrate as already won');

  // 6. Manual trigger on an already-won game is a no-op: no new broadcast.
  let rebroadcast = false;
  const rebroadcastWatch = raw => { try { if (JSON.parse(raw).type === 'state:public') rebroadcast = true; } catch {} };
  host.on('message', rebroadcastWatch);
  host.send(JSON.stringify({ type: 'gm:gameWon' }));
  await delay(200);
  host.off('message', rebroadcastWatch);
  assert.equal(rebroadcast, false, 'GAME WON must be idempotent once won');

  // 7. The completed victory state locks further adjudication.
  const locked = waitForMessage(host, m => m.type === 'error' && /game won.*attempts locked/i.test(m.message || ''), 'post-win adjudication lock');
  host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId: guessId, verdict: 'wrong' }));
  await locked;
  const lateSettled = await joinLate();
  assert.equal(lateSettled.gameWon, true, 'a reconnect remains in the completed victory state');
  assert.equal(lateSettled.matchResult.message, hostWon.matchResult.message, 'reconnect never rerolls the win message');

  // 8. RESET BOARD clears it with the rest of the board.
  const resetClears = bothSee(m => m.gameWon === false, 'reset clears GAME WON');
  command('resetBoard', 903);
  await resetClears;

  console.log('PASS GAME WON is manual-only (not triggered by the Final; hydrate/idempotent/reset)');
  closeWs(player);
  closeWs(host);
}

async function testAuthoritativeGameLost() {
  const host = await openWs();
  const room = await createRoom(host, { startBattle: false });
  const player = await openWs();
  const joined = waitForMessage(player, m => m.type === 'join:success', 'game lost player join');
  player.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, roomCode: room.roomCode, name: 'LOSS TEST' }));
  await joined;

  const borrowed = waitForMessage(host, m => m.type === 'state:public' && m.timer?.phase === 'borrowed', 'borrowed time transition');
  host.send(JSON.stringify({ type: 'gm:timerStart' }));
  host.send(JSON.stringify({ type: 'gm:timerAdjust', deltaMs: -99 * 60 * 1000 }));
  await borrowed;

  const hostLost = waitForMessage(host, m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'host game lost', 5000);
  const playerLost = waitForMessage(player, m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'player game lost', 5000);
  host.send(JSON.stringify({ type: 'gm:timerAdjust', deltaMs: -99 * 60 * 1000 }));
  const [hostState, playerState] = await Promise.all([hostLost, playerLost]);
  assert.equal(hostState.matchResult.message, playerState.matchResult.message, 'all clients receive one server-selected message');
  assert.equal(hostState.finalSolution.outcome, 'failed');
  assert.equal(hostState.matchResult.finalSolution, hostState.finalSolution.value);
  assert.deepEqual(hostState.matchResult.columnResults, { A: false, B: false, C: false, D: false },
    'GAME LOST carries independent per-column results');
  assert.ok(Array.isArray(hostState.matchResult.awards));
  assert.ok(hostState.matchResult.awards.some(a => a.type === 'COLLECTIVE FAILURE'));

  const postLossChat = waitForMessage(
    player,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === 'TOO LATE'),
    'post-loss social chat remains open'
  );
  player.send(JSON.stringify({ type: 'chat:guess', text: 'TOO LATE' }));
  const postLoss = await postLossChat;
  assert.equal(postLoss.messages.find(x => x.text === 'TOO LATE')?.adjudicable, false,
    'post-loss chat is social-only and cannot be judged');

  const late = await openWs();
  const credentials = { email: `loss-late-${process.pid}@asoc.test`, password: 'test-player-password', name: 'LOSS LATE' };
  let auth = await requestJson('/api/auth/player/register', 'POST', credentials);
  if (auth.status === 400) auth = await requestJson('/api/auth/player/login', 'POST', credentials);
  const lateState = waitForMessage(late, m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'late join settled loss');
  late.send(JSON.stringify({ type: 'room:join', authToken: auth.data.token, roomCode: room.roomCode, name: 'LOSS LATE' }));
  assert.equal((await lateState).matchResult.message, hostState.matchResult.message, 'late join does not reroll the loss message');

  console.log('PASS GAME LOST is timer-authoritative, synchronized, reconnect-safe, and leaves social chat open');
  closeWs(late);
  closeWs(player);
  closeWs(host);
}

async function testCrashRecovery(server) {
  const host = await openWs();
  const room = await createRoom(host);
  const preexistingArchiveIds = new Set(readArchive(room.roomCode).map(record => record.matchId));

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

  // MATCH LEDGER: a judged attempt made before the crash must survive it.
  const preGuessSeen = waitForMessage(host, m => m.type === 'chat:update' && m.messages?.some(x => x.text === 'PRE CRASH GUESS'), 'pre-crash guess');
  player.send(JSON.stringify({ type: 'chat:guess', text: 'PRE CRASH GUESS' }));
  const preGuessId = (await preGuessSeen).messages.find(x => x.text === 'PRE CRASH GUESS').id;
  const preJudged = waitForMessage(host, m => m.type === 'gm:judge:ack', 'pre-crash judge ack');
  host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId: preGuessId, verdict: 'wrong' }));
  await preJudged;
  await delay(100);

  const wonBeforeCrash = waitForMessage(host, m => m.type === 'state:public' && m.gameWon === true, 'game won before crash');
  host.send(JSON.stringify({ type: 'gm:gameWon' }));
  await wonBeforeCrash;

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
  assert.equal(state.gameWon, true, 'GAME WON must survive a server crash/restart');
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

  const completedAfterRestart = waitForMessage(host2, m => m.type === 'state:public' && m.gameComplete === true, 'game complete after restart');
  for (const column of ['A', 'B', 'C', 'D']) host2.send(JSON.stringify({ type: 'gm:failColumn', column }));
  host2.send(JSON.stringify({ type: 'gm:failFinal' }));
  await completedAfterRestart;
  const restoredArchive = readArchive(room.roomCode).filter(record => !preexistingArchiveIds.has(record.matchId));
  assert.equal(restoredArchive.length, 1);
  assert.ok(
    restoredArchive[0].attempts.some(x => x.textKey === 'pre crash guess' && x.verdict === 'wrong'),
    'the pre-crash judged attempt must survive a restart in the match ledger'
  );

  console.log('PASS session crash recovery');

  closeWs(player2);
  closeWs(host2);
  return restarted;
}

async function testUnarmedMasterRoomRecovery(server) {
  const host = await openWs();
  const room = await createRoom(host);
  const womfZero = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 0, 'unarmed recovery WOMF baseline');
  host.send(JSON.stringify({ type: 'gm:womfReset' }));
  await womfZero;

  const player = await openWs();
  const joined = waitForMessage(player, m => m.type === 'join:success', 'unarmed recovery player join');
  player.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, name: 'UNARMED RECOVERY' }));
  await joined;

  const womfCharged = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 1, 'unarmed recovery WOMF charge');
  host.send(JSON.stringify({ type: 'gm:failColumn', column: 'A' }));
  await womfCharged;

  const idleState = waitForMessage(player, m => m.type === 'state:public' && m.armed === false, 'unarmed recovery disarm state');
  const disarmedAck = waitForMessage(host, m => m.type === 'room:casual', 'unarmed recovery disarm ack');
  host.send(JSON.stringify({ type: 'room:close' }));
  const [idle] = await Promise.all([idleState, disarmedAck]);
  assert.equal(idle.womf.charge, 1, 'WOMF survives transition into the unarmed Master Room');

  await delay(400);
  const text = 'UNARMED CHAT SURVIVES SERVER RESTART';
  const chatSeen = waitForMessage(player, m => m.type === 'chat:update' && m.messages?.some(x => x.text === text), 'unarmed recovery chat');
  player.send(JSON.stringify({ type: 'chat:guess', text }));
  const sentChat = await chatSeen;
  assert.equal(sentChat.messages.find(x => x.text === text)?.adjudicable, false);

  await new Promise(resolve => {
    server.once('exit', resolve);
    server.kill();
  });

  const restarted = await startServer();
  await setupAuth();

  const player2 = await openWs();
  const restoredState = waitForMessage(
    player2,
    m => m.type === 'state:public' && m.armed === false && m.womf?.charge === 1,
    'restored unarmed Master Room state'
  );
  const restoredChat = waitForMessage(
    player2,
    m => m.type === 'chat:update' && m.messages?.some(x => x.text === text),
    'restored unarmed Master Room chat'
  );
  const rejoined = waitForMessage(player2, m => m.type === 'join:success', 'restored unarmed player join');
  player2.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, name: 'UNARMED RECOVERY' }));

  const [state, chat, joinAck] = await Promise.all([restoredState, restoredChat, rejoined]);
  assert.equal(state.roomCode, 'MASTER');
  assert.equal(joinAck.roomCode, 'MASTER');
  assert.equal(chat.messages.find(x => x.text === text)?.adjudicable, false, 'restored unarmed chat remains archival');
  console.log('PASS unarmed Master Room survives server restart with chat + WOMF intact');

  closeWs(player2);
  return restarted;
}

// CRASH-INJECTION PERSISTENCE: five authoritative mutations are each forced to
// the recovery snapshot, then the server is hard-killed and restarted. Every
// one of them must be back: (1) a judged correct column verdict + solved target
// + scoring event, (2) FAIL actions (WOMF charge + failed-column tags),
// (3) the Wheel left OPEN, (4) a live Blood Tribute demand, (5) a GAME LOST
// terminal state (timer-authoritative). The second restart re-verifies the
// terminal state plus the crushing reality that a Tribute debt never dies.
async function testCrashInjectionPersistence(server) {
  const opened = [];
  let restarted = null;
  let restarted2 = null;
  let ok = false;
  try {
  const host = await openWs();
  opened.push(host);
  const room = await createRoom(host);

  const womfZero = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 0, 'crash injection WOMF baseline');
  host.send(JSON.stringify({ type: 'gm:womfReset' }));
  await womfZero;

  const crashCredentials = { email: `crash-${process.pid}@asoc.test`, password: 'test-player-password', name: 'CRASH TWO' };
  let crashAuth = await requestJson('/api/auth/player/register', 'POST', crashCredentials);
  if (crashAuth.status === 400) crashAuth = await requestJson('/api/auth/player/login', 'POST', crashCredentials);
  assert.ok(crashAuth.status === 200 || crashAuth.status === 201);

  const p1 = await openWs();
  opened.push(p1);
  const p2 = await openWs();
  opened.push(p2);
  const p1Join = waitForMessage(p1, m => m.type === 'join:success', 'crash player one join');
  p1.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, roomCode: room.roomCode, name: 'CRASH PLAYER' }));
  const one = await p1Join;
  const p2Join = waitForMessage(p2, m => m.type === 'join:success', 'crash player two join');
  p2.send(JSON.stringify({ type: 'room:join', authToken: crashAuth.data.token, roomCode: room.roomCode, name: 'CRASH TWO' }));
  const two = await p2Join;

  const failBatches = async (expectCharge, label) => {
    const charged = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === expectCharge, label);
    host.send(JSON.stringify({ type: 'gm:failColumn', column: 'B' }));
    host.send(JSON.stringify({ type: 'gm:failColumn', column: 'D' }));
    host.send(JSON.stringify({ type: 'gm:failFinal' }));
    await charged;
  };

  // FAIL batch #1: B,D (+2) then FINAL (+3) => WOMF 5/10.
  await failBatches(5, 'crash WOMF 5 after first FAIL batch');
  const resetKeptCharge = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 5, 'crash reset keeps WOMF charge');
  host.send(JSON.stringify({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId: 6001 }));
  await resetKeptCharge;
  // FAIL batch #2: B,D (+2) then FINAL (+3) => WOMF 10/10, Wheel can open.
  await failBatches(10, 'crash WOMF 10 after second FAIL batch');
  await startBattle(host);

  // A judged correct column verdict + solved target + scoring event.
  const guessSeen = waitForMessage(host, m => m.type === 'chat:update' && m.messages?.some(x => x.text === 'CRASH VERDICT SURVIVES'), 'crash verdict guess chat');
  p1.send(JSON.stringify({ type: 'chat:guess', text: 'CRASH VERDICT SURVIVES' }));
  const guessId = (await guessSeen).messages.find(x => x.text === 'CRASH VERDICT SURVIVES').id;
  const judged = waitForMessage(host, m => m.type === 'gm:judge:ack' && m.messageId === guessId, 'crash verdict judged');
  host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId: guessId, verdict: 'correct', target: 'C' }));
  await judged;

  // Wheel OPEN (the armed wheel itself must survive) and then ROLL -> result.
  const wheelOpened = waitForMessage(host, m => m.type === 'state:public' && m.wheel?.open === true, 'crash wheel open');
  host.send(JSON.stringify({ type: 'gm:wheelOpen', segments: ['REGRESSION TEST', 'CRASH TWO'] }));
  await wheelOpened;

  const resultPromise = waitForMessage(
    host,
    m => m.type === 'state:public' && m.wheel?.phase === 'result' && m.bloodTribute?.status === 'idle',
    'crash wheel result before tribute demand',
    7000
  );
  host.send(JSON.stringify({ type: 'gm:wheelRoll' }));
  const visibleResult = await resultPromise;
  assert.equal(visibleResult.womf.charge, 10);
  assert.equal(visibleResult.bloodTribute.status, 'idle', 'selected player must see the wheel result before Blood Tribute opens');

  const tributePromise = waitForMessage(
    host,
    m => m.type === 'state:public' && m.wheel?.open === false && m.bloodTribute?.status === 'required',
    'crash tribute demand after WOMF dismissal'
  );
  host.send(JSON.stringify({ type: 'gm:wheelClose' }));
  const result = await tributePromise;
  assert.ok(result.bloodTribute.playerId === one.playerId || result.bloodTribute.playerId === two.playerId,
    'the dismissed wheel winner becomes the tribute debtor');

  // ---- CRASH #1 -----------------------------------------------------------
  await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  restarted = await startServer();
  await setupAuth();

  // The durable recovery store (the same file the new instance restores from)
  // proves the conservative state survived, independent of what public shapes
  // choose to expose.
  const persistedAfterCrash = JSON.parse(fs.readFileSync(TEST_SESSION, 'utf8')).rooms.find(r => r.code === 'MASTER');
  assert.equal(persistedAfterCrash.chat.solvedTargets.C?.messageId, guessId, 'solved target C survives the crash');
  assert.deepEqual(persistedAfterCrash.womf.failedColumns, { B: true, D: true }, 'failed-column tags survive the crash');
  assert.equal(persistedAfterCrash.wheel.open, true, 'an open Wheel survives the crash');
  assert.equal(persistedAfterCrash.wheel.phase, 'result', 'the settled spin phase survives the crash');
  assert.equal(persistedAfterCrash.pendingTribute?.status, 'required', 'the Tribute demand survives the crash');
  assert.equal(persistedAfterCrash.pendingTribute?.playerId, result.bloodTribute.playerId, 'the Tribute debtor survives the crash');
  assert.equal(persistedAfterCrash.womf.charge, 10, 'WOMF 10/10 survives the crash');

  const host2 = await openWs();
  opened.push(host2);
  const statePromise = waitForMessage(host2, m => m.type === 'state:public', 'crash-recovered state');
  const chatPromise = waitForMessage(host2, m => m.type === 'chat:update', 'crash-recovered chat');
  const reconnectPromise = waitForMessage(host2, m => m.type === 'host:reconnected', 'crash-recovered host reconnect');
  host2.send(JSON.stringify({ type: 'host:reconnect', roomCode: room.roomCode, hostToken: room.hostToken, gmToken: TEST_GM_TOKEN }));
  const [state, chat] = await Promise.all([statePromise, chatPromise, reconnectPromise]).then(values => values.slice(0, 2));

  const verdictMessage = chat.messages.find(x => x.id === guessId);
  assert.ok(verdictMessage, 'the judged message survives the crash');
  assert.equal(verdictMessage.verdict, 'correct');
  assert.equal(verdictMessage.target, 'C');
  assert.equal(verdictMessage.adjudicable, true, 'a current-board verdict stays adjudicable');

  assert.equal(state.womf.charge, 10, 'WOMF 10/10 surfaces in public state after the crash');
  assert.equal(state.wheel.open, true, 'an open Wheel surfaces in public state after the crash');
  assert.equal(state.wheel.phase, 'result', 'the settled spin phase surfaces in public state after the crash');
  assert.equal(state.bloodTribute.status, 'required');
  assert.equal(state.bloodTribute.playerId, result.bloodTribute.playerId, 'the Tribute debtor is still the same player');

  // (5) GAME LOST via the authoritative timer, then a second crash. Drain
  // WOMF below the meter cap first so the loss's +3 charge is observable
  // (the meter itself caps at 10/10; 7 + 3 = 10 proves the +3 applied).
  const womfDrained = waitForMessage(host2, m => m.type === 'state:public' && m.womf?.charge === 7, 'crash-test WOMF drained to 7');
  host2.send(JSON.stringify({ type: 'gm:womfSubtract' }));
  host2.send(JSON.stringify({ type: 'gm:womfSubtract' }));
  host2.send(JSON.stringify({ type: 'gm:womfSubtract' }));
  await womfDrained;

  const borrowed = waitForMessage(host2, m => m.type === 'state:public' && m.timer?.phase === 'borrowed', 'crash-test borrowed transition');
  host2.send(JSON.stringify({ type: 'gm:timerAdjust', deltaMs: -99 * 60 * 1000 }));
  await borrowed;
  const hostLost = waitForMessage(host2, m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'crash-test GAME LOST', 5000);
  host2.send(JSON.stringify({ type: 'gm:timerAdjust', deltaMs: -99 * 60 * 1000 }));
  const lostState = await hostLost;
  assert.equal(lostState.womf.charge, 10, 'GAME LOST charges WOMF +3 (7/10 -> 10/10)');

  // ---- CRASH #2 -----------------------------------------------------------
  await new Promise(resolve => { restarted.once('exit', resolve); restarted.kill(); });
  restarted2 = await startServer();
  await setupAuth();

  const host3 = await openWs();
  opened.push(host3);
  const lostAgainPromise = waitForMessage(host3, m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'terminal LOST after second crash');
  host3.send(JSON.stringify({ type: 'host:reconnect', roomCode: room.roomCode, hostToken: room.hostToken, gmToken: TEST_GM_TOKEN }));
  const lostAgain = await lostAgainPromise;
  assert.equal(lostAgain.womf.charge, 10, 'GAME LOST + its WOMF charge survive a second crash');
  assert.equal(lostAgain.bloodTribute.status, 'required', 'an unresolved Tribute debt survives a second crash');
  assert.equal(lostAgain.gameComplete, true);

  console.log('PASS crash injection: verdict, FAIL/WOMF, wheel open+result, tribute debt, and GAME LOST all survive kill+restart');

  closeWs(host3);
  closeWs(host2);
  closeWs(p1);
  closeWs(p2);
  closeWs(host);
  ok = true;
  return restarted2;
  } finally {
    if (!ok) {
      for (const sock of opened) closeWs(sock);
      if (restarted2) { try { restarted2.kill(); } catch (_) {} }
      if (restarted) { try { restarted.kill(); } catch (_) {} }
    }
  }
}

async function testBloodTributeLifecycle() {
  const host = await openWs();
  const room = await createRoom(host);
  // WOMF is intentionally global Master Room state, so this test establishes
  // its own baseline instead of assuming previous scenarios left it at zero.
  const womfZero = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 0, 'tribute WOMF baseline');
  host.send(JSON.stringify({ type: 'gm:womfReset' }));
  await womfZero;

  const secondCredentials = {
    email: `tribute-${process.pid}@asoc.test`,
    password: 'test-player-password',
    name: 'TRIBUTE TWO'
  };
  let secondAuth = await requestJson('/api/auth/player/register', 'POST', secondCredentials);
  if (secondAuth.status === 400) secondAuth = await requestJson('/api/auth/player/login', 'POST', secondCredentials);
  assert.ok(secondAuth.status === 200 || secondAuth.status === 201);

  const p1 = await openWs();
  const p2 = await openWs();
  const p1Join = waitForMessage(p1, m => m.type === 'join:success', 'tribute player one join');
  p1.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, roomCode: room.roomCode, name: 'TRIBUTE ONE' }));
  const one = await p1Join;

  const p2Join = waitForMessage(p2, m => m.type === 'join:success', 'tribute player two join');
  p2.send(JSON.stringify({ type: 'room:join', authToken: secondAuth.data.token, roomCode: room.roomCode, name: 'TRIBUTE TWO' }));
  const two = await p2Join;

  async function failColumnsToCharge(columns, target) {
    const charged = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === target, `WOMF ${target}/10`);
    for (const column of columns) host.send(JSON.stringify({ type: 'gm:failColumn', column }));
    await charged;
  }

  async function resetBoard(cmdId, expectedCharge) {
    const state = waitForMessage(
      host,
      m => m.type === 'state:public' && m.womf?.charge === expectedCharge,
      `board reset at ${expectedCharge}/10`,
      7000
    );
    host.send(JSON.stringify({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId }));
    await state;
  }

  await failColumnsToCharge(['A', 'B', 'C', 'D'], 4);
  await resetBoard(7001, 4);
  await failColumnsToCharge(['A', 'B', 'C', 'D'], 8);
  await resetBoard(7002, 8);
  await failColumnsToCharge(['A', 'B'], 10);

  const wheelOpened = waitForMessage(host, m => m.type === 'state:public' && m.wheel?.open === true, 'tribute wheel open');
  host.send(JSON.stringify({ type: 'gm:wheelOpen', segments: ['REGRESSION TEST', 'TRIBUTE TWO'] }));
  await wheelOpened;

  const resultPromise = waitForMessage(
    host,
    m => m.type === 'state:public' && m.wheel?.phase === 'result' && m.bloodTribute?.status === 'idle',
    'tribute wheel result before dismissal',
    7000
  );
  host.send(JSON.stringify({ type: 'gm:wheelRoll' }));
  const visibleResult = await resultPromise;
  assert.equal(visibleResult.womf.charge, 10);
  assert.equal(visibleResult.bloodTribute.status, 'idle');

  const tributePromise = waitForMessage(
    host,
    m => m.type === 'state:public' && m.wheel?.open === false && m.bloodTribute?.status === 'required',
    'tribute demand after result dismissal'
  );
  host.send(JSON.stringify({ type: 'gm:wheelClose' }));
  const result = await tributePromise;
  assert.ok(result.bloodTribute.playerId === one.playerId || result.bloodTribute.playerId === two.playerId);

  const selected = result.bloodTribute.playerId === one.playerId ? p1 : p2;

  // KILL SESSION must not erase an already-demanded Blood Tribute. The debt
  // belongs to the Master Room, not to the disposable gameplay surface.
  const tributeIdle = waitForMessage(
    selected,
    m => m.type === 'state:public' && m.armed === false && m.bloodTribute?.status === 'required',
    'tribute survives KILL SESSION'
  );
  const tributeDisarmed = waitForMessage(host, m => m.type === 'room:casual', 'tribute session disarm');
  host.send(JSON.stringify({ type: 'room:close' }));
  const [idleTribute] = await Promise.all([tributeIdle, tributeDisarmed]);
  assert.equal(idleTribute.bloodTribute.playerId, result.bloodTribute.playerId);
  assert.equal(idleTribute.womf.charge, 10);

  const tributeRearmed = waitForMessage(
    selected,
    m => m.type === 'state:public' && m.armed === true && m.bloodTribute?.status === 'required',
    'tribute survives ARM GAME'
  );
  await createRoom(host);
  const activeTribute = await tributeRearmed;
  assert.equal(activeTribute.bloodTribute.playerId, result.bloodTribute.playerId);
  assert.equal(activeTribute.womf.charge, 10);

  const imageData = 'data:image/png;base64,iVBORw0KGgo=';
  const acceptedPromise = waitForMessage(selected, m => m.type === 'tribute:accepted', 'tribute accepted');
  const resetPromise = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === 0 && m.wheel?.open === false, 'WOMF reset after tribute');
  const vaultPromise = waitForMessage(host, m => m.type === 'tribute:vault' && m.tributes?.length === 1, 'private tribute vault');
  const publicChatPromise = waitForMessage(selected, m => m.type === 'chat:update' && m.messages?.some(x => x.source === 'bloodTribute'), 'public tribute chat');

  selected.send(JSON.stringify({ type: 'tribute:submit', imageData, retentionAcknowledged: true }));
  const [accepted, resetState, vault, publicChat] = await Promise.all([acceptedPromise, resetPromise, vaultPromise, publicChatPromise]);

  assert.ok(Number(accepted.publicUntil) > Date.now());
  assert.equal(resetState.bloodTribute.status, 'idle');
  assert.equal(Object.prototype.hasOwnProperty.call(resetState, 'bloodTributes'), false);
  assert.equal(vault.tributes[0].imageData, imageData);
  assert.equal(vault.tributes[0].publicUntil - vault.tributes[0].submittedAt, 120000);
  const publicTribute = publicChat.messages.find(x => x.source === 'bloodTribute');
  assert.equal(publicTribute.imageData, imageData);
  assert.equal(publicTribute.publicUntil, vault.tributes[0].publicUntil);

  console.log('PASS Blood Tribute lifecycle');
  closeWs(p1);
  closeWs(p2);
  closeWs(host);
}

async function testTributeForgive(server) {
  const opened = [];
  let restarted = null;
  let ok = false;
  try {
    const host = await openWs();
    opened.push(host);
    const room = await createRoom(host);

    // The Master Room is shared, in-order state across every test in this
    // suite. Start defensively clean: release any leftover Tribute debt from
    // a predecessor (no-op if none is owed -- yet ARM KILL deliberately keeps
    // the debt, and an outstanding demand blocks a forward roll), clear WOMF,
    // and record how many override lines already exist so the restart check
    // later proves OUR override persisted rather than someone else's.
    const baselineOverrides = (() => {
      try {
        return (JSON.parse(fs.readFileSync(TEST_SESSION, 'utf8')).rooms.find(r => r.code === 'MASTER')?.chat?.messages || [])
          .filter(m => m.text === 'BLOOD TRIBUTE OVERRIDDEN BY SHADOW BROKER').length;
      } catch { return 0; }
    })();
    const cleanSlate = waitForMessage(host, m => m.type === 'state:public' && m.bloodTribute?.status !== 'required' && m.womf?.charge === 0, 'forgive clean slate', 5000);
    host.send(JSON.stringify({ type: 'gm:tributeForgive' }));
    host.send(JSON.stringify({ type: 'gm:womfReset' }));
    await cleanSlate;
    // Purge the vault too: an earlier test archived a real tribute, and this
    // test must prove forgiveness adds NOTHING to the vault.
    const vaultPurged = waitForMessage(host, m => m.type === 'tribute:vault' && (m.tributes || []).length === 0, 'forgive vault purged');
    host.send(JSON.stringify({ type: 'gm:tributeVaultClear' }));
    await vaultPurged;

    const secondCredentials = {
      email: `forgive-${process.pid}@asoc.test`,
      password: 'test-player-password',
      name: 'FORGIVE TWO'
    };
    let secondAuth = await requestJson('/api/auth/player/register', 'POST', secondCredentials);
    if (secondAuth.status === 400) secondAuth = await requestJson('/api/auth/player/login', 'POST', secondCredentials);
    assert.ok(secondAuth.status === 200 || secondAuth.status === 201);

    const p1 = await openWs();
    opened.push(p1);
    const p2 = await openWs();
    opened.push(p2);
    const p1Join = waitForMessage(p1, m => m.type === 'join:success', 'forgive player one join');
    p1.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, roomCode: room.roomCode, name: 'FORGIVE ONE' }));
    const one = await p1Join;
    const p2Join = waitForMessage(p2, m => m.type === 'join:success', 'forgive player two join');
    p2.send(JSON.stringify({ type: 'room:join', authToken: secondAuth.data.token, roomCode: room.roomCode, name: 'FORGIVE TWO' }));
    const two = await p2Join;

    async function failColumnsToCharge(columns, target) {
      const charged = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === target, `forgive WOMF ${target}/10`);
      for (const column of columns) host.send(JSON.stringify({ type: 'gm:failColumn', column }));
      await charged;
    }
    async function resetBoard(cmdId, expectedCharge) {
      const state = waitForMessage(host, m => m.type === 'state:public' && m.womf?.charge === expectedCharge, `forgive board reset at ${expectedCharge}/10`, 7000);
      host.send(JSON.stringify({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId }));
      await state;
    }

    await failColumnsToCharge(['A', 'B', 'C', 'D'], 4);
    await resetBoard(8001, 4);
    await failColumnsToCharge(['A', 'B', 'C', 'D'], 8);
    await resetBoard(8002, 8);
    await failColumnsToCharge(['A', 'B'], 10);

    const wheelOpened = waitForMessage(host, m => m.type === 'state:public' && m.wheel?.open === true, 'forgive wheel open');
    host.send(JSON.stringify({ type: 'gm:wheelOpen', segments: ['REGRESSION TEST', 'FORGIVE TWO'] }));
    await wheelOpened;

    const demandPromise = waitForMessage(
      host,
      m => m.type === 'state:public' && m.wheel?.phase === 'result' && m.bloodTribute?.status === 'required',
      'forgive tribute demand',
      7000
    );
    host.send(JSON.stringify({ type: 'gm:wheelRoll' }));
    const demand = await demandPromise;
    assert.equal(demand.womf.charge, 10);
    assert.ok(demand.bloodTribute.playerId === one.playerId || demand.bloodTribute.playerId === two.playerId);

    // (1) A linked Little Hero cannot clear the debt -- the override is
    //     host-only, so the player gets an error and the demand stays.
    const playerBlocked = waitForMessage(p1, m => m.type === 'error', 'player blocked from forgiving');
    p1.send(JSON.stringify({ type: 'gm:tributeForgive' }));
    const playerErr = await playerBlocked;
    assert.ok(/Only host/.test(playerErr.message || ''), 'non-host forgive attempt is rejected');

    // (2) An unauthenticated, un-joined socket cannot reconcile either.
    const stranger = await openWs();
    opened.push(stranger);
    const strangerBlocked = waitForMessage(stranger, m => m.type === 'error', 'stranger blocked from forgiving');
    stranger.send(JSON.stringify({ type: 'gm:tributeForgive' }));
    const strangerErr = await strangerBlocked;
    assert.ok(/Room not found/.test(strangerErr.message || ''), 'un-joined forgive attempt is rejected');

    // (3) The GM override itself: debt released, no vault entry, WOMF kept
    //     at 10, Wheel untouched, and a permanent Broker override line.
    const forgivenStatePromise = waitForMessage(host, m => m.type === 'state:public' && m.bloodTribute?.status === 'idle', 'forgiven state');
    const overrideChatPromise = waitForMessage(host, m => m.type === 'chat:update' && m.messages?.some(x => x.source === 'shadowBroker' && x.text === 'BLOOD TRIBUTE OVERRIDDEN BY SHADOW BROKER'), 'forgive override chat line');
    const vaultPromise = waitForMessage(host, m => m.type === 'tribute:vault', 'forgive vault refresh');
    host.send(JSON.stringify({ type: 'gm:tributeForgive' }));
    const [forgiven, overrideChat, vault] = await Promise.all([forgivenStatePromise, overrideChatPromise, vaultPromise]);

    assert.equal(forgiven.bloodTribute.status, 'idle');
    assert.equal(forgiven.womf.charge, 10, 'forgiveness is not payment: WOMF stays 10/10');
    assert.equal(forgiven.wheel.open, true, 'Wheel stays open after forgiveness');
    assert.equal(forgiven.wheel.phase, 'result');
    assert.equal(Array.isArray(vault.tributes) ? vault.tributes.length : 0, 0, 'no tribute is archived by forgiveness');

    // (4) The Wheel is fully operable again: it rolls a fresh demand we then
    //     release the exact same way.
    const secondDemandPromise = waitForMessage(
      host,
      m => m.type === 'state:public' && m.wheel?.phase === 'result' && m.bloodTribute?.status === 'required',
      'forgive second demand',
      7000
    );
    host.send(JSON.stringify({ type: 'gm:wheelRoll' }));
    const secondDemand = await secondDemandPromise;
    assert.ok(secondDemand.bloodTribute.playerId === one.playerId || secondDemand.bloodTribute.playerId === two.playerId);
    const secondForgiven = waitForMessage(host, m => m.type === 'state:public' && m.bloodTribute?.status === 'idle', 'second forgiven state');
    host.send(JSON.stringify({ type: 'gm:tributeForgive' }));
    await secondForgiven;

    // (5) Durability: kill the server; the forgiven state returns untouched.
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    restarted = await startServer();
    await setupAuth();

    const persisted = JSON.parse(fs.readFileSync(TEST_SESSION, 'utf8')).rooms.find(r => r.code === 'MASTER');
    assert.equal(persisted.pendingTribute ?? null, null, 'no tribute demand survives the restart after forgiveness');
    assert.equal(persisted.womf.charge, 10, 'the forgiven charge survives the restart');
    assert.ok(persisted.chat.messages.filter(m => m.source === 'shadowBroker' && m.text === 'BLOOD TRIBUTE OVERRIDDEN BY SHADOW BROKER').length === baselineOverrides + 3, 'the override lines (clean-slate + 2 releases) all survive the restart');

    const host2 = await openWs();
    opened.push(host2);
    const reconnected = waitForMessage(host2, m => m.type === 'state:public' && m.bloodTribute?.status !== undefined, 'forgive survived restart');
    const reconnect = waitForMessage(host2, m => m.type === 'host:reconnected', 'forgive host reconnect after restart');
    host2.send(JSON.stringify({ type: 'host:reconnect', roomCode: room.roomCode, hostToken: room.hostToken, gmToken: TEST_GM_TOKEN }));
    const [reconnectedState] = await Promise.all([reconnected, reconnect]);
    assert.equal(reconnectedState.bloodTribute.status, 'idle', 'no debt resurfaces after the restart');
    assert.equal(reconnectedState.womf.charge, 10);

    console.log('PASS GM tribute forgive: host-only, no vault entry, WOMF kept, wheel re-operable, survives restart');
    closeWs(host2);
    closeWs(p1);
    closeWs(p2);
    closeWs(host);
    closeWs(stranger);
    ok = true;
    return restarted;
  } finally {
    if (!ok) {
      for (const sock of opened) closeWs(sock);
      if (restarted) { try { restarted.kill(); } catch (_) {} }
    }
  }
}

async function testMatchCaptureAndCompletion() {
  const host = await openWs();
  const room = await createRoom(host);
  const preexistingArchiveIds = new Set(readArchive(room.roomCode).map(record => record.matchId));
  const readThisTestArchive = () => readArchive(room.roomCode).filter(record => !preexistingArchiveIds.has(record.matchId));

  const player = await openWs();
  const firstState = waitForMessage(player, m => m.type === 'state:public', 'match capture initial state');
  const joined = waitForMessage(player, m => m.type === 'join:success', 'match capture join');
  player.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, roomCode: room.roomCode, name: 'MATCH CAPTURE' }));
  await joined;
  assert.equal((await firstState).gameComplete, false, 'a fresh board is not complete');

  let cmdId = 8000;
  const stateWhere = (predicate, label) =>
    waitForMessage(host, m => m.type === 'state:public' && predicate(m), label);
  const command = name =>
    host.send(JSON.stringify({ type: 'gm:command', command: name, payload: {}, cmdId: ++cmdId }));
  async function guess(text) {
    await delay(400); // Battle Comms cooldown
    const seen = waitForMessage(host, m => m.type === 'chat:update' && m.messages?.some(x => x.text === text), `guess "${text}"`);
    player.send(JSON.stringify({ type: 'chat:guess', text }));
    return (await seen).messages.filter(x => x.text === text).at(-1).id;
  }
  async function judge(messageId, verdict, target) {
    const ack = waitForMessage(host, m => m.type === 'gm:judge:ack' && m.messageId === messageId, 'judge ack');
    host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId, verdict, target }));
    await ack;
  }
  async function fail(field) {
    const next = waitForMessage(host, m => m.type === 'state:public', `fail ${field}`);
    host.send(JSON.stringify(field === 'FINAL' ? { type: 'gm:failFinal' } : { type: 'gm:failColumn', column: field }));
    return next;
  }

  // ---- Scenario A: A solved, B/C/D/FINAL failed -> complete only at the last field.
  await guess('just thinking out loud');                    // unjudged: activity, NOT an attempt
  const solvedId = await guess('column a answer');
  await judge(solvedId, 'correct', 'A');
  const wrongId = await guess('a wrong answer');
  await judge(wrongId, 'wrong');
  for (const column of ['B', 'C', 'D']) {
    assert.equal((await fail(column)).gameComplete, false, `four fields done is not the end (after ${column})`);
  }
  const completedA = stateWhere(m => m.gameComplete === true, 'complete after the fifth field');
  host.send(JSON.stringify({ type: 'gm:failFinal' }));
  await completedA;

  let archive = readThisTestArchive();
  assert.equal(archive.length, 1, 'completion archives exactly one match');
  const a = archive[0];
  assert.equal(a.fields.A.status, 'solved');
  for (const field of ['B', 'C', 'D', 'FINAL']) assert.equal(a.fields[field].status, 'failed');
  assert.equal(a.gameWon, false, 'a failed Final is not a victory');
  const me = a.players.find(p => p.name === 'REGRESSION TEST');
  assert.ok(me, 'the participant is in the archive');
  assert.deepEqual(me.judged, { total: 2, correct: 1, wrong: 1 }, 'only GM-judged messages are attempts');
  assert.equal(me.messages, 3, 'unjudged chatter is counted as activity');
  assert.equal(me.matchPoints, -200, 'this match only: the failed-Final penalty (column A had no clues to score)');
  assert.ok(a.attempts.some(x => x.textKey === 'a wrong answer' && x.verdict === 'wrong' && x.target === null));
  const standing = a.standings.find(s => s.key === TEST_PLAYER_ID);
  assert.ok(standing, 'standings are captured for participants');
  assert.equal(standing.lifetimeAfter - standing.lifetimeBefore, -200);

  // RESET BOARD clears completion but KEEPS the archived completed match.
  const cleared = stateWhere(m => m.gameComplete === false, 'reset clears completion');
  command('resetBoard');
  await cleared;
  assert.equal(readThisTestArchive().length, 1, 'a reset never deletes a completed match');

  // ---- Scenario B: the WHOLE FIELD OPENED ends the game, however it got opened,
  //      and hiding a slot re-opens it. (Victory is separate: opening the field
  //      never sets gameWon.)
  const openedAll = stateWhere(m => m.gameComplete === true, 'whole field opened by REVEAL ALL');
  command('revealAll');
  const openedState = await openedAll;
  assert.equal(openedState.gameWon, false, 'opening the field is not a host-declared victory');
  archive = readThisTestArchive();
  assert.equal(archive.length, 2);
  const openedRecord = archive.find(r => r.fields.A.status === 'revealed');
  assert.ok(openedRecord, 'plainly opened fields are archived as revealed');
  for (const field of ['A', 'B', 'C', 'D', 'FINAL']) assert.equal(openedRecord.fields[field].status, 'revealed');
  const hiddenAgain = stateWhere(m => m.gameComplete === false, 'hide all re-opens the field');
  command('hideAll');
  await hiddenAgain;
  assert.equal(readThisTestArchive().length, 1, 'a re-opened match is withdrawn from the archive');
  const cleared2 = stateWhere(m => m.finalSolution?.revealed !== true, 'reset for the early-final scenario');
  command('resetBoard');
  await cleared2;
  await startBattle(host);

  const finalId = await guess('the final answer');
  await judge(finalId, 'correct', 'FINAL');
  // The Final accepted first is NOT the end -- columns are still open -- and
  // it is not a host-declared victory either.
  for (const column of ['A', 'B', 'C']) {
    const state = await fail(column);
    assert.equal(state.gameComplete, false, `still open after failing ${column}`);
    assert.equal(state.gameWon, false, 'accepting the Final never declares victory');
  }
  const completedB = stateWhere(m => m.gameComplete === true, 'complete on the last column');
  host.send(JSON.stringify({ type: 'gm:failColumn', column: 'D' }));
  await completedB;

  archive = readThisTestArchive();
  assert.equal(archive.length, 2);
  const b = archive.find(r => r.fields.FINAL.status === 'solved');
  assert.ok(b, 'the second match has a solved FINAL');
  assert.equal(b.gameWon, false, 'the archive records victory only when the host declared it');
  for (const field of ['A', 'B', 'C', 'D']) assert.equal(b.fields[field].status, 'failed');

  // ---- Reversing the accepted Final re-opens the match and withdraws its archive record...
  const reopened = stateWhere(m => m.gameComplete === false, 'reversal re-opens the match');
  await judge(finalId, 'wrong');
  await reopened;
  assert.equal(readThisTestArchive().length, 1, 'a re-opened match is withdrawn from the archive');

  // ...and re-accepting it completes (and archives) it again.
  const completedAgain = stateWhere(m => m.gameComplete === true, 'complete again');
  await judge(finalId, 'correct', 'FINAL');
  await completedAgain;
  assert.equal(readThisTestArchive().length, 2);

  console.log('PASS match capture: five-field completion, judged-only attempts, archive');
  closeWs(player);
  closeWs(host);
}

async function testColumnScoreAfterFinal() {
  const host = await openWs();
  const room = await createRoom(host);

  const player = await openWs();
  const joined = waitForMessage(player, m => m.type === 'join:success', 'after-final player join');
  player.send(JSON.stringify({ type: 'room:join', authToken: TEST_PLAYER_TOKEN, roomCode: room.roomCode, name: 'AFTER FINAL' }));
  await joined;

  let lastScore = null;
  host.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'players:update') {
        const me = m.players.find(p => p.id === TEST_PLAYER_ID);
        if (me) lastScore = me.score;
      }
    } catch {}
  });

  let cmdId = 9000;
  async function reveal(cell) {
    // command:ack echoes cmdId; commands here are sequential.
    const ack = waitForMessage(host, m => m.type === 'command:ack', `reveal ${cell}`);
    host.send(JSON.stringify({ type: 'gm:command', command: 'revealCell', payload: { cell, reveal: true }, cmdId: ++cmdId }));
    await ack;
  }
  async function guess(text) {
    await delay(400); // Battle Comms cooldown
    const seen = waitForMessage(host, m => m.type === 'chat:update' && m.messages?.some(x => x.text === text), `guess "${text}"`);
    player.send(JSON.stringify({ type: 'chat:guess', text }));
    return (await seen).messages.filter(x => x.text === text).at(-1).id;
  }
  async function judge(messageId, verdict, target) {
    const ack = waitForMessage(host, m => m.type === 'gm:judge:ack' && m.messageId === messageId, 'judge ack');
    host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId, verdict, target }));
    await ack;
  }
  async function solveColumn(column, text) {
    const id = await guess(text);
    const award = waitForMessage(host, m => m.type === 'score:event' && m.target === column, `score for ${column}`);
    await judge(id, 'correct', column);
    return award;
  }

  // Column A is solved BEFORE the Final: full value (1 clue revealed = 400).
  await reveal('A1');
  const a = await solveColumn('A', 'column a answer');
  assert.equal(a.points, 400);
  assert.equal(a.afterFinal, false, 'a column solved before the Final scores in full');

  // The Final is solved (1 column known = 1200).
  const finalId = await guess('the final answer');
  await judge(finalId, 'correct', 'FINAL');

  // Column B is solved AFTER the Final: half of its 300 (2 clues revealed).
  await reveal('B1');
  await reveal('B2');
  const b = await solveColumn('B', 'column b answer');
  assert.equal(b.cluesRevealed, 2);
  assert.equal(b.points, 150, 'a column solved after the Final scores 50%');
  assert.equal(b.afterFinal, true);
  await delay(100);
  const scoreAfterB = lastScore;

  // Reversing the Final removes its 1200 AND restores B to its full 300 (+150).
  await judge(finalId, 'wrong');
  const scoreAfterReversal = lastScore;
  assert.equal(scoreAfterB - scoreAfterReversal, 1200 - 150, 'reversal restores the full column value');

  // Re-accepting the Final: 2 columns known = 800. B was solved BEFORE this
  // new Final solve, so it stays at its full value.
  await judge(finalId, 'correct', 'FINAL');
  assert.equal(lastScore - scoreAfterReversal, 800, 'columns solved before the (re-)accepted Final stay in full');

  // A FAILED Final does not make columns easier: full value.
  const cleared = waitForMessage(host, m => m.type === 'state:public' && m.finalSolution?.revealed !== true, 'reset for failed-final board');
  host.send(JSON.stringify({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId: ++cmdId }));
  await cleared;
  await startBattle(host);
  await reveal('C1');
  const failedFinal = waitForMessage(host, m => m.type === 'score:finalReveal', 'final failed reveal');
  host.send(JSON.stringify({ type: 'gm:failFinal' }));
  await failedFinal;
  const c = await solveColumn('C', 'column c answer');
  assert.equal(c.points, 400, 'a failed Final never halves a column');
  assert.equal(c.afterFinal, false);

  console.log('PASS column score is 50% once the Final is solved (and corrects with verdicts)');
  closeWs(player);
  closeWs(host);
}

async function testRecountShowFlow() {
  const host = await openWs();
  const room = await createRoom(host);

  const second = await requestJson('/api/auth/player/register', 'POST', {
    email: `recount-two-${process.pid}@asoc.test`, password: 'test-player-password', name: 'RECOUNT TWO'
  });
  assert.ok(second.status === 200 || second.status === 201);

  const p1 = await openWs();
  const p2 = await openWs();
  const join = async (ws, token, name) => {
    const ok = waitForMessage(ws, m => m.type === 'join:success', `${name} join`);
    ws.send(JSON.stringify({ type: 'room:join', authToken: token, roomCode: room.roomCode, name }));
    await ok;
  };
  await join(p1, TEST_PLAYER_TOKEN, 'RECOUNT ONE');
  await join(p2, second.data.token, 'RECOUNT TWO');

  // Record every recount:update and every leaked matchResult.recount per socket.
  const seen = new Map();
  [['host', host], ['p1', p1], ['p2', p2]].forEach(([label, ws]) => {
    seen.set(label, { recounts: [], leaks: 0, finalResults: 0 });
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        const s = seen.get(label);
        if (m.type === 'recount:update') s.recounts.push(m);
        if (m.type === 'score:finalResults') s.finalResults += 1;
        if (m.type === 'state:public' && m.matchResult && 'recount' in m.matchResult) s.leaks += 1;
      } catch {}
    });
  });

  let cmdId = 9500;
  const stateWhere = (predicate, label) => waitForMessage(host, m => m.type === 'state:public' && predicate(m), label);
  const command = name => host.send(JSON.stringify({ type: 'gm:command', command: name, payload: {}, cmdId: ++cmdId }));
  const nextError = (ws, pattern, label) => waitForMessage(ws, m => m.type === 'error' && pattern.test(m.message || ''), label);
  async function guess(ws, text) {
    await delay(400);
    const seenChat = waitForMessage(host, m => m.type === 'chat:update' && m.messages?.some(x => x.text === text), `guess "${text}"`);
    ws.send(JSON.stringify({ type: 'chat:guess', text }));
    return (await seenChat).messages.filter(x => x.text === text).at(-1).id;
  }
  async function judge(messageId, verdict, target) {
    const ack = waitForMessage(host, m => m.type === 'gm:judge:ack' && m.messageId === messageId, 'judge ack');
    host.send(JSON.stringify({ type: 'gm:judgeGuess', messageId, verdict, target }));
    await ack;
  }
  async function fail(field) {
    const next = waitForMessage(host, m => m.type === 'state:public', `fail ${field}`);
    host.send(JSON.stringify(field === 'FINAL' ? { type: 'gm:failFinal' } : { type: 'gm:failColumn', column: field }));
    return next;
  }

  // 1. Not over yet: the host cannot show it; a player never can.
  const early = nextError(host, /not over yet/i, 'RECOUNT before the game is over');
  host.send(JSON.stringify({ type: 'gm:showRecount' }));
  await early;
  const notHost = nextError(p1, /only host/i, 'non-host RECOUNT rejection');
  p1.send(JSON.stringify({ type: 'gm:showRecount' }));
  await notHost;

  // 2. Play a match: a scored solve, a wrong guess, then close out the field.
  const soloMsg = await guess(p1, 'a column answer');
  const revealAck = waitForMessage(host, m => m.type === 'command:ack', 'reveal A1');
  host.send(JSON.stringify({ type: 'gm:command', command: 'revealCell', payload: { cell: 'A1', reveal: true }, cmdId: ++cmdId }));
  await revealAck;
  await judge(soloMsg, 'correct', 'A');
  await judge(await guess(p2, 'a wrong answer'), 'wrong');
  for (const column of ['B', 'C', 'D']) await fail(column);
  const complete = stateWhere(m => m.gameComplete === true, 'game complete');
  host.send(JSON.stringify({ type: 'gm:failFinal' }));
  await complete;
  await delay(250);

  // 3. Completed, but NOTHING has been shown: no recount:update, no leak.
  for (const label of ['host', 'p1', 'p2']) {
    assert.equal(seen.get(label).recounts.length, 0, `${label}: RECOUNT must wait for the manual SHOW RESULTS`);
  }

  // 3b. The host decides when results are shown: an answer judged AFTER the
  //     game completed but BEFORE SHOW RESULTS must still count in the recount
  //     (it must not be frozen at the moment of completion).
  await judge(await guess(p2, 'a late wrong answer'), 'wrong');

  // 4. The host presses SHOW RESULTS: everyone gets the SAME recount, live, once,
  //    and the withheld Final penalty is released with it.
  const shown = ['host', 'p1', 'p2'].map(label => waitForMessage(
    label === 'host' ? host : label === 'p1' ? p1 : p2, m => m.type === 'recount:update' && m.recount, `${label} recount`));
  host.send(JSON.stringify({ type: 'gm:showRecount' }));
  const [hostMsg, p1Msg, p2Msg] = await Promise.all(shown);
  await delay(200);
  assert.equal(hostMsg.live, true);
  assert.deepEqual(p1Msg.recount, hostMsg.recount, 'every client receives the identical recount');
  assert.deepEqual(p2Msg.recount, hostMsg.recount);
  const rc = hostMsg.recount;
  assert.equal(rc.summary.complete, true);
  assert.ok(Array.isArray(rc.scoreboard) && rc.scoreboard.length >= 2);
  assert.ok(rc.scoreboard.some(r => r.name === 'REGRESSION TEST') && rc.scoreboard.some(r => r.name === 'RECOUNT TWO'));
  const two = rc.scoreboard.find(r => r.name === 'RECOUNT TWO');
  assert.deepEqual(two.judged, { total: 2, correct: 0, wrong: 2 }, 'answers judged after completion but before SHOW RESULTS are included');
  assert.ok(Array.isArray(rc.awards) && rc.awards.length <= 3);
  assert.ok(Array.isArray(rc.overall) && rc.overall.length >= 1);
  assert.ok(rc.topLabel === 'MATCH WINNER' || rc.topLabel === 'TOP PERFORMER');
  for (const label of ['host', 'p1', 'p2']) {
    assert.equal(seen.get(label).finalResults, 1, `${label}: the withheld Final results are released with the RECOUNT`);
    assert.equal(seen.get(label).leaks, 0, `${label}: the recount never leaks through state:public`);
  }

  // 5. Idempotent: a second SHOW RESULTS neither re-broadcasts nor regenerates.
  const before = seen.get('p1').recounts.length;
  host.send(JSON.stringify({ type: 'gm:showRecount' }));
  await delay(300);
  assert.equal(seen.get('p1').recounts.length, before, 'SHOW RESULTS is idempotent');

  // 6. A late joiner is hydrated with the SAME recount, NOT live (no replay).
  const third = await requestJson('/api/auth/player/register', 'POST', {
    email: `recount-three-${process.pid}@asoc.test`, password: 'test-player-password', name: 'RECOUNT THREE'
  });
  const p3 = await openWs();
  const hydrated = waitForMessage(p3, m => m.type === 'recount:update', 'late recount hydration');
  p3.send(JSON.stringify({ type: 'room:join', authToken: third.data.token, roomCode: room.roomCode, name: 'RECOUNT THREE' }));
  const lateMsg = await hydrated;
  assert.equal(lateMsg.live, false, 'hydration must never replay the live reveal');
  assert.deepEqual(lateMsg.recount, hostMsg.recount, 'a late joiner sees the very same recount');
  closeWs(p3);

  // 7. RESET BOARD ends the RECOUNT for everyone.
  const closed = waitForMessage(p1, m => m.type === 'recount:update' && m.recount === null, 'recount closed by reset');
  command('resetBoard');
  await closed;

  // 8. Opening the whole field completes the match; hiding a slot re-opens it
  //    and voids a shown RECOUNT.
  const opened = stateWhere(m => m.gameComplete === true, 'complete by REVEAL ALL');
  command('revealAll');
  await opened;
  const shownAgain = waitForMessage(p2, m => m.type === 'recount:update' && m.recount && m.live === true, 'second recount');
  host.send(JSON.stringify({ type: 'gm:showRecount' }));
  await shownAgain;
  const voided = waitForMessage(p2, m => m.type === 'recount:update' && m.recount === null, 'recount voided');
  command('hideAll');
  await voided;

  console.log('PASS RECOUNT: manual gate, host-only, live-once, hydration, void/reset, no leak');
  closeWs(p1); closeWs(p2); closeWs(host);
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
        ASOC_AUTH_FILE: TEST_AUTH_FILE,
        ASOC_PLAYER_AUTH_SESSIONS_FILE: TEST_PLAYER_AUTH_SESSIONS,
        ASOC_MATCHES_FILE: TEST_MATCHES,
        ASOC_GM_PASSWORD: 'test-gm-password',
        ASOC_EMAIL_VERIFICATION: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Test server did not start in time' + (stderr ? `: ${stderr}` : '')));
    }, 12000);

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
    // A recycled Windows PID must not inherit an auth database from an aborted
    // earlier regression run. Test isolation should not depend on municipal luck.
    try { fs.unlinkSync(TEST_AUTH_FILE); } catch {}
    try { fs.unlinkSync(TEST_AUTH_FILE + '.tmp'); } catch {}
    testShadowBrokerTiming();
    server = await startServer();
    await setupAuth();
    await testMasterRoomLifecycle();
    await testAuthEnforcement();
    await testStaticLockdown();
    await testReconnectIdentity();
    await testChatTransportHygiene();
    await testChatEmojiReactions();
    await testResetBroadcast();
    await testShadowBrokerControls();
    await testGameWonReward();
    await testAuthoritativeGameLost();
    await testBloodTributeLifecycle();
    await testMatchCaptureAndCompletion();
    await testColumnScoreAfterFinal();
    await testRecountShowFlow();
    server = await testCrashRecovery(server);
    server = await testUnarmedMasterRoomRecovery(server);
    server = await testCrashInjectionPersistence(server);
    server = await testTributeForgive(server);
    console.log('ALL ASOC REGRESSION TESTS PASSED');
  } catch (error) {
    console.error('TEST FAILURE:', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
    try { fs.unlinkSync(TEST_PLAYERS); } catch {}
    try { fs.unlinkSync(TEST_SESSION); } catch {}
    try { fs.unlinkSync(TEST_PLAYER_AUTH_SESSIONS); } catch {}
    try { fs.unlinkSync(TEST_PLAYER_AUTH_SESSIONS + '.tmp'); } catch {}
    try { fs.unlinkSync(TEST_AUTH_FILE); } catch {}
    try { fs.unlinkSync(TEST_AUTH_FILE + '.tmp'); } catch {}
    try { fs.unlinkSync(TEST_MATCHES); } catch {}
    try { fs.unlinkSync(TEST_MATCHES + '.bak'); } catch {}
  }
})();
