'use strict';
// THY SHALL NOT RAGE -- server-authoritative "Ne ljuti se čoveče" (Mensch
// ärgere Dich nicht) for the AMUSEMENT PARK. Pure state machine in the style
// of kaladont.js: every function takes `now` (and the dice RNG) from the
// caller, mutates one plain JSON-serializable state object and returns
// { ok, error, announce[] }. server.js owns sockets, coins, persistence.
//
// Phases: lobby -> roll -> (move) -> roll ... -> ended.
//
// Rules:
// - 2..4 players, 4 pieces each. Anyone (a Little Hero or the Shadow Broker)
//   opens the one room lobby and fixes its terms: FOR FUN, or FOR COINS with
//   a stake. Joining a lobby means agreeing to its terms; nobody can change
//   them afterwards. The owner starts (>= 2 online members) or cancels.
// - Track of 40 squares; a piece walks 40 squares from its START, then 4
//   HOME squares. Progress p: -1 yard, 0..39 track, 40..43 home.
// - A 6 brings a piece out of the yard onto START. With no piece on the
//   track a player gets up to 3 rolls to throw that 6.
// - Every 6 earns another roll.
// - Capturing is a MUST: when any legal move lands on an enemy piece, only
//   capturing moves are allowed. A captured piece goes back to its yard.
// - A piece never lands on its own colour; home squares need an exact roll.
// - First player with all 4 pieces home wins (and takes the pot).
// - Each roll / move has a clock; when it runs out the server plays for you.
const crypto = require('crypto');

const ROLL_MS = Number(process.env.ASOC_RAGE_ROLL_MS) || 15000;
const MOVE_MS = Number(process.env.ASOC_RAGE_MOVE_MS) || 20000;
const OFFLINE_MS = 5000;
const ENDED_TTL_MS = 10 * 60 * 1000;
const LOBBY_TTL_MS = 30 * 60 * 1000;
const MAX_PLAYERS = 4;
const PIECES = 4;
const TRACK = 40;
const HOME_FIRST = 40;
const HOME_LAST = 43;
const MAX_STAKE = 50;
const SEATS_BY_COUNT = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const PHASES = new Set(['lobby', 'roll', 'move', 'ended']);
// Figurine colours. Each lobby member owns one; no two members share.
const COLORS = Object.freeze(['blood', 'void', 'venom', 'gold', 'frost', 'rose', 'ember', 'spectre', 'abyss', 'bone']);
const freeColor = s => COLORS.find(c => !s.members.some(m => m.color === c)) || COLORS[0];

const newId = () => 'rage-' + crypto.randomBytes(6).toString('hex');
const rollDie = () => crypto.randomInt(1, 7);

function cleanName(name) { return String(name || 'LITTLE HERO').slice(0, 40); }

function createLobby(actor, { stake = 0 } = {}, now = Date.now()) {
  const amount = Math.max(0, Math.min(MAX_STAKE, Math.floor(Number(stake) || 0)));
  return {
    id: newId(),
    phase: 'lobby',
    createdAt: now,
    ownerId: String(actor.id),
    ownerName: cleanName(actor.name),
    stake: amount,
    members: [{ id: String(actor.id), name: cleanName(actor.name), color: COLORS[0] }],
    players: {},
    order: [],
    turnIndex: 0,
    turnSeq: 0,
    roll: null,
    tries: 0,
    sixes: 0,
    deadline: 0,
    pot: 0,
    paid: {},
    events: [],
    eventSeq: 0,
    winnerId: null,
    endedAt: 0,
    reward: null
  };
}

function isOpenLobby(s) { return !!s && s.phase === 'lobby'; }
function isLive(s) { return !!s && (s.phase === 'roll' || s.phase === 'move'); }

function join(s, actor) {
  if (!isOpenLobby(s)) return { ok: false, error: 'NO OPEN LOBBY' };
  const id = String(actor.id);
  if (s.members.some(m => m.id === id)) return { ok: true, already: true };
  if (s.members.length >= MAX_PLAYERS) return { ok: false, error: 'THE TABLE IS FULL (4)' };
  s.members.push({ id, name: cleanName(actor.name), color: freeColor(s) });
  return { ok: true, announce: [] };
}

