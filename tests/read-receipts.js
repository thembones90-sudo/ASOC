// READ RECEIPTS // SEEN BY dedupe.
//   Helper (js/read-receipts.js): unique viewers by stable identity, current
//   names on rename, same-name different players stay distinct, Master Mirror
//   personas collapse to one viewer, compact "+N", unique counts, NOT SEEN.
//   Server: repeated events, reconnects and multiple Master Mirror sessions
//   record exactly one receipt per player; recipient snapshots are unique.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
function checkHelper() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/read-receipts.js'), 'utf8'), sandbox);
  const RR = sandbox.window.ReadReceipts;
  // vm results live in another realm: compare plain copies.
  const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
  const r = (playerId, playerName, seenAt) => ({ playerId, playerName, seenAt });
  const msg = {
    playerId: 'sender',
    recipientIds: ['player-1', 'player-2', 'player-3', 'player-4', 'player-5', '__MASTER_TEST__:aaa', '__MASTER_TEST__:bbb', 'player-4'],
    recipientCount: 8,
    seenBy: [
      r('player-1', 'Rastko', 1), r('player-2', 'al', 2), r('player-3', 'JUSUF', 3),
      r('player-4', 'TEST SUBJECT', 4), r('player-4', 'TEST SUBJECT', 5), r('player-4', 'TEST SUBJECT', 6), r('player-4', 'TEST SUBJECT', 7)
    ]
  };
  // 1 + 5: repeated events -> one entry each, in first-seen order
  let names = RR.viewers(msg).map(v => v.name);
  same(names, ['Rastko', 'al', 'JUSUF', 'TEST SUBJECT']);
  // 3: rename -> once, with the CURRENT roster name; without a roster, the latest recorded name
  const renamed = { playerId: 'sender', seenBy: [r('player-4', 'OLD NAME', 1), r('player-4', 'NEW NAME', 9)] };
  same(RR.viewers(renamed).map(v => v.name), ['NEW NAME']);
  same(RR.viewers(renamed, { roster: [{ id: 'player-4', name: 'CURRENT' }] }).map(v => v.name), ['CURRENT']);
  // 4: two different players with the same display name stay two viewers
  const twins = { playerId: 'sender', seenBy: [r('a', 'Marko', 1), r('b', 'Marko', 2)] };
  assert.equal(RR.viewers(twins).length, 2);
  // Master Mirror: every mirror session is the one TEST SUBJECT
  const mirrors = { playerId: 'sender', seenBy: [r('__MASTER_TEST__:aaa', 'TEST SUBJECT', 1), r('__MASTER_TEST__:bbb', 'TEST SUBJECT', 2), r('__MASTER_TEST__:ccc', 'TEST SUBJECT', 3)] };
  same(RR.viewers(mirrors).map(v => v.name), ['TEST SUBJECT']);
  // the sender / the viewing player never count, by identity
  assert.equal(RR.viewers({ playerId: '__MASTER_TEST__:x', seenBy: mirrors.seenBy }).length, 0, 'a mirror never sees its own message');
  assert.equal(RR.viewers(msg, { excludeIds: ['player-1'] }).length, 3);
  // 6: unique counts -- denominator from unique recipients, never below unique seen
  same([...RR.recipientKeys(msg)], ['player-1', 'player-2', 'player-3', 'player-4', 'player-5', '__MASTER_TEST__']);
  assert.equal(RR.recipientTotal(msg, 4), 6);
  assert.equal(RR.recipientTotal({ recipientIds: [], recipientCount: 2 }, 3), 3, 'never shows more seen than total');
  // 7: NOT SEEN is unique too
  const notSeen = RR.notSeen(msg, RR.viewers(msg), [{ id: 'player-5', name: 'Ana' }]);
  same(notSeen.map(v => v.name), ['Ana', 'TEST SUBJECT']);
  // compact footer
  const long = { playerId: 's', seenBy: 'abcdefgh'.split('').map((id, i) => r(id, id.toUpperCase(), i)) };
  const { shown, more } = RR.compact(RR.viewers(long), 4);
  same(shown.map(v => v.name), ['A', 'B', 'C', 'D']);
  assert.equal(more, 4);
  assert.equal(RR.compact(RR.viewers(twins), 4).more, 0);
}

// ---------------------------------------------------------------------------
const PORT = Number(process.env.ASOC_RECEIPTS_TEST_PORT) || 18823;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-receipts-'));

