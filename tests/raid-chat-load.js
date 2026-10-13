'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
const engine=require('../dragon-raid');
const PORT=18995;
(async()=>{
 const server=await H.startServer({port:PORT});
 let browser;
 try {
  browser=await chromium.launch(H.launchOptions());
  const contexts=[];const pages=[];
  for(let i=0;i<6;i++){
   const context=await browser.newContext({viewport:{width:1366,height:768}});
   contexts.push(context);
   const token=await H.heroToken(server,'Raid Load Hero '+i);
   pages.push(await H.openHeroPage(context,server,token));
  }
  const raid=engine.createRaid(Date.now(),'necromorph');
  for(let i=0;i<3;i++){
   const id=await pages[i].evaluate(()=>PlayerApp.playerId);
   engine.join(raid,{id,name:'Raid Load Hero '+i},i===0?'tank':i===1?'heal':'dps');
  }
  assert.equal(engine.startBattle(raid,Date.now()).ok,true);
  const view=engine.publicView(raid);
  await Promise.all(pages.map(p=>p.evaluate(r=>DragonRaid.onState(r,Date.now()),view)));
  await Promise.all(pages.map(p=>p.locator('.dragon-chat-open').click()));
  const started=Date.now();
  for(let i=0;i<6;i++){
   await pages[i].locator('.dragon-chat-slot #chat-input').fill('raid-load-message-'+i);
   await pages[i].locator('.dragon-chat-slot #chat-input').press('Enter');
  }
  await Promise.all(pages.map(p=>p.waitForFunction(()=>{
   const messages=PlayerApp.chatMessages||[];
   return [0,1,2,3,4,5].every(i=>messages.some(m=>m.text==='raid-load-message-'+i));
  },null,{timeout:12000})));
  const elapsed=Date.now()-started;
  for(let i=0;i<6;i++){
   assert.equal(await pages[i].locator('.dragon-arena').count(),1);
   assert.deepEqual(pages[i].pageErrors,[]);
   await pages[i].evaluate(()=>DragonRaid.onState(null,Date.now()));
  }
  console.log('PASS six-client raid chat load: three raiders, three spectators, all messages delivered; elapsed '+elapsed+'ms');
 }finally{if(browser)await browser.close();await server.stop();}
})().catch(e=>{console.error('FAIL six-client raid load',e);process.exit(1)});
