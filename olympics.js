'use strict';

const CHOICES = Object.freeze(['rock', 'paper', 'scissors']);
const THROW_MS = 10_000;
const COUNTDOWN_MS = 3_000;
const REVEAL_MS = 2_400;
const RECONNECT_GRACE_MS = 60_000;

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function cleanId(value) { return String(value || '').slice(0, 64); }
function cleanName(value) { return String(value || 'LITTLE HERO').trim().slice(0, 40) || 'LITTLE HERO'; }
function randomId(prefix = 'oly') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function shuffle(values, random = Math.random) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index--) {
    const pick = Math.floor(Math.max(0, Math.min(.999999999, Number(random()) || 0)) * (index + 1));
    [out[index], out[pick]] = [out[pick], out[index]];
  }
  return out;
}

function createLobby(id = randomId(), now = Date.now(), owner = null) {
  return {
    id: cleanId(id), status: 'lobby', createdAt: now, startedAt: null, completedAt: null,
    ownerId: cleanId(owner?.id), ownerName: owner ? cleanName(owner.name) : '',
    participants: {}, spectatorIds: [], support: {}, rounds: [], currentRound: -1,
    currentMatchId: null, championId: null, runnerUpId: null, paused: false,
    pauseReason: null, pausedRemaining: null, reconnectDeadlines: {}, sequence: 0,
    stats: { matchesPlayed: 0, throws: 0, ties: 0, usage: { rock: 0, paper: 0, scissors: 0 } }
  };
}

function normalizeState(input) {
  if (!input || typeof input !== 'object' || !cleanId(input.id)) return null;
  const state = copy(input);
  state.participants ||= {};
  state.ownerId = cleanId(state.ownerId);
  state.ownerName = state.ownerName ? cleanName(state.ownerName) : '';
  state.spectatorIds = Array.isArray(state.spectatorIds) ? state.spectatorIds.map(cleanId).filter(Boolean) : [];
  state.support ||= {};
  state.rounds = Array.isArray(state.rounds) ? state.rounds : [];
  state.reconnectDeadlines ||= {};
  state.stats ||= { matchesPlayed: 0, throws: 0, ties: 0, usage: { rock: 0, paper: 0, scissors: 0 } };
  state.stats.usage ||= { rock: 0, paper: 0, scissors: 0 };
  return state;
}

function resumeAfterRestart(input, now = Date.now()) {
  const state = normalizeState(input);
  if (!state) return null;
  Object.values(state.participants).forEach(player => { player.connected = false; });
  if (state.status === 'running') {
    const match = currentMatch(state);
    state.paused = true; state.pauseReason = 'restart';
    if (match?.phase === 'selecting') {
      state.pausedRemaining = Math.max(1, Number(match.deadline) - now || THROW_MS);
      match.deadline = null;
    }
  }
  return state;
}

function participant(player, now) {
  return {
    id: cleanId(player.id), name: cleanName(player.name), avatarData: String(player.avatarData || '').slice(0, 2_500_000),
    frameColor: /^#[0-9a-f]{6}$/i.test(player.frameColor || '') ? player.frameColor : '#8f5ac7',
    joinedAt: now, connected: player.connected !== false, eliminated: false,
    stats: { throwsWon: 0, throwsLost: 0, ties: 0, usage: { rock: 0, paper: 0, scissors: 0 } }
  };
}

function join(input, player, now = Date.now()) {
  const state = normalizeState(input);
  const id = cleanId(player?.id);
  if (!state || state.status !== 'lobby') return { ok: false, error: 'REGISTRATION IS CLOSED', state };
  if (!id) return { ok: false, error: 'PLAYER IDENTITY REQUIRED', state };
  if (!state.participants[id]) state.participants[id] = participant(player, now);
  else state.participants[id] = { ...state.participants[id], name: cleanName(player.name), avatarData: String(player.avatarData || state.participants[id].avatarData || ''), connected: true };
  state.spectatorIds = state.spectatorIds.filter(value => value !== id);
  return { ok: true, state };
}

