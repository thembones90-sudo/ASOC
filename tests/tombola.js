'use strict';
const assert = require('assert/strict');
const game = require('../tombola');
for (let size = 2; size <= 10; size++) {
  const r = game.create('round-' + size);
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
console.log('PASS Tombola: exact concealed deck, max10, locked signup, randomized cycles/one move each, all36 before ending, Blood Tribute recovery, stale/duplicate validation');
