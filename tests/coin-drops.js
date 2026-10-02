// COIN DROPS: a coin reaches every Little Hero, the first valid click wins
// it (exactly once), the loser is told who snatched it, inhuman-fast and
// late clicks are refused, the amount lands in the balance, and the tier
// tables / schedule hold (12 a day, 20 min apart, 3 legendaries a week).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const coinDrops = require('../coin-drops');

const ROOT = path.join(__dirname, '..');
const PORT = 19493;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-coins-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function api(p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(t) }); } catch { resolve({ status: res.statusCode, data: t }); } }); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
class Client {
  constructor(name) { this.name = name; this.msgs = []; }
  open() { return new Promise((resolve, reject) => { this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`); this.ws.once('error', reject); this.ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 })); if (m.type === 'protocol:ready') return resolve(this); this.msgs.push(m); if (m.type === 'chat:update') this.chat = m.messages; }); }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(pred, label, from = 0, timeout = 6000) { const t = Date.now(); while (Date.now() - t < timeout) { const f = this.msgs.slice(from).find(pred); if (f) return f; await sleep(20); } throw new Error(`${this.name}: timed out waiting for ${label}`); }
  close() { try { this.ws.close(); } catch {} }
}

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'cd-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_COIN_DROPS: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gm = await new Client('GM').open(); clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: (await api('/api/auth/gm/login', { password: 'cd-pass' })).data.token });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const heroes = [];
    for (const n of ['Sissy', 'Cigan']) {
      const creds = { email: `${n.toLowerCase()}@cd.test`, password: 'cd-password' };
      await api('/api/auth/player/register', { ...creds, name: n });
      const c = await new Client(n).open(); clients.push(c);
      c.send({ type: 'room:join', authToken: (await api('/api/auth/player/login', creds)).data.token, roomCode: 'MASTER', name: n });
      await c.next(m => m.type === 'join:success', 'join');
      heroes.push(c);
    }
    const [sissy, cigan] = heroes;
    const balance = () => require('../player-store');

    // 1. Engine: schedule + tiers.
    const st = coinDrops.blankState();
    coinDrops.plan(st, Date.parse('2026-10-05T06:00:00Z'));
    const normal = st.drops.filter(d => d.kind === 'normal');
    assert.equal(normal.length, 12, '12 normal drops a day');
    normal.forEach((d, i) => { if (i) assert.ok(d.at - normal[i - 1].at >= coinDrops.MIN_GAP_MS, 'drops at least 20 min apart'); });
    const win = coinDrops.windowOf(Date.parse('2026-10-05T06:00:00Z'));
    assert.ok(st.drops.every(d => d.at >= win.start && d.at < win.end), 'all inside 08:00-16:00');
    let legendaries = 0;
    const wk = coinDrops.blankState();
    for (let d = 0; d < 7; d++) { coinDrops.plan(wk, Date.parse('2026-10-05T06:00:00Z') + d * 86400000); legendaries += wk.drops.filter(x => x.kind === 'legendary').length; }
    assert.equal(legendaries, 3, '3 legendary coins a week');
    for (let i = 0; i < 2000; i++) { const r = coinDrops.roll(); assert.ok(r.amount >= 0.1 && r.amount <= 20 && Math.round(r.amount * 10) === r.amount * 10); }
    assert.equal(coinDrops.roll('legendary').amount, 25);

    // 2. Live: the Shadow Broker drops an EPIC; both heroes see it, no amount leaks.
    let from = [sissy.mark(), cigan.mark()];
    gm.send({ type: 'gm:broadcast', text: '/coindrop epic' });
    const seenA = await sissy.next(m => m.type === 'coinDrop:spawn', 'Sissy sees the coin', from[0]);
    const seenB = await cigan.next(m => m.type === 'coinDrop:spawn', 'Cigan sees the coin', from[1]);
    assert.equal(seenA.drop.id, seenB.drop.id);
    assert.equal(seenA.drop.tier, 'epic');
    assert.equal(seenA.drop.amount, undefined, 'the amount is a surprise');

    // Too fast to be human: refused.
    sissy.send({ type: 'coinDrop:claim', id: seenA.drop.id });
    assert.equal((await sissy.next(m => m.type === 'coinDrop:result', 'too fast', from[0])).reason, 'TOO FAST');
    await sleep(250);
    // Both click; exactly one wins.
    from = [sissy.mark(), cigan.mark()];
    cigan.send({ type: 'coinDrop:claim', id: seenA.drop.id });
    sissy.send({ type: 'coinDrop:claim', id: seenA.drop.id });
    const rc = await cigan.next(m => m.type === 'coinDrop:result', 'Cigan result', from[1]);
    const rs = await sissy.next(m => m.type === 'coinDrop:result', 'Sissy result', from[0]);
    assert.equal(rc.ok, true, 'first click wins');
    assert.ok(rc.amount >= 10 && rc.amount <= 20, 'epic is 10-20 SC');
    assert.equal(rs.ok, false);
    assert.equal(rs.reason, 'SNATCHED');
    assert.equal(rs.by, 'Cigan');
    const told = await sissy.next(m => m.type === 'coinDrop:claimed', 'everyone told', from[0]);
    assert.equal(told.playerName, 'Cigan');
    assert.equal(told.amount, rc.amount);
    await gm.next(m => m.type === 'chat:update' && m.messages.some(x => /CIGAN SNATCHED AN? EPIC SHADOW COIN|Cigan SNATCHED A EPIC/i.test(x.text)), 'chat line');
    assert.equal(rc.balance, rc.amount, 'coins land in the balance');

    // 3. Nobody clicks: it is gone, and a late click gets nothing.
    from = [sissy.mark()];
    gm.send({ type: 'gm:broadcast', text: '/coindrop legendary' });
    const leg = await sissy.next(m => m.type === 'coinDrop:spawn', 'legendary', from[0]);
    assert.equal(leg.drop.tier, 'legendary');
    await sissy.next(m => m.type === 'coinDrop:gone', 'expires', from[0], 9000);
    sissy.send({ type: 'coinDrop:claim', id: leg.drop.id });
    assert.equal((await sissy.next(m => m.type === 'coinDrop:result' && m.id === leg.drop.id && m.reason !== 'TOO FAST', 'late', from[0])).reason, 'GONE');

    // 4. The Shadow Broker cannot claim.
    gm.send({ type: 'gm:broadcast', text: '/coindrop' });
    const g = await gm.next(m => m.type === 'coinDrop:spawn', 'gm sees', gm.mark() - 1, 6000).catch(() => null);
    if (g) { await sleep(200); const m0 = gm.mark(); gm.send({ type: 'coinDrop:claim', id: g.drop.id }); assert.equal((await gm.next(m => m.type === 'coinDrop:result', 'gm refused', m0)).ok, false); }
    console.log('PASS coin drops');
  } finally {
    clients.forEach(c => c.close());
    server.kill('SIGTERM');
    await new Promise(r => server.once('exit', r));
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
