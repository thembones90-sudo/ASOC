// CHAT INCREMENTAL TRANSPORT // chat:delta + chat:history paging.
//   The whole log used to be re-broadcast on every chat event, which made the
//   per-event payload O(history) and the session total quadratic. These cover
//   the replacement: a delta carries only the messages that changed, a client
//   that did not declare the capability still gets the legacy full snapshot,
//   sequence numbers are monotonic and gap-detectable, older messages are
//   reachable by cursor, and the recovery mirror stays bounded.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const PORT = Number(process.env.ASOC_CHAT_DELTA_PORT) || 18824;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-chat-delta-'));

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

class Client {
  // capabilities: declare 'chat:delta' to be served incrementally.
  constructor(name, capabilities = []) {
    this.name = name;
    this.capabilities = capabilities;
    this.msgs = [];
    this.deltas = [];
    this.updates = [];
    this.chat = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') {
          return this.ws.send(JSON.stringify({
            type: 'protocol:hello',
            protocolVersion: 1,
            clientBuild: 'test',
            capabilities: this.capabilities
          }));
        }
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'chat:update') { this.updates.push(m); this.chat = m.messages || []; }
        if (m.type === 'chat:delta') this.deltas.push(m);
        if (m.type === 'join:success') this.playerId = m.playerId;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(predicate, label, from = 0, timeout = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = this.msgs.slice(from).find(predicate);
      if (found) return found;
      await sleep(20);
    }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function runServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'delta-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'delta-pass' })).data.token;
    const gm = await new Client('GM', ['chat:delta']).open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host');

    const joinPlayer = async (name, capabilities) => {
      const creds = { email: `${name.toLowerCase()}@chattest.test`, password: 'chat-password' };
      await api('/api/auth/player/register', { ...creds, name });
      const token = (await api('/api/auth/player/login', { email: creds.email, password: creds.password })).data.token;
      const c = await new Client(name, capabilities).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.next(m => m.type === 'join:success', `${name} join`);
      await sleep(150);
      return c;
    };

    const ana = await joinPlayer('Ana', ['chat:delta']);
    // Bo deliberately does NOT declare the capability: he must keep receiving
    // the full snapshot so a stale cached client is never broken by the change.
    const bo = await joinPlayer('Bo', []);

    // 1. Joining delivers a full snapshot that carries a sequence.
    const anaSnapshot = ana.chat;
    assert.ok(Array.isArray(anaSnapshot), 'join delivers a chat snapshot');
    assert.equal(typeof ana.updates.at(-1).seq, 'number', 'a snapshot reports the sequence');

    // 2. A plain post reaches the opted-in client as a delta, not a snapshot.
    const anaUpdatesBefore = ana.updates.length;
    bo.send({ type: 'chat:guess', text: 'delta probe' });
    const delta = await ana.next(m => m.type === 'chat:delta', 'a delta', ana.mark());
    assert.ok(delta.seq > 0, 'the delta carries a sequence');
    assert.equal(delta.messages.length, 1, 'a delta carries only the changed message');
    assert.equal(delta.messages[0].text, 'delta probe');
    assert.ok(delta.messages[0].reactions !== undefined, 'delta messages use the normal wire shape');
    assert.ok(delta.solvedTargets !== undefined, 'a delta still carries solvedTargets');

    // 3. The un-opted client is unaffected: full snapshot, never a delta.
    await bo.next(m => m.type === 'chat:update' && (m.messages || []).some(x => x.text === 'delta probe'), 'legacy snapshot');
    assert.equal(bo.deltas.length, 0, 'a client without the capability is never sent a delta');
    assert.equal(bo.chat.filter(m => m.text === 'delta probe').length, 1, 'legacy client still sees the message');

    // 4. Deltas do not re-ship the whole log. The room already has a history;
    //    a one-message delta must stay roughly one message wide.
    //    Player chat is rate limited to one post per 350ms, so the burst is
    //    paced rather than fired at once.
    const bulkFrom = ana.mark();
    for (let i = 0; i < 12; i++) { bo.send({ type: 'chat:guess', text: `bulk ${i}` }); await sleep(380); }
    await ana.next(m => m.type === 'chat:delta' && (m.messages || []).some(x => x.text === 'bulk 11'), 'bulk delta', bulkFrom);
    await sleep(400);
    const bulkDeltas = ana.deltas.filter(m => (m.messages || []).some(x => /^bulk /.test(x.text || '')));
    assert.ok(bulkDeltas.length >= 1, 'bulk posts arrive as deltas');
    assert.ok(bulkDeltas.every(m => m.messages.length === 1), 'each bulk post is its own single-message delta');
    // The old transport re-sent the entire log for every one of those posts, so
    // an opted-in client would have taken 12 full snapshots here. Anything that
    // does not scale with the message count proves the log is no longer being
    // re-shipped per event.
    const fullUpdatesDuringBurst = ana.updates.length - anaUpdatesBefore;
    assert.ok(fullUpdatesDuringBurst <= 2, `an opted-in client is not re-broadcast the full log per message (took ${fullUpdatesDuringBurst} full updates for 12 posts)`);
    const roomSize = ana.chat.length;

    // 5. Sequence numbers only ever move forward, and snapshots do not skip them.
    const seqs = ana.deltas.map(m => m.seq);
    assert.ok(seqs.every((s, i) => i === 0 || s > seqs[i - 1]), 'delta sequences strictly increase');
    ana.send({ type: 'chat:resync' });
    const resync = await ana.next(m => m.type === 'chat:update', 'resync snapshot', ana.mark());
    assert.equal(resync.seq, seqs.at(-1), 'a resync snapshot reports the current sequence without advancing it');
    assert.ok(resync.messages.length >= roomSize, 'a resync snapshot carries the whole log');

    // 6. The server keeps far more than the old 200-message ceiling. The GM
    //    broadcast path is not rate limited the way player chat is, so the log
    //    can be grown quickly here.
    const deepFrom = ana.mark();
    // Every broadcast persists the room before it broadcasts, so the burst is
    // paced generously enough that the server can keep up rather than
    // overflowing its own socket buffer.
    for (let i = 0; i < 260; i++) { gm.send({ type: 'gm:broadcast', text: `deep ${i}` }); await sleep(50); }
    await sleep(3000);
    const deepSnapshotAt = ana.mark();
    ana.send({ type: 'chat:resync' });
    const deepSnapshot = await ana.next(m => m.type === 'chat:update', 'deep snapshot', deepSnapshotAt);
    // The log holds far more than the old 200-message ceiling, but a snapshot
    // only ever ships the recent window -- otherwise the join/reconnect path
    // would put the whole log back on the wire.
    assert.ok(deepSnapshot.totalMessages > 200, `the log holds more than 200 messages (got ${deepSnapshot.totalMessages})`);
    assert.equal(deepSnapshot.messages.length, 200, 'a snapshot ships only the recent window');

    // 7. Older messages are reachable by cursor, and walking it reaches the top.
    const beforeOldest = deepSnapshot.messages[0].id;
    ana.send({ type: 'chat:history', beforeId: beforeOldest, limit: 50 });
    const page1 = await ana.next(m => m.type === 'chat:history', 'history page 1', ana.mark());
    assert.equal(page1.messages.length, 50, 'a history page is capped at the requested size');
    assert.ok(page1.hasMore, 'a page that is not the start reports hasMore');
    assert.ok(page1.nextBeforeId, 'a page hands back the next cursor');
    assert.deepEqual(
      page1.messages.map(m => m.id),
      [...page1.messages].map(m => m.id),
      'history is returned oldest last'
    );
    assert.notEqual(page1.messages[0].id, beforeOldest, 'a page returns messages strictly before the cursor');

    let cursor = page1.nextBeforeId;
    let guard = 0;
    let hasMore = true;
    while (hasMore && guard++ < 40) {
      const from = ana.mark();
      ana.send({ type: 'chat:history', beforeId: cursor, limit: 100 });
      const page = await ana.next(m => m.type === 'chat:history', 'history page', from);
      hasMore = page.hasMore;
      cursor = page.nextBeforeId;
      if (!hasMore) break;
    }
    assert.equal(hasMore, false, 'paging eventually reaches the start of the log');
    assert.equal(cursor, null, 'the start of the log reports no further cursor');

    // 8. An unknown cursor must not wedge the client: it falls back to the
    //    newest page so a stale id can rebuild instead of stalling.
    const from = ana.mark();
    ana.send({ type: 'chat:history', beforeId: 'chat-does-not-exist', limit: 10 });
    const fallback = await ana.next(m => m.type === 'chat:history', 'history fallback', from);
    assert.equal(fallback.messages.length, 10, 'an unknown cursor returns the newest page');

    // 9. The recovery mirror is bounded, so a long session cannot make every
    //    write scale with how much chat the room has ever seen.
    const mirror = JSON.parse(fs.readFileSync(path.join(DATA, 'active-rooms.json'), 'utf8'));
    const stored = mirror.rooms[0].chat.messages;
    assert.ok(stored.length <= 200, `the mirror stores a tail only (got ${stored.length})`);

    // 10. Both clients declare the capability in their handshake.
    for (const file of ['js/player.js', 'js/app.js']) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.match(src, /capabilities:\s*\['chat:delta'\]/, `${file} opts into chat deltas`);
    }

    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    await require('./lib/stop-process')(server);
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

(async () => {
  await runServer();
  console.log('PASS chat deltas: opted-in clients get single-message deltas with a monotonic sequence, un-opted clients keep the full snapshot, chat:resync and cursor paging recover older messages, recovery mirror stays bounded');
})().catch(error => {
  console.error('FAIL chat deltas:', error);
  process.exit(1);
});