function api(urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
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
  async next(predicate, label, from = 0, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { const f = this.msgs.slice(from).find(predicate); if (f) return f; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function runServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'receipts-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'receipts-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host');

    const creds = {};
    const join = async (name, token) => {
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.next(m => m.type === 'join:success', `${name} join`);
      await sleep(150);
      return c;
    };
    const player = async (name) => {
      if (!creds[name]) {
        creds[name] = { email: `${name.toLowerCase()}@receipts.test`, password: 'receipts-password' };
        await api('/api/auth/player/register', { ...creds[name], name });
      }
      return join(name, (await api('/api/auth/player/login', creds[name])).data.token);
    };
    const mirror = async () => {
      const res = await api('/api/auth/gm/mirror-player', {}, { 'x-gm-token': gmToken });
      assert.equal(res.status, 200);
      return join('TEST SUBJECT', res.data.token);
    };
    const receiptsOf = id => (gm.chat.find(m => m.id === id)?.seenBy || []);

    const ana = await player('Ana');
    let bo = await player('Bo');
    const mirrorA = await mirror();
    const mirrorB = await mirror();
    assert.notEqual(mirrorA.playerId, mirrorB.playerId, 'each mirror session has its own persona id');

    // Ana posts; recipient snapshot counts the Master Mirror once.
    let from = gm.mark();
    ana.send({ type: 'chat:guess', text: 'receipt probe' });
    const posted = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'receipt probe'), 'post', from))
      .messages.find(x => x.text === 'receipt probe');
    const mirrorIds = posted.recipientIds.filter(id => id.startsWith('__MASTER_TEST__:'));
    assert.equal(mirrorIds.length, 1, 'two mirror sessions are one recipient');
    assert.equal(posted.recipientCount, 2, 'Bo + TEST SUBJECT');

    // 1. repeated seen events -> one receipt
    for (let i = 0; i < 4; i++) bo.send({ type: 'chat:seen', messageId: posted.id });
    await sleep(300);
    assert.equal(receiptsOf(posted.id).filter(r => r.playerId === bo.playerId).length, 1);
    // 2. reconnect -> still one
    const boId = bo.playerId;
    bo.close();
    await sleep(200);
    bo = await player('Bo');
    assert.equal(bo.playerId, boId, 'stable account id across reconnects');
    bo.send({ type: 'chat:seen', messageId: posted.id });
    await sleep(300);
    assert.equal(receiptsOf(posted.id).filter(r => r.playerId === boId).length, 1);
    // Master Mirror: many sessions, many events -> one TEST SUBJECT receipt
    mirrorA.send({ type: 'chat:seen', messageId: posted.id });
    mirrorB.send({ type: 'chat:seen', messageId: posted.id });
    const mirrorC = await mirror();
    mirrorC.send({ type: 'chat:seen', messageId: posted.id });
    mirrorA.send({ type: 'chat:seen', messageId: posted.id });
    await sleep(400);
    const receipts = receiptsOf(posted.id);
    assert.equal(receipts.filter(r => r.playerId.startsWith('__MASTER_TEST__:')).length, 1, 'TEST SUBJECT appears once');
    assert.equal(receipts.length, 2, 'unique viewers: Bo and TEST SUBJECT');
    // A mirror persona never receipts its own message.
    from = gm.mark();
    mirrorA.send({ type: 'chat:guess', text: 'mirror probe' });
    const mirrorPost = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'mirror probe'), 'mirror post', from))
      .messages.find(x => x.text === 'mirror probe');
    assert.ok(!mirrorPost.recipientIds.some(id => id.startsWith('__MASTER_TEST__:')), 'no other mirror session counts as a recipient');
    mirrorB.send({ type: 'chat:seen', messageId: mirrorPost.id });
    await sleep(300);
    assert.equal(receiptsOf(mirrorPost.id).length, 0);

    // 8. chat state intact: every message still present, in order.
    assert.deepEqual(gm.chat.filter(m => /probe/.test(m.text || '')).map(m => m.text), ['receipt probe', 'mirror probe']);
    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  checkHelper();
  await runServer();
  console.log('PASS read receipts: SEEN BY dedupes by stable identity (repeat events, reconnects, renames, Master Mirror sessions), same-name players stay distinct, unique counts, compact +N, NOT SEEN unique');
})().catch(error => {
  console.error('FAIL read receipts:', error);
  process.exit(1);
});
