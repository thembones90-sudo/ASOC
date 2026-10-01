// SHADOW BROKER MIRROR -- broker transmissions are the reflection of a Little
// Hero row: bubble, gap, avatar on the right, on the GM console and the
// Little Hero chat. Guards the avatar ever landing under or inside the bubble.
'use strict';
const assert = require('assert/strict');
const H = require('./lib/browser-harness');
const { chromium } = require('playwright');
(async () => {
  const s = await H.startServer({ port: Number(process.env.ASOC_BROKER_MIRROR_PORT) || 18975 });
  try {
    const b = await chromium.launch(H.launchOptions());
    const tami = await H.openHeroPage(await b.newContext({ viewport: { width: 1600, height: 900 } }), s, await H.heroToken(s, 'Tami'));
    const gc = await b.newContext({ viewport: { width: 1811, height: 900 } });
    const tok = (await s.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token;
    await gc.addInitScript(t => sessionStorage.setItem('asoc_gm_token', t), tok);
    const g = await gc.newPage();
    await g.goto(s.base + '/index.html');
    await g.waitForFunction(() => window.App?.roomCode === 'MASTER', null, { timeout: 15000 });
    await H.sleep(800);
    await tami.fill('#chat-input', 'i uzivaj'); await tami.press('#chat-input', 'Enter'); await H.sleep(600);
    for (const t of ["@all It's my free day today", 'Blood tribute is up there, be my guest, we accept sacrifices', 'short one']) {
      await g.evaluate(t => { const c = document.getElementById('shadow-broker-composer'); c.textContent = t; c.dispatchEvent(new Event('input', { bubbles: true })); }, t);
      await g.press('#shadow-broker-composer', 'Enter'); await H.sleep(500);
    }
    await H.sleep(1000);
    await tami.fill('#chat-input', '@SHADOW BROKER taman da izadjes'); await tami.press('#chat-input', 'Enter'); await H.sleep(1200);
    const geometry = page => page.evaluate(sel => [...document.querySelectorAll(sel)].map(e => {
      const t = e.querySelector('.shadow-broker-transmission').getBoundingClientRect();
      const a = e.querySelector('.shadow-broker-avatar').getBoundingClientRect();
      return { gap: a.left - t.right, topDelta: Math.abs(a.top - t.top), size: a.width };
    }), '.gm-shadow-broker-entry, .chat-broker-entry');
    const check = (rows, label, size) => {
      assert.ok(rows.length >= 3, label + ': broker transmissions rendered');
      for (const row of rows) {
        assert.ok(row.gap >= 2 && row.gap <= 12, `${label}: avatar sits beside the bubble (gap ${row.gap})`);
        assert.ok(row.topDelta <= 4, `${label}: avatar is level with the bubble, not under it (${row.topDelta})`);
        assert.ok(Math.abs(row.size - size) <= 2, `${label}: avatar matches a Little Hero avatar (${row.size})`);
      }
    };
    check(await geometry(g), 'GM console', 44);
    check(await geometry(tami), 'Little Hero chat', 32);
    console.log('PASS broker mirror: bubble, gap, avatar on the right at Little Hero avatar size, on the GM console and the Little Hero chat');
    await b.close();
  } finally { await s.stop(); }
})().catch(e => { console.error('FAIL broker mirror:', e); process.exit(1); });
