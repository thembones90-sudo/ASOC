'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createService, VARIANTS, MODELS, COOLDOWN_MS } = require('../beer-offers');

const expectedArt = [
  'bottle-voidwarden', 'bottle-reliquary', 'bottle-bloodcrown',
  'can-iron-ration', 'can-void-coil', 'can-royal-stout',
  'barrel-oathwood', 'barrel-iron-keg', 'barrel-plague-cask'
];
assert.deepEqual(Object.values(MODELS).flat(), expectedArt, 'nine beer identities remain mapped');
for (const model of expectedArt) {
  const file = require('node:path').join(__dirname, '..', 'assets', 'ui', 'beer', model + '.png');
  assert.ok(fs.existsSync(file), 'missing beer PNG: ' + model);
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', model + ' PNG signature');
  assert.equal(bytes.readUInt32BE(16), 1024, model + ' width');
  assert.equal(bytes.readUInt32BE(20), 1024, model + ' height');
  assert.equal(bytes[25], 6, model + ' RGBA');
}

const events = [];
let time = 0, choice = 0;
const beerOffers = createService({ broadcast: (room, event) => events.push({ room, event }), now: () => time, randomInt: max => { assert.equal(max, 3); return choice; }, randomUUID: () => `beer-${events.length}` });
const room = { roomMode: 'CASUAL' }, author = { id: 'hero', name: 'Hero' };
for (const [i, variant] of VARIANTS.entries()) {
  choice = i;
  assert.equal(beerOffers.offer(room, author, '/beer').success, true);
  assert.equal(events.at(-1).event.variant, variant);
  assert.equal(events.at(-1).event.model, MODELS[variant][i]);
  assert.equal(events.at(-1).event.offeredBy.id, 'hero');
  assert.equal(events.at(-1).event.durationMs, 5200);
  assert.equal(beerOffers.offer(room, author, '/beer').success, false);
  time += COOLDOWN_MS;
}
assert.equal(beerOffers.offer(room, author, '/beer @Hero').success, false);
for (const roomMode of ['BATTLE', 'BATTLE_ARMED', 'RECOUNT']) assert.equal(beerOffers.offer({ roomMode }, author, '/beer').success, false);
assert.equal(beerOffers.offer({ roomMode: 'CASUAL' }, { name: 'GM' }, '/BEER').success, true);
assert.equal(events.at(-1).event.offeredBy.id, '__GM__');
assert.equal(beerOffers.offer(room, author, '/beer').private, true, 'visual skips player persistence path');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const sandbox = { beerOffers, brokerDisplayName: () => 'GM' };
vm.createContext(sandbox);
// Exercise the actual dispatch entry points; /beer is deliberately the first
// recognized verb, so no unrelated handlers or market entitlement are needed.
for (const [name, args] of [['dispatchPlayerSlashCommand', [room, { playerId: 'hero', playerName: 'Hero' }, '/beer', {}]], ['dispatchGmSlashCommand', [room, {}, '/beer']]]) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInContext(source.slice(start, end), sandbox);
  time += COOLDOWN_MS;
  assert.equal(sandbox[name](...args).success, true, `${name} handles free beer`);
}
assert.equal(room.messages, undefined, 'no fabricated chat history');
console.log('PASS beer service: all three server-selected variants, free GM/player dispatch, room cooldown, validation, mode gates, ephemeral no-write path');
