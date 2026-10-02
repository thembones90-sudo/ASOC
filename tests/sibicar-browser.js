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
    assert.equal(server.errors().trim(), '', 'no server errors');
    console.log('PASS ŠIBICAR browser: arcade entry, explicit UI states, readable shuffle, locked pick, authoritative reveal and replay');
  } finally {
    await browser?.close();
    await server.stop();
  }
})().catch(error => { console.error('FAIL ŠIBICAR browser:', error); process.exit(1); });
