'use strict';
const assert=require('assert/strict');
const fs=require('fs');const path=require('path');
const {chromium}=require('playwright');const H=require('./lib/browser-harness');
const story='Steel holds the shape. A mirror returns it. A picture preserves it. And murder? Murder is where humans become creative. Give them blood, motive, and one convenient fool, and they will build a story around the evidence until the story becomes stronger than the truth. That is the danger of a frame. It does not change what exists. It only decides what everyone is allowed to see.';
(async()=>{
 const server=await H.startServer({port:19853});let browser;
 const shots=path.join(__dirname,'..','.scratch','aftermath-premium');fs.mkdirSync(shots,{recursive:true});
 try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await H.openHeroPage(context,server,await H.heroToken(server,'Story Reader'));const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>!!window.Skeleton);
  await page.clock.install();
  const mount=async options=>page.evaluate(({story,options})=>{window.__advanced=0;Skeleton.playAftermath({story,finalSolution:'FRAME',outcome:'WON'},{isHost:true,...options,onContinue:()=>window.__advanced++});},{story,options});
  await mount({});
  assert.equal(await page.locator('.aftermath-speed select').inputValue(),'fast');
  assert.equal(await page.locator('.aftermath-final-solution').isVisible(),false,'solution stays hidden during story');
  await page.clock.runFor(3000);
  assert.ok((await page.locator('.aftermath-story').textContent()).length>40,'fast pacing reveals text');
  await page.locator('.aftermath-speed select').selectOption('normal');
  await page.locator('.aftermath-speed select').selectOption('fast');
  await page.clock.runFor(16000);
  assert.equal(await page.locator('.aftermath-continue').isVisible(),true,'full sample finishes under 20 seconds');
  const full=await page.locator('.aftermath-story').evaluate(el=>[...el.querySelectorAll('p')].map(p=>p.textContent).join(' '));
  assert.equal(full,story,'no story text lost or rewritten');
  assert.equal(await page.locator('.aftermath-final-solution strong').textContent(),'FRAME');
  assert.equal(await page.locator('.aftermath-story p').first().textContent(),'Steel holds the shape. A mirror returns it. A picture preserves it.');
  assert.equal(await page.locator('.aftermath-closing').textContent(),'It only decides what everyone is allowed to see.');
  await page.screenshot({path:path.join(shots,'desktop.png'),animations:'disabled'});
  await page.locator('.aftermath-continue').click();assert.equal(await page.evaluate(()=>__advanced),1);
  await page.evaluate(()=>document.querySelector('.aftermath-continue').dispatchEvent(new MouseEvent('click')));assert.equal(await page.evaluate(()=>__advanced),1,'recount only advances once');
  await mount({});await page.clock.runFor(1500);await page.locator('.aftermath-complete').click();
  assert.equal(await page.locator('.aftermath-story').evaluate(el=>[...el.querySelectorAll('p')].map(p=>p.textContent).join(' ')),story);
  await page.clock.runFor(30000);assert.equal(await page.locator('.aftermath-closing').count(),1,'completion cancels pending typing');
  await mount({alreadyComplete:true});await page.clock.runFor(1);assert.equal(await page.locator('.aftermath-continue').isVisible(),true,'reconnect does not replay');
  await page.setViewportSize({width:390,height:844});await page.clock.runFor(1000);
  for(const selector of ['.aftermath-stage','.aftermath-panel','.aftermath-controls']){
   const box=await page.locator(selector).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391&&box.y>=0&&box.y+box.height<=845,`${selector} fits mobile viewport`);
  }
  await page.screenshot({path:path.join(shots,'mobile.png'),animations:'disabled'});
  await page.setViewportSize({width:320,height:568});
  for(const selector of ['.aftermath-stage','.aftermath-controls']){const box=await page.locator(selector).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=321&&box.y>=0&&box.y+box.height<=569,'small mobile layout fits');}
  await page.emulateMedia({reducedMotion:'reduce'});await mount({});await page.clock.runFor(1);assert.equal(await page.locator('.aftermath-continue').isVisible(),true,'reduced motion shows the full story immediately');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const long=Array.from({length:30},(_,i)=>`Chapter ${i+1} carries a longer piece of evidence that the Broker has chosen to preserve.`).join(' ');
  await page.evaluate(story=>Skeleton.playAftermath({story,finalSolution:'SECRET'},{isHost:false}),long);
  assert.equal(await page.locator('.aftermath-controls').count(),0,'players cannot advance the room');
  await page.clock.runFor(18000);
  await page.locator('.aftermath-story').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  await page.clock.runFor(3500);
  assert.equal(await page.locator('.aftermath-story').evaluate(el=>el.scrollTop),0,'reading earlier text suspends automatic scrolling');
  await page.evaluate(()=>Skeleton.closeAftermath());await page.clock.runFor(20000);assert.equal(await page.locator('.aftermath-overlay').count(),0,'closed sequence cannot reappear');
  assert.deepEqual(errors,[]);
  console.log('PASS premium aftermath browser: under-20s sample, intact narrative, final solution gate, GM controls, completion/reconnect, mobile fit, reduced motion and scroll preservation');
 }finally{if(browser)await browser.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
