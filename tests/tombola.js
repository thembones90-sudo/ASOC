'use strict';
const assert = require('assert/strict');
const game = require('../tombola');
const quantities = { 'BLESSING:2': 4, 'BLESSING:3': 5, 'BLESSING:5': 5, 'BLESSING:8': 3, 'CURSE:2': 3, 'CURSE:4': 4, 'CURSE:6': 5, 'CURSE:10': 4, 'CURSE:15': 1, 'GRAIL:50': 1, 'BLOOD_TRIBUTE:0': 1 };
for (let size = 2; size <= 10; size++) for (const bloodPosition of [0, 17, 35]) {
  const r = game.create('round-' + size + '-' + bloodPosition);
  const tally = r.inventory.reduce((sum, f) => { const k = f.kind + ':' + f.amount; sum[k] = (sum[k] || 0) + 1; return sum; }, {});
  assert.deepEqual(tally, quantities);
  assert.equal(r.inventory.filter(f => f.kind === 'BLESSING').reduce((sum, f) => sum + f.amount, 0), 72);
  assert.equal(r.inventory.filter(f => f.kind === 'CURSE').reduce((sum, f) => sum + f.amount, 0), 107);
  for (let i = 0; i < size; i++) assert.ok(game.join(r, { id: String(i), name: 'Hero ' + i }).ok);
  if (size === 10) assert.ok(game.join(r, { id: 'overflow', name: 'Overflow' }).error);
  let shuffles = 0;
  assert.ok(game.start(r, r.participants.map(p => p.id), 1, n => { shuffles++; return 0; }).ok);
  assert.notDeepEqual(r.turnOrder, r.participants.map(p => p.id));
  assert.ok(game.join(r, { id: 'late', name: 'Late' }).error); assert.ok(game.skip(r).error);
  const blood = r.inventory.findIndex(x => x.kind === 'BLOOD_TRIBUTE') + 1;
  const fields = Array.from({ length: 36 }, (_, i) => i + 1).filter(n => n !== blood); fields.splice(bloodPosition, 0, blood);
  let cyclePlayers = [];
  for (const [index, field] of fields.entries()) {
    const player = game.current(r);
    assert.ok(game.validatePick(r, 'outsider', field, r.id).error);
    assert.ok(game.validatePick(r, player.id, field, 'stale').error);
    assert.ok(game.validatePick(r, player.id, String(field), r.id).error);
    cyclePlayers.push(player.id);
    const outcome = r.inventory[field - 1];
    assert.ok(game.reveal(r, player.id, field, 0, index + 2, n => { shuffles++; return n - 1; }).ok);
    if (outcome.kind === 'GRAIL') assert.equal(r.phase, 'PLAYING');
    if ((index + 1) % size === 0) { assert.equal(new Set(cyclePlayers).size, size); cyclePlayers = []; }
    assert.equal(r.phase, field === blood ? 'ENDED' : 'PLAYING');
    assert.ok(game.validatePick(r, game.current(r)?.id, field, r.id).error);
    const view = game.view(r, player.id);
    assert.ok(!('inventory' in view)); assert.ok(view.fields.every(f => f.revealed || (!('kind' in f) && !('amount' in f))));
    assert.deepEqual(game.view(game.normalize(JSON.parse(JSON.stringify(r))), player.id), view);
    if (field === blood) break;
  }
  assert.equal(shuffles, (size - 1) * (1 + Math.floor(bloodPosition / size)));
  assert.equal(r.reveals.length, bloodPosition + 1);
  assert.equal(game.current(r), null);
  assert.equal(game.normalize({ ...r, phase: 'PLAYING' }).phase, 'ENDED', 'recovery seals blood rounds instead of discarding their history');
  assert.equal(game.normalize({ ...r, reveals: r.reveals.slice(0, -1) }), null, 'V2 cannot end without blood');
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
const legacy = game.create('legacy');
const entries = (kind, pairs) => pairs.flatMap(([amount, count]) => Array.from({ length: count }, () => ({ kind, amount })));
legacy.inventory = [...entries('BLESSING', [[1, 6], [2, 5], [3, 4], [5, 2]]), { kind: 'GRAIL', amount: 50 }, ...entries('CURSE', [[1, 5], [2, 5], [3, 4], [5, 2], [10, 1]]), { kind: 'BLOOD_TRIBUTE', amount: 0 }];
legacy.phase = 'PLAYING'; legacy.startedAt = Date.now(); legacy.participants = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]; legacy.turnOrder = ['a', 'b'];
const savedLegacy = game.normalize(legacy);
assert.equal(savedLegacy.economyVersion, 1);
assert.deepEqual(savedLegacy.inventory, legacy.inventory, 'existing in-progress rewards never reroll');
assert.ok(game.reveal(savedLegacy, 'a', 36, 0).ok);
assert.equal(savedLegacy.phase, 'ENDED', 'Blood Tribute ends legacy rounds immediately too');
assert.equal(savedLegacy.turnEndsAt, null);
assert.ok(game.validatePick(savedLegacy, 'b', 1, savedLegacy.id).error);
assert.ok(game.normalize(savedLegacy));
const recoveredBlood = game.normalize({ ...savedLegacy, phase: 'PLAYING', endOnBlood: false, tributePactId: null });
assert.equal(recoveredBlood.phase, 'ENDED');
assert.equal(recoveredBlood.endOnBlood, true);
assert.equal(recoveredBlood.endReason, 'BLOOD_TRIBUTE');
assert.deepEqual(recoveredBlood.reveals, savedLegacy.reveals, 'legacy recovery preserves already settled outcomes');
assert.equal(recoveredBlood.turnEndsAt, null);
const legacyLobby = game.normalize({ ...legacy, phase: 'LOBBY', startedAt: null });
assert.ok(game.start(legacyLobby, ['a', 'b']).ok);
assert.equal(legacyLobby.economyVersion, 2, 'unstarted legacy lobby upgrades when GM starts');
assert.deepEqual(legacyLobby.inventory.map(f => `${f.kind}:${f.amount}`).sort(), game.inventory().map(f => `${f.kind}:${f.amount}`).sort());
const net = game.inventory().reduce((sum, f) => sum + (f.kind === 'CURSE' ? -f.amount : f.amount), 0);
assert.equal(net, 15); assert.equal(net / 2, 7.5);
// Exercise the real service with a controlled server clock, not a two-minute sleep.
const { createTombolaService } = require('../tombola-server');
{
  const debtor = { playerId: 'a', readyState: 1 }, other = { playerId: 'b', readyState: 1 };
  const room = { tombola: { ...recoveredBlood, id: 'tombola-legacy-recovered', phase: 'PLAYING', endOnBlood: false, turnEndsAt: 1 },
    blackMarket: { pacts: [] }, revision: 0, players: new Map([[debtor, { id: 'a', name: 'Alpha' }], [other, { id: 'b', name: 'Beta' }]]) };
  let saves = 0, demands = 0;
  const service = createTombolaService({ roomOf: () => room, persist: () => saves++, addDennisMessage() {}, broadcastChatUpdate() {}, syncBlackMarket() {},
    sendToWs: (_socket, frame) => { if (frame.type === 'blackMarket:tributeDemanded') demands++; },
    playerStore: { deductShadowCoins() { throw Error('No wallet write after Blood Tribute'); } },
    blackMarket: { normalizeState: value => value, playerView: state => ({ pacts: state.pacts }), findPact: (state, id) => state.pacts.find(p => p.id === id),
      createGmTributeDebt: (state, player) => { const pact = { id: 'temporary', playerId: player.id, state: 'APPROVED_PENDING_TRIBUTE' }; state.pacts.push(pact); return { pact }; } } });
  assert.equal(service.tick(room, 999999), true, 'legacy live rounds seal before an overdue-turn penalty');
  assert.equal(room.tombola.phase, 'ENDED'); assert.equal(room.tombola.turnEndsAt, null);
  assert.equal(room.blackMarket.pacts.length, 1); assert.equal(demands, 1);
  assert.equal(service.tick(room, 999999), false, 'recovery is idempotent');
  assert.equal(room.blackMarket.pacts.length, 1); assert.equal(saves, 1);
  room.tombola = game.normalize({ ...room.tombola, tributePactId: null });
  assert.equal(service.tick(room), true, 'normalized ended rounds recover their missing tribute link');
  assert.equal(room.blackMarket.pacts.length, 1, 'existing tribute is reused, never duplicated');
}
const realNow = Date.now;
let now = 5000;
try {
  Date.now = () => now;
  const gm = { gmAuthenticated: true }, player = { playerId: 'p', readyState: 1 }, late = { playerId: 'late', readyState: 1 };
  const room = { hostConnection: gm, revision: 0, players: new Map([[player, { id: 'p', name: 'Player' }], [late, { id: 'late', name: 'Late' }]]) };
  const frames = [], announcements = [];
  const service = createTombolaService({ roomOf: () => room, sendToWs: (ws, frame) => frames.push({ ws, frame }), persist() {}, addDennisMessage: (_room, text) => announcements.push(text), broadcastChatUpdate() {}, blackMarket: { normalizeState: state => state, playerView: () => ({ pacts: [] }) } });
  service.handle(gm, { type: 'tombola:activate' });
  assert.equal(room.tombola.signupEndsAt, 125000);
  const lobbyId = room.tombola.id;
  now = 6000; service.handle(gm, { type: 'tombola:activate' });
  assert.equal(room.tombola.id, lobbyId); assert.equal(room.tombola.signupEndsAt, 125000);
  assert.equal(announcements.length, 1, 'reopening does not repeat lobby announcement');
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
console.log('PASS FATEBREAKER V2: exact quantities/totals, signup/cap, fair cycles, Grail continues, immediate Blood ending at positions 1/18/36, concealed recovery and V1 save compatibility');
