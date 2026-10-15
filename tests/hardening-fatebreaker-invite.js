'use strict';
const assert=require('assert/strict');
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
(async()=>{
 const server=await H.startServer({port:19848});let browser;
 try{
  browser=await chromium.launch({headless:true});
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(token=>sessionStorage.setItem('asoc_gm_token',token),login.data.token);
  const gm=await context.newPage();await gm.goto(server.base+'/');await gm.waitForFunction(()=>App.roomCode==='MASTER');
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}}),mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const token=await H.heroToken(server,'Invite Alpha');
  const a=await H.openHeroPage(desktop,server,token),b=await H.openHeroPage(mobile,server,await H.heroToken(server,'Invite Beta'));
  const errors=[];for(const p of [gm,a,b]){p.on('pageerror',e=>errors.push(e.message));await p.addStyleTag({content:'#class-warning-banner{display:none!important}'});}
  for(const p of [a,b]){
   await p.locator('#casual-minigames-toggle').click();
   await p.evaluate(()=>{
    window.inviteNudges=0;const original=NudgeEffect.play;NudgeEffect.play=()=>{window.inviteNudges++;original();};
    const panel=document.createElement('div');panel.id='obscuring-panel-fixture';Object.assign(panel.style,{position:'fixed',inset:'0',zIndex:'2147483647',background:'#211a28'});document.body.append(panel);
   });
  }
  await gm.evaluate(()=>TombolaUI.open());await gm.locator('[data-tombola-action=create]').click();
  for(const p of [a,b]){
   await p.locator('#tombola-invite').waitFor({state:'visible'});
   assert.equal(await p.locator('#tombola-invite').evaluate(n=>n.matches(':modal')),true,'summon is in browser top layer');
   assert.equal(await p.locator('[data-tombola-invite-join]').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'JOIN wins hit testing above the highest app panel');
   assert.equal(await p.evaluate(()=>inviteNudges),1,'activation nudges the player');
   assert.equal(await p.locator('#tombola-overlay').isVisible(),false,'invitation does not force board open or autojoin');
   assert.match(await p.locator('[data-tombola-invite-time]').innerText(),/0\/10 PLAYERS \/\/ SIGNUP 0[12]:\d{2}/);
   const box=await p.locator('#tombola-invite').evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,zoom:getComputedStyle(document.body).zoom};});
   assert.ok(box.left>=0&&box.right<=box.width+1&&box.bottom<=box.height+1,JSON.stringify(box));
   fs.mkdirSync(path.join(H.ROOT,'.scratch','fatebreaker-invite'),{recursive:true});
   await p.locator('#tombola-invite').screenshot({path:path.join(H.ROOT,'.scratch','fatebreaker-invite',p===a?'desktop.png':'mobile.png')});
  }
  assert.equal(await gm.locator('#tombola-invite').count(),0);
  for(const p of [a,b])await p.evaluate(()=>document.getElementById('obscuring-panel-fixture').remove());
  await a.evaluate(()=>PlayerApp.send({type:'tombola:sync'}));
  assert.equal(await a.evaluate(()=>inviteNudges),1,'sync does not replay the nudge');
  await b.locator('[data-tombola-invite-dismiss]').click();await a.locator('[data-tombola-invite-view]').click();
  await a.locator('[data-tombola-action=join]').click();await a.locator('[data-tombola-action=leave]').waitFor();
  assert.equal(await a.locator('#tombola-invite').count(),0,'joined players no longer invited');assert.equal(await b.locator('#tombola-invite').count(),0,'dismissal survives other joins');
  // Reload with an open lobby: server hydration must show an actionable invite.
  await b.reload();await b.locator('#game-screen.active').waitFor();await b.locator('[data-tombola-invite-join]').waitFor();
  await b.locator('[data-tombola-invite-join]').click();await b.locator('[data-tombola-action=leave]').waitFor();
  assert.equal(await b.locator('#tombola-invite').count(),0);
  await gm.locator('[data-tombola-action=cancel]').click();await gm.locator('[data-tombola-action=create]').waitFor();
  for(const p of [a,b])assert.equal(await p.locator('#tombola-invite').count(),0);
  await gm.locator('[data-tombola-action=create]').click();
  for(const p of [a,b])await p.locator('#tombola-invite').waitFor({state:'visible'});
  assert.equal(await a.evaluate(()=>inviteNudges),2,'a fresh lobby nudges again');
  await a.locator('[data-tombola-invite-join]').click();await a.locator('[data-tombola-action=leave]').waitFor();
  await b.locator('[data-tombola-invite-join]').click();await b.locator('[data-tombola-action=leave]').waitFor();
  await gm.locator('[data-tombola-action=start]').click();await a.waitForFunction(()=>document.querySelector('.tombola-turn')?.textContent.includes('CYCLE'));
  await a.reload();await a.locator('#game-screen.active').waitFor();assert.equal(await a.locator('#tombola-invite').count(),0,'no signup invite after game starts');
  // Expiry is server-clock based, even if the local clock is skewed.
  await b.evaluate(()=>TombolaUI.onMessage({type:'tombola:state',state:{id:'expired-fixture',phase:'LOBBY',signupEndsAt:Date.now()+599000,serverNow:Date.now()+600000,participants:[],viewer:{canJoin:true}}}));
  assert.equal(await b.locator('#tombola-invite').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS FATEBREAKER invitations: already-connected desktop/mobile players, visible signup clock, no autojoin, dismissal, live joins, reload hydration, fresh-round reinvite, cancellation/start removal, server-clock expiry, no console errors');
 }finally{await browser?.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
