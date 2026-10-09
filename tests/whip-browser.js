'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
(async()=>{
 const fixture=path.resolve('A:\\ASOC ENGINE\\.scratch\\whip-browser-fixture.html');
 fs.writeFileSync(fixture,'<html><head><meta charset="utf-8"><link rel="stylesheet" href="../css/whip.css"></head><body><script src="../js/whip.js"></script></body></html>');
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:850}});
  await page.goto('file:///'+fixture.replace(/\\/g,'/'));
  const msg={type:'whip:impact',actorId:'a',actorName:'The Attacker',targetId:'b',targetName:'The Victim',actorAvatarData:'',targetAvatarData:'',victimId:'b',hijacked:false,line:'BACK TO WORK, THE VICTIM!',timestamp:Date.now()};
  await page.evaluate(m=>window.AsocWhip.onMessage(m,'b',false),msg);
  assert.equal(await page.locator('#asoc-whip-effect.asoc-whip-victim').count(),1);
  assert((await page.locator('#asoc-whip-effect').innerText()).includes('BACK TO WORK'));
  assert.equal(await page.locator('.asoc-whip-lash svg path').count(),1);
  const reversed={...msg,hijacked:true,victimId:'a',line:'THE WHIP HAS CHANGED HANDS!'};
  await page.evaluate(m=>window.AsocWhip.onMessage(m,'a',false),reversed);
  assert.equal(await page.locator('#asoc-whip-effect.asoc-whip-victim.is-hijacked').count(),1);
  assert((await page.locator('.asoc-whip-kicker').innerText()).includes('HIJACK'));
  assert((await page.locator('.asoc-whip-actor').innerText()).includes('The Victim'));
  assert((await page.locator('.asoc-whip-target').innerText()).includes('The Attacker'));
  await page.evaluate(m=>window.AsocWhip.onMessage(m,null,true),msg);
  assert.equal(await page.locator('#asoc-whip-effect.asoc-whip-observer').count(),1);
  await page.evaluate(m=>window.AsocWhip.onMessage(m,'x',false),msg);
  assert.equal(await page.locator('#asoc-whip-effect.asoc-whip-observer').count(),1);
  console.log('WHIP_BROWSER_PASS: animation, normal victim, hijack reversal, GM and spectator scaling');
 } finally {await browser.close();fs.unlinkSync(fixture)}
})().catch(err=>{console.error(err.stack);process.exit(1)});
