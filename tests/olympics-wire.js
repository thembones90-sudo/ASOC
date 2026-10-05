'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const engine = read('olympics.js');
const ui = read('js/olympics-ui.js');
const gm = read('index.html');
const player = read('join.html');

assert.match(server, /const olympics = require\('\.\/olympics'\)/, 'server uses the isolated Olympics engine');
for (const action of ['create', 'begin', 'pause', 'resume', 'restartThrow', 'restartMatch', 'forfeit', 'cancel']) {
  assert.match(server, new RegExp(`gm:olympics:${action}`), `server routes GM ${action}`);
}
for (const action of ['sync', 'join', 'leave', 'select', 'support']) {
  assert.match(server, new RegExp(`olympics:${action}`), `server routes player ${action}`);
}
assert.match(server, /olympicsActor[\s\S]*String\(player\.id\) !== String\(ws\.playerId\)/, 'player identity is derived from the authenticated socket');
assert.match(server, /olympics\.view\(room\.olympics, viewerId/, 'each socket receives a personalized projection');
assert.doesNotMatch(server, /THE SHADOW BROKER COMMANDS THE OLYMPICS BUT DOES NOT COMPETE/, 'the Shadow Broker is not blocked from player-side Olympics actions');
assert.doesNotMatch(engine, /ACTIVE OLYMPIANS CANNOT SUPPORT/, 'active Olympians are allowed to support');
assert.match(engine, /YOU CANNOT SUPPORT YOURSELF/, 'self-support remains forbidden');
assert.match(engine, /yourChoice:[^\n]*viewerId/, 'only the viewer receives their own unrevealed hand');
assert.match(engine, /const reveal = match\.phase === 'reveal'/, 'choices enter public state only during reveal');
assert.match(engine, /WAIT FOR THROW/, 'server enforces the ritual countdown');
assert.match(engine, /HAND ALREADY LOCKED|SPECTATORS CANNOT THROW|ELIMINATED PLAYERS CANNOT THROW|STALE THROW|INVALID HAND/g, 'invalid submissions are rejected server-side');
assert.match(server, /olympics: olympics\.normalizeState\(room\.olympics\)/, 'Olympics persistence is isolated from board state');
assert.match(server, /olympics\.resumeAfterRestart/, 'restart recovery preserves and pauses the tournament');
assert.match(ui, /data-oly-opens/, 'client renders the 3-2-1-THROW countdown');
assert.match(ui, /TOURNAMENT BRACKET/, 'client renders the bracket');
assert.match(ui, /OLYMPIC CHAMPION/, 'client renders champion ceremony');
assert.match(ui, /ENTER AS SHADOW BROKER/, 'GM lobby exposes a real tournament entry button');
assert.match(ui, /DISMISSED_KEY = 'asoc_olympics_dismissed_id'/, 'Olympics dismissal is persisted per browser tab');
assert.match(ui, /state\.dismissedId === tournamentId/, 'incoming state respects a dismissed tournament instead of force-opening it');
assert.match(ui, /safeStorage\.set\(DISMISSED_KEY, ''\)/, 'manual reopen can clear the dismissal lock');
assert.match(ui, /a\.id !== viewer[\s\S]*supportButton\(a\)/, 'active competitors can visibly support the opponent');
assert.match(server, /awardShadowCoins\(account, 5, `olympics:\$\{room\.olympics\.id\}:champion`/, 'Little Hero champion earns exactly 5 Shadow Coin with an idempotent tournament receipt');
assert.match(server, /const account = coinAccount\(event\.playerId, champion\)/, 'GM champion payout is excluded by the shared coinAccount guard');

assert.match(gm, /data-open-olympics/, 'GM arcade exposes Olympics');
assert.match(player, /data-open-olympics/, 'player arcade exposes Olympics');

console.log('PASS Olympics wire authority, private projections, recovery, controls and both arcade entry points');
