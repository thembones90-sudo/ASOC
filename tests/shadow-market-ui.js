'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ui = read('js/shadow-market-ui.js');
const css = read('css/shadow-market.css');
const join = read('join.html');
const index = read('index.html');
const market = require('../shadow-market');

assert.match(ui, /role', 'dialog'/, 'market is exposed as a dialog');
assert.match(ui, /aria-modal', 'true'/, 'market is modal to assistive tech');
assert.match(ui, /returnFocus/, 'market restores the opener focus');
assert.match(ui, /event\.key === 'Tab'/, 'market traps keyboard focus');
assert.match(ui, /event\.key === 'Escape'/, 'Escape closes the market');
assert.match(css, /\.shadow-fx-layer[\s\S]*z-index:\s*7900/, 'theatrical FX stay below market UI');
assert.match(css, /\.shadow-fx-layer[\s\S]*pointer-events:\s*none/, 'theatrical FX cannot block controls');
assert.match(css, /\.smk-overlay[\s\S]*z-index:\s*8000/, 'market stays above cosmetic FX');
assert.match(css, /\.dsr-overlay[\s\S]*z-index:\s*8600/, 'dossier stays above cosmetic FX');
assert.match(join, /shadow-market\.css\?v=20260926-shadow-market-hardening-1/, 'player CSS cache key updated');
assert.match(join, /shadow-market-ui\.js\?v=20260926-shadow-market-hardening-1/, 'player market cache key updated');
assert.match(index, /shadow-market\.css\?v=20260926-shadow-market-hardening-1/, 'GM cosmetic CSS cache key updated');

const womf = market.getItem('title-womf-survivor');
assert.equal(market.requirementMet(womf, { relicProgress: {} }), false);
assert.equal(market.requirementMet(womf, { relicProgress: { wheelSurvivals: 1 } }), true);

const priorityArt = [
  'cmd-smite','cmd-freeze','cmd-glitch','cmd-omen','cmd-rupture','cmd-vanish','cmd-love',
  'cel-broker-nod','cel-shatter','cel-blood-ink','cel-final-witness',
  'title-broker-mistake','relic-spun-returned','relic-fastest-hand','relic-last-second-heretic','relic-word-killer'
];
for (const id of priorityArt) assert.match(market.getItem(id)?.asset || '', /^assets\/shop\/.+\.png$/, `${id} has a stable shop asset path`);
const stateCatalog = market.catalogFor({ cosmetics: { owned: {} }, relicProgress: {} });
assert.equal(stateCatalog.find(i => i.id === 'cmd-smite').asset, 'assets/shop/cmd-smite.png');
assert.match(ui, /smk-preview-art/, 'market has image-backed preview fallbacks');
assert.match(css, /--smk-art/, 'market CSS consumes image assets without broken image elements');
assert.match(read('js/shadow-cosmetics.js'), /dsr-relic-art/, 'public dossier can render relic art');
console.log('PASS Shadow Market UI hardening: modal focus, non-blocking theatre, cache busting, WOMF title gate, asset-ready previews');
