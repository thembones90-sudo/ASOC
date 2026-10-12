'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
const engine=require('../dragon-raid');
const PORT=18994;
(async()=>{
 const server=await H.startServer({port:PORT});
 let browser;
 try{
  browser=await chromium.launch(H.launchOptions());
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const raider=await H.openHeroPage(context,server,await H.heroToken(server,'Raid Participant'));
  const spectator=await H.openHeroPage(context,server,await H.heroToken(server,'Raid Spectator'));
  const raid=engine.createRaid(Date.now(),'necromorph');
  const raiderId=await raider.evaluate(()=>String(PlayerApp.playerId));
  assert.ok(raiderId);
  engine.join(raid,{id:raiderId,name:'Raid Participant'},'dps');
  engine.join(raid,{id:'test-second',name:'Other Hero'},'tank');
  engine.join(raid,{id:'test-third',name:'Healer'},'heal');
  assert.ok(engine.startBattle(raid,Date.now()).ok);
  const view=engine.publicView(raid);
  for(const page of [raider,spectator]){
   await page.evaluate(r=>window.DragonRaid.onState(r,Date.now()),view);
   assert.equal(await page.locator('#dragon-raid-overlay:not([hidden])').count(),1);
   assert.equal(await page.locator('.dragon-chat-slot #chat-input').count(),1);
   assert.equal(await page.locator('.dragon-arena').count(),1);
  }
  assert.equal(await spectator.locator('.dragon-locked').filter({hasText:'SPECTATING'}).count(),1);
  await spectator.locator('.dragon-chat-slot #chat-input').fill('spectator can chat during raid');
  await spectator.locator('.dragon-chat-slot #chat-input').press('Enter');
  await raider.waitForFunction(()=>PlayerApp.chatMessages.some(x=>x.text==='spectator can chat during raid'),null,{timeout:8000});
  await raider.locator('.dragon-chat-slot #chat-input').fill('raider can answer without losing turn');
  await raider.locator('.dragon-chat-slot #chat-input').press('Enter');
  await spectator.waitForFunction(()=>PlayerApp.chatMessages.some(x=>x.text==='raider can answer without losing turn'),null,{timeout:8000});
  assert.equal(await raider.locator('.dragon-arena').count(),1);
  assert.equal(await spectator.locator('.dragon-arena').count(),1);
  // Narrow-screen spectators must still reach the original composer.
  await spectator.setViewportSize({width:390,height:844});
  const narrow = await spectator.evaluate(() => {
    const input=document.querySelector('.dragon-chat-slot #chat-input');
    const dock=document.querySelector('.dragon-chat-dock');
    const a=input?.getBoundingClientRect(),b=dock?.getBoundingClientRect();
    return {visible:!!a&&a.width>0&&a.height>0,within:!!b&&b.right<=innerWidth+1&&b.left>=-1,
      inputWithin:!!a&&!!b&&a.bottom<=b.bottom+1&&a.top>=b.top-1};
  });
  assert.deepEqual(narrow,{visible:true,within:true,inputWithin:true});

  for(const page of [raider,spectator]){
   await page.evaluate(()=>DragonRaid.onState(null,Date.now()));
   assert.equal(await page.locator('#game-screen #chat-panel #chat-input').count(),1);
   assert.deepEqual(page.pageErrors,[]);
  }
  console.log('PASS real raid chat: raider and spectator exchange messages via local server; raid remains visible; chat restored');
 }finally{if(browser)await browser.close();await server.stop();}
})().catch(e=>{console.error('FAIL real raid chat',e);process.exit(1)});
