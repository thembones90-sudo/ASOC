'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
const shots = path.join(__dirname, '..', '.scratch', 'tombola-visuals');
(async () => {
  const server = await H.startServer({ port: 19831 });
  let browser;
  const pages = [];
  try {
    fs.mkdirSync(shots, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await gmContext.addInitScript(token => { sessionStorage.setItem('asoc_gm_token', token); localStorage.setItem('asoc_master_token', token); }, login.data.token);
    const gm = await gmContext.newPage(); const errors = [];
    pages.push(gm);
    gm.on('pageerror', e => errors.push(e.message));
    await gm.goto(server.base + '/index.html');
    await gm.waitForFunction(() => window.App?.roomCode === 'MASTER' && window.App?.mode === 'multiplayer');
    await gm.locator('#gm-minigames-toggle').click();
    await gm.locator('[data-gm-minigame="tombola"]').click();
    await gm.locator('[data-tombola-action="create"]').click();
    await gm.locator('[data-tombola-action="start"]').waitFor();
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const alpha = await H.openHeroPage(desktop, server, await H.heroToken(server, 'Tombola Alpha'));
    const beta = await H.openHeroPage(phone, server, await H.heroToken(server, 'Tombola Beta'));
    pages.push(alpha, beta);
    for (const page of [alpha, beta]) {
      page.on('pageerror', e => errors.push(e.message));
      await page.locator('#casual-minigames-toggle').click();
      await page.locator('#minigames-tombola').click();
      await page.locator('[data-tombola-action="join"]').click();
      await page.locator('[data-tombola-action="leave"]').waitFor();
    }
    await gm.locator('[data-tombola-action="start"]').click();
    await alpha.locator('[data-tombola-field="1"]:not([disabled])').waitFor();
    for (const [name, page] of [['desktop', alpha], ['mobile', beta]]) {
      assert.equal(await page.locator('[data-tombola-field]').count(), 36);
      const numbers = await page.locator('.tombola-number').allTextContents();
      assert.deepEqual(numbers, Array.from({ length: 36 }, (_, i) => String(i + 1)));
      const geometry = await page.locator('.tombola-board').evaluate(node => {
        const r = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return { width: r.width, height: r.height, left: r.left, right: r.right, viewport: innerWidth, columns: style.gridTemplateColumns.split(' ').length,
          rows: style.gridTemplateRows.split(' ').length, assets: getComputedStyle(node.querySelector('.tombola-field')).backgroundImage };
      });
      assert.ok(Math.abs(geometry.width - geometry.height) < 1); assert.equal(geometry.columns, 6); assert.equal(geometry.rows, 6);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport); assert.ok(geometry.assets.includes('vault-numberless.png'));
      assert.ok(await page.locator('.tombola-number').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16));
      await page.screenshot({ path: path.join(shots, `${name}-closed.png`) });
    }
    for (let field = 1; field <= 36; field++) {
      const actor = field % 2 === 1 ? alpha : beta;
      await actor.locator(`[data-tombola-field="${field}"]:not([disabled])`).waitFor();
      await actor.locator(`[data-tombola-field="${field}"]`).click();
      await actor.locator(`[data-tombola-field="${field}"]:not(.is-closed)`).waitFor();
      if (await actor.locator('.tombola-blood-verdict').count()) break;
    }
    await gm.locator('.tombola-blood-verdict').waitFor();
    for (const [name, page] of [['desktop', alpha], ['mobile', beta]]) {
      await page.locator('.tombola-blood-verdict').waitFor();
      assert.equal(await page.locator('[data-tombola-field]:not([disabled])').count(), 0);
      if (await page.locator('#bm-demand-notice').count()) {
        await page.locator('[data-bm-pay-debt]').click();
        await page.locator('[data-bm-close]').waitFor();
        assert.ok((await page.locator('#black-market-body').textContent()).includes('BLOOD TRIBUTE REQUIRED'));
        await page.locator('[data-bm-close]').click();
      }
      await page.screenshot({ path: path.join(shots, `${name}-finale.png`) });
      await page.locator('[data-tombola-close]').click();
      await page.locator('#chat-input').fill('Chat remains available after Tombola');
      assert.deepEqual(page.pageErrors || [], []);
    }
    assert.deepEqual(errors, []);
    console.log('PASS actual ASOC browser: GM lobby/start, player signup, live turns/picks, square 36-field desktop/mobile art, synchronized finale, existing chat preserved');
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: path.join(shots, `failure-${i}.png`) });
      console.error(await pages[i].evaluate(() => ({ url: location.href, root: document.getElementById('tombola-overlay')?.innerText, player: window.PlayerApp?.playerId, gm: !!window.App, ws: window.PlayerApp?.ws?.readyState })));
    }
    throw error;
  } finally { if (browser) await browser.close(); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
