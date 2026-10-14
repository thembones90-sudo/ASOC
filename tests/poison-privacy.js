'use strict';
const assert = require('assert');
const { poisonView } = require('../poison-privacy');
const state = { type: 'state:public', poison: { victim: { status: 'bleeding' }, other: { status: 'awaiting_roll' } } };
assert.deepEqual(poisonView(state, 'victim', false).poison, { victim: { status: 'bleeding' } });
assert.deepEqual(poisonView(state, 'bystander', false).poison, {});
assert.equal(poisonView(state, null, true), state);
for (const type of ['poison:applied', 'poison:failed', 'poison:cured', 'poison:tick', 'poison:tributeRejected']) {
  const event = { type, playerId: 'victim' };
  assert.equal(poisonView(event, 'bystander', false), null);
  assert.equal(poisonView(event, 'victim', false), event);
  assert.equal(poisonView(event, null, true), event);
}
console.log('PASS poison privacy: only affected player and GM receive poison details');
