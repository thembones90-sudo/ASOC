// HERO ROLES (DPS / TANK / HEAL) regressions. Roles are decorative: picks
// lock when the battle goes live, a FAIL always costs WOMF (no ability can
// absorb it), the old ability messages are refused, the GM session switch
// works, Little Heroes cannot switch roles off, and roles clear after battle.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = require('../hero-roles');

function engine() {
  const s = R.createState();
  assert.equal(R.pick(s, 'a', 'dps', { locked: false }).ok, true);
  assert.equal(R.pick(s, 'a', 'dps', { locked: false }).already, true);
  assert.match(R.pick(s, 'a', 'tank', { locked: true }).error, /LOCKED/);
  assert.match(R.pick(s, 'a', 'mage', { locked: false }).error, /UNKNOWN ROLE/);
  R.pick(s, 't', 'tank', { locked: false });
  R.setEnabled(s, false);
  assert.match(R.pick(s, 'a', 'heal', { locked: false }).error, /OFF/);
  // Persistence round-trip; old ability state from earlier saves is dropped.
  const back = R.normalizeState({ ...JSON.parse(JSON.stringify(s)), used: { a: true }, marks: { A: 't' }, roleUses: { dps: 2 } });
  assert.deepEqual(back, { enabled: false, picks: { a: 'dps', t: 'tank' } });
  assert.deepEqual(Object.keys(R.view(back, { locked: true, live: true })).sort(), ['enabled', 'live', 'locked', 'picks']);
  R.clearPicks(back);
  assert.deepEqual(back.picks, {});
  console.log('PASS hero roles engine');
}