function leave(s, id) {
  id = String(id);
  if (!s) return { ok: false, error: 'NOTHING TO LEAVE' };
  if (isOpenLobby(s)) {
    if (!s.members.some(m => m.id === id)) return { ok: true, already: true };
    s.members = s.members.filter(m => m.id !== id);
    if (s.ownerId === id) {
      if (!s.members.length) return { ok: true, closed: true, announce: [] };
      s.ownerId = s.members[0].id;
      s.ownerName = s.members[0].name;
    }
    return { ok: true, announce: [] };
  }
  if (isLive(s)) return forfeit(s, id, 'LEFT THE TABLE');
  return { ok: true, already: true };
}

// A lobby member picks their figurine colour; a colour another member holds
// is refused.
function pickColor(s, id, color) {
  if (!isOpenLobby(s)) return { ok: false, error: 'COLOURS ARE PICKED IN THE LOBBY' };
  const member = s.members.find(m => m.id === String(id));
  if (!member) return { ok: false, error: 'JOIN THE TABLE FIRST' };
  if (!COLORS.includes(color)) return { ok: false, error: 'UNKNOWN COLOUR' };
  if (member.color === color) return { ok: true, already: true };
  const holder = s.members.find(m => m.color === color);
  if (holder) return { ok: false, error: `${holder.name} ALREADY HOLDS THAT COLOUR` };
  member.color = color;
  return { ok: true, announce: [] };
}

// The owner may only start once everyone it would seat is still here.
function start(s, actorId, onlineIds, now = Date.now()) {
  if (!isOpenLobby(s)) return { ok: false, error: 'NO OPEN LOBBY' };
  if (s.ownerId !== String(actorId)) return { ok: false, error: 'ONLY THE LOBBY CREATOR CAN START' };
  const seated = s.members.filter(m => onlineIds.has(m.id));
  if (seated.length < 2) return { ok: false, error: 'NEEDS AT LEAST 2 PLAYERS ONLINE' };
  const seats = SEATS_BY_COUNT[seated.length];
  s.players = {};
  s.order = seated.map((m, i) => {
    s.players[m.id] = { id: m.id, name: m.name, color: COLORS.includes(m.color) ? m.color : COLORS[i], seat: seats[i], pieces: Array(PIECES).fill(-1), out: false, finishedAt: 0 };
    return m.id;
  });
  s.members = seated;
  s.turnIndex = 0;
  s.turnSeq = 0;
  s.pot = 0;
  return { ok: true, seated: s.order.slice() };
}

// Called by server.js once every stake is held (or straight away FOR FUN).
function begin(s, now = Date.now()) {
  beginTurn(s, now, 0);
  const names = s.order.map(id => s.players[id].name).join(', ');
  return [`THY SHALL NOT RAGE // ${names} TAKE THEIR SEATS.${s.pot ? ` POT: ${s.pot} SHADOW COIN${s.pot === 1 ? '' : 'S'}.` : ''} ${s.players[s.order[0]].name} ROLLS FIRST.`];
}

const current = s => s.players[s.order[s.turnIndex]];
function setClock(s, now, ms) { s.clockAt = now; s.deadline = now + ms; }
const startSquare = seat => seat * 10;
const absSquare = (seat, p) => (startSquare(seat) + p) % TRACK;
const onTrack = p => p >= 0 && p < TRACK;

function piecesOnTrack(player) { return player.pieces.some(onTrack); }

// Rolling for the yard: no piece on the track means up to three throws.
function beginTurn(s, now, index) {
  s.turnIndex = index;
  s.turnSeq += 1;
  s.phase = 'roll';
  s.roll = null;
  s.options = [];
  s.sixes = 0;
  const p = current(s);
  s.tries = piecesOnTrack(p) || !p.pieces.some(x => x === -1) ? 1 : 3;
  setClock(s, now, ROLL_MS);
}

function nextTurn(s, now) {
  const n = s.order.length;
  for (let step = 1; step <= n; step += 1) {
    const index = (s.turnIndex + step) % n;
    if (!s.players[s.order[index]].out) return beginTurn(s, now, index);
  }
}

function occupant(s, square) {
  for (const id of s.order) {
    const pl = s.players[id];
    if (pl.out) continue;
    for (let i = 0; i < PIECES; i += 1) {
      if (onTrack(pl.pieces[i]) && absSquare(pl.seat, pl.pieces[i]) === square) return { id, piece: i };
    }
  }
  return null;
}