function leave(input, playerId) {
  const state = normalizeState(input);
  const id = cleanId(playerId);
  if (!state || state.status !== 'lobby' || !state.participants[id]) return { ok: false, error: 'NOT REGISTERED', state };
  delete state.participants[id];
  delete state.support[id];
  return { ok: true, state };
}

function winsRequired(count) { return count <= 2 ? 4 : count <= 4 ? 3 : 2; }
function roundLabel(count, index) {
  if (count <= 2) return 'GRAND FINAL';
  if (count <= 4) return 'SEMIFINALS';
  return `ROUND ${index + 1}`;
}

function makeRound(state, ids, random, now) {
  const seeded = shuffle(ids, random);
  const index = state.rounds.length;
  const label = roundLabel(seeded.length, index);
  const required = winsRequired(seeded.length);
  const matches = [];
  for (let slot = 0; slot < seeded.length; slot += 2) {
    const a = seeded[slot], b = seeded[slot + 1] || null;
    matches.push({
      id: `${state.id}-r${index + 1}-m${matches.length + 1}`, roundIndex: index, slot: matches.length,
      playerAId: a, playerBId: b, status: b ? 'pending' : 'bye', requiredWins: required,
      score: { [a]: 0, ...(b ? { [b]: 0 } : {}) }, throwSeq: 0, phase: b ? 'waiting' : 'complete',
      deadline: null, selectionOpensAt: null, selections: {}, lockedAt: {}, reveal: null, history: [], winnerId: b ? null : a,
      loserId: null, startedAt: null, completedAt: b ? null : now
    });
  }
  const round = { index, label, participantIds: seeded, matches, startedAt: now, completedAt: null };
  state.rounds.push(round);
  state.currentRound = index;
  return round;
}

function currentMatch(state) {
  if (!state?.currentMatchId) return null;
  for (const round of state.rounds) {
    const match = round.matches.find(item => item.id === state.currentMatchId);
    if (match) return match;
  }
  return null;
}

function startThrow(state, match, now) {
  match.status = 'active'; match.phase = 'selecting'; match.throwSeq += 1;
  match.selections = {}; match.lockedAt = {}; match.reveal = null;
  match.selectionOpensAt = now + COUNTDOWN_MS;
  match.deadline = match.selectionOpensAt + THROW_MS; match.startedAt ||= now;
  state.pausedRemaining = null;
}

function startNextMatch(state, now, random = Math.random) {
  const round = state.rounds[state.currentRound];
  const pending = round?.matches.find(match => match.status === 'pending');
  if (pending) {
    state.currentMatchId = pending.id;
    startThrow(state, pending, now);
    return { type: 'match-start', matchId: pending.id, final: pending.requiredWins === 4 };
  }
  if (!round) return null;
  round.completedAt ||= now;
  const winners = round.matches.map(match => match.winnerId).filter(Boolean);
  if (winners.length === 1) {
    state.status = 'complete'; state.completedAt = now; state.currentMatchId = null;
    state.championId = winners[0];
    return { type: 'champion', playerId: winners[0] };
  }
  makeRound(state, winners, random, now);
  return startNextMatch(state, now, random);
}

function begin(input, now = Date.now(), random = Math.random) {
  const state = normalizeState(input);
  if (!state || state.status !== 'lobby') return { ok: false, error: 'OLYMPICS LOBBY REQUIRED', state };
  const ids = Object.keys(state.participants);
  if (ids.length < 2) return { ok: false, error: 'AT LEAST 2 OLYMPIANS REQUIRED', state };
  state.status = 'running'; state.startedAt = now;
  makeRound(state, ids, random, now);
  const event = startNextMatch(state, now, random);
  return { ok: true, state, events: [{ type: 'started' }, ...(event ? [event] : [])] };
}

