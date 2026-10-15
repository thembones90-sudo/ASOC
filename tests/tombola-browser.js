'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
const shots = path.join(__dirname, '..', '.scratch', 'tombola-visuals');
(async () => {
  const server = await H.startServer({ port: 19831 });
  let browser;
  const pages = [];
  try {
    fs.mkdirSync(shots, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await gmContext.addInitScript(token => { sessionStorage.setItem('asoc_gm_token', token); localStorage.setItem('asoc_master_token', token); }, login.data.token);
    const gm = await gmContext.newPage(); const errors = [];
    pages.push(gm);
    gm.on('pageerror', e => errors.push(e.message));
    await gm.goto(server.base + '/index.html');
    await gm.waitForFunction(() => window.App?.roomCode === 'MASTER' && window.App?.mode === 'multiplayer');
    await gm.locator('#gm-minigames-toggle').click();
    const mudCard = gm.locator('[data-gm-minigame="mudpits"]');
    await mudCard.locator('img.mudpits-menu-art').evaluate(img => img.decode());
    const mudSizes = await mudCard.evaluate(node => {
      const size = () => { const r = node.getBoundingClientRect(); return [r.width, r.height]; };
      const withIcon = size(), img = node.querySelector('img'); img.remove();
      const withoutIcon = size(); node.prepend(img); return { withIcon, withoutIcon };
    });
    assert.deepEqual(mudSizes.withIcon, mudSizes.withoutIcon, 'Mud Pits icon preserves card dimensions');
    await mudCard.screenshot({ path: path.join(shots, 'mudpits-menu-icon.png') });
    await mudCard.click();
    await gm.locator('[data-mudpits-contestant]').first().waitFor();
    await gm.locator('[data-gm-minigame-close]').click();
    await gm.locator('#gm-minigames-toggle').click();
    assert.equal(await gm.locator('[data-gm-minigame="sibicar"], [data-gm-minigame="concoction"]').count(), 0);
    assert.equal(await gm.evaluate(() => typeof window.SibicarUI), 'undefined');
    await gm.locator('[data-gm-minigame="tombola"] .tombola-mini-icon img').evaluate(img => img.decode());
    assert.equal(await gm.locator('[data-gm-minigame="tombola"] .minigame-title').textContent(), 'FATEBREAKER');
    await gm.locator('[data-gm-minigame="tombola"]').screenshot({ path: path.join(shots, 'gm-menu-icon.png') });
    await gm.locator('[data-gm-minigame="tombola"]').click();
    await gm.locator('[data-tombola-action="create"]').click();
    await gm.locator('[data-tombola-action="start"]').waitFor();
    assert.equal(await gm.locator('#tombola-overlay h2').textContent(), 'FATEBREAKER');
    assert.equal(await gm.locator('#tombola-overlay').getAttribute('aria-label'), 'FATEBREAKER');
    assert.match(await gm.locator('.tombola-turn').textContent(), /SIGNUP 0[12]:\d{2}/);
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const alpha = await H.openHeroPage(desktop, server, await H.heroToken(server, 'Tombola Alpha'));
    const beta = await H.openHeroPage(phone, server, await H.heroToken(server, 'Tombola Beta'));
    pages.push(alpha, beta);
    for (const page of [alpha, beta]) {
      page.on('pageerror', e => errors.push(e.message));
      await page.locator('[data-tombola-invite-dismiss]').click();
      await page.locator('#casual-minigames-toggle').click();
      assert.equal(await page.locator('#minigames-sibicar, #minigames-unstable-concoction').count(), 0);
      assert.deepEqual(await page.evaluate(() => [typeof window.SibicarUI, typeof window.UnstableConcoction]), ['undefined', 'undefined']);
      await page.locator('#minigames-tombola .tombola-mini-icon img').evaluate(img => img.decode());
      assert.equal(await page.locator('#minigames-tombola .minigame-title').textContent(), 'FATEBREAKER');
      await page.locator('#minigames-tombola').screenshot({ path: path.join(shots, page === alpha ? 'desktop-menu-icon.png' : 'mobile-menu-icon.png') });
      await page.locator('#minigames-tombola').click();
      await page.locator('[data-tombola-action="join"]').click();
      await page.locator('[data-tombola-action="leave"]').waitFor();
      assert.equal(await page.locator('#tombola-overlay h2').textContent(), 'FATEBREAKER');
      assert.match(await page.locator('.tombola-turn').textContent(), /SIGNUP 0[12]:\d{2}/);
    }
    await gm.locator('[data-tombola-action="start"]').click();
    await alpha.waitForFunction(() => document.querySelector('.tombola-turn')?.textContent.includes('CYCLE 1'));
    for (const [name, page] of [['desktop', alpha], ['mobile', beta]]) {
      assert.equal(await page.locator('[data-tombola-field]').count(), 36);
      const numbers = await page.locator('.tombola-number').allTextContents();
      assert.deepEqual(numbers, Array.from({ length: 36 }, (_, i) => String(i + 1)));
      const geometry = await page.locator('.tombola-board').evaluate(node => {
        const r = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return { width: r.width, height: r.height, left: r.left, right: r.right, viewport: innerWidth, columns: style.gridTemplateColumns.split(' ').length,
          rows: style.gridTemplateRows.split(' ').length, assets: getComputedStyle(node.querySelector('.tombola-field')).backgroundImage };
      });
      assert.ok(Math.abs(geometry.width - geometry.height) < 1); assert.equal(geometry.columns, 6); assert.equal(geometry.rows, 6);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport); assert.ok(geometry.assets.includes('vault-numberless.png'));
      assert.ok(await page.locator('.tombola-number').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16));
      await page.screenshot({ path: path.join(shots, `${name}-closed.png`) });
    }
    const motions = { blessing: 'tombola-blessing-open', curse: 'tombola-curse-open', blood_tribute: 'tombola-blood-open', grail: 'tombola-grail-open' };
    const checkedMotions = new Set();
    // Read the private test fixture on disk, never expose concealed outcomes through a browser API.
    const deck = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'active-rooms.json'), 'utf8')).rooms[0].tombola.inventory;
    const fieldsToOpen = ['BLESSING', 'CURSE', 'GRAIL', 'BLOOD_TRIBUTE'].map(kind => deck.findIndex(f => f.kind === kind) + 1);
    for (const [index, field] of fieldsToOpen.entries()) {
      await alpha.waitForFunction(() => document.querySelector('.tombola-turn')?.textContent.includes('CYCLE'));
      const actor = await alpha.locator('[data-tombola-field]:not([disabled])').count() ? alpha : beta;
      await actor.locator(`[data-tombola-field="${field}"]:not([disabled])`).waitFor();
      await actor.locator(`[data-tombola-field="${field}"]`).click();
      for (const page of [alpha, beta]) await page.locator(`[data-tombola-field="${field}"]:not(.is-closed)`).waitFor();
      const tile = alpha.locator(`[data-tombola-field="${field}"]`);
      if (deck[field - 1].kind === 'GRAIL') {
        for (const page of [alpha, beta, gm]) { await page.locator('.tombola-legendary-event').waitFor(); assert.match(await page.locator('.tombola-legendary-event').textContent(), /THE GRAIL.*\+50 SC/); }
        const bannerStyle = await alpha.locator('.tombola-legendary-event').evaluate(node => {
          node.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 400; });
          const style = getComputedStyle(node); return { background: style.backgroundImage, border: parseFloat(style.borderTopWidth) };
        });
        assert.notEqual(bannerStyle.background, 'none'); assert.ok(bannerStyle.border >= 1);
        await alpha.locator('.tombola-legendary-event').screenshot({ path: path.join(shots, 'grail-legendary-banner.png'), animations: 'allow' });
        assert.equal(await alpha.locator('.tombola-legendary-event').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
      }
      const motion = await tile.evaluate(node => ({ kind: ['blessing', 'curse', 'blood_tribute', 'grail'].find(kind => node.classList.contains('is-' + kind)), animation: getComputedStyle(node).animationName }));
      if (!checkedMotions.has(motion.kind)) {
        assert.equal(motion.animation, motions[motion.kind]);
        checkedMotions.add(motion.kind);
        await alpha.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await tile.evaluate(node => getComputedStyle(node).animationName), 'none');
        assert.equal(await tile.locator('.tombola-reveal-fx').evaluate(node => getComputedStyle(node).display), 'none');
        await alpha.emulateMedia({ reducedMotion: 'no-preference' });
        await tile.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 260; }));
        await tile.screenshot({ path: path.join(shots, `reveal-${motion.kind}.png`), animations: 'allow' });
        await tile.evaluate(node => node.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
        await alpha.waitForFunction(n => !document.querySelector(`[data-tombola-field="${n}"]`)?.classList.contains('is-new-reveal'), field);
        assert.equal(await tile.locator('.tombola-reveal-fx').count(), 0, 'temporary effects clean up after reveal');
      }
      if (index < fieldsToOpen.length - 1) {
        assert.equal(await alpha.locator('.tombola-blood-verdict').count(), 0);
        assert.equal(await beta.locator('#bm-demand-notice').count(), 0);
      }
    }
    await gm.locator('.tombola-blood-verdict').waitFor();
    assert.equal(checkedMotions.size, 4, 'all four distinct animations verified');
    assert.equal(await alpha.locator('.is-grail').count(), 1);
    assert.match(await alpha.locator('.is-grail').textContent(), /THE GRAIL.*\+50/);
    // Re-sync/reopening must not replay historical reveal effects.
    await gm.evaluate(() => window.TombolaUI.open());
    assert.equal(await gm.locator('.is-new-reveal').count(), 0);
    for (const [name, page] of [['desktop', alpha], ['mobile', beta]]) {
      await page.locator('.tombola-blood-verdict').waitFor();
      assert.equal(await page.locator('[data-tombola-field]:not([disabled])').count(), 0);
      assert.equal(await page.locator('[data-tombola-field]:not(.is-closed)').count(), 4);
      assert.equal(await page.locator('[data-tombola-field].is-closed').count(), 32, 'Blood Tribute stops the round with unopened vaults intact');
      const required = await page.locator('#tombola-required-veil').count();
      if (required) {
        assert.ok(await page.locator('[data-tombola-close]').isDisabled());
        if (await page.locator('#bm-demand-notice').count()) await page.locator('[data-bm-pay-debt]').click();
        else await page.locator('[data-tombola-pay]').click();
        await page.locator('[data-bm-close]').waitFor();
        assert.ok((await page.locator('#black-market-body').textContent()).includes('BLOOD TRIBUTE REQUIRED'));
        await page.locator('[data-bm-close]').click();
        await page.keyboard.press('Escape');
        assert.ok(await page.locator('#tombola-overlay').isVisible(), 'cannot dismiss required tribute');
        await page.reload();
        await page.locator('#tombola-required-veil').waitFor();
        assert.ok(await page.locator('[data-tombola-close]').isDisabled(), 'refresh cannot bypass requirement');
        await page.waitForFunction(() => window.BlackMarket?.pacts?.some(p => p.id.startsWith('pact-tombola-')));
        await page.locator('[data-tombola-pay]').click();
        await page.locator('[data-act="offer-tribute"]').click();
        const picker = page.waitForEvent('filechooser');
        await page.locator('[data-bm-consent-open]').click();
        await (await picker).setFiles({ name: 'tombola-test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64') });
        await page.locator('#tombola-required-veil').waitFor({ state: 'detached' });
        await page.locator('[data-bm-close]').click();
      }
      await page.screenshot({ path: path.join(shots, `${name}-finale.png`) });
      await page.locator('[data-tombola-close]').click();
      await page.locator('#chat-input').fill('Chat remains available after Tombola tribute submission');
      assert.deepEqual(page.pageErrors || [], []);
    }
    assert.deepEqual(errors, []);
    console.log('PASS FATEBREAKER V2 browser: 36 vaults, four reveals/reduced motion, shared legendary Grail +50 banner, immediate Blood ending with 32 closed fields, forced tribute/reconnect/upload');
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: path.join(shots, `failure-${i}.png`) });
      console.error(await pages[i].evaluate(() => ({ url: location.href, root: document.getElementById('tombola-overlay')?.innerText, player: window.PlayerApp?.playerId, gm: !!window.App, ws: window.PlayerApp?.ws?.readyState })));
    }
    throw error;
  } finally { if (browser) await browser.close(); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
