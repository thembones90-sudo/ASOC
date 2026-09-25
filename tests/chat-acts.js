// /spit and /fart: one targeted-act mechanism. Little Heroes can aim either
// at another connected player or at the Shadow Broker (pseudo-target
// __SHADOW_BROKER__); the Broker can /fart too but never at itself.
// Private server on throwaway data.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_CHAT_ACTS_TEST_PORT) || 18790;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-chat-acts-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BROKER = '__SHADOW_BROKER__';

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

async function waitFor(client, predicate, label, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = client.chat.find(predicate);
    if (found) return found;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function lastError(client, since) {
  await sleep(400);
  return client.msgs.slice(since).filter(m => m.type === 'error').map(m => m.message).at(-1) || null;
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'acts-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'acts-pass' })).data.token;
    const tokens = [];
    for (const name of ['Farter', 'Victim']) {
      tokens.push((await api('/api/auth/player/register', { email: `${name.toLowerCase()}@acts.test`, password: 'acts-password', name })).data.token);
    }
    const gm = await connect(ws => ws.send(JSON.stringify({ type: 'host:recover', gmToken })));
    const farter = await connect(ws => ws.send(JSON.stringify({ type: 'room:join', authToken: tokens[0], roomCode: 'MASTER', name: 'Farter' })));
    const victim = await connect(ws => ws.send(JSON.stringify({ type: 'room:join', authToken: tokens[1], roomCode: 'MASTER', name: 'Victim' })));
    clients.push(gm, farter, victim);
    const say = async (text, extra = {}) => { farter.ws.send(JSON.stringify({ type: 'chat:guess', text, ...extra })); await sleep(420); };

    // /fart by typed name: server-authoritative card, same contract as /spit.
    await say('/fart @Victim');
    const typed = await waitFor(victim, m => m.messageType === 'fart' && m.fart?.targetId === victim.playerId, 'typed fart');
    assert.equal(typed.text, 'Farter farts on Victim.');
    assert.equal(typed.source, 'fart');
    assert.equal(typed.adjudicable, false);
    assert.equal(typed.playerId, farter.playerId, 'the fart is credited to the sender (DELIVERED ack)');
    assert.deepEqual(typed.fart, { actorId: farter.playerId, actorName: 'Farter', targetId: victim.playerId, targetName: 'Victim' });

    // /fart via the picker's resolved id.
    victim.chat = [];
    await say('/fart @Victim', { targetPlayerId: victim.playerId });
    await waitFor(victim, m => m.messageType === 'fart' && m.fart?.targetId === victim.playerId, 'picker fart');

    // The Shadow Broker is a valid target for both acts: picker id, full name, short name.
    await say('/fart @SHADOW BROKER', { targetPlayerId: BROKER });
    const brokerFart = await waitFor(gm, m => m.messageType === 'fart' && m.fart?.targetId === BROKER, 'fart on the Broker');
    assert.equal(brokerFart.text, 'Farter farts on SHADOW BROKER.');
    assert.equal(brokerFart.fart.targetName, 'SHADOW BROKER');
    await say('/spit @Shadow Broker');
    await waitFor(gm, m => m.messageType === 'spit' && m.spit?.targetId === BROKER, 'spit on the Broker by name');
    gm.chat = [];
    await say('/spit @broker');
    await waitFor(gm, m => m.messageType === 'spit' && m.spit?.targetId === BROKER && m.spit?.actorId === farter.playerId, 'spit on @broker');

    // Existing /spit guards still hold: bare verb prompts, self is refused.
    let mark = farter.msgs.length;
    await say('/fart');
    assert.match(await lastError(farter, mark), /FART TARGET REQUIRED/);
    mark = farter.msgs.length;
    await say('/fart', { targetPlayerId: farter.playerId });
    assert.match(await lastError(farter, mark), /FART TARGET MUST BE ANOTHER PLAYER/);

    // The Broker farts too, but never at itself.
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/fart @Victim' }));
    const brokerAct = await waitFor(victim, m => m.messageType === 'fart' && m.fart?.actorId === null, 'Broker fart');
    assert.equal(brokerAct.text, 'SHADOW BROKER farts on Victim.');
    mark = gm.msgs.length;
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/fart @broker' }));
    assert.match(await lastError(gm, mark), /FART TARGET NOT FOUND/, 'the Broker cannot target itself');

    // /commands advertises /fart.
    await say('/commands');
    const commands = await waitFor(farter, m => m.messageType === 'commands', '/commands card');
    assert.ok(commands.commands.commands.some(entry => entry.name === '/fart'));

    assert.equal(serverErrors.trim(), '', 'no server errors');
    console.log('PASS chat acts: /fart mirrors /spit, both can target the Shadow Broker, the Broker farts but never on itself');
  } finally {
    clients.forEach(client => { try { client.ws.close(); } catch {} });
    server.kill();
    await sleep(200);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('FAIL chat acts:', error);
  process.exit(1);
});
