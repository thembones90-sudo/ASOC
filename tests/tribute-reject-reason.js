// SUMMON RITUAL // denying a Blood Tribute requires a reason, and only the
// Little Hero who offered it sees that reason (the GM panel shows it too).
// The reason survives a restart and disappears once they offer again.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_TRIBUTE_REASON_TEST_PORT) || 18871;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-tribute-reason-'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
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
  constructor(name) { this.name = name; this.msgs = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
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
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'tr-pass', ASOC_EMAIL_VERIFICATION: '0' },
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
    const gmToken = (await api('/api/auth/gm/login', { password: 'tr-pass' })).data.token;
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
        creds[name] = { email: `${name.toLowerCase()}@tr.test`, password: 'tr-password' };
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
    let bo = await connect('Bo');

    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.active, 'ritual active');

    // Ana offers a tribute.
    let from = gm.mark();
    ana.send({ type: 'ritual:tributeSubmit', imageData: PNG });
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.tribute?.status === 'PENDING', 'pending', from);

    // No reason -> refused, still pending.
    from = gm.mark();
    gm.send({ type: 'ritual:tributeReject' });
    assert.match((await gm.next(m => m.type === 'error', 'reason required', from)).message, /reason/i);
    gm.send({ type: 'ritual:tributeReject', reason: '   ' });
    assert.match((await gm.next(m => m.type === 'error' && m !== undefined, 'blank refused', from + 1)).message, /reason/i);

    // With a reason -> denied; only Ana sees it; the GM panel shows it.
    const anaMark = ana.mark(), boMark = bo.mark();
    from = gm.mark();
    gm.send({ type: 'ritual:tributeReject', reason: 'Not bloody enough. Try again with feeling.' });
    const gmView = await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.tribute?.status === 'REJECTED', 'gm rejected', from);
    assert.equal(gmView.ritual.tribute.rejection.reason, 'Not bloody enough. Try again with feeling.');
    assert.equal(gmView.ritual.tribute.rejection.playerName, 'Ana');
    const anaView = await ana.next(m => m.type === 'ritual:update' && m.ritual?.tribute?.status === 'REJECTED', 'ana rejected', anaMark);
    assert.equal(anaView.ritual.tributeRejection.reason, 'Not bloody enough. Try again with feeling.');
    const boView = await bo.next(m => m.type === 'ritual:update' && m.ritual?.tribute?.status === 'REJECTED', 'bo rejected', boMark);
    assert.equal(boView.ritual.tributeRejection, null, 'other Little Heroes never see the reason');
    assert.ok(!JSON.stringify(boView).includes('Not bloody enough'));

    // Long reasons are capped at 200 characters.
    from = gm.mark();
    ana.send({ type: 'ritual:tributeSubmit', imageData: PNG });
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.tribute?.status === 'PENDING', 'pending again', from);
    // Offering again clears Ana's old reason.
    const cleared = await ana.next(m => m.type === 'ritual:update' && m.ritual?.tribute?.status === 'PENDING', 'ana pending');
    assert.equal(cleared.ritual.tributeRejection, null);
    from = gm.mark();
    gm.send({ type: 'ritual:tributeReject', reason: 'x'.repeat(260) });
    const capped = await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.tribute?.status === 'REJECTED', 'capped', from);
    assert.equal(capped.ritual.tribute.rejection.reason.length, 200);

    // Survives a restart: Ana still sees why after reconnecting.
    clients.forEach(c => c.close());
    clients.length = 0;
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    server = spawnServer();
    await healthy();
    gm = await openGm();
    ana = await connect('Ana');
    const again = await ana.next(m => m.type === 'ritual:update' && m.ritual?.tribute?.status === 'REJECTED', 'ana after restart');
    assert.equal(again.ritual.tributeRejection.reason, 'x'.repeat(200));

    // Client wiring: the GM is asked for a reason; the player panel shows it.
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.match(app, /DENY BLOOD TRIBUTE[\s\S]{0,300}required: true/);
    assert.match(fs.readFileSync(path.join(ROOT, 'js/ritual.js'), 'utf8'), /YOUR TRIBUTE WAS DENIED/);

    assert.equal(server.errors.trim(), '', 'no server errors');
    console.log('PASS ritual tribute denial: reason required and capped, private to the offering Little Hero, shown to the GM, survives restart, cleared on a new offering');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL ritual tribute denial:', error);
  process.exit(1);
});
