'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const gm = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js', 'player.js'), 'utf8');

assert.match(server, /const allOpen = \[1,2,3,4\]\.every\(row => room\.sessionState\.cells\[column \+ row\] === true\)/,
  'all four clue cells—not the solution cell—arm the column timer');
assert.match(server, /seconds:120, deadline:Date\.now\(\)\+120000[\s\S]*automatic:true/,
  'the automatic column deadline is exactly two minutes');
assert.match(server, /case 'revealCell':[\s\S]*syncAutomaticColumnCountdown\(room, col\)/,
  'every individual reveal checks whether it completed the four-clue set');
assert.match(server, /COLUMN_DANGER_CHAT_SEQUENCE[\s\S]*18000, text: '5'[\s\S]*15000, text: '4'[\s\S]*12000, text: '3'[\s\S]*9000, text: '2'[\s\S]*6000, text: '1'[\s\S]*3000, text: 'The time'/,
  'the final six warning messages land exactly three seconds apart');
assert.match(server, /addShadowBrokerMessage\(live, 'Is up\.',[\s\S]*resolveColumn', \{ column: entry\.target, outcome: 'failed' \}/,
  'Is up. automatically marks the expired column red and failed');
assert.match(server, /entry\.automatic[\s\S]*column:dangerExpired/,
  'expiry still emits the theatrical column explosion');
assert.match(gm, /Object\.values\(this\.solutionCountdowns \|\| \{\}\)/,
  'the GM renders authoritative column countdowns');
assert.match(player, /Object\.values\(this\.solutionCountdowns \|\| \{\}\)/,
  'players render authoritative column countdowns');

console.log('PASS automatic column countdown: 2:00, 3-second Revan rotation, automatic RED');
