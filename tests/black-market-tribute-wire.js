// BLACK MARKET PLAYER TRIBUTE // server round-trip.
//   Drives a real server: seal a pact that demands blood tribute, then walk the
//   player from BLOOD IS OWED to a submitted offering, and confirm the server
//   actually moves the pact and re-broadcasts to both sides. The client half of
//   this flow lives in tests/black-market-tribute.js; this file is the wire.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const PORT = Number(process.env.ASOC_BM_TRIBUTE_PORT) || 18831;
// Scratch data belongs on the drive the repo lives on. os.tmpdir() is the user
// profile on Windows, so the server's data dir would otherwise be written to
// C: and left behind.
const SCRATCH = process.env.ASOC_SCRATCH_DIR || path.join(ROOT, '.scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
const DATA = fs.mkdtempSync(path.join(SCRATCH, 'asoc-bm-tribute-'));

// 1x1 PNG, the smallest thing the server's data-URL guard will accept.
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
  constructor(name) {
    this.name = name;
    this.msgs = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') {
          return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1, clientBuild: 'test', capabilities: [] }));
        }
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
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

const pactOf = (message, pactId) => (message?.pacts || []).find(p => p.id === pactId);

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'tribute-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }

    const gmToken = (await api('/api/auth/gm/login', { password: 'tribute-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host recovery');

    const name = 'Ana';
    const creds = { email: 'tribute@chattest.test', password: 'chat-password' };
    await api('/api/auth/player/register', { ...creds, name });
    const token = (await api('/api/auth/player/login', { email: creds.email, password: creds.password })).data.token;
    const player = await new Client(name).open();
    clients.push(player);
    player.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
    await player.next(m => m.type === 'join:success', 'player join');
    await sleep(150);

    // 1. The player petitions, the GM sees it.
    let mark = player.mark();
    player.send({ type: 'blackMarket:petition', title: 'A FAVOR', category: 'CUSTOM', request: 'Draw me a sigil.' });
    const petitioned = await player.next(m => m.type === 'blackMarket:state', 'petition ack', mark);
    const pactId = petitioned.pacts[0].id;
    assert.equal(petitioned.pacts[0].state, 'SUBMITTED', 'a new petition waits on the Broker');

    // 2. The GM seals the pact with blood tribute demanded.
    let gmMark = gm.mark();
    gm.send({ type: 'blackMarket:gmDecision', pactId, action: 'accept', terms: '', tributeRequired: true });
    const approved = await gm.next(m => m.type === 'blackMarket:gmState', 'GM decision ack', gmMark);
    assert.equal(pactOf(approved, pactId).state, 'APPROVED_PENDING_TRIBUTE', 'the GM can seal a pact that demands blood');

    // 3. The player is told BLOOD IS OWED.
    mark = player.mark();
    player.send({ type: 'blackMarket:sync' });
    const owed = await player.next(m => m.type === 'blackMarket:state' && pactOf(m, pactId)?.state === 'APPROVED_PENDING_TRIBUTE', 'player sees BLOOD IS OWED', mark);
    assert.equal(pactOf(owed, pactId).state, 'APPROVED_PENDING_TRIBUTE', 'the player is shown BLOOD IS OWED');

    // 3. A submission without consent is refused and changes nothing.
    mark = player.mark();
    player.send({ type: 'blackMarket:tributeSubmit', pactId, imageData: PNG_DATA_URL, consent: false });
    const noConsent = await player.next(m => m.type === 'blackMarket:error', 'consent refusal', mark);
    assert.match(noConsent.message, /ACKNOWLEDGED/, 'the server insists on recorded consent');
    player.send({ type: 'blackMarket:sync' });
    const stillOwed = await player.next(m => m.type === 'blackMarket:state', 'state after refusal', mark);
    assert.equal(pactOf(stillOwed, pactId).state, 'APPROVED_PENDING_TRIBUTE', 'a refused submission does not advance the pact');

    // 4. A payload that is not an accepted data URL is refused.
    mark = player.mark();
    player.send({ type: 'blackMarket:tributeSubmit', pactId, imageData: 'javascript:alert(1)', consent: true });
    const badImage = await player.next(m => m.type === 'blackMarket:error', 'payload rejection', mark);
    assert.match(badImage.message, /INVALID/, 'a non-image payload is rejected server-side');

    // 5. An unknown pact is refused: a player cannot post into a pact id that is
    // not theirs, and the ownership check happens before any state is touched.
    mark = player.mark();
    player.send({ type: 'blackMarket:tributeSubmit', pactId: 'pact-that-does-not-exist', imageData: PNG_DATA_URL, consent: true });
    await player.next(m => m.type === 'blackMarket:error', 'unknown pact refusal', mark);

    // 6. The real submission: pact -> TRIBUTE_SUBMITTED on both sides at once.
    mark = player.mark();
    gmMark = gm.mark();
    const requestId = 'bm-wire-submit-0001';
    player.send({ type: 'blackMarket:tributeSubmit', pactId, imageData: PNG_DATA_URL, consent: true, requestId });
    const playerSees = await player.next(m => m.type === 'blackMarket:state' && pactOf(m, pactId)?.state === 'TRIBUTE_SUBMITTED', 'player sees the sealed offering', mark);
    const gmSees = await gm.next(m => m.type === 'blackMarket:gmState' && pactOf(m, pactId)?.state === 'TRIBUTE_SUBMITTED', 'GM sees the sealed offering', gmMark);
    assert.equal(pactOf(playerSees, pactId).state, 'TRIBUTE_SUBMITTED', 'the pact advances to TRIBUTE_SUBMITTED');
    assert.equal(pactOf(gmSees, pactId).state, 'TRIBUTE_SUBMITTED', 'the GM is told immediately, not on next poll');
    const persisted = await player.next(m => m.type === 'blackMarket:ack' && m.requestId === requestId, 'persisted transaction acknowledgement', mark);
    assert.equal(persisted.persisted, true);
    assert.equal(persisted.state, 'TRIBUTE_SUBMITTED');
    // The image is withheld from the player copy and delivered only to the GM.
    assert.notEqual(pactOf(playerSees, pactId).tributeImageData, PNG_DATA_URL, 'the player copy does not echo the image back');
    assert.equal(pactOf(gmSees, pactId).tributeImageData, PNG_DATA_URL, 'the GM can inspect the submitted offering');

    // 7. The GM judges it, which is the whole point of collecting it.
    mark = gm.mark();
    gm.send({ type: 'blackMarket:tributeJudge', pactId, accepted: true });
    const judged = await gm.next(m => m.type === 'blackMarket:gmState' && pactOf(m, pactId)?.state === 'OWED', 'GM accepts the offering', mark);
    assert.equal(pactOf(judged, pactId).state, 'OWED', 'an accepted offering releases the debt');
    // The projection omits the field entirely once the pact is no longer awaiting
    // judgment, so "not the image" is the assertion; what matters is that the
    // image is no longer sitting on the pact it was judged from.
    assert.notEqual(pactOf(judged, pactId).tributeImageData, PNG_DATA_URL, 'the image is consigned into the Reliquary, not left on the pact');

    // 8. A second submission is refused now that the pact is resolved.
    mark = player.mark();
    player.send({ type: 'blackMarket:tributeSubmit', pactId, imageData: PNG_DATA_URL, consent: true });
    const tooLate = await player.next(m => m.type === 'blackMarket:error', 'late submission refusal', mark);
    assert.match(tooLate.message, /NOT OWED/, 'a resolved pact cannot be re-submitted');

    // 9. GM-imposed debt is a first-class wire command. This is the exact path
    // used by CALL A DEBT and must reach both the Broker ledger and the target.
    const alCreds = { email: 'al@chattest.test', password: 'chat-password' };
    await api('/api/auth/player/register', { ...alCreds, name: 'al' });
    const alToken = (await api('/api/auth/player/login', alCreds)).data.token;
    const al = await new Client('al').open();
    clients.push(al);
    al.send({ type: 'room:join', authToken: alToken, roomCode: 'MASTER', name: 'al' });
    const alJoined = await al.next(m => m.type === 'join:success', 'al joins');
    await sleep(120);
    const demandRequestId = 'bm-wire-demand-0001';
    const alMark = al.mark();
    gmMark = gm.mark();
    gm.send({ type: 'blackMarket:gmDemandTribute', playerId: alJoined.playerId, reason: 'Lost wager.', tributeLevel: 7, requestId: demandRequestId });
    const demandAck = await gm.next(m => m.type === 'blackMarket:ack' && m.requestId === demandRequestId, 'GM imposed-debt ack', gmMark);
    assert.equal(demandAck.persisted, true, 'the imposed debt is persisted before success is reported');
    const gmDemandState = await gm.next(m => m.type === 'blackMarket:gmState' && (m.pacts || []).some(p => p.playerId === alJoined.playerId && p.tributeLevel === 7), 'GM sees imposed debt', gmMark);
    const alDemandState = await al.next(m => m.type === 'blackMarket:state' && (m.pacts || []).some(p => p.tributeLevel === 7), 'al sees imposed debt', alMark);
    const alDebt = (alDemandState.pacts || []).find(p => p.tributeLevel === 7);
    assert.equal(alDemandState.tributeLevel, 7, 'player receives the imposed rating independently of pact-card rendering');
    assert.equal(alDebt.playerId, alJoined.playerId, 'the debt lands on the live target identity');
    assert.equal(alDebt.state, 'APPROVED_PENDING_TRIBUTE');
    assert.equal(alDebt.tributeLevel, 7, 'player receives the exact imposed tribute level');
    assert.ok((gmDemandState.pacts || []).some(p => p.id === alDebt.id), 'the same debt exists in the GM ledger');

    console.log('PASS black market tribute wire: petition tribute flow plus GM-imposed debt reaches both Broker and target with the exact tribute level');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
