// SHADOW COINS: ASOC's persistent account-level currency.
//   Store: default 0, persistence, idempotent award/spend, sufficient-balance
//          check, generic counters cannot touch it, renames keep it, never
//          keyed by display name.
//   Live: a KALADONT win pays exactly +1 to the winner only; cancelled
//          lobbies pay nothing; reconnect, logout/login, rename and a server
//          restart neither lose nor duplicate it; clients cannot set it;
//          Battle / WOMF / scores are untouched.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
function checkStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-coins-store-'));
  process.env.ASOC_DATA_DIR = dir;
  const storePath = require.resolve('../player-store');
  const durablePath = require.resolve('../durable-io');
  const fresh = () => { delete require.cache[storePath]; delete require.cache[durablePath]; return require('../player-store'); };
  try {
    let store = fresh();
    const ana = { id: 'acct-ana', name: 'Ana' };
    // 1. new accounts start at 0
    assert.equal(store.getOrCreateProfile(ana).profile.shadowCoins, 0);
    assert.equal(store.getShadowCoins(ana), 0);
    // award + 11. the same receipt never pays twice
    assert.equal(store.awardShadowCoins(ana, 1, 'test:win-1').balance, 1);
    assert.equal(store.awardShadowCoins(ana, 1, 'test:win-1').duplicate, true);
    assert.equal(store.getShadowCoins(ana), 1);
    assert.equal(store.awardShadowCoins(ana, 2, 'test:win-2').balance, 3);
    assert.equal(store.awardShadowCoins(ana, 0, 'x').ok, false, 'awards are positive whole numbers');
    assert.equal(store.awardShadowCoins(ana, 1.5, 'y').ok, false);
    assert.equal(store.awardShadowCoins(ana, 1).ok, false, 'an award needs a receipt');
    // 12. generic counters (and so any stat path) cannot move the currency
    store.adjustProfile(ana, { statDeltas: { shadowCoins: 500 } });
    assert.equal(store.getShadowCoins(ana), 3, 'adjustProfile cannot touch Shadow Coins');
    store.updateProfileAppearance(ana, { shadowCoins: 999, frameColor: '#112233' });
    assert.equal(store.getShadowCoins(ana), 3, 'appearance updates cannot touch Shadow Coins');
    // 15. spending foundation: sufficient balance, idempotent, never negative
    assert.equal(store.spendShadowCoins(ana, 5, 'buy:too-much').ok, false);
    assert.equal(store.spendShadowCoins(ana, 2, 'buy:title-1').balance, 1);
    assert.equal(store.spendShadowCoins(ana, 2, 'buy:title-1').duplicate, true, 'a purchase never charges twice');
    assert.equal(store.getShadowCoins(ana), 1);
    // 9. rename keeps the balance; the display name is never the key
    store.awardShadowCoins({ id: 'acct-ana', name: 'Anastasia' }, 1, 'test:win-3');
    assert.equal(store.getShadowCoins({ id: 'acct-ana', name: 'Totally Different' }), 2);
    assert.equal(store.getShadowCoins('Ana'), 0, 'a bare name never reads a balance');
    assert.throws(() => store.awardShadowCoins('Ana', 1, 'by-name'), /account identity/);
    // 2. persists across a reload
    store = fresh();
    assert.equal(store.getShadowCoins(ana), 2, 'the balance survives a restart');
    assert.equal(store.awardShadowCoins(ana, 1, 'test:win-3').duplicate, true, 'receipts survive a restart');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.ASOC_DATA_DIR;
  }
}

