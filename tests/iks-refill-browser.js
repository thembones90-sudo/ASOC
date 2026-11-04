'use strict';
const assert=require('assert/strict');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
(async()=>{
 const server=await H.startServer({port:19849});let browser;
 try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  await context.addInitScript(t=>{sessionStorage.setItem('asoc_gm_token',t);localStorage.setItem('asoc_master_token',t);},login.data.token);
  const gm=await context.newPage();await gm.goto(server.base+'/index.html');
  await gm.waitForFunction(()=>App.roomCode==='MASTER'&&App.mode==='multiplayer');
  const hero=await H.openHeroPage(await browser.newContext(),server,await H.heroToken(server,'Refill Hero'));
  const other=await H.openHeroPage(await browser.newContext(),server,await H.heroToken(server,'Other Hero'));
  const id=await hero.evaluate(()=>PlayerApp.playerId);
  await gm.waitForFunction(()=>App.currentPlayers?.length>=2);
  await gm.evaluate(()=>App.send({type:'gm:iksMaxHealth',value:1}));
  await gm.waitForFunction(()=>App.iksArena?.maxHealth===1);
  await gm.evaluate(id=>App.send({type:'threefold:challenge',opponentId:id}),id);
  await hero.waitForFunction(()=>Threefold.challenge?.id);
  await hero.evaluate(()=>PlayerApp.send({type:'threefold:accept',challengeId:Threefold.challenge.id}));
  await gm.waitForFunction(()=>GMMinigames.game?.id);
  const gmCells=[0,1,2],heroCells=[3,4,6];
  for(let i=0;i<6;i++){
   const game=await gm.evaluate(()=>GMMinigames.game);if(game.complete)break;
   const page=game.turnId==='__GM__'?gm:hero;
   const cell=(page===gm?gmCells:heroCells).shift();
   await page.evaluate(({id,cell})=>(window.App||window.PlayerApp).send({type:'threefold:move',gameId:id,cell}),{id:game.id,cell});
   await gm.waitForFunction(cell=>GMMinigames.game?.board[cell],cell);
  }
  await gm.waitForFunction(id=>App.currentPlayers.some(p=>p.id===id&&p.iksEliminated),id);
  await gm.evaluate(()=>GMMinigames.openChooser());
  const refill=gm.locator(`[data-gm-iks-refill="${id}"]`);
  assert.equal(await refill.isEnabled(),true,'fallen heroes can be refilled');
  assert.equal(await gm.locator(`[data-gm-opponent="${id}"]`).isDisabled(),true);
  const otherBefore=await gm.evaluate(id=>App.currentPlayers.filter(p=>p.id!==id).map(p=>[p.id,p.iksHealth]),id);
  await refill.click();
  await gm.waitForFunction(id=>App.currentPlayers.some(p=>p.id===id&&p.iksHealth===1&&!p.iksEliminated),id);
  await gm.locator(`[data-gm-opponent="${id}"]:enabled`).waitFor();
  assert.deepEqual(await gm.evaluate(id=>App.currentPlayers.filter(p=>p.id!==id).map(p=>[p.id,p.iksHealth]),id),otherBefore);
  await hero.waitForFunction(id=>PlayerApp.currentPlayers?.some(p=>p.id===id&&p.iksHealth===1),id);
  await gm.reload();await gm.waitForFunction(()=>App.roomCode==='MASTER');
  await gm.waitForFunction(id=>App.currentPlayers?.some(p=>p.id===id&&p.iksHealth===1&&!p.iksEliminated),id);
  await gm.evaluate(()=>GMMinigames.openChooser());
  await gm.setViewportSize({width:390,height:844});
  assert.equal(await gm.locator(`[data-gm-iks-refill="${id}"]`).isVisible(),true);
  console.log('PASS individual IKS refill browser: real loss/elimination, clickable fallen-player refill, configured maximum, unchanged opponents, broadcast and refresh');
 }finally{if(browser)await browser.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});

