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
  names.forEach((n, i) => assert.equal(R.pickColor(s, n, R.COLORS[i]).ok, true));
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
  assert.match(eaten.announce[0], /A the .+ SENT B the .+ BACK TO THE YARD/);
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

  // Reaching zero is decisive even if the 250ms server tick has not run yet.
  s = game();
  assert.equal(R.roll(s, 'a', s.turnSeq, s.deadline, dice(6)).error, 'TURN TIMER EXPIRED');
  R.roll(s, 'a', s.turnSeq, 0, dice(6));
  assert.equal(R.move(s, 'a', 0, s.turnSeq, s.deadline).error, 'TURN TIMER EXPIRED');

  // The clock plays for a slow player; an offline one after a short grace.
  s = game();
  const t = R.tick(s, R.ROLL_MS + 1, new Set(['a', 'b']));
  assert.equal(t.changed, true);
  s = game();
  assert.equal(R.tick(s, 1000, new Set(['a', 'b'])).changed, false);
  assert.equal(R.tick(s, 6000, new Set(['b'])).changed, true, 'offline player is rolled for after 5 s');

  // Two DISTINCT missed turns expel a player, while multiple timeouts during
  // one turn only add one strike. The penalty is queued for the server ledger.
  s = game(['a', 'b', 'c']);
  const online = new Set(['a', 'b', 'c']);
  assert.equal(R.tick(s, R.ROLL_MS + 1, online).changed, true);
  assert.equal(s.players.a.idleMisses, 1);
  assert.equal(s.players.a.out, false);
  s.players.a.pieces[0] = 0;
  s.phase = 'move';
  s.roll = 1;
  s.options = [{ piece: 0, from: 0, to: 1, capture: null }];
  s.deadline = R.ROLL_MS + 2;
  R.tick(s, R.ROLL_MS + 3, online);
  assert.equal(s.players.a.idleMisses, 1, 'roll and move timeouts on one turn count once');
  s.turnIndex = 0;
  s.turnNumber += 1;
  s.phase = 'roll';
  s.clockAt = R.ROLL_MS + 3;
  s.deadline = R.ROLL_MS + 4;
  R.tick(s, R.ROLL_MS + 5, online);
  assert.equal(s.players.a.idleMisses, 2);
  assert.equal(s.players.a.out, true);
  assert.equal(s.idlePenalties.a.settled, false);
  assert.equal(s.phase, 'roll', 'other players continue after the expulsion');
  assert.equal(R.view(s, 'b').players.find(p => p.id === 'a').idleMisses, 2);

  // Voting requires a quorum and rejects duplicate votes, self-votes, and
  // targeting the Shadow Broker. Voted-out players never incur idle fines.
  s = game(['a', 'b', 'c', 'd']);
  assert.match(R.voteKick(s, 'a', 'a', 1).error, /YOURSELF/);
  assert.equal(R.voteKick(s, 'a', 'b', 1).ok, true);
  assert.equal(s.vote.required, 2, '2 of 3 eligible voters constitute a majority');
  assert.deepEqual(s.vote.votes, ['a']);
  assert.equal(R.voteKick(s, 'a', 'b', 2).already, true);
  assert.match(R.voteKick(s, 'c', 'd', 2).error, /ANOTHER KICK VOTE/);
  assert.equal(R.voteKick(s, 'c', 'b', 3).ok, true);
  assert.equal(s.players.b.out, true);
  assert.equal(s.vote, null);
  assert.deepEqual(s.idlePenalties, {});
  assert.equal(s.phase, 'roll');
  assert.match(R.voteKick(s, 'd', 'b', 4).error, /NOT PLAYING/);
  s = game(['a', 'b', 'c']);
  R.voteKick(s, 'a', 'b', 10);
  assert.equal(R.tick(s, 10 + R.KICK_VOTE_MS + 1, online).changed, true);
  assert.equal(s.vote, null);
  assert.match(R.voteKick(s, 'c', 'b', 10 + R.KICK_VOTE_MS + 2).error, /ALREADY FACED/);
  s = game(['a', 'b', '__GM__']);
  assert.match(R.voteKick(s, 'a', '__GM__', 1).error, /SHADOW BROKER/);
  s = game();
  assert.match(R.voteKick(s, 'a', 'b', 1).error, /THREE ACTIVE PLAYERS/);

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
  assert.equal(s.members[0].color, null, 'no automatic colour');
  assert.equal(s.members[1].color, null, 'no automatic colour');
  assert.match(R.start(s, 'a', new Set(['a', 'b']), 0).error, /WAITING FOR A, B TO COMMIT/);
  assert.equal(R.pickColor(s, 'a', 'blood').ok, true);
  assert.match(R.pickColor(s, 'a', 'void').error, /ALREADY COMMITTED/);
  assert.match(R.pickColor(s, 'b', 'blood').error, /ALREADY HOLDS/);
  assert.equal(R.pickColor(s, 'b', 'bogus').error, 'UNKNOWN COLOUR');
  assert.equal(R.pickColor(s, 'c', 'gold').error, 'JOIN THE TABLE FIRST');
  assert.equal(R.pickColor(s, 'b', 'bone').ok, true);
  R.start(s, 'a', new Set(['a', 'b']), 0);
  R.begin(s, 0);
  assert.equal(R.view(s, 'a').players.find(p => p.id === 'b').color, 'bone');
  assert.match(R.pickColor(s, 'b', 'gold').error, /IN THE LOBBY/);

  // Nicknames: a different one per player, shown as "<name> the <nickname>".
  s = game(['a', 'b', 'c', 'd']);
  const nicks = s.order.map(id => s.players[id].nickname);
  assert.equal(new Set(nicks).size, 4, 'no two players share a nickname');
  nicks.forEach(n => assert.ok(R.NICKNAMES.includes(n)));
  assert.equal(s.players.a.name, `A ${s.players.a.nickname.toLowerCase()}`);
  assert.match(s.players.a.name, /^A the [a-z ]+$/);
  assert.equal(R.view(s, 'b').players[0].baseName, 'A');

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
  async act(message, label, expectedState = () => true) {
    const from = this.mark();
    this.send(message);
    // A timer broadcast can already be in flight when a queued action is
    // sent. Wait for its expected result, not an unrelated earlier state.
    return this.next(m => (m.type === 'rage:state' && expectedState(m.state)) || (m.type === 'error' && m.code === 'RAGE'), label, from);
  }
  async balance() {
    const from = this.mark();
    this.send({ type: 'shadow:state' });
    return (await this.next(m => m.type === 'shadow:state', 'balance', from)).balance;
  }
  close() { try { this.ws.close(); } catch {} }
}

