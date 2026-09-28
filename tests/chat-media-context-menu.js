const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

// Regression cover for two user-visible chat bugs:
//
//  1. Right-clicking the image opened in the media lightbox must reach the
//     browser's own menu ("Save image as…"). ASOC cancels contextmenu in
//     document-capture handlers, so the allow-rule has to live in front of
//     them (window capture) AND in the cancelling handler itself. A
//     stopPropagation() bolted onto the <img> runs last and is useless.
//
//  2. The username tooltip above a reaction chip must be readable. The chips
//     used to carry BOTH data-reactors (styleable) and title (OS-drawn,
//     unstyleable); the native title tooltip is the tiny label users saw, so
//     CSS alone could never fix it.

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const preview = read('js', 'chat-media-preview.js');
const gm = read('js', 'app.js');
const player = read('js', 'player.js');
const styles = read('css', 'asoc.css');
const index = read('index.html');
const join = read('join.html');

// --- 1. native context menu on the opened image -----------------------------
assert.match(preview, /window\.addEventListener\('contextmenu',[\s\S]{0,400}?, true\)/,
  'lightbox must allow the native menu from the window capture phase');
assert.match(preview, /function isOpenedMediaTarget\(/);
assert.match(preview, /ChatMediaPreview = \{[^}]*isOpenedMediaTarget[^}]*\}/,
  'helper must be exported for the chat menus');
assert.doesNotMatch(preview, /window\.addEventListener\('contextmenu',[\s\S]{0,400}?preventDefault/,
  'the lightbox must never cancel the event or the native menu is lost');
assert.match(preview, /preview\.className = MEDIA_CLASS/);

// The cancelling handlers must defer to the lightbox before preventDefault().
for (const [name, source] of [['player', player], ['gm', gm]]) {
  const handler = source.match(/document\.addEventListener\('contextmenu',[\s\S]*?\n {4}\}, true\);/);
  assert.ok(handler, `${name}: document capture contextmenu handler not found`);
  const body = handler[0];
  const guard = body.indexOf('isOpenedMediaTarget');
  const cancel = body.indexOf('preventDefault');
  assert.ok(guard > -1, `${name}: chat context menu does not defer to the media lightbox`);
  assert.ok(cancel > guard, `${name}: lightbox guard must run before preventDefault()`);
}

// Both pages must actually ship the fixed client assets.
for (const [name, page] of [['index', index], ['join', join]]) {
  assert.match(page, /js\/chat-media-preview\.js\?v=[^"]+/, `${name}: lightbox script version missing`);
  assert.match(page, /js\/app\.js\?v=|js\/player\.js\?v=/, `${name}: chat script version missing`);
  assert.match(page, /css\/asoc\.css\?v=/, `${name}: stylesheet version missing`);
}

// --- 2. readable reaction hover tooltip --------------------------------------
for (const [name, source] of [['player', player], ['gm', gm]]) {
  const chip = source.match(/<button type="button" class="(?:\w+-)?chat-reaction-chip[^`]*?<\/button>`;/);
  assert.ok(chip, `${name}: reaction chip markup not found`);
  assert.match(chip[0], /data-reactors="\$\{reactors\}"/, `${name}: chip lost its styled tooltip source`);
  assert.doesNotMatch(chip[0], /\stitle="/,
    `${name}: chip still emits a native title tooltip that no CSS can enlarge`);
  assert.match(chip[0], /aria-label="Reacted by/, `${name}: chip lost its accessible name`);
}

const tooltip = styles.match(/\.gm-chat-reaction-chip\[data-reactors\]::after,\.chat-reaction-chip\[data-reactors\]::after\{([\s\S]*?)\}/);
assert.ok(tooltip, 'reaction hover tooltip rule not found');
assert.match(tooltip[1], /content:attr\(data-reactors\)/);
const fontSize = Number((tooltip[1].match(/font:800 (\.\d+)rem/) || [])[1]);
assert.ok(fontSize >= 0.9, `hover tooltip font is still too small (${fontSize}rem)`);
assert.match(tooltip[1], /font-weight|font:800/);
assert.match(tooltip[1], /pointer-events:none/, 'tooltip must not eat the click that opens reaction details');

// The reaction-detail list is a different surface and must be left alone.
assert.match(styles, /\.chat-reaction-detail-person strong\{[^}]*font-size:\.88rem/);

console.log('PASS native image context menu in the media lightbox and readable reaction hover names');
