'use strict';
const assert = require('node:assert/strict');
const bm = require('../black-market');
const state = bm.normalizeState({ byPlayer: { hero: { tributeLevel: 1, pacts: [{ id: 'pact-tombola-old', playerId: 'hero', playerName: 'Hero', state: 'TRIBUTE_REJECTED', tributeRequired: true, tributeLevel: 1, rejectionReason: 'Replace it' }] } } });
assert.equal(state.byPlayer.hero.pacts[0].tributeLevel, 10, 'existing game-loss debts migrate to 10');
assert.equal(bm.playerView(state, 'hero').tributeLevel, 10, 'account-level display migrates too');
assert.equal(state.byPlayer.hero.pacts[0].state, 'TRIBUTE_REJECTED', 'migration never forgives or approves debt');
const manual = bm.createGmTributeDebt(state, { id: 'manual', name: 'Manual' }, { reason: 'GM discretion', tributeLevel: 3 }).pact;
assert.equal(manual.tributeLevel, 3, 'non-game GM demands retain selected level');
const loss = bm.createGmTributeDebt(state, { id: 'loser', name: 'Loser' }, { reason: 'Any game loss', tributeSource: 'GAME_LOSS', tributeLevel: 1 }).pact;
assert.equal(loss.tributeLevel, 10, 'all GAME_LOSS sources override lower requested levels');
for (let attempt = 1; attempt <= 3; attempt++) {
  assert.ok(bm.submitTribute(state, 'loser', loss.id, 'data:image/png;base64,test', true).pact);
  assert.ok(bm.judgeTribute(state, loss.id, false, 'Replacement required', null).pact);
  assert.equal(loss.tributeAttempt, attempt, 'only GM rejection advances replacement allowance');
  assert.equal(loss.tributeLevel, 10);
  bm.markTributeSeen(state, 'loser', loss.id);
  assert.equal(loss.tributeAttempt, attempt, 'player acknowledgments cannot reset the upload quota');
}
assert.equal(bm.normalizeState(state).byPlayer.loser.pacts[0].tributeAttempt, 3, 'replacement generation persists across restart');
console.log('PASS game-loss tribute: universal 10/10 policy, existing-debt migration, manual GM levels preserved, rejection retries persist and cannot be forged by player acknowledgment');
