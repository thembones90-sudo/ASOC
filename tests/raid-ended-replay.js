'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
const engine = require('../dragon-raid');
const { createDragonRaidService } = require('../dragon-raid-server');

function fixture() {
  const r = engine.createRaid(Date.now(), 'wendigo');
  for (const [i, role] of ['tank', 'heal', 'dps'].entries()) engine.join(r, { id: 'p' + i, name: 'Hero ' + i }, role);
  engine.startBattle(r, Date.now());
  r.phase = 'COMPLETE'; r.round = 8;
  r.loot = { total: 209, shares: { p0: 70, p1: 70, p2: 69 }, survivors: ['p0', 'p1', 'p2'] };
  r.heart = { winnerId: 'p1', winnerName: 'Hero 1', contenders: ['p0', 'p1', 'p2'], rolls: {}, history: [], round: 1 };
  r.result = { outcome: 'VICTORY', at: Date.now() };
  return engine.publicView(r);
}
(async () => {
  // The production service must label mutations, not just snapshots, as live.
  const frames = [];
  const service = createDragonRaidService({ broadcastToRoom: (_room, frame) => frames.push(frame), broadcastPlayersUpdate() {}, sendToWs() {},
    playerStore: {}, coinAccount: () => null, triggerMegabonk: () => ({ ok: true }) });
  const room = { dragonRaid: engine.createRaid(Date.now(), 'wendigo') };
  assert.ok(service.abort(room).ok);
  assert.equal(frames[0].live, true);
  assert.equal(frames[0].raid.phase, 'ABORTED');
  const server = await H.startServer({ port: 19866 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [role, width] of [['gm', 1440], ['participant', 1440], ['spectator', 1440], ['participant', 390]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/raid-replay-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><link rel="stylesheet" href="/css/dragon-raid.css"></head><body><main id="origin">${role === 'gm' ? '<section class="gm-module-chat"><div class="gm-chat-panel"><input id="message"></div></section>' : '<div id="chat-panel"><input id="message"></div>'}</main><script>${role === 'gm' ? 'window.App={send(){}};' : `window.PlayerApp={playerId:'${role === 'participant' ? 'p0' : 'watcher'}',send(){}};`}</script><script src="/js/dragon-raid.js"></script></body></html>` }));
      await page.addInitScript(ended => {
        window.terminalFlashes = 0;
        window.addEventListener('DOMContentLoaded', () => {
          const observer = new MutationObserver(() => {
            const overlay = document.getElementById('dragon-raid-overlay');
            if (overlay && !overlay.hidden && ['COMPLETE', 'FAILED', 'ABORTED'].includes(overlay.dataset.phase)) window.terminalFlashes++;
          });
          observer.observe(document.body, { childList: true, attributes: true, subtree: true });
          DragonRaid.onState(ended, Date.now());
          // Old terminal data in a first update must also be treated as history.
          DragonRaid.onMessage({ type: 'dragon:update', live: true, raid: ended, serverNow: Date.now() });
        }, { once: true });
      }, fixture());
      await page.goto(server.base + '/raid-replay-fixture');
      const hidden = async () => assert.equal(await page.locator('#dragon-raid-overlay:not([hidden])').count(), 0, `${role}: historical report hidden`);
      await hidden();
      for (let n = 0; n < 2; n++) { await page.reload(); await hidden(); }
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.terminalFlashes), 0, 'no result popup flashes during refresh');
      assert.equal(await page.locator('#origin #message').count(), 1, 'historical raid never captures chat');
      const ended = fixture();
      for (const phase of ['COMPLETE', 'FAILED', 'ABORTED']) {
        await page.evaluate(r => { DragonRaid.onState(null); DragonRaid.onState(r, Date.now()); DragonRaid.render(); }, { ...ended, phase });
        await hidden();
      }
      await page.evaluate(r => {
        DragonRaid.onState({ ...r, phase: 'HEART' }, Date.now());
        DragonRaid.onState(r, Date.now()); // Public snapshot can race ahead of live end event.
      }, ended);
      await hidden();
      await page.evaluate(r => DragonRaid.onMessage({ type: 'dragon:update', live: true, raid: r, serverNow: Date.now() }), ended);
      await page.locator('#dragon-raid-overlay:not([hidden]) [data-dragon-action="hide"]').click();
      await page.evaluate(r => {
        DragonRaid.onState(r, Date.now());
        DragonRaid.onMessage({ type: 'dragon:update', live: true, raid: r, serverNow: Date.now() });
        DragonRaid.onMessage({ type: 'dragon:error', message: 'Late response' });
      }, ended);
      await hidden();
      await page.reload(); await hidden();
      await page.evaluate(r => DragonRaid.onState({ ...r, id: 'new-raid', phase: 'RECRUITING' }, Date.now()), ended);
      assert.equal(await page.locator('#dragon-raid-overlay:not([hidden])').count(), 1, 'new active raids still summon');
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('PASS raid report lifecycle: GM/raider/spectator/mobile refresh, zero historical flashes, terminal snapshots/duplicates/errors stay closed, live completion works even after snapshot race, new raids still summon');
  } finally { await browser?.close(); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
