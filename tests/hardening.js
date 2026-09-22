const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { once } = require('events');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-hardening-'));
const PORT = 18600 + (process.pid % 500);
const TRIGGER = path.join(DATA, 'FAIL-DURABILITY');
const ACTIVE = path.join(DATA, 'active-rooms.json');
const PLAYERS = path.join(DATA, 'players.json');
let server = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(urlPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { ...(payload ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      } : {}), ...headers }
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function wait(ws, predicate, label = 'message', timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('Timed out waiting for ' + label));
    }, timeout);
    const onMessage = raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });
}

async function openWs(handshake = true) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const helloP = handshake ? wait(ws, m => m.type === 'protocol:hello', 'protocol hello') : null;
  await once(ws, 'open');
  if (!handshake) return ws;
  await helloP;
  const readyP = wait(ws, m => m.type === 'protocol:ready', 'protocol ready');
  ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
  await readyP;
  return ws;
}

async function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      ASOC_DATA_DIR: DATA,
      ASOC_GM_PASSWORD: 'hardening-gm-password',
      ASOC_EMAIL_VERIFICATION: '0',
      ASOC_TRUST_PROXY: '1',
      ASOC_GM_LOCKOUT_MS: '250',
      ASOC_WS_HANDSHAKE_TIMEOUT_MS: '250',
      ASOC_WHEEL_SPIN_DURATION_MS: '800',
      ASOC_COLUMN_REVEAL_DELAY_MS: '800',
      ASOC_TEST_DURABILITY_FAIL_TRIGGER: TRIGGER,
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', c => { output += c; });
  server.stderr.on('data', c => { output += c; });
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (server.exitCode !== null) throw new Error('Server exited during startup:\n' + output);
    try {
      const health = await request('/health');
      if (health.status === 200) return server;
    } catch {}
    await delay(50);
  }
  throw new Error('Server readiness timeout:\n' + output);
}

async function stopServer(hard = false) {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill(hard ? 'SIGKILL' : 'SIGTERM');
  await exited;
  server = null;
}

async function gmLogin(ip = null, password = 'hardening-gm-password') {
  const headers = ip ? { 'x-forwarded-for': ip } : {};
  return request('/api/auth/gm/login', 'POST', { password }, headers);
}

async function register(email, name) {
  const result = await request('/api/auth/player/register', 'POST', {
    email, password: 'hardening-player-password', name
  });
  assert.equal(result.status, 201);
  return result.data;
}

async function joinPlayer(token, suppliedName = 'SPOOFED') {
  const ws = await openWs();
  const joinedP = wait(ws, m => m.type === 'join:success', 'player join');
  const stateP = wait(ws, m => m.type === 'state:public', 'player state');
  ws.send(JSON.stringify({ type: 'room:join', authToken: token, name: suppliedName }));
  return { ws, joined: await joinedP, state: await stateP };
}

async function armHost(gmToken) {
  const ws = await openWs();
  const createdP = wait(ws, m => m.type === 'room:created', 'room created');
  ws.send(JSON.stringify({ type: 'room:create', gameId: 'sample-game', gmToken }));
  const created = await createdP;
  await wait(ws, m => m.type === 'state:public', 'host initial state');
  return { ws, ...created };
}

async function reconnectHost(gmToken, hostToken) {
  const ws = await openWs();
  const stateP = wait(ws, m => m.type === 'state:public', 'host reconnect state');
  const okP = wait(ws, m => m.type === 'host:reconnected', 'host reconnect ack');
  ws.send(JSON.stringify({ type: 'host:reconnect', roomCode: 'MASTER', hostToken, gmToken }));
  const state = await stateP;
  await okP;
  return { ws, state };
}

function activeRoom() {
  return JSON.parse(fs.readFileSync(ACTIVE, 'utf8')).rooms.find(r => r.code === 'MASTER');
}

function seedLegacyProfile() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(PLAYERS, JSON.stringify({
    'hard one': {
      id: 'hard one',
      name: 'HARD ONE',
      lifetimeScore: 777,
      avatarData: '',
      frameColor: '#123456',
      themeId: 'gunmetal',
      themeColor: '#343A42',
      createdAt: new Date().toISOString(),
      lastPlayed: new Date().toISOString()
    }
  }, null, 2));
}

async function sendCommand(ws, command, payload, cmdId) {
  const ackP = wait(ws, m => m.type === 'command:ack' && m.cmdId === cmdId, 'command ack');
  ws.send(JSON.stringify({ type: 'gm:command', command, payload, cmdId }));
  return ackP;
}

async function judge(ws, messageId, verdict, target) {
  const ackP = wait(ws, m => m.type === 'gm:judge:ack' && m.messageId === messageId, 'judge ack');
  ws.send(JSON.stringify({ type: 'gm:judgeGuess', messageId, verdict, target }));
  return ackP;
}

