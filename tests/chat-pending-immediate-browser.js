'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
const PORT = 19053;
(async () => {
  const server = await H.startServer({
    port: PORT, env: { NODE_ENV: 'test', ASOC_TEST_ATOMIC_DELAY_MS: '800', ASOC_RUNTIME_BATCH_MAX: '16' }
  });
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
    const token = await H.heroToken(server, 'Pending Chat Test Player');
    const page = await H.openHeroPage(context, server, token);
    const stamp = String(Date.now());
    const one = 'pending-first-' + stamp;
    const two = 'pending-second-' + stamp;
    const send = async text => page.evaluate(msg => {
      const input = document.getElementById('chat-input');
      input.value = msg;
      const start = performance.now();
      PlayerApp.submitGuess();
      const preview = [...document.querySelectorAll('[data-local-chat-id]')].find(el =>
        el.querySelector('.chat-message-text')?.textContent === msg);
      return {
        immediateMs: performance.now() - start,
        previewFound: Boolean(preview),
        status: preview?.querySelector('[data-delivery]')?.dataset.delivery,
        authoritativeCount: (PlayerApp.chatMessages || []).filter(entry => entry.text === msg).length
      };
    }, text);
    const first = await send(one);
    assert.equal(first.previewFound, true, 'must render a pending chat card synchronously on Enter');
    assert.equal(first.status, 'sending');
    assert.equal(first.authoritativeCount, 0, 'pending preview is not an authoritative message');
    assert.ok(first.immediateMs < 250, 'local UI should not wait for disk commit');
    const second = await send(two);
    assert.equal(second.previewFound, true);
    assert.equal(second.status, 'sending');
    await page.waitForFunction(text =>
      (PlayerApp.chatMessages || []).some(entry => entry.text === text), one, { timeout: 14000 });
    await page.waitForFunction(text =>
      (PlayerApp.chatMessages || []).some(entry => entry.text === text), two, { timeout: 14000 });
    // The storage-delay test accepts both sends because the second can enter
    // after the first durable commit, outside the chat cooldown. Drive the
    // exact refused-ACK client branch independently and retry through the
    // real server, without pretending the server issued that refusal.
    const refusedText = 'synthetic-refused-' + stamp;
    await page.evaluate(text => {
      const clientMsgId = PlayerApp.newClientMsgId();
      PlayerApp.addPendingChat({ type: 'chat:guess', text, clientMsgId }, 'sending');
      PlayerApp.handleMessage({ type: 'chat:ack', clientMsgId, refused: true });
    }, refusedText);
    const failed = page.locator('.chat-local-pending').filter({ hasText: refusedText });
    await failed.locator('[data-delivery="failed"]').waitFor();
    assert.equal(await failed.locator('[data-local-chat-retry]').count(), 1, 'refusal must allow retry');
    assert.equal(await page.evaluate(text =>
      (PlayerApp.chatMessages || []).some(entry => entry.text === text), refusedText), false);
    await H.sleep(450);
    await failed.locator('[data-local-chat-retry]').click();
    await page.waitForFunction(text =>
      (PlayerApp.chatMessages || []).some(entry => entry.text === text), refusedText, { timeout: 14000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-local-chat-id]').length === 0,
      { timeout: 5000 });
    for (const text of [one, two, refusedText]) assert.equal(await page.evaluate(value =>
      (PlayerApp.chatMessages || []).filter(entry => entry.text === value).length, text), 1,
      'accepted message should appear once and pending duplicate should disappear');
    assert.deepEqual(page.pageErrors, [], 'browser JS must remain error-free');
    console.log('PASS instant pending chat browser: local preview=' + first.immediateMs.toFixed(2) +
      'ms, authoritative messages never fabricated, refused send marked NOT SENT, retry reconciled exactly once');
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
})().catch(error => { console.error('FAIL instant pending chat browser:', error); process.exit(1); });
