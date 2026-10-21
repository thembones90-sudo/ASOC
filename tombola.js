'use strict';
const crypto = require('crypto');
const BLESSINGS = Object.freeze([[2, 4], [3, 5], [5, 5], [8, 3]]);
const CURSES = Object.freeze([[2, 3], [4, 4], [6, 5], [10, 4], [15, 1]]);
const SIGNUP_MS = 2 * 60 * 1000;
const TURN_MS = 20 * 1000;
function inventory() {
  return [...BLESSINGS.flatMap(([amount, count]) => Array.from({ length: count }, () => ({ kind: 'BLESSING', amount }))),
    ...CURSES.flatMap(([amount, count]) => Array.from({ length: count }, () => ({ kind: 'CURSE', amount }))), { kind: 'GRAIL', amount: 50 }, { kind: 'BLOOD_TRIBUTE', amount: 0 }];
}
function legacyInventory(grail = true) {
  const entries = (kind, pairs) => pairs.flatMap(([amount, count]) => Array.from({ length: count }, () => ({ kind, amount })));
  return [...entries('BLESSING', [[1, 6], [2, 5], [3, 4], [5, 2]]), { kind: grail ? 'GRAIL' : 'BLESSING', amount: grail ? 50 : 10 },
    ...entries('CURSE', [[1, 5], [2, 5], [3, 4], [5, 2], [10, 1]]), { kind: 'BLOOD_TRIBUTE', amount: 0 }];
}
function shuffle(items, randomInt = crypto.randomInt) {
  const copy = items.map(item => ({ ...item }));
  for (let i = copy.length - 1; i > 0; i--) { const j = randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
function create(id, now = Date.now()) {
  return { id, economyVersion: 2, endOnBlood: true, visible: true, phase: 'LOBBY', createdAt: now, signupEndsAt: now + SIGNUP_MS, startedAt: null, endedAt: null, participants: [],
    turnIndex: 0, cycle: 1, turnOrder: [], turnNumber: 0, turnEndsAt: null, timeouts: [], endReason: null,
    inventory: shuffle(inventory()), reveals: [], tributePlayerId: null, tributePactId: null, cancelled: false };
}
function join(state, player, now = Date.now()) {
  if (state.phase !== 'LOBBY' || now >= state.signupEndsAt) return { error: 'FATEBREAKER SIGNUP IS CLOSED' };
  if (state.participants.some(p => p.id === player.id)) return { error: 'YOU ARE ALREADY IN FATEBREAKER' };
  if (state.participants.length >= 10) return { error: 'FATEBREAKER IS FULL // MAXIMUM 10 PLAYERS' };
  state.participants.push({ id: String(player.id), name: String(player.name || 'LITTLE HERO').slice(0, 80), missedTurns: 0, kicked: false });
  return { ok: true };
}
function leave(state, id, now = Date.now(), randomInt = crypto.randomInt) {
  const player = state.participants.find(p => p.id === id);
  if (!player || player.kicked || player.left) return { error: 'YOU ARE NOT AN ACTIVE FATEBREAKER PLAYER' };
  if (state.phase === 'LOBBY') {
    if (now >= state.signupEndsAt) return { error: 'FATEBREAKER SIGNUP IS CLOSED // ROSTER LOCKED' };
    state.participants = state.participants.filter(p => p.id !== id); return { ok: true };
  }
  if (state.phase !== 'PLAYING') return { error: 'FATEBREAKER IS ALREADY OVER' };
  // Keep identity/reveal history for recovery and any tribute obligation, but
  // remove the player from this cycle and all future randomized cycles.
  player.left = true; player.leftAt = now;
  const index = state.turnOrder.indexOf(id);
  if (index === state.turnIndex) advanceTurn(state, now, randomInt, true);
  else {
    state.turnOrder.splice(index, 1);
    if (index < state.turnIndex) state.turnIndex--;
  }
  if (state.phase === 'CANCELLED') state.endReason = 'NO_PLAYERS_REMAIN';
  return { ok: true, playerLeft: player };
}
function start(state, activeIds, now = Date.now(), randomInt = crypto.randomInt) {
  if (state.phase !== 'LOBBY') return { error: 'THIS ROUND HAS ALREADY STARTED' };
  const roster = state.participants.filter(p => activeIds.includes(p.id));
  if (roster.length < 2) return { error: 'FATEBREAKER NEEDS TWO ACTIVE PLAYERS' };
  if (state.economyVersion !== 2) { state.inventory = shuffle(inventory(), randomInt); state.economyVersion = 2; state.endOnBlood = true; }
  state.participants = roster;
  state.turnOrder = shuffle(roster, randomInt).map(p => p.id); state.cycle = 1;
  state.phase = 'PLAYING'; state.startedAt = now; state.turnIndex = 0;
  state.turnNumber = 1; state.turnEndsAt = now + TURN_MS; state.timeouts = []; return { ok: true };
}
function current(state) { return state.phase === 'PLAYING' ? state.participants.find(p => p.id === state.turnOrder[state.turnIndex]) : null; }
function validatePick(state, playerId, field, roundId, now = Date.now()) {
  if (!state || state.id !== roundId) return { error: 'THIS FATEBREAKER ROUND IS NO LONGER CURRENT' };
  if (state.phase !== 'PLAYING') return { error: 'FATEBREAKER IS NOT ACCEPTING SELECTIONS' };
  if (current(state)?.id !== playerId) return { error: 'WAIT FOR YOUR FATEBREAKER TURN' };
  if (Number.isFinite(state.turnEndsAt) && now >= state.turnEndsAt) return { error: 'YOUR FATEBREAKER TURN HAS EXPIRED' };
  if (!Number.isInteger(field) || field < 1 || field > 36) return { error: 'SELECT A FIELD FROM 1 TO 36' };
  if (state.reveals.some(r => r.field === field)) return { error: 'THAT VAULT IS ALREADY OPEN' };
  return { ok: true, outcome: { ...state.inventory[field - 1] } };
}
function reveal(state, playerId, field, actualAmount, now = Date.now(), randomInt = crypto.randomInt) {
  const checked = validatePick(state, playerId, field, state.id, now);
  if (!checked.ok) return checked;
  const player = current(state), outcome = checked.outcome;
  state.reveals.push({ field, ...outcome, playerId, playerName: player.name, actualAmount, at: now });
  if (outcome.kind === 'BLOOD_TRIBUTE') state.tributePlayerId = playerId;
  if ((outcome.kind === 'BLOOD_TRIBUTE' && state.endOnBlood) || state.reveals.length === 36) { state.phase = 'ENDED'; state.endedAt = now; state.turnEndsAt = null; }
  else advanceTurn(state, now, randomInt);
  return { ok: true, reveal: state.reveals.at(-1) };
}
function advanceTurn(state, now, randomInt = crypto.randomInt, removeCurrent = false) {
  if (removeCurrent) state.turnOrder.splice(state.turnIndex, 1);
  else state.turnIndex++;
  const active = state.participants.filter(p => !p.kicked && !p.left);
  if (!active.length) {
    state.phase = 'CANCELLED'; state.cancelled = true; state.endReason = state.participants.some(p => p.left) ? 'NO_PLAYERS_REMAIN' : 'ALL_PLAYERS_REMOVED'; state.endedAt = now; state.turnEndsAt = null; return;
  }
  if (state.turnIndex >= state.turnOrder.length) {
    state.turnIndex = 0; state.cycle++;
    state.turnOrder = shuffle(active, randomInt).map(p => p.id);
  }
  state.turnNumber = (state.turnNumber || 1) + 1;
  state.turnEndsAt = now + TURN_MS;
}
function expire(state, actualAmount, now = Date.now(), randomInt = crypto.randomInt) {
  if (state?.phase !== 'PLAYING' || !Number.isFinite(state.turnEndsAt) || now < state.turnEndsAt) return { error: 'NO EXPIRED TURN' };
  const player = current(state);
  if (!player) return { error: 'NO CURRENT PLAYER' };
  player.missedTurns = (player.missedTurns || 0) + 1;
  player.kicked = player.missedTurns >= 2;
  const timeout = { turnNumber: state.turnNumber, playerId: player.id, playerName: player.name,
    missedTurns: player.missedTurns, kicked: player.kicked, actualAmount, at: now };
  (state.timeouts ||= []).push(timeout);
  advanceTurn(state, now, randomInt, player.kicked);
  return { ok: true, timeout };
}
function skip(state) {
  return { error: 'EVERY PLAYER MUST MAKE ONE MOVE // TURNS CANNOT BE SKIPPED' };
}
function cancel(state, now = Date.now()) {
  if (!['LOBBY', 'PLAYING'].includes(state.phase)) return { error: 'FATEBREAKER IS ALREADY OVER' };
  state.phase = 'CANCELLED'; state.cancelled = true; state.endedAt = now; state.turnEndsAt = null; return { ok: true };
}
function summary(state) {
  return { id: state.id, economyVersion: state.economyVersion, endOnBlood: state.endOnBlood, visible: state.visible !== false, phase: state.phase, createdAt: state.createdAt, endedAt: state.endedAt,
    participants: state.participants.map(p => ({ ...p })), revealedCount: state.reveals.length,
    tributePlayerId: state.tributePlayerId, tributePlayerName: state.participants.find(p => p.id === state.tributePlayerId)?.name || null };
}
function view(state, viewerId, isGm = false, history = [], now = Date.now()) {
  if (!state) return { active: false, history, viewer: { isGm } };
  const participant = state.participants.some(p => p.id === viewerId && !p.kicked && !p.left);
  const turn = current(state);
  return { active: true, ...summary(state), visible: state.visible !== false, signupEndsAt: state.signupEndsAt, startedAt: state.startedAt, participants: state.participants.map(p => ({ ...p })),
    cycle: state.cycle, turnOrder: state.turnOrder, turnNumber: state.turnNumber, turnEndsAt: state.turnEndsAt,
    turnDurationMs: TURN_MS, timeouts: state.timeouts || [], endReason: state.endReason,
    currentPlayerId: turn?.id || null, currentPlayerName: turn?.name || null,
    fields: Array.from({ length: 36 }, (_, i) => { const r = state.reveals.find(x => x.field === i + 1); return r ? { ...r, revealed: true } : { field: i + 1, revealed: false }; }),
    history, viewer: { isGm, participant, canJoin: !isGm && !participant && state.phase === 'LOBBY' && now < state.signupEndsAt && state.participants.length < 10,
      canLeave: !isGm && participant && (state.phase === 'PLAYING' || state.phase === 'LOBBY' && now < state.signupEndsAt),
      canPick: !isGm && turn?.id === viewerId && now < state.turnEndsAt, canStart: isGm && state.phase === 'LOBBY', canCancel: isGm && ['LOBBY', 'PLAYING'].includes(state.phase) } };
}
function normalize(raw) {
  if (!raw || !['LOBBY', 'PLAYING', 'ENDED', 'CANCELLED'].includes(raw.phase) || typeof raw.id !== 'string') return null;
  const deck = raw.inventory;
  const signature = items => items.map(x => `${x.kind}:${x.amount}`).sort().join('|');
  if (!Array.isArray(deck) || deck.length !== 36 || deck.some(x => !x || typeof x.kind !== 'string' || !Number.isFinite(x.amount))) return null;
  const deckSignature = signature(deck);
  const economyVersion = deckSignature === signature(inventory()) ? 2 : [signature(legacyInventory()), signature(legacyInventory(false))].includes(deckSignature) ? 1 : 0;
  if (!economyVersion) return null;
  const endOnBlood = economyVersion === 2 || !deck.some(f => f.kind === 'GRAIL');
  const participants = Array.isArray(raw.participants) ? raw.participants.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({ id: p.id, name: p.name.slice(0, 80),
    missedTurns: Math.min(2, Math.max(0, Math.floor(Number(p.missedTurns) || 0))), kicked: p.kicked === true || Number(p.missedTurns) >= 2,
    ...(p.left === true ? { left: true, leftAt: Number(p.leftAt) || null } : {}) })) : [];
  if (participants.length > 10 || new Set(participants.map(p => p.id)).size !== participants.length || (raw.phase === 'PLAYING' && participants.length < 2)) return null;
  const reveals = Array.isArray(raw.reveals) ? raw.reveals.map(r => ({ ...r })) : [];
  if (reveals.length > 36 || new Set(reveals.map(r => r.field)).size !== reveals.length || reveals.some(r => !Number.isInteger(r.field) || r.field < 1 || r.field > 36 || r.kind !== deck[r.field - 1].kind || r.amount !== deck[r.field - 1].amount || !participants.some(p => p.id === r.playerId))) return null;
  if (raw.phase === 'PLAYING' && (reveals.length === 36 || (endOnBlood && reveals.some(r => r.kind === 'BLOOD_TRIBUTE')))) return null;
  if (economyVersion === 2 && raw.phase === 'ENDED' && (reveals.at(-1)?.kind !== 'BLOOD_TRIBUTE' || reveals.slice(0, -1).some(r => r.kind === 'BLOOD_TRIBUTE'))) return null;
  const turnOrder = raw.phase === 'CANCELLED' && !raw.startedAt ? participants.map(p => p.id) : Array.isArray(raw.turnOrder) ? raw.turnOrder.slice() : participants.map(p => p.id);
  const eligible = participants.filter(p => !p.kicked && !p.left);
  if (raw.phase !== 'LOBBY' && (turnOrder.length !== eligible.length || new Set(turnOrder).size !== eligible.length || turnOrder.some(id => !eligible.some(p => p.id === id)))) return null;
  const turnIndex = Math.max(0, Math.floor(Number(raw.turnIndex) || 0));
  if (raw.phase === 'PLAYING' && turnIndex >= turnOrder.length) return null;
  return { id: raw.id, economyVersion, endOnBlood, visible: raw.visible !== false, phase: raw.phase, createdAt: Number(raw.createdAt) || 0, signupEndsAt: (Number(raw.createdAt) || 0) + SIGNUP_MS, startedAt: Number(raw.startedAt) || null, endedAt: Number(raw.endedAt) || null,
    participants, inventory: deck.map(x => ({ kind: x.kind, amount: x.amount })), reveals,
    turnIndex, turnOrder, cycle: Math.max(1, Math.floor(Number(raw.cycle) || 1)),
    turnNumber: Math.max(1, Math.floor(Number(raw.turnNumber) || reveals.length + 1)),
    turnEndsAt: raw.phase === 'PLAYING' ? (Number(raw.turnEndsAt) > 0 ? Number(raw.turnEndsAt) : Date.now() + TURN_MS) : null,
    timeouts: Array.isArray(raw.timeouts) ? raw.timeouts.map(t => ({ ...t })) : [], endReason: raw.endReason || null,
    tributePlayerId: reveals.find(r => r.kind === 'BLOOD_TRIBUTE')?.playerId || null, tributePactId: raw.tributePactId || null, cancelled: raw.phase === 'CANCELLED' };
}
module.exports = { TURN_MS, inventory, create, join, leave, start, current, validatePick, reveal, expire, skip, cancel, summary, view, normalize };
