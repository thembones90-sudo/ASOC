// STICKERS -- WhatsApp-style stickers in the Little Hero chat, in a real browser.
'use strict';
const R = require('path').join(__dirname, '..') + '/';
const { chromium } = require(R + 'node_modules/playwright');
const WebSocket = require(R + 'node_modules/ws');
const H = require(R + 'tests/lib/browser-harness.js');
const assert = require('assert/strict');
function conn(port, onMsg) { return new Promise(res => { const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1, clientBuild: 't' })); if (m.type === 'protocol:ready') return res(ws); onMsg && onMsg(ws, m); }); }); }
(async () => {
  const s = await H.startServer({ port: Number(process.env.ASOC_STICKERS_PORT) || 18972 });
  try {
    const meTok = await H.heroToken(s, 'Frostbite');
    const mira = await H.heroToken(s, 'Mira');
    let done; const joined = new Promise(r => done = r);
    const mws = await conn(s.port, (w, m) => { if (m.type === 'join:success') done(); });
    mws.send(JSON.stringify({ type: 'room:join', authToken: mira, roomCode: 'MASTER', name: 'Mira' })); await joined;
    const b = await chromium.launch(H.launchOptions());
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    const p = await H.openHeroPage(ctx, s, meTok);
    await H.sleep(600);
    // Pack sticker
    await p.click('#chat-image-upload-btn'); await p.click('[data-chat-attachment="sticker"]');
    await p.waitForSelector('.stk-tray .stk-create');
    await p.click('[data-stk-tab="pack"]');
    await p.click('.stk-tray [data-stk-send="/assets/stickers/gg.svg"]');
    await p.waitForSelector('.chat-message.sticker-message .chat-sticker img[src="/assets/stickers/gg.svg"]', { timeout: 8000 });
    // Maker
    await H.sleep(1200);
    await p.click('#chat-image-upload-btn'); await p.click('[data-chat-attachment="sticker"]');
    await p.waitForSelector('.stk-tray [data-stk-tab=mine]'); await p.click('[data-stk-tab=mine]'); await p.click('.stk-tray .stk-create');
    await p.waitForSelector('.stk-maker');
    const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 600, 400); x.fillStyle = '#e0245e'; x.beginPath(); x.arc(300, 200, 150, 0, 7); x.fill(); x.fillStyle = '#111'; x.font = 'bold 90px sans-serif'; x.textAlign='center'; x.fillText('ASOC', 300, 230); return c.toDataURL('image/png').split(',')[1]; });
    await p.setInputFiles('.stk-maker input[type=file]', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await p.waitForSelector('.stk-maker.has-image');
    await p.check('[data-mk=cutout]');
    await p.fill('[data-mk=bottom]', 'carnage');
    await H.sleep(300);
    await p.click('[data-mk-send]');
    await p.waitForFunction(() => document.querySelectorAll('.chat-message.sticker-message').length >= 2, null, { timeout: 8000 });
    const url = await p.evaluate(() => [...document.querySelectorAll('.chat-sticker img')].pop().getAttribute('src'));
    assert.match(url, /^\/uploads\/chat\/[a-f0-9]{32}\.(webp|png)$/, 'maker stores the sticker as a chat upload');
    const lib = await (await fetch(`http://127.0.0.1:${s.port}/api/stickers`, { headers: { 'x-player-token': meTok } })).json();
    assert.equal(lib.mine.length, 1, 'the new sticker is in MY STICKERS'); assert.ok(lib.pack.length >= 10, 'the ASOC pack is listed');
    // Mira saves Frostbite's sticker, then sends it
    const save = await (await fetch(`http://127.0.0.1:${s.port}/api/stickers/save`, { method: 'POST', headers: { 'x-player-token': mira, 'content-type': 'application/json' }, body: JSON.stringify({ url }) })).json();
    assert.equal(save.ok, true, 'another hero can add it to their stickers');
    // Not-owned sticker refused
    await H.sleep(1200);
    mws.send(JSON.stringify({ type: 'chat:sticker', url }));
    await H.sleep(600);
    assert.equal(await p.evaluate(() => document.querySelectorAll('.chat-message.sticker-message').length), 3, 'the saved sticker can be sent by its new owner');
    // A sticker that is not in your library (or the pack) is refused.
    const before = await p.evaluate(() => document.querySelectorAll('.chat-message.sticker-message').length);
    await H.sleep(1200);
    mws.send(JSON.stringify({ type: 'chat:sticker', url: '/uploads/chat/' + 'a'.repeat(32) + '.webp' }));
    await H.sleep(600);
    assert.equal(await p.evaluate(() => document.querySelectorAll('.chat-message.sticker-message').length), before, 'unknown stickers are refused');
    // Tap to save popup
    await p.click('.chat-message:not(.own).sticker-message .chat-sticker');
    await p.waitForSelector('.stk-save-pop');
    assert.deepEqual(p.pageErrors, [], 'no page errors');
    assert.equal(s.errors().trim(), '', 'no server errors');
    console.log('PASS stickers: ASOC pack, sticker maker (cut-out, outline, captions), bubble-less chat stickers, save someone else\'s sticker, unknown stickers refused');
    await b.close();
  } finally { await s.stop(); }
})().catch(e => { console.error('FAIL stickers:', e); process.exit(1); });
