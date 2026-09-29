// BLACK MARKET PLAYER TRIBUTE // end-to-end submission path.
//
// This drives a real Chromium so the file input, FileReader and the blocking
// consent dialog are the genuine browser implementations, not stubs. That
// matters here: the whole bug lived in the seam between the native picker
// closing and the WebSocket frame going out, and a fake DOM cannot see that
// seam at all.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'black-market.js'), 'utf8');
const playerJs = fs.readFileSync(path.join(ROOT, 'js', 'player.js'), 'utf8');

// The player global the market has to reach. js/player.js exposes PlayerApp and
// has never exposed window.Player, so a market that reaches for window.Player
// installs nothing on the player side and the OFFER button is inert markup.
assert.match(playerJs, /window\.PlayerApp\s*=\s*PlayerApp;/, 'the player app is window.PlayerApp');
// Comments are stripped first: the file documents the old `window.Player`
// mistake, and the check is about executable code, not prose.
const codeOnly = SOURCE.replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(codeOnly, /window\.Player\b/, 'the market must not reach for the non-existent window.Player');
assert.match(SOURCE, /isGM \? window\.App : window\.PlayerApp/, 'the market binds to PlayerApp on the player side');
assert.match(SOURCE, /\['SUBMITTED','TRIBUTE_SUBMITTED'\]\.includes\(p\.state\)/, 'the GM alert reads the real pact state and includes submitted Blood Tributes');
assert.doesNotMatch(codeOnly, /p\.status\s*===\s*'SUBMITTED'/, 'the GM alert cannot inspect the nonexistent status field');
assert.match(SOURCE, /BLOOD TRIBUTE AWAITS/, 'the GM control explicitly names a pending Blood Tribute');

