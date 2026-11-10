'use strict';
const assert=require('assert/strict');const C=require('../automation/field-opening-cooldown');const S=require('../automation/spectral-adjudicator');
const at=Date.now(), state=S.normalizeState({fieldBoardId:'b',fieldOpenedAt:at});
assert.equal(C.remaining(state,'b',at),60);assert.equal(C.remaining(state,'b',at+35000),25);assert.equal(C.remaining(state,'b',at+59999),1);assert.equal(C.remaining(state,'b',at+60000),0);assert.equal(C.remaining(state,'next',at+1000),0);assert.equal(C.remaining({},'b',at),0);
const restored=S.normalizeState(JSON.parse(JSON.stringify(state)));assert.equal(C.remaining(restored,'b',at+20000),40);assert.equal(C.remaining(S.normalizeState({fieldBoardId:'b',fieldOpenedAt:'not a time'}),'b',at),0);
assert.equal(C.INSULTS.length,21);for(let i=0;i<C.INSULTS.length;i++)assert.ok(C.warning('Hero',25,i).startsWith('@Hero 25 SECONDS '));assert.ok(C.warning('Hero',1).includes('1 SECOND REMAINS'));
console.log('PASS field cooldown: global 60 seconds, live remaining time, exact boundary, board reset, restart persistence, 21 tagged Dennis warnings');
