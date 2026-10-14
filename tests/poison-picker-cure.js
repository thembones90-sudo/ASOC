'use strict';
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="poison-gm-button">POISON</button>');
    await page.evaluate(() => { window.sent = []; window.App = { send: m => window.sent.push(m) }; });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'js', 'poison.js') });
    await page.locator('#poison-gm-button').click();
    await page.evaluate(() => {
      window.PoisonEffect.onState({ poison: { victim: { playerId: 'victim', playerName: 'Tami', status: 'bleeding' } } });
      window.PoisonEffect.onMessage({ type: 'gm:poisonTargets', targets: [
        { id: 'victim', name: 'Tami', online: true }, { id: 'healthy', name: 'Healthy', online: true }
      ] });
    });
    assert.equal(await page.locator('[data-poison-cure]').isDisabled(), true);
    await page.locator('[data-poison-target-id="healthy"]').click();
    assert.equal(await page.locator('[data-poison-cure]').isDisabled(), true);
    await page.locator('[data-poison-target-id="victim"]').click();
    assert.equal(await page.locator('[data-poison-cure]').isEnabled(), true);
    await page.locator('[data-poison-cure]').click();
    const commands = await page.evaluate(() => window.sent.filter(m => m.type === 'gm:broadcast'));
    assert.deepEqual(commands, [{ type: 'gm:broadcast', text: '/cure @Tami' }]);
    assert.equal(await page.locator('[data-poison-cure]').isDisabled(), true);
    console.log('PASS poison picker: visible cure button targets poisoned selections only');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