function outcome(a, b) {
  if (a === b) return 0;
  return (a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock') ? 1 : -1;
}
function verb(winner, loser) {
  if (winner === 'rock' && loser === 'scissors') return 'CRUSH';
  if (winner === 'scissors' && loser === 'paper') return 'SEVER';
  return 'ENTOMB';
}

function recordChoice(state, id, choice) {
  state.stats.throws += 1; state.stats.usage[choice] += 1;
  state.participants[id].stats.usage[choice] += 1;
}

function finishThrow(state, match, now, timeout = false) {
  const a = match.playerAId, b = match.playerBId;
  const choiceA = match.selections[a] || null, choiceB = match.selections[b] || null;
  let winnerId = null, loserId = null, result = 'STALEMATE', action = null;
  if (choiceA && !choiceB) { winnerId = a; loserId = b; result = 'TIMEOUT'; }
  else if (!choiceA && choiceB) { winnerId = b; loserId = a; result = 'TIMEOUT'; }
  else if (choiceA && choiceB) {
    const comparison = outcome(choiceA, choiceB);
    if (comparison) {
      winnerId = comparison > 0 ? a : b; loserId = comparison > 0 ? b : a;
      action = verb(match.selections[winnerId], match.selections[loserId]); result = action;
    }
  }
  if (winnerId) {
    match.score[winnerId] += 1;
    state.participants[winnerId].stats.throwsWon += 1;
    state.participants[loserId].stats.throwsLost += 1;
  } else {
    state.stats.ties += 1;
    if (choiceA) state.participants[a].stats.ties += 1;
    if (choiceB) state.participants[b].stats.ties += 1;
  }
  const reveal = { throwSeq: match.throwSeq, choices: { [a]: choiceA, [b]: choiceB }, winnerId, loserId, result, action, timeout, at: now, nextAt: now + REVEAL_MS };
  match.reveal = reveal; match.phase = 'reveal'; match.deadline = null;
  match.history.push(copy(reveal));
  return reveal;
}

function select(input, actorId, request, now = Date.now()) {
  const state = normalizeState(input), id = cleanId(actorId), choice = String(request?.choice || '').toLowerCase();
  const match = currentMatch(state);
  if (!state || state.status !== 'running' || state.paused) return { ok: false, error: 'TOURNAMENT IS NOT ACCEPTING THROWS', state };
  if (!match || match.phase !== 'selecting') return { ok: false, error: 'NO ACTIVE THROW', state };
  if (String(request?.matchId || '') !== match.id || Number(request?.throwSeq) !== match.throwSeq) return { ok: false, error: 'STALE THROW', state };
  if (![match.playerAId, match.playerBId].includes(id)) return { ok: false, error: 'SPECTATORS CANNOT THROW', state };
  if (state.participants[id]?.eliminated) return { ok: false, error: 'ELIMINATED PLAYERS CANNOT THROW', state };
  if (Number(match.selectionOpensAt) > now) return { ok: false, error: 'WAIT FOR THROW', state };
  if (!CHOICES.includes(choice)) return { ok: false, error: 'INVALID HAND', state };
  if (match.selections[id]) return { ok: false, error: 'HAND ALREADY LOCKED', state };
  match.selections[id] = choice; match.lockedAt[id] = now; recordChoice(state, id, choice);
  const both = !!match.selections[match.playerAId] && !!match.selections[match.playerBId];
  const reveal = both ? finishThrow(state, match, now, false) : null;
  return { ok: true, state, reveal };
}

function completeMatch(state, match, now, random) {
  const [a, b] = [match.playerAId, match.playerBId];
  const winnerId = match.score[a] >= match.requiredWins ? a : b;
  const loserId = winnerId === a ? b : a;
  match.status = 'complete'; match.phase = 'complete'; match.winnerId = winnerId; match.loserId = loserId; match.completedAt = now;
  state.stats.matchesPlayed += 1; state.participants[loserId].eliminated = true;
  state.spectatorIds = Array.from(new Set([...state.spectatorIds, loserId]));
  state.runnerUpId = match.requiredWins === 4 ? loserId : state.runnerUpId;
  state.currentMatchId = null;
  const next = startNextMatch(state, now, random);
  return [{ type: 'match-complete', matchId: match.id, winnerId, loserId, score: copy(match.score) }, ...(next ? [next] : [])];
}

function tick(input, now = Date.now(), random = Math.random) {
  const state = normalizeState(input);
  if (!state || state.status !== 'running' || state.paused) return { state, changed: false, events: [] };
  const match = currentMatch(state);
  if (!match) return { state, changed: false, events: [] };
  if (match.phase === 'selecting' && Number(match.deadline) <= now) {
    finishThrow(state, match, now, true);
    return { state, changed: true, events: [{ type: 'throw-reveal', matchId: match.id }] };
  }
  if (match.phase === 'reveal' && Number(match.reveal?.nextAt) <= now) {
    const complete = Object.values(match.score).some(score => score >= match.requiredWins);
    if (complete) return { state, changed: true, events: completeMatch(state, match, now, random) };
    startThrow(state, match, now);
    return { state, changed: true, events: [{ type: 'throw-start', matchId: match.id }] };
  }
  return { state, changed: false, events: [] };
}

function setConnected(input, playerId, connected, now = Date.now()) {
  const state = normalizeState(input), id = cleanId(playerId);
  if (!state?.participants[id]) return { state, changed: false };
  state.participants[id].connected = connected === true;
  const match = currentMatch(state), active = match && [match.playerAId, match.playerBId].includes(id) && match.phase === 'selecting';
  if (!connected) {
    state.reconnectDeadlines[id] = now + RECONNECT_GRACE_MS;
    if (active && !state.paused) {
      state.paused = true; state.pauseReason = 'disconnect';
      state.pausedRemaining = Math.max(0, Number(match.deadline) - now); match.deadline = null;
    }
  } else {
    delete state.reconnectDeadlines[id];
    if (state.paused && state.pauseReason === 'disconnect' && match && [match.playerAId, match.playerBId].every(pid => state.participants[pid]?.connected)) {
      state.paused = false; state.pauseReason = null;
      match.deadline = now + Math.max(1, Number(state.pausedRemaining) || THROW_MS); state.pausedRemaining = null;
    }
  }
  return { state, changed: true };
}

function pause(input, now = Date.now()) {
  const state = normalizeState(input), match = currentMatch(state);
  if (!state || state.status !== 'running' || state.paused) return { ok: false, error: 'TOURNAMENT CANNOT BE PAUSED', state };
  state.paused = true; state.pauseReason = 'gm';
  if (match?.phase === 'selecting') { state.pausedRemaining = Math.max(0, Number(match.deadline) - now); match.deadline = null; }
  return { ok: true, state };
}
function resume(input, now = Date.now()) {
  const state = normalizeState(input), match = currentMatch(state);
  if (!state?.paused) return { ok: false, error: 'TOURNAMENT IS NOT PAUSED', state };
  if (match && [match.playerAId, match.playerBId].some(id => !state.participants[id]?.connected)) return { ok: false, error: 'ACTIVE COMPETITOR IS DISCONNECTED', state };
  state.paused = false; state.pauseReason = null;
  if (match?.phase === 'selecting') match.deadline = now + Math.max(1, Number(state.pausedRemaining) || THROW_MS);
  state.pausedRemaining = null; return { ok: true, state };
}
function restartThrow(input, now = Date.now()) {
  const state = normalizeState(input), match = currentMatch(state);
  if (!match || match.status !== 'active') return { ok: false, error: 'NO ACTIVE MATCH', state };
  state.paused = false; state.pauseReason = null; startThrow(state, match, now); return { ok: true, state };
}
function restartMatch(input, now = Date.now()) {
  const state = normalizeState(input), match = currentMatch(state);
  if (!match || match.status !== 'active') return { ok: false, error: 'NO ACTIVE MATCH', state };
  match.score[match.playerAId] = 0; match.score[match.playerBId] = 0; match.history = [];
  state.paused = false; state.pauseReason = null; startThrow(state, match, now); return { ok: true, state };
}
function forfeit(input, playerId, now = Date.now(), random = Math.random) {
  const state = normalizeState(input), id = cleanId(playerId), match = currentMatch(state);
  if (!match || ![match.playerAId, match.playerBId].includes(id)) return { ok: false, error: 'PLAYER IS NOT IN THE ACTIVE MATCH', state };
  const winnerId = id === match.playerAId ? match.playerBId : match.playerAId;
  match.score[winnerId] = match.requiredWins;
  const events = completeMatch(state, match, now, random);
  return { ok: true, state, events };
}
function support(input, spectatorId, competitorId) {
  const state = normalizeState(input), from = cleanId(spectatorId), to = cleanId(competitorId), match = currentMatch(state);
  if (!state || !['running', 'complete'].includes(state.status)) return { ok: false, error: 'NO ACTIVE OLYMPICS', state };
  if (!from) return { ok: false, error: 'SUPPORTER IDENTITY REQUIRED', state };
  if (!match || ![match.playerAId, match.playerBId].includes(to)) return { ok: false, error: 'COMPETITOR UNAVAILABLE', state };
  if (from === to) return { ok: false, error: 'YOU CANNOT SUPPORT YOURSELF', state };
  state.support[from] = to; return { ok: true, state };
}

function supportCounts(state) {
  const counts = {};
  Object.values(state?.support || {}).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  return counts;
}
function publicMatch(match, viewerId) {
  if (!match) return null;
  const reveal = match.phase === 'reveal' || match.phase === 'complete' ? copy(match.reveal) : null;
  return {
    id: match.id, roundIndex: match.roundIndex, playerAId: match.playerAId, playerBId: match.playerBId,
    status: match.status, phase: match.phase, requiredWins: match.requiredWins, score: copy(match.score),
    throwSeq: match.throwSeq, deadline: match.deadline, selectionOpensAt: match.selectionOpensAt, locked: {
      [match.playerAId]: !!match.selections[match.playerAId], [match.playerBId]: !!match.selections[match.playerBId]
    },
    yourChoice: [match.playerAId, match.playerBId].includes(viewerId) ? (match.selections[viewerId] || null) : null,
    reveal, winnerId: match.winnerId, loserId: match.loserId
  };
}
function view(input, viewerId, isGm = false, now = Date.now()) {
  const state = normalizeState(input);
  if (!state) return null;
  const id = cleanId(viewerId), match = currentMatch(state), counts = supportCounts(state);
  const participants = Object.values(state.participants).map(player => ({
    id: player.id, name: player.name, avatarData: player.avatarData, frameColor: player.frameColor,
    connected: player.connected, eliminated: player.eliminated, supporters: counts[player.id] || 0,
    stats: state.status === 'complete' || player.id === id || isGm ? copy(player.stats) : undefined
  }));
  return {
    id: state.id, status: state.status, createdAt: state.createdAt, startedAt: state.startedAt, completedAt: state.completedAt,
    participants, olympians: participants.length, minimum: 2, spectator: !state.participants[id] || state.participants[id].eliminated,
    joined: !!state.participants[id], ownerId: state.ownerId, ownerName: state.ownerName,
    canManage: isGm || (!!id && id === state.ownerId), paused: state.paused, pauseReason: state.pauseReason,
    rounds: state.rounds.map(round => ({ index: round.index, label: round.label, participantIds: [...round.participantIds], matches: round.matches.map(item => ({
      id: item.id, playerAId: item.playerAId, playerBId: item.playerBId, status: item.status,
      requiredWins: item.requiredWins, score: copy(item.score), winnerId: item.winnerId, loserId: item.loserId
    })) })),
    currentRound: state.currentRound, currentMatch: publicMatch(match, id), support: state.support[id] || null,
    championId: state.championId, runnerUpId: state.runnerUpId, stats: copy(state.stats), serverNow: now,
    reconnectDeadlines: isGm ? copy(state.reconnectDeadlines) : undefined
  };
}

module.exports = {
  CHOICES, THROW_MS, COUNTDOWN_MS, REVEAL_MS, RECONNECT_GRACE_MS, createLobby, normalizeState, resumeAfterRestart, join, leave, begin,
  currentMatch, select, tick, setConnected, pause, resume, restartThrow, restartMatch, forfeit, support,
  view, outcome, winsRequired
};
