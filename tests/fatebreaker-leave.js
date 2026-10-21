'use strict';
const assert = require('node:assert/strict');
const game = require('../tombola');
const { createTombolaService } = require('../tombola-server');
const now = 100000;
function round() {
  const r = game.create('leave-test', now);
  for (const id of ['a', 'b', 'c']) game.join(r, { id, name: id }, now);
  game.start(r, ['a', 'b', 'c'], now); r.turnOrder = ['a', 'b', 'c']; return r;
}
for (const currentIndex of [0, 1, 2]) for (const leaveIndex of [0, 1, 2]) {
  const r = round(); r.turnIndex = currentIndex;
  const id = r.turnOrder[leaveIndex], currentId = game.current(r).id;
  const deadline = r.turnEndsAt, turnNumber = r.turnNumber;
  const before = JSON.stringify(r.inventory);
  assert.ok(game.leave(r, id, now + 1000, n => n - 1).ok);
  assert.equal(r.participants.find(p => p.id === id).left, true);
  assert.equal(r.participants.find(p => p.id === id).missedTurns, 0);
  assert.equal(r.turnOrder.includes(id), false);
  assert.equal(r.phase, 'PLAYING');
  assert.equal(JSON.stringify(r.inventory), before, 'leaving never rerolls outcomes');
  if (currentIndex === leaveIndex) {
    assert.equal(r.turnEndsAt, now + 21000);
    assert.equal(r.turnNumber, turnNumber + 1);
    if (leaveIndex < 2) assert.equal(game.current(r).id, ['b', 'c'][leaveIndex]);
  } else {
    assert.equal(game.current(r).id, currentId, 'waiting/previous player leaving never skips current player');
    assert.equal(r.turnEndsAt, deadline, 'waiting player leaving cannot extend current turn');
    assert.equal(r.turnNumber, turnNumber);
  }
  assert.ok(game.leave(r, id, now + 1001).error, 'duplicate leave denied');
  assert.equal(game.view(r, id, false, [], now).viewer.canLeave, false);
  assert.equal(game.view(r, id, false, [], now).viewer.canPick, false);
  assert.ok(game.join(r, { id, name: id }, now).error, 'no rejoining an active round');
  const restored = game.normalize(JSON.parse(JSON.stringify(r)));
  assert.ok(restored); assert.deepEqual(restored.turnOrder, r.turnOrder);
  assert.equal(restored.participants.find(p => p.id === id).left, true);
  // Cross a full cycle; departed players never return in a shuffle.
  for (let i = 0; i < 4; i++) {
    const field = r.inventory.findIndex((f, index) => f.kind !== 'BLOOD_TRIBUTE' && !r.reveals.some(x => x.field === index + 1)) + 1;
    assert.notEqual(game.current(r).id, id);
    assert.ok(game.reveal(r, game.current(r).id, field, 0, now + 1002 + i, n => n - 1).ok);
    assert.equal(r.turnOrder.includes(id), false);
  }
}
const history = round(), field = history.inventory.findIndex(f => f.kind !== 'BLOOD_TRIBUTE') + 1;
game.reveal(history, 'a', field, 2, now + 1);
assert.ok(game.leave(history, 'a', now + 2).ok);
assert.equal(game.normalize(history).reveals[0].playerId, 'a', 'departed player rewards/reveal history survive restart');
assert.ok(game.leave(history, 'b', now + 3).ok);
assert.equal(game.current(history).id, 'c', 'last remaining player can continue');
assert.ok(game.leave(history, 'c', now + 4).ok);
assert.equal(history.phase, 'CANCELLED'); assert.equal(history.endReason, 'NO_PLAYERS_REMAIN');
assert.equal(history.turnEndsAt, null); assert.ok(game.normalize(history));
// Verify the real authenticated service publishes the departure and does not touch the wallet.
const realNow = Date.now; Date.now = () => now + 1000;
try {
  const player = { playerId: 'a', readyState: 1 }, outsider = { playerId: 'outsider', readyState: 1 };
  const room = { revision: 0, tombola: round(), players: new Map([[player, { id: 'a', name: 'Alpha' }], [outsider, { id: 'outsider', name: 'Outsider' }]]) };
  const frames = [], notices = []; let writes = 0;
  const service = createTombolaService({ roomOf: () => room, persist: () => writes++, sendToWs: (ws, frame) => frames.push({ ws, frame }),
    blackMarket: { normalizeState: s => s, playerView: () => ({ pacts: [] }) }, playerStore: { deductShadowCoins() { throw Error('voluntary departure must not charge'); } },
    addDennisMessage: (_room, message) => notices.push(message), broadcastChatUpdate() {}, broadcastPlayersUpdate() {} });
  service.handle(outsider, { type: 'tombola:leave', roundId: room.tombola.id }); assert.equal(writes, 0);
  service.handle(player, { type: 'tombola:leave', roundId: room.tombola.id });
  assert.equal(writes, 1); assert.match(notices[0], /LEFT FATEBREAKER/);
  const published = frames.filter(x => x.ws === player && x.frame.type === 'tombola:state').at(-1).frame.state;
  assert.equal(published.viewer.participant, false); assert.equal(published.viewer.canLeave, false);
  assert.equal(published.currentPlayerId, 'b'); assert.equal(published.turnEndsAt, now + 21000);
  service.handle(player, { type: 'tombola:pick', roundId: room.tombola.id, field: 1 });
  assert.equal(frames.at(-1).frame.type, 'tombola:error');
} finally { Date.now = realNow; }
console.log('PASS FATEBREAKER voluntary leave: current/waiting/previous positions, preserved clocks and history, shuffled-cycle exclusion, no charge/rejoin, authenticated publication, last-player continuation and empty-round closure');
