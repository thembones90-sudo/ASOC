// Ghost unread regression: when someone reads or reacts to an OLD message the
// server re-sends it as a chat:delta. A client that never loaded that part of
// history used to treat it as a brand-new message: the "↓ 1 CHAT" pill and
// the desktop badge went up, and the line was planted deep in history where
// nobody would find it. Old re-sends must change nothing; real new lines and
// edits to loaded lines must still land.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');

const msg = (id, ts, text) => ({ id, playerId: 'p-other', playerName: 'Zed', text, timestamp: ts, reactions: {}, seenBy: [], recipientIds: [] });

(async () => {
  const s = await H.startServer({ port: 19481 });
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const hero = await H.openHeroPage(await browser.newContext({ viewport: { width: 1400, height: 900 } }), s, await H.heroToken(s, 'Ghost Hero'));
    await hero.waitForTimeout(500);
    const result = await hero.evaluate(({ loaded, old, fresh }) => {
      const app = window.PlayerApp;
      app.applyChatMessages(loaded, {});
      const box = document.getElementById('chat-messages');
      const scrollUp = () => { box.scrollTop = 40; app.userScrolledUp = true; };
      scrollUp();
      app._newMessageCount = 0; app._unreadChatCount = 0; app._unreadSystemCount = 0;
      const chip = () => document.getElementById('chat-new-messages');
      // 1. An old, never-loaded message re-sent for a read receipt.
      app.applyChatMessages(app.mergeChatDelta([old]), {});
      const afterOld = { count: app._newMessageCount, chipHidden: chip()?.hidden !== false, planted: app.chatMessages.some(m => m.id === old.id) };
      scrollUp();
      // 2. A reaction on a loaded message is not new either.
      app.applyChatMessages(app.mergeChatDelta([{ ...loaded[1], reactions: { '🔥': ['p-x'] } }]), {});
      const afterEdit = app._newMessageCount;
      scrollUp();
      // 3. A genuinely new line still counts.
      app.applyChatMessages(app.mergeChatDelta([fresh]), {});
      return { afterOld, afterEdit, afterFresh: app._newMessageCount, chipText: chip()?.textContent || '' };
    }, {
      loaded: Array.from({ length: 60 }, (_, i) => msg(`m-${100 + i}`, 100000 + i * 1000, `loaded line ${i}`)),
      old: msg('m-050', 50000, 'deep history'),
      fresh: msg('m-900', 900000, 'brand new')
    });
    assert.equal(result.afterOld.count, 0, 'an old re-sent message is not counted as new');
    assert.equal(result.afterOld.chipHidden, true, 'no ↓ NEW pill for an old re-send');
    assert.equal(result.afterOld.planted, false, 'the old message is not planted into history');
    assert.equal(result.afterEdit, 0, 'a reaction on a loaded message is not new');
    assert.equal(result.afterFresh, 1, 'a real new message still counts');
    assert.match(result.chipText, /1 CHAT/);
    assert.deepEqual(hero.pageErrors, []);
    console.log('PASS chat ghost unread: old re-sent messages never count as new; real ones do');
  } finally {
    await browser?.close();
    await s.stop();
  }
})().catch(error => { console.error(error); process.exit(1); });