function spawnServer(fast = false) {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'rage-pass', ASOC_EMAIL_VERIFICATION: '0', ...(fast ? { ASOC_RAGE_ROLL_MS: '200', ASOC_RAGE_MOVE_MS: '200' } : {}) },
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

    // Short is a server-owned table term, not a client-side win shortcut.
    let short = await ana.act({ type: 'rage:create', gameMode: 'INVALID' }, 'invalid game mode');
    assert.match(short.message, /STANDARD OR SHORT/);
    short = await ana.act({ type: 'rage:create', stake: 0, gameMode: 'SHORT' }, 'short table');
    assert.equal(short.state.gameMode, 'SHORT'); assert.equal(short.state.piecesToWin, 2);
    await bo.act({ type: 'rage:join', gameMode: 'STANDARD' }, 'short join');
    await ana.act({ type: 'rage:color', color: 'blood' }, 'short a color');
    await bo.act({ type: 'rage:color', color: 'void' }, 'short b color');
    short = await ana.act({ type: 'rage:start', gameMode: 'STANDARD' }, 'short start');
    assert.equal(short.state.gameMode, 'SHORT', 'start packet cannot change fixed lobby mode');
    assert.ok(short.state.players.every(p => p.pieces.length === 2));
    await gm.act({ type: 'rage:cancel' }, 'close short');
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
    err = await ana.act({ type: 'rage:start' }, 'start before colours');
    assert.match(err.message, /TO COMMIT A COLOUR/);
    await ana.act({ type: 'rage:color', color: 'blood' }, 'ana colour');
    await gm.act({ type: 'rage:color', color: 'gold' }, 'gm colour');
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

    // Live WebSocket voting: only active players can vote, an actual
    // majority expels the target, and a vote carries no 20-SC idle fine.
    await ana.act({ type: 'rage:create', stake: 0 }, 'vote table');
    await bo.act({ type: 'rage:join' }, 'vote bo');
    await gm.act({ type: 'rage:join' }, 'vote gm');
    await ana.act({ type: 'rage:color', color: 'blood' }, 'vote color ana');
    await bo.act({ type: 'rage:color', color: 'void' }, 'vote color bo');
    await gm.act({ type: 'rage:color', color: 'rose' }, 'vote color gm');
    st = await ana.act({ type: 'rage:start' }, 'vote start');
    assert.equal(st.state.phase, 'roll');
    err = await bo.act({ type: 'rage:vote-kick', targetId: '__GM__' }, 'gm protected');
    assert.match(err.message, /SHADOW BROKER/);
    st = await ana.act({ type: 'rage:vote-kick', targetId: ids.bo }, 'first ballot');
    assert.equal(st.state.vote.votes.length, 1);
    assert.equal(st.state.vote.required, 2);
    st = await gm.act({ type: 'rage:vote-kick', targetId: ids.bo }, 'winning ballot');
    assert.equal(st.state.players.find(p => p.id === ids.bo).out, true);
    assert.equal(st.state.vote, null);
    assert.equal(await bo.balance(), 3, 'a vote is not an idle penalty');
    await gm.act({ type: 'rage:cancel' }, 'close vote table');

    // Partial balances clamp at zero, with a receipt preventing double fines.
    const idleActor = { id: 'rage-idle-test', name: 'Idle Test' };
    const seeded = store.awardShadowCoins(idleActor, 13, 'rage:idle:seed', { reason: 'test' });
    assert.equal(seeded.ok, true);
    const fine = store.deductShadowCoins(idleActor, 20, 'rage:idle:test-receipt', { reason: 'test idle expulsion' });
    assert.equal(fine.deducted, 13);
    assert.equal(fine.balance, 0);
    assert.equal(store.deductShadowCoins(idleActor, 20, 'rage:idle:test-receipt').duplicate, true);

    // Stake 2: Bo forfeits, Ana takes the 4-coin pot.
    await ana.act({ type: 'rage:create', stake: 2 }, 'create 2');
    await bo.act({ type: 'rage:join' }, 'bo join 2');
    await ana.act({ type: 'rage:color', color: 'blood' }, 'c1');
    await bo.act({ type: 'rage:color', color: 'void' }, 'c2');
    await ana.act({ type: 'rage:start' }, 'start 2');
    st = await bo.act({ type: 'rage:leave' }, 'forfeit', state => state?.phase === 'ended');
    assert.equal(st.state.phase, 'ended');
    assert.match(st.state.winnerName, /^Ana the /);
    await sleep(300);
    assert.equal(await ana.balance(), 12);
    assert.equal(await bo.balance(), 1);
    st = await ana.act({ type: 'rage:sync' }, 'sync');
    assert.equal(st.state.reward.amount, 4);

    // The Broker wins a coin table: THE HOUSE TAKES THE POT.
    await bo.act({ type: 'rage:create', stake: 1 }, 'create 1');
    await gm.act({ type: 'rage:join' }, 'gm join 1');
    await bo.act({ type: 'rage:color', color: 'frost' }, 'c3');
    await gm.act({ type: 'rage:color', color: 'bone' }, 'c4');
    await bo.act({ type: 'rage:start' }, 'start 1');
    st = await bo.act({ type: 'rage:leave' }, 'bo forfeits to gm', state => state?.phase === 'ended');
    assert.equal(st.state.winnerId, '__GM__');
    await sleep(300);
    assert.equal(await bo.balance(), 0);
    st = await gm.act({ type: 'rage:sync' }, 'gm sync');
    assert.equal(st.state.reward.house, true);

    // FOR FUN with the Broker: the Broker rolls on its own turn; no coins move.
    await gm.act({ type: 'rage:create', stake: 0 }, 'gm fun');
    await ana.act({ type: 'rage:join' }, 'ana fun join');
    await gm.act({ type: 'rage:color', color: 'rose' }, 'c5');
    await ana.act({ type: 'rage:color', color: 'venom' }, 'c6');
    st = await gm.act({ type: 'rage:start' }, 'gm start');
    assert.equal(st.state.pot, 0);
    assert.equal(st.state.turnId, '__GM__');
    st = await gm.act({ type: 'rage:roll', turnSeq: st.state.turnSeq }, 'gm roll');
    assert.ok(st.state.events.some(e => e.kind === 'roll' && e.by === '__GM__'));
    assert.equal(await ana.balance(), 12);

    // Battle closes the table.
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await ana.next(m => m.type === 'rage:state' && m.state === null, 'closed for battle');
    // Nicknames are game-only: the real names in the roster never change.
    gm.send({ type: 'gm:setRoomMode', mode: 'CASUAL' });
    await sleep(300);
    const roster = (await (async () => { const from = ana.mark(); ana.send({ type: 'rage:sync' }); await sleep(300); return ana.msgs.slice(from).concat(ana.msgs).reverse().find(m => m.type === 'players:update'); })())?.players || [];
    roster.forEach(p => assert.doesNotMatch(String(p.name), / the /, `roster name changed: ${p.name}`));
    assert.equal(server.errors.trim(), '');

    // Second server with accelerated clocks verifies the actual integration:
    // two idle turns -> kicked + ledger deduction + persisted zero floor.
    clients.forEach(c => c.close());
    clients.length = 0;
    await stop(server);
    server = spawnServer(true);
    await healthy();
    const fastGm = await openGm();
    fastGm.send({ type: 'rage:cancel' });
    await sleep(200);
    fastGm.send({ type: 'gm:setRoomMode', mode: 'CASUAL' });
    await sleep(300);
    ana = await connect('Ana');
    bo = await connect('Bo');
    assert.equal(await ana.balance(), 12);
    st = await ana.act({ type: 'rage:create', stake: 0 }, 'idle table');
    assert.ok(st.state && st.state.phase === 'lobby', 'fast-table create failed: ' + JSON.stringify(st));
    await bo.act({ type: 'rage:join' }, 'idle join');
    await ana.act({ type: 'rage:color', color: 'blood' }, 'idle color a');
    await bo.act({ type: 'rage:color', color: 'void' }, 'idle color b');
    st = await ana.act({ type: 'rage:start' }, 'idle start');
    assert.ok(st.state, 'fast-table start failed: ' + JSON.stringify(st));
    assert.equal(st.state.turnId, ids.ana);
    let idleDone = false;
    for (let tries = 0; tries < 110; tries += 1) {
      const latest = await bo.act({ type: 'rage:sync' }, 'idle status');
      const state = latest.state;
      if (state.players.find(p => p.id === ids.ana).out) {
        assert.equal(state.players.find(p => p.id === ids.ana).idleMisses, 2);
        assert.equal(state.players.find(p => p.id === ids.ana).outReason, 'idle');
        idleDone = true;
        break;
      }
      if (state.turnId === ids.bo && state.phase === 'roll') {
        await bo.act({ type: 'rage:roll', turnSeq: state.turnSeq }, 'bo keeps playing');
      } else if (state.turnId === ids.bo && state.phase === 'move' && state.options.length) {
        await bo.act({ type: 'rage:move', turnSeq: state.turnSeq, piece: state.options[0].piece }, 'bo moves');
      } else await sleep(110);
    }
    assert.ok(idleDone, 'idle player should be automatically expelled after two missed turns');
    assert.equal(await ana.balance(), 0, 'idle fine clamps the 12-SC balance to zero');
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
