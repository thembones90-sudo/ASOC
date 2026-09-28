#!/usr/bin/env node
// MOBILE ALPHA 0.1, STEP 1 -- quarantine the legacy phone rules.
//
// Re-scopes every style rule inside a phone-sized @media block (max-width
// <= 900px, or max-height <= 500px) so it only applies while the MOBILE
// VERSION shell is OFF:
//
//   .x .y            ->  :where(html:not(.asoc-mobile)) .x .y
//   html.foo .x      ->  html:where(:not(.asoc-mobile)).foo .x
//   :root            ->  :root:where(:not(.asoc-mobile))
//
// :where() adds zero specificity, so while html.asoc-mobile is absent the
// cascade is exactly what it was: no visual change anywhere. Once the shell
// sets html.asoc-mobile, css/mobile.css starts from a clean slate.
//
// Idempotent. Usage: node scripts/quarantine-phone-css.js <file.css|file.html>...
'use strict';

const fs = require('fs');

const WS = /\s+|\/\*[\s\S]*?\*\//y;
const GUARD = ':where(html:not(.asoc-mobile))';
const MARK = ':not(.asoc-mobile)';

function isPhonePrelude(prelude) {
  const text = prelude.toLowerCase();
  if (!text.startsWith('@media')) return false;
  let phone = false;
  for (const m of text.matchAll(/max-width\s*:\s*(\d+)px/g)) if (Number(m[1]) <= 900) phone = true;
  for (const m of text.matchAll(/max-height\s*:\s*(\d+)px/g)) if (Number(m[1]) <= 500) phone = true;
  return phone;
}

// Splits a selector list on top-level commas.
function splitSelectors(list) {
  const parts = [];
  let depth = 0, start = 0, quote = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(list.slice(start, i)); start = i + 1; }
  }
  parts.push(list.slice(start));
  return parts;
}

function guardSelector(selector) {
  const lead = selector.match(/^\s*/)[0];
  const trail = selector.match(/\s*$/)[0];
  const core = selector.trim();
  if (!core || core.includes(MARK)) return selector;
  if (/^html(?![\w-])/i.test(core)) return lead + 'html:where(' + MARK + ')' + core.slice(4) + trail;
  if (/^:root(?![\w-])/i.test(core)) return lead + ':root:where(' + MARK + ')' + core.slice(5) + trail;
  return lead + GUARD + ' ' + core + trail;
}

// Finds the index of the "}" matching the "{" at `open`.
function matchBrace(css, open) {
  let depth = 0, quote = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 1; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('Unbalanced braces at ' + open);
}

// Rewrites a block's contents. `inPhone` = we are inside a phone @media.
function rewrite(css, inPhone) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    // Copy whitespace and comments through unchanged.
    WS.lastIndex = i;
    const ws = WS.exec(css);
    if (ws) { out += ws[0]; i += ws[0].length; continue; }
    const open = findNext(css, i, '{');
    const semi = findNext(css, i, ';');
    if (open < 0 || (semi >= 0 && semi < open)) {
      // A statement without a block (@import, @charset, stray text) or the tail.
      const end = semi < 0 ? css.length : semi + 1;
      out += css.slice(i, end); i = end; continue;
    }
    const prelude = css.slice(i, open);
    const close = matchBrace(css, open);
    const body = css.slice(open + 1, close);
    const head = prelude.trim();
    if (head.startsWith('@')) {
      if (/^@(-webkit-)?keyframes|^@font-face|^@page|^@counter-style|^@property/i.test(head)) out += prelude + '{' + body + '}';
      else out += prelude + '{' + rewrite(body, inPhone || isPhonePrelude(head)) + '}';
    } else if (inPhone) {
      out += splitSelectors(prelude).map(guardSelector).join(',') + '{' + body + '}';
    } else {
      out += prelude + '{' + body + '}';
    }
    i = close + 1;
  }
  return out;
}

// Next occurrence of `ch` outside comments and strings.
function findNext(css, from, ch) {
  let quote = null;
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); if (end < 0) return -1; i = end + 1; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === ch) return i;
  }
  return -1;
}

function processFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  let next;
  if (/\.html?$/i.test(file)) {
    next = text.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, a, css, b) => a + rewrite(css, false) + b);
  } else {
    next = rewrite(text, false);
  }
  if (next !== text) fs.writeFileSync(file, next);
  return next !== text;
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: quarantine-phone-css.js <file>...'); process.exit(2); }
  for (const file of files) console.log(`${processFile(file) ? 'quarantined' : 'unchanged  '} ${file}`);
}

module.exports = { rewrite, guardSelector, isPhonePrelude };
