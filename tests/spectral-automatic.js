'use strict';
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const H = require('./lib/browser-harness');
class Client {
  constructor() { this.messages = []; }
  async open(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const message = JSON.parse(data);
        if (message.type === 'protocol:hello') return this.send({ type: 'protocol:hello', protocolVersion: 1 });
        if (message.type === 'protocol:ready') return resolve();
        this.messages.push(message);
        if (this.onMessage) this.onMessage(message);
      });
    });
    return this;
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  async wait(predicate, from = 0) {
    const until = Date.now() + 7000;
    while (Date.now() < until) {
      const message = this.messages.slice(from).find(predicate);
      if (message) return message;
      await H.sleep(20);
    }
    throw Error('Timed out: ' + predicate + ' // ' + JSON.stringify(this.messages.slice(-3)).slice(0, 700));
  }
}
(async () => {
  const server = await H.startServer({ port: 19859, env: { ASOC_COLUMN_REVEAL_DELAY_MS: '150' } });
  const clients = [];
  let browser;
  try {
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gm = await new Client().open(server.port); clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: login.data.token });
    await gm.wait(m => m.type === 'host:recovered');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.setContent('<body style="background:#09090b"><input id="typing" aria-label="chat"><div id="spectral-console"><select id="spectral-mode"><option>MANUAL</option><option>ASSISTED</option><option>AUTONOMOUS</option></select></div></body>');
    await page.exposeFunction('sendSpectralWire', payload => gm.send(payload));
    await page.evaluate(() => { window.App = { send: payload => window.sendSpectralWire(payload), registerGmModule: (name, api) => { window.spectralReview = api; } }; });
    let uiUpdates = Promise.resolve();
    gm.onMessage = message => { uiUpdates = uiUpdates.then(() => page.evaluate(frame => window.spectralReview?.onMessage(frame), message)); };
    await page.addStyleTag({ path: path.join(H.ROOT, 'css/spectral-adjudicator.css') });
    await page.addScriptTag({ path: path.join(H.ROOT, 'js/spectral-adjudicator.js') });
    const columns = Object.fromEntries(Object.entries({ A: 'sail', B: 'wither', C: 'fire', D: 'stone' }).map(([key, solution]) => [key, { solution, clues: ['one', 'two', 'three', 'four'] }]));
    const response = await fetch(server.base + '/api/games', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gm-token': login.data.token }, body: JSON.stringify({ title: 'Spectra Automatic Fixture', difficulty: 'GREEN', columns, finalSolution: 'splash' }) });
    assert.equal(response.status, 200);
    const saved = await response.json();
    gm.send({ type: 'gm:switchGame', gameId: saved.game.id });
    await gm.wait(m => m.type === 'gm:switchGame:ack');
    const players = [];
    for (let i = 0; i < 5; i++) {
      const name = `Spectra Hero ${i}`;
      const token = await H.heroToken(server, name);
      const player = await new Client().open(server.port); clients.push(player); players.push(player);
      player.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await player.wait(m => m.type === 'join:success');
    }
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await gm.wait(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED');
    players.forEach(player => player.send({ type: 'ritual:join' }));
    await gm.wait(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5);
    gm.send({ type: 'gm:timerLaunchCountdown' }); await H.sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await gm.wait(m => m.type === 'state:public' && m.roomMode === 'BATTLE');
    gm.send({ type: 'gm:command', command: 'revealCell', payload: { cell: 'A1', reveal: true }, cmdId: 'spectra-clue-1' });
    await gm.wait(m => m.type === 'state:public' && m.cells?.A1?.revealed === true);
    const mode = async value => {
      const from = gm.messages.length;
      gm.send({ type: 'gm:spectral:mode', mode: value });
      await gm.wait(m => m.type === 'spectral:state' && m.state.mode === value, from);
    };
    const guess = async (text, verdict) => {
      await H.sleep(400);
      const from = gm.messages.length;
      players[0].send({ type: 'chat:guess', text });
      const frame = await gm.wait(m => m.messages?.some(x => x.text === text && (x.verdict || null) === verdict), from);
      return frame.messages.find(x => x.text === text);
    };
    await mode('MANUAL'); await guess('A SAIL', null);
    await mode('ASSISTED');
    const identityFrom = gm.messages.length;
    await H.sleep(400);
    players[0].send({ type: 'chat:guess', text: 'A1' });
    const identityFrame = await gm.wait(m => m.messages?.some(x => x.source === 'spectralAdjudicator'), identityFrom);
    const spectraMessage = identityFrame.messages.find(x => x.source === 'spectralAdjudicator');
    assert.equal(spectraMessage.playerName, 'SPECTRA');
    assert.equal(spectraMessage.avatarData, '/assets/profiles/spectra-warden.png?v=20261023');
    assert.equal(spectraMessage.frameColor, '#9B5DE0');
    await players[0].wait(m => m.messages?.some(x => x.id === spectraMessage.id && x.playerName === 'SPECTRA' && x.avatarData === spectraMessage.avatarData));
    await page.locator('#typing').focus();
    const variant = await guess('withered b', null);
    const card = page.locator(`[data-message-id="${variant.id}"]`);
    await card.waitFor({ state: 'visible' });
    assert.match(await card.textContent(), /withered b/);
    assert.match(await card.textContent(), /DERIVATIONAL/);
    assert.equal(await page.locator('#typing').evaluate(el => el === document.activeElement), true, 'review alert does not steal chat focus');
    const shots = path.join(H.ROOT, '.scratch', 'spectral-review'); fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.screenshot({ path: path.join(shots, 'mobile.png') });
    assert.equal(await page.locator('#spectral-review-panel').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'MINIMIZE' }).click();
    await mode('ASSISTED'); await uiUpdates;
    assert.equal(await page.locator('#spectral-review-panel').isVisible(), false, 'duplicate sync does not reopen minimized panel');
    await page.locator('#spectral-review-toggle').click();
    await card.getByRole('button', { name: 'REJECT', exact: true }).click();
    await gm.wait(m => m.messages?.some(x => x.id === variant.id && x.verdict === 'wrong'));
    await card.waitFor({ state: 'detached' });
    gm.send({ type: 'gm:command', command: 'revealCell', payload: { cell: 'B1', reveal: true }, cmdId: 'spectra-clue-b' });
    await gm.wait(m => m.type === 'state:public' && m.cells?.B1?.revealed === true);
    const acceptedVariant = await guess('withered B?', null);
    const acceptedCard = page.locator(`[data-message-id="${acceptedVariant.id}"]`);
    await acceptedCard.waitFor({ state: 'visible' });
    assert.equal(await acceptedCard.locator('select').inputValue(), 'B');
    await acceptedCard.getByRole('button', { name: 'ACCEPT', exact: true }).click();
    await gm.wait(m => m.messages?.some(x => x.id === acceptedVariant.id && x.verdict === 'correct' && x.target === 'B'));
    await acceptedCard.waitFor({ state: 'detached' });
    const assisted = await guess('I saw a sail 😂', null);
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.some(p => p.messageId === assisted.id));
    await mode('AUTONOMOUS');
    const typo = await guess('A saill', null);
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.some(p => p.messageId === typo.id));
    await guess('D sail', 'wrong');
    await guess('D banana 😂', 'wrong');
    const column = await guess('I saw a sail :D', 'correct');
    assert.equal(column.target, 'A');
    await gm.wait(m => m.type === 'state:public' && m.cells?.A5?.revealed === true);
    await guess('A sail 😂', null);
    await guess('A saill 😂', null);
    const failFrom = gm.messages.length;
    gm.send({ type: 'gm:failColumn', column: 'C' });
    await gm.wait(m => m.type === 'state:public' && m.cells?.C5?.outcome === 'failed', failFrom);
    const late = await guess('C fire 😂', null);
    const lateTypo = await guess('C fiire 😂', null);
    const pending = gm.messages.filter(m => m.type === 'spectral:state').at(-1).state.pending;
    assert.equal(pending.some(p => [late.id, lateTypo.id].includes(p.messageId)), false, 'closed columns never enter review queue');
    assert.equal(gm.messages.some(m => m.type === 'score:event' && m.target === 'C'), false, 'failed column never earns solve credit');
    const manualFrom = gm.messages.length;
    gm.send({ type: 'gm:judgeGuess', messageId: late.id, verdict: 'correct', target: 'C' });
    await gm.wait(m => m.type === 'error' && /already been resolved/.test(m.message), manualFrom);
    await mode('ASSISTED');
    const finalReview = await guess('K splash', null);
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.some(p => p.messageId === finalReview.id));
    await mode('AUTONOMOUS');
    const finalFrom = gm.messages.length;
    const final = await guess('perhaps splash over here K 😂', 'correct');
    assert.equal(final.target, 'FINAL');
    await gm.wait(m => m.type === 'score:finalReveal' && m.correctSolution === 'splash');
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.length === 0, finalFrom);
    await uiUpdates;
    assert.equal(await page.locator('#spectral-review-panel').isVisible(), false, 'finishing a game clears all outstanding review cards');
    gm.send({ type: 'gm:gameWon' });
    await gm.wait(m => m.type === 'state:public' && m.matchResult?.outcome === 'WON');
    // A missed sync / stale tab must also recover when Reject is clicked.
    await page.evaluate(entry => window.spectralReview.onMessage({ type: 'spectral:state', state: { mode: 'ASSISTED', pending: [entry] } }), { messageId: finalReview.id, playerName: 'Old player', text: 'stale final', target: 'FINAL' });
    const staleFrom = gm.messages.length;
    await page.locator(`[data-message-id="${finalReview.id}"]`).getByRole('button', { name: 'REJECT', exact: true }).click();
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.length === 0, staleFrom);
    await uiUpdates;
    assert.equal(await page.locator('#spectral-review-panel').isVisible(), false, 'Reject recovers a stale completed-game panel');
    const syncFrom = gm.messages.length;
    gm.send({ type: 'gm:spectral:sync' });
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.length === 0, syncFrom);
    assert.equal(gm.messages.filter(m => m.type === 'score:event' && m.target === 'A').length, 1);
    await uiUpdates;
    assert.deepEqual(pageErrors, []);
    await page.setViewportSize({ width: 390, height: 800 });
    assert.equal(await page.locator('#spectral-review-panel').isVisible(), false, 'completed-game review stays closed on mobile');
    // Exercise both shipped chat renderers and the actual served artwork.
    gm.onMessage = null;
    const gmContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await gmContext.addInitScript(token => { sessionStorage.setItem('asoc_gm_token', token); localStorage.setItem('asoc_master_token', token); }, login.data.token);
    const gmPage = await gmContext.newPage();
    await gmPage.goto(server.base + '/index.html');
    await gmPage.waitForFunction(() => window.App?.roomCode === 'MASTER' && window.App?.mode === 'multiplayer');
    await gmPage.waitForSelector('#spectral-review-toggle', { state: 'attached' });
    assert.equal(await gmPage.locator('#spectral-review-toggle').isVisible(), false, 'host reconnect does not restore completed reviews');
    const heroContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const heroPage = await H.openHeroPage(heroContext, server, await H.heroToken(server, 'Spectra Hero 0'));
    for (const [view, role] of [[gmPage, 'gm'], [heroPage, 'player']]) {
      await view.evaluate(({ message, role }) => {
        const app = role === 'gm' ? window.App : window.PlayerApp;
        const fixture = document.createElement('div');
        fixture.id = 'spectra-avatar-verification';
        fixture.style.cssText = 'position:fixed;inset:20px auto auto 20px;width:650px;padding:20px;background:#15101d;z-index:2147483647';
        fixture.innerHTML = role === 'gm' ? app.createGMChatMessageHTML(message) : app.createChatMessageHTML(message);
        document.body.appendChild(fixture);
        if (app.littleHeroAvatarHTML({ avatarData: 'https://example.com/unsafe.png' }).includes('<img')) throw Error('Avatar URL allowlist weakened');
      }, { message: spectraMessage, role });
      const bubble = view.locator('#spectra-avatar-verification');
      assert.match(await bubble.textContent(), /SPECTRA/);
      await bubble.locator('img[src*="spectra-warden.png"]').evaluate(img => img.decode());
      await bubble.screenshot({ path: path.join(shots, `spectra-${role}.png`) });
    }
    console.log('PASS Spectra live battle and browser GM review: WITHERED B visibly alerts; Accept/Reject apply real verdicts and clear pending; no focus stealing or duplicate reopening; mobile fits; manual/assisted/automatic, scoring and closed-column protections preserved');
  } finally { clients.forEach(client => { client.onMessage = null; client.ws?.terminate(); }); await browser?.close(); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
