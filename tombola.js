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
    turnIndex: 0, inventory: shuffle(inventory()), reveals: [], tributePlayerId: null, tributePactId: null, cancelled: false };
}
function join(state, player) {
  if (state.phase !== 'LOBBY') return { error: 'TOMBOLA SIGNUP IS CLOSED' };
  if (state.participants.some(p => p.id === player.id)) return { error: 'YOU ARE ALREADY IN TOMBOLA' };
  state.participants.push({ id: String(player.id), name: String(player.name || 'LITTLE HERO').slice(0, 80) });
  return { ok: true };
}
function leave(state, id) {
  if (state.phase !== 'LOBBY') return { error: 'THE ROUND HAS ALREADY STARTED' };
  state.participants = state.participants.filter(p => p.id !== id); return { ok: true };
}
function start(state, activeIds, now = Date.now()) {
  if (state.phase !== 'LOBBY') return { error: 'THIS ROUND HAS ALREADY STARTED' };
  const roster = state.participants.filter(p => activeIds.includes(p.id));
  if (roster.length < 2) return { error: 'TOMBOLA NEEDS TWO ACTIVE PLAYERS' };
  state.participants = roster;
  state.phase = 'PLAYING'; state.startedAt = now; state.turnIndex = 0; return { ok: true };
}
function current(state) { return state.phase === 'PLAYING' ? state.participants[state.turnIndex % state.participants.length] : null; }
function validatePick(state, playerId, field, roundId) {
  if (!state || state.id !== roundId) return { error: 'THIS TOMBOLA ROUND IS NO LONGER CURRENT' };
  if (state.phase !== 'PLAYING') return { error: 'TOMBOLA IS NOT ACCEPTING SELECTIONS' };
  if (current(state)?.id !== playerId) return { error: 'WAIT FOR YOUR TOMBOLA TURN' };
  if (!Number.isInteger(field) || field < 1 || field > 36) return { error: 'SELECT A FIELD FROM 1 TO 36' };
  if (state.reveals.some(r => r.field === field)) return { error: 'THAT VAULT IS ALREADY OPEN' };
  return { ok: true, outcome: { ...state.inventory[field - 1] } };
}
function reveal(state, playerId, field, actualAmount, now = Date.now()) {
  const checked = validatePick(state, playerId, field, state.id);
  if (!checked.ok) return checked;
  const player = current(state), outcome = checked.outcome;
  state.reveals.push({ field, ...outcome, playerId, playerName: player.name, actualAmount, at: now });
  if (outcome.kind === 'BLOOD_TRIBUTE') { state.phase = 'ENDED'; state.endedAt = now; state.tributePlayerId = playerId; }
  else state.turnIndex = (state.turnIndex + 1) % state.participants.length;
  return { ok: true, reveal: state.reveals.at(-1) };
}
function skip(state) {
  if (state.phase !== 'PLAYING') return { error: 'NO TOMBOLA TURN CAN BE SKIPPED' };
  state.turnIndex = (state.turnIndex + 1) % state.participants.length; return { ok: true };
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
    currentPlayerId: turn?.id || null, currentPlayerName: turn?.name || null,
    fields: Array.from({ length: 36 }, (_, i) => { const r = state.reveals.find(x => x.field === i + 1); return r ? { ...r, revealed: true } : { field: i + 1, revealed: false }; }),
    history, viewer: { isGm, participant, canJoin: !isGm && !participant && state.phase === 'LOBBY',
      canPick: !isGm && turn?.id === viewerId, canStart: isGm && state.phase === 'LOBBY', canCancel: isGm && ['LOBBY', 'PLAYING'].includes(state.phase) } };
}
function normalize(raw) {
  if (!raw || !['LOBBY', 'PLAYING', 'ENDED', 'CANCELLED'].includes(raw.phase) || typeof raw.id !== 'string') return null;
  const deck = raw.inventory;
  const signature = items => items.map(x => `${x.kind}:${x.amount}`).sort().join('|');
  if (!Array.isArray(deck) || deck.length !== 36 || deck.some(x => !x || typeof x.kind !== 'string' || !Number.isFinite(x.amount)) || signature(deck) !== signature(inventory())) return null;
  const participants = Array.isArray(raw.participants) ? raw.participants.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({ id: p.id, name: p.name.slice(0, 80) })) : [];
  if (new Set(participants.map(p => p.id)).size !== participants.length || (raw.phase === 'PLAYING' && participants.length < 2)) return null;
  const reveals = Array.isArray(raw.reveals) ? raw.reveals.map(r => ({ ...r })) : [];
  if (reveals.length > 36 || new Set(reveals.map(r => r.field)).size !== reveals.length || reveals.some(r => !Number.isInteger(r.field) || r.field < 1 || r.field > 36 || r.kind !== deck[r.field - 1].kind || r.amount !== deck[r.field - 1].amount || !participants.some(p => p.id === r.playerId))) return null;
  if (raw.phase === 'PLAYING' && reveals.some(r => r.kind === 'BLOOD_TRIBUTE')) return null;
  return { id: raw.id, phase: raw.phase, createdAt: Number(raw.createdAt) || 0, startedAt: Number(raw.startedAt) || null, endedAt: Number(raw.endedAt) || null,
    participants, inventory: deck.map(x => ({ kind: x.kind, amount: x.amount })), reveals,
    turnIndex: Math.max(0, Math.floor(Number(raw.turnIndex) || 0)), tributePlayerId: raw.tributePlayerId || null, tributePactId: raw.tributePactId || null, cancelled: raw.phase === 'CANCELLED' };
}
module.exports = { inventory, create, join, leave, start, current, validatePick, reveal, skip, cancel, summary, view, normalize };
