'use strict';
const assert = require('node:assert/strict');
const game = require('../tombola');
const { createTombolaService } = require('../tombola-server');
const realNow = Date.now;
let now = 100000;
Date.now = () => now;
try {
  const gm = { gmAuthenticated: true, readyState: 1 };
  const sockets = ['a', 'b', 'c'].map(id => ({ playerId: id, readyState: 1 }));
  const room = { revision: 0, hostConnection: gm, players: new Map(sockets.map(s => [s, { id: s.playerId, name: s.playerId }])) };
  const balances = new Map([['a', 5], ['b', 5], ['c', 5]]), receipts = new Map(), frames = [], announcements = [];
  let writes = 0;
  const service = createTombolaService({ roomOf: () => room, sendToWs: (ws, frame) => frames.push({ ws, frame }), persist: () => writes++,
    blackMarket: { normalizeState: state => state, playerView: () => ({ pacts: [] }) },
    broadcastChatUpdate() {}, broadcastPlayersUpdate() {}, addDennisMessage: (_room, text) => announcements.push(text),
    playerStore: { deductShadowCoins(player, amount, receipt) {
      if (receipts.has(receipt)) return receipts.get(receipt);
      const deducted = Math.min(balances.get(player.id), amount); balances.set(player.id, balances.get(player.id) - deducted);
      const paid = { ok: true, deducted }; receipts.set(receipt, paid); return paid;
    } }
  });
  service.handle(gm, { type: 'tombola:activate' });
  for (const socket of sockets) service.handle(socket, { type: 'tombola:join', roundId: room.tombola.id });
  service.handle(gm, { type: 'tombola:start', roundId: room.tombola.id });
  assert.equal(room.tombola.turnEndsAt, now + 20000);
  const player = game.current(room.tombola), deadline = room.tombola.turnEndsAt;
  const id = room.tombola.id, turn = room.tombola.turnNumber;
  now = deadline - 1; const before = writes;
  assert.equal(service.tick(room), false); assert.equal(writes, before, 'idle clock never writes');
  now = deadline;
  assert.ok(game.validatePick(room.tombola, player.id, 1, id).error, 'deadline is exclusive');
  service.handle(sockets.find(s => s.playerId === player.id), { type: 'tombola:pick', roundId: id, field: 1, now: 0 });
  assert.equal(room.tombola.reveals.length, 0, 'late packet cannot reveal a tile');
  assert.equal(balances.get(player.id), 4); assert.equal(player.missedTurns, 1); assert.equal(player.kicked, false);
  assert.equal(room.tombola.turnNumber, turn + 1); assert.notEqual(game.current(room.tombola).id, player.id);
  assert.equal(receipts.size, 1);
  const staleSocket = sockets.find(s => s.playerId === game.current(room.tombola).id);
  service.handle(staleSocket, { type: 'tombola:pick', roundId: id, field: 1, turnNumber: turn });
  assert.equal(room.tombola.reveals.length, 0, 'stale turn token cannot open a tile on a later turn');
  assert.match(frames.at(-1).frame.error, /ALREADY PASSED/);
  service.tick(room); service.tick(room); assert.equal(receipts.size, 1, 'duplicate callbacks do not charge twice');
  const saved = JSON.parse(JSON.stringify(room.tombola));
  room.tombola = game.normalize(saved);
  assert.equal(room.tombola.turnEndsAt, saved.turnEndsAt, 'restart preserves deadline');
  assert.equal(room.tombola.participants.find(p => p.id === player.id).missedTurns, 1, 'restart preserves misses');
  now += 123; service.handle(sockets[0], { type: 'tombola:sync' });
  assert.equal(room.tombola.turnEndsAt, saved.turnEndsAt, 'refresh does not reset clock');
  // Misses need not be consecutive: a successful turn does not erase one.
  const round = room.tombola;
  while (game.current(round).id !== player.id) {
    const field = round.inventory.findIndex((o, i) => o.kind !== 'BLOOD_TRIBUTE' && !round.reveals.some(r => r.field === i + 1)) + 1;
    assert.ok(game.reveal(round, game.current(round).id, field, 0, now).ok);
  }
  const field = round.inventory.findIndex((o, i) => o.kind !== 'BLOOD_TRIBUTE' && !round.reveals.some(r => r.field === i + 1)) + 1;
  assert.ok(game.reveal(round, player.id, field, 0, now).ok);
  assert.equal(round.participants.find(p => p.id === player.id).missedTurns, 1);
  let guard = 0;
  while (!round.participants.find(p => p.id === player.id).kicked && guard++ < 10) { now = round.turnEndsAt; service.tick(room); }
  assert.equal(round.participants.find(p => p.id === player.id).kicked, true);
  assert.equal(balances.get(player.id), 3, 'each of two misses costs one coin');
  assert.equal(round.turnOrder.includes(player.id), false);
  assert.ok(game.normalize(JSON.parse(JSON.stringify(round))), 'removed players and their earlier reveals survive recovery');
  while (round.phase === 'PLAYING' && guard++ < 20) { now = round.turnEndsAt; service.tick(room); }
  assert.equal(round.phase, 'CANCELLED'); assert.equal(round.endReason, 'ALL_PLAYERS_REMOVED');
  assert.equal(game.current(round), null); assert.equal(round.turnEndsAt, null);
  assert.ok(game.normalize(round), 'all-removed ending survives recovery');
  assert.equal(receipts.size, 6); assert.equal(announcements.filter(t => /REMOVED FROM/.test(t)).length, 3);
  const terminalWrites = writes; now += 999999; service.tick(room); assert.equal(writes, terminalWrites);
  // Removing the first/middle/last position never skips the following player.
  for (const index of [0, 1, 2]) {
    const r = game.create('position-' + index, now);
    for (const id of ['x', 'y', 'z']) game.join(r, { id, name: id }, now);
    game.start(r, ['x', 'y', 'z'], now); r.turnOrder = ['x', 'y', 'z']; r.turnIndex = index;
    game.current(r).missedTurns = 1;
    assert.ok(game.expire(r, -1, r.turnEndsAt, n => n - 1).ok);
    assert.equal(r.turnOrder.includes(['x', 'y', 'z'][index]), false);
    if (index < 2) assert.equal(game.current(r).id, ['y', 'z'][index]);
    assert.ok(game.normalize(r));
  }
  assert.ok(frames.some(({ frame }) => frame.state?.timeouts?.length), 'timeout/miss state reaches connected clients');
  room.tombola = game.create('empty-wallet', now);
  for (const id of ['a', 'b']) game.join(room.tombola, { id, name: id }, now);
  game.start(room.tombola, ['a', 'b'], now);
  const emptyId = game.current(room.tombola).id; balances.set(emptyId, 0);
  now = room.tombola.turnEndsAt + 1000000;
  service.tick(room);
  assert.equal(balances.get(emptyId), 0, 'existing wallet floor is preserved');
  assert.equal(room.tombola.participants.find(p => p.id === emptyId).missedTurns, 1, 'zero wallet still incurs a missed turn');
  assert.equal(room.tombola.timeouts.length, 1, 'long downtime processes one missed turn, not instant mass removals');
  assert.equal(room.tombola.turnEndsAt, now + 20000, 'next player gets a full 20 seconds after recovery');
  console.log('PASS FATEBREAKER clocks: exact 20s boundary, late packets, 1 SC receipts, duplicate callbacks, cumulative two misses, removal order, restart/refresh, all removed, idle write protection');
} finally { Date.now = realNow; }
