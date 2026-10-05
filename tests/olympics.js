'use strict';

const assert = require('assert/strict');
const O = require('../olympics');

const player = index => ({ id: `p${index}`, name: `PLAYER ${index}`, avatarData: `/a${index}.png`, frameColor: '#8844aa', connected: true });
const zero = () => 0;
let now = 1_000_000;

function lobby(count) {
  let state = O.createLobby(`t-${count}`, now);
  for (let index = 1; index <= count; index++) {
    const joined = O.join(state, player(index), now + index);
    assert.equal(joined.ok, true); state = joined.state;
  }
  return state;
}

function winCurrent(state) {
  let match = O.currentMatch(state);
  assert.ok(match?.playerBId, 'a playable match is active');
  const activeMatchId = match.id;
  while (match?.id === activeMatchId && match.status === 'active') {
    const seq = match.throwSeq;
    now = Math.max(now, match.selectionOpensAt);
    let result = O.select(state, match.playerAId, { matchId: match.id, throwSeq: seq, choice: 'rock' }, now += 10);
    assert.equal(result.ok, true); state = result.state;
    result = O.select(state, match.playerBId, { matchId: match.id, throwSeq: seq, choice: 'scissors' }, now += 10);
    assert.equal(result.ok, true); state = result.state;
    const advanced = O.tick(state, now = result.reveal.nextAt, zero);
    state = advanced.state; match = O.currentMatch(state);
  }
  return state;
}

function completeTournament(count) {
  let started = O.begin(lobby(count), now += 100, zero);
  assert.equal(started.ok, true);
  let state = started.state, guard = 0;
  while (state.status !== 'complete' && guard++ < 200) state = winCurrent(state);
  assert.equal(state.status, 'complete', `${count}-player tournament completes`);
  assert.ok(state.championId);
  assert.equal(state.stats.matchesPlayed, count - 1);
  return state;
}

for (const count of [2, 3, 4, 5, 8]) {
  const state = completeTournament(count);
  const allMatches = state.rounds.flatMap(round => round.matches);
  assert.equal(allMatches.filter(match => match.status === 'bye').length >= (count % 2), true);
  assert.equal(state.rounds.at(-1).matches[0].requiredWins, 4, 'Grand Final is first to four');
  if (count >= 3) assert.ok(state.rounds.some(round => round.label === 'SEMIFINALS' && round.matches.some(match => match.requiredWins === 3)));
}

// Pairing order is genuinely driven by the supplied random source.
const ordered = O.begin(lobby(5), now += 100, () => 0).state.rounds[0].participantIds;
const reversedSeed = O.begin(lobby(5), now += 100, () => .999999).state.rounds[0].participantIds;
assert.notDeepEqual(ordered, reversedSeed, 'initial pairings respond to randomized shuffling');

// Standard resolution and every tie pairing.
assert.equal(O.outcome('rock', 'scissors'), 1);
assert.equal(O.outcome('scissors', 'paper'), 1);
assert.equal(O.outcome('paper', 'rock'), 1);
for (const choice of O.CHOICES) assert.equal(O.outcome(choice, choice), 0);

let state = O.begin(lobby(3), now += 100, zero).state;
let match = O.currentMatch(state);
const spectatorId = 'watcher';
assert.equal(O.select(state, match.playerAId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'paper' }, now).error, 'WAIT FOR THROW');
now = Math.max(now, match.selectionOpensAt);
let picked = O.select(state, match.playerAId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'paper' }, now += 1);
assert.equal(picked.ok, true); state = picked.state;
assert.equal(O.view(state, match.playerAId).currentMatch.yourChoice, 'paper');
assert.equal(O.view(state, match.playerBId).currentMatch.yourChoice, null, 'opponent cannot inspect hidden choice');
assert.equal(O.view(state, spectatorId).currentMatch.yourChoice, null, 'spectator cannot inspect hidden choice');
assert.equal(O.view(state, spectatorId).currentMatch.reveal, null, 'spectator receives no pre-reveal payload');

