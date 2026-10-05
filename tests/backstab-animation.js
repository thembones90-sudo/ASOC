'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'backstab.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js', 'backstab.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js', 'player.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const join = fs.readFileSync(path.join(root, 'join.html'), 'utf8');

assert.match(css, /\.backstab-blade\{[^}]*clip-path:polygon\(0 50%/,
  'the blade has a real left-facing point');
assert.match(css, /@keyframes backstab-strike\{[^}]*translate3d\(115vw/,
  'a left-facing blade enters from the right so the point leads');
assert.match(css, /46%\{transform:translate3d\(50%,0,0\)/,
  'the blade tip, located half a dagger width left of its centre, lands at screen centre');
assert.match(css, /\.backstab-stage:before[^}]*left:50%;top:50%/,
  'impact flash is anchored to the blade-tip contact point');
assert.match(css, /\.backstab-stage:after[^}]*left:50%;top:50%/,
  'the cut line shares the physical contact point');
assert.match(css, /\.is-failure \.backstab-dagger\{animation-name:backstab-fail\}/,
  'the existing self-stab failure path remains distinct');
assert.match(css, /@media\(prefers-reduced-motion:reduce\)/,
  'the remodeled effect preserves reduced-motion handling');
assert.match(js, /Number\(message\.cost\) > 0[\s\S]*SHADOW BROKER AUTHORITY/,
  'the effect does not falsely show a coin charge for an administrative GM strike');
assert.match(js, /function avatarFor\([\s\S]*data-broker-avatar[\s\S]*shadow-broker\.png[\s\S]*\[data-player-id\]/,
  'the vignette resolves the Shadow Broker portrait and player portraits');
assert.match(js, /authoritativeSource[\s\S]*message\.actorAvatarData[\s\S]*message\.victimAvatarData/,
  'the vignette prefers authoritative avatar URLs carried by the strike event');
assert.match(server, /actorAvatarData: liveAvatarFor\(room, author\.id\)[\s\S]*victimAvatarData: liveAvatarFor\(room, victim\.id\)/,
  'player strikes carry authoritative actor and victim portraits');
assert.match(server, /actorAvatarData: publicBrokerProfile\(room\)\.avatarData[\s\S]*victimAvatarData: liveAvatarFor\(room, target\.id\)/,
  'Broker strikes carry the live Broker and target portraits');
assert.match(js, /backstab-character backstab-victim[\s\S]*backstab-character backstab-attacker/,
  'both attacker and victim avatars are rendered around the existing dagger');
assert.match(css, /@keyframes backstab-attacker/);
assert.match(css, /@keyframes backstab-victim[\s\S]*rotate\(-92deg\)/,
  'the struck avatar performs the theatrical death fall');
assert.match(js, /function flagHTML\(\)[\s\S]*Bulgarian flag/, 'the chat event exposes a real Bulgarian tricolor badge');
assert.match(css, /\.backstab-chat-flag[\s\S]*#00966e[\s\S]*#d62612/, 'the Bulgarian flag uses white, green and red bands');
const lines = server.match(/const BACKSTAB_SUCCESS_LINES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '';
assert.equal((lines.match(/^\s+'.*'[,.]?$/gm) || []).length, 10, 'the event has exactly ten random success lines');
assert.match(server, /result\.message\.source = 'shadowBroker'/, 'GM strikes use the Broker identity pipeline');
assert.match(server, /hiddenGrant = item\.id === 'cmd-backstab'[\s\S]*awardRelic\(room, account, item\.id, \{ announce: !hiddenGrant \}\)/,
  'awarding backstab remains hidden instead of publishing a relic notification');
assert.match(player, /backstab-chat-message[\s\S]*BackstabEffect\?\.flagHTML/, 'player chat renders the Broker event flag');
assert.match(app, /backstab-chat-message[\s\S]*BackstabEffect\?\.flagHTML/, 'GM chat renders the Broker event flag');
for (const [surface, html] of [['GM', index], ['player', join]]) {
  assert.match(html, /css\/backstab\.css\?v=20261005-backstab-4/, `${surface} loads the remodeled CSS`);
  assert.match(html, /js\/backstab\.js\?v=20261005-backstab-5/, `${surface} loads the matching effect script`);
}
assert.match(index, /js\/app\.js\?v=20261005-backstab-event-1/);
assert.match(join, /js\/player\.js\?v=20261005-backstab-event-1/);

console.log('PASS backstab animation: sharp point leads, impact aligns, failure path and reduced motion remain intact');
