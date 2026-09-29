// SESSION SURVIVAL (Mobile Alpha 0.1, step 2) -- a phone that sleeps or
// switches network must come back by itself, and nothing typed is lost or
// doubled.
//   protocol: client:ping -> server:pong; a chat:guess repeated with the same
//             clientMsgId posts once and is acknowledged twice
//   browser:  a "zombie" socket (looks OPEN, delivers nothing) is detected on
//             resume, dropped and replaced; a message typed into the zombie
//             is delivered exactly once after the reconnect; no alert()
'use strict';

const assert = require('assert/strict');
const WebSocket = require('ws');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');

const PORT = Number(process.env.ASOC_MOBILE_RESUME_PORT) || 18971;

function wsClient(token, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.msgs = [];
    ws.once('error', reject);
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1, clientBuild: 'test' }));
      if (m.type === 'protocol:ready') return ws.send(JSON.stringify({ type: 'room:join', authToken: token, roomCode: 'MASTER', name }));
      ws.msgs.push(m);
      if (m.type === 'join:success') resolve(ws);
    });
  });
}
const waitFor = async (fn, label, timeout = 8000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await H.sleep(50); }
  throw new Error('timed out: ' + label);
};

(async () => {
  const server = await H.startServer({ port: PORT });
  let browser;
  try {
    // Protocol level.
    const a = await wsClient(await H.heroToken(server, 'Resume Ws'), 'Resume Ws');
    a.send(JSON.stringify({ type: 'client:ping', id: 'probe-1' }));
    await waitFor(() => a.msgs.find(m => m.type === 'server:pong' && m.id === 'probe-1'), 'pong');
    const guess = { type: 'chat:guess', text: 'exactly once please', clientMsgId: 'dup-test-0001' };
    a.send(JSON.stringify(guess));
    await waitFor(() => a.msgs.find(m => m.type === 'chat:ack' && m.clientMsgId === 'dup-test-0001'), 'first ack');
    await H.sleep(400);
    a.send(JSON.stringify(guess));
    await waitFor(() => a.msgs.find(m => m.type === 'chat:ack' && m.clientMsgId === 'dup-test-0001' && m.duplicate), 'duplicate ack');
    await H.sleep(300);
    const lastChat = a.msgs.filter(m => m.type === 'chat:update').pop();
    const all = a.msgs.filter(m => m.type === 'chat:update').flatMap(m => m.messages || []);
    const ids = new Set(all.filter(m => m.text === 'exactly once please').map(m => m.id));
    assert.equal(ids.size, 1, 'a repeated clientMsgId posts once');
    assert.ok(lastChat, 'chat updates arrive');
    a.close();

    // Browser: zombie socket on resume.
    browser = await chromium.launch(H.launchOptions());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await H.openHeroPage(context, server, await H.heroToken(server, 'Resume Hero'));
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    await waitFor(() => page.evaluate(() => PlayerApp.ws?.readyState === 1 && PlayerApp._protocolReady), 'page connected');

    // Turn the live socket into a zombie: it stays OPEN but nothing reaches
    // the server any more (what a phone's dead socket looks like).
    await page.evaluate(() => { window.__zombie = PlayerApp.ws; PlayerApp.ws.send = () => {}; });
    await page.fill('#chat-input', 'typed into a dead socket');
    await page.press('#chat-input', 'Enter');
    await H.sleep(200);
    // The phone wakes up.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => page.evaluate(() => PlayerApp.ws && PlayerApp.ws !== window.__zombie && PlayerApp.ws.readyState === 1 && PlayerApp._protocolReady), 'zombie replaced by a fresh socket', 10000);
    const text = 'typed into a dead socket';
    await waitFor(() => page.evaluate(t => (PlayerApp.chatMessages || []).some(m => m.text === t), text), 'lost message delivered after reconnect', 10000);
    await H.sleep(1500);
    const copies = await page.evaluate(t => (PlayerApp.chatMessages || []).filter(m => m.text === t).length, text);
    assert.equal(copies, 1, 'delivered exactly once');
    assert.equal(await page.evaluate(() => PlayerApp._unackedChat.size), 0, 'nothing left unacknowledged');
    assert.deepEqual(dialogs, [], 'no alert() during resume');
    assert.equal(await page.locator('#game-screen.active').count(), 1, 'still in the game');
    assert.deepEqual(page.pageErrors, [], 'no page errors');
    assert.equal(server.errors().trim(), '', 'no server errors');
    console.log('PASS mobile resume: ping/pong liveness, zombie socket detected on resume and replaced, message typed into it delivered exactly once, repeated clientMsgId posts once, no alert');
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
})().catch(error => {
  console.error('FAIL mobile resume:', error);
  process.exit(1);
});
