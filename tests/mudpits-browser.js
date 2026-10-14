'use strict';
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const shots = path.join(root, '.scratch', 'mudpits-visuals'); fs.mkdirSync(shots, { recursive: true });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setContent('<body style="background:#09090b;color:#eee;margin:0"><div class="gm-module-chat"><div class="gm-chat-panel"><button id="gm-minigames-toggle">MINI GAMES</button><div id="gm-minigames-menu" hidden></div><div id="gm-minigames-panel" hidden><h2 id="gm-minigames-title"></h2><div id="gm-minigames-content"></div></div></div></div><form id="chat-form" style="position:fixed;bottom:16px;left:10px;right:10px;height:60px"><input placeholder="PUBLIC CHAT REMAINS OPEN" style="width:100%;height:48px"></form></body>');
      await page.addStyleTag({ path: path.join(root, 'css', 'mudpits.css') });
      await page.evaluate(() => {
        window.sent = [];
        window.App = { roomMode: 'CASUAL', currentPlayers: [{ id: 'a', name: 'Alpha', connected: true }, { id: 'b', name: 'Beta', connected: true }, { id: 'offline', name: 'Offline', connected: false }], send: payload => { window.sent.push(payload); return true; } };
      });
      await page.addScriptTag({ path: path.join(root, 'js', 'mudpits-ui.js') });
      await page.addScriptTag({ path: path.join(root, 'js', 'gm-minigames.js') });
      await page.evaluate(() => window.GMMinigames.startMudpits());
      assert.equal(await page.locator('[data-mudpits-contestant]').count(), 3, 'GM and active players only');
      await page.locator('[value="__GM__"]').check(); await page.locator('[value="a"]').check();
      await page.locator('[data-mudpits-summon]').click();
      assert.deepEqual(await page.evaluate(() => window.sent.at(-1).contestantIds), ['__GM__', 'a']);
      const state = { active: true, id: 'browser-duel', phase: 'WRITING', serverNow: Date.now(), writeDeadline: Date.now() + 90000, contestants: [{ id: '__GM__', name: 'SHADOW BROKER' }, { id: 'a', name: 'Alpha' }], viewer: { canSubmit: true, canCancel: true }, names: { __GM__: 'SHADOW BROKER', a: 'Alpha' } };
      await page.evaluate(s => window.GMMinigames.onMessage({ type: 'mudpits:state', state: s }), state);
      await page.locator('textarea').fill('The iron remembers your cowardice');
      await page.evaluate(s => window.GMMinigames.onMessage({ type: 'mudpits:state', state: s }), state);
      assert.equal(await page.locator('textarea').inputValue(), 'The iron remembers your cowardice');
      assert.equal(await page.locator('textarea').evaluate(node => node === document.activeElement), true, 'focus survives refresh');
      await page.locator('.mudpits-submit').click();
      assert.equal(await page.evaluate(() => window.sent.at(-1).text), 'The iron remembers your cowardice');
      const bounds = await page.locator('#gm-mudpits-root').boundingBox();
      const composer = await page.locator('#chat-form').boundingBox();
      assert.ok(bounds.y + bounds.height <= composer.y, 'duel never obstructs composer');
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, 'no sideways overflow');
      await page.locator('[data-mudpits-cancel]').click();
      assert.equal(await page.evaluate(() => window.sent.at(-1).type), 'mudpits:cancel');
      await page.evaluate(s => window.GMMinigames.onMessage({ type: 'mudpits:state', state: { ...s, phase: 'RESULT', revealed: true, entries: [{ text: 'The iron remembers your cowardice' }, { text: 'Your crown is borrowed' }], counts: { __GM__: 3, a: 1 }, winnerId: '__GM__', awarded: true, viewer: {} } }), state);
      await page.screenshot({ path: path.join(shots, `${viewport.width}-verdict.png`) });
      assert.ok((await page.locator('.mudpits-judgment').textContent()).includes('+1 SC'));
      await page.locator('[data-mudpits-dismiss]').click();
      assert.equal(await page.locator('#gm-mudpits-root').isHidden(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS browser desktop/mobile: GM selector, typing, draft/focus refresh, submit, cancel, verdict, scrolling, composer clearance');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
