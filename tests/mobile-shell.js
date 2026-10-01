// MOBILE SHELL (Mobile Alpha 0.1, step 4) in a real browser.
//   - off by default, even on a phone; the MOBILE VERSION button turns it on
//     and the choice survives a reload; DESKTOP VERSION turns it off
//   - CASUAL upright: chat fills the screen, composer visible and >= 16px
//     (no iOS focus zoom), no board, no sideways scroll
//   - battle upright: "turn your phone sideways" banner, chat still live
//   - battle sideways: board on top at full width, chat below
'use strict';

const assert = require('assert/strict');
const WebSocket = require('ws');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');

const PORT = Number(process.env.ASOC_MOBILE_SHELL_PORT) || 18991;

function gmSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.once('error', reject);
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1, clientBuild: 'test' }));
      if (m.type === 'protocol:ready') return ws.send(JSON.stringify({ type: 'host:recover', gmToken: token }));
      if (m.type === 'host:recovered') resolve(ws);
    });
  });
}

const layout = page => page.evaluate(() => {
  const box = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: r.x, y: r.y, w: r.width, h: r.height, display: cs.display, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 }; };
  return {
    mobile: document.documentElement.classList.contains('asoc-mobile'),
    vw: innerWidth, vh: innerHeight,
    scrollW: document.documentElement.scrollWidth,
    chat: box('#chat-messages'), form: box('#chat-form'), input: box('#chat-input'),
    board: box('#board-layer'), prompt: box('#m-rotate-prompt'),
    inputFont: parseFloat(getComputedStyle(document.getElementById('chat-input')).fontSize)
  };
});

