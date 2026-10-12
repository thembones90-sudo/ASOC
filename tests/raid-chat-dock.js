'use strict';
const { chromium } = require('playwright');
const path = require('path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const gm of [false,true]) {
      const page = await browser.newPage();
      await page.setContent(gm
        ? '<main><div id="origin"><div class="gm-chat-panel"><input id="message" /></div></div></main>'
        : '<main><div id="origin"><div id="chat-panel"><input id="message" /></div></div></main>');
      await page.evaluate(isGm => {
        if (isGm) window.App = {send:()=>{}};
        else window.PlayerApp = {playerId:'spectator',send:()=>{}};
        document.getElementById('message').addEventListener('input',()=>window.chatEvents=(window.chatEvents||0)+1);
      }, gm);
      await page.addStyleTag({path:path.join(__dirname,'..','css','dragon-raid.css')});
      await page.addScriptTag({path:path.join(__dirname,'..','js','dragon-raid.js')});
      await page.evaluate(() => {
        const raid=window.DragonRaid;
        const overlay=raid.ensureOverlay();
        raid.syncChatDock(overlay,true);
      });
      assert.equal(await page.locator('.dragon-chat-slot #message').count(),1);
      assert.equal(await page.locator('.dragon-chat-dock').evaluate(el=>getComputedStyle(el).display),'flex');
      await page.locator('[data-dragon-action="chat-toggle"]').first().click();
      assert.equal(await page.locator('.dragon-chat-dock').evaluate(el=>getComputedStyle(el).display),'none');
      await page.locator('.dragon-chat-open').click();
      assert.equal(await page.locator('.dragon-chat-dock').evaluate(el=>getComputedStyle(el).display),'flex');
      // Same raid snapshot must not replace the arena; changed state must.
      const idempotent = await page.evaluate(() => {
        const r=window.DragonRaid;
        r.raid={id:'test',phase:'HERO_TURN',boss:{id:'wendigo'},participants:[]};
        r.battleHTML=()=>'<div class="arena-probe">same</div>';
        r.layoutParty=()=>{};
        r.updateActiveLane=()=>{};
        r.render();
        const first=document.querySelector('.arena-probe');
        r.render();
        const kept=first===document.querySelector('.arena-probe');
        r.battleHTML=()=>'<div class="arena-probe">changed</div>';
        r.render();
        const changed=first!==document.querySelector('.arena-probe');
        return {kept,changed};
      });
      assert.deepEqual(idempotent,{kept:true,changed:true});
      // A repeated server snapshot should update clock synchronization without
      // rebuilding the arena or disturbing the chat input.
      const repeat = await page.evaluate(() => {
        const r=window.DragonRaid;
        r.onState({id:'echo',phase:'HERO_TURN',boss:{id:'wendigo'},participants:[]},Date.now());
        const first=document.querySelector('.arena-probe');
        r.onState({id:'echo',phase:'HERO_TURN',boss:{id:'wendigo'},participants:[]},Date.now()+1000);
        return first===document.querySelector('.arena-probe');
      });
      assert.equal(repeat,true,'identical server echoes preserve arena DOM');

      await page.locator('.dragon-chat-slot #message').fill('chat works');
      assert.equal(await page.evaluate(()=>window.chatEvents),1);
      await page.evaluate(()=>window.DragonRaid.syncChatDock(document.getElementById('dragon-raid-overlay'),false));
      assert.equal(await page.locator('#origin #message').count(),1);
      await page.locator('#origin #message').fill('still works');
      assert.equal(await page.evaluate(()=>window.chatEvents),2);
      await page.close();
    }
    console.log('raid chat relocation tests: PASS player and GM, event listeners preserved, restored');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
