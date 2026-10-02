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
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    const token = await H.heroToken(server, 'Sibicar Browser Hero');
    const page = await H.openHeroPage(context, server, token);

    await page.click('#casual-minigames-toggle');
    await page.waitForSelector('#casual-minigames-menu:not([hidden]) #minigames-sibicar');
    await page.click('#minigames-sibicar');
    await page.waitForSelector('#sibicar-overlay:not([hidden]) [data-sibicar-mode="FUN"]');
    await page.click('[data-sibicar-mode="FUN"]');
    await page.waitForFunction(() => window.SibicarUI?.state === 'AWAITING_PICK', null, { timeout: 8000 });

    assert.equal(await page.locator('.sibicar-head:not([disabled])').count(), 3, 'all three heads activate only after the readable shuffle');
    assert.equal(await page.locator('#sibicar-overlay .sibicar-brain').count(), 3, 'brain art remains attached to head identities');
    await page.locator('.sibicar-head:not([disabled])').first().click();
    await page.waitForFunction(() => window.SibicarUI?.state === 'RESULT', null, { timeout: 5000 });

    assert.equal(await page.locator('.sibicar-head.is-actual.has-brain.is-open').count(), 1, 'server result reveals exactly one actual brain');
    assert.equal(await page.locator('.sibicar-result').count(), 1, 'round resolves into one result panel');
    assert.equal(await page.locator('[data-sibicar-replay]').isEnabled(), true, 'replay appears only after resolution');
    assert.deepEqual(page.pageErrors, [], 'no browser errors');

    const gmLogin = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    await gmContext.addInitScript(token => {
      localStorage.setItem('asoc_master_token', token);
      sessionStorage.setItem('asoc_gm_token', token);
    }, gmLogin.data.token);
    const gmPage = await gmContext.newPage();
    const gmErrors = [];
    gmPage.on('pageerror', error => gmErrors.push(error.message));
    await gmPage.goto(`${server.base}/index.html`, { waitUntil: 'domcontentloaded' });
    await gmPage.waitForFunction(() => window.App?.roomMode === 'CASUAL', null, { timeout: 15000 });
    await gmPage.click('#gm-minigames-toggle');
    await gmPage.click('[data-gm-minigame="sibicar"]');
    await gmPage.waitForSelector('#sibicar-overlay:not([hidden]) [data-sibicar-mode="FUN"]');
    assert.equal(await gmPage.locator('#sibicar-overlay').isVisible(), true, 'GM card opens ŠIBICAR directly without a login or Player Mirror');
    await gmPage.click('[data-sibicar-mode="FUN"]');
    await gmPage.waitForFunction(() => window.SibicarUI?.state === 'AWAITING_PICK', null, { timeout: 8000 });
    await gmPage.locator('.sibicar-head:not([disabled])').nth(1).click();
    await gmPage.waitForFunction(() => window.SibicarUI?.state === 'RESULT', null, { timeout: 5000 });
    assert.equal(await gmPage.locator('.sibicar-result').count(), 1, 'GM FUN round settles through the authoritative server path');
    assert.deepEqual(gmErrors, [], 'no GM browser errors');
    await gmContext.close();

    assert.equal(server.errors().trim(), '', 'no server errors');
    console.log('PASS ŠIBICAR browser: player and GM arcade entry, explicit UI states, readable shuffle, authoritative reveal and replay');
  } finally {
    await browser?.close();
    await server.stop();
  }
})().catch(error => { console.error('FAIL ŠIBICAR browser:', error); process.exit(1); });
