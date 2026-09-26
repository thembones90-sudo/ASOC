// KALADONT -- server-authoritative multiplayer elimination word chain for the
// AMUSEMENT PARK (Casual mode). Pure state machine: every function takes the
// current time (and the shuffle RNG) from the caller, mutates one plain,
// JSON-serializable state object, and returns { ok, error, announce[] } where
// `announce` lists public Battle Comms lines. server.js owns sockets, timers,
// persistence and broadcasting; this module owns the rules.
//
// Phases: lobby -> turn -> (tribunal) -> verdict -> turn ... -> ended.
//
// Rules:
// - Any online Little Hero OR the Shadow Broker creates the one room lobby;
//   others JOIN voluntarily. The creator (owner) sets up / starts / cancels.
//   The Shadow Broker may end any lobby/game. >= 2 online to start.
// - START shuffles the online members once into a fixed turn order.
// - A turn lasts TURN_MS. Only the current player submits, once.
// - The server judges STRUCTURE only: letters only, 2..MAX_WORD letters, the
//   required prefix (last two letters of the last ACCEPTED word; none on an
//   opening turn), and no repeat of an accepted word. A structural failure
//   eliminates the submitter at once (no tribunal); the chain is unchanged.
// - A structurally valid word goes to the TRIBUNAL: every living player,
//   submitter included, votes ACCEPT / REJECT once within VOTE_MS. Votes are
//   secret until the verdict. Missing votes count as ACCEPT (silence cannot
//   execute anyone); ties ACCEPT. REJECT majority eliminates the submitter.
// - KALADONT: the exact word KALADONT that satisfies the prefix is accepted
//   without a tribunal and kills the next living player (NT is terminal).
//   The survivor after that opens a fresh chain (no required prefix).
// - Timeout eliminates the current player. Eliminated players spectate.
// - Last living player wins.
const crypto = require('crypto');

const TURN_MS = Number(process.env.ASOC_KALADONT_TURN_MS) || 60000;
const VOTE_MS = Number(process.env.ASOC_KALADONT_VOTE_MS) || 15000;
const VERDICT_MS = Number(process.env.ASOC_KALADONT_VERDICT_MS) || 4000;
const ENDED_TTL_MS = 10 * 60 * 1000;
const MAX_WORD = 32;
const MAX_PLAYERS = 16;
const SPECIAL = 'KALADONT';
const PHASES = new Set(['lobby', 'turn', 'tribunal', 'verdict', 'ended']);

const REASONS = Object.freeze({
  TIMEOUT: 'TURN TIMEOUT',
  PREFIX: 'INVALID PREFIX',
  DUPLICATE: 'DUPLICATE WORD',
  INVALID: 'INVALID WORD',
  REJECTED: 'WORD REJECTED',
  KALADONT: 'KALADONT KILL'
});

// Case-insensitive, whitespace-trimmed. Serbian Latin/Cyrillic letters pass
// \p{L}; no transliteration (the app has no normalization strategy for it).
function normalizeWord(raw) {
  return String(raw ?? '').normalize('NFC').trim().toLocaleUpperCase('sr');
}

function lastTwo(word) {
  return [...word].slice(-2).join('');
}

function startsWithPrefix(word, prefix) {
  return !prefix || word.startsWith(prefix);
}

function cleanName(name) {
  return String(name || 'LITTLE HERO').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'LITTLE HERO';
}

function createLobby(owner, now) {
  return {
    id: 'kal-' + crypto.randomBytes(6).toString('hex'),
    phase: 'lobby',
    ownerId: String(owner.id),
    createdAt: now,
    members: [{ id: String(owner.id), name: cleanName(owner.name) }],
    order: [],
    players: {},
    turn: null,
    prefix: '',
    history: [],
    tribunal: null,
    result: null,
    verdictUntil: 0,
    resumeIndex: 0,
    eliminations: [],
    winnerId: null,
    endedAt: 0,
    seq: 0
  };
}

