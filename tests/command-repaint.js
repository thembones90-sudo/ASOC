'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'asoc.css'), 'utf8');
const tweaksCss = fs.readFileSync(path.join(root, 'css', 'tweaks.css'), 'utf8');
const tweaksJs = fs.readFileSync(path.join(root, 'js', 'tweaks.js'), 'utf8');

assert(html.includes('20260924-desktop-command-repaint-1'), 'combined desktop and command repaint CSS must be cache-busted');
assert(html.includes('tweaks.css?v=20260924-command-repaint-1'), 'TWEAKS repaint CSS must be cache-busted');

assert(html.includes('class="bice-btn-sigil"'), 'BIĆE ASOC must use the cyber-organic SVG sigil');
assert(css.includes('.bice-sigil-reticle'), 'BIĆE ASOC sigil styling must include its targeting reticle');
assert(css.includes('@keyframes bice-sigil-iris'), 'BIĆE ASOC sigil must retain a restrained animated iris');

assert(html.includes('class="master-access-sigil"'), 'MASTER ACCESS must use the authorization seal SVG');
assert(css.includes('.master-sigil-key'), 'MASTER ACCESS authorization seal must include the key glyph');
assert(css.includes('stroke:#9f72ed'), 'MASTER ACCESS must retain its purple identity');

assert(css.includes('COMMAND REPAINT'), 'NEMA ASOC repaint block must exist');
assert(css.includes('border-color:#ff2638 !important'), 'NEMA ASOC must use a blood-red threat border');
assert(css.includes("fill='%23ff3b48'"), 'NEMA ASOC trefoil pattern must be repainted blood red');
assert(css.includes('repeating-linear-gradient(-45deg,#ff2638 0 7px,#160306 7px 14px)'), 'NEMA ASOC must retain red hazard rails');

assert(tweaksCss.includes('color:#ffd8ad'), 'GM TWEAKS must use pale-orange text');
assert(tweaksCss.includes('border-color:#ffc27c'), 'GM TWEAKS hover must use pale-orange emphasis');
assert(tweaksJs.includes('aria-hidden="true">⚙</span><span>TWEAKS'), 'TWEAKS must use a maintenance gear glyph');

console.log('command-repaint: all checks passed');
