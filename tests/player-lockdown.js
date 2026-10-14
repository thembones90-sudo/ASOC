'use strict';
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="chat-panel"><input id="chat-input"></div><button id="casual-minigames-dock">GAMES</button>');
    await page.evaluate(() => { window.clicks = 0; document.querySelector('button').onclick = () => window.clicks++; });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'js', 'player-lockdown.js') });
    await page.evaluate(() => window.PlayerLockdown.update(true));
    assert.equal(await page.locator('#casual-minigames-dock').getAttribute('aria-disabled'), 'true');
    await page.locator('#casual-minigames-dock').click({ force: true });
    assert.equal(await page.evaluate(() => window.clicks), 0);
    await page.locator('#chat-input').fill('plain chat remains available');
    await page.evaluate(() => window.PlayerLockdown.update(false));
    await page.locator('#casual-minigames-dock').click();
    assert.equal(await page.evaluate(() => window.clicks), 1);
    console.log('PASS metal locks: click blocking, public chat, and release');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
