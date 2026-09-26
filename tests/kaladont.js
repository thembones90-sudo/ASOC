// KALADONT regressions: the pure rules engine (kaladont.js) with injected
// time and RNG, then a real server + WebSocket smoke test covering create ->
// join -> start -> submit -> vote -> verdict -> next turn, reconnect
// rehydration, restart recovery, and Battle/WOMF/score isolation.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const K = require('../kaladont');

// ---------------------------------------------------------------------------
// Engine
function seeded(seed) {
  let x = seed;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}
const hero = id => ({ id, name: id.toUpperCase() });
const ids = list => new Set(list);

function lobbyOf(names, now = 1000) {
  const s = K.createLobby(hero(names[0]), now);
  names.slice(1).forEach(n => assert.equal(K.join(s, hero(n)).ok, true));
  return s;
}

function startGame(names, seed = 7, now = 1000) {
  const s = lobbyOf(names, now);
  const out = K.start(s, names[0], ids(names), now, seeded(seed));
  assert.equal(out.ok, true);
  return s;
}

// Plays the current turn to acceptance (all living vote accept).
function acceptWord(s, word, now) {
  const by = s.turn.playerId;
  assert.equal(K.submit(s, by, word, s.turn.seq, now).outcome, 'tribunal');
  K.living(s).forEach(id => K.vote(s, id, 'accept', s.tribunal.seq, now));
  assert.equal(s.phase, 'verdict');
  K.tick(s, s.verdictUntil);
  return by;
}

