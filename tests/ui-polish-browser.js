"use strict";
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright'),H=require('./lib/browser-harness');
(async()=>{
 const server=await H.startServer({port:19858});let browser;
 try{
  browser=await chromium.launch({headless:true});
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.addInitScript(t=>sessionStorage.setItem('asoc_gm_token',t),login.data.token);
  const gm=await ctx.newPage(),errors=[];gm.on('pageerror',e=>errors.push(e.message));
  await gm.goto(server.base+'/');await gm.waitForFunction(()=>App.roomCode==='MASTER');
  const hero=await H.openHeroPage(await browser.newContext(),server,await H.heroToken(server,'Polish Alpha'));
  const beta=await H.openHeroPage(await browser.newContext(),server,await H.heroToken(server,'Polish Beta'));
  const heroId=await hero.evaluate(()=>PlayerApp.playerId);
  for(const name of ['ChakraMaster','Chavez','Comrade Alex','Denver','Maxine the Vaccine','Rastko'])await H.heroToken(server,name);
  const shots=path.join(H.ROOT,'.scratch','ui-polish-review');fs.mkdirSync(shots,{recursive:true});
  const pill=await gm.locator('#poison-gm-button').boundingBox();
  await gm.locator('#poison-gm-button').click();const poison=gm.locator('#poison-target-picker');
  await poison.locator('[data-poison-target-id]').first().waitFor();
  await poison.locator(`[data-poison-target-id="${heroId}"]`).click();
  await poison.locator('[data-poison-cast]').click();await poison.locator('[data-poison-cast]').click();await poison.waitFor({state:'hidden'});
  await hero.locator('[data-poison-roll]').waitFor();
  await gm.locator('#poison-gm-button').click();await poison.locator('[data-poison-target-id]').first().waitFor();
  await poison.locator(`[data-poison-target-id="${heroId}"]`).click();
  assert.equal(await poison.locator('[data-poison-cure]').isEnabled(),true);
  assert.match(await poison.locator('[data-poison-selection]').innerText(),/1 eligible for cure/);
  await gm.waitForFunction(()=>!document.querySelector('.poison-cast-toast'));
  await poison.screenshot({path:path.join(shots,'poison-desktop.png')});
  for(const [name,width,height,zoom] of [['mobile',390,844,1],['zoom',1280,720,1.3]]){
   await gm.setViewportSize({width,height});await gm.evaluate(z=>{document.body.style.zoom=z;window.dispatchEvent(new Event('resize'));},zoom);
   const box=await poison.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify(box));
   await poison.screenshot({path:path.join(shots,'poison-'+name+'.png')});
  }
  await gm.setViewportSize({width:1440,height:1000});await gm.evaluate(()=>{document.body.style.zoom=1;window.dispatchEvent(new Event('resize'));});
  const after=await gm.locator('#poison-gm-button').boundingBox();assert.equal(after.width,pill.width);assert.equal(after.height,pill.height);
  await poison.locator('[data-poison-cure]').click();await gm.waitForFunction(id=>!document.querySelector(`[data-poison-target-id="${id}"] .poison-tag`),heroId);
  await hero.waitForFunction(()=>document.querySelector('#poison-player-overlay')?.hidden!==false);
  await poison.locator('.poison-picker-close').click();
  // Use representative deal states for visual review; transactional acceptance is covered by the real wire suite.
  await gm.evaluate(()=>BlackMarket.open());await gm.waitForTimeout(200);
  await gm.evaluate(()=>{
   const base={category:'CUSTOM',playerName:'Polish Alpha',tributeRequired:true,tributeLevel:10,request:'FATEBREAKER // Field 36',terms:'Payment is due to the Reliquary.',demandedAt:Date.now(),seenAt:Date.now(),createdAt:Date.now(),updatedAt:Date.now()};
   BlackMarket.pacts=[{...base,id:'review',title:'BLOOD TRIBUTE REQUIRED',state:'TRIBUTE_SUBMITTED',tributeImageData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='},{...base,id:'rejected',playerName:'Polish Beta',title:'BLOOD TRIBUTE REQUIRED',state:'TRIBUTE_REJECTED',verdictComment:'Please submit a replacement.'},{...base,id:'complete',playerName:'ChakraMaster',title:'BLOOD TRIBUTE REQUIRED',state:'FULFILLED',tributeId:'receipt',fulfilledAt:Date.now(),verdictComment:'Accepted.'}];BlackMarket.render();
  });
  const market=gm.locator('.black-market-room');
  assert.equal(await market.locator('[data-pact="complete"]').getAttribute('open'),null);
  await market.locator('[data-pact="rejected"] .bm-pact-details>summary').click();
  await gm.evaluate(()=>BlackMarket.render());assert.equal(await market.locator('[data-pact="rejected"] .bm-pact-details').getAttribute('open'),'');
  await market.locator('[data-pact="rejected"] .bm-pact-details>summary').click();
  await market.evaluate(n=>{n.scrollTop=0;const body=n.querySelector('#black-market-body');if(body)body.scrollTop=0;});
  await market.screenshot({path:path.join(shots,'black-market-desktop.png')});
  await gm.setViewportSize({width:390,height:844});
  assert.equal(await market.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'market has no horizontal overflow on phone');
  await market.screenshot({path:path.join(shots,'black-market-mobile.png')});
  await market.locator('[data-bm-close]').click();await gm.setViewportSize({width:1440,height:1000});
  await hero.locator('#chat-input').fill('Public toolbar visual fixture');await hero.locator('#chat-input').press('Enter');
  const message=gm.locator('#gm-chat-messages .gm-chat-message').filter({hasText:'Public toolbar visual fixture'}).first();await message.waitFor();await message.hover();
  await gm.locator('#asoc-message-toolbar [data-action="reply"]').click();assert.match(await gm.evaluate(()=>App.getGMComposerText()),/Polish Alpha/);
  await gm.evaluate(()=>App.setGMComposerText(''));await message.hover();await gm.locator('#asoc-message-toolbar [data-action="react"]').click();
  await gm.locator('#gm-chat-reaction-picker').waitFor({state:'visible'});await gm.keyboard.press('Escape');
  await message.hover();await gm.screenshot({path:path.join(shots,'chat-toolbar.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS UI polish: real Poison cast/cure, artwork and selection summary, mobile/zoom fit, unchanged pills, compact/persistent Black Market details, public reply/reaction toolbar');
 }finally{await browser?.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
