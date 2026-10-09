'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const market = require('../black-market');

const state = market.normalizeState(null);
const created = market.createPetition(state, { id:'hero-1', name:'Hero' }, {
  title:'A custom skill', category:'CUSTOM', request:'Give me something strange.', paymentKind:'HEART_OF_SHADOW'
});
assert.equal(created.pact.paymentKind, 'HEART_OF_SHADOW');
assert.equal(created.pact.state, 'SUBMITTED');
assert.equal(created.pact.heartSpentAt, null);
assert.equal(market.playerView(state, 'hero-1').pacts[0].paymentKind, 'HEART_OF_SHADOW');

const accepted = market.gmDecision(state, { pactId:created.pact.id, action:'heart-accept', terms:'One custom skill.' });
assert.equal(accepted.pact.state, 'OWED');
assert.equal(accepted.pact.tributeRequired, false);
assert.ok(accepted.pact.heartSpentAt > 0);
assert.match(market.gmDecision(state, { pactId:created.pact.id, action:'heart-accept' }).error, /NOT FOUND/);

const ordinary = market.createPetition(state, { id:'hero-2', name:'Other' }, { title:'Normal', request:'No heart.' });
assert.equal(ordinary.pact.paymentKind, 'NONE');
assert.match(market.gmDecision(state, { pactId:ordinary.pact.id, action:'heart-accept' }).error, /NOT FOUND/);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-heart-market-'));
process.env.ASOC_DATA_DIR = dataDir;
try {
  const store = require('../player-store');
  const identity = { id:'heart-owner', name:'Heart Owner' };
  assert.equal(store.applyDragonRaidResults([{ identity, heart:1, coins:0, stats:{} }], 'heart-test-award').ok, true);
  const first = store.spendHeartOfShadow(identity, 'black-market-heart:test-pact');
  assert.equal(first.ok, true);
  assert.equal(first.balance, 0);
  assert.equal(store.spendHeartOfShadow(identity, 'black-market-heart:test-pact').duplicate, true, 'retry cannot consume another Heart');
  assert.equal(store.spendHeartOfShadow(identity, 'black-market-heart:other-pact').ok, false, 'an empty balance cannot be spent');
} finally {
  fs.rmSync(dataDir, { recursive:true, force:true });
  delete process.env.ASOC_DATA_DIR;
}

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(server, /spendHeartOfShadow[\s\S]*black-market-heart:/, 'GM acceptance spends through the persistent Heart API');
assert.match(server, /YOU POSSESS NO HEART OF THE SHADOW/, 'server rejects unfunded Heart petitions');

const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'black-market.js'), 'utf8');
assert.match(client, /OFFER 1 HEART/);
assert.match(client, /CLAIM HEART \/\/ ACCEPT FAVOR/);
assert.match(client, /paymentKind:'HEART_OF_SHADOW'/);

console.log('heart-black-market: GM-only acceptance, dedicated Heart contract, and no-submit-spend checks passed');
