'use strict';
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.sent = [];
      window.PlayerApp = { playerId: 'victim', send: message => window.sent.push(message) };
    });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'js', 'poison.js') });
    const update = () => page.evaluate(() => window.PoisonEffect.onState({ poison: {
      victim: { status: 'bleeding', nextTickAt: Date.now() + 20000 }
    } }));
    await update();
    await page.locator('[data-poison-file]').setInputFiles({ name: 'tribute.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgo=', 'base64') });
    // Simulate the live room/bleed update that formerly destroyed selection.
    await update();
    assert.equal(await page.locator('[data-poison-file-name]').textContent(), 'tribute.png');
    await page.locator('[data-poison-submit]').click();
    await page.waitForFunction(() => window.sent.some(m => m.type === 'poison:tributeSubmit'));
    const sent = await page.evaluate(() => window.sent.find(m => m.type === 'poison:tributeSubmit'));
    assert.ok(sent.imageData.startsWith('data:image/png;base64,'));
    assert.equal(sent.retentionAcknowledged, true);
    await page.evaluate(() => window.PoisonEffect.onState({ poison: {} }));
    await update();
    await page.locator('[data-poison-submit]').click();
    assert.equal(await page.locator('[data-poison-file-name]').textContent(), 'NO IMAGE SELECTED');
    console.log('PASS poison tribute: file survives live updates, submits, and clears after cure');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