// Every legal move for the current player with roll r. Capturing is a must.
function legalMoves(s, r) {
  const pl = current(s);
  const moves = [];
  pl.pieces.forEach((p, piece) => {
    let to;
    if (p === -1) { if (r !== 6) return; to = 0; }
    else { to = p + r; if (to > HOME_LAST) return; }
    if (pl.pieces.some((q, j) => j !== piece && q === to)) return;
    let capture = null;
    if (onTrack(to)) {
      const hit = occupant(s, absSquare(pl.seat, to));
      if (hit && hit.id === pl.id) return;
      if (hit) capture = hit;
    }
    moves.push({ piece, from: p, to, capture });
  });
  return moves.some(m => m.capture) ? moves.filter(m => m.capture) : moves;
}

function pushEvent(s, event) {
  s.eventSeq += 1;
  s.events.push({ seq: s.eventSeq, ...event });
  s.events = s.events.slice(-12);
}

function roll(s, actorId, turnSeq, now = Date.now(), die = rollDie) {
  if (s?.phase !== 'roll') return { ok: false, error: 'NOT ROLLING NOW' };
  if (current(s).id !== String(actorId)) return { ok: false, error: 'NOT YOUR TURN' };
  if (turnSeq != null && Number(turnSeq) !== s.turnSeq) return { ok: true, already: true };
  return doRoll(s, now, die);
}

function doRoll(s, now, die = rollDie) {
  const pl = current(s);
  const r = die();
  s.roll = r;
  s.tries -= 1;
  if (r === 6) s.sixes += 1;
  pushEvent(s, { kind: 'roll', by: pl.id, value: r });
  const moves = legalMoves(s, r);
  if (!moves.length) {
    if (r === 6 || s.tries > 0) {
      // Another throw: a 6 that could not be used, or tries left for the yard.
      s.turnSeq += 1;
      s.phase = 'roll';
      if (r === 6) s.tries = Math.max(s.tries, 1);
      setClock(s, now, ROLL_MS);
      return { ok: true, announce: [] };
    }
    nextTurn(s, now);
    return { ok: true, announce: [] };
  }
  s.phase = 'move';
  s.options = moves;
  s.turnSeq += 1;
  setClock(s, now, MOVE_MS);
  return { ok: true, announce: [] };
}

function move(s, actorId, piece, turnSeq, now = Date.now()) {
  if (s?.phase !== 'move') return { ok: false, error: 'NOTHING TO MOVE NOW' };
  if (current(s).id !== String(actorId)) return { ok: false, error: 'NOT YOUR TURN' };
  if (turnSeq != null && Number(turnSeq) !== s.turnSeq) return { ok: true, already: true };
  const chosen = s.options.find(m => m.piece === Number(piece));
  if (!chosen) return { ok: false, error: s.options.some(m => m.capture) ? 'YOU MUST CAPTURE' : 'THAT PIECE CANNOT MOVE' };
  return applyMove(s, chosen, now);
}

function applyMove(s, m, now) {
  const pl = current(s);
  const announce = [];
  pl.pieces[m.piece] = m.to;
  pushEvent(s, { kind: 'move', by: pl.id, piece: m.piece, from: m.from, to: m.to });
  if (m.capture) {
    const victim = s.players[m.capture.id];
    victim.pieces[m.capture.piece] = -1;
    pushEvent(s, { kind: 'capture', by: pl.id, victim: victim.id, piece: m.capture.piece, square: absSquare(pl.seat, m.to) });
    announce.push(`THY SHALL NOT RAGE // ${pl.name} SENT ${victim.name} BACK TO THE YARD.`);
  }
  if (pl.pieces.every(p => p >= HOME_FIRST)) {
    s.phase = 'ended';
    s.winnerId = pl.id;
    s.endedAt = now;
    s.options = [];
    s.deadline = 0;
    pushEvent(s, { kind: 'win', by: pl.id });
    announce.push(`THY SHALL NOT RAGE // ${pl.name} BROUGHT ALL FOUR HOME AND WINS.`);
    return { ok: true, announce };
  }
  if (s.roll === 6) {
    s.phase = 'roll';
    s.turnSeq += 1;
    s.tries = 1;
    s.roll = null;
    s.options = [];
    setClock(s, now, ROLL_MS);
  } else nextTurn(s, now);
  return { ok: true, announce };
}

