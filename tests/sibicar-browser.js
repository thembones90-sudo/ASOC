'use strict';
const assert = require('assert/strict');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
const PORT = Number(process.env.ASOC_SIBICAR_BROWSER_PORT) || 18996;
(async () => {
  const server = await H.startServer({ port: PORT });
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const hero = await H.openHeroPage(context, server, await H.heroToken(server, 'Retired Games Hero'));
    await hero.click('#casual-minigames-toggle');
    assert.equal(await hero.locator('#minigames-sibicar, #minigames-unstable-concoction').count(), 0);
    assert.equal(await hero.locator('#minigames-iks-oks, #minigames-kaladont, #minigames-tombola').count(), 3);
    assert.deepEqual(await hero.evaluate(() => [typeof window.SibicarUI, typeof window.UnstableConcoction]), ['undefined', 'undefined']);
    assert.deepEqual(hero.pageErrors, []);
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await gmContext.addInitScript(token => {
      localStorage.setItem('asoc_master_token', token); sessionStorage.setItem('asoc_gm_token', token);
    }, login.data.token);
    const gm = await gmContext.newPage(), errors = [];
    gm.on('pageerror', error => errors.push(error.message));
    await gm.goto(server.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await gm.waitForFunction(() => window.App?.roomMode === 'CASUAL');
    await gm.click('#gm-minigames-toggle');
    assert.equal(await gm.locator('[data-gm-minigame="sibicar"], [data-gm-minigame="concoction"]').count(), 0);
    assert.equal(await gm.locator('[data-gm-minigame="threefold"], [data-gm-minigame="kaladont"], [data-gm-minigame="tombola"]').count(), 3);
    assert.equal(await gm.evaluate(() => typeof window.SibicarUI), 'undefined');
    assert.equal(await gm.evaluate(() => typeof window.GMMinigames.spinConcoction), 'undefined');
    for (const page of [hero, gm]) assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(r => /\/js\/(sibicar-ui|unstable-concoction)\.js/.test(r.name))), false);
    assert.deepEqual(errors, []); assert.equal(server.errors().trim(), '');
    console.log('PASS retired mini-games browser: no GM/player cards, no legacy script imports/launchers, remaining games preserved');
  } finally { await browser?.close(); await server.stop(); }
})().catch(error => { console.error('FAIL retired mini-games browser:', error); process.exitCode = 1; });