// A wrapper that throws away send()'s result makes a dead socket look like a
// successful submission, which is the second half of the original silent failure.
assert.match(codeOnly, /send\(payload\)\s*\{\s*return host\.send\?\.\(payload\);/, 'send() returns the underlying result');

// Consent is taken in an in-page chamber, not a native confirm(): the OFFER
// action renders the chamber and only the accepted-consent handler is allowed
// to click the hidden input. Nothing else may reach the picker.
assert.match(codeOnly, /showTributeConsent\(/, 'the OFFER action routes through the in-page consent chamber');
assert.match(codeOnly, /data-bm-consent-open/, 'the consent chamber exposes an explicit accept control');
const consentOpenAt = codeOnly.indexOf('data-bm-consent-open');
const pickerAt = codeOnly.indexOf('input.click()');
assert.ok(consentOpenAt > -1 && pickerAt > -1, 'consent chamber and picker both present');
assert.ok(consentOpenAt < pickerAt, 'the consent chamber is built BEFORE the picker is clicked');

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Boots a page with the real market script and a recording PlayerApp stub.
async function bootPage(browser, { sendResult = true, fileReaderOverride = null } = {}) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><button id="black-market-player-button" class="black-market-entry"></button><div id="black-market-body"></div></body></html>');
  await page.addScriptTag({ content: `
    window.__sent = [];
    window.__sendResult = ${sendResult === true ? 'true' : sendResult === false ? 'false' : sendResult};
    window.PlayerApp = {
      send(message) { window.__sent.push(message); return window.__sendResult; },
      handleMessage() {}
    };
    ${fileReaderOverride || ''}
  `});
  await page.addScriptTag({ content: SOURCE });
  return page;
}

const tributes = page => page.evaluate(() => window.__sent.filter(m => m.type === 'blackMarket:tributeSubmit'));
const toastText = page => page.evaluate(() => document.getElementById('black-market-toast')?.textContent || '');

// Opens the picker through the in-page consent chamber and hands the chooser
// back, so the file can be chosen the way a player would: OFFER shows the
// chamber, accepting it opens the picker.
async function offer(page, pactId, file) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.evaluate(id => window.BlackMarket.offerTribute(id, document.querySelector('[data-act="offer-tribute"]')), pactId);
  await page.click('[data-bm-consent-open]');
  const chooser = await chooserPromise;
  if (file) await chooser.setFiles(file);
  return chooser;
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------------------------------------------------- the happy path
    let page = await bootPage(browser);
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.setAttribute('data-act', 'offer-tribute');
      document.getElementById('black-market-body').appendChild(btn);
    });

    const chooserPromise = page.waitForEvent('filechooser');
    await page.evaluate(() => window.BlackMarket.offerTribute('pact-1', document.querySelector('[data-act="offer-tribute"]')));
    assert.equal(await page.evaluate(() => !!document.getElementById('bm-tribute-consent')), true, 'the OFFER action raises the consent chamber first');
    await page.click('[data-bm-consent-open]');
    const chooser = await chooserPromise;

    // Consent was accepted, the picker is open, and the button says so.
    assert.equal(await page.evaluate(() => document.querySelector('[data-act="offer-tribute"]').textContent), 'THE VAULT IS WAITING…', 'the OFFER button reports that it is pending');
    assert.equal(await page.evaluate(() => document.querySelector('[data-act="offer-tribute"]').disabled), true, 'the OFFER button is disabled while pending');
    assert.ok(await page.$('#bm-tribute-input'), 'a single hidden file input is mounted');

    await chooser.setFiles({ name: 'tribute.png', mimeType: 'image/png', buffer: PNG_1x1 });
    await page.waitForFunction(() => window.__sent.some(m => m.type === 'blackMarket:tributeSubmit'));

    const [sent] = await tributes(page);
    assert.equal(sent.pactId, 'pact-1', 'the pact id travels with the submission');
    assert.equal(sent.consent, true, 'consent is acknowledged on the wire');
    assert.match(sent.imageData, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'the image arrives as a valid server-accepted data URL');
    assert.equal(await toastText(page), 'THE OFFERING HAS BEEN SEALED', 'the player is told the offering was sealed');
    assert.equal(await page.evaluate(() => document.querySelectorAll('input#bm-tribute-input').length), 1, 'the file input is reused, not leaked per click');
    await page.close();

    // ------------------------------------------- the socket is dead
    page = await bootPage(browser, { sendResult: false });
    await offer(page, 'pact-2', { name: 'tribute.png', mimeType: 'image/png', buffer: PNG_1x1 });
    await page.waitForFunction(() => document.getElementById('black-market-toast')?.textContent === 'THE RELIQUARY HAS LOST THE LINK');
    assert.equal(await toastText(page), 'THE RELIQUARY HAS LOST THE LINK', 'a send that returns false is reported, not swallowed');
    assert.equal((await tributes(page)).length, 1, 'the frame was still attempted once');
    await page.close();

    // ------------------------------------------------- wrong file type
    page = await bootPage(browser);
    await offer(page, 'pact-3', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    await page.waitForFunction(() => document.getElementById('black-market-toast')?.textContent === 'THE VAULT ACCEPTS ONLY PNG, JPEG OR WEBP');
    assert.equal((await tributes(page)).length, 0, 'a non-image is never submitted');
    await page.close();

    // ------------------------------------------------------ too large
    page = await bootPage(browser);
    await offer(page, 'pact-4', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(2200001) });
    await page.waitForFunction(() => document.getElementById('black-market-toast')?.textContent === 'THE OFFERING EXCEEDS THE VAULT LIMIT');
    assert.equal((await tributes(page)).length, 0, 'an oversized image is never submitted');
    await page.close();

    // ----------------------------------------------- the reader dies
    page = await bootPage(browser, { fileReaderOverride: `
      window.FileReader = class {
        readAsDataURL() { setTimeout(() => this.onerror && this.onerror(new Error('boom')), 0); }
      };
    ` });
    await offer(page, 'pact-6', { name: 'tribute.png', mimeType: 'image/png', buffer: PNG_1x1 });
    await page.waitForFunction(() => document.getElementById('black-market-toast')?.textContent === 'THE IMAGE COULD NOT BE READ');
    assert.equal((await tributes(page)).length, 0, 'a failed read reports instead of vanishing');
    assert.equal(await page.evaluate(() => window.BlackMarket._tributeBusy), false, 'the pending lock is released after a failed read');
    await page.close();

    // ------------------------- the picker dismissed without a choice
    // The old code reported "exceeds the vault limit" here, which is a lie: the
    // player simply cancelled, and the lock must not be stranded.
    page = await bootPage(browser);
    page.on('filechooser', () => {});
    await page.evaluate(() => window.BlackMarket.offerTribute('pact-5', null));
    await page.click('[data-bm-consent-open]');
    await page.evaluate(() => window.BlackMarket.onTributePicked({ files: [], value: 'x' }));
    assert.equal(await toastText(page), '', 'cancelling the picker is not reported as an error');
    assert.equal(await page.evaluate(() => window.BlackMarket._tributeBusy), false, 'the pending lock is released after a cancel');
    await page.close();

    // ----------------------------- consent refused opens no picker at all
    page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><div id="black-market-body"></div></body></html>');
    await page.addScriptTag({ content: 'window.PlayerApp={send(){return true;},handleMessage(){}};' });
    await page.addScriptTag({ content: SOURCE });
    let chooserOpened = false;
    page.on('filechooser', () => { chooserOpened = true; });
    await page.evaluate(() => window.BlackMarket.offerTribute('pact-7', null));
    assert.equal(await page.evaluate(() => !!document.getElementById('bm-tribute-consent')), true, 'the consent chamber is raised before any picker');
    await page.click('[data-bm-consent-cancel]');
    await page.waitForTimeout(200);
    assert.equal(chooserOpened, false, 'withdrawing consent never opens the picker');
    assert.equal(await page.evaluate(() => !!document.getElementById('bm-tribute-input')), false, 'withdrawing consent never even mounts a picker');
    assert.equal(await page.evaluate(() => !!document.getElementById('bm-tribute-consent')), false, 'the consent chamber is dismissed on withdraw');
    await page.close();

    console.log('PASS black market tribute: player module binds to PlayerApp, the in-page consent chamber precedes the picker, MIME/size/read failures are reported, a dead socket surfaces as THE RELIQUARY HAS LOST THE LINK, success confirms THE OFFERING HAS BEEN SEALED');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