// Submission security.
assert.equal(O.select(state, match.playerAId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'rock' }, now).error, 'HAND ALREADY LOCKED');
assert.equal(O.select(state, spectatorId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'rock' }, now).error, 'SPECTATORS CANNOT THROW');
state.participants[spectatorId] = player(99); state.participants[spectatorId].id = spectatorId; state.participants[spectatorId].eliminated = true;
assert.equal(O.select(state, spectatorId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'rock' }, now).error, 'SPECTATORS CANNOT THROW');
delete state.participants[spectatorId];
assert.equal(O.select(state, match.playerBId, { matchId: 'old', throwSeq: match.throwSeq, choice: 'rock' }, now).error, 'STALE THROW');
assert.equal(O.select(state, match.playerBId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'laser' }, now).error, 'INVALID HAND');

// One-player timeout awards only a throw; both-player timeout awards nothing.
let timed = O.begin(lobby(2), now += 100, zero).state;
match = O.currentMatch(timed);
now = Math.max(now, match.selectionOpensAt);
timed = O.select(timed, match.playerAId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'rock' }, now += 1).state;
let timeout = O.tick(timed, match.deadline, zero);
assert.equal(timeout.state.currentMatchId, match.id);
assert.equal(O.currentMatch(timeout.state).score[match.playerAId], 1);
assert.equal(O.currentMatch(timeout.state).phase, 'reveal');
timed = O.tick(timeout.state, O.currentMatch(timeout.state).reveal.nextAt, zero).state;
match = O.currentMatch(timed);
now = Math.max(now, match.selectionOpensAt);
const before = { ...match.score };
timeout = O.tick(timed, match.deadline, zero);
assert.deepEqual(O.currentMatch(timeout.state).score, before);
timed = O.tick(timeout.state, O.currentMatch(timeout.state).reveal.nextAt, zero).state;
assert.equal(O.currentMatch(timed).phase, 'selecting', 'normal throw follows double timeout');

// Disconnect before/after lock pauses and restores the exact private state.
match = O.currentMatch(timed);
now = Math.max(now, match.selectionOpensAt);
timed = O.select(timed, match.playerAId, { matchId: match.id, throwSeq: match.throwSeq, choice: 'paper' }, now += 1).state;
let disconnected = O.setConnected(timed, match.playerBId, false, now += 1).state;
assert.equal(disconnected.paused, true);
assert.equal(O.currentMatch(disconnected).selections[match.playerAId], 'paper');
assert.equal(O.view(disconnected, match.playerBId).currentMatch.yourChoice, null);
let reconnected = O.setConnected(disconnected, match.playerBId, true, now += 5000).state;
assert.equal(reconnected.paused, false);
assert.ok(O.currentMatch(reconnected).deadline > now);

// GM controls.
let controlled = O.pause(reconnected, now).state;
assert.equal(controlled.paused, true);
controlled = O.resume(controlled, now += 100).state;
assert.equal(controlled.paused, false);
controlled = O.restartThrow(controlled, now += 100).state;
assert.equal(O.currentMatch(controlled).selections[match.playerAId], undefined);
controlled = O.restartMatch(controlled, now += 100).state;
assert.ok(Object.values(O.currentMatch(controlled).score).every(score => score === 0));
const forfeited = O.forfeit(controlled, O.currentMatch(controlled).playerBId, now += 100, zero);
assert.equal(forfeited.ok, true);
assert.ok(forfeited.events.some(event => event.type === 'match-complete'));

// Support is universal and single-valued. Active Olympians, eliminated players,
// spectators and the Shadow Broker may back either current combatant; self-support is forbidden.
state = O.begin(lobby(3), now += 100, zero).state;
match = O.currentMatch(state);
let support = O.support(state, spectatorId, match.playerAId);
assert.equal(support.ok, true); state = support.state;
support = O.support(state, spectatorId, match.playerBId);
assert.equal(support.ok, true);
assert.equal(O.view(support.state, spectatorId).support, match.playerBId);
const activeBacker = O.support(support.state, match.playerAId, match.playerBId);
assert.equal(activeBacker.ok, true, 'an active Olympian can support the opponent');
assert.equal(O.support(activeBacker.state, match.playerAId, match.playerAId).ok, false, 'self-support is forbidden');
const gmBacker = O.support(activeBacker.state, '__GM__', match.playerAId);
assert.equal(gmBacker.ok, true, 'the Shadow Broker can support a combatant');
assert.equal(O.view(gmBacker.state, '__GM__', true).support, match.playerAId);

console.log('PASS Olympics engine: 2/3/4/5/8 brackets, BYEs, best-of stages, private throws, timers, reconnect, controls, support and completion');
