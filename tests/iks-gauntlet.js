// IKS OKS GAUNTLET + one-duel-at-a-time regressions.
//   Store: join window, lifesteal, Broker games, draws, elimination, last one
//          standing, the game limit (ties share the crown), persistence, reset.
//   Server: the reported bug -- a stale challenge accepted after another duel
//          started must never open a second board -- plus busy players,
//          withdrawn/expired challenges, and the gauntlet start/join/reset flow.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-iks-store-'));
  process.env.ASOC_DATA_DIR = dir;
  process.env.ASOC_IKS_GAUNTLET_GAMES = '25';
  const store = require('../iks-arena-store');
  const hero = id => ({ id, name: id.toUpperCase(), isBroker: false });
  const broker = { id: '__GM__', name: 'SHADOW BROKER', isBroker: true };
  const hp = id => store.standingOf(id)?.health;
  try {
    // Health is live by default: no gauntlet needed.
    assert.equal(store.publicState().status, 'idle');
    assert.equal(hp('z'), 10, 'everyone starts whole');
    store.recordGame({ x: hero('y'), o: hero('z'), winnerId: 'y' });
    assert.equal(hp('y'), 10, 'the winner is capped at 10');
    assert.equal(hp('z'), 9, 'a loss costs a bar outside any gauntlet');
    store.recordGame({ x: hero('z'), o: hero('y'), winnerId: 'z' });
    assert.equal(hp('z'), 10, 'a win lifesteals it back');
    assert.equal(hp('y'), 9);
    let result;
    for (let i = 0; i < 9; i++) result = store.recordGame({ x: hero('z'), o: hero('y'), winnerId: 'z' });
    assert.equal(hp('y'), 0);
    assert.deepEqual(result.eliminated.map(e => e.id), ['y'], 'falling to 0 is announced');
    assert.equal(store.isEliminated('y'), true, '0 health locks a hero out');
    store.reset();
    assert.equal(hp('y'), 10, 'reset restores everyone');
    assert.equal(store.isEliminated('y'), false);

    assert.equal(store.start().ok, true);
    assert.equal(store.start().ok, false, 'one gauntlet at a time');
    store.recordGame({ x: hero('b'), o: hero('a'), winnerId: 'a' });
    assert.equal(hp('b'), 9);
    ['a', 'b', 'c'].forEach(id => assert.equal(store.join(hero(id)).ok, true));
    assert.equal(store.join(hero('a')).already, true);
    assert.equal(hp('b'), 10, 'joining the gauntlet restores full health');
    assert.equal(store.standingOf('a').fighter, true);

    // Lifesteal between heroes; the winner is capped at 10.
    store.recordGame({ x: hero('a'), o: hero('b'), winnerId: 'a' });
    assert.equal(hp('a'), 10);
    assert.equal(hp('b'), 9);
    assert.equal(store.publicState().status, 'running');
    assert.equal(store.join(hero('d')).ok, false, 'joining closes at the first duel');
    const counted = store.publicState().gamesPlayed;
    const outside = store.recordGame({ x: hero('a'), o: hero('d'), winnerId: 'a' });
    assert.equal(outside.gauntlet, null, 'a non-fighter game does not count toward the gauntlet');
    assert.equal(store.publicState().gamesPlayed, counted);
    assert.equal(hp('d'), 9, 'but it still moves health');

    // The Broker drains and gives; a draw counts but moves nothing.
    store.recordGame({ x: broker, o: hero('b'), winnerId: '__GM__' });
    assert.equal(hp('b'), 8);
    store.recordGame({ x: hero('b'), o: broker, winnerId: 'b' });
    assert.equal(hp('b'), 9);
    const before = store.publicState().gamesPlayed;
    store.recordGame({ x: hero('a'), o: hero('b'), winnerId: null });
    assert.equal(store.publicState().gamesPlayed, before + 1, 'draws count toward the limit');
    assert.equal(hp('b'), 9);

    // c falls after ten losses and is eliminated.
    for (let i = 0; i < 10; i++) result = store.recordGame({ x: hero('a'), o: hero('c'), winnerId: 'a' });
    assert.equal(hp('c'), 0);
    assert.deepEqual(result.eliminated.map(e => e.id), ['c']);
    assert.equal(store.isEliminated('c'), true);
    assert.equal(store.standingOf('c').eliminated, true);

    // b falls too: a is the last one standing.
    for (let i = 0; i < 9; i++) result = store.recordGame({ x: hero('a'), o: hero('b'), winnerId: 'a' });
    assert.equal(hp('b'), 0);
    assert.deepEqual(result.victors.map(v => v.id), ['a']);
    assert.equal(result.endedReason, 'last-standing');
    assert.equal(store.standingOf('a').victor, true);
    assert.equal(store.recordGame({ x: hero('a'), o: hero('d'), winnerId: 'a' }).gauntlet, null, 'an ended gauntlet counts nothing more');

    // Survives a restart.
    store._forget();
    assert.equal(store.publicState().status, 'ended');
    assert.equal(store.standingOf('a').victor, true);

    // Game limit: 25 draws end it and a tie shares the crown.
    store.reset();
    assert.equal(store.publicState().status, 'idle');
    assert.equal(hp('c'), 10, 'reset restores every ring');
    assert.equal(store.standingOf('a').victor, false, 'reset clears the victor');
    store.start();
    store.join(hero('a'));
    store.join(hero('b'));
    for (let i = 0; i < 25; i++) result = store.recordGame({ x: hero('a'), o: hero('b'), winnerId: null });
    assert.equal(result.endedReason, 'game-limit');
    assert.deepEqual(result.victors.map(v => v.id).sort(), ['a', 'b'], 'a tie at the limit shares the crown');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
const PORT = Number(process.env.ASOC_IKS_TEST_PORT) || 18797;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-iks-server-'));

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
  constructor(name) { this.name = name; this.msgs = []; this.players = []; this.arena = null; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (message.type === 'protocol:ready') return resolve(this);
        this.msgs.push(message);
        if (message.type === 'join:success') this.playerId = message.playerId;
        if (message.type === 'players:update') { this.players = message.players || []; this.arena = message.iksArena || null; }
      });
    });
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  mark() { return this.msgs.length; }
  since(mark, type) { return this.msgs.slice(mark).filter(m => m.type === type); }
  async waitFor(predicate, label, from = 0, timeout = 5000) {
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

async function runServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'iks-pass', ASOC_EMAIL_VERIFICATION: '0',
      ASOC_THREEFOLD_CHALLENGE_TTL_MS: '1500', ASOC_IKS_GAUNTLET_GAMES: '50' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'iks-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.waitFor(m => m.type === 'host:recovered', 'host recovered');
    const heroes = [];
    for (const name of ['Ana', 'Bo', 'Cy']) {
      const token = (await api('/api/auth/player/register', { email: `${name.toLowerCase()}@iks.test`, password: 'iks-password', name })).data.token;
      const hero = await new Client(name).open();
      clients.push(hero);
      hero.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await hero.waitFor(m => m.type === 'join:success', `${name} join`);
      heroes.push(hero);
    }
    const [ana, bo, cy] = heroes;
    await sleep(300);

    const challenge = async (from, to) => {
      const mark = from.mark();
      from.send({ type: 'threefold:challenge', opponentId: to === gm ? '__GM__' : to.playerId });
      return (await from.waitFor(m => m.type === 'threefold:challenge' || m.type === 'error', 'challenge sent', mark));
    };
    // Plays a finished game: X takes 0,1,2 while O takes 3,4 -> X wins.
    const playOut = async (game, bySide) => {
      const order = [0, 3, 1, 4, 2];
      let current = game;
      for (const cell of order) {
        if (current.complete) break;
        const mover = bySide(current.turnId);
        const mark = mover.mark();
        mover.send({ type: 'threefold:move', gameId: current.id, cell });
        current = (await mover.waitFor(m => m.type === 'threefold:state' && m.game.id === game.id, 'move', mark)).game;
      }
      assert.equal(current.complete, true);
      return current;
    };

    // --- The reported bug -------------------------------------------------
    // GM challenges Ana (no answer), then challenges Bo instead.
    const toAna = await challenge(gm, ana);
    assert.equal(toAna.type, 'threefold:challenge');
    let anaMark = ana.mark();
    const toBo = await challenge(gm, bo);
    assert.equal(toBo.type, 'threefold:challenge');
    const withdrawn = await ana.waitFor(m => m.type === 'threefold:closed', 'Ana told the challenge was withdrawn', anaMark);
    assert.equal(withdrawn.challengeId, toAna.challenge.id);

    // Bo accepts: GM and Bo are in a duel.
    let boMark = bo.mark();
    bo.send({ type: 'threefold:accept', challengeId: toBo.challenge.id });
    const duel = (await bo.waitFor(m => m.type === 'threefold:state', 'duel starts', boMark)).game;

    // Ana accepts the stale challenge late: no second board, ever.
    anaMark = ana.mark();
    const gmMark = gm.mark();
    ana.send({ type: 'threefold:accept', challengeId: toAna.challenge.id });
    await ana.waitFor(m => m.type === 'threefold:closed', 'stale accept refused', anaMark);
    await sleep(250);
    assert.equal(ana.since(anaMark, 'threefold:state').length, 0, 'Ana never gets a board');
    assert.equal(gm.since(gmMark, 'threefold:state').length, 0, 'the GM never gets a second board');

    // Nobody can pull a busy player (or the busy GM) into another duel.
    assert.match((await challenge(ana, bo)).message || '', /ALREADY IN A DUEL/);
    assert.match((await challenge(ana, gm)).message || '', /ALREADY IN A DUEL/);
    assert.match((await challenge(gm, cy)).message || '', /FINISH YOUR CURRENT DUEL/);

    const side = id => (String(id) === '__GM__' ? gm : bo);
    const boMark2 = gm.mark();
    const plain = await playOut(duel, side);
    // The reported bug: an ordinary (non-gauntlet) loss must cost a bar.
    await gm.waitFor(m => m.type === 'players:update', 'health after a plain game', boMark2);
    await sleep(150);
    const boHealth = gm.players.find(p => p.id === bo.playerId)?.iksHealth;
    assert.equal(boHealth, String(plain.winnerId) === '__GM__' ? 9 : 10, 'losing an ordinary game costs one bar');
    // Finished: both are free again.
    const free = await challenge(ana, bo);
    assert.equal(free.type, 'threefold:challenge', 'a finished duel frees both players');

    // Withdraw by closing: Cy's accept on a cancelled challenge is refused.
    const toCy = await challenge(ana, cy);
    assert.equal(toCy.type, 'threefold:challenge');
    let cyMark = cy.mark();
    ana.send({ type: 'threefold:cancel', challengeId: toCy.challenge.id });
    await cy.waitFor(m => m.type === 'threefold:closed' && m.challengeId === toCy.challenge.id, 'Cy told of the withdrawal', cyMark);
    cyMark = cy.mark();
    cy.send({ type: 'threefold:accept', challengeId: toCy.challenge.id });
    await cy.waitFor(m => m.type === 'threefold:closed', 'cancelled accept refused', cyMark);
    assert.equal(cy.since(cyMark, 'threefold:state').length, 0);

    // Challenges expire.
    const expiring = await challenge(ana, cy);
    await sleep(1700);
    cyMark = cy.mark();
    cy.send({ type: 'threefold:accept', challengeId: expiring.challenge.id });
    await cy.waitFor(m => m.type === 'threefold:closed', 'expired accept refused', cyMark);
    assert.equal(cy.since(cyMark, 'threefold:state').length, 0);

    // --- Gauntlet flow ----------------------------------------------------
    let mark = ana.mark();
    ana.send({ type: 'gm:iksStart' });
    await sleep(250);
    assert.ok(ana.since(mark, 'error').length, 'only the Broker starts a gauntlet');
    gm.send({ type: 'gm:iksStart' });
    await ana.waitFor(m => m.type === 'players:update' && m.iksArena?.status === 'open', 'gauntlet open', mark);
    ana.send({ type: 'iks:join' });
    bo.send({ type: 'iks:join' });
    await gm.waitFor(m => m.type === 'players:update' && m.iksArena?.fighters === 2, 'two fighters joined');
    await sleep(150);
    const health = (client, hero) => client.players.find(p => p.id === hero.playerId)?.iksHealth;
    assert.equal(health(gm, ana), 10);
    assert.equal(health(gm, cy), 10, 'a non-fighter still wears a full ring');
    const fighter = (client, hero) => client.players.find(p => p.id === hero.playerId)?.iksFighter;
    assert.equal(fighter(gm, ana), true);
    assert.equal(fighter(gm, cy), false);

    const toBo2 = await challenge(ana, bo);
    boMark = bo.mark();
    bo.send({ type: 'threefold:accept', challengeId: toBo2.challenge.id });
    const gauntletDuel = (await bo.waitFor(m => m.type === 'threefold:state', 'gauntlet duel', boMark)).game;
    const finished = await playOut(gauntletDuel, id => (String(id) === String(ana.playerId) ? ana : bo));
    const winner = String(finished.winnerId) === String(ana.playerId) ? ana : bo;
    const loser = winner === ana ? bo : ana;
    await gm.waitFor(m => m.type === 'players:update' && m.iksArena?.gamesPlayed === 1, 'game counted');
    await sleep(150);
    assert.equal(health(gm, winner), 10, 'winner capped at 10');
    assert.equal(health(gm, loser), 9, 'loser loses one bar');
    assert.equal(gm.arena.status, 'running');
    mark = cy.mark();
    cy.send({ type: 'iks:join' });
    await sleep(250);
    assert.match(cy.since(mark, 'error').map(e => e.message).join(' '), /JOINING IS CLOSED/);

    gm.send({ type: 'gm:iksReset' });
    await gm.waitFor(m => m.type === 'players:update' && m.iksArena?.status === 'idle', 'gauntlet reset');
    await sleep(150);
    assert.equal(health(gm, ana), 10, 'reset restores every ring to full');
    assert.equal(gm.players.find(p => p.id === ana.playerId)?.iksFighter, false, 'reset clears the fighters');

    // Little Heroes can challenge the Shadow Broker, and know when it is online.
    const lastUpdate = [...ana.msgs].reverse().find(m => m.type === 'players:update');
    assert.equal(lastUpdate.brokerOnline, true, 'players are told the Broker is online');
    const gmMark3 = gm.mark();
    const toGm = await challenge(ana, gm);
    assert.equal(toGm.type, 'threefold:challenge', 'a Little Hero can challenge the Shadow Broker');
    const atGm = await gm.waitFor(m => m.type === 'threefold:challenge' && m.challenge.opponentId === '__GM__', 'GM receives the challenge', gmMark3);
    assert.equal(atGm.challenge.challengerId, ana.playerId);
    const chooser = fs.readFileSync(path.join(ROOT, 'js', 'threefold.js'), 'utf8');
    assert.match(chooser, /data-threefold-opponent="__GM__"/, 'the chooser offers the Shadow Broker');
    const anaMark4 = ana.mark();
    gm.close();
    await ana.waitFor(m => m.type === 'players:update' && m.brokerOnline === false, 'players told the Broker left', anaMark4);

    assert.equal(serverErrors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(client => client.close());
    server.kill();
    await sleep(200);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

function checkRing() {
  const ring = require('../js/iks-ring.js');
  assert.equal(ring.wrap({ name: 'X' }, '<img>'), '<img>', 'no gauntlet health, no ring');
  const seven = ring.wrap({ iksHealth: 7 }, '<img>');
  assert.match(seven, /--iks-hp:7/);
  assert.match(seven, /iks-hp-ring/);
  assert.doesNotMatch(seven, /iks-fire/);
  assert.match(ring.wrap({ iksHealth: 2 }, '<img>'), /iks-hp-low/);
  assert.match(ring.wrap({ iksHealth: 0, iksEliminated: true }, '<img>'), /iks-eliminated/);
  assert.match(ring.wrap({ iksHealth: 9, iksChampion: true }, '<img>'), /iks-victor[\s\S]*iks-fire/, 'the victor burns');
  assert.equal(ring.messageClass({ iksHealth: 9, iksChampion: true }), ' iks-victor-message');
  assert.equal(ring.messageClass({ iksHealth: 9 }), '');
}

function checkBoard() {
  const board = require('../js/iks-board.js');
  const game = { id: 'g1', board: ['X', '', '', '', '', '', '', '', ''], complete: false, winnerId: null, winningLine: null };
  let html = board.html(game, { cellAttr: 'data-threefold-cell', canPlay: true, me: 'O' });
  assert.equal((html.match(/data-threefold-cell="\d"/g) || []).length, 9, 'nine live plates');
  assert.match(html, /assets\/ui\/iks-oks\/board\.webp/, 'the ritual board art is the frame');
  assert.equal((html.match(/is-playable/g) || []).length, 8, 'every empty plate is playable on your move');
  assert.match(html, /class="iks-cell is-x is-new"/, 'a fresh mark flares');
  html = board.html(game, { cellAttr: 'data-threefold-cell', canPlay: false });
  assert.doesNotMatch(html, /is-new/, 'a repaint does not replay the flare');
  assert.equal((html.match(/ disabled>/g) || []).length, 9, 'nothing playable off-turn');
  const won = { id: 'g1', board: ['X', 'O', '', 'O', 'X', '', '', '', 'X'], complete: true, winnerId: 'p1', winningLine: [0, 4, 8] };
  html = board.html(won, { cellAttr: 'data-gm-cell' });
  assert.match(html, /has-winner is-surging/);
  assert.equal((html.match(/is-win/g) || []).length, 3, 'three winning plates pulse');
  assert.match(html, /threefold-win-line" data-line="0-4-8"/);
  assert.doesNotMatch(board.html(won, { cellAttr: 'data-gm-cell' }), /is-surging/, 'the victory surge plays once');
  const draw = { id: 'g2', board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'], complete: true, winnerId: null };
  assert.match(board.html(draw, {}), /iks-board is-draw/);
  ['plate-x.webp', 'plate-o.webp', 'plate-empty.webp', 'board.webp'].forEach(file =>
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'ui', 'iks-oks', file)), `${file} exists`));
}

(async () => {
  checkBoard();
  checkRing();
  checkStore();
  await runServer();
  console.log('PASS IKS OKS gauntlet: join window, lifesteal, Broker games, eliminations, last standing, 50-game limit, reset; one duel at a time, stale/cancelled/expired challenges never open a second board');
})().catch(error => {
  console.error('FAIL IKS OKS gauntlet:', error);
  process.exit(1);
});
