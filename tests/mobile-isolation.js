// MOBILE ISOLATION -- structural guarantees that the mobile presentation can
// never reach the GM panel or desktop Little Hero layout:
//   - the GM page (index.html) loads no mobile stylesheet or script
//   - css/mobile.css (when present) scopes EVERY rule under html.asoc-mobile
//   - shared stylesheets mention asoc-mobile only as html.asoc-mobile or as
//     the html:not(.asoc-mobile) quarantine of legacy phone rules
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const gm = read('index.html');
assert.doesNotMatch(gm, /mobile\.css|mobile-shell\.js/, 'the GM page never loads mobile presentation files');

// Selectors of a stylesheet, with comments stripped and @-rule preludes skipped.
function selectors(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(clean))) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    if (/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(prelude)) continue; // keyframe steps
    prelude.split(',').forEach(sel => out.push(sel.trim()));
  }
  return out;
}

const mobilePath = path.join(ROOT, 'css', 'mobile.css');
if (fs.existsSync(mobilePath)) {
  const bad = selectors(fs.readFileSync(mobilePath, 'utf8')).filter(sel => sel !== ':root' && !sel.startsWith('html.asoc-mobile'));
  assert.deepEqual(bad, [], 'every css/mobile.css selector starts with html.asoc-mobile (or is :root tokens)');
}

for (const file of ['css/asoc.css', 'join.html']) {
  const css = file.endsWith('.html') ? (read(file).match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('\n') : read(file);
  const stray = selectors(css).filter(sel => /asoc-mobile/.test(sel) && !/^html(\.asoc-mobile|:not\(\.asoc-mobile\))/.test(sel));
  assert.deepEqual(stray, [], `${file}: asoc-mobile appears only as html.asoc-mobile / html:not(.asoc-mobile)`);
}

console.log('PASS mobile isolation: GM page loads no mobile files; mobile rules are root-scoped; legacy phone rules only via html:not(.asoc-mobile)');
