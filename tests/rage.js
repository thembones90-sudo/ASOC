// THY SHALL NOT RAGE regressions: the pure rules engine (rage.js) with
// injected dice, then a real server + WebSocket run covering FOR FUN and FOR
// COINS tables: stake checks on join, escrow at START, refund when the Shadow
// Broker overturns the board, pot to the winner, pot to the House when the
// Broker wins, and turn ownership.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const R = require('../rage');

// ---------------------------------------------------------------------------
// Engine
const dice = (...values) => () => { assert.ok(values.length, 'ran out of scripted dice'); return values.shift(); };
function game(names = ['a', 'b']) {
  const s = R.createLobby({ id: names[0], name: names[0].toUpperCase() }, {}, 0);
  names.slice(1).forEach(n => assert.equal(R.join(s, { id: n, name: n.toUpperCase() }).ok, true));
  assert.equal(R.start(s, names[0], new Set(names), 0).ok, true);
  R.begin(s, 0);
  return s;
}
const roll = (s, value) => { const out = R.roll(s, s.order[s.turnIndex], s.turnSeq, 0, dice(value)); assert.equal(out.ok, true, out.error); return out; };
const turnOf = s => s.order[s.turnIndex];

function engine() {
  // Seats: 2 players sit opposite each other.
  let s = game();
  assert.deepEqual(s.order.map(id => s.players[id].seat), [0, 2]);

  // Three tries for a 6 with nothing on the board, then the turn passes.
  assert.equal(s.tries, 3);
  roll(s, 2); assert.equal(turnOf(s), 'a'); assert.equal(s.phase, 'roll');
  roll(s, 3); assert.equal(turnOf(s), 'a');
  roll(s, 4); assert.equal(turnOf(s), 'b', 'third miss passes the turn');

  // A 6 leaves the yard, and every 6 rolls again.
  roll(s, 6); assert.equal(s.phase, 'move');
  assert.deepEqual(s.options.map(o => o.to), [0, 0, 0, 0]);
  R.move(s, 'b', 0, s.turnSeq, 0);
  assert.equal(s.players.b.pieces[0], 0);
  assert.equal(turnOf(s), 'b', '6 earns another roll');
  assert.equal(s.phase, 'roll');
  roll(s, 3); R.move(s, 'b', 0, s.turnSeq, 0);
  assert.equal(s.players.b.pieces[0], 3);
  assert.equal(turnOf(s), 'a');

  // Not your turn / stale sequence.
  assert.equal(R.roll(s, 'b', s.turnSeq, 0, dice(1)).error, 'NOT YOUR TURN');
  assert.equal(R.roll(s, 'a', s.turnSeq - 1, 0, dice(1)).already, true);

  // Eating is a MUST: only the capturing move is offered.
  s = game();
  s.players.a.pieces = [0, 5, -1, -1];
  s.players.b.pieces = [28, -1, -1, -1]; // seat 2: progress 28 = square 8
  roll(s, 3);
  assert.deepEqual(s.options.map(o => [o.piece, o.to, !!o.capture]), [[1, 8, true]]);
  assert.equal(R.move(s, 'a', 0, s.turnSeq, 0).error, 'YOU MUST CAPTURE');
  const eaten = R.move(s, 'a', 1, s.turnSeq, 0);
  assert.match(eaten.announce[0], /A SENT B BACK TO THE YARD/);
  assert.equal(s.players.b.pieces[0], -1);

  // Never onto your own piece; home needs an exact roll.
  s = game();
  s.players.a.pieces = [0, 3, 41, -1];
  roll(s, 3);
  assert.deepEqual(s.options.map(o => o.piece).sort(), [1], 'piece 0 is blocked by piece 1, 41+3 overshoots');
  s = game();
  s.players.a.pieces = [43, 42, 41, 39];
  roll(s, 4);
  assert.deepEqual(s.options.map(o => o.piece), [], 'no exact roll: nothing moves');
  s = game();
  s.players.a.pieces = [43, 42, 41, 39];
  s.tries = 1;
  roll(s, 4); // no move, a has a piece on the track so only one try
  assert.equal(turnOf(s), 'b');

  // Win.
  s = game();
  s.players.a.pieces = [43, 42, 41, 38];
  roll(s, 2);
  const won = R.move(s, 'a', 3, s.turnSeq, 0);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winnerId, 'a');
  assert.match(won.announce.join(' '), /BRINGS? ALL FOUR HOME|BROUGHT ALL FOUR HOME/);

  // The clock plays for a slow player; an offline one after a short grace.
  s = game();
  const t = R.tick(s, R.ROLL_MS + 1, new Set(['a', 'b']));
  assert.equal(t.changed, true);
  s = game();
  assert.equal(R.tick(s, 1000, new Set(['a', 'b'])).changed, false);
  assert.equal(R.tick(s, 6000, new Set(['b'])).changed, true, 'offline player is rolled for after 5 s');

  // Forfeit leaves the last one standing as winner.
  s = game();
  R.leave(s, 'a');
  assert.equal(s.phase, 'ended');
  assert.equal(s.winnerId, 'b');

  // Lobby: 4 seats max, owner handoff.
  s = R.createLobby({ id: 'a', name: 'A' }, { stake: 3 }, 0);
  ['b', 'c', 'd'].forEach(n => R.join(s, { id: n, name: n }));
  assert.match(R.join(s, { id: 'e', name: 'e' }).error, /FULL/);
  R.leave(s, 'a');
  assert.equal(s.ownerId, 'b');
  assert.equal(s.stake, 3);

  // Figurine colours: 10 to pick from, never shared, carried into the game.
  assert.equal(R.COLORS.length, 10);
  s = R.createLobby({ id: 'a', name: 'A' }, {}, 0);
  R.join(s, { id: 'b', name: 'B' });
  assert.notEqual(s.members[0].color, s.members[1].color, 'joiners get a free colour');
  assert.match(R.pickColor(s, 'b', s.members[0].color).error, /ALREADY HOLDS/);
  assert.equal(R.pickColor(s, 'b', 'bogus').error, 'UNKNOWN COLOUR');
  assert.equal(R.pickColor(s, 'c', 'gold').error, 'JOIN THE TABLE FIRST');
  assert.equal(R.pickColor(s, 'b', 'bone').ok, true);
  R.start(s, 'a', new Set(['a', 'b']), 0);
  R.begin(s, 0);
  assert.equal(R.view(s, 'a').players.find(p => p.id === 'b').color, 'bone');
  assert.match(R.pickColor(s, 'b', 'gold').error, /IN THE LOBBY/);

  // Hidden options: only the player on turn sees what can move.
  s = game();
  s.players.a.pieces = [0, -1, -1, -1];
  roll(s, 2);
  assert.equal(R.view(s, 'a').options.length, 1);
  assert.equal(R.view(s, 'b').options.length, 0);

  // Random full games never break the board.
  for (let g = 0; g < 60; g += 1) {
    s = game(g % 2 ? ['a', 'b', 'c'] : ['a', 'b', 'c', 'd']);
    let guard = 0;
    while (s.phase !== 'ended') {
      assert.ok(guard++ < 20000, 'game never ended');
      const id = turnOf(s);
      if (s.phase === 'roll') R.roll(s, id, s.turnSeq, 0);
      else R.move(s, id, s.options[Math.floor(Math.random() * s.options.length)].piece, s.turnSeq, 0);
      const seen = new Set();
      s.order.forEach(pid => s.players[pid].pieces.forEach(p => {
        if (p >= 0 && p < 40) { const sq = R.absSquare(s.players[pid].seat, p); assert.ok(!seen.has(sq), 'two pieces on one square'); seen.add(sq); }
      }));
    }
  }
  console.log('PASS rage engine');
}