// The server plays for an absent or slow player: furthest-reaching move
// (captures are already forced by legalMoves).
function autoMove(s, now) {
  const best = s.options.slice().sort((a, b) => (b.to >= HOME_FIRST) - (a.to >= HOME_FIRST) || (b.from === -1) - (a.from === -1) || b.from - a.from)[0];
  return applyMove(s, best, now);
}

function forfeit(s, id, why) {
  const pl = s.players[id];
  if (!pl || pl.out) return { ok: true, already: true };
  const wasTurn = current(s).id === id;
  pl.out = true;
  pl.pieces = pl.pieces.map(() => -1);
  const announce = [`THY SHALL NOT RAGE // ${pl.name} ${why}.`];
  const left = s.order.filter(pid => !s.players[pid].out);
  if (left.length === 1) {
    s.phase = 'ended';
    s.winnerId = left[0];
    s.endedAt = Date.now();
    s.options = [];
    s.deadline = 0;
    pushEvent(s, { kind: 'win', by: left[0] });
    announce.push(`THY SHALL NOT RAGE // ${s.players[left[0]].name} IS THE LAST ONE AT THE TABLE AND WINS.`);
  } else if (wasTurn) nextTurn(s, Date.now());
  return { ok: true, announce };
}

// The clock. Offline players are played for after a short grace.
function tick(s, now = Date.now(), onlineIds = null) {
  if (!s) return { changed: false };
  if (s.phase === 'ended') return { changed: false, expired: now - s.endedAt > ENDED_TTL_MS };
  if (s.phase === 'lobby') return { changed: false, expired: now - s.createdAt > LOBBY_TTL_MS };
  const pl = current(s);
  const offline = onlineIds && !onlineIds.has(pl.id);
  const limit = offline ? Math.min(s.deadline, (s.clockAt || 0) + OFFLINE_MS) : s.deadline;
  if (now < limit) return { changed: false };
  if (s.phase === 'roll') return { changed: true, ...doRoll(s, now) };
  return { changed: true, ...autoMove(s, now) };
}

function view(s, viewerId, now = Date.now(), onlineIds = new Set()) {
  if (!s) return null;
  viewerId = String(viewerId || '');
  const turn = isLive(s) ? current(s) : null;
  const yourTurn = !!turn && turn.id === viewerId;
  return {
    id: s.id,
    phase: s.phase,
    ownerId: s.ownerId,
    ownerName: s.ownerName,
    stake: s.stake,
    colors: COLORS.slice(),
    pot: s.pot,
    members: s.members.map(m => ({ ...m, online: onlineIds.has(m.id) })),
    players: s.order.map(id => {
      const p = s.players[id];
      return { id, name: p.name, color: p.color || COLORS[p.seat], seat: p.seat, pieces: p.pieces.slice(), out: p.out, online: onlineIds.has(id) };
    }),
    turnId: turn?.id || null,
    turnName: turn?.name || null,
    turnSeq: s.turnSeq,
    roll: s.roll,
    tries: s.tries,
    options: yourTurn && s.phase === 'move' ? s.options.map(m => ({ piece: m.piece, to: m.to, capture: !!m.capture })) : [],
    mustCapture: s.phase === 'move' && s.options.some(m => m.capture),
    deadline: s.deadline,
    serverNow: now,
    events: s.events.slice(),
    winnerId: s.winnerId,
    winnerName: s.winnerId ? s.players[s.winnerId]?.name : null,
    reward: s.reward ? { amount: s.reward.amount, house: !!s.reward.house } : null,
    you: {
      id: viewerId,
      member: s.members.some(m => m.id === viewerId),
      playing: !!s.players[viewerId] && !s.players[viewerId].out,
      owner: s.ownerId === viewerId,
      yourTurn
    }
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !PHASES.has(raw.phase) || typeof raw.id !== 'string') return null;
  return raw;
}

// After a restart the move in flight gets a fresh clock.
function resumeAfterRestart(s, now = Date.now()) {
  if (!s) return null;
  if (isLive(s)) setClock(s, now, s.phase === 'roll' ? ROLL_MS : MOVE_MS);
  return s;
}

module.exports = {
  ROLL_MS, MOVE_MS, MAX_PLAYERS, MAX_STAKE, TRACK, HOME_FIRST, HOME_LAST,
  COLORS, createLobby, pickColor, isOpenLobby, isLive, join, leave, start, begin, roll, move, forfeit, tick, view,
  legalMoves, absSquare, normalizeState, resumeAfterRestart
};
