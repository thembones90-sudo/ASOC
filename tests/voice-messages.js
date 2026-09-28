// VOICE MESSAGES -- a Little Hero records from the chat "+" menu (fake
// microphone), the upload lands as a voice chat message, the file is served
// with byte ranges, and the server refuses bad uploads (type, signature,
// length over 1 minute, unauthenticated).
'use strict';

const assert = require('assert/strict');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');

const PORT = Number(process.env.ASOC_VOICE_TEST_PORT) || 18941;
const http = require('http');

function raw(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let data = buf.toString(); try { data = JSON.parse(data); } catch {} resolve({ status: res.statusCode, headers: res.headers, buf, data }); });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const server = await H.startServer({ port: PORT, env: { ASOC_CHAT_UPLOAD_MIN_GAP_MS: '0' } });
  let browser;
  try {
    const token = await H.heroToken(server, 'Voice Hero');
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 1)]);
    const h = type => ({ 'content-type': type, 'x-player-token': token });

    browser = await chromium.launch({ ...H.launchOptions(), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.grantPermissions(['microphone'], { origin: server.base });
    const page = await H.openHeroPage(context, server, token);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    page.on('response', r => { if (r.url().includes('/api/chat/voice')) dialogs.push('HTTP ' + r.status()); });

    // Server-side refusals (the hero is now live in the room).
    assert.equal((await raw('POST', '/api/chat/voice?seconds=5', { 'content-type': 'audio/webm' }, webm)).status, 401, 'unauthenticated refused');
    assert.equal((await raw('POST', '/api/chat/voice?seconds=5', h('audio/wav'), webm)).status, 415, 'unsupported type refused');
    assert.equal((await raw('POST', '/api/chat/voice?seconds=5', h('audio/webm'), Buffer.from('not really audio at all'))).status, 415, 'forged signature refused');
    assert.equal((await raw('POST', '/api/chat/voice?seconds=61', h('audio/webm'), webm)).status, 413, 'over one minute refused');
    assert.equal((await raw('POST', '/api/chat/voice?seconds=0', h('audio/webm'), webm)).status, 400, 'zero length refused');

    // Record through the real UI.
    await page.locator('#chat-voice-btn').click();
    await page.waitForSelector('.voice-recorder');
    await H.sleep(2300);
    await page.locator('.voice-recorder-send').click();
    await page.waitForSelector('.chat-voice', { timeout: 10000 }).catch(e => { throw new Error('no voice message; dialogs/responses: ' + JSON.stringify(dialogs)); });
    assert.equal(await page.locator('.voice-recorder').count(), 0, 'recorder closes after sending');
    const src = await page.locator('.chat-voice').first().getAttribute('data-voice-src');
    const seconds = Number(await page.locator('.chat-voice').first().getAttribute('data-voice-seconds'));
    assert.match(src, /^\/uploads\/chat\/[a-f0-9]{32}\.(webm|ogg|m4a)$/);
    assert.ok(seconds >= 2 && seconds <= 3, `recorded length is about 2 s (got ${seconds})`);

    const full = await raw('GET', src, {});
    assert.equal(full.status, 200);
    assert.match(full.headers['content-type'], /^audio\//);
    assert.equal(full.buf.subarray(0, 4).toString('hex'), '1a45dfa3', 'stored file is the recorded WEBM');
    const part = await raw('GET', src, { range: 'bytes=0-9' });
    assert.equal(part.status, 206, 'byte ranges served for audio players');
    assert.equal(part.buf.length, 10);

    // Playback toggles the shared player.
    await page.locator('.chat-voice-play').first().click();
    await page.waitForFunction(() => document.querySelector('.chat-voice')?.classList.contains('is-playing'), null, { timeout: 5000 });
    assert.deepEqual(page.pageErrors, [], 'no page errors');
    assert.equal(server.errors().trim(), '', 'no server errors');
    console.log('PASS voice messages: record with the mic button, upload as a voice message, byte-range serving, playback, and refusal of unauthenticated / wrong type / forged / over-1-minute uploads');
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
})().catch(error => {
  console.error('FAIL voice messages:', error);
  process.exit(1);
});
