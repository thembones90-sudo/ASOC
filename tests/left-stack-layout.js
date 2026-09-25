'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'asoc.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(css.includes('DESKTOP LEFT STACK ANCHOR'), 'desktop left-stack correction must be present');
assert(css.includes('@media (min-width: 761px)'), 'left-stack correction must not alter the mobile shell');
assert.match(
  css,
  /body:is\(\.room-mode-battle,\.room-mode-battle-armed,\.room-mode-recount\) #main-content\s*\{[\s\S]*?justify-content:flex-start !important;/,
  'battle and recount layouts must top-anchor the left stack'
);
assert.match(css, /DESKTOP LEFT STACK ANCHOR[\s\S]*?overflow-y:auto;/, 'short desktop viewports must scroll rather than clip lower controls');
// Dated no earlier than the release that shipped this correction; later
// features legitimately bump the same stylesheet version again.
const asocCssVersionDate = (html.match(/css\/asoc\.css\?v=(\d{8})-/) || [])[1] || '';
assert(asocCssVersionDate >= '20260924', 'layout correction must be cache-busted');

console.log('left-stack-layout: all checks passed');
