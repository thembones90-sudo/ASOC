// THE FINAL HAS FALLEN -- Final solved while columns are still owed.
'use strict';
const R = require('path').join(__dirname, '..') + '/';
const assert = require('assert/strict');
const { chromium } = require(R + 'node_modules/playwright');
const WebSocket = require(R + 'node_modules/ws');
const H = require(R + 'tests/lib/browser-harness.js');
function client(port) { return new Promise(res => { const ws = new WebSocket(`ws://127.0.0.1:${port}`); ws.msgs = [];
  ws.on('message', d => { const m = JSON.parse(d); ws.msgs.push(m); if (m.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1, clientBuild: 't' })); if (m.type === 'protocol:ready') return res(ws); }); }); }
const send = (ws, m) => ws.send(JSON.stringify(m));
(async () => {
  const s = await H.startServer({ port: Number(process.env.ASOC_FINAL_DEBT_PORT) || 18974, env: { ASOC_COLUMN_REVEAL_DELAY_MS: '200' } });
  try {
    const gmTok = (await s.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token;
    const gm = await client(s.port); send(gm, { type: 'host:recover', gmToken: gmTok }); await H.sleep(500);
    const heroes = [];
    const names = ['Maxine', 'Tami', 'Rastko', 'Sissy', 'Chavez']; for (let i = 0; i < names.length; i++) { const ws = await client(s.port); send(ws, { type: 'room:join', authToken: await H.heroToken(s, names[i]), roomCode: 'MASTER', name: names[i] }); heroes.push(ws); }
    await H.sleep(600);
    send(gm, { type: 'gm:setRoomMode', mode: 'BATTLE' }); await H.sleep(400);
    for (const w of heroes) send(w, { type: 'ritual:join' });
    await H.sleep(600);
    send(gm, { type: 'gm:timerLaunchCountdown' }); await H.sleep(400); send(gm, { type: 'gm:timerStart' });
    const browser = await chromium.launch(H.launchOptions());
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('asoc_mobile_view', '0'); } catch {} });
    const page = await H.openHeroPage(ctx, s, await H.heroToken(s, 'Denver'));
    await H.sleep(9000);
    for (const c of ['A1', 'A2', 'B1', 'C1']) send(gm, { type: 'gm:command', command: 'revealCell', payload: { cell: c }, cmdId: 'r' + c });
    await H.sleep(800);
    const lastId = async () => page.evaluate(() => (PlayerApp.chatMessages || []).filter(m => !m.source).pop()?.id);
    send(heroes[0], { type: 'chat:guess', text: 'the final answer' }); await H.sleep(900);
    const fid = await lastId();
    send(gm, { type: 'gm:judgeGuess', messageId: fid, verdict: 'correct', target: 'FINAL' });
    await H.sleep(1300);
    assert.ok(await page.evaluate(() => !!document.getElementById('fd-banner')), 'THE FINAL HAS FALLEN plays');
    assert.equal(await page.evaluate(() => !!document.querySelector('.board-solve-coronation.final-coronation')), false, 'the usual Final coronation is replaced');
    await H.sleep(3700);
    assert.equal(await page.evaluate(() => !!document.getElementById('fd-banner')), false, 'the ceremony ends');
    let debt = await page.evaluate(() => window.FinalDebt.current);
    assert.deepEqual(debt.owed, ['A', 'B', 'C', 'D']);
    assert.equal(debt.by, 'Maxine');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#fd-layer .fd-lock').length), 4, 'each owed column is locked');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#fd-layer .fd-seal').length), 1, 'the Final is sealed');
    await H.sleep(1200);
    send(heroes[1], { type: 'chat:guess', text: 'column a answer' }); await H.sleep(900);
    const aid = await lastId();
    send(gm, { type: 'gm:judgeGuess', messageId: aid, verdict: 'correct', target: 'A' });
    await H.sleep(500);
    assert.ok(await page.evaluate(() => !!document.querySelector('.fd-paid')), 'DEBT PAID plays');
    await H.sleep(1800);
    debt = await page.evaluate(() => window.FinalDebt.current);
    assert.deepEqual(debt.owed, ['B', 'C', 'D']);
    assert.deepEqual(debt.paid, ['A']);
    assert.equal(await page.evaluate(() => (PlayerApp.chatMessages || []).filter(m => /THE FINAL HAS FALLEN/.test(m.text || '')).length), 1, 'the Shadow Broker announces the debt once');
    // Reload: lasting state without the ceremony.
    await page.reload(); await page.waitForSelector('#game-screen.active'); await H.sleep(1500);
    assert.equal(await page.evaluate(() => !!document.getElementById('fd-banner')), false, 'a reload does not replay the ceremony');
    assert.ok(await page.evaluate(() => !!document.querySelector('.fd-strip')), 'a reload keeps the debt strip');
    assert.deepEqual(page.pageErrors, []);
    assert.equal(s.errors().trim(), '');
    console.log('PASS final debt: THE FINAL HAS FALLEN replaces the Final coronation while columns are owed; seal, owed locks, debt strip; DEBT PAID on a later column; announced once; reload keeps state without replaying');
    await browser.close();
  } finally { await s.stop(); }
})().catch(e => { console.error('FAIL final debt:', e); process.exit(1); });
