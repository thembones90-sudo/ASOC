// STICKERS on the Shadow Broker console: the + menu offers STICKERS, the GM
// sends pack stickers and makes their own (own library), and Little Hero
// stickers render bubble-less in the GM feed.
'use strict';
const assert = require('assert/strict');
const H = require('./lib/browser-harness');
const { chromium } = require('playwright');
(async () => {
  const s = await H.startServer({ port: Number(process.env.ASOC_STICKERS_GM_PORT) || 18973 });
  try {
    const b = await chromium.launch(H.launchOptions());
    const heroTok = await H.heroToken(s, 'Chavez');
    const hp = await H.openHeroPage(await b.newContext({ viewport: { width: 1400, height: 900 } }), s, heroTok);
    await H.sleep(1200);
    const gc = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    const tok = (await s.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token;
    await gc.addInitScript(t => sessionStorage.setItem('asoc_gm_token', t), tok);
    const g = await gc.newPage();
    const errs = []; g.on('pageerror', e => errs.push(e.message));
    await g.goto(s.base + '/index.html');
    await g.waitForFunction(() => window.App?.roomCode === 'MASTER', null, { timeout: 15000 });
    await H.sleep(800);
    await g.click('#gm-image-upload-btn');
    await g.click('[data-gm-attachment="sticker"]');
    await g.waitForSelector('.stk-tray [data-stk-tab]');
    await g.click('[data-stk-tab="pack"]');
    await g.click('.stk-tray [data-stk-send="/assets/stickers/lovely-carnage.svg"]');
    await hp.waitForSelector('.sticker-message .chat-sticker img[src="/assets/stickers/lovely-carnage.svg"]', { timeout: 8000 });
    await g.waitForSelector('#gm-chat-messages .sticker-message .chat-sticker', { timeout: 8000 });
    // GM creates their own
    await g.click('#gm-image-upload-btn'); await g.click('[data-gm-attachment="sticker"]');
    await g.waitForSelector('.stk-tray [data-stk-tab]'); await g.click('[data-stk-tab="mine"]'); await g.click('.stk-tray .stk-create');
    const png = await g.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#123'; x.fillRect(0, 0, 300, 300); x.fillStyle = '#9b5de0'; x.fillRect(60, 60, 180, 180); return c.toDataURL('image/png').split(',')[1]; });
    await g.setInputFiles('.stk-maker input[type=file]', { name: 'g.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await g.waitForSelector('.stk-maker.has-image');
    await g.click('[data-mk-send]');
    await hp.waitForFunction(() => document.querySelectorAll('.sticker-message .chat-sticker').length >= 2, null, { timeout: 8000 });
    // Hero player chat sticker shows in GM feed
    await H.sleep(1200);
    await hp.click('#chat-image-upload-btn'); await hp.click('[data-chat-attachment="sticker"]');
    await hp.waitForSelector('.stk-tray [data-stk-tab]'); await hp.click('[data-stk-tab="pack"]');
    await hp.click('.stk-tray [data-stk-send="/assets/stickers/gg.svg"]');
    await g.waitForSelector('#gm-chat-messages .sticker-message .chat-sticker img[src="/assets/stickers/gg.svg"]', { timeout: 8000 });
    await H.sleep(500);
    assert.deepEqual(errs, [], 'no GM page errors');
    assert.deepEqual(hp.pageErrors, [], 'no player page errors');
    assert.equal(s.errors().trim(), '', 'no server errors');
    console.log('PASS GM stickers: STICKERS in the Shadow Broker + menu, pack + own stickers reach players, Little Hero stickers render in the GM feed');
    await b.close();
  } finally { await s.stop(); }
})().catch(e => { console.error('FAIL GM stickers:', e); process.exit(1); });
