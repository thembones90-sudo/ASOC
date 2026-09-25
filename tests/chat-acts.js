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
    assert.ok(commands.commands.commands.some(entry => entry.name === '/slap'));

    // WoW emotes: the server writes actor / target / other lines.
    await say('/slap @Victim', { targetPlayerId: victim.playerId });
    const slap = await waitFor(victim, m => m.messageType === 'emote' && m.emote?.act === 'slap', 'slap emote');
    assert.equal(slap.text, 'Farter slaps Victim.');
    assert.equal(slap.emote.label, 'SLAP');
    assert.deepEqual(slap.emote.lines, { actor: 'You slap Victim.', target: 'Farter slaps you across the face.', other: 'Farter slaps Victim.' });
    await say('/ass @Victim');
    const kick = await waitFor(victim, m => m.messageType === 'emote' && m.emote?.act === 'ass', 'ass kick');
    assert.equal(kick.emote.lines.target, 'Farter kicks you in the ass.');
    mark = farter.msgs.length;
    await say('/poke');
    assert.match(await lastError(farter, mark), /POKE TARGET REQUIRED/);

    // Self emotes need no target.
    await say('/facepalm');
    const facepalm = await waitFor(victim, m => m.messageType === 'emote' && m.emote?.act === 'facepalm', 'facepalm');
    assert.equal(facepalm.emote.targetId, null);
    assert.equal(facepalm.emote.lines.other, 'Farter facepalms.');

    // Threatening the Broker earns a SKYNET reply.
    await say('/threaten @broker');
    await waitFor(farter, m => m.messageType === 'emote' && m.emote?.act === 'threaten' && m.emote.targetId === BROKER, 'threaten the Broker');
    await waitFor(farter, m => m.source === 'shadowBroker' && /^SKYNET \/\//.test(m.text || ''), 'SKYNET reply');

    // Mooning the Broker is a one-time Blood Tribute toll.
    const tributeOf = client => [...client.msgs].reverse().find(m => m.type === 'state:public')?.bloodTribute || { status: 'idle' };
    await say('/moon @broker');
    await waitFor(gm, m => m.messageType === 'emote' && m.emote?.act === 'moon' && m.emote.targetId === BROKER, 'moon the Broker');
    await sleep(200);
    assert.equal(tributeOf(victim).status, 'required');
    assert.equal(tributeOf(victim).source, 'moon');
    gm.ws.send(JSON.stringify({ type: 'gm:tributeForgive' }));
    await sleep(400);
    assert.equal(tributeOf(victim).status, 'idle', 'moon toll forgiven');
    await say('/moon @broker');
    await sleep(200);
    assert.equal(tributeOf(victim).status, 'idle', 'the moon toll is never demanded twice');
    await say('/moon @Victim');
    await sleep(200);
    assert.equal(tributeOf(victim).status, 'idle', 'mooning a player costs nothing');

    // The Broker emotes too; its /grovel demands groveling instead.
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/bonk @Victim' }));
    const bonk = await waitFor(victim, m => m.messageType === 'emote' && m.emote?.act === 'bonk' && m.emote.actorId === null, 'Broker bonk');
    assert.equal(bonk.emote.lines.target, 'SHADOW BROKER bonks you on the head. Doh!');
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/grovel' }));
    const grovel = await waitFor(victim, m => m.messageType === 'emote' && m.emote?.act === 'grovel' && m.emote.actorId === null, 'Broker grovel');
    assert.equal(grovel.emote.lines.other, 'The Shadow Broker demands that you grovel. Grovel.');

    // Every Little Hero utility works from the GM composer too.
    const brokerSays = async (text, predicate, label) => {
      gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text }));
      return waitFor(victim, m => m.playerId == null && predicate(m), label);
    };
    const flip = await brokerSays('/flip heads', m => m.messageType === 'flip', 'Broker /flip');
    assert.equal(flip.playerName, 'SHADOW BROKER');
    await brokerSays('/dice 2d6', m => m.messageType === 'dice', 'Broker /dice');
    await brokerSays('/choose red | blue', m => m.messageType === 'choose', 'Broker /choose');
    await brokerSays('/order', m => m.messageType === 'order', 'Broker /order');
    await brokerSays('/stats', m => m.messageType === 'stats', 'Broker /stats');
    const shakeMark = victim.msgs.length;
    await brokerSays('/all wake up', m => m.source === 'shadowBroker' && m.text === '@all wake up', 'Broker /all');
    await sleep(200);
    assert.ok(victim.msgs.slice(shakeMark).some(m => m.type === 'chat:mentionAll'), 'Broker /all shakes every screen');
    gm.chat = [];
    gm.ws.send(JSON.stringify({ type: 'gm:broadcast', text: '/commands' }));
    const gmCommands = await waitFor(gm, m => m.messageType === 'commands' && m.playerId == null, 'GM /commands');
    ['/flip', '/dice', '/choose', '/order', '/stats', '/all', '/grovel', '/slap'].forEach(name =>
      assert.ok(gmCommands.commands.commands.some(entry => entry.name === name), `GM /commands lists ${name}`));

    assert.equal(serverErrors.trim(), '', 'no server errors');
    console.log('PASS chat acts: /fart mirrors /spit, emotes carry three perspectives, moon toll is one-time, the Broker never targets itself');
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
