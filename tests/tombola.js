'use strict';
const assert = require('assert/strict');
const game = require('../tombola');
for (let size = 2; size <= 10; size++) {
  const r = game.create('round-' + size);
  assert.equal(r.inventory.filter(f => f.kind === 'GRAIL' && f.amount === 50).length, 1);
  assert.equal(r.inventory.filter(f => f.kind === 'BLESSING').length, 17);
  assert.ok(!r.inventory.some(f => f.kind === 'BLESSING' && f.amount === 10));
  assert.equal(r.inventory.filter(f => ['BLESSING', 'GRAIL'].includes(f.kind)).reduce((sum, f) => sum + f.amount, 0), 88);
  assert.deepEqual(r.inventory.map(x => `${x.kind}:${x.amount}`).sort(), game.inventory().map(x => `${x.kind}:${x.amount}`).sort());
  for (let i = 0; i < size; i++) assert.ok(game.join(r, { id: String(i), name: 'Hero ' + i }).ok);
  if (size === 10) assert.ok(game.join(r, { id: 'overflow', name: 'Overflow' }).error);
  let shuffles = 0;
  assert.ok(game.start(r, r.participants.map(p => p.id), 1, n => { shuffles++; return 0; }).ok);
  assert.equal(shuffles, size - 1);
  assert.notDeepEqual(r.turnOrder, r.participants.map(p => p.id));
  assert.ok(game.join(r, { id: 'late', name: 'Late' }).error);
  assert.ok(game.skip(r).error);
  const blood = r.inventory.findIndex(x => x.kind === 'BLOOD_TRIBUTE') + 1;
  const fields = [blood, ...Array.from({ length: 36 }, (_, i) => i + 1).filter(n => n !== blood)];
  let cyclePlayers = [];
  for (const [index, field] of fields.entries()) {
    const player = game.current(r);
    assert.ok(game.validatePick(r, 'outsider', field, r.id).error);
    assert.ok(game.validatePick(r, player.id, field, 'stale').error);
    assert.ok(game.validatePick(r, player.id, String(field), r.id).error);
    cyclePlayers.push(player.id);
    assert.ok(game.reveal(r, player.id, field, 0, index + 2, n => { shuffles++; return n - 1; }).ok);
    if (!index) { assert.equal(r.phase, 'PLAYING'); assert.equal(r.tributePlayerId, player.id); }
    if ((index + 1) % size === 0) { assert.equal(new Set(cyclePlayers).size, size); cyclePlayers = []; }
    assert.equal(r.phase, index === 35 ? 'ENDED' : 'PLAYING');
    assert.ok(game.validatePick(r, game.current(r)?.id, field, r.id).error);
    const view = game.view(r, player.id);
    assert.ok(!('inventory' in view));
    assert.ok(view.fields.every(f => f.revealed || (!('kind' in f) && !('amount' in f))));
    assert.deepEqual(game.view(game.normalize(JSON.parse(JSON.stringify(r))), player.id), view);
  }
  assert.equal(shuffles, (size - 1) * (1 + Math.floor(35 / size)), 'reshuffle exactly once per new cycle');
  assert.equal(r.reveals.length, 36);
  assert.equal(game.current(r), null);
  assert.equal(game.normalize({ ...r, phase: 'PLAYING' }), null);
}
const cancelledLobby = game.create('cancelled-lobby');
game.join(cancelledLobby, { id: 'a', name: 'Alpha' });
game.cancel(cancelledLobby);
assert.equal(game.normalize(cancelledLobby).phase, 'CANCELLED');
const signup = game.create('signup', 1000);
assert.equal(signup.signupEndsAt, 121000);
assert.ok(game.join(signup, { id: 'a', name: 'Alpha' }, 1000).ok);
assert.ok(game.join(signup, { id: 'b', name: 'Beta' }, 120999).ok);
assert.ok(game.view(signup, 'late', false, [], 120999).viewer.canJoin);
assert.ok(game.join(signup, { id: 'late', name: 'Late' }, 121000).error);
assert.ok(!game.view(signup, 'late', false, [], 121000).viewer.canJoin);
assert.ok(game.leave(signup, 'a', 121000).error);
const recoveredSignup = game.normalize(JSON.parse(JSON.stringify(signup)));
assert.equal(recoveredSignup.signupEndsAt, 121000, 'recovery never restarts signup clock');
assert.ok(game.join(recoveredSignup, { id: 'late', name: 'Late' }, 121001).error);
assert.ok(game.start(recoveredSignup, ['a', 'b'], 122000).ok, 'GM can start after signup closes');
// Exercise the real service with a controlled server clock, not a two-minute sleep.
const { createTombolaService } = require('../tombola-server');
const realNow = Date.now;
let now = 5000;
try {
  Date.now = () => now;
  const gm = { gmAuthenticated: true }, player = { playerId: 'p', readyState: 1 }, late = { playerId: 'late', readyState: 1 };
  const room = { hostConnection: gm, revision: 0, players: new Map([[player, { id: 'p', name: 'Player' }], [late, { id: 'late', name: 'Late' }]]) };
  const frames = [];
  const service = createTombolaService({ roomOf: () => room, sendToWs: (ws, frame) => frames.push({ ws, frame }), persist() {}, blackMarket: { normalizeState: state => state, playerView: () => ({ pacts: [] }) } });
  service.handle(gm, { type: 'tombola:create' });
  assert.equal(room.tombola.signupEndsAt, 125000);
  now = 124999;
  service.handle(player, { type: 'tombola:join', roundId: room.tombola.id });
  assert.equal(room.tombola.participants.length, 1);
  now = 125000;
  service.handle(late, { type: 'tombola:join', roundId: room.tombola.id, now: 1, signupEndsAt: 9999999 });
  assert.equal(room.tombola.participants.length, 1, 'forged client time cannot reopen signup');
  assert.equal(frames.at(-1).frame.type, 'tombola:error');
  service.handle(late, { type: 'tombola:sync' });
  assert.equal(frames.at(-1).frame.state.viewer.canJoin, false);
} finally { Date.now = realNow; }
console.log('PASS Tombola: exact deck, max10, two-minute server signup boundary/recovery, randomized cycles/one move each, all36 completion, deferred tribute, stale/duplicate validation');