async function startBattle(ws) {
  const stateP = wait(ws, m => m.type === 'state:public' && m.roomMode === 'BATTLE', 'battle mode start');
  ws.send(JSON.stringify({ type: 'gm:timerStart' }));
  return stateP;
}

async function guess(player, host, text) {
  const seenP = wait(host, m => m.type === 'chat:update' && m.messages?.some(x => x.text === text), 'chat guess');
  player.send(JSON.stringify({ type: 'chat:guess', text }));
  const chat = await seenP;
  return chat.messages.filter(x => x.text === text).at(-1);
}

async function chargeWomf(host) {
  async function fail(columns, expected) {
    const stateP = wait(host, m => m.type === 'state:public' && m.womf?.charge === expected, 'WOMF ' + expected, 6000);
    for (const column of columns) host.send(JSON.stringify({ type: 'gm:failColumn', column }));
    await stateP;
  }
  await fail(['A','B','C','D'], 4);
  await sendCommand(host, 'resetBoard', {}, 'hard-womf-reset-1');
  await fail(['A','B','C','D'], 8);
  await sendCommand(host, 'resetBoard', {}, 'hard-womf-reset-2');
  await fail(['A','B'], 10);
}

function testSessionStoreRecovery() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-session-store-'));
  const script = `
    const assert=require('assert/strict'),fs=require('fs'),path=require('path');
    process.env.ASOC_DATA_DIR=process.argv[1]; process.env.NODE_ENV='test';
    const store=require(process.argv[2]+'/player-session-store');
    const key1='a'.repeat(64), key2='b'.repeat(64);
    const one=new Map([[key1,{playerId:'p1',email:'one@example.com',createdAt:1}]]);
    store.save(one);
    const two=new Map(one); two.set(key2,{playerId:'p2',email:'two@example.com',createdAt:2}); store.save(two);
    const file=path.join(process.argv[1],'.player-auth-sessions.json');
    fs.writeFileSync(file,'{BROKEN');
    const recovered=store.load();
    assert.equal(recovered.get(key1).playerId,'p1');
    assert.equal(recovered.has(key2),false);
    assert.ok(fs.readdirSync(process.argv[1]).some(n=>n.includes('.corrupt-')));
    const raw=fs.readFileSync(file,'utf8');
    assert.equal(raw.includes('player-secret-token'),false);
  `;
  const result = spawnSync(process.execPath, ['-e', script, dir, ROOT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-session-fail-'));
  const failTrigger = path.join(failDir, 'FAIL');
  const failScript = `
    const assert=require('assert/strict'),fs=require('fs');
    process.env.ASOC_DATA_DIR=process.argv[1]; process.env.NODE_ENV='test';
    process.env.ASOC_TEST_DURABILITY_FAIL_TRIGGER=process.argv[2];
    const store=require(process.argv[3]+'/player-session-store');
    const io=require(process.argv[3]+'/durable-io');
    const sessions=new Map([['c'.repeat(64),{playerId:'p1'}]]);
    store.save(sessions); fs.writeFileSync(process.argv[2],'x');
    sessions.set('d'.repeat(64),{playerId:'p2'});
    assert.throws(()=>store.save(sessions),/unavailable/i);
    assert.equal(io.healthy(),false);
  `;
  const failed = spawnSync(process.execPath, ['-e', failScript, failDir, failTrigger, ROOT], { encoding: 'utf8' });
  assert.equal(failed.status, 0, failed.stderr || failed.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(failDir, { recursive: true, force: true });
  console.log('PASS player auth session backup recovery, corruption quarantine, hashed keys and write failure');
}

(async () => {
  try {
    testSessionStoreRecovery();
    seedLegacyProfile();
    await startServer();

    const badIp = '203.0.113.10';
    assert.equal((await gmLogin(badIp, 'wrong-one')).status, 401);
    assert.equal((await gmLogin(badIp, 'wrong-two')).status, 401);
    const locked = await gmLogin(badIp, 'wrong-three');
    assert.equal(locked.status, 423, 'third bad attempt permanently locks that derived client key');
    assert.equal((await gmLogin(badIp)).status, 423, 'locked forwarded client stays locked');
    assert.equal((await gmLogin('203.0.113.11')).status, 200, 'different forwarded client is not collateral damage');

    const gm = await gmLogin();
    assert.equal(gm.status, 200, 'GM login succeeds');

    const one = await register('hard-one@example.test', 'HARD ONE');
    const two = await register('hard-two@example.test', 'HARD TWO');

    const p1 = await joinPlayer(one.token, 'HARD TWO');
    const p2 = await joinPlayer(two.token, 'HARD ONE');
    assert.equal(p1.joined.littleHero.name, 'HARD ONE', 'client cannot spoof another display name');
    assert.equal(p1.joined.playerId, one.player.id, 'authenticated account id is canonical room identity');
    const profiles = JSON.parse(fs.readFileSync(PLAYERS, 'utf8'));
    assert.equal(profiles[one.player.id].lifetimeScore, 777, 'legacy name profile migrates without losing score');
    assert.ok(profiles['hard one'] === undefined, 'legacy profile is moved, not duplicated');

    const host = await armHost(gm.data.token);
    await startBattle(host.ws);
    const armedBefore = activeRoom();
    const duplicateP = wait(host.ws, m => m.type === 'error' && m.code === 'MASTER_ALREADY_ARMED', 'duplicate arm rejection');
    host.ws.send(JSON.stringify({ type: 'room:create', gameId: 'sample-game', gmToken: gm.data.token }));
    await duplicateP;
    const armedAfter = activeRoom();
    assert.equal(armedAfter.boardId, armedBefore.boardId, 'duplicate room:create cannot reset board');
    assert.equal(armedAfter.revision, armedBefore.revision, 'duplicate room:create cannot mutate revision');

    const commandId = 'hard-replay-' + Date.now();
    await sendCommand(host.ws, 'resetBoard', {}, commandId);
    const resetBoardId = activeRoom().boardId;
    const replayAck = wait(host.ws, m => m.type === 'command:ack' && m.cmdId === commandId, 'replay ack');
    host.ws.send(JSON.stringify({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId: commandId }));
    await replayAck;
    assert.equal(activeRoom().boardId, resetBoardId, 'replayed cmdId cannot apply mutation twice');
    await startBattle(host.ws);

    await delay(400);
    await guess(p1.ws, host.ws, 'COOLDOWN ONE');
    p1.ws.close();
    await once(p1.ws, 'close');
    const p1b = await joinPlayer(one.token, 'SPOOFED AGAIN');
    const cooling = wait(p1b.ws, m => m.type === 'error' && /cooling down/i.test(m.message || ''), 'identity cooldown');
    p1b.ws.send(JSON.stringify({ type: 'chat:guess', text: 'COOLDOWN TWO' }));
    await cooling;

    const idle = await openWs(false);
    await Promise.race([
      once(idle, 'close'),
      delay(1500).then(() => { throw new Error('handshake timeout did not close idle socket'); })
    ]);

    await delay(400);
    const solvedGuess = await guess(p1b.ws, host.ws, 'DURABLE REVEAL');
    await judge(host.ws, solvedGuess.id, 'correct', 'A');
    assert.ok(activeRoom().pendingReveals?.A, 'column reveal deadline persisted before crash');
    await stopServer(true);
    await startServer();
    await delay(1100);
    assert.equal(activeRoom().sessionState.cells.A5, true, 'delayed column reveal resumes after hard restart');
    assert.ok(!activeRoom().pendingReveals?.A, 'delayed reveal resolves exactly once');

    const gm2 = await gmLogin();
    assert.equal(gm2.status, 200);
    const recoveredHost = await openWs();
    const recoveredP = wait(recoveredHost, m => m.type === 'host:recovered', 'host recover');
    recoveredHost.send(JSON.stringify({ type: 'host:recover', gmToken: gm2.data.token }));
    await recoveredP;

    await sendCommand(recoveredHost, 'resetBoard', {}, 'wheel-reset-' + Date.now());
    await chargeWomf(recoveredHost);
    const wheelOpen = wait(recoveredHost, m => m.type === 'state:public' && m.wheel?.open === true, 'wheel open');
    recoveredHost.send(JSON.stringify({ type: 'gm:wheelOpen', segments: ['HARD ONE', 'HARD TWO'] }));
    await wheelOpen;
    const spinning = wait(recoveredHost, m => m.type === 'state:public' && m.wheel?.phase === 'spinning', 'wheel spinning');
    recoveredHost.send(JSON.stringify({ type: 'gm:wheelRoll' }));
    await spinning;
    assert.ok(activeRoom().wheel.settleAt, 'wheel settlement deadline persisted before crash');
    await stopServer(true);
    await startServer();
    const settleDeadline = Date.now() + 12000;
    while (Date.now() < settleDeadline && activeRoom().wheel.phase === 'spinning') await delay(100);
    const settled = activeRoom();
    assert.equal(settled.wheel.phase, 'result', 'wheel settles after hard restart');
    assert.equal(settled.pendingTribute || null, null, 'wheel result survives restart without hiding itself behind Tribute debt');

    console.log('ALL HARDENING REGRESSIONS PASSED');
    await stopServer();
    fs.rmSync(DATA, { recursive: true, force: true });
  } catch (error) {
    console.error('HARDENING TEST FAILURE:', error);
    try { await stopServer(true); } catch {}
    process.exitCode = 1;
  }
})();
