'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const effect = read('js/ass-kick.js');
const css = read('css/ass-kick.css');
const player = read('js/player.js');
const app = read('js/app.js');
const index = read('index.html');
const join = read('join.html');

assert.match(effect, /message\.emote\?\.act !== 'ass'/, 'only /ass emotes trigger the boot effect');
assert.match(effect, /\[data-player-id\]/, 'the effect resolves the authoritative target avatar from the roster');
assert.match(effect, /ass-kick-target[\s\S]*ass-kick-leg[\s\S]*DISCIPLINARY FOOTWORK/, 'the vignette includes the target, military boot and impact caption');
assert.match(effect, /ass-kick-trouser"><i>★<\/i>/, 'the Soviet field uniform carries the red-star insignia');
assert.match(css, /\.ass-kick-trouser i\{/, 'the insignia is styled as part of the uniform');
assert.match(css, /@keyframes ass-kick-strike/);
assert.match(css, /@keyframes ass-kick-victim[\s\S]*rotate\(620deg\)/, 'the target avatar is launched by the impact');
assert.match(css, /prefers-reduced-motion:reduce/, 'the effect has a reduced-motion fallback');
assert.match(player, /window\.AssKick\?\.play\(msg\)/, 'player chat launches the effect');
assert.match(app, /window\.AssKick\?\.play\(msg\)/, 'GM chat launches the effect');
for (const [surface, html] of [['GM', index], ['player', join]]) {
  assert.match(html, /css\/ass-kick\.css\?v=20261005-ass-kick-1/, `${surface} loads the boot CSS`);
  assert.match(html, /js\/ass-kick\.js\?v=20261005-ass-kick-1/, `${surface} loads the boot effect`);
}
assert.match(index, /js\/app\.js\?v=20261005-ass-kick-1/, 'GM app cache is invalidated');
assert.match(join, /js\/player\.js\?v=20261005-ass-kick-1/, 'player app cache is invalidated');
console.log('PASS /ass Soviet military boot target-avatar animation on GM and player clients');