// Restores a persisted state; returns null for anything unusable.
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !PHASES.has(raw.phase) || typeof raw.id !== 'string') return null;
  return {
    ...createLobby({ id: raw.ownerId || 'x', name: '' }, Number(raw.createdAt) || Date.now()),
    ...raw,
    members: Array.isArray(raw.members) ? raw.members.filter(m => m && m.id).map(m => ({ id: String(m.id), name: cleanName(m.name) })) : [],
    order: Array.isArray(raw.order) ? raw.order.map(String) : [],
    players: raw.players && typeof raw.players === 'object' ? raw.players : {},
    history: Array.isArray(raw.history) ? raw.history : [],
    eliminations: Array.isArray(raw.eliminations) ? raw.eliminations : []
  };
}

// After a server restart, give the phase in flight a fresh window rather than
// executing a player for time lost to the outage. Votes already cast stand.
function resumeAfterRestart(state, now) {
  if (!state) return state;
  if (state.phase === 'turn' && state.turn) state.turn.deadline = now + TURN_MS;
  if (state.phase === 'tribunal' && state.tribunal) state.tribunal.deadline = now + VOTE_MS;
  if (state.phase === 'verdict') state.verdictUntil = now + VERDICT_MS;
  return state;
}

function nameOf(state, id) {
  return state.players[id]?.name || state.members.find(m => m.id === id)?.name || 'LITTLE HERO';
}

function living(state) {
  return state.order.filter(id => state.players[id]?.alive);
}

function isActive(state) {
  return !!state && ['turn', 'tribunal', 'verdict'].includes(state.phase);
}

function isOpenLobby(state) {
  return !!state && state.phase === 'lobby';
}

// ---- lobby ------------------------------------------------------------------

function join(state, player) {
  if (!isOpenLobby(state)) return { ok: false, error: state?.phase === 'ended' || !state ? 'NO KALADONT LOBBY IS OPEN' : 'KALADONT HAS ALREADY STARTED // JOINING IS CLOSED' };
  const id = String(player.id);
  if (state.members.some(m => m.id === id)) return { ok: true, already: true, announce: [] };
  if (state.members.length >= MAX_PLAYERS) return { ok: false, error: `KALADONT LOBBY IS FULL (${MAX_PLAYERS})` };
  state.members.push({ id, name: cleanName(player.name) });
  state.seq++;
  return { ok: true, announce: [] };
}

function leave(state, playerId) {
  if (!isOpenLobby(state)) return { ok: false, error: 'YOU CAN ONLY LEAVE BEFORE THE GAME STARTS' };
  const id = String(playerId);
  if (id === state.ownerId) return { ok: false, error: 'THE CREATOR CANCELS THE LOBBY INSTEAD OF LEAVING' };
  const before = state.members.length;
  state.members = state.members.filter(m => m.id !== id);
  if (state.members.length === before) return { ok: false, error: 'YOU ARE NOT IN THIS LOBBY' };
  state.seq++;
  return { ok: true, announce: [] };
}

// A lobby member dropped. The owner hands the lobby to the next online member;
// with nobody online left, the lobby closes (returns { closed: true }).
function lobbyDisconnect(state, playerId, onlineIds) {
  if (!isOpenLobby(state)) return { ok: true, closed: false, announce: [] };
  const id = String(playerId);
  if (id !== state.ownerId) return { ok: true, closed: false, announce: [] };
  const online = new Set([...onlineIds].map(String));
  const heir = state.members.find(m => m.id !== id && online.has(m.id));
  if (!heir) return { ok: true, closed: true, announce: [`KALADONT // ${nameOf(state, id)}'S LOBBY CLOSED.`] };
  state.ownerId = heir.id;
  state.seq++;
  return { ok: true, closed: false, announce: [`KALADONT // ${heir.name} NOW LEADS THE LOBBY.`] };
}

