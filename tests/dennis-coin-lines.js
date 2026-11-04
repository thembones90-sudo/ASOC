'use strict';
const assert=require('assert/strict');
const lines=require('../dennis-coin-lines');
for(const tier of ['poor','common','uncommon','rare','epic','legendary']){
 const outputs=new Set();
 for(let i=0;i<3;i++){
  const amount=tier==='legendary'?25:1.2;
  const text=lines.caught(tier,'Čakra $&',amount,()=>i);
  assert.ok(text.includes('Čakra $&'),'names are inserted literally');
  assert.ok(text.includes(`+${amount} SC`),'every variant displays the actual payout');
  assert.doesNotMatch(text,/\{player\}|\{amount\}/);
  outputs.add(text);
 }
 assert.equal(outputs.size,3,`${tier} has three distinct lines`);
}
assert.match(lines.rollWinner('Ana',80,3.4),/Ana bacio 80 i dobio \+3.4 SC/);
assert.match(lines.rollTie([{name:'Ana',amount:0.2},{name:'Bo',amount:0.1}]),/Ana \+0.2 SC, Bo \+0.1 SC/);
console.log('PASS Dennis coin copy: all 18 variants, literal names, exact payouts and roll results');
