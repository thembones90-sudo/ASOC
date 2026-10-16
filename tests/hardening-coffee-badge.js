'use strict';
const assert=require('assert/strict');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
(async()=>{
 const server=await H.startServer({port:19850});let browser;
 try{
  browser=await chromium.launch({headless:true});
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:900}});
   const hero=await H.openHeroPage(context,server,await H.heroToken(server,'Coffee Badge '+width));
   const errors=[];hero.on('pageerror',e=>errors.push(e.message));
   await hero.clock.install();
   await hero.evaluate(()=>AsocCoffee.show({durationMs:8000}));
   const cup=await hero.locator('.asoc-coffee-cup').boundingBox();
   await hero.mouse.click(cup.x+cup.width/2,cup.y+cup.height/2);
   const badge=hero.locator('#hero-hud-identity .asoc-coffee-name-badge');
   await badge.waitFor({state:'visible'});
   assert.match(await hero.locator('.asoc-coffee-footer').innerText(),/BADGE ACTIVE.*30 SECONDS/);
   assert.match(await badge.getAttribute('title'),/only to you/);
   await hero.evaluate(()=>PlayerApp.updatePlayerLeaderboard(PlayerApp.currentPlayers));
   await badge.waitFor({state:'visible'});
   assert.equal(await badge.count(),1,'redraw does not duplicate the visible badge');
   await hero.clock.fastForward(31000);
   assert.equal(await hero.locator('.asoc-coffee-name-badge').count(),0,'badge expires after 30 seconds');
   await hero.evaluate(()=>PlayerApp.updatePlayerLeaderboard(PlayerApp.currentPlayers));
   assert.equal(await hero.locator('.asoc-coffee-name-badge').count(),0,'observer stops restoring badge after expiry');
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS coffee badge: real desktop/mobile player, cup click, visible identity badge and confirmation, roster redraw, no duplicates, 30-second expiry and observer cleanup, no console errors');
 }finally{await browser?.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
