'use strict';
const assert=require('assert/strict');const D=require('../automation/dennis-loss-taunts');
assert.equal(D.LINES.length,6);assert.equal(new Set(D.LINES).size,6);
for(let i=0;i<6;i++){const ledger={completedAt:1};assert.equal(D.take(ledger,'LOST',()=>i),D.LINES[i]);assert.equal(ledger.dennisLossTauntSent,true);assert.equal(D.take(JSON.parse(JSON.stringify(ledger)),'LOST'),null);}
for(const outcome of ['WON','COMPLETE',undefined]){const ledger={completedAt:1};assert.equal(D.take(ledger,outcome),null);assert.equal(ledger.dennisLossTauntSent,undefined);}
assert.equal(D.take({},'LOST'),null);assert.equal(D.take(null,'LOST'),null);
console.log('PASS Dennis loss taunts: all six exact approved lines, completed losses only, one receipt per game and restart dedupe, no taunts for wins or cancelled games');
