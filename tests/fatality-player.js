'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js', 'player.js'), 'utf8');
const fatality = fs.readFileSync(path.join(root, 'js', 'fatality.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const join = fs.readFileSync(path.join(root, 'join.html'), 'utf8');

assert.match(server, /function handlePlayerFatalityCommand\(/);
assert.match(server, /COMMAND_ITEMS\.get\('fatality'\)[\s\S]*ownsCosmetic\(account, item\.id\)/);
assert.match(server, /allowBroker: true/);
assert.match(server, /crypto\.randomInt\(0, 100\) < 90/);
assert.match(server, /reflected[\s\S]*targetName: victim\.name/);
assert.match(server, /FATALITY_FEED_LINES[\s\S]*Wrong throne, little heretic/);
assert.doesNotMatch(server, /unleashes FATALITY on/);
assert.doesNotMatch(server, /The Broker returned it to sender/);
assert.match(server, /if \(\/\^\\\/fatality\\b\/i\.test\(raw\)\)[\s\S]*handlePlayerFatalityCommand/);
assert.match(player, /name: 'fatality'[\s\S]*insert: '\/fatality @'/);
assert.match(player, /targetedChatActs:[^\n]*'fatality'/, 'fatality must use the player target picker');
assert.match(fatality, /SPELL REFLECT/);
assert.match(index, /js\/fatality\.js\?v=20261007-fatality-4/);
assert.match(join, /js\/fatality\.js\?v=20261007-fatality-4/);
assert.match(join, /js\/player\.js\?v=20261007-fatality-player-1/);

console.log('PASS player fatality grant path and 90% Broker reflect wiring');
