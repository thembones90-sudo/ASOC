'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
const { MODELS } = require('../beer-offers');
const base = path.join(__dirname, '..');
(async () => {
  let browser, server;
  const shots = path.join(base, '.scratch', 'beer'); fs.mkdirSync(shots, { recursive: true });
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setContent('<body style="margin:0;background:#101017"><button id="chat" style="position:fixed;left:5px;bottom:5px">CHAT STILL WORKS</button></body>');
      await page.addStyleTag({ path: path.join(base, 'css/beer.css') });
      await page.addScriptTag({ path: path.join(base, 'js/beer.js') });
      for (const variant of ['bottle', 'can', 'barrel']) {
        const event = { id: `${width}-${variant}`, variant, offeredBy: { name: '<Hero & GM>' } };
        await page.evaluate(event => AsocBeer.show(event), event);
        assert.equal(await page.locator('#asoc-beer-layer').getAttribute('data-variant'), variant);
        assert.equal(await page.locator('.asoc-beer-offerer').textContent(), '<Hero & GM>');
        assert.equal(await page.locator('.asoc-beer-particles i').count(), 24);
        assert.equal(await page.locator('.asoc-beer-offerer img').count(), 0);
        await page.locator('#chat').click(); // effect never captures gameplay input
        const box = await page.locator('.asoc-beer-panel').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 900);
        await page.waitForTimeout(850);
        await page.screenshot({ path: path.join(shots, `${width}-${variant}.png`) });
        await page.locator('[data-beer-refuse]').click();
        assert.equal(await page.locator('#asoc-beer-drunk').count(), 0, 'refusing has no effect');
        await page.evaluate(event => AsocBeer.show(event), event);
        assert.equal(await page.locator('#asoc-beer-layer').count(), 0, 'duplicate cannot replay');
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.install();
      await page.evaluate(() => AsocBeer.show({ id: 'reduced', variant: 'barrel', offeredBy: { name: 'Hero' } }));
      assert.equal(await page.locator('.asoc-beer-particles i').count(), 0);
      assert.equal(await page.locator('.asoc-beer-vessel').evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.clock.fastForward(5300);
      assert.equal(await page.locator('#asoc-beer-layer.is-awaiting-choice').count(), 1, 'choice remains after reveal');
      assert.equal(await page.locator('#asoc-beer-drunk').count(), 0, 'never automatically accepted');
      assert.equal(await page.locator('.asoc-beer-particles i').count(), 0, 'reveal particles cleaned');
      await page.locator('[data-beer-accept]').click();
      assert.equal(await page.locator('#asoc-beer-layer').count(), 0);
      assert.equal(await page.locator('#asoc-beer-drunk').getAttribute('data-strength'), '50');
      assert.equal(await page.locator('#asoc-beer-drunk').evaluate(el => getComputedStyle(el).backdropFilter), 'blur(6px)');
      await page.locator('#chat').click();
      await page.clock.fastForward(4999);
      assert.equal(await page.locator('#asoc-beer-drunk').count(), 1, 'blur lasts full five seconds');
      await page.clock.fastForward(1);
      assert.equal(await page.locator('#asoc-beer-drunk').count(), 0, 'blur removed at five seconds');
      assert.deepEqual(errors, []); await page.close();
    }
    server = await H.startServer({ port: 19857 });
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gmContext = await browser.newContext();
    await gmContext.addInitScript(token => { sessionStorage.setItem('asoc_gm_token', token); localStorage.setItem('asoc_master_token', token); }, login.data.token);
    const gm = await gmContext.newPage(); await gm.goto(server.base + '/');
    await gm.waitForFunction(() => App?.roomCode === 'MASTER');
    await gm.evaluate(() => App.send({ type: 'gm:setRoomMode', mode: 'CASUAL' }));
    const heroContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const hero = await H.openHeroPage(heroContext, server, await H.heroToken(server, 'Beer Hero'));
    await hero.waitForFunction(() => PlayerApp.roomMode === 'CASUAL');
    for (const page of [gm, hero]) await page.evaluate(() => {
      const show = AsocBeer.show;
      window.beerEvents = [];
      AsocBeer.show = event => { beerEvents.push(event); show(event); };
    });
    await hero.evaluate(() => PlayerApp.send({ type: 'chat:guess', text: '/beer', clientMsgId: 'beer-browser-1' }));
    await gm.waitForFunction(() => beerEvents.length === 1);
    await hero.waitForFunction(() => beerEvents.length === 1);
    const event = await hero.evaluate(() => beerEvents[0]);
    assert.equal(event.offeredBy.name, 'Beer Hero');
    assert.ok(['bottle', 'can', 'barrel'].includes(event.variant));
    assert.ok(MODELS[event.variant].includes(event.model));
    assert.equal(await gm.evaluate(() => beerEvents[0].id), event.id, 'everyone receives same server choice');
    await hero.locator('[data-beer-accept]').click();
    assert.equal(await hero.locator('#asoc-beer-drunk').count(), 1);
    assert.equal(await gm.locator('#asoc-beer-drunk').count(), 0, 'only accepting client gets blurred');
    await gm.evaluate(() => { AsocBeer.dismiss(); App.send({ type: 'gm:broadcast', text: '/beer' }); });
    await gm.waitForTimeout(400);
    assert.equal(await gm.evaluate(() => beerEvents.length), 1, 'GM shares room cooldown');
    await hero.reload(); await hero.waitForSelector('#game-screen.active');
    assert.equal(await hero.locator('#asoc-beer-layer').count(), 0, 'reconnect never replays toast');
    // Let the real room cooldown expire, then prove the GM can offer too.
    await gm.waitForTimeout(30000);
    await gm.evaluate(() => App.send({ type: 'gm:broadcast', text: '/beer' }));
    await gm.waitForFunction(() => beerEvents.length === 2);
    await hero.locator('#asoc-beer-layer').waitFor();
    assert.equal(await gm.evaluate(() => beerEvents[1].offeredBy.id), '__GM__');
    for (const [variant, models] of Object.entries(MODELS)) {
      for (const model of models) {
        await gm.evaluate(({ variant, model }) => AsocBeer.show({ id: 'art-' + model, variant, model, offeredBy: { name: 'Skynet Collection' } }), { variant, model });
        await gm.waitForFunction(() => { const img = document.querySelector('img.asoc-beer-vessel'); return img?.complete && img.naturalWidth > 0; });
        await gm.waitForTimeout(600);
        await gm.screenshot({ path: path.join(shots, `${model}.png`) });
        await gm.locator('[data-beer-refuse]').click();
      }
    }
    await gmContext.close(); await heroContext.close();
    console.log('PASS beer browser: three artworks desktop/mobile, safe names, input pass-through, dismissal, deduplication, reduced motion, cleanup; real player and GM offers, shared server variant, cooldown expiry, no reconnect replay');
  } finally { if (browser) await browser.close(); if (server) await server.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