// ---------------------------------------------------------------------------
// Server
const PORT = 19431;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-rage-'));

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
  constructor(name) { this.name = name; this.msgs = []; this.rage = null; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'rage:state') this.rage = m.state;
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
  // Sends a rage action and returns the resulting state or error.
  async act(message, label) {
    const from = this.mark();
    this.send(message);
    return this.next(m => m.type === 'rage:state' || (m.type === 'error' && m.code === 'RAGE'), label, from);
  }
  async balance() {
    const from = this.mark();
    this.send({ type: 'shadow:state' });
    return (await this.next(m => m.type === 'shadow:state', 'balance', from)).balance;
  }
  close() { try { this.ws.close(); } catch {} }
}

function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'rage-pass', ASOC_EMAIL_VERIFICATION: '0' },
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
async function stop(server) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }

async function runServer() {
  let server = spawnServer();
  const clients = [];
  const creds = {};
  const connect = async name => {
    if (!creds[name]) {
      creds[name] = { email: `${name.toLowerCase()}@rage.test`, password: 'rage-password' };
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
  const openGm = async () => {
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: (await api('/api/auth/gm/login', { password: 'rage-pass' })).data.token });
    await gm.next(m => m.type === 'host:recovered', 'host');
    return gm;
  };
  try {
    await healthy();
    await openGm();
    let ana = await connect('Ana');
    let bo = await connect('Bo');
    const ids = { ana: ana.playerId, bo: bo.playerId };
    clients.forEach(c => c.close());
    clients.length = 0;
    await stop(server);

    // Seed balances offline: Ana 10, Bo 3.
    process.env.ASOC_DATA_DIR = DATA;
    delete require.cache[require.resolve('../player-store')];
    delete require.cache[require.resolve('../durable-io')];
    const store = require('../player-store');
    store.awardShadowCoins({ id: ids.ana, name: 'Ana' }, 10, 'test:seed', { reason: 'seed' });
    store.awardShadowCoins({ id: ids.bo, name: 'Bo' }, 3, 'test:seed', { reason: 'seed' });
    delete process.env.ASOC_DATA_DIR;
    server = spawnServer();
    await healthy();
    const gm = await openGm();
    ana = await connect('Ana');
    bo = await connect('Bo');
    assert.equal(await ana.balance(), 10);

    // FOR COINS: a stake Bo cannot cover is refused at the door.
    let st = await ana.act({ type: 'rage:create', stake: 5 }, 'create 5');
    assert.equal(st.state.stake, 5);
    let err = await bo.act({ type: 'rage:join' }, 'bo join 5');
    assert.match(err.message, /COSTS 5 SHADOW COINS/);
    st = await ana.act({ type: 'rage:cancel' }, 'cancel');
    assert.equal(st.state, null);

    // Stake 3: Bo + the Broker join; START holds the stakes (Broker plays free).
    await ana.act({ type: 'rage:create', stake: 3 }, 'create 3');
    await bo.act({ type: 'rage:join' }, 'bo join');
    st = await bo.act({ type: 'rage:color', color: 'spectre' }, 'bo colour');
    assert.equal(st.state.members.find(m => m.name === 'Bo').color, 'spectre');
    err = await ana.act({ type: 'rage:color', color: 'spectre' }, 'ana steals colour');
    assert.match(err.message, /Bo ALREADY HOLDS/);
    st = await gm.act({ type: 'rage:join' }, 'gm join');
    assert.equal(st.state.members.length, 3);
    err = await bo.act({ type: 'rage:start' }, 'bo start');
    assert.match(err.message, /ONLY THE LOBBY CREATOR/);
    st = await ana.act({ type: 'rage:start' }, 'start');
    assert.equal(st.state.phase, 'roll');
    assert.equal(st.state.pot, 6);
    assert.equal(await ana.balance(), 7);
    assert.equal(await bo.balance(), 0);
    // Only the player on turn may roll.
    const turn = st.state.turnId;
    const notTurn = [ana, bo].find(c => c.playerId !== turn) || bo;
    err = await notTurn.act({ type: 'rage:roll', turnSeq: st.state.turnSeq }, 'wrong roll');
    assert.match(err.message, /NOT YOUR TURN/);

    // The Broker overturns the board: every stake comes back.
    st = await gm.act({ type: 'rage:cancel' }, 'overturn');
    assert.equal(st.state, null);
    assert.equal(await ana.balance(), 10);
    assert.equal(await bo.balance(), 3);

    // Stake 2: Bo forfeits, Ana takes the 4-coin pot.
    await ana.act({ type: 'rage:create', stake: 2 }, 'create 2');
    await bo.act({ type: 'rage:join' }, 'bo join 2');
    await ana.act({ type: 'rage:start' }, 'start 2');
    st = await bo.act({ type: 'rage:leave' }, 'forfeit');
    assert.equal(st.state.phase, 'ended');
    assert.equal(st.state.winnerName, 'Ana');
    await sleep(300);
    assert.equal(await ana.balance(), 12);
    assert.equal(await bo.balance(), 1);
    st = await ana.act({ type: 'rage:sync' }, 'sync');
    assert.equal(st.state.reward.amount, 4);

    // The Broker wins a coin table: THE HOUSE TAKES THE POT.
    await bo.act({ type: 'rage:create', stake: 1 }, 'create 1');
    await gm.act({ type: 'rage:join' }, 'gm join 1');
    await bo.act({ type: 'rage:start' }, 'start 1');
    st = await bo.act({ type: 'rage:leave' }, 'bo forfeits to gm');
    assert.equal(st.state.winnerId, '__GM__');
    await sleep(300);
    assert.equal(await bo.balance(), 0);
    st = await gm.act({ type: 'rage:sync' }, 'gm sync');
    assert.equal(st.state.reward.house, true);

    // FOR FUN with the Broker: the Broker rolls on its own turn; no coins move.
    await gm.act({ type: 'rage:create', stake: 0 }, 'gm fun');
    await ana.act({ type: 'rage:join' }, 'ana fun join');
    st = await gm.act({ type: 'rage:start' }, 'gm start');
    assert.equal(st.state.pot, 0);
    assert.equal(st.state.turnId, '__GM__');
    st = await gm.act({ type: 'rage:roll', turnSeq: st.state.turnSeq }, 'gm roll');
    assert.ok(st.state.events.some(e => e.kind === 'roll' && e.by === '__GM__'));
    assert.equal(await ana.balance(), 12);

    // Battle closes the table.
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await ana.next(m => m.type === 'rage:state' && m.state === null, 'closed for battle');
    assert.equal(server.errors.trim(), '');
    console.log('PASS rage server');
  } finally {
    clients.forEach(c => c.close());
    await stop(server).catch(() => {});
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  engine();
  await runServer();
})().catch(error => { console.error(error); process.exit(1); });