function start(state, actorId, onlineIds, now, random = Math.random) {
  if (!state) return { ok: false, error: 'NO KALADONT LOBBY IS OPEN' };
  if (state.phase !== 'lobby') return { ok: false, error: 'KALADONT HAS ALREADY STARTED' };
  if (String(actorId) !== state.ownerId) return { ok: false, error: 'ONLY THE LOBBY CREATOR CAN START KALADONT' };
  const online = new Set([...onlineIds].map(String));
  const ready = state.members.filter(m => online.has(m.id));
  if (ready.length < 2) return { ok: false, error: 'KALADONT NEEDS AT LEAST 2 ONLINE PLAYERS' };
  // Fixed random turn order, generated exactly once.
  const order = ready.map(m => m.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  state.order = order;
  state.players = Object.fromEntries(ready.map(m => [m.id, { name: m.name, alive: true, reason: null, word: null, place: null }]));
  state.members = ready;
  state.prefix = '';
  state.history = [];
  state.eliminations = [];
  beginTurn(state, 0, now);
  return { ok: true, announce: [`KALADONT // THE GAME BEGINS. ${order.length} PLAYERS: ${order.map(id => nameOf(state, id)).join(' → ')}.`] };
}

// ---- turns --------------------------------------------------------------------

function beginTurn(state, index, now) {
  const n = state.order.length;
  let i = ((index % n) + n) % n;
  for (let k = 0; k < n && !state.players[state.order[i]]?.alive; k++) i = (i + 1) % n;
  state.phase = 'turn';
  state.tribunal = null;
  state.result = null;
  state.seq++;
  state.turn = { seq: state.seq, index: i, playerId: state.order[i], deadline: now + TURN_MS, prefix: state.prefix };
}

function eliminate(state, id, reason, word, now) {
  const p = state.players[id];
  if (!p || !p.alive) return null;
  p.alive = false;
  p.reason = reason;
  p.word = word || null;
  const aliveCount = living(state).length;
  p.place = aliveCount + 1;
  const entry = { id, name: p.name, reason, word: word || null, at: now, place: p.place };
  state.eliminations.push(entry);
  return entry;
}

function nextLivingIndex(state, fromIndex) {
  const n = state.order.length;
  for (let k = 1; k <= n; k++) {
    const i = (fromIndex + k) % n;
    if (state.players[state.order[i]]?.alive) return i;
  }
  return -1;
}

// Every resolution lands here: either the match is won, or a short verdict
// reveal plays before the next living player's turn.
function afterResolution(state, fromIndex, now, announce) {
  const alive = living(state);
  if (alive.length <= 1) {
    state.phase = 'ended';
    state.winnerId = alive[0] || null;
    state.endedAt = now;
    state.turn = null;
    state.tribunal = null;
    if (state.winnerId) state.players[state.winnerId].place = 1;
    state.seq++;
    if (state.winnerId) announce.push(`KALADONT // LAST LITTLE HERO STANDING: ${nameOf(state, state.winnerId)} WINS KALADONT.`);
    return;
  }
  state.phase = 'verdict';
  state.verdictUntil = now + VERDICT_MS;
  state.resumeIndex = nextLivingIndex(state, fromIndex);
  state.seq++;
}

function failTurn(state, reason, word, now, announce) {
  const index = state.turn.index;
  const id = state.turn.playerId;
  const out = eliminate(state, id, reason, word, now);
  state.result = { kind: 'eliminated', playerId: id, word: word || null, reason, votes: null };
  if (out) announce.push(`KALADONT // ${out.name} IS ELIMINATED: ${reason}${word ? ` ("${word}")` : ''}.`);
  afterResolution(state, index, now, announce);
}

function submit(state, actorId, rawWord, turnSeq, now) {
  if (!state || state.phase !== 'turn' || !state.turn) return { ok: false, error: 'IT IS NOT A KALADONT TURN' };
  const id = String(actorId);
  if (!state.players[id]?.alive) return { ok: false, error: 'SPECTATORS CANNOT PLAY' };
  if (id !== state.turn.playerId) return { ok: false, error: 'IT IS NOT YOUR TURN' };
  if (turnSeq !== undefined && turnSeq !== null && Number(turnSeq) !== state.turn.seq) return { ok: false, error: 'THAT TURN IS OVER' };
  if (now > state.turn.deadline) return { ok: false, error: 'TIME IS UP' };

  const announce = [];
  const word = normalizeWord(rawWord);
  const shown = word.slice(0, MAX_WORD);
  const letters = [...word];
  let failure = null;
  if (!word) failure = REASONS.INVALID;
  else if (letters.length > MAX_WORD || letters.length < 2 || !/^\p{L}+$/u.test(word)) failure = REASONS.INVALID;
  else if (!startsWithPrefix(word, state.prefix)) failure = REASONS.PREFIX;
  else if (state.history.some(h => h.word === word)) failure = REASONS.DUPLICATE;
  if (failure) {
    failTurn(state, failure, shown, now, announce);
    return { ok: true, outcome: 'eliminated', reason: failure, announce };
  }

  if (word === SPECIAL) {
    const index = state.turn.index;
    state.history.push({ word, by: id, at: now });
    const victimIndex = nextLivingIndex(state, index);
    const victimId = victimIndex >= 0 && state.order[victimIndex] !== id ? state.order[victimIndex] : null;
    const killed = victimId ? eliminate(state, victimId, REASONS.KALADONT, null, now) : null;
    state.prefix = ''; // NT is terminal: the next survivor opens a fresh chain
    state.result = { kind: 'kaladont', playerId: id, word, reason: null, killedId: killed ? victimId : null, votes: null };
    announce.push(`KALADONT // ${nameOf(state, id)} PLAYS KALADONT${killed ? ` AND KILLS ${killed.name}` : ''}.`);
    // The killed player's slot is skipped: resume after them.
    afterResolution(state, victimIndex >= 0 ? victimIndex : index, now, announce);
    return { ok: true, outcome: 'kaladont', announce };
  }

  state.phase = 'tribunal';
  state.seq++;
  state.tribunal = { seq: state.seq, word, by: id, index: state.turn.index, deadline: now + VOTE_MS, votes: {} };
  return { ok: true, outcome: 'tribunal', announce };
}

function vote(state, actorId, choice, tribunalSeq, now) {
  if (!state || state.phase !== 'tribunal' || !state.tribunal) return { ok: false, error: 'NO TRIBUNAL IS OPEN' };
  const id = String(actorId);
  if (!state.players[id]?.alive) return { ok: false, error: 'ONLY LIVING PLAYERS VOTE' };
  if (tribunalSeq !== undefined && tribunalSeq !== null && Number(tribunalSeq) !== state.tribunal.seq) return { ok: false, error: 'THAT TRIBUNAL IS CLOSED' };
  if (now > state.tribunal.deadline) return { ok: false, error: 'VOTING IS CLOSED' };
  if (choice !== 'accept' && choice !== 'reject') return { ok: false, error: 'VOTE ACCEPT OR REJECT' };
  if (state.tribunal.votes[id]) return { ok: false, error: 'YOU ALREADY VOTED' };
  state.tribunal.votes[id] = choice;
  state.seq++;
  const announce = [];
  if (living(state).every(pid => state.tribunal.votes[pid])) resolveTribunal(state, now, announce);
  return { ok: true, announce };
}

function resolveTribunal(state, now, announce) {
  const t = state.tribunal;
  const voters = living(state);
  const accept = [];
  const reject = [];
  const defaulted = [];
  voters.forEach(pid => {
    const v = t.votes[pid];
    if (v === 'reject') reject.push(pid);
    else {
      accept.push(pid);
      if (!v) defaulted.push(pid); // silence counts as ACCEPT
    }
  });
  const votes = { accept, reject, defaulted };
  if (accept.length >= reject.length) {
    state.history.push({ word: t.word, by: t.by, at: now });
    state.prefix = lastTwo(t.word);
    state.result = { kind: 'accepted', playerId: t.by, word: t.word, reason: null, votes };
  } else {
    const out = eliminate(state, t.by, REASONS.REJECTED, t.word, now);
    state.result = { kind: 'rejected', playerId: t.by, word: t.word, reason: REASONS.REJECTED, votes };
    if (out) announce.push(`KALADONT // ${out.name} IS ELIMINATED: WORD REJECTED ("${t.word}", ${reject.length}-${accept.length}).`);
  }
  state.tribunal = { ...t, closed: true };
  afterResolution(state, t.index, now, announce);
}

// Advances the clock. Returns { changed, announce, expired } -- expired means
// an ended match aged out and the caller should drop it.
function tick(state, now) {
  const announce = [];
  if (!state) return { changed: false, announce };
  if (state.phase === 'turn' && state.turn && now > state.turn.deadline) {
    failTurn(state, REASONS.TIMEOUT, null, now, announce);
    return { changed: true, announce };
  }
  if (state.phase === 'tribunal' && state.tribunal && now > state.tribunal.deadline) {
    resolveTribunal(state, now, announce);
    return { changed: true, announce };
  }
  if (state.phase === 'verdict' && now >= state.verdictUntil) {
    beginTurn(state, state.resumeIndex, now);
    return { changed: true, announce };
  }
  if (state.phase === 'ended' && now - state.endedAt > ENDED_TTL_MS) return { changed: true, announce, expired: true };
  return { changed: false, announce };
}

// What one viewer may see. Individual votes stay secret until the verdict.
function view(state, viewerId, now, onlineIds = null) {
  if (!state) return null;
  const me = String(viewerId || '');
  const online = onlineIds ? new Set([...onlineIds].map(String)) : null;
  const isOnline = id => (online ? online.has(id) : true);
  const t = state.tribunal;
  const tribunal = t ? {
    seq: t.seq,
    word: t.word,
    by: t.by,
    byName: nameOf(state, t.by),
    deadline: t.deadline,
    closed: !!t.closed,
    voted: Object.keys(t.votes).length,
    voters: living(state).length,
    youVoted: t.votes[me] || null
  } : null;
  const votes = state.result?.votes
    ? {
        accept: state.result.votes.accept.map(id => ({ id, name: nameOf(state, id), defaulted: state.result.votes.defaulted.includes(id) })),
        reject: state.result.votes.reject.map(id => ({ id, name: nameOf(state, id) }))
      }
    : null;
  return {
    id: state.id,
    phase: state.phase,
    seq: state.seq,
    serverNow: now,
    ownerId: state.ownerId,
    ownerName: nameOf(state, state.ownerId),
    members: state.members.map(m => ({ id: m.id, name: m.name, online: isOnline(m.id) })),
    order: state.order.map(id => ({ id, name: nameOf(state, id), online: isOnline(id), alive: !!state.players[id]?.alive, reason: state.players[id]?.reason || null, place: state.players[id]?.place || null })),
    turn: state.turn ? { seq: state.turn.seq, playerId: state.turn.playerId, playerName: nameOf(state, state.turn.playerId), deadline: state.turn.deadline, prefix: state.turn.prefix } : null,
    prefix: state.prefix,
    history: state.history.map(h => ({ word: h.word, by: h.by, byName: nameOf(state, h.by) })),
    tribunal,
    result: state.result ? { ...state.result, playerName: nameOf(state, state.result.playerId), killedName: state.result.killedId ? nameOf(state, state.result.killedId) : null, votes } : null,
    verdictUntil: state.verdictUntil,
    eliminations: state.eliminations.map(e => ({ ...e })),
    winnerId: state.winnerId,
    winnerName: state.winnerId ? nameOf(state, state.winnerId) : null,
    // Set by the server layer when the win pays out (Shadow Coins); only the
    // winner sees their own new balance.
    reward: state.reward && !state.reward.skipped ? {
      playerId: state.reward.playerId,
      amount: state.reward.amount,
      balance: state.reward.playerId === me ? state.reward.balance : null
    } : null,
    you: {
      member: state.members.some(m => m.id === me),
      owner: state.ownerId === me,
      alive: !!state.players[me]?.alive,
      playing: !!state.players[me]
    }
  };
}

module.exports = {
  TURN_MS, VOTE_MS, VERDICT_MS, MAX_WORD, MAX_PLAYERS, SPECIAL, REASONS,
  normalizeWord, lastTwo, createLobby, normalizeState, resumeAfterRestart,
  join, leave, lobbyDisconnect, start, submit, vote, tick, view,
  isActive, isOpenLobby, living
};
