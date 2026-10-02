// HERO ROLES (DPS / TANK / HEAL) regressions: the pure rules (hero-roles.js)
// and a real server battle: picks lock when the battle goes live, BURST shows
// the room a column's next clue (never a 5), LAST STAND absorbs a FAIL's WOMF
// once, RESURRECTION restores a teammate (never itself, never another
// RESURRECTION), the team charge cap, the GM session switch, Little Heroes
// cannot switch roles off, and a new board resets every ability.
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
  const live = { live: true, blocked: null, now: 1000 };
  const s = R.createState();
  assert.equal(R.pick(s, 'a', 'dps', { locked: false }).ok, true);
  assert.match(R.pick(s, 'a', 'tank', { locked: true }).error, /LOCKED/);
  assert.match(R.pick(s, 'a', 'mage', { locked: false }).error, /UNKNOWN ROLE/);
  ['b', 'c'].forEach(id => R.pick(s, id, 'dps', { locked: false }));
  R.pick(s, 't', 'tank', { locked: false });
  R.pick(s, 'h', 'heal', { locked: false });
  R.pick(s, 'h2', 'heal', { locked: false });
  const clue = () => 'clue';
  // Not live / blocked / wrong role.
  assert.match(R.burst(s, 'a', 'A', { ...live, live: false, nextClue: clue }).error, /BATTLE STARTS/);
  assert.match(R.burst(s, 'a', 'A', { ...live, blocked: 'THE MATCH IS DECIDED', nextClue: clue }).error, /DECIDED/);
  assert.match(R.burst(s, 't', 'A', { ...live, nextClue: clue }).error, /ONLY A DPS/);
  assert.match(R.burst(s, 'a', 'A', { ...live, nextClue: () => null }).error, /NO CLOSED CLUES/);
  // Team cap: 3 DPS, only 2 BURSTs.
  assert.equal(R.burst(s, 'a', 'A', { ...live, nextClue: clue }).ok, true);
  assert.match(R.burst(s, 'a', 'B', { ...live, nextClue: clue }).error, /ALREADY USED/);
  assert.equal(R.burst(s, 'b', 'B', { ...live, nextClue: clue }).ok, true);
  assert.match(R.burst(s, 'c', 'C', { ...live, nextClue: clue }).error, /2\/2/);
  // Last stand: spent when placed; absorbs once.
  assert.match(R.lastStand(s, 't', 'A', { ...live, columnOpen: () => false }).error, /DECIDED/);
  assert.equal(R.lastStand(s, 't', 'B', { ...live, columnOpen: () => true }).ok, true);
  assert.equal(R.absorbFail(s, 'A'), null);
  assert.equal(R.absorbFail(s, 'B'), 't');
  assert.equal(R.absorbFail(s, 'B'), null, 'absorbs only once');
  // Resurrection rules.
  assert.match(R.resurrect(s, 'h', 'h', live).error, /YOURSELF/);
  assert.match(R.resurrect(s, 'h', 'c', live).error, /STILL READY/);
  assert.equal(R.resurrect(s, 'h', 'a', live).ok, true);
  assert.equal(s.used.a, undefined);
  assert.equal(s.roleUses.dps, 1, 'a restored ability frees a team charge');
  assert.match(R.resurrect(s, 'h2', 'h', live).error, /ANOTHER RESURRECTION/);
  assert.equal(R.burst(s, 'c', 'C', { ...live, nextClue: clue }).ok, true, 'the freed charge is usable');
  // New board.
  R.resetGame(s);
  assert.deepEqual(s.used, {});
  assert.deepEqual(s.marks, {});
  assert.equal(s.picks.a, 'dps', 'picks survive a new board');
  // Off switch.
  R.setEnabled(s, false);
  assert.match(R.pick(s, 'a', 'heal', { locked: false }).error, /OFF/);
  assert.match(R.burst(s, 'a', 'A', { ...live, nextClue: clue }).error, /OFF/);
  // Persistence round-trip.
  const back = R.normalizeState(JSON.parse(JSON.stringify(s)));
  assert.equal(back.enabled, false);
  assert.equal(back.picks.t, 'tank');
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
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'roles-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_BURST_MS: '1500' }, stdio: ['ignore', 'ignore', 'pipe'] });
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
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await Dps1.next(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED', 'armed');
    // Picks before the battle; Little Heroes cannot switch the system.
    for (const [c, role] of [[Dps1, 'dps'], [Dps2, 'dps'], [Tank, 'tank'], [Heal, 'heal'], [Fifth, 'dps']]) {
      const st = await c.act({ type: 'heroRole:pick', role }, `${c.name} pick`);
      assert.equal(st.heroRoles.picks[c.playerId], role);
    }
    let err = await Dps1.act({ type: 'gm:heroRoles', enabled: false }, 'hero toggle');
    assert.match(err.message, /ONLY THE SHADOW BROKER/);
    err = await Dps1.act({ type: 'heroRole:burst', column: 'A' }, 'early burst');
    assert.match(err.message, /BATTLE STARTS/);
    const roster = (await Dps1.next(m => m.type === 'players:update' && m.players.some(p => String(p.id) === Tank.playerId && p.heroRole), 'roster')).players;
    assert.equal(roster.find(p => String(p.id) === Tank.playerId).heroRole, 'tank');
    // Start the battle.
    Object.values(heroes).forEach(c => c.send({ type: 'ritual:join' }));
    await sleep(500);
    gm.send({ type: 'gm:timerLaunchCountdown' }); await sleep(300); gm.send({ type: 'gm:timerStart' });
    await Dps1.next(m => m.type === 'state:public' && m.roomMode === 'BATTLE', 'battle live', 0, 15000);
    err = await Dps1.act({ type: 'heroRole:pick', role: 'heal' }, 'locked pick');
    assert.match(err.message, /LOCKED/);
    // BURST: everyone sees column A's next clue, a rows-1..4 clue.
    let from = Fifth.mark();
    let st = await Dps1.act({ type: 'heroRole:burst', column: 'A' }, 'burst');
    const burst = await Fifth.next(m => m.type === 'heroRole:burst', 'burst seen', from);
    assert.equal(burst.column, 'A');
    assert.ok(burst.clue && burst.clue.length > 0);
    const gameData = fs.readdirSync(path.join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'games', f), 'utf8'))).find(g => g.id === Dps1.state.gameId);
    assert.equal(burst.clue, gameData.columns.A.clues[0], 'BURST shows the clue the next reveal would show');
    assert.notEqual(burst.clue, gameData.columns.A.solution);
    assert.equal(st.cells.A1.revealed, false, 'BURST never opens a cell');
    await Dps2.act({ type: 'heroRole:burst', column: 'B' }, 'burst 2');
    err = await Fifth.act({ type: 'heroRole:burst', column: 'C' }, 'burst 3');
    assert.match(err.message, /2\/2/);
    // LAST STAND absorbs the FAIL's WOMF once.
    const womfBefore = Tank.state.womf.charge;
    await Tank.act({ type: 'heroRole:lastStand', column: 'C' }, 'last stand');
    from = Tank.mark(); gm.send({ type: 'gm:failColumn', column: 'C' });
    st = await Tank.next(m => m.type === 'state:public' && m.cells.C5?.revealed, 'C failed', from);
    assert.equal(st.womf.charge, womfBefore, 'LAST STAND absorbed the WOMF');
    from = Tank.mark(); gm.send({ type: 'gm:failColumn', column: 'D' });
    st = await Tank.next(m => m.type === 'state:public' && m.cells.D5?.revealed, 'D failed', from);
    assert.equal(st.womf.charge, womfBefore + 1, 'an unshielded FAIL still costs WOMF');
    // RESURRECTION.
    err = await Heal.act({ type: 'heroRole:resurrect', targetId: Heal.playerId }, 'self');
    assert.match(err.message, /YOURSELF/);
    st = await Heal.act({ type: 'heroRole:resurrect', targetId: Dps1.playerId }, 'resurrect');
    assert.equal(st.heroRoles.used[Dps1.playerId], undefined);
    st = await Dps1.act({ type: 'heroRole:burst', column: 'B' }, 'burst again');
    assert.ok(st.heroRoles.used[Dps1.playerId]);
    // GM switch.
    st = await gm.act({ type: 'gm:heroRoles', enabled: false }, 'gm off');
    assert.equal(st.heroRoles.enabled, false);
    err = await Fifth.act({ type: 'heroRole:burst', column: 'A' }, 'off burst');
    assert.match(err.message, /OFF/);
    await gm.act({ type: 'gm:heroRoles', enabled: true }, 'gm on');
    // RESET BOARD: a fresh ritual, every ability ready again.
    from = Dps1.mark(); gm.send({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId: 1 });
    st = await Dps1.next(m => m.type === 'state:public' && m.heroRoles && Object.keys(m.heroRoles.used).length === 0, 'reset', from, 10000);
    assert.equal(st.heroRoles.picks[Tank.playerId], 'tank', 'picks survive a new board');
    assert.equal(errors.trim(), '');
    console.log('PASS hero roles server');
  } finally {
    clients.forEach(c => c.close());
    server.kill('SIGTERM'); await new Promise(r => server.once('exit', r));
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => { engine(); await serverSuite(); })().catch(e => { console.error(e); process.exit(1); });
