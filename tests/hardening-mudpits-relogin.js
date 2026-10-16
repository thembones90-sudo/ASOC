'use strict';
const assert=require('assert/strict');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
(async()=>{
 const server=await H.startServer({port:19849,env:{NODE_ENV:'test',ASOC_MUD_PITS_WRITE_MS:'1500',ASOC_MUD_PITS_READ_MS:'100',ASOC_MUD_PITS_VOTE_MS:'300'}});let browser;
 try{
  browser=await chromium.launch({headless:true});
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  const gmContext=await browser.newContext();await gmContext.addInitScript(t=>sessionStorage.setItem('asoc_gm_token',t),login.data.token);
  const gm=await gmContext.newPage();await gm.goto(server.base+'/');await gm.waitForFunction(()=>App.roomCode==='MASTER');
  const token=await H.heroToken(server,'Mud Relog Hero');
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const hero=await H.openHeroPage(context,server,token),errors=[];hero.on('pageerror',e=>errors.push(e.message));
  const id=await hero.evaluate(()=>PlayerApp.playerId);
  await gm.evaluate(id=>App.send({type:'mudpits:start',contestantIds:['__GM__',id]}),id);
  await hero.locator('#player-mudpits-root:not([hidden]) textarea').waitFor();
  await hero.locator('[data-mudpits-dismiss]').waitFor();
  assert.match(await hero.locator('#player-mudpits-root').innerText(),/RESULT/,'fresh live verdict still appears');
  await hero.locator('[data-mudpits-dismiss]').click();assert.equal(await hero.locator('#player-mudpits-root').isHidden(),true);
  await hero.reload();await hero.locator('#game-screen.active').waitFor();
  await hero.waitForFunction(()=>document.getElementById('player-mudpits-root')?._mudState?.phase==='RESULT');
  assert.equal(await hero.locator('#player-mudpits-root').isHidden(),true,'completed verdict never pops on reload');
  await hero.evaluate(()=>PlayerApp.send({type:'mudpits:sync'}));
  assert.equal(await hero.locator('#player-mudpits-root').isHidden(),true);
  const freshContext=await browser.newContext();
  const fresh=await H.openHeroPage(freshContext,server,token);
  fresh.on('pageerror',e=>errors.push(e.message));
  await fresh.waitForFunction(()=>document.getElementById('player-mudpits-root')?._mudState?.phase==='RESULT');
  assert.equal(await fresh.locator('#player-mudpits-root').isHidden(),true,'fresh login without dismissal storage stays quiet');
  await gm.evaluate(id=>App.send({type:'mudpits:start',contestantIds:['__GM__',id]}),id);
  await fresh.locator('#player-mudpits-root:not([hidden]) textarea').waitFor();
  await fresh.locator('[data-mudpits-dismiss]').waitFor();
  assert.equal(await fresh.locator('#player-mudpits-root').isVisible(),true,'next live duel is not suppressed');
  await fresh.evaluate(()=>PlayerApp.send({type:'mudpits:sync'}));
  await fresh.waitForFunction(()=>document.getElementById('player-mudpits-root').hidden);
  assert.equal(await fresh.locator('#player-mudpits-root').isHidden(),true,'terminal sync suppresses verdict even in an existing document');
  // Cancellation is terminal history too, while restored active duels remain usable.
  await hero.evaluate(()=>{
   const node=document.createElement('div');node.id='mud-history-fixture';document.body.append(node);
   const old=document.getElementById('player-mudpits-root')._mudState;
   MudPitsUI.render({...old,id:'cancelled-fixture',phase:'CANCELLED'},node);
  });
  assert.equal(await hero.locator('#mud-history-fixture').isHidden(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS MUD PITS relog: live verdict visible, dismissal, real reload/server hydration and fresh login quiet, repeat sync quiet, next live duel visible, restored cancelled verdict quiet; no console errors');
 }finally{await browser?.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