(async () => {
  const server = await H.startServer({ port: PORT });
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
    const context = await browser.newContext(phone);
    const page = await H.openHeroPage(context, server, await H.heroToken(server, 'Pocket Hero'));

    // The stale-page build covers the mobile shell, so a mobile-only release
    // refreshes pages left open on phones.
    assert.match(await page.evaluate(() => window.StaleGuard.pageBuild('player')), new RegExp('\\+' + (await page.evaluate(() => document.querySelector('script[src*="js/mobile-shell.js"]').getAttribute('src').match(/v=([^&]+)/)[1])) + '$'), 'player build includes the mobile shell version');

    // Off by default, even on a phone -- only offered.
    let l = await layout(page);
    assert.equal(l.mobile, false, 'never switches itself on');
    assert.equal(await page.locator('#asoc-phone-offer').isVisible(), true, 'a phone is offered the MOBILE VERSION');

    // Engage via the button.
    await page.locator('#asoc-view-toggle-offer').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('asoc-mobile'));
    await H.sleep(300);
    l = await layout(page);
    assert.equal(l.board.visible, false, 'CASUAL: no board');
    assert.ok(l.chat.visible && l.chat.h > l.vh * 0.45, `CASUAL: chat fills the screen (h=${l.chat.h})`);
    assert.ok(l.form.visible && l.form.y + l.form.h <= l.vh + 1, 'composer fully on screen');
    assert.ok(l.inputFont >= 16, 'input is 16px+ (no iOS focus zoom)');
    assert.ok(l.scrollW <= l.vw + 1, `no sideways scroll (scrollWidth ${l.scrollW})`);
    assert.equal(await page.locator('#asoc-phone-offer').isVisible(), false, 'offer hidden once engaged');

    // Remembered across a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#game-screen.active', { timeout: 15000 });
    assert.equal((await layout(page)).mobile, true, 'choice survives a reload');

    // Chat still works inside the shell.
    await page.fill('#chat-input', 'hello from the pocket');
    await page.press('#chat-input', 'Enter');
    await page.waitForFunction(() => (PlayerApp.chatMessages || []).some(m => m.text === 'hello from the pocket'), null, { timeout: 8000 });

    // Step 5 tabs. PEOPLE lists the room (online first) and MESSAGE opens a
    // private conversation; PROFILE shows the hero and its actions.
    const friendToken = await H.heroToken(server, 'Pocket Friend');
    const friend = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      ws.once('error', reject);
      ws.on('message', raw => {
        const m = JSON.parse(raw.toString());
        if (m.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1, clientBuild: 'test' }));
        if (m.type === 'protocol:ready') return ws.send(JSON.stringify({ type: 'room:join', authToken: friendToken, roomCode: 'MASTER', name: 'Pocket Friend' }));
        if (m.type === 'join:success') resolve(ws);
      });
    });
    await page.click('#m-tabs [data-m-tab="people"]');
    await page.waitForFunction(() => document.querySelectorAll('#m-view-people .m-person').length >= 2, null, { timeout: 8000 });
    assert.equal(await page.locator('#chat-panel').isVisible(), false, 'PEOPLE replaces the chat view');
    assert.equal(await page.locator('#m-view-people .m-person.is-self').count(), 1, 'you are marked');
    assert.equal(await page.locator('#m-view-people .m-person.is-self .m-person-dm').count(), 0, 'no MESSAGE button on yourself');
    await page.locator('#m-view-people .m-person-dm').first().click();
    await page.waitForFunction(() => { const o = document.querySelector('.dmx-overlay'); return o && !o.hidden && getComputedStyle(o).display !== 'none'; }, null, { timeout: 8000 });
    await page.evaluate(() => window.DirectMessages.close());
    await page.click('#m-tabs [data-m-tab="profile"]');
    await page.waitForSelector('#m-view-profile .m-profile-card', { timeout: 8000 });
    assert.match(await page.locator('#m-view-profile .m-profile-name b').innerText(), /Pocket Hero/);
    await page.click('#m-view-profile [data-m-action="games"]');
    await page.waitForFunction(() => document.documentElement.classList.contains('m-games-open') && getComputedStyle(document.getElementById('casual-minigames-menu')).display !== 'none');
    await page.click('#m-games-close');
    await page.waitForFunction(() => !document.documentElement.classList.contains('m-games-open'));
    // Unread badge: a message arriving while away from CHAT is counted.
    friend.send(JSON.stringify({ type: 'chat:guess', text: 'while you were away' }));
    await page.waitForFunction(() => { const b = document.querySelector('#m-tabs [data-m-tab="chat"] .m-tab-badge'); return b && !b.hidden && Number(b.textContent) >= 1; }, null, { timeout: 8000 });
    await page.click('#m-tabs [data-m-tab="chat"]');
    assert.equal(await page.locator('#chat-panel').isVisible(), true, 'CHAT is back');
    assert.equal(await page.locator('#m-tabs [data-m-tab="chat"] .m-tab-badge').isHidden(), true, 'badge clears on CHAT');
    friend.close();

    // Battle held upright: banner + chat, no board.
    const gm = await gmSocket((await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token);
    gm.send(JSON.stringify({ type: 'gm:setRoomMode', mode: 'BATTLE' }));
    await page.waitForFunction(() => document.documentElement.dataset.mRoomMode && document.documentElement.dataset.mRoomMode !== 'CASUAL', null, { timeout: 8000 });
    await H.sleep(300);
    l = await layout(page);
    assert.equal(l.prompt.visible, true, 'upright battle: turn-sideways banner');
    assert.equal(l.board.visible, false, 'upright battle: no squeezed board');
    assert.ok(l.chat.visible && l.form.visible, 'upright battle: chat stays live');

    // Sideways: board on top at full width, chat below.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.documentElement.dataset.mOrientation === 'landscape');
    await H.sleep(400);
    l = await layout(page);
    assert.equal(l.prompt.visible, false, 'sideways: no banner');
    assert.ok(l.board.visible, 'sideways battle: board shown');
    assert.ok(l.board.w >= l.vw * 0.9, `board at full width (w=${l.board.w})`);
    assert.ok(l.chat.y >= l.board.y + l.board.h - 2, 'chat is below the board');
    assert.ok(l.scrollW <= l.vw + 1, 'no sideways scroll in landscape');

    // Pull to refresh: the shell pins the page, so it provides its own.
    // A long pull from the header arms it; a pull on a chat that is not at
    // its top does nothing.
    await page.setViewportSize({ width: 390, height: 844 });
    await H.sleep(300);
    const pull = (sel, dy) => page.evaluate(({ sel, dy }) => {
      const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const x = r.left + 30, y = r.top + 10;
      const t = cy => new Touch({ identifier: 1, target: el, clientX: x, clientY: cy });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(y)], changedTouches: [t(y)] }));
      for (let i = 1; i <= 10; i++) el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t(y + dy * i / 10)], changedTouches: [t(y + dy * i / 10)] }));
      const armed = document.getElementById('m-pull-refresh')?.classList.contains('is-armed') || false;
      el.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true, touches: [], changedTouches: [t(y + dy)] }));
      return armed;
    }, { sel, dy });
    assert.equal(await pull('#little-hero-hud', 220), true, 'a long pull from the header arms pull-to-refresh');
    assert.equal(await pull('#little-hero-hud', 50), false, 'a short pull does not');

    // Back to desktop from inside the shell.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#asoc-view-toggle-game').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('asoc-mobile'));
    gm.close();

    assert.deepEqual(page.pageErrors, [], 'no page errors');
    assert.equal(server.errors().trim(), '', `no server errors, got: ${server.errors().slice(0, 600)}`);
    console.log('PASS mobile shell: opt-in only, remembered, CHAT/PEOPLE/PROFILE tabs (room list, MESSAGE opens a DM, profile actions, mini-games sheet, unread badge), CASUAL chat-first layout (no board, 16px input, no sideways scroll), upright battle banner with live chat, sideways battle board-on-top with chat below, pull-to-refresh, DESKTOP VERSION switches back');
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
})().catch(error => {
  console.error('FAIL mobile shell:', error);
  process.exit(1);
});
