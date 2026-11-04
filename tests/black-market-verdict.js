"use strict";
const assert=require('assert/strict'),path=require('path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<button id="black-market-gm-button"></button>');
  await page.evaluate(()=>{
   window.sent=[];window.prompts=[];window.answer='';
   window.App={send:m=>sent.push(m),handleServerMessage(){}};
   window.AsocDialog={prompt:async options=>{prompts.push(options);return answer;}};
  });
  await page.addScriptTag({path:path.join(__dirname,'..','js','black-market.js')});
  await page.evaluate(()=>{
   BlackMarket.pacts=[{id:'test-verdict',playerName:'Hero',state:'TRIBUTE_SUBMITTED',tributeRequired:true,title:'Offering',tributeImageData:'data:image/png;base64,AA=='}];BlackMarket.open();
  });
  for(const [action,accepted] of [['tribute-accept',true],['tribute-reject',false]]){
   await page.evaluate(()=>{answer='   ';});
   await page.locator('[data-act="'+action+'"]').click();
   assert.equal(await page.evaluate(()=>sent.filter(m=>m.type==='blackMarket:tributeJudge').length),accepted?0:1,'blank reason never reaches server');
   assert.equal(await page.evaluate(()=>prompts.at(-1).required),true);
   await page.evaluate(()=>{answer='  A written reason  ';});
   await page.locator('[data-act="'+action+'"]').click();
   const verdict=await page.evaluate(()=>sent.filter(m=>m.type==='blackMarket:tributeJudge').at(-1));
   assert.equal(verdict.accepted,accepted);assert.equal(verdict.comment,'A written reason');
  }
  await page.evaluate(()=>{
   BlackMarket.pacts=[{id:'complete',playerName:'Hero',state:'FULFILLED',tributeRequired:true,tributeId:'receipt',title:'BLOOD TRIBUTE REQUIRED',terms:'Payment is due to the Reliquary.',verdictComment:'Accepted',fulfilledAt:Date.now()}];BlackMarket.render();
  });
  assert.equal(await page.locator('[data-pact="complete"] [data-act]').count(),0,'completed deal has no follow-up actions');
  assert.match(await page.locator('[data-pact="complete"]').innerText(),/TRIBUTE ACCEPTED \/\/ DEAL COMPLETE/);
  assert.equal(await page.locator('[data-pact="complete"] .bm-terms').count(),0,'completed deal has no outstanding payment terms');
  console.log('PASS GM verdict browser: required written reason, blank blocked, accept/reject sent with trimmed comment');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
