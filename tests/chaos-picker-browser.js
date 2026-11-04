"use strict";
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
(async()=>{
 const server=await H.startServer({port:19855});let browser;
 try {
  browser=await chromium.launch({headless:true});
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(token=>sessionStorage.setItem('asoc_gm_token',token),login.data.token);
  const gm=await context.newPage(),errors=[];gm.on('pageerror',e=>errors.push(e.message));
  await gm.goto(server.base+'/');await gm.waitForFunction(()=>App.roomCode==='MASTER');
  const a=await H.openHeroPage(await browser.newContext(),server,await H.heroToken(server,'Chaos Alpha'));
  const b=await H.openHeroPage(await browser.newContext(),server,await H.heroToken(server,'Chaos Beta'));
  for(const name of ['Chavez','Comrade Alex','Denver','Maxine the Vaccine','MR MORGAN','Rastko','TheSl','A Very Long Little Hero Name'])await H.heroToken(server,name);
  const pill=await gm.locator('#chaos-gm-button').boundingBox();
  await gm.locator('#chaos-gm-button').click();await gm.locator('[data-chaos-id]').first().waitFor();
  const panel=gm.locator('#chaos-picker');await panel.locator('.chaos-picker-art').evaluate(async n=>{
   const url=getComputedStyle(n).backgroundImage.match(/url\(["']?([^"')]+)/)[1];const i=new Image();i.src=url;await i.decode();
  });
  assert.match(await panel.locator('[data-chaos-chance]').textContent(),/51%/);
  await panel.locator('[data-chaos-tool="online"]').click();
  assert.equal(await panel.locator('[aria-pressed="true"][data-chaos-id]').count(),2);
  assert.match(await panel.locator('[data-chaos-selection]').innerText(),/2 players selected/);
  assert.match(await panel.locator('[data-chaos-selection]').innerText(),/20 SC/);
  const shots=path.join(H.ROOT,'.scratch','chaos-ui-review');fs.mkdirSync(shots,{recursive:true});
  for(const [name,width,height,zoom] of [['desktop',1440,1000,1],['compact',1280,720,1.35],['mobile',390,844,1],['short',844,440,1]]){
   await gm.setViewportSize({width,height});await gm.evaluate(z=>{document.body.style.zoom=String(z);window.dispatchEvent(new Event('resize'));},zoom);
   const bounds=await panel.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,JSON.stringify({name,bounds,width,height}));
   assert.equal(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,name+' has no horizontal overflow');
   await panel.screenshot({path:path.join(shots,name+'.png')});
  }
  await gm.setViewportSize({width:1440,height:1000});await gm.evaluate(()=>{document.body.style.zoom='1';window.dispatchEvent(new Event('resize'));});
  const after=await gm.locator('#chaos-gm-button').boundingBox();assert.equal(after.width,pill.width);assert.equal(after.height,pill.height,'sidebar pill dimensions stay unchanged');
  await panel.locator('[data-chaos-tool="clear"]').click();
  await panel.locator('.chaos-picker-search').fill('Chaos Alpha');assert.equal(await panel.locator('[data-chaos-id]').count(),1);
  await panel.locator('[data-chaos-id]').click();await panel.locator('.chaos-picker-search').fill('');
  await panel.locator('[data-chaos-preset-for="target"] [data-chaos-preset="90"]').click();
  await panel.locator('[data-chaos-preset-for="coins"] [data-chaos-preset="25"]').click();
  assert.match(await panel.locator('[data-chaos-chance]').textContent(),/11%/);
  await panel.locator('[data-chaos-target]').fill('1');assert.equal(await panel.locator('[data-chaos-cast]').isDisabled(),true);
  await panel.locator('[data-chaos-target]').fill('90');
  await panel.locator('[data-chaos-cast]').click();assert.match(await panel.locator('[data-chaos-cast]').textContent(),/CONFIRM/);
  await panel.screenshot({path:path.join(shots,'confirmation.png')});
  await panel.locator('[data-chaos-cast]').click();await panel.waitFor({state:'hidden'});
  await a.locator('[data-chaos-accept]').waitFor();assert.equal(await b.locator('[data-chaos-accept]').count(),0,'only selected player is offered the wager');
  const saved=JSON.parse(fs.readFileSync(path.join(server.dataDir,'active-rooms.json'),'utf8')).rooms[0];
  const offer=Object.values(saved.chaos.entries).find(e=>e.status==='offered');assert.equal(offer.target,90);assert.equal(offer.coins,25);
  await gm.locator('#chaos-gm-button').click();await panel.locator('[data-chaos-id]').first().waitFor();
  const busy=panel.locator('[data-chaos-id="'+offer.playerId+'"]');assert.equal(await busy.isDisabled(),true,'busy player cannot be offered another wager');
  await gm.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS CHAOS picker: artwork, desktop/mobile/zoom/short viewport, unchanged pill, selection/search/presets, odds/validation, two-step confirmation, real server delivery and busy-player guard');
 }finally{await browser?.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
