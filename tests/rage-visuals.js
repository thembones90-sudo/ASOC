'use strict';
// Real entry-point CSS/JS, deterministic snapshots from the real rules engine.
// tests/rage.js separately exercises the authenticated server/WebSocket flow.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const R = require('../rage');
const H = require('./lib/browser-harness');
const shots = path.join(__dirname, '..', '.scratch', 'rage-visuals');

function fixture(kind = 'capture') {
  const ids = ['a', 'b', 'c', 'd'];
  const s = R.createLobby({ id: 'a', name: 'ALPHA' }, {}, Date.now());
  ids.slice(1).forEach(id => R.join(s, { id, name: id.toUpperCase() }));
  ids.forEach((id, i) => R.pickColor(s, id, R.COLORS[i]));
  R.start(s, 'a', new Set(ids), Date.now()); R.begin(s, Date.now());
  s.players.a.pieces = [0, kind === 'home' ? 37 : 5, -1, -1];
  s.players.b.pieces = [kind === 'home' ? -1 : 38, -1, -1, -1]; // seat 1 + 38 = square 8
  R.roll(s, 'a', s.turnSeq, Date.now(), () => 3);
  const before = R.view(s, 'a');
  assert.equal(R.move(s, 'a', 1, s.turnSeq, Date.now()).ok, true);
  const after = R.view(s, 'a');
  if (kind === 'capture') assert.ok(after.events.some(e => e.kind === 'capture'));
  return { before, after };
}

