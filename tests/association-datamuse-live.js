'use strict';
// Opt-in: makes two real Datamuse requests via a local ASOC server, never production.
if(process.env.ASOC_TEST_DATAMUSE_LIVE!=='1'){console.log('SKIP Datamuse live smoke (ASOC_TEST_DATAMUSE_LIVE=1 to enable)');process.exit(0);}
const assert=require('assert/strict');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
(async()=>{
 const server=await H.startServer({port:19851});let browser;
 try{
  browser=await chromium.launch({headless:true});
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(t=>sessionStorage.setItem('asoc_gm_token',t),login.data.token);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.base+'/');await page.waitForFunction(()=>App.roomCode==='MASTER');
  await page.addStyleTag({content:'#class-warning-banner{display:none!important}'});
  await page.evaluate(async()=>{await Forge.open();Forge.openCreator(null,true);});
  await page.locator('[data-creator-field=finalSolution]').fill('PHASE');await page.locator('.association-forge summary').click();
  await page.locator('[data-association-fetch]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-association-fetch]').disabled);
  assert.equal(await page.locator('.association-error').count(),0,await page.locator('[data-association-status]').innerText());
  const associated=await page.locator('.association-chip b').allTextContents();assert.ok(associated.length>=4,'PHASE returns at least four real associated single words');
  for(let i=0;i<4;i++)await page.locator('.association-chip').nth(i).click();
  for(const [i,col]of ['A','B','C','D'].entries())await page.locator(`[data-association-assign=${col}][data-word="${associated[i]}"]`).click();
  assert.equal(await page.locator('[data-creator-field=finalSolution]').inputValue(),'PHASE');
  for(const [i,col]of ['A','B','C','D'].entries()){assert.equal(await page.locator(`[data-creator-field=${col}5]`).inputValue(),associated[i]);assert.ok((await page.locator('#creator-board').innerText()).includes(associated[i]));}
  const board=await page.evaluate(()=>JSON.stringify(Forge.editingGame));
  await H.sleep(1600);
  await page.locator('[data-association-query-mode]').selectOption('means_like');await page.locator('[data-association-fetch]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-association-fetch]').disabled);
  assert.equal(await page.locator('.association-error').count(),0,await page.locator('[data-association-status]').innerText());
  const meansLike=await page.locator('.association-chip b').allTextContents();assert.ok(meansLike.length>0);
  assert.equal(await page.evaluate(()=>JSON.stringify(Forge.editingGame)),board,'real second-mode lookup preserves assigned board');
  await page.locator('[data-association-query-mode]').selectOption('associated');await page.locator('[data-association-fetch]').click();
  await page.waitForFunction(()=>document.querySelector('[data-association-status]').textContent.includes('CACHED'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS live Datamuse through GM creator → authenticated ASOC API → real upstream → normalized results → four board assignments/preview; second mode/cache; no key',word:'PHASE',associatedCount:associated.length,associatedSample:associated.slice(0,6),meansLikeCount:meansLike.length,meansLikeSample:meansLike.slice(0,6)}));
 }finally{await browser?.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
