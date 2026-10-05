'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const skeleton = fs.readFileSync(path.join(root, 'js', 'skeleton.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'aftermath-director.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const join = fs.readFileSync(path.join(root, 'join.html'), 'utf8');

assert.match(skeleton, /aftermath-director aftermath-\$\{outcome\.toLowerCase\(\)\}/,
  'shared renderer selects an outcome-specific cinematic treatment');
assert.match(skeleton, /kind:'opening'[\s\S]*kind:'evidence'[\s\S]*kind:'final'/,
  'the director contains opening, match evidence and finale chapters');
assert.match(skeleton, /COMPLETE SEQUENCE/);
assert.match(skeleton, /PROCEED TO RECOUNT/);
assert.match(skeleton, /alreadyComplete === true[\s\S]*setTimeout\(completeNow, 300\)/,
  'reconnect hydration skips replay and restores the host gate');
assert.match(skeleton, /prefers-reduced-motion: reduce/,
  'the shared director honors the OS reduced-motion preference');

assert.match(css, /\.aftermath-director\.aftermath-won/);
assert.match(css, /\.aftermath-director\.aftermath-lost/);
assert.match(css, /\.aftermath-board-ghost/);
assert.match(css, /\[data-scene="evidence"\]/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

for (const [name, html] of [['GM', index], ['player', join]]) {
  assert.match(html, /css\/aftermath-director\.css\?v=20261005-director-1/,
    `${name} surface loads the same Aftermath Director stylesheet`);
}

assert.match(server, /room\.match\.aftermathStartedAt = Date\.now\(\)/,
  'server remains authoritative for starting the aftermath');
assert.match(server, /room\.match\.aftermathResult = aftermathResult/,
  'aftermath payload remains persisted for reconnects');
assert.match(server, /type: 'match:aftermath', result: aftermathResult/,
  'one shared payload is broadcast to GM and players');

console.log('PASS cinematic Aftermath Director, accessibility, reconnect and authority guards');
