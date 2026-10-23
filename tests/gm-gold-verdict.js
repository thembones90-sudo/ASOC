'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
(async () => {
  const server = await H.startServer({ port: 19863 });
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(token => { sessionStorage.setItem('asoc_gm_token', token); localStorage.setItem('asoc_master_token', token); }, login.data.token);
    const page = await context.newPage();
    await page.goto(server.base + '/index.html');
    await page.waitForFunction(() => window.App?.roomCode === 'MASTER' && window.App?.mode === 'multiplayer');
    await page.evaluate(() => {
      App.roomMode = 'BATTLE';
      GameData.currentGame = { finalSolution: 'RAIL', columns: { A: { solution: 'LINK' }, B: { solution: 'STEEL' }, C: { solution: 'METAL' }, D: { solution: 'WAGON' } } };
      const fixture = document.createElement('section');
      fixture.id = 'gold-verdict-fixture'; fixture.className = 'gm-module-chat';
      fixture.style.cssText = 'position:fixed;inset:20px auto auto 20px;width:600px;max-width:90vw;background:#201020;padding:20px;z-index:2147483647';
      fixture.innerHTML = [null, 'wrong', 'correct'].map((verdict, index) => App.createGMChatMessageHTML({ id: `gold-${index}`, playerId: 'test-hero', playerName: 'Gold Test', text: 'b rail / steel / railroad', timestamp: Date.now(), verdict, target: verdict === 'correct' ? 'B' : null, adjudicable: true, reactions: {} })).join('');
      document.body.append(fixture);
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const rows = await page.locator('#gold-verdict-fixture .gm-chat-message').evaluateAll(nodes => nodes.map(node => ({ verdict: node.classList.contains('wrong') ? 'wrong' : node.classList.contains('correct') ? 'correct' : 'pending', hits: [...node.querySelectorAll('.gm-solution-hit')].map(hit => ({ word: hit.textContent, color: getComputedStyle(hit).color, slot: hit.dataset.solution })), text: node.querySelector('.gm-chat-message-text').textContent })));
      for (const row of rows) {
        assert.deepEqual(row.hits.map(hit => hit.word), ['rail', 'steel'], 'whole solution words only, not railroad');
        assert.deepEqual(row.hits.map(hit => hit.slot), ['FINAL', 'B5']);
        for (const hit of row.hits) assert.equal(hit.color, 'rgb(255, 214, 107)', `${row.verdict} ${hit.word} remains gold at ${width}px`);
      }
      assert.equal(rows[1].verdict, 'wrong', 'gold never changes the wrong-column verdict');
    }
    const shots = path.join(H.ROOT, '.scratch', 'gold-verdict'); fs.mkdirSync(shots, { recursive: true });
    await page.locator('#gold-verdict-fixture').screenshot({ path: path.join(shots, 'mobile.png') });
    console.log('PASS GM gold solution words survive pending/wrong/correct verdicts on desktop/mobile; wrong-column verdict and whole-word boundaries preserved');
  } finally { await browser?.close(); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
