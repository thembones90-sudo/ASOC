'use strict';
const assert = require('node:assert/strict');
const { chaosLine, lines } = require('../chaos-dialogue');
const samples = { who:'Ana, Bea', name:'Ana', target:60, coins:20, seconds:30, value:87, payout:20, error:'DEBIT FAILED' };
for (const [kind, variants] of Object.entries(lines)) {
 assert(variants.length >= (kind==='payoutFailure' ? 1 : 3), kind + ' lacks variants');
 const seen = new Set();
 for (let index=0; index<variants.length; index++){
  const sentence=chaosLine(kind,samples,max=>{assert.equal(max,variants.length);return index;});
  assert(typeof sentence==='string' && sentence.length>30);
  assert(!sentence.includes('undefined'));
  seen.add(sentence);
  if(kind==='open'){
   for(const word of ['Ana, Bea','60+','20 SC','100','1','DARK BLOOD','30 SECONDS'])
    assert(sentence.includes(word), 'open variant '+index+' missing '+word);
  }
  if(kind==='accept')assert(sentence.includes('/roll'));
  if(['win','perfect'].includes(kind))assert(sentence.includes('20 SC'));
  if(['lose','dark'].includes(kind))assert(sentence.includes('BLOOD TRIBUTE'));
 }
 assert.equal(seen.size,variants.length,kind+' lacks distinct options');
}
console.log('CHAOS_DIALOGUE_VARIANTS_PASS: all outcomes and mandatory wager terms');
