'use strict';
const assert=require('assert/strict');const V=require('../automation/spectral-voice');const A=require('../automation/spectral-adjudicator');
assert.equal(Object.keys(V.LINES).length,12);assert.equal(Object.values(V.LINES).flat().length,36);
let state=A.normalizeState({mode:'AUTONOMOUS'});
for(const [event,lines]of Object.entries(V.LINES)){assert.equal(lines.length,3);assert.equal(new Set(lines).size,3);let last;for(let i=0;i<9;i++){const line=V.take(state,event,{random:n=>i%n});assert.ok(lines.includes(line));assert.notEqual(line,last);last=line;state=A.normalizeState(JSON.parse(JSON.stringify(state)));}}
assert.ok(V.take(state,'DEFEAT',{key:'b:defeat'}));assert.equal(V.take(state,'DEFEAT',{key:'b:defeat'}),null);
assert.ok(V.take(state,'WRONG',{key:'one',chatter:true,now:100000}));assert.equal(V.take(state,'REPEATED',{key:'two',chatter:true,now:101000}),null);assert.ok(V.take(state,'REPEATED',{key:'two',chatter:true,now:112000}));
assert.ok(V.LINES.SUMMON.every(line=>line.startsWith('@all ')));assert.ok(V.LINES.CANCEL.every(line=>line.startsWith('@all ')));
console.log('PASS SPECTRA voice: 36 approved lines / 12 events, random variation without immediate repetition across restart, once-only event keys and chat throttling');
