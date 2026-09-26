// SHADOW REALM -- GM right-click punishment.
//   GM-only, on a Little Hero message; everyone is told; the message keeps a
//   permanent shadowRealm flag (survives restart); the player cannot type
//   anything (chat, commands, DMs, GIFs, image links, polls) for the window,
//   including after a reconnect; others are unaffected; it ends on time.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_SHADOW_REALM_TEST_PORT) || 18911;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-srealm-'));
const WINDOW_MS = 2500;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', c => { text += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.chat = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'chat:update') this.chat = m.messages || [];
        if (m.type === 'join:success') this.playerId = m.playerId;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(predicate, label, from = 0, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { const f = this.msgs.slice(from).find(predicate); if (f) return f; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'sr-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_SHADOW_REALM_MS: String(WINDOW_MS) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  return server;
}
async function healthy() {
  for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); }
  throw new Error('server not healthy');
}

(async () => {
  let server = spawnServer();
  const clients = [];
  try {
    await healthy();
    const gmToken = (await api('/api/auth/gm/login', { password: 'sr-pass' })).data.token;
    const openGm = async () => {
      const gm = await new Client('GM').open();
      clients.push(gm);
      gm.send({ type: 'host:recover', gmToken });
      await gm.next(m => m.type === 'host:recovered', 'host');
      return gm;
    };
    const creds = {};
    const connect = async name => {
      if (!creds[name]) {
        creds[name] = { email: `${name.toLowerCase()}@sr.test`, password: 'sr-password' };
        await api('/api/auth/player/register', { ...creds[name], name });
      }
      const token = (await api('/api/auth/player/login', creds[name])).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.next(m => m.type === 'join:success', `${name} join`);
      await sleep(150);
      return c;
    };
    let gm = await openGm();
    let ana = await connect('Ana');
    const bo = await connect('Bo');

    let from = gm.mark();
    ana.send({ type: 'chat:guess', text: 'the Broker is a fraud' });
    const target = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'the Broker is a fraud'), 'ana msg', from)).messages.find(x => x.text === 'the Broker is a fraud');
    await sleep(450);

    // Players cannot banish; the Broker's own lines cannot be banished.
    from = bo.mark();
    bo.send({ type: 'gm:shadowRealm', messageId: target.id });
    assert.match((await bo.next(m => m.type === 'error', 'player refused', from)).message, /Only the Shadow Broker/);
    gm.send({ type: 'gm:broadcast', text: 'broker line' });
    const brokerLine = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'broker line'), 'broker line')).messages.find(x => x.text === 'broker line');
    from = gm.mark();
    gm.send({ type: 'gm:shadowRealm', messageId: brokerLine.id });
    assert.match((await gm.next(m => m.type === 'error', 'broker refused', from)).message, /Little Hero message/);

    // BANISH.
    const boMark = bo.mark(), anaMark = ana.mark();
    from = gm.mark();
    gm.send({ type: 'gm:shadowRealm', messageId: target.id });
    const seenByBo = await bo.next(m => m.type === 'shadowRealm:banish', 'bo sees it', boMark);
    assert.equal(seenByBo.playerId, ana.playerId);
    assert.equal(seenByBo.playerName, 'Ana');
    assert.equal(seenByBo.remainingMs, WINDOW_MS);
    await ana.next(m => m.type === 'shadowRealm:banish' && m.playerId === ana.playerId, 'ana sees it', anaMark);
    await gm.next(m => m.type === 'shadowRealm:banish', 'gm sees it', from);
    const update = await bo.next(m => m.type === 'chat:update' && m.messages.some(x => x.id === target.id && x.shadowRealm), 'memento flag', boMark);
    assert.ok(update.messages.some(x => /^Ana has been banished to the Shadow Realm$/.test(x.text || '')), 'the Broker announces it');

    // Silenced: chat, commands, DMs, GIFs, image links, polls.
    const refused = async (msg, label, type = 'error') => {
      const m0 = ana.mark();
      ana.send(msg);
      const err = await ana.next(m => m.type === type, label, m0);
      assert.match(err.message, /SHADOW REALM/, label);
    };
    await refused({ type: 'chat:guess', text: 'let me out' }, 'chat');
    await refused({ type: 'chat:guess', text: '/roll' }, 'commands');
    await refused({ type: 'dm:send', toId: bo.playerId, text: 'help' }, 'dm', 'dm:error');
    await refused({ type: 'chat:gif', gif: { id: 'x' } }, 'gif');
    await refused({ type: 'chat:image-url', url: 'https://example.com/a.png' }, 'image link');
    await refused({ type: 'chat:poll:create', question: 'free me?', options: ['yes', 'no'] }, 'poll');
    // Bo is unaffected.
    from = gm.mark();
    bo.send({ type: 'chat:guess', text: 'rest in peace Ana' });
    await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'rest in peace Ana'), 'bo still talks', from);

    // Reconnecting does not escape it.
    ana.close();
    await sleep(200);
    ana = await connect('Ana');
    const resumed = await ana.next(m => m.type === 'shadowRealm:banish', 'resumed veil');
    assert.equal(resumed.resumed, true);
    assert.ok(resumed.remainingMs > 0 && resumed.remainingMs <= WINDOW_MS);
    await refused({ type: 'chat:guess', text: 'still here' }, 'chat after reconnect');

    // It ends on time.
    await sleep(WINDOW_MS + 300);
    from = gm.mark();
    ana.send({ type: 'chat:guess', text: 'I have returned' });
    await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'I have returned'), 'voice returns', from);

    // The memento survives a restart.
    clients.forEach(c => c.close());
    clients.length = 0;
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    server = spawnServer();
    await healthy();
    gm = await openGm();
    const chat = await gm.next(m => m.type === 'chat:update', 'chat after restart');
    assert.ok(chat.messages.find(x => x.id === target.id)?.shadowRealm?.at, 'the message stays in the Shadow Realm');

    // GM UI wiring.
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /data-gm-chat-action="shadow-realm"[^>]*>.*SEND TO SHADOW REALM/);
    assert.match(app, /action === 'shadow-realm'[\s\S]{0,200}gm:shadowRealm/);

    assert.equal(server.errors.trim(), '', 'no server errors');
    console.log('PASS Shadow Realm: GM-only on Little Hero messages, everyone notified, permanent memento flag (survives restart), 20s silence across chat/commands/DMs/GIFs/image links/polls that survives reconnect, others unaffected, ends on time');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL Shadow Realm:', error);
  process.exit(1);
});
