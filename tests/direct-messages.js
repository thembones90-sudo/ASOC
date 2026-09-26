// DIRECT MESSAGES between Little Heroes + the Shadow Broker's hidden access.
//   Delivery, unread counts, read receipts, offline delivery, persistence,
//   text rules, rate limit, blocks, "accept from nobody", Battle lock,
//   reports; GM oversight is host-only, read-only and leaves no trace; the
//   oversight module is never in a public file and loads only for the GM.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_DM_TEST_PORT) || 18851;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-dm-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function api(urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers } }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => { let data = text; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, data, text }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
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
  async none(predicate, from, wait = 400) { await sleep(wait); return !this.msgs.slice(from).some(predicate); }
  async ask(message, types, label) {
    const from = this.mark();
    this.send(message);
    return this.next(m => types.includes(m.type), label, from);
  }
  close() { try { this.ws.close(); } catch {} }
}

function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'dm-pass', ASOC_EMAIL_VERIFICATION: '0' },
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

function checkHiddenFromPublic() {
  const publicFiles = ['index.html', 'join.html',
    ...fs.readdirSync(path.join(ROOT, 'js')).map(f => 'js/' + f),
    ...fs.readdirSync(path.join(ROOT, 'css')).map(f => 'css/' + f)];
  for (const file of publicFiles) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, /\/intercept\b|['"]intercept['"]|gm:dm(Overview|Thread|Report)|gm-modules/i, `${file} must not reveal the oversight module`);
  }
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const gmList = server.slice(server.indexOf('const GM_CHAT_SLASH_COMMANDS'), server.indexOf('];', server.indexOf('const GM_CHAT_SLASH_COMMANDS')));
  assert.doesNotMatch(gmList, /intercept/, '/intercept is never listed in /commands');
  // Player-facing copy never promises privacy it does not have.
  const dmClient = fs.readFileSync(path.join(ROOT, 'js/direct-messages.js'), 'utf8');
  assert.doesNotMatch(dmClient, /only you (two|and)|end-to-end|encrypted|nobody else can/i);
}

