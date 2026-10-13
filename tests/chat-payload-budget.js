// ROUTINE CHAT PAYLOAD BUDGET -- no redundant >512KiB state dumps.
//   A routine chat event used to be able to re-ship the entire recent chat
//   window to every client as a full `chat:update` snapshot. With a large
//   room that single frame can exceed half a megabyte, and re-sending it per
//   event is the kind of redundancy that lets a slow socket's server-side
//   queue balloon. This test pins the delta contract:
//     * a routine Shadow Broker transmission reaches a delta-capable client
//       as a single-message `chat:delta`, never a full snapshot;
//     * that capable client never receives a >=512KiB frame even once the
//       whole window has grown well past 512KiB;
//     * a client that never declared the capability still receives every
//       message through the bounded legacy snapshot (no message loss);
//     * the one oversized legacy snapshot the server does emit is reported
//       with category and bytes only -- never payload content.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_CHAT_PAYLOAD_BUDGET_PORT) || 18826;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-chat-budget-'));
const LARGE_FRAME_BYTES = 512 * 1024;
const LARGE_TEXT = 'A'.repeat(40000);
const BURSTS = 16;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  constructor(name, capabilities = []) {
    this.name = name;
    this.capabilities = capabilities;
    this.msgs = [];
    this.deltas = [];
    this.updates = [];
    this.chat = [];
    this.maxFrame = 0;
    this.merged = new Map();
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const bytes = Buffer.byteLength(data.toString());
        if (bytes > this.maxFrame) this.maxFrame = bytes;
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') {
          return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1, clientBuild: 'test', capabilities: this.capabilities }));
        }
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'chat:delta') { this.deltas.push(m); for (const msg of m.messages || []) this.merged.set(msg.id, msg); }
        if (m.type === 'chat:update') { this.updates.push(m); this.chat = m.messages || []; }
        if (m.type === 'join:success') this.playerId = m.playerId;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(predicate, label, from = 0, timeout = 12000) {
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

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'budget-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'budget-pass' })).data.token;
    const gm = await new Client('GM', ['chat:delta']).open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host recovery');

    const joinPlayer = async (name, capabilities) => {
      const creds = { email: `${name.toLowerCase()}@budget.test`, password: 'budget-password' };
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
    const bo = await joinPlayer('Bo', []);

    // Every routine Broker transmission carries one large message. Sixteen of
    // them push the visible window past 512KiB while each individual message
    // stays far below the threshold.
    const texts = [];
    const anaMark = ana.mark();
    const boMark = bo.mark();
    for (let i = 0; i < BURSTS; i++) {
      const text = `budget-${String(i).padStart(2, '0')} ${LARGE_TEXT}`;
      texts.push(text);
      gm.send({ type: 'gm:broadcast', text });
      await sleep(70);
    }
    await bo.next(m => m.type === 'chat:update' && (m.messages || []).some(x => x.text === texts.at(-1)), 'legacy receives the last message');
    await ana.next(m => m.type === 'chat:delta' && (m.messages || []).some(x => x.text === texts.at(-1)), 'capable receives the last message');
    await sleep(300);

    // 1. The delta-capable client is served deltas, not snapshots.
    assert.equal(ana.updates.slice(anaMark).length, 0, 'a routine transmission never re-sends the full window to a capable client');
    const anaDeltas = ana.deltas.filter(m => (m.messages || []).some(x => /^budget-/.test(x.text || '')));
    assert.equal(anaDeltas.length, BURSTS, 'each routine transmission arrives as its own delta');
    assert.ok(anaDeltas.every(m => m.messages.length === 1), 'each delta carries exactly the one changed message');

    // 2. No capable-client frame ever crosses the large-frame threshold, even
    //    though the whole window is now well past it.
    assert.ok(ana.maxFrame < LARGE_FRAME_BYTES, `the capable client receives no >=512KiB frame (largest ${ana.maxFrame})`);

    // 3. The legacy client keeps working and loses nothing, but pays for the
    //    full window -- which is now genuinely large. This proves the capable
    //    client was spared a redundant >512KiB dump rather than a merely large
    //    one.
    const boLarge = bo.updates.filter(m => Buffer.byteLength(JSON.stringify(m)) >= LARGE_FRAME_BYTES);
    assert.ok(boLarge.length >= 1, 'the legacy snapshot path does cross 512KiB for this window');
    for (const text of texts) {
      assert.ok((bo.chat || []).some(x => x.text === text), 'the legacy client still receives every message');
      assert.ok([...ana.merged.values()].some(x => x.text === text), 'the capable client merged every message');
    }
    assert.ok(bo.chat.length <= 200, 'a legacy snapshot stays bounded to the recent window');

    // 4. The oversized frame the server does emit is diagnosed safely: the
    //    warning names the whitelisted category and bytes, never the payload.
    assert.match(server.errors, /\[performance\] oversized websocket frame category=chat:update bytes=\d+/, 'the oversized legacy frame is reported with category and bytes');
    assert.equal(server.errors.includes('AAAA'), false, 'diagnostics never contain payload content');
    assert.equal(server.errors.includes('budget-'), false, 'diagnostics never contain message text');

    // 5. The routine Broker path is wired to deltas, and the diagnostics module
    //    is on the send path. A future edit that restores the full-snapshot
    //    default for routine chat fails here.
    const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(source, /broadcastChatUpdate\(room, \[result\.message\.id\]\)/, 'routine Broker transmissions use the delta path');
    assert.match(source, /broadcastChatUpdate\(room, \[rollResult\.message\.id\]\)/, 'Broker rolls use the delta path');
    assert.match(source, /payloadDiagnostics\.observe\(data, bufferedBytes\)/, 'every outbound frame is classified for diagnostics');

    console.log('PASS chat payload budget: routine transmissions ship single-message deltas, capable clients stay under 512KiB, legacy clients lose nothing, oversized frames are diagnosed without content');
  } finally {
    clients.forEach(c => c.close());
    await require('./lib/stop-process')(server);
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

run().catch(error => {
  console.error('FAIL chat payload budget:', error);
  process.exit(1);
});
