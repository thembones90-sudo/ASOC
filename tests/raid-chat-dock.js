'use strict';
const { chromium } = require('playwright');
const path = require('path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const gm of [false,true]) {
      const page = await browser.newPage();
      await page.setViewportSize({width:1440,height:900});
      await page.setContent(gm
        ? '<body class="room-mode-battle"><main><div id="origin"><section class="gm-module-chat"><div class="gm-chat-panel"><div class="gm-chat-header">FULL CONSOLE HEADER</div><div class="gm-chat-search-strip">SEARCH</div><div id="gm-chat-messages" class="gm-chat-messages"><article class="gm-chat-message gm-flow-message"><div class="gm-chat-avatar-rail"></div><div class="gm-chat-message-main"><div class="gm-chat-flow-header">HERO</div><div class="gm-chat-message-text">Compact raid transmission.</div></div></article><article class="gm-chat-message gm-flow-message"><div class="gm-chat-avatar-rail"></div><div class="gm-chat-message-main"><div class="gm-chat-flow-header">HERO</div><div class="gm-chat-message-text">A second compact transmission.</div></div></article></div><div id="gm-latest-readout">READOUT</div><div id="gm-broker-bar"><input id="message" /></div></div></section></div></main></body>'
        : '<main><div id="origin"><div id="chat-panel"><input id="message" /></div></div></main>');
      await page.evaluate(isGm => {
        if (isGm) window.App = {send:()=>{}};
        else window.PlayerApp = {playerId:'spectator',send:()=>{}};
        document.getElementById('message').addEventListener('input',()=>window.chatEvents=(window.chatEvents||0)+1);
      }, gm);
      await page.addStyleTag({path:path.join(__dirname,'..','css','asoc.css')});
      await page.addStyleTag({path:path.join(__dirname,'..','css','dragon-raid.css')});
      await page.addScriptTag({path:path.join(__dirname,'..','js','dragon-raid.js')});
      await page.evaluate(() => {
        const raid=window.DragonRaid;
        const overlay=raid.ensureOverlay();
        raid.syncChatDock(overlay,true);
      });
      assert.equal(await page.locator('.dragon-chat-slot #message').count(),1);
      assert.equal(await page.locator('.dragon-chat-dock').evaluate(el=>getComputedStyle(el).display),'none');
      const arenaWidthClosed=await page.locator('.dragon-raid-shell').evaluate(el=>el.getBoundingClientRect().width);
      await page.locator('.dragon-chat-open').click();
      assert.equal(await page.locator('.dragon-chat-dock').evaluate(el=>getComputedStyle(el).display),'flex');
      const geometry=await page.evaluate(isGm=>{
        const shell=document.querySelector('.dragon-raid-shell').getBoundingClientRect();
        const dock=document.querySelector('.dragon-chat-dock').getBoundingClientRect();
        const rows=[...document.querySelectorAll('.dragon-chat-slot #gm-chat-messages > *')].map(el=>el.getBoundingClientRect().height);
        return {shellWidth:shell.width,dockWidth:dock.width,dockRight:dock.right,viewport:innerWidth,
          rows,fullHeader:isGm?getComputedStyle(document.querySelector('.dragon-chat-slot .gm-chat-header')).display:null};
      },gm);
      assert.ok(Math.abs(geometry.shellWidth-arenaWidthClosed)<1,'opening chat must not resize the raid arena');
      assert.ok(geometry.dockWidth<=341,'raid chat remains a compact fixed-width dock');
      assert.ok(geometry.dockRight<=geometry.viewport,'raid chat stays inside the viewport');
      if(gm){
        assert.equal(geometry.fullHeader,'none','full GM navigation chrome is hidden inside raids');
        assert.ok(geometry.rows.every(height=>height>0&&height<80),'GM message rows remain content-height');
      }
      await page.locator('[data-dragon-action="chat-toggle"]').first().click();
      assert.equal(await page.locator('.dragon-chat-dock').evaluate(el=>getComputedStyle(el).display),'none');
      await page.locator('.dragon-chat-open').click();
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