// ---------------------------------------------------------------------------
const PORT = Number(process.env.ASOC_COINS_TEST_PORT) || 18803;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-coins-'));

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
  constructor(name) { this.name = name; this.msgs = []; this.kal = null; this.players = []; this.state = null; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'kaladont:state') this.kal = m.state;
        if (m.type === 'players:update') this.players = m.players || [];
        if (m.type === 'state:public') this.state = m;
        if (m.type === 'join:success') this.playerId = m.playerId;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async waitKal(predicate, label, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { if (predicate(this.kal)) return this.kal; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  async waitFor(predicate, label, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { const f = this.msgs.find(predicate); if (f) return f; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'coin-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_KALADONT_VERDICT_MS: '200' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  return server;
}

async function healthy() {
  for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); }
  throw new Error('server not healthy');
}

async function runServer() {
  let server = spawnServer();
  const clients = [];
  try {
    await healthy();
    const gmLogin = async () => (await api('/api/auth/gm/login', { password: 'coin-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: await gmLogin() });
    await gm.waitFor(m => m.type === 'host:recovered', 'host');
    const creds = {};
    const connect = async (name, joinName = name, extra = {}) => {
      if (!creds[name]) {
        creds[name] = { email: `${name.toLowerCase()}@coin.test`, password: 'coin-password' };
        await api('/api/auth/player/register', { ...creds[name], name });
      }
      const token = (await api('/api/auth/player/login', creds[name])).data.token; // a fresh login every time
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name: joinName, ...extra });
      await c.waitFor(m => m.type === 'join:success', `${name} join`);
      await sleep(150);
      return c;
    };
    const coins = (viewer, id) => viewer.players.find(p => p.id === id)?.shadowCoins;

    const ana = await connect('Ana');
    const bo = await connect('Bo');
    const cy = await connect('Cy');
    await sleep(200);
    // 14. exposed through player state, 1. default 0
    assert.equal(coins(gm, ana.playerId), 0);
    const womfBefore = JSON.stringify(gm.state.womf);

    // 6. a cancelled lobby pays nothing
    ana.send({ type: 'kaladont:create' });
    await ana.waitKal(k => k?.phase === 'lobby', 'lobby');
    ana.send({ type: 'kaladont:cancel' });
    await ana.waitKal(k => k === null, 'lobby cancelled');
    await sleep(200);
    assert.equal(coins(gm, ana.playerId), 0, 'a cancelled lobby pays nothing');

    // A real match: Ana + Bo play, Cy watches from outside.
    ana.send({ type: 'kaladont:create' });
    await bo.waitKal(k => k?.phase === 'lobby', 'lobby 2');
    bo.send({ type: 'kaladont:join' });
    await ana.waitKal(k => k?.members?.length === 2, 'two joined');
    ana.send({ type: 'kaladont:start' });
    const turn = await gm.waitKal(k => k?.phase === 'turn', 'started');
    const byId = { [ana.playerId]: ana, [bo.playerId]: bo };
    const first = byId[turn.turn.playerId];
    const other = first === ana ? bo : ana;
    first.send({ type: 'kaladont:submit', word: 'kaladont', turnSeq: turn.turn.seq }); // KALADONT kills the only rival
    const ended = await first.waitKal(k => k?.phase === 'ended' && k.reward, 'win settled');
    assert.equal(ended.winnerId, first.playerId);
    assert.equal(ended.reward.amount, 1);
    assert.equal(ended.reward.balance, 1, 'the winner sees the new balance');
    assert.equal(other.kal.reward.balance, null, 'others do not see the winner balance');
    await sleep(300);
    // 3. / 4. / 5. winner +1 exactly, loser and spectator nothing
    assert.equal(coins(gm, first.playerId), 1, 'winner receives exactly +1');
    assert.equal(coins(gm, other.playerId), 0, 'loser receives nothing');
    assert.equal(coins(gm, cy.playerId), 0, 'a spectator receives nothing');
    const lastChat = [...gm.msgs].reverse().find(m => m.type === 'chat:update').messages.map(m => m.text);
    assert.ok(lastChat.some(t => /WINS KALADONT \+1 SHADOW COIN/.test(t || '')), 'the winner line announces the coin');

    // 12. the client cannot set its balance (join payload / unknown message)
    first.send({ type: 'player:setShadowCoins', value: 9999 });
    first.close();
    await sleep(250);
    // 10. + 7. reconnect with a fresh login, 9. under a new display name
    const again = await connect(first.name, `${first.name} Renamed`, { shadowCoins: 9999 });
    await sleep(250);
    assert.equal(coins(gm, again.playerId), 1, 'reconnect / login / rename / forged fields keep exactly 1');
    // 11. the same finished match never pays again (the clock keeps ticking over it)
    await sleep(800);
    assert.equal(coins(gm, again.playerId), 1);
    // 13. no Battle/WOMF/scoring side effects
    assert.equal(JSON.stringify(gm.state.womf), womfBefore, 'WOMF untouched');
    assert.equal(gm.state.roomMode, 'CASUAL');
    assert.equal(gm.players.find(p => p.id === again.playerId)?.score, 0, 'session score untouched');

    // 8. restart: the balance persists and the restored ended match does not re-pay
    const winnerId = again.playerId;
    clients.forEach(c => c.close());
    clients.length = 0;
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    server = spawnServer();
    await healthy();
    const gm2 = await new Client('GM2').open();
    clients.push(gm2);
    gm2.send({ type: 'host:recover', gmToken: await gmLogin() });
    await gm2.waitFor(m => m.type === 'host:recovered', 'host after restart');
    const back = await connect(first.name);
    await sleep(900);
    assert.equal(coins(gm2, winnerId), 1, 'the balance survives a restart without a second payout');
    const persisted = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
    const profile = Object.values(persisted).find(p => p.accountId === winnerId || p.id === winnerId);
    assert.equal(profile.shadowCoins, 1);
    assert.ok(profile.shadowCoinReceipts.some(r => r.startsWith('kaladont:')), 'the award receipt is recorded');
    void back;

    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  checkStore();
  await runServer();
  console.log('PASS Shadow Coins: account currency (default 0, persistent, idempotent award/spend, rename-safe, not client-settable); KALADONT win pays exactly +1 once, nothing to losers/spectators/cancelled lobbies; survives reconnect, login and restart; Battle untouched');
})().catch(error => {
  console.error('FAIL Shadow Coins:', error);
  process.exit(1);
});
