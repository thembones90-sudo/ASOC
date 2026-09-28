// QUEST REWARD ATOMICITY (M2) + ONE-TIME ADMIN GRANT (M3) regression coverage.
//   - quest COMPLETED only after the Shadow Coin reward is durably paid
//   - a payment that landed before a crash is never paid twice on retry
//   - a storage failure leaves the quest CLAIMED and retryable
//   - coin mutators report a refused save as a failure (no phantom success)
//   - administrative grants: creation cutoff, exactly-once, never at startup
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_QUEST_ATOMIC_TEST_PORT) || 18897;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const GRANT_RECEIPT = 'admin:global-grant:2026-09-28:10';

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
  constructor(name) { this.name = name; this.msgs = []; this.closed = false; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('close', () => { this.closed = true; });
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
  async next(predicate, label, from = 0, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { const f = this.msgs.slice(from).find(predicate); if (f) return f; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

function startServer(DATA) {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'qa-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  return server;
}
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); } throw new Error('server not ready'); }
async function stop(server) { if (server.exitCode !== null) return; server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }

async function gmClient() {
  const token = (await api('/api/auth/gm/login', { password: 'qa-pass' })).data.token;
  const gm = await new Client('GM').open();
  gm.send({ type: 'host:recover', gmToken: token });
  await gm.next(m => m.type === 'host:recovered', 'host');
  return gm;
}
async function hero(register) {
  const creds = { email: 'contractor@qa.test', password: 'qa-password' };
  if (register) await api('/api/auth/player/register', { ...creds, name: 'Contractor' });
  const token = (await api('/api/auth/player/login', creds)).data.token;
  const c = await new Client('Hero').open();
  c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name: 'Contractor' });
  await c.next(m => m.type === 'join:success', 'join');
  return c;
}
async function claimedQuest(gm, target, directive) {
  let from = gm.mark();
  gm.send({ type: 'gm:questCreate', targetPlayerId: target.playerId, directive, rewardCoins: 3, durationMs: 600000, visibility: 'PRIVATE' });
  const quest = (await gm.next(m => m.type === 'quest:update' && m.active.some(q => q.directive === directive), 'offer', from)).active.find(q => q.directive === directive);
  from = target.mark();
  target.send({ type: 'player:questAccept', questId: quest.id });
  await target.next(m => m.type === 'quest:update' && m.active.some(q => q.id === quest.id && q.status === 'ACTIVE'), 'accept', from);
  from = target.mark();
  target.send({ type: 'player:questClaim', questId: quest.id });
  await target.next(m => m.type === 'quest:update' && m.active.some(q => q.id === quest.id && q.status === 'CLAIMED'), 'claim', from);
  return quest;
}
const readPlayers = DATA => JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
const receiptCount = (profile, receipt) => (profile.shadowCoinLedger || []).filter(e => e.id === receipt).length;

function unitGrantAndLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-qa-unit-'));
  try {
    const script = `
      const assert = require('assert/strict');
      const fs = require('fs');
      const store = require(${JSON.stringify(path.join(ROOT, 'player-store.js'))});
      store.getOrCreateProfile({ id: 'lh-old', name: 'Old' });
      store.getOrCreateProfile({ id: 'lh-new', name: 'New' });
      const db = store.loadPlayers();
      db['lh-old'].createdAt = '2026-09-27T10:00:00.000Z';
      db['lh-new'].createdAt = '2026-09-29T10:00:00.000Z';
      store.savePlayersAtomic(db);
      const r1 = store.grantAllShadowCoins(10, 'admin:test:1', { createdBefore: '2026-09-28T23:59:59+02:00' });
      assert.equal(r1.granted, 1); assert.equal(r1.ineligible, 1);
      const r2 = store.grantAllShadowCoins(10, 'admin:test:1', { createdBefore: '2026-09-28T23:59:59+02:00' });
      assert.equal(r2.granted, 0, 'a re-run pays nobody twice');
      assert.equal(store.getShadowCoins({ id: 'lh-old' }), 10);
      assert.equal(store.getShadowCoins({ id: 'lh-new' }), 0, 'later accounts are not granted');
      // A refused save is a failure, never a phantom success.
      const file = ${JSON.stringify(path.join(dir, 'players.json'))};
      fs.writeFileSync(file, '{broken'); fs.writeFileSync(file + '.bak', '{broken');
      const paid = store.awardShadowCoins({ id: 'lh-old', name: 'Old' }, 1, 'unit:award:1');
      assert.equal(paid.ok, false, 'award reports failure when storage refuses the write');`;
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, ASOC_DATA_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

(async () => {
  unitGrantAndLedger();

  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-qa-'));
  let server = startServer(DATA);
  let clients = [];
  const closeAll = async () => { clients.forEach(c => c.close()); clients = []; await sleep(300); };
  try {
    await ready();
    let gm = await gmClient(); let target = await hero(true); clients.push(gm, target);
    const playerId = target.playerId;

    // 1. Payment landed, quest transition lost (crash window): retry never double-pays.
    const crashed = await claimedQuest(gm, target, 'CRASH WINDOW CONTRACT');
    await closeAll(); await stop(server);
    const db = readPlayers(DATA);
    const profile = db[playerId];
    const receipt = `quest:${crashed.id}:reward`;
    profile.shadowCoinUnits += 30; profile.shadowCoins = profile.shadowCoinUnits / 10;
    profile.shadowCoinReceipts.push(receipt);
    profile.shadowCoinLedger.push({ id: receipt, at: new Date().toISOString(), delta: 3, balance: profile.shadowCoins, kind: 'reward', reason: 'paid before crash' });
    fs.writeFileSync(path.join(DATA, 'players.json'), JSON.stringify(db, null, 2));
    const paidBefore = profile.shadowCoinUnits;

    server = startServer(DATA); await ready();
    gm = await gmClient(); clients.push(gm);
    let from = gm.mark();
    gm.send({ type: 'gm:questComplete', questId: crashed.id });
    await gm.next(m => m.type === 'quest:update' && m.history.some(q => q.id === crashed.id && q.status === 'COMPLETED'), 'completed after retry', from);
    await sleep(300);
    let after = readPlayers(DATA)[playerId];
    assert.equal(after.shadowCoinUnits, paidBefore, 'retry after a landed payment does not pay again');
    assert.equal(receiptCount(after, receipt), 1, 'exactly one ledger entry for the quest reward');
    assert.ok(!(after.shadowCoinReceipts || []).includes(GRANT_RECEIPT), 'a restart never applies the 2026-09-28 grant to a later account');

    // 2. Storage fails during completion: the quest stays CLAIMED and retryable.
    target = await hero(false); clients.push(target);
    const fragile = await claimedQuest(gm, target, 'STORAGE FAILURE CONTRACT');
    const goodCopy = fs.readFileSync(path.join(DATA, 'players.json'), 'utf8');
    fs.writeFileSync(path.join(DATA, 'players.json'), '{broken');
    fs.writeFileSync(path.join(DATA, 'players.json.bak'), '{broken');
    from = gm.mark();
    gm.send({ type: 'gm:questComplete', questId: fragile.id });
    await sleep(1200);
    assert.ok(!gm.msgs.slice(from).some(m => m.type === 'quest:update' && m.history?.some(q => q.id === fragile.id && q.status === 'COMPLETED')), 'no COMPLETED without a durable payment');
    await closeAll(); await stop(server);
    fs.writeFileSync(path.join(DATA, 'players.json'), goodCopy);
    fs.writeFileSync(path.join(DATA, 'players.json.bak'), goodCopy);
    const unitsBeforeRetry = JSON.parse(goodCopy)[playerId].shadowCoinUnits;

    server = startServer(DATA); await ready();
    gm = await gmClient(); clients.push(gm);
    from = gm.mark();
    gm.send({ type: 'quest:sync' });
    const synced = await gm.next(m => m.type === 'quest:update', 'quest sync', from);
    assert.equal(synced.active.find(q => q.id === fragile.id)?.status, 'CLAIMED', 'quest survived the failure still CLAIMED');
    from = gm.mark();
    gm.send({ type: 'gm:questComplete', questId: fragile.id });
    await gm.next(m => m.type === 'quest:update' && m.history.some(q => q.id === fragile.id && q.status === 'COMPLETED'), 'completed on retry', from);
    await sleep(300);
    after = readPlayers(DATA)[playerId];
    assert.equal(after.shadowCoinUnits, unitsBeforeRetry + 30, 'retry pays exactly once');
    assert.equal(receiptCount(after, `quest:${fragile.id}:reward`), 1);
    assert.equal(server.errors.trim(), '', 'no server errors after recovery');
  } finally {
    await closeAll();
    try { await stop(server); } catch {}
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  console.log('PASS quest reward atomicity + admin grant: pay-then-complete, landed payments never repaid, storage failure leaves the quest retryable, refused saves are failures, grants honour a creation cutoff exactly once and never run at startup');
})().catch(error => {
  console.error('FAIL quest reward atomicity:', error);
  process.exit(1);
});
