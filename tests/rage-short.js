'use strict';
const assert = require('node:assert/strict');
const R = require('../rage');
function game(count = 2, gameMode = 'SHORT') {
  const ids = ['a', 'b', 'c', 'd'].slice(0, count);
  const s = R.createLobby({ id: 'a', name: 'Alpha' }, { gameMode }, 100);
  for (const id of ids.slice(1)) R.join(s, { id, name: id });
  ids.forEach((id, i) => R.pickColor(s, id, R.COLORS[i]));
  assert.ok(R.start(s, 'a', new Set(ids), 100).ok); R.begin(s, 100); return s;
}
for (const count of [2, 3, 4]) {
  const s = game(count);
  assert.equal(s.gameMode, 'SHORT');
  for (const player of Object.values(s.players)) assert.deepEqual(player.pieces, [-1, -1]);
  assert.equal(R.view(s, 'a').piecesToWin, 2);
  assert.equal(R.view(R.resumeAfterRestart(R.normalizeState(JSON.parse(JSON.stringify(s))), 200), 'a').gameMode, 'SHORT');
}
let s = game();
R.roll(s, 'a', s.turnSeq, 100, () => 6);
assert.equal(s.options.length, 2, 'only two pieces can leave yard');
assert.equal(R.move(s, 'a', 2, s.turnSeq, 100).ok, false, 'third piece cannot be moved');
assert.ok(R.move(s, 'a', 0, s.turnSeq, 100).ok);
s = game(); s.players.a.pieces = [41, 39];
R.roll(s, 'a', s.turnSeq, 100, () => 1);
const win = R.move(s, 'a', 1, s.turnSeq, 100);
assert.ok(win.ok); assert.equal(s.winnerId, 'a'); assert.equal(s.phase, 'ended');
assert.match(win.announce.join(' '), /ALL TWO HOME/);
s = game(); s.players.a.pieces = [39, -1];
R.roll(s, 'a', s.turnSeq, 100, () => 1); R.move(s, 'a', 0, s.turnSeq, 100);
assert.notEqual(s.phase, 'ended', 'one of two home does not win');
s = game(); s.players.a.pieces = [40, 41];
assert.deepEqual(R.legalMoves(s, 1), [], 'home cannot overlap or enter inactive third home slot');
assert.deepEqual(R.legalMoves(s, 2), [], 'short lane ends at 41, requires exact roll');
s = game(); s.players.a.pieces = [0, 5]; s.players.b.pieces = [28, -1];
R.roll(s, 'a', s.turnSeq, 100, () => 3);
assert.deepEqual(s.options.map(m => m.piece), [1], 'mandatory capture preserved with two pieces');
assert.ok(R.move(s, 'a', 1, s.turnSeq, 100).ok); assert.equal(s.players.b.pieces[0], -1);
const standard = game(2, 'STANDARD');
assert.equal(standard.players.a.pieces.length, 4); assert.equal(R.view(standard, 'a').piecesToWin, 4);
delete standard.gameMode;
assert.equal(R.normalizeState(standard).gameMode, 'STANDARD', 'old saved games stay standard');
// Deterministic complete games exercise turn progression/capture/home occupancy.
for (const count of [2, 3, 4]) {
  s = game(count); let seed = 47, steps = 0;
  const die = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 1 + seed % 6; };
  while (s.phase !== 'ended' && steps++ < 20000) {
    const id = s.order[s.turnIndex];
    if (s.phase === 'roll') assert.ok(R.roll(s, id, s.turnSeq, 100, die).ok);
    else assert.ok(R.move(s, id, s.options[0].piece, s.turnSeq, 100).ok);
  }
  assert.equal(s.phase, 'ended');
  assert.equal(s.players[s.winnerId].pieces.length, 2);
  assert.ok(s.players[s.winnerId].pieces.every(p => p >= 40 && p <= 41));
}
console.log('PASS RAGE Short: 2–4 players, exactly two pieces/home slots, exact-roll/two-home victory, mandatory capture, restart/default compatibility, complete simulated games');