function checkEngine() {
  let now = 1000;

  // 1. lobby create / join / leave / start
  let s = K.createLobby(hero('a'), now);
  assert.equal(s.phase, 'lobby');
  assert.equal(K.join(s, hero('b')).ok, true);
  assert.equal(K.join(s, hero('b')).already, true, 'no duplicate membership');
  assert.equal(K.join(s, hero('c')).ok, true);
  assert.equal(K.leave(s, 'c').ok, true);
  assert.equal(K.leave(s, 'a').ok, false, 'the creator cancels instead of leaving');
  assert.equal(K.start(s, 'b', ids(['a', 'b']), now).ok, false, 'only the creator starts');
  assert.equal(K.start(s, 'a', ids(['a', 'b']), now, seeded(1)).ok, true);
  assert.equal(K.start(s, 'a', ids(['a', 'b']), now).ok, false, 'no double start');
  assert.equal(K.join(s, hero('z')).ok, false, 'joining closes at start');

  // 2. fewer than 2 players
  s = K.createLobby(hero('a'), now);
  assert.equal(K.start(s, 'a', ids(['a']), now).ok, false);
  // 3. offline members are not eligible to start
  K.join(s, hero('b'));
  assert.match(K.start(s, 'a', ids(['a']), now).error, /AT LEAST 2 ONLINE/);
  // creator disconnect hands the lobby on, or closes it
  assert.equal(K.lobbyDisconnect(s, 'a', ids(['b'])).closed, false);
  assert.equal(s.ownerId, 'b');
  assert.equal(K.lobbyDisconnect(s, 'b', ids([])).closed, true);

  // 4. randomized order generated once and preserved
  s = startGame(['a', 'b', 'c', 'd'], 42);
  const order = s.order.slice();
  assert.deepEqual([...order].sort(), ['a', 'b', 'c', 'd']);
  const other = startGame(['a', 'b', 'c', 'd'], 99);
  assert.notDeepEqual(other.order, ['a', 'b', 'c', 'd'].slice(), 'shuffle is not identity for this seed');
  // 5. first word: any valid word, accepted -> its last two letters lead
  assert.equal(s.prefix, '');
  const first = acceptWord(s, 'Kuća', now);
  assert.equal(first, order[0]);
  assert.equal(s.prefix, 'ĆA', 'prefix = last two letters, case-insensitive');
  assert.deepEqual(s.history.map(h => h.word), ['KUĆA']);
  assert.equal(s.turn.playerId, order[1]);
  assert.deepEqual(s.order, order, 'order preserved across turns');

  // 7. correct prefix is accepted structurally (tribunal opens)
  const second = s.turn.playerId;
  assert.equal(K.submit(s, second, '  ćao ', s.turn.seq, now).outcome, 'tribunal', 'trimmed and case-folded');
  // 12/13. duplicate vote rejected, spectator vote rejected (nobody out yet)
  assert.equal(K.vote(s, order[0], 'reject', s.tribunal.seq, now).ok, true);
  assert.equal(K.vote(s, order[0], 'accept', s.tribunal.seq, now).ok, false, 'no duplicate vote');
  assert.equal(K.vote(s, 'intruder', 'accept', s.tribunal.seq, now).ok, false, 'non-participant vote rejected');
  // 14. missing votes become ACCEPT at the window's end; 17. 1 reject vs 3 accept
  K.tick(s, s.tribunal.deadline + 1);
  assert.equal(s.result.kind, 'accepted');
  assert.equal(s.result.votes.defaulted.length, 3, 'silent voters counted as ACCEPT');
  assert.equal(s.prefix, 'AO');
  K.tick(s, s.verdictUntil);

  // 16/18. REJECT majority eliminates the submitter; chain + history unchanged
  const third = s.turn.playerId;
  const historyBefore = s.history.length;
  K.submit(s, third, 'aorta', s.turn.seq, now);
  K.living(s).forEach((id, i) => K.vote(s, id, i < 3 ? 'reject' : 'accept', s.tribunal.seq, now));
  assert.equal(s.result.kind, 'rejected');
  assert.equal(s.players[third].alive, false);
  assert.equal(s.players[third].reason, 'WORD REJECTED');
  assert.equal(s.prefix, 'AO', 'a rejected word does not move the chain');
  assert.equal(s.history.length, historyBefore, 'a rejected word is not in history');
  // 13. an eliminated spectator can neither vote nor submit
  K.tick(s, s.verdictUntil);
  // 19. the eliminated player is skipped
  assert.notEqual(s.turn.playerId, third);
  assert.equal(K.submit(s, third, 'aoki', s.turn.seq, now).ok, false, 'spectators cannot play');
  const fourth = s.turn.playerId;
  K.submit(s, fourth, 'aoki', s.turn.seq, now);
  assert.equal(K.vote(s, third, 'accept', s.tribunal.seq, now).ok, false, 'spectators cannot vote');
  // 17. tie = ACCEPT (3 living: 1 accept, 1 reject, 1 silent -> 2-1 accept; force a true tie below)
  K.vote(s, K.living(s)[0], 'reject', s.tribunal.seq, now);
  K.vote(s, K.living(s)[1], 'accept', s.tribunal.seq, now);
  K.tick(s, s.tribunal.deadline + 1);
  assert.equal(s.result.kind, 'accepted');
  K.tick(s, s.verdictUntil);

  // 6. timeout eliminates the current player; no tribunal; chain unchanged
  const prefixBefore = s.prefix;
  const sleeper = s.turn.playerId;
  K.tick(s, s.turn.deadline + 1);
  assert.equal(s.players[sleeper].reason, 'TURN TIMEOUT');
  assert.equal(s.prefix, prefixBefore);
  assert.equal(s.tribunal, null);

  // True tie: 2 living, one accept + one reject.
  s = startGame(['a', 'b']);
  const t1 = s.turn.playerId;
  K.submit(s, t1, 'mama', s.turn.seq, now);
  K.vote(s, 'a', 'accept', s.tribunal.seq, now);
  K.vote(s, 'b', 'reject', s.tribunal.seq, now);
  assert.equal(s.result.kind, 'accepted', 'a tie accepts');

  // 8. wrong prefix, 9. duplicate word -> immediate elimination, no tribunal
  s = startGame(['a', 'b', 'c']);
  acceptWord(s, 'voda', now);
  let p = s.turn.playerId;
  assert.equal(K.submit(s, p, 'kuca', s.turn.seq, now).reason, 'INVALID PREFIX');
  assert.equal(s.players[p].alive, false);
  assert.equal(s.tribunal, null);
  K.tick(s, s.verdictUntil);
  p = s.turn.playerId;
  // "da" -> starts with DA; first make an accepted "dan" then try "dan" again later
  acceptWord(s, 'dan', now);
  const q = s.turn.playerId;
  assert.equal(K.submit(s, q, 'voda', s.turn.seq, now).reason, 'INVALID PREFIX');
  s = startGame(['a', 'b', 'c']);
  acceptWord(s, 'anana', now); // prefix NA
  acceptWord(s, 'nana', now);  // prefix NA again
  p = s.turn.playerId;
  assert.equal(K.submit(s, p, 'nana', s.turn.seq, now).reason, 'DUPLICATE WORD');
  // invalid structure
  s = startGame(['a', 'b', 'c']);
  p = s.turn.playerId;
  assert.equal(K.submit(s, p, '   ', s.turn.seq, now).reason, 'INVALID WORD', 'empty is invalid');
  K.tick(s, s.verdictUntil);
  p = s.turn.playerId;
  assert.equal(K.submit(s, p, 'ab1', s.turn.seq, now).reason, 'INVALID WORD', 'letters only');

  // Replay / race guards
  s = startGame(['a', 'b', 'c']);
  p = s.turn.playerId;
  const staleSeq = s.turn.seq - 1;
  assert.equal(K.submit(s, p, 'voda', staleSeq, now).ok, false, 'stale turn command refused');
  assert.equal(K.submit(s, p, 'voda', s.turn.seq, s.turn.deadline + 1).ok, false, 'late submit refused');
  const notMe = s.order.find(id => id !== p);
  assert.equal(K.submit(s, notMe, 'voda', s.turn.seq, now).error, 'IT IS NOT YOUR TURN');
  K.submit(s, p, 'voda', s.turn.seq, now);
  assert.equal(K.submit(s, p, 'vodi', s.turn.seq, now).ok, false, 'one submission per turn');
  assert.equal(K.vote(s, p, 'accept', s.tribunal.seq, s.tribunal.deadline + 1).ok, false, 'late vote refused');
  assert.equal(K.vote(s, p, 'maybe', s.tribunal.seq, now).ok, false);

  // 21. KALADONT: auto-accepted, no tribunal, kills the next living player
  s = startGame(['a', 'b', 'c'], 3);
  acceptWord(s, 'luka', now); // prefix KA
  const killer = s.turn.playerId;
  const victim = s.order[(s.order.indexOf(killer) + 1) % 3];
  const out = K.submit(s, killer, 'kaladont', s.turn.seq, now);
  assert.equal(out.outcome, 'kaladont');
  assert.equal(s.tribunal, null, 'no tribunal for KALADONT');
  assert.equal(s.players[victim].alive, false);
  assert.equal(s.players[victim].reason, 'KALADONT KILL');
  assert.equal(s.history.at(-1).word, 'KALADONT');
  assert.equal(s.prefix, '', 'the chain restarts after NT');
  K.tick(s, s.verdictUntil);
  assert.notEqual(s.turn.playerId, victim, 'the killed player is skipped');
  // KALADONT without the prefix is just a wrong prefix
  s = startGame(['a', 'b', 'c'], 3);
  acceptWord(s, 'voda', now);
  assert.equal(K.submit(s, s.turn.playerId, 'kaladont', s.turn.seq, now).reason, 'INVALID PREFIX');

  // 22. KALADONT can end the match; 20. last active player wins
  s = startGame(['a', 'b'], 5);
  const opener = s.turn.playerId;
  K.submit(s, opener, 'kaladont', s.turn.seq, now);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winnerId, opener);
  assert.equal(s.players[opener].place, 1);
  assert.equal(s.turn, null, 'timers stop at the end');
  assert.equal(K.tick(s, now + 5000).changed, false);

  // Views: votes are secret while the tribunal is open, revealed after.
  s = startGame(['a', 'b', 'c']);
  K.submit(s, s.turn.playerId, 'voda', s.turn.seq, now);
  K.vote(s, 'a', 'reject', s.tribunal.seq, now);
  const open = K.view(s, 'b', now);
  assert.equal(open.tribunal.voted, 1);
  assert.equal(open.tribunal.youVoted, null);
  assert.equal(JSON.stringify(open).includes('"reject"'), false, 'no vote choices leak while voting is open');
  assert.equal(K.view(s, 'a', now).tribunal.youVoted, 'reject', 'you see your own vote');

  // Persistence round-trip + fresh window after a restart
  const saved = JSON.parse(JSON.stringify(s));
  const restored = K.resumeAfterRestart(K.normalizeState(saved), now + 999999);
  assert.equal(restored.phase, 'tribunal');
  assert.equal(restored.tribunal.votes.a, 'reject', 'votes survive a restart');
  assert.equal(restored.tribunal.deadline, now + 999999 + K.VOTE_MS, 'nobody is executed for downtime');
  assert.equal(K.normalizeState({ phase: 'bogus' }), null);
}

