'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
(async () => {
  const server = await H.startServer({ port: 19858 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const errors = [];
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gmContext = await browser.newContext();
    await gmContext.addInitScript(token => sessionStorage.setItem('asoc_gm_token', token), login.data.token);
    const gm = await gmContext.newPage(); await gm.goto(server.base + '/');
    await gm.waitForFunction(() => App?.roomCode === 'MASTER');
    const debtorContext = await browser.newContext();
    const debtorToken = await H.heroToken(server, 'Fate Debtor');
    let debtor = await H.openHeroPage(debtorContext, server, debtorToken);
    const otherContext = await browser.newContext();
    const other = await H.openHeroPage(otherContext, server, await H.heroToken(server, 'Fate Other'));
    const viewers = [];
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const token = await H.heroToken(server, 'Fate Observer ' + width);
      const page = await H.openHeroPage(context, server, token);
      page.on('pageerror', e => errors.push(e.message));
      // Observe actual wire metadata without replacing the shipping renderer.
      await page.evaluate(() => { window.fateFrames = []; const original = TombolaUI.onMessage; TombolaUI.onMessage = message => { if (message.type === 'tombola:state') fateFrames.push(message); return original(message); }; });
      viewers.push({ page, context, token, width });
    }
    await gm.evaluate(() => TombolaUI.activate());
    await debtor.locator('[data-tombola-invite-join]').click();
    await debtor.locator('[data-tombola-action="leave"]').waitFor();
    await other.locator('[data-tombola-invite-join]').click();
    await other.locator('[data-tombola-action="leave"]').waitFor();
    for (const { page } of viewers) await page.locator('[data-tombola-invite-dismiss]').click();
    await gm.locator('[data-tombola-action="start"]').click();
    await debtor.waitForFunction(() => document.querySelector('.tombola-turn')?.textContent.includes('CYCLE'));
    if (!await debtor.locator('[data-tombola-field]:not([disabled])').count()) debtor = other;
    await debtor.locator('[data-tombola-field]:not([disabled])').first().waitFor();
    const room = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'active-rooms.json'), 'utf8')).rooms[0];
    const blood = room.tombola.inventory.findIndex(field => field.kind === 'BLOOD_TRIBUTE') + 1;
    await debtor.locator(`[data-tombola-field="${blood}"]`).click();
    await debtor.locator('#tombola-required-veil').waitFor();
    for (const { page } of viewers) {
      await page.locator('#tombola-overlay:not([hidden]) .tombola-blood-verdict').waitFor();
      assert.equal(await page.evaluate(() => fateFrames.at(-1).live), true, 'actual ending is a live event');
      await page.locator('[data-tombola-close]').click();
      await page.evaluate(() => PlayerApp.send({ type: 'tombola:sync' }));
      await page.waitForFunction(() => fateFrames.at(-1)?.live === false);
      assert.equal(await page.locator('#tombola-overlay').isHidden(), true, 'sync cannot reopen completed game');
      await page.reload(); await page.locator('#game-screen.active').waitFor();
      // Explicit sync ensures the restored round has reached the renderer.
      await page.evaluate(() => { window.fateSync = false; const original = TombolaUI.onMessage; TombolaUI.onMessage = m => { if (m.type === 'tombola:state' && m.state?.phase === 'ENDED') fateSync = true; return original(m); }; PlayerApp.send({ type: 'tombola:sync' }); });
      await page.waitForFunction(() => fateSync);
      assert.equal(await page.locator('#tombola-overlay').isHidden(), true, 'reload is quiet');
      await page.evaluate(() => PlayerApp.ws.close());
      await page.waitForFunction(() => PlayerApp.ws?.readyState === 1 && PlayerApp._protocolReady);
      assert.equal(await page.locator('#tombola-overlay').isHidden(), true, 'socket reconnect is quiet');
      const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const fresh = await H.openHeroPage(freshContext, server, viewers.find(v => v.page === page).token);
      await fresh.evaluate(() => TombolaUI.open()); // History stays available on demand.
      await fresh.locator('.tombola-blood-verdict').waitFor();
      await fresh.locator('[data-tombola-close]').click();
      await fresh.reload(); await fresh.locator('#game-screen.active').waitFor();
      await fresh.waitForTimeout(300);
      assert.equal(await fresh.locator('#tombola-overlay').isHidden(), true, 'fresh login cannot replay old finale');
      await freshContext.close();
    }
    await debtor.reload(); await debtor.locator('#tombola-required-veil').waitFor();
    assert.equal(await debtor.locator('[data-tombola-close]').isDisabled(), true, 'genuine unpaid obligation remains enforced');
    if (await debtor.locator('[data-bm-pay-debt]').count()) await debtor.locator('[data-bm-pay-debt]').click();
    else await debtor.locator('[data-tombola-pay]').click();
    await debtor.locator('[data-act="offer-tribute"]').click();
    const chooser = debtor.waitForEvent('filechooser');
    await debtor.locator('[data-bm-consent-open]').click();
    await (await chooser).setFiles({ name: 'tribute.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
    await debtor.locator('#tombola-required-veil').waitFor({ state: 'detached' });
    await debtor.reload(); await debtor.locator('#game-screen.active').waitFor();
    await debtor.waitForTimeout(300);
    assert.equal(await debtor.locator('#tombola-overlay').isHidden(), true, 'submitted tribute does not resurrect the finished board');
    assert.deepEqual(errors, []);
    console.log('PASS Fatebreaker terminal hydration: live finale once, desktop/mobile reload, explicit sync, socket reconnect, fresh login, manual history; unpaid tribute enforced, submitted tribute stays quiet');
  } finally { if (browser) await browser.close(); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
