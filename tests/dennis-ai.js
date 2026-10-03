'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const dennis = require('../dennis-ai');

const zero = () => 0;
const day = '2026-10-03';
const nine = dennis.localMinuteTimestamp(day, 9, 0);

let state = dennis.normalizeState(null, nine - 60_000, zero);
assert.equal(state.dateKey, day);
assert.equal(state.greetingAt, nine);

let result = dennis.tick(state, nine - 1, zero);
assert.equal(result.message, null, 'Dennis must be silent before the daily greeting window');

result = dennis.tick(result.state, nine, zero);
assert.equal(result.message, dennis.MORNING_GREETING, 'the greeting must be first');
assert.equal(result.state.messagesToday, 1);

const restored = dennis.normalizeState(JSON.parse(JSON.stringify(result.state)), nine + 1000, zero);
assert.equal(restored.greetedAt, nine, 'restart must not duplicate the greeting');
assert.equal(dennis.tick(restored, nine + 2000, zero).message, null);

const observed = dennis.observe(restored, 'Dennis, are you there?', nine + 3000, zero);
assert.equal(observed.pendingReply.text, 'Huh?');
assert.ok(observed.pendingReply.dueAt >= nine + 2 * 60_000);
assert.equal(dennis.tick(observed, observed.pendingReply.dueAt - 1, zero).message, null, 'late reply cannot fire early');
assert.equal(dennis.tick(observed, observed.pendingReply.dueAt, zero).message, 'Huh?');

const tomorrowNine = dennis.localMinuteTimestamp('2026-10-04', 9, 0);
const tomorrow = dennis.normalizeState(restored, tomorrowNine - 1, zero);
assert.equal(tomorrow.greetedAt, null, 'new local day must gate all chatter behind a new greeting');
assert.equal(dennis.tick(tomorrow, tomorrowNine - 1, zero).message, null);
assert.equal(dennis.tick(tomorrow, tomorrowNine, zero).message, dennis.MORNING_GREETING);

assert.deepEqual(dennis.RANDOM_MESSAGES, [
  'xD', 'Mmmm gotičarke', 'Ne treba mi nova grafička', 'Huh?',
  'Ja ne mogu ovaj posao više', 'Neka me neko ubije', 'Ja ne mogu ponovo ovu decu',
  'OPET HELLO BEDA AAAAAAAAAAA', 'Vreme je da igram KOTOR opet',
  'Haha ja to nisam gledao, možda bih mogao jednom',
  'Haha ja to nisam igrao, možda bih mogao jednom',
  'Haha ja to nisam probao, možda bih mogao jednom',
  'Trebao bih nešto da promenim u životu', 'Ne mogu ništa da promenim',
  'Mrzim sve', 'Jebem ti dan', 'Dokle ovo sranje', 'Najgori dan ikad',
  'IMA LI OVAJ DAN KRAJA', 'Svi treba da pocrkaju'
]);
assert.ok(!dennis.RANDOM_MESSAGES.some(line => /cigani/i.test(line)));

const profile = dennis.publicProfile();
assert.equal(profile.id, '__DENNIS_AI__');
assert.equal(profile.frameColor, '#000000');
assert.equal(profile.isSynthetic, true);

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(server, /source:\s*'dennisAI'/);
assert.match(server, /boardId:\s*null/);
assert.match(server, /dennisAI\.observe/);
assert.match(server, /dennisAI\.tick/);

console.log('PASS Dennis AI: black synthetic profile, exact authored voice, delayed replies and restart-safe Belgrade greeting gate');