// ---------------------------------------------------------------------------
// Live server
const PORT = Number(process.env.ASOC_KALADONT_TEST_PORT) || 18799;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-kaladont-'));

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
  constructor(name) { this.name = name; this.msgs = []; this.kal = null; this.state = null; this.players = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (message.type === 'protocol:ready') return resolve(this);
        this.msgs.push(message);
        if (message.type === 'kaladont:state') this.kal = message.state;
        if (message.type === 'state:public') this.state = message;
        if (message.type === 'players:update') this.players = message.players || [];
        if (message.type === 'join:success') this.playerId = message.playerId;
      });
    });
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  mark() { return this.msgs.length; }
  errorsSince(mark) { return this.msgs.slice(mark).filter(m => m.type === 'error').map(m => m.message); }
  async waitKal(predicate, label, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate(this.kal)) return this.kal;
      await sleep(20);
    }
    throw new Error(`${this.name}: timed out waiting for ${label} (phase ${this.kal?.phase})`);
  }
  async waitFor(predicate, label, from = 0, timeout = 6000) {
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

function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'kal-pass', ASOC_EMAIL_VERIFICATION: '0',
      ASOC_KALADONT_VOTE_MS: '2500', ASOC_KALADONT_VERDICT_MS: '300' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  return server;
}

