'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const market = require('../shadow-market');
const item = market.COMMAND_ITEMS.get('coffee');
assert(item && item.id === 'cmd-coffee' && item.price === 10 && !item.relic);
assert.strictEqual(market.nextPrice(item, 0), 10);
assert.strictEqual(market.nextPrice(item, 1), null);
const from = source.indexOf('function triggerCoffeeBreak(room) {');
const to = source.indexOf('function dispatchPlayerSlashCommand', from);
assert(from > 0 && to > from);
const broadcasts = [];
let now = 100000;
const context = {
  ROOM_MODES: { CASUAL: 'CASUAL', BATTLE: 'BATTLE', BATTLE_ARMED: 'BATTLE_ARMED' },
  coffeeCooldowns: new WeakMap(),
  crypto: { randomInt: () => 0 },
  broadcastToRoom: (room, event) => broadcasts.push(event),
  Date: { now: () => now },
  Math
};
vm.createContext(context);
vm.runInContext(source.slice(from, to), context);
const call = room => vm.runInContext('triggerCoffeeBreak(room)', vm.createContext({ ...context, room }));
const room = { roomMode: 'CASUAL' };
assert(call(room).success);
assert.strictEqual(broadcasts.length, 1);
assert.strictEqual(broadcasts[0].durationMs, 8000);
assert(!call(room).success);
now += 60000;
assert(call(room).success);
for (const roomMode of ['BATTLE', 'BATTLE_ARMED', 'RECOUNT']) {
  assert(!call({ roomMode }).success, roomMode);
}
const dispatch = source.slice(source.indexOf('function dispatchPlayerSlashCommand'), source.indexOf('// WOMF/WHEEL status line'));
assert(dispatch.includes("playerStore.ownsCosmetic(account, 'cmd-coffee')"));
assert(dispatch.includes("room.roomMode !== ROOM_MODES.CASUAL"));
const chat = source.slice(source.indexOf('function handleChatGuess(ws, message)'), source.indexOf('function handleChatEdit(ws, message)'));
assert(chat.includes("isBattleSurface(room) && String(text).trimStart().startsWith('/')"));
const player = fs.readFileSync(path.join(root, 'js/player.js'), 'utf8');
assert(player.includes("name: 'coffee', insert: '/coffee'"));
console.log('coffee-market: catalog, one-time price, cooldown, all mode gates and client command registration passed');