(async () => {
  checkHiddenFromPublic();
  let server = spawnServer();
  const clients = [];
  try {
    await healthy();
    const gmToken = (await api('/api/auth/gm/login', { password: 'dm-pass' })).data.token;
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
        creds[name] = { email: `${name.toLowerCase()}@dm.test`, password: 'dm-password' };
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
    const ana = await connect('Ana');
    let bo = await connect('Bo');
    const cy = await connect('Cy');

    // 1. Delivery to both sides, unread for the recipient.
    let from = bo.mark();
    ana.send({ type: 'dm:send', toId: bo.playerId, text: 'hey Bo' });
    const got = await bo.next(m => m.type === 'dm:message', 'bo receives', from);
    assert.equal(got.message.text, 'hey Bo');
    assert.equal(got.other.id, ana.playerId);
    assert.equal((await bo.next(m => m.type === 'dm:summary' && m.unread === 1, 'bo unread 1', from)).unread, 1);
    await ana.next(m => m.type === 'dm:message' && m.message.text === 'hey Bo', 'ana echo');
    const conversationId = got.conversationId;

    // 2. Opening marks read; the sender learns it was seen.
    from = ana.mark();
    const thread = await bo.ask({ type: 'dm:open', playerId: ana.playerId }, ['dm:thread'], 'bo opens');
    assert.equal(thread.thread.messages.length, 1);
    assert.equal(thread.thread.other.name, 'Ana');
    await ana.next(m => m.type === 'dm:read' && m.conversationId === conversationId, 'ana sees read', from);
    assert.equal((await bo.ask({ type: 'dm:list' }, ['dm:list'], 'bo list')).conversations[0].unread, 0);

    // 3. Text rules and the rate limit.
    await sleep(700);
    assert.match((await ana.ask({ type: 'dm:send', toId: bo.playerId, text: '   ' }, ['dm:error'], 'empty')).message, /empty/i);
    assert.match((await ana.ask({ type: 'dm:send', toId: bo.playerId, text: 'x'.repeat(501) }, ['dm:error'], 'long')).message, /too long/i);
    assert.match((await ana.ask({ type: 'dm:send', toId: ana.playerId, text: 'me' }, ['dm:error'], 'self')).message, /yourself|No such/i);
    await sleep(700);
    ana.send({ type: 'dm:send', toId: bo.playerId, text: 'one' });
    assert.match((await ana.ask({ type: 'dm:send', toId: bo.playerId, text: 'two' }, ['dm:error'], 'rate')).message, /Slow down/);

    // 4. Blocks: Bo blocks Ana -> Ana cannot deliver; unblock restores.
    await sleep(700);
    assert.equal((await bo.ask({ type: 'dm:block', playerId: ana.playerId, blocked: true }, ['dm:blocked'], 'block')).isBlocked, true);
    assert.match((await ana.ask({ type: 'dm:send', toId: bo.playerId, text: 'blocked?' }, ['dm:error'], 'blocked send')).message, /cannot be delivered/);
    await bo.ask({ type: 'dm:block', playerId: ana.playerId, blocked: false }, ['dm:blocked'], 'unblock');

    // 5. "Accept from nobody".
    await cy.ask({ type: 'dm:setting', allow: 'nobody' }, ['dm:summary'], 'cy nobody');
    await sleep(700);
    assert.match((await ana.ask({ type: 'dm:send', toId: cy.playerId, text: 'hi Cy' }, ['dm:error'], 'nobody')).message, /not accepting/);

    // 6. Battle lock: closed while armed, open again in Casual.
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await sleep(400);
    await sleep(300);
    assert.match((await ana.ask({ type: 'dm:send', toId: bo.playerId, text: 'answer is X' }, ['dm:error'], 'locked')).message, /MATCH IS LIVE/);
    gm.send({ type: 'gm:setRoomMode', mode: 'CASUAL' });
    await sleep(500);
    from = bo.mark();
    ana.send({ type: 'dm:send', toId: bo.playerId, text: 'after battle' });
    await bo.next(m => m.type === 'dm:message' && m.message.text === 'after battle', 'reopened', from);

    // 7. Offline delivery: Bo leaves, Ana writes, Bo returns to an unread count.
    bo.close();
    await sleep(300);
    await sleep(400);
    await ana.ask({ type: 'dm:send', toId: bo.playerId, text: 'while you were away' }, ['dm:message'], 'offline send');
    bo = await connect('Bo');
    assert.ok((await bo.next(m => m.type === 'dm:summary', 'bo summary on join')).unread >= 1);

    // 8. Report.
    const reported = await bo.ask({ type: 'dm:report', conversationId, reason: 'test report' }, ['dm:reported', 'dm:error'], 'report');
    assert.equal(reported.type, 'dm:reported');

    // 9. The Shadow Broker: host-only, read-only, no trace.
    assert.equal(await ana.none(m => m.type === 'gm:dmOverview', ana.mark(), 10), true);
    from = ana.mark();
    ana.send({ type: 'gm:dmOverview' });
    assert.equal(await ana.none(m => m.type === 'gm:dmOverview', from), true, 'players never get the overview');
    const before = (await bo.ask({ type: 'dm:list' }, ['dm:list'], 'bo list before')).conversations[0].unread;
    const overview = (await gm.ask({ type: 'gm:dmOverview' }, ['gm:dmOverview'], 'overview')).data;
    assert.equal(overview.conversations.length, 1);
    assert.equal(overview.reports.length, 1);
    assert.equal(overview.reports[0].reason, 'test report');
    const full = (await gm.ask({ type: 'gm:dmThread', conversationId }, ['gm:dmThread'], 'full thread')).conversation;
    assert.ok(full.messages.some(m => m.text === 'while you were away'));
    assert.ok(full.messages.some(m => m.text === 'hey Bo'));
    const snap = (await gm.ask({ type: 'gm:dmReport', reportId: overview.reports[0].id }, ['gm:dmReport'], 'report snapshot')).report;
    assert.ok(snap.snapshot.length >= 3);
    const after = (await bo.ask({ type: 'dm:list' }, ['dm:list'], 'bo list after')).conversations[0].unread;
    assert.equal(after, before, 'GM reading leaves unread state untouched');

    // 10. /intercept loads the module for the GM only; nothing is posted.
    from = gm.mark();
    const fromAna = ana.mark();
    gm.send({ type: 'gm:broadcast', text: '/intercept' });
    assert.equal((await gm.next(m => m.type === 'gm:module', 'module signal', from)).name, 'intercept');
    assert.equal(await ana.none(m => m.type === 'chat:update' && m.messages.some(x => /intercept/i.test(x.text || '')), fromAna), true, 'nothing reaches the chat');
    assert.equal((await api('/api/gm/module/intercept')).status, 404, 'no GM session, no module');
    assert.equal((await api('/api/gm/module/intercept', null, { 'x-gm-token': 'nope' })).status, 404);
    const mod = await api('/api/gm/module/intercept', null, { 'x-gm-token': gmToken });
    assert.equal(mod.status, 200);
    assert.match(mod.text, /registerGmModule\('intercept'/);
    assert.equal((await api('/gm-modules/intercept.js')).status, 404, 'module file is not statically served');
    assert.equal((await api('/api/gm/module/..%2Fserver')).status, 404);

    // 11. Persistence across restart.
    clients.forEach(c => c.close());
    clients.length = 0;
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    server = spawnServer();
    await healthy();
    gm = await openGm();
    const bo2 = await connect('Bo');
    const list = await bo2.ask({ type: 'dm:list' }, ['dm:list'], 'list after restart');
    assert.equal(list.conversations.length, 1);
    assert.equal(list.conversations[0].other.name, 'Ana');
    assert.ok(fs.existsSync(path.join(DATA, 'direct-messages.json')));

    assert.equal(server.errors.trim(), '', 'no server errors');
    console.log('PASS direct messages: delivery, unread + read receipts, offline delivery, text rules, rate limit, blocks, accept-from-nobody, Battle lock, reports, persistence; Shadow Broker oversight host-only, read-only, traceless, module GM-gated and absent from public files');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL direct messages:', error);
  process.exit(1);
});
