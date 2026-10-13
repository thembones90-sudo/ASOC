'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
const PORT = 19028;

(async () => {
  const server = await H.startServer({ port: PORT, env: {
    NODE_ENV: 'test', ASOC_TEST_ATOMIC_DELAY_MS: '200', ASOC_RUNTIME_BATCH_MAX: '32'
  }});
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const contexts = [], pages = [];
    for (let i = 0; i < 12; i++) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      contexts.push(context);
      pages.push(await H.openHeroPage(context, server, await H.heroToken(server, `Durable Hero ${i}`)));
    }

    const texts = pages.map((_, i) => `worker-burst-${i}-${Date.now()}`);
    const started = Date.now();
    await Promise.all(pages.map((page, i) => page.evaluate(text => {
      PlayerApp.send({ type: 'chat:guess', text });
    }, texts[i])));

    // The worker is deliberately blocked for 200ms. HTTP must still be served
    // by the main thread during that fsync window.
    await H.sleep(25);
    const probes = [];
    for (let i = 0; i < 8; i++) {
      const at = Date.now();
      const response = await server.api('GET', '/health');
      probes.push(Date.now() - at);
      assert.equal(response.status, 200);
    }
    const worstProbe = Math.max(...probes);
    assert.ok(worstProbe < 100, `slow durable storage stalled HTTP for ${worstProbe}ms`);

    await Promise.all(pages.map(page => page.waitForFunction(expected => {
      const messages = PlayerApp.chatMessages || [];
      return expected.every(text => messages.some(message => message.text === text));
    }, texts, { timeout: 5000 })));
    const deliveryMs = Date.now() - started;
    assert.ok(deliveryMs < 2500, `batched twelve-message durable delivery took ${deliveryMs}ms`);
    for (const page of pages) {
      const counts = await page.evaluate(expected => Object.fromEntries(expected.map(text => [text,
        (PlayerApp.chatMessages || []).filter(message => message.text === text).length])), texts);
      assert.ok(Object.values(counts).every(count => count === 1), 'each accepted message is delivered exactly once');
      assert.deepEqual(page.pageErrors, []);
    }
    console.log(`PASS Persistence V2 12-client load: 200ms storage isolation, ordered batch delivery ${deliveryMs}ms, HTTP worst ${worstProbe}ms`);
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
})().catch(error => { console.error('FAIL Persistence V2 integration:', error); process.exit(1); });