const PORT = 19451;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-roles-'));
function api(p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(t) }); } catch { resolve({ status: res.statusCode, data: t }); } }); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
class Client {
  constructor(name) { this.name = name; this.msgs = []; }
  open() { return new Promise((resolve, reject) => { this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`); this.ws.once('error', reject); this.ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 })); if (m.type === 'protocol:ready') return resolve(this); this.msgs.push(m); if (m.type === 'state:public') this.state = m; if (m.type === 'join:success') this.playerId = String(m.playerId); }); }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(pred, label, from = 0, timeout = 8000) { const t = Date.now(); while (Date.now() - t < timeout) { const f = this.msgs.slice(from).find(pred); if (f) return f; await sleep(20); } throw new Error(`${this.name}: timed out waiting for ${label}`); }
  async act(m, label) { const from = this.mark(); this.send(m); return this.next(x => (x.type === 'error' && x.code === 'HERO_ROLE') || (x.type === 'state:public' && x.heroRoles), label, from); }
  close() { try { this.ws.close(); } catch {} }
}
async function serverSuite() {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'roles-pass', ASOC_EMAIL_VERIFICATION: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gm = await new Client('GM').open(); clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: (await api('/api/auth/gm/login', { password: 'roles-pass' })).data.token });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const heroes = {};
    for (const n of ['Dps1', 'Dps2', 'Tank', 'Heal', 'Fifth']) {
      const creds = { email: `${n.toLowerCase()}@roles.test`, password: 'roles-password' };
      await api('/api/auth/player/register', { ...creds, name: n });
      const c = await new Client(n).open(); clients.push(c);
      c.send({ type: 'room:join', authToken: (await api('/api/auth/player/login', creds)).data.token, roomCode: 'MASTER', name: n });
      await c.next(m => m.type === 'join:success', 'join');
      heroes[n] = c;
    }
    const { Dps1, Dps2, Tank, Heal, Fifth } = heroes;
    let from;
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await Dps1.next(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED', 'armed');
    // Roles are disarmed until the ritual is locked in.
    let preLock = await Dps1.act({ type: 'heroRole:pick', role: 'dps' }, 'premature pick');
    assert.match(preLock.message, /LOCK IN/);
    // Start the battle.
    Object.values(heroes).forEach(c => c.send({ type: 'ritual:join' }));
    await Fifth.next(m => m.type === 'ritual:update' && m.ritual.fulfilled && !m.ritual.lockedIn, '5/5');
    // LOCK IN: Shadow Broker only; primes the game and prompts the class pick.
    Dps1.send({ type: 'ritual:lockIn' });
    await Dps1.next(m => m.type === 'error' && m.code === 'FORBIDDEN', 'hero cannot lock in');
    from = Fifth.mark(); gm.send({ type: 'ritual:lockIn' });
    await Fifth.next(m => m.type === 'ritual:update' && m.ritual.lockedIn === true, 'locked in', from);
    // RESET RITUAL un-primes it; a refilled ritual can be locked in again.
    from = Fifth.mark(); gm.send({ type: 'ritual:reset' });
    await Fifth.next(m => m.type === 'ritual:update' && m.ritual.lockedIn === false && m.ritual.joinedCount === 0, 'reset', from);
    Object.values(heroes).forEach(c => c.send({ type: 'ritual:join' }));
    await Fifth.next(m => m.type === 'ritual:update' && m.ritual.fulfilled, 'refilled', from);
    gm.send({ type: 'ritual:lockIn' });
    await Fifth.next(m => m.type === 'ritual:update' && m.ritual.lockedIn === true, 'locked in again', from);
    // Picks are accepted only in this locked-in pre-battle window.
    for (const [c, role] of [[Dps1, 'dps'], [Dps2, 'dps'], [Tank, 'tank'], [Heal, 'heal'], [Fifth, 'dps']]) {
      const picked = await c.act({ type: 'heroRole:pick', role }, `${c.name} pick`);
      assert.equal(picked.heroRoles.picks[c.playerId], role);
    }
    gm.send({ type: 'gm:timerLaunchCountdown' }); await sleep(300); gm.send({ type: 'gm:timerStart' });
    await Dps1.next(m => m.type === 'state:public' && m.roomMode === 'BATTLE', 'battle live', 0, 15000);
    const roster = (await Dps1.next(m => m.type === 'players:update' && m.players.some(p => String(p.id) === Tank.playerId && p.heroRole), 'live roster')).players;
    assert.equal(roster.find(p => String(p.id) === Tank.playerId).heroRole, 'tank');
    let err = await Dps1.act({ type: 'heroRole:pick', role: 'heal' }, 'locked pick');
    assert.match(err.message, /LOCKED/);
    // Decorative: the old abilities are gone and a FAIL always costs WOMF.
    from = Fifth.mark();
    Dps1.send({ type: 'heroRole:burst', column: 'A' });
    Tank.send({ type: 'heroRole:lastStand', column: 'C' });
    await sleep(400);
    assert.ok(!Fifth.msgs.slice(from).some(m => m.type === 'heroRole:burst'), 'no BURST reaches the room');
    const womfBefore = Tank.state.womf.charge;
    from = Tank.mark(); gm.send({ type: 'gm:failColumn', column: 'C' });
    let st = await Tank.next(m => m.type === 'state:public' && m.cells.C5?.revealed, 'C failed', from);
    assert.equal(st.womf.charge, womfBefore + 1, 'a FAIL costs WOMF whatever the roles');
    // Roles are permanently enabled; there is no redundant GM toggle.
    assert.equal(st.heroRoles.enabled, true);
    // RESET BOARD ends the role assignment; no old badge reaches the roster.
    from = Dps1.mark(); gm.send({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId: 1 });
    st = await Dps1.next(m => m.type === 'state:public' && m.heroRoles && m.roomMode !== 'BATTLE', 'reset', from, 10000);
    assert.deepEqual(st.heroRoles.picks, {}, 'picks clear for the next battle');
    const resetRoster = (await Dps1.next(m => m.type === 'players:update', 'reset roster', from)).players;
    assert.equal(resetRoster.find(p => String(p.id) === Tank.playerId).heroRole, null, 'roles are absent outside a live battle');
    assert.equal(errors.trim(), '');
    console.log('PASS hero roles server');
  } finally {
    clients.forEach(c => c.close());
    server.kill('SIGTERM'); await new Promise(r => server.once('exit', r));
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => { engine(); await serverSuite(); })().catch(e => { console.error(e); process.exit(1); });
