// Little Hero @all nudge: every screen shakes, and the hidden one-time toll
// -- after five nudges the next one is swallowed and a Blood Tribute is
// demanded; once paid (or forgiven by the GM) that player nudges freely
// forever. Runs against a private server on throwaway data.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_NUDGE_TEST_PORT) || 18740;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-nudge-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// 1x1 PNG -- a valid Blood Tribute image.
const TRIBUTE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.state = null; this.chat = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (message.type === 'protocol:ready') return resolve(this);
        this.msgs.push(message);
        if (message.type === 'state:public') this.state = message;
        if (message.type === 'chat:update') this.chat = message.messages || [];
      });
    });
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  count(type, since = 0) { return this.msgs.slice(since).filter(m => m.type === type).length; }
  async waitFor(predicate, label, timeout = 6000) {
    const started = Date.now();
    let index = 0;
    while (Date.now() - started < timeout) {
      for (; index < this.msgs.length; index++) if (predicate(this.msgs[index])) return this.msgs[index];
      await sleep(20);
    }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

function startServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'nudge-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  return server;
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); }
  throw new Error('server did not become healthy');
}

let gm, nudger, witness, gmToken;
const tokens = [];

async function connectAll() {
  gm = await new Client('GM').open();
  gm.send({ type: 'host:recover', gmToken });
  await gm.waitFor(m => m.type === 'host:recovered', 'host recovered');
  nudger = await new Client('Nudger').open();
  nudger.send({ type: 'room:join', authToken: tokens[0], roomCode: 'MASTER', name: 'Nudger' });
  await nudger.waitFor(m => m.type === 'join:success', 'nudger join');
  witness = await new Client('Witness').open();
  witness.send({ type: 'room:join', authToken: tokens[1], roomCode: 'MASTER', name: 'Witness' });
  await witness.waitFor(m => m.type === 'join:success', 'witness join');
  await sleep(300);
}

// Sends a chat line from `sender` (default: the nudger) and reports whether
// the room shook, as seen by `observer` and the Shadow Broker.
async function say(text, sender = nudger, observer = sender === nudger ? witness : nudger) {
  const posted = text.replace(/^\/all\s*/i, '@all ').trim();
  const shakesBefore = observer.count('chat:mentionAll');
  const gmShakesBefore = gm.count('chat:mentionAll');
  const senderMark = sender.msgs.length;
  sender.send({ type: 'chat:guess', text });
  await observer.waitFor(m => m.type === 'chat:update' && m.messages.some(x => x.text === posted), `chat "${text}"`);
  await sleep(420); // chat cooldown + any trailing broadcast
  return {
    shook: observer.count('chat:mentionAll') > shakesBefore,
    gmShook: gm.count('chat:mentionAll') > gmShakesBefore,
    errors: sender.msgs.slice(senderMark).filter(m => m.type === 'error').map(m => m.message),
    message: observer.chat.filter(x => x.text === posted).at(-1)
  };
}

async function run() {
  let server = startServer();
  try {
    await waitHealthy();
    gmToken = (await api('/api/auth/gm/login', { password: 'nudge-pass' })).data.token;
    for (const name of ['Nudger', 'Witness']) {
      tokens.push((await api('/api/auth/player/register', { email: `${name.toLowerCase()}@nudge.test`, password: 'nudge-password', name })).data.token);
    }
    await connectAll();

    // Plain chat never shakes.
    assert.equal((await say('just talking')).shook, false);

    // Five free nudges: every screen (players and GM) shakes, and the message is flagged.
    for (let i = 1; i <= 5; i++) {
      const result = await say(`@all nudge ${i}`);
      assert.equal(result.shook, true, `free nudge ${i} shakes the players`);
      assert.equal(result.gmShook, true, `free nudge ${i} shakes the Shadow Broker`);
      assert.equal(result.message.nudge, true, 'a real nudge is flagged for desktop alerts');
    }

    // The sixth (typed as /all) is swallowed and a nudge Blood Tribute is demanded.
    const sixth = await say('/all please');
    assert.equal(sixth.shook, false, 'the sixth nudge is swallowed');
    assert.equal(sixth.message.text, '@all please', '/all posts as @all');
    assert.notEqual(sixth.message.nudge, true);
    assert.equal(witness.state.bloodTribute.status, 'required');
    assert.equal(witness.state.bloodTribute.source, 'nudge');
    assert.equal(witness.state.bloodTribute.playerName, 'Nudger');

    // Still owing: further nudges are swallowed with a hint to the nudger only.
    const seventh = await say('@all hello?');
    assert.equal(seventh.shook, false);
    assert.deepEqual(seventh.errors, ['YOUR NUDGE WAS SWALLOWED BY THE VOID']);

    // The debt survives a server restart (nudge counts are persisted too).
    [gm, nudger, witness].forEach(client => client.close());
    server.kill();
    await sleep(600);
    server = startServer();
    await waitHealthy();
    // GM tokens are in-memory only, so a restart needs a fresh GM login.
    gmToken = (await api('/api/auth/gm/login', { password: 'nudge-pass' })).data.token;
    await connectAll();
    assert.equal(witness.state.bloodTribute.source, 'nudge', 'nudge debt survives a restart');

    // Paying the tribute settles the toll for good: nudging is free forever.
    nudger.send({ type: 'tribute:submit', imageData: TRIBUTE_PNG, retentionAcknowledged: true });
    await nudger.waitFor(m => m.type === 'tribute:accepted', 'tribute accepted');
    await sleep(200);
    assert.equal(witness.state.bloodTribute.status, 'idle');
    for (let i = 1; i <= 7; i++) {
      assert.equal((await say(`@all paid up ${i}`)).shook, true, `after paying, nudge ${i} shakes`);
    }
    assert.equal(witness.state.bloodTribute.status, 'idle', 'the toll is never demanded again');

    // Forgiving the toll settles it too (tested on the second player).
    for (let i = 1; i <= 5; i++) assert.equal((await say(`@all witness ${i}`, witness)).shook, true);
    assert.equal((await say('@all witness six', witness)).shook, false);
    assert.equal(nudger.state.bloodTribute.source, 'nudge');
    assert.equal(nudger.state.bloodTribute.playerName, 'Witness');
    gm.send({ type: 'gm:tributeForgive' });
    await nudger.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'idle', 'debt forgiven');
    await sleep(200);
    for (let i = 1; i <= 7; i++) {
      assert.equal((await say(`@all forgiven ${i}`, witness)).shook, true, `after forgiveness, nudge ${i} shakes`);
    }
    assert.equal(nudger.state.bloodTribute.status, 'idle', 'no second toll after forgiveness');

    assert.equal(server.errors.trim(), '', 'no server errors');
    console.log('PASS player nudge: @all and /all shake everyone, five free, sixth demands a one-time Blood Tribute, paid/forgiven means free forever, survives restart');
  } finally {
    [gm, nudger, witness].forEach(client => client?.close());
    server.kill();
    await sleep(200);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('FAIL player nudge:', error);
  process.exit(1);
});
