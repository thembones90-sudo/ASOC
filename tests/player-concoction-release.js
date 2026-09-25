const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'js', 'unstable-concoction.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js', 'player.js'), 'utf8');
const join = fs.readFileSync(path.join(root, 'join.html'), 'utf8');

assert.match(client, /wasSpinning[\s\S]*finishWithoutResult\(\)/, 'authoritative state must release a missed resolution');
assert.match(client, /watchdogTimer[\s\S]*remaining \+ 6000/, 'spin must have a bounded failsafe');
assert.match(client, /class="concoction-dismiss" hidden>RETURN TO CHAT/, 'resolved overlay must be manually dismissible');
assert.match(client, /onLocked\(message\)[\s\S]*closePanel\(\)/, 'rejected/locked spin must release the overlay');
assert.match(client, /onError\(\)[\s\S]*closePanel\(\)/, 'generic rejection must release optimistic UI');
assert.match(player, /case 'error':[\s\S]*UnstableConcoction\?\.onError/, 'player errors must notify the minigame UI');
assert.match(join, /unstable-concoction\.js\?v=20260925-player-release-1/, 'player must receive the repaired bundle');

console.log('PASS player Unstable Concoction always releases after result, state recovery, timeout, lock or error');
