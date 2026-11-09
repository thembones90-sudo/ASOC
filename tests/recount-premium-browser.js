'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const {chromium}=require('playwright');const H=require('./lib/browser-harness');
const rows=['Denver','ChakraMaster','Rastko','MR MORGAN','Maxine the Vaccine','TheSl'].map((name,i)=>({name,rank:i<2?i+1:3,points:i===0?250:i===1?100:0,solves:i===0?2:i===1?1:0,accuracy:i===0?.03:i===1?.04:0}));
const fixture={title:'Derelicts // completed match',outcome:'LOST',topLabel:'TOP PERFORMER',topPerformers:[rows[0]],winners:[],scoreboard:rows,overall:rows.map((r,i)=>({...r,total:r.points+1000,gamesPlayed:15,average:70,movement:i===0?1:i===1?-1:null,inMatch:true})),summary:{players:6,highScore:250,totalPoints:350},satisfaction:{average:10,votes:6,historicalAverage:9.7,ratedGames:15},awards:[{id:'THE CARRY',header:'MATCH DISTINCTION',category:'distinction',playerNames:['Denver'],evidence:['2 MAJOR SOLUTIONS','250 POINTS'],commentary:'A good result // against the odds.'},{id:'STEADY HAND',header:'STATISTICAL FINDING',category:'anomaly',playerNames:['ChakraMaster'],evidence:['1 SOLUTION'],commentary:'At least someone read the clues.'}],lossFindings:[]};
(async()=>{const server=await H.startServer({port:19857});let browser;const shots=path.join(__dirname,'..','.scratch','recount-premium');fs.mkdirSync(shots,{recursive:true});try{
 browser=await chromium.launch({headless:true});
 for(const [role,width,height] of [['gm',1440,1000],['player',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});let page;
  if(role==='gm'){const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});await context.addInitScript(t=>{sessionStorage.setItem('asoc_gm_token',t);localStorage.setItem('asoc_master_token',t);},login.data.token);page=await context.newPage();await page.goto(server.base+'/index.html');await page.waitForFunction(()=>App.roomCode==='MASTER');}
  else page=await H.openHeroPage(context,server,await H.heroToken(server,'Report '+role));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(r=>Recount.apply(r,{live:true}),fixture);
  await page.locator('.recount-overlay.rc-done').waitFor();
  const text=await page.locator('.recount-overlay').innerText();assert.ok(!text.includes('//'),'normal wording throughout report');
  assert.equal(await page.locator('.rc-top-name').textContent(),'DDenver');
  assert.match(text,/Game lost/);assert.match(text,/Top Performer/);
  assert.equal(await page.locator('.rc-table').first().locator('tbody tr').count(),6);
  assert.equal(await page.locator('.rc-table').first().locator('tbody tr').first().locator('td').nth(2).textContent(),'250');
  for(const selector of ['.recount-panel','.rc-overview','.rc-awards-wrap']){const box=await page.locator(selector).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,selector+' fits viewport');}
  assert.equal(await page.locator('.recount-sub').evaluate(el=>getComputedStyle(el,'::before').content),'none');
  await page.screenshot({path:path.join(shots,role+'.png'),animations:'disabled'});
  await page.locator('.recount-close').click();assert.equal(await page.locator('.recount-overlay').count(),0);
  await page.evaluate(r=>Recount.apply(r,{live:false}),fixture);assert.equal(await page.locator('.recount-overlay').count(),0,'hydration never reopens report');
  await page.evaluate(()=>Recount.open());await page.keyboard.press('Escape');assert.equal(await page.locator('.recount-overlay').count(),0);
  const tied={...fixture,outcome:'WON',gameWon:true,topPerformers:[],winners:[rows[0],{...rows[1],points:250}],topLabel:'MATCH CO-WINNERS',awards:[]};await page.evaluate(r=>{Recount.apply(r);Recount.open();},tied);assert.match(await page.locator('.rc-top-name').textContent(),/ChakraMaster/);assert.equal(await page.locator('.rc-badge').textContent(),'Game won');
  await page.evaluate(()=>Recount.apply(null));assert.equal(await page.locator('.recount-overlay').count(),0);
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(r=>Recount.apply(r,{live:true}),fixture);await page.locator('.recount-skip').click();assert.equal(await page.locator('.rc-step:not(.is-in)').count(),0,'Show all completes reveal');await page.locator('.recount-close').click();
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS premium Recount: GM/player/mobile layouts, normal copy, exact scores, loss/top distinction, ties, skip/close, hydration and reduced motion');
}finally{if(browser)await browser.close();await server.stop();}})().catch(e=>{console.error(e);process.exitCode=1;});
