// SHADOW BROKER MEDIA layout guard: Broker images, GIFs and stickers come from
// ONE renderer (Skeleton.shadowBrokerMediaHTML) on both pages. On the hero
// chat AND the Broker console each must show the bare picture with the
// Broker's avatar to its RIGHT, level with its TOP -- no bubble, no header.
const assert = require('assert/strict');
const H = require('./lib/browser-harness');
const { chromium } = require('playwright');

const now = Date.now();
const MESSAGES = [
  { id: 'bm-image', source: 'shadowBroker', text: '', imageUrl: 'assets/transmog/void/avatar.webp', timestamp: now - 3000 },
  { id: 'bm-sticker', source: 'shadowBroker', messageType: 'sticker', text: '', imageUrl: '/assets/stickers/nice-try-dipshit.webp', timestamp: now - 2000 },
  { id: 'bm-gif', source: 'chatGifGm', messageType: 'gifRemote', playerName: 'SHADOW BROKER', gif: { gifUrl: 'assets/transmog/blood/avatar.webp', previewUrl: 'assets/transmog/blood/avatar.webp', title: 'gif' }, timestamp: now - 1000 }
];

async function check(page, scope, label) {
  await page.waitForFunction(scope => [...document.querySelectorAll(`${scope} .broker-bare img`)].every(img => img.complete), scope, { timeout: 8000 });
  await page.waitForTimeout(300);
  const results = await page.evaluate(({ ids, scope }) => ids.map(id => {
    const el = document.querySelector(`${scope} [data-message-id="${id}"]`);
    if (!el) return { id, missing: true };
    const media = el.querySelector('.broker-bare-main');
    const avatar = el.querySelector('.broker-bare-rail .shadow-broker-avatar');
    const m = media.getBoundingClientRect(), a = avatar.getBoundingClientRect();
    const main = getComputedStyle(el.querySelector('.broker-bare-main'));
    return {
      id,
      shared: el.classList.contains('broker-bare'),
      avatarRight: a.left >= m.right - 1,
      gap: Math.round(a.left - m.right),
      topDelta: Math.round(Math.abs(a.top - m.top)),
      header: !!el.querySelector('.chat-message-header, .gm-shadow-broker-media-head, .chat-player-name'),
      bubble: main.backgroundColor !== 'rgba(0, 0, 0, 0)' || main.borderTopWidth !== '0px'
    };
  }), { ids: MESSAGES.map(m => m.id), scope });
  for (const r of results) {
    assert.ok(!r.missing, `${label} ${r.id} rendered`);
    assert.ok(r.shared, `${label} ${r.id} uses the shared Broker media renderer`);
    assert.ok(r.avatarRight, `${label} ${r.id}: avatar is to the right of the picture`);
    assert.ok(r.gap >= 0 && r.gap <= 24, `${label} ${r.id}: avatar sits beside the picture (gap ${r.gap})`);
    assert.ok(r.topDelta <= 6, `${label} ${r.id}: avatar is level with the top of the picture (off by ${r.topDelta})`);
    assert.equal(r.header, false, `${label} ${r.id}: no header`);
    assert.equal(r.bubble, false, `${label} ${r.id}: no bubble`);
  }
}

(async () => {
  const s = await H.startServer({ port: 19471 });
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const hero = await H.openHeroPage(await browser.newContext({ viewport: { width: 1500, height: 950 } }), s, await H.heroToken(s, 'Media Hero'));
    const errors = [];
    hero.on('pageerror', e => errors.push('HERO ' + e.message));
    await hero.waitForTimeout(600);
    await hero.evaluate(m => PlayerApp.applyChatMessages(m, {}), MESSAGES);
    await check(hero, '#game-screen', 'hero');

    const gctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    const tok = (await s.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token;
    await gctx.addInitScript(t => sessionStorage.setItem('asoc_gm_token', t), tok);
    const gm = await gctx.newPage();
    gm.on('pageerror', e => errors.push('GM ' + e.message));
    await gm.goto(s.base + '/index.html');
    await gm.waitForFunction(() => window.App?.roomCode === 'MASTER', null, { timeout: 15000 });
    await gm.waitForTimeout(600);
    await gm.evaluate(m => App.applyChatMessages(m, {}), MESSAGES);
    await check(gm, '#gm-chat-messages', 'console');
    assert.deepEqual(errors, []);
    console.log('PASS broker media: image, GIF and sticker share one layout on both pages, avatar right and level with the top');
  } finally {
    await browser?.close();
    await s.stop();
  }
})().catch(error => { console.error(error); process.exit(1); });
