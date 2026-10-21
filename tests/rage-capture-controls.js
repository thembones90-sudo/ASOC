'use strict';
// Regression guard for RAGE capture selection, including alternate touch controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../rage');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/rage-game.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/rage.css'), 'utf8');

assert.match(ui, /class="rage-target [^\x60]*data-rage="move"/, 'landing squares must submit moves');
assert.match(ui, /aria-label="\$\{o\.capture \? 'Capture enemy'/, 'enemy landing square must be accessible');
assert.match(ui, /class="rage-capture-button" data-rage="move"/, 'explicit capture buttons must submit moves');
assert.match(ui, /#rage-targets \.rage-target, \.rage-capture-button/, 'all click paths must be disabled after a move');
assert.match(css, /\.rage-targets \.rage-target[\s\S]*?pointer-events: auto/, 'landing targets must receive touch');
assert.match(css, /\.rage-capture-button[\s\S]*?min-height: 44px/, 'mobile capture button needs usable dimensions');

function table(mode) {
  const s = R.createLobby({id:'a',name:'Alice'},{gameMode:mode},0);
  R.join(s,{id:'b',name:'Bob'});
  R.pickColor(s,'a','blood');
  R.pickColor(s,'b','void');
  assert.equal(R.start(s,'a',new Set(['a','b']),0).ok,true);
  R.begin(s,0);
  return s;
}
for (const mode of ['STANDARD','SHORT']) {
  let s = table(mode);
  // A at absolute square 1, B at abs square 3 (seat 2, progress 23).
  s.players.a.pieces = mode === 'SHORT' ? [1,-1] : [1,-1,-1,-1];
  s.players.b.pieces = mode === 'SHORT' ? [23,-1] : [23,-1,-1,-1];
  const roll = R.roll(s,'a',s.turnSeq,0,()=>2);
  assert.equal(roll.ok,true);
  assert.deepEqual(s.options.map(o=>o.piece),[0]);
  assert.equal(s.options[0].capture.id,'b');
  assert.equal(R.view(s,'a',0,new Set(['a','b'])).mustCapture,true);
  assert.equal(R.view(s,'b',0,new Set(['a','b'])).options.length,0, 'no private move leak');
  assert.equal(R.move(s,'a',0,s.turnSeq,0).ok,true);
  assert.equal(s.players.b.pieces[0],-1,'captured enemy returns to yard');
  assert.ok(s.events.some(e=>e.kind==='capture' && e.victim==='b'));

  // Passing an enemy does not capture it: only the landing square matters.
  s=table(mode);
  s.players.a.pieces=mode==='SHORT' ? [1,-1] : [1,-1,-1,-1];
  s.players.b.pieces=mode==='SHORT' ? [22,-1] : [22,-1,-1,-1];
  assert.equal(R.roll(s,'a',s.turnSeq,0,()=>2).ok,true);
  assert.equal(s.options[0].capture,null);
}
console.log('PASS RAGE capture controls and exact landing semantics');
