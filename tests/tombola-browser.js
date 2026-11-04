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
    const fieldsToOpen = ['BLESSING', 'CURSE', 'GRAIL'].map(kind => deck.findIndex(f => f.kind === kind) + 1);
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
    const bloodField = deck.findIndex(f => f.kind === 'BLOOD_TRIBUTE') + 1;
    const debtor = await alpha.locator('[data-tombola-field]:not([disabled])').count() ? alpha : beta;
    await debtor.locator(`[data-tombola-field="${bloodField}"]`).click();
    for (const page of [gm, alpha, beta]) {
      await page.locator('#tombola-overlay').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#tombola-restore').isVisible(), false, 'ended game has no restore badge');
      assert.equal(await page.locator('#tombola-required-veil').count(), 0, 'debt never forces an ended game over chat');
      await page.evaluate(() => TombolaUI.open());
      assert.equal(await page.locator('#tombola-overlay').isVisible(), false, 'manual open cannot resurrect an ended board');
    }
    assert.equal(checkedMotions.size, 3, 'active-round reward animations remain intact');
    const ended = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'active-rooms.json'), 'utf8')).rooms[0].tombola;
    assert.equal(ended.phase, 'ENDED'); assert.equal(ended.reveals.length, 4, 'Blood still seals the round immediately');
    await debtor.waitForFunction(() => BlackMarket.pacts.some(p => p.id.startsWith('pact-tombola-')));
    const pactId = await debtor.evaluate(() => BlackMarket.pacts.find(p => p.id.startsWith('pact-tombola-')).id);
    if (await debtor.locator('#bm-demand-notice').count()) await debtor.locator('[data-bm-pay-debt]').click();
    else await debtor.evaluate(() => BlackMarket.open());
    await debtor.locator('[data-bm-close]').click();
    await debtor.locator('#chat-input').fill('Chat is clear while tribute remains owed');
    await debtor.reload(); await debtor.locator('#game-screen.active').waitFor();
    await debtor.waitForFunction(() => BlackMarket.pacts.some(p => p.id.startsWith('pact-tombola-')));
    assert.equal(await debtor.locator('#tombola-overlay').isVisible(), false, 'refresh never reopens the ended board for its debtor');
    assert.equal(await debtor.locator('#tombola-restore').isVisible(), false);
    await debtor.evaluate(() => BlackMarket.open());
    assert.match(await debtor.locator('#black-market-body').textContent(), /LEVEL 10 \/ 10/);
    const upload = async name => {
      await debtor.locator('[data-act="offer-tribute"]').click();
      const picker = debtor.waitForEvent('filechooser'); await debtor.locator('[data-bm-consent-open]').click();
      await (await picker).setFiles({name, mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64')});
      await debtor.waitForFunction(id=>BlackMarket.pacts.some(p=>p.id===id&&p.state==='TRIBUTE_SUBMITTED'),pactId);
    };
    await upload('first.png');
    await gm.evaluate(id=>App.send({type:'blackMarket:tributeJudge',pactId:id,accepted:false,comment:'Replacement required'}),pactId);
    await debtor.waitForFunction(id=>BlackMarket.pacts.some(p=>p.id===id&&p.state==='TRIBUTE_REJECTED'),pactId);
    assert.equal(await debtor.locator('#tombola-overlay').isVisible(), false, 'rejection does not resurrect the ended board');
    assert.equal(await debtor.locator('#tombola-restore').isVisible(), false);
    await upload('replacement.png'); await debtor.locator('[data-bm-close]').click();
    for (const page of [gm,alpha,beta]) {
      await page.reload();
      await page.waitForFunction(()=>window.App?.roomCode==='MASTER'||document.querySelector('#game-screen.active'));
      assert.equal(await page.locator('#tombola-overlay').isVisible(),false,'all roles stay clear after refresh');
      assert.equal(await page.locator('#tombola-restore').isVisible(),false);
    }
    // GM X cancels on the server; minus only minimizes locally.
    for (const phase of ['LOBBY', 'PLAYING']) {
      await gm.evaluate(() => TombolaUI.activate());
      await gm.locator('[data-tombola-action="start"]').waitFor();
      for (const page of [alpha, beta]) {
        await page.locator('[data-tombola-invite-join]').click();
        await page.locator('[data-tombola-action="leave"]').waitFor();
      }
      if (phase === 'PLAYING') {
        await gm.locator('[data-tombola-action="start"]').click();
        await gm.locator('[data-tombola-action="cancel"]').waitFor();
      }
      await gm.locator('[data-tombola-minimize]').click();
      await gm.locator('#tombola-overlay').waitFor({ state: 'hidden' });
      let saved = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'active-rooms.json'), 'utf8')).rooms[0].tombola;
      assert.equal(saved.phase, phase, 'minus preserves the live game');
      assert.equal(await gm.locator('#tombola-restore b').textContent(), 'FATEBREAKER', 'minimized dock names the game');
      if (phase === 'PLAYING') assert.match(await gm.locator('#tombola-restore small').textContent(), /\d+s/, 'dock retains the live turn timer');

      await gm.locator('#tombola-restore').click();
      await gm.locator('[data-tombola-action="toggle"]').click();
      await gm.waitForFunction(() => document.querySelector('[data-tombola-action="toggle"]')?.textContent.includes('SHOW FATEBREAKER'));
      for (const page of [alpha, beta]) await page.locator('#tombola-overlay').waitFor({ state: 'hidden' });
      await gm.locator('[data-tombola-action="toggle"]').click();
      for (const page of [alpha, beta]) await page.locator('#tombola-overlay').waitFor({ state: 'visible' });
      await gm.locator('[data-tombola-minimize]').click();

      await gm.locator('#tombola-restore').click();
      await gm.locator('[data-tombola-close]').click();
      for (const page of [gm, alpha, beta]) await page.locator('#tombola-overlay').waitFor({ state: 'hidden' });
      saved = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'active-rooms.json'), 'utf8')).rooms[0].tombola;
      assert.equal(saved.phase, 'CANCELLED', 'GM X cancels on the server');
      assert.equal(saved.visible, false, 'GM X removes the board for everyone');
      assert.equal(saved.turnEndsAt, null, 'cancelled game has no turn deadline');
      await alpha.reload(); await alpha.waitForFunction(() => !!window.TombolaUI);
      assert.equal(await alpha.locator('#tombola-overlay').isVisible(), false, 'cancelled board stays closed after refresh');
    }
    assert.deepEqual(errors, []);
    console.log('PASS FATEBREAKER browser: active reveals, immediate Blood ending, no ended board/badge/veil for any role, refresh/rejection stay clear, Black Market replacement, GM cancellation and restore');
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: path.join(shots, `failure-${i}.png`) });
      console.error(await pages[i].evaluate(() => ({ url: location.href, root: document.getElementById('tombola-overlay')?.innerText, player: window.PlayerApp?.playerId, gm: !!window.App, ws: window.PlayerApp?.ws?.readyState })));
    }
    throw error;
  } finally { if (browser) await browser.close(); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
