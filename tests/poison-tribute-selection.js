'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const sanitizer = source.slice(source.indexOf('function sanitizeTributeImageData('), source.indexOf('\nfunction loadGameData('));
const sanitize = vm.runInNewContext(sanitizer + '; sanitizeTributeImageData', { MAX_TRIBUTE_DATA_LENGTH: 3000000 });
const limit = 20 * 1024 * 1024;
const boundaryImage = 'data:image/png;base64,' + Buffer.alloc(limit).toString('base64');
assert.equal(sanitize(boundaryImage, limit), boundaryImage, 'server accepts exactly 20 MB');
assert.equal(sanitize('data:image/png;base64,' + Buffer.alloc(limit + 1).toString('base64'), limit), null, 'server rejects over 20 MB');
assert.equal(sanitize(boundaryImage), null, 'other tribute limits remain unchanged');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://asoc.test/', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('http://asoc.test/');
    await page.evaluate(() => {
      window.sent = [];
      window.PlayerApp = { playerId: 'victim', send: message => window.sent.push(message) };
      window.fetch = async (url, options) => {
        window.sent.push({ url, size: options.body.size });
        return { ok: false, json: async () => ({ error: 'TEST RETRY' }) };
      };
    });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'js', 'poison.js') });
    const update = () => page.evaluate(() => window.PoisonEffect.onState({ poison: {
      victim: { status: 'bleeding', nextTickAt: Date.now() + 20000 }
    } }));
    await update();
    await page.locator('[data-poison-file]').setInputFiles({ name: 'tribute.png', mimeType: 'image/png', buffer: Buffer.alloc(limit) });
    // Simulate the live room/bleed update that formerly destroyed selection.
    await update();
    assert.equal(await page.locator('[data-poison-file-name]').textContent(), 'tribute.png');
    await page.locator('[data-poison-submit]').click();
    await page.waitForFunction(() => window.sent.some(m => m.url === '/api/poison/tribute-image'));
    const sent = await page.evaluate(() => window.sent.find(m => m.url === '/api/poison/tribute-image'));
    assert.equal(sent.size, limit, '20 MB image is uploaded directly over HTTP');
    await page.evaluate(() => window.PoisonEffect.onState({ poison: {} }));
    await update();
    await page.locator('[data-poison-submit]').click();
    assert.equal(await page.locator('[data-poison-file-name]').textContent(), 'NO IMAGE SELECTED');
    console.log('PASS poison tribute: 20 MB accepted in browser and server, oversized rejected, selection survives updates');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