(async () => {
  const server = await H.startServer({ port: 19836 });
  let browser;
  try {
    fs.mkdirSync(shots, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const errors = [];
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      // Use the exact resources referenced by both shipping HTML entry points,
      // without letting background live-room sync overwrite controlled snapshots.
      const html = fs.readFileSync(path.join(__dirname, '..', mobile ? 'join.html' : 'index.html'), 'utf8');
      const css = html.match(/href="(css\/rage.css[^\"]*)"/)[1];
      const js = html.match(/src="(js\/rage-game.js[^\"]*)"/)[1];
      await page.route('**/rage-visual-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#09080c"></body></html>' }));
      await page.goto(server.base + '/rage-visual-fixture');
      await page.addStyleTag({ url: server.base + '/' + css });
      await page.evaluate(() => { window.PlayerApp = { playerId: 'a', roomMode: 'CASUAL', send() {} }; });
      await page.addScriptTag({ url: server.base + '/' + js });
      const { before, after } = fixture();
      const load = state => page.evaluate(s => {
        const r = window.RageGame;
        r.ensureOverlay().hidden = false; r.open = true; r.chat = false;
        r.onState(s);
      }, state);
      await load(before);
      assert.equal(await page.locator('.rage-piece svg').count(), 16);
      assert.equal(await page.locator('.rage-sq.is-start').count(), 4);
      assert.equal(await page.locator('.rage-sq.is-home').count(), 16);
      assert.equal(await page.locator('.rage-corner.is-active').count(), 1);
      assert.equal(await page.locator('.rage-court').count(), 4);
      assert.equal(await page.locator('.rage-home-seals i').count(), 16);
      assert.equal(await page.locator('.rage-pawn-visor').count(), 16);
      assert.equal(await page.locator('linearGradient').evaluateAll(els => new Set(els.map(e => e.id)).size), 16, 'piece metal gradients have unique IDs');
      assert.equal(await page.locator('.rage-altar-label').textContent(), 'THE BONES DECIDE');
      assert.match(await page.locator('[data-key="a:1"]').getAttribute('aria-label'), /move/);
      await page.evaluate(() => { PlayerApp.send = message => { window.lastRageCommand = message; }; });
      await page.locator('[data-key="a:1"]').click();
      assert.deepEqual(await page.evaluate(() => window.lastRageCommand), { type: 'rage:move', piece: 1, turnSeq: before.turnSeq });
      assert.equal(await page.locator('.rage-sq.is-home').first().textContent(), '⌂');
      const box = await page.locator('.rage-board').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= (mobile ? 390 : 1440), 'board fits viewport');
      await page.screenshot({ path: path.join(shots, mobile ? 'mobile-table.png' : 'desktop-table.png') });
      await load(after);
      await page.locator('.rage-kill').waitFor();
      assert.equal(await page.locator('.rage-kill i').count(), 10);
      await page.screenshot({ path: path.join(shots, mobile ? 'mobile-capture.png' : 'desktop-capture.png') });
      await load(after); // duplicate packets must not replay effects
      assert.equal(await page.locator('.rage-kill').count(), 1);
      await page.waitForFunction(() => !document.querySelector('.rage-kill, .is-sent-back, .is-defeated'));
      assert.equal(await page.locator('[data-key="b:0"]').evaluate(el => el.style.left), '86.364%');
      assert.equal(await page.locator('[data-key="b:0"]').evaluate(el => el.style.top), '4.545%');
      // Closing during movement cancels every animation timer; reopening
      // baselines the authoritative final state rather than replaying kills.
      await page.evaluate(() => { RageGame.hide(); RageGame.seen = null; RageGame.positions = {}; });
      await load(before); await load(after);
      await page.evaluate(() => RageGame.hide());
      assert.equal(await page.evaluate(() => RageGame.motionTimers.size), 0);
      await page.evaluate(() => { RageGame.open = true; RageGame.ensureOverlay().hidden = false; RageGame.render(true); });
      assert.equal(await page.locator('.rage-kill').count(), 0);
      await page.evaluate(() => { RageGame.seen = null; RageGame.positions = {}; RageGame.render(true); });
      await load(before); await load(after);
      await page.locator('.rage-kill').waitFor();
      await load({ ...before, id: before.id + '-next' });
      assert.equal(await page.locator('.rage-kill').count(), 0, 'new game clears old capture');
      assert.equal(await page.evaluate(() => RageGame.motionTimers.size), 0);
      // A real rules-engine move into the home lane gets one seal, without
      // changing authoritative coordinates or replaying on duplicate packets.
      const home = fixture('home');
      await load(home.before); await load(home.after);
      await page.locator('[data-key="a:1"].is-sealing').waitFor();
      assert.equal(await page.locator('.rage-home-seals .is-filled').count(), 1);
      assert.equal(await page.locator('[data-key="a:1"]').evaluate(el => el.style.left), '13.636%');
      assert.equal(await page.locator('[data-key="a:1"]').evaluate(el => el.style.top), '50%');
      await page.waitForFunction(() => !document.querySelector('.is-sealing'));
      await load(home.after);
      assert.equal(await page.locator('.is-sealing').count(), 0);
      await page.evaluate(() => RageGame.rollDie(6));
      await page.waitForFunction(() => document.querySelector('#rage-die').getAttribute('aria-label') === 'Die: 6' && !document.querySelector('#rage-die.is-rolling'));
      assert.equal(await page.locator('#rage-die s.on').count(), 6);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => { RageGame.seen = null; RageGame.positions = {}; RageGame.render(true); });
      await load(before); await load(after);
      assert.equal(await page.locator('.rage-kill').count(), 0);
      assert.match(await page.locator('#rage-flash').textContent(), /SENT BACK/);
      assert.equal(await page.locator('[data-key="b:0"]').evaluate(el => el.style.top), '4.545%');
      assert.equal(await page.locator('.rage-sent').evaluate(el => getComputedStyle(el).animationName), 'none');
      await load(null);
      await page.locator('#rage-game-mode').selectOption('SHORT');
      await page.locator('[data-rage="create-fun"]').click();
      assert.deepEqual(await page.evaluate(() => window.lastRageCommand), { type: 'rage:create', stake: 0, gameMode: 'SHORT' });
      await page.locator('#rage-stake').fill('3');
      await page.locator('[data-rage="create-coins"]').click();
      assert.deepEqual(await page.evaluate(() => window.lastRageCommand), { type: 'rage:create', stake: 3, gameMode: 'SHORT' });
      const short = R.createLobby({ id: 'a', name: 'Alpha' }, { gameMode: 'SHORT' }, Date.now());
      const ids = ['a', 'b', 'c', 'd'];
      ids.slice(1).forEach(id => R.join(short, { id, name: id }));
      ids.forEach((id, i) => R.pickColor(short, id, R.COLORS[i]));
      await load(R.view(short, 'a'));
      assert.match(await page.locator('.rage-lobby-terms').textContent(), /SHORT.*2 PIECES EACH/s);
      R.start(short, 'a', new Set(ids), Date.now()); R.begin(short, Date.now());
      await load(R.view(short, 'a'));
      assert.equal(await page.locator('.rage-board.is-short').count(), 1);
      assert.equal(await page.locator('.rage-piece').count(), 8);
      assert.equal(await page.locator('.rage-sq.is-home').count(), 8);
      assert.equal(await page.locator('.rage-sq.is-yard').count(), 8);
      assert.equal(await page.locator('.rage-home-seals i').count(), 8);
      assert.match(await page.locator('.rage-title small').textContent(), /TWO HOME/);
      assert.match(await page.locator('#rage-players').textContent(), /0\/2 HOME/);
      await page.screenshot({ path: path.join(shots, mobile ? 'mobile-short-table.png' : 'desktop-short-table.png') });
      await context.close();
    }
    // Also render inside the actual GM page to catch global style collisions.
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(token => { sessionStorage.setItem('asoc_gm_token', token); localStorage.setItem('asoc_master_token', token); }, login.data.token);
    const gm = await context.newPage();
    gm.on('pageerror', e => errors.push(e.message));
    await gm.goto(server.base + '/index.html');
    await gm.waitForFunction(() => window.App?.roomCode === 'MASTER' && window.App?.mode === 'multiplayer');
    await gm.evaluate(state => {
      // Presentation fixture only; no mutation of server room state.
      App.roomMode = 'CASUAL';
      RageGame.open = true; RageGame.ensureOverlay().hidden = false; RageGame.onState(state);
    }, fixture().before);
    await gm.screenshot({ path: path.join(shots, 'gm-integrated-table.png') });
    assert.equal(await gm.locator('.rage-piece svg').count(), 16);
    assert.equal(await gm.locator('#rage-board').evaluate(el => getComputedStyle(el).aspectRatio), '1 / 1');
    await context.close();
    assert.deepEqual(errors, []);
    console.log('PASS rage visuals: desktop/mobile, engine capture, 10 shards, yard return, duplicate updates, cancellation, reduced motion');
  } finally { if (browser) await browser.close(); await server.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
