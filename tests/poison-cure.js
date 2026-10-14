'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf("  if (/^\\/cure\\b/i.test(raw))");
const block = source.slice(start, source.indexOf("  if (/^\\/poison\\b/i.test(raw))", start));
const cureStart = source.indexOf('function poisonCure(');
const cure = source.slice(cureStart, source.indexOf('\nfunction poisonTick(', cureStart));
const events = [];
const context = {
  ensurePoisonState: room => room.poison,
  poisonBroadcastState: (room, event) => events.push(event),
  resolveFatalityTarget: (room, name) => name === 'Tami' ? { target: { id: 'victim', name } } : { error: 'FATALITY TARGET NOT FOUND' },
  brokerDisplayName: () => 'SHADOW BROKER',
  addShadowBrokerMessage: (room, text) => ({ success: true, message: { text } })
};
const run = vm.runInNewContext(cure + '; (function(room, raw) {' + block + '})', context);
const room = { poison: { victim: { playerId: 'victim', playerName: 'Tami', totalLost: 0.3 } } };
assert.equal(run(room, '/cure @Tami').success, true);
assert.equal(room.poison.victim, undefined, 'manual cure removes the bleeding state');
assert.equal(events[0].reason, 'gm_release');
assert.ok(run(room, '/cure @Tami').error, 'already cured player gets a clear refusal');
assert.ok(run(room, '/cure').error, 'a target is required');
assert.ok(run(room, '/cure @Missing').error, 'unknown player is refused');
console.log('PASS /cure: targeted poison removal, event, and invalid targets');