async function waitHealthy() {
  for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); }
  throw new Error('server did not become healthy');
}

async function runServer() {
  let server = spawnServer();
  const clients = [];
  try {
    await waitHealthy();
    const gmToken = (await api('/api/auth/gm/login', { password: 'kal-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.waitFor(m => m.type === 'host:recovered', 'host recovered');
    const tokens = {};
    const connect = async name => {
      tokens[name] ||= (await api('/api/auth/player/register', { email: `${name.toLowerCase()}@kal.test`, password: 'kal-password', name })).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: tokens[name], roomCode: 'MASTER', name });
      await c.waitFor(m => m.type === 'join:success', `${name} join`);
      return c;
    };
    const ana = await connect('Ana');
    const bo = await connect('Bo');
    const cy = await connect('Cy');
    await sleep(300);
    const before = { womf: JSON.stringify(gm.state.womf), mode: gm.state.roomMode, scores: JSON.stringify(gm.players.map(p => [p.id, p.score])) };

    // The Shadow Broker can create and play Kaladont; identity still comes
    // exclusively from the socket.
    let mark = gm.mark();
    gm.send({ type: 'kaladont:create' });
    const gmLobby = await bo.waitKal(k => k?.phase === 'lobby' && k.ownerId === '__GM__', 'GM lobby broadcast');
    assert.equal(gmLobby.ownerName, 'SHADOW BROKER');
    assert.equal(gm.kal.you.member, true);
    assert.equal(gm.kal.you.owner, true);
    bo.send({ type: 'kaladont:join', playerId: 'spoofed' });
    await gm.waitKal(k => k?.members?.length === 2, 'Bo joins GM lobby');
    gm.send({ type: 'kaladont:start' });
    const gmStarted = await gm.waitKal(k => k?.phase === 'turn', 'GM-created game starts');
    assert.ok(gmStarted.order.some(p => p.id === '__GM__'), 'GM is a real Kaladont participant');
    gm.send({ type: 'kaladont:cancel' });
    await gm.waitKal(k => k === null, 'GM ends test game');

    // create -> lobby visible to everyone (invitation data)
    ana.send({ type: 'kaladont:create' });
    await bo.waitKal(k => k?.phase === 'lobby', 'Bo sees the lobby');
    assert.equal(bo.kal.you.member, false);
    assert.equal(bo.kal.ownerName, 'Ana');
    mark = bo.mark();
    bo.send({ type: 'kaladont:create' });
    await sleep(200);
    assert.match(bo.errorsSince(mark).join(' '), /ALREADY OPEN/);
    // start rejected with 1 player
    mark = ana.mark();
    ana.send({ type: 'kaladont:start' });
    await sleep(200);
    assert.match(ana.errorsSince(mark).join(' '), /AT LEAST 2/);

    bo.send({ type: 'kaladont:join', playerId: 'spoofed' });
    cy.send({ type: 'kaladont:join' });
    await ana.waitKal(k => k?.members?.length === 3, 'three joined');
    assert.deepEqual(ana.kal.members.map(m => m.name).sort(), ['Ana', 'Bo', 'Cy'], 'spoofed ids are ignored');
    mark = bo.mark();
    bo.send({ type: 'kaladont:start' });
    await sleep(200);
    assert.match(bo.errorsSince(mark).join(' '), /ONLY THE LOBBY CREATOR/);

    // start -> fixed order, first turn
    ana.send({ type: 'kaladont:start' });
    const started = await gm.waitKal(k => k?.phase === 'turn', 'game starts');
    const order = started.order.map(p => p.id);
    assert.equal(order.length, 3);
    const byId = { [ana.playerId]: ana, [bo.playerId]: bo, [cy.playerId]: cy };
    const first = byId[started.turn.playerId];
    mark = cy.mark();
    const lateJoiner = await connect('Dee');
    lateJoiner.send({ type: 'kaladont:join' });
    await sleep(200);
    assert.match(lateJoiner.errorsSince(0).join(' '), /JOINING IS CLOSED/);

    // submit -> tribunal; vote -> verdict -> next turn
    first.send({ type: 'kaladont:submit', word: 'voda', turnSeq: started.turn.seq });
    const tribunal = await gm.waitKal(k => k?.phase === 'tribunal', 'tribunal opens');
    assert.equal(tribunal.tribunal.word, 'VODA');
    assert.equal(tribunal.tribunal.voters, 3);
    mark = first.mark();
    first.send({ type: 'kaladont:submit', word: 'vodi', turnSeq: started.turn.seq });
    await sleep(150);
    assert.ok(first.errorsSince(mark).length, 'double submit refused');
    ana.send({ type: 'kaladont:vote', choice: 'accept', tribunalSeq: tribunal.tribunal.seq });
    bo.send({ type: 'kaladont:vote', choice: 'accept', tribunalSeq: tribunal.tribunal.seq });
    await gm.waitKal(k => k?.tribunal?.voted === 2, 'two votes counted');
    assert.equal(JSON.stringify(gm.kal).includes('"accept"'), false, 'votes stay secret while open');
    mark = ana.mark();
    ana.send({ type: 'kaladont:vote', choice: 'reject', tribunalSeq: tribunal.tribunal.seq });
    await sleep(150);
    assert.match(ana.errorsSince(mark).join(' '), /ALREADY VOTED/);
    cy.send({ type: 'kaladont:vote', choice: 'reject', tribunalSeq: tribunal.tribunal.seq });
    const verdict = await gm.waitKal(k => k?.phase === 'verdict', 'verdict');
    assert.equal(verdict.result.kind, 'accepted');
    assert.equal(verdict.result.votes.accept.length, 2);
    assert.equal(verdict.result.votes.reject[0].name, 'Cy', 'votes revealed after the verdict');
    const second = await gm.waitKal(k => k?.phase === 'turn' && k.turn.playerId !== first.playerId, 'next turn');
    assert.equal(second.prefix, 'DA');
    assert.equal(second.turn.playerId, order[(order.indexOf(first.playerId) + 1) % 3], 'fixed order advances');

    // Chat cards: lobby, start, but never individual votes.
    await sleep(200);
    const cards = (await new Promise(resolve => { const m = gm.msgs.filter(x => x.type === 'chat:update').at(-1); resolve(m.messages); }))
      .map(m => m.text).filter(t => /^KALADONT/.test(t || ''));
    assert.ok(cards.some(t => /OPENED A LOBBY/.test(t)));
    assert.ok(cards.some(t => /THE GAME BEGINS/.test(t)));
    assert.ok(!cards.some(t => /VOTE/i.test(t)), 'no vote spam in chat');

    // Wrong prefix eliminates at once (structural), public reason.
    const secondClient = byId[second.turn.playerId];
    secondClient.send({ type: 'kaladont:submit', word: 'kuca', turnSeq: second.turn.seq });
    const out = await gm.waitKal(k => k?.result?.kind === 'eliminated', 'structural elimination');
    assert.equal(out.result.reason, 'INVALID PREFIX');

    // 23. reconnect rehydrates exactly
    const third = await gm.waitKal(k => k?.phase === 'turn' && k.turn.playerId !== secondClient.playerId, 'third turn');
    const spectator = secondClient;
    spectator.close();
    await sleep(300);
    const back = await connect(spectator.name);
    await back.waitKal(k => k?.id === third.id, 'rehydrated after reconnect');
    assert.equal(back.kal.you.playing, true);
    assert.equal(back.kal.you.alive, false, 'resumes as a spectator');
    assert.equal(back.kal.prefix, 'DA');

    // 24. restart recovery: SIGTERM persists, the match resumes on restart
    const phaseBefore = gm.kal.phase;
    const historyBefore = gm.kal.history.map(h => h.word);
    clients.forEach(c => c.close());
    clients.length = 0;
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    server = spawnServer();
    await waitHealthy();
    const gm2 = await new Client('GM2').open();
    clients.push(gm2);
    gm2.send({ type: 'host:recover', gmToken: (await api('/api/auth/gm/login', { password: 'kal-pass' })).data.token });
    await gm2.waitFor(m => m.type === 'host:recovered', 'host recovered after restart');
    const recovered = await gm2.waitKal(k => !!k, 'kaladont recovered');
    assert.equal(recovered.id, third.id, 'the same match survives a restart');
    assert.deepEqual(recovered.history.map(h => h.word), historyBefore);
    assert.ok(['turn', 'verdict', 'tribunal'].includes(recovered.phase), `still in play (${phaseBefore} -> ${recovered.phase})`);
    assert.ok(!recovered.turn || recovered.turn.deadline > Date.now(), 'a fresh window, nobody executed for downtime');

    // 25. Battle / WOMF / scores untouched
    assert.equal(JSON.stringify(gm2.state.womf), before.womf, 'WOMF untouched');
    assert.equal(gm2.state.roomMode, before.mode, 'room mode untouched');

    // The GM can end a match for everyone.
    gm2.send({ type: 'kaladont:cancel' });
    await gm2.waitKal(k => k === null, 'GM ended the game');

    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(client => client.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  checkEngine();
  await runServer();
  console.log('PASS KALADONT: lobby, fixed random order, structural checks, secret tribunal (silence = ACCEPT, tie = ACCEPT), eliminations, KALADONT kill, winner, reconnect + restart recovery, live WebSocket flow, Battle untouched');
})().catch(error => {
  console.error('FAIL KALADONT:', error);
  process.exit(1);
});
