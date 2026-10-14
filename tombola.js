'use strict';
const crypto = require('crypto');
const BLESSINGS = Object.freeze([[1, 6], [2, 5], [3, 4], [5, 2], [10, 1]]);
const CURSES = Object.freeze([[1, 5], [2, 5], [3, 4], [5, 2], [10, 1]]);
function inventory() {
  return [...BLESSINGS.flatMap(([amount, count]) => Array.from({ length: count }, () => ({ kind: 'BLESSING', amount }))),
    ...CURSES.flatMap(([amount, count]) => Array.from({ length: count }, () => ({ kind: 'CURSE', amount }))), { kind: 'BLOOD_TRIBUTE', amount: 0 }];
}
function shuffle(items, randomInt = crypto.randomInt) {
  const copy = items.map(item => ({ ...item }));
  for (let i = copy.length - 1; i > 0; i--) { const j = randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}
function create(id, now = Date.now()) {
  return { id, phase: 'LOBBY', createdAt: now, startedAt: null, endedAt: null, participants: [],
    turnIndex: 0, cycle: 1, turnOrder: [], inventory: shuffle(inventory()), reveals: [], tributePlayerId: null, tributePactId: null, cancelled: false };
}
function join(state, player) {
  if (state.phase !== 'LOBBY') return { error: 'TOMBOLA SIGNUP IS CLOSED' };
  if (state.participants.some(p => p.id === player.id)) return { error: 'YOU ARE ALREADY IN TOMBOLA' };
  if (state.participants.length >= 10) return { error: 'TOMBOLA IS FULL // MAXIMUM 10 PLAYERS' };
  state.participants.push({ id: String(player.id), name: String(player.name || 'LITTLE HERO').slice(0, 80) });
  return { ok: true };
}
function leave(state, id) {
  if (state.phase !== 'LOBBY') return { error: 'THE ROUND HAS ALREADY STARTED' };
  state.participants = state.participants.filter(p => p.id !== id); return { ok: true };
}
function start(state, activeIds, now = Date.now(), randomInt = crypto.randomInt) {
  if (state.phase !== 'LOBBY') return { error: 'THIS ROUND HAS ALREADY STARTED' };
  const roster = state.participants.filter(p => activeIds.includes(p.id));
  if (roster.length < 2) return { error: 'TOMBOLA NEEDS TWO ACTIVE PLAYERS' };
  state.participants = roster;
  state.turnOrder = shuffle(roster, randomInt).map(p => p.id); state.cycle = 1;
  state.phase = 'PLAYING'; state.startedAt = now; state.turnIndex = 0; return { ok: true };
}
function current(state) { return state.phase === 'PLAYING' ? state.participants.find(p => p.id === state.turnOrder[state.turnIndex]) : null; }
function validatePick(state, playerId, field, roundId) {
  if (!state || state.id !== roundId) return { error: 'THIS TOMBOLA ROUND IS NO LONGER CURRENT' };
  if (state.phase !== 'PLAYING') return { error: 'TOMBOLA IS NOT ACCEPTING SELECTIONS' };
  if (current(state)?.id !== playerId) return { error: 'WAIT FOR YOUR TOMBOLA TURN' };
  if (!Number.isInteger(field) || field < 1 || field > 36) return { error: 'SELECT A FIELD FROM 1 TO 36' };
  if (state.reveals.some(r => r.field === field)) return { error: 'THAT VAULT IS ALREADY OPEN' };
  return { ok: true, outcome: { ...state.inventory[field - 1] } };
}
function reveal(state, playerId, field, actualAmount, now = Date.now(), randomInt = crypto.randomInt) {
  const checked = validatePick(state, playerId, field, state.id);
  if (!checked.ok) return checked;
  const player = current(state), outcome = checked.outcome;
  state.reveals.push({ field, ...outcome, playerId, playerName: player.name, actualAmount, at: now });
  if (outcome.kind === 'BLOOD_TRIBUTE') state.tributePlayerId = playerId;
  if (state.reveals.length === 36) { state.phase = 'ENDED'; state.endedAt = now; }
  else {
    state.turnIndex++;
    if (state.turnIndex === state.participants.length) {
      state.turnIndex = 0; state.cycle++;
      state.turnOrder = shuffle(state.participants, randomInt).map(p => p.id);
    }
  }
  return { ok: true, reveal: state.reveals.at(-1) };
}
function skip(state) {
  return { error: 'EVERY PLAYER MUST MAKE ONE MOVE // TURNS CANNOT BE SKIPPED' };
}
function cancel(state, now = Date.now()) {
  if (!['LOBBY', 'PLAYING'].includes(state.phase)) return { error: 'TOMBOLA IS ALREADY OVER' };
  state.phase = 'CANCELLED'; state.cancelled = true; state.endedAt = now; return { ok: true };
}
function summary(state) {
  return { id: state.id, phase: state.phase, createdAt: state.createdAt, endedAt: state.endedAt,
    participants: state.participants.map(p => ({ ...p })), revealedCount: state.reveals.length,
    tributePlayerId: state.tributePlayerId, tributePlayerName: state.participants.find(p => p.id === state.tributePlayerId)?.name || null };
}
function view(state, viewerId, isGm = false, history = []) {
  if (!state) return { active: false, history, viewer: { isGm } };
  const participant = state.participants.some(p => p.id === viewerId);
  const turn = current(state);
  return { active: true, ...summary(state), startedAt: state.startedAt, participants: state.participants.map(p => ({ ...p })),
    cycle: state.cycle, turnOrder: state.turnOrder, currentPlayerId: turn?.id || null, currentPlayerName: turn?.name || null,
    fields: Array.from({ length: 36 }, (_, i) => { const r = state.reveals.find(x => x.field === i + 1); return r ? { ...r, revealed: true } : { field: i + 1, revealed: false }; }),
    history, viewer: { isGm, participant, canJoin: !isGm && !participant && state.phase === 'LOBBY' && state.participants.length < 10,
      canPick: !isGm && turn?.id === viewerId, canStart: isGm && state.phase === 'LOBBY', canCancel: isGm && ['LOBBY', 'PLAYING'].includes(state.phase) } };
}
function normalize(raw) {
  if (!raw || !['LOBBY', 'PLAYING', 'ENDED', 'CANCELLED'].includes(raw.phase) || typeof raw.id !== 'string') return null;
  const deck = raw.inventory;
  const signature = items => items.map(x => `${x.kind}:${x.amount}`).sort().join('|');
  if (!Array.isArray(deck) || deck.length !== 36 || deck.some(x => !x || typeof x.kind !== 'string' || !Number.isFinite(x.amount)) || signature(deck) !== signature(inventory())) return null;
  const participants = Array.isArray(raw.participants) ? raw.participants.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({ id: p.id, name: p.name.slice(0, 80) })) : [];
  if (participants.length > 10 || new Set(participants.map(p => p.id)).size !== participants.length || (raw.phase === 'PLAYING' && participants.length < 2)) return null;
  const reveals = Array.isArray(raw.reveals) ? raw.reveals.map(r => ({ ...r })) : [];
  if (reveals.length > 36 || new Set(reveals.map(r => r.field)).size !== reveals.length || reveals.some(r => !Number.isInteger(r.field) || r.field < 1 || r.field > 36 || r.kind !== deck[r.field - 1].kind || r.amount !== deck[r.field - 1].amount || !participants.some(p => p.id === r.playerId))) return null;
  if (raw.phase === 'PLAYING' && reveals.length === 36) return null;
  const turnOrder = raw.phase === 'CANCELLED' && !raw.startedAt ? participants.map(p => p.id) : Array.isArray(raw.turnOrder) ? raw.turnOrder.slice() : participants.map(p => p.id);
  if (raw.phase !== 'LOBBY' && (turnOrder.length !== participants.length || new Set(turnOrder).size !== participants.length || turnOrder.some(id => !participants.some(p => p.id === id)))) return null;
  const turnIndex = Math.max(0, Math.floor(Number(raw.turnIndex) || 0));
  if (raw.phase === 'PLAYING' && turnIndex >= participants.length) return null;
  return { id: raw.id, phase: raw.phase, createdAt: Number(raw.createdAt) || 0, startedAt: Number(raw.startedAt) || null, endedAt: Number(raw.endedAt) || null,
    participants, inventory: deck.map(x => ({ kind: x.kind, amount: x.amount })), reveals,
    turnIndex, turnOrder, cycle: Math.max(1, Math.floor(Number(raw.cycle) || 1)), tributePlayerId: reveals.find(r => r.kind === 'BLOOD_TRIBUTE')?.playerId || null, tributePactId: raw.tributePactId || null, cancelled: raw.phase === 'CANCELLED' };
}
module.exports = { inventory, create, join, leave, start, current, validatePick, reveal, skip, cancel, summary, view, normalize };
