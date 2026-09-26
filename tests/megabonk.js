// MEGABONK -- persistent global pre-game attention call.
//   1. GM triggers MEGABONK.  2. All connected players receive it.
//   3. One acknowledges; the others keep their own alert.
//   4. GM progress updates.  5. Unacknowledged reconnect -> same alert again.
//   6. Acknowledged reconnect -> nothing.  7. New MEGABONK -> fresh acks.
//   Plus: not a ritual vote, never starts the game, refused in a live Battle,
//   survives a restart, END clears it, //   stale acks are ignored, no chat broadcast, the client never self-dismisses.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_MEGABONK_TEST_PORT) || 18861;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-megabonk-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', c => { text += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.state = null; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'state:public') this.state = m;
        if (m.type === 'join:success') this.playerId = m.playerId;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(predicate, label, from = 0, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { const f = this.msgs.slice(from).find(predicate); if (f) return f; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  async none(predicate, from, wait = 500) { await sleep(wait); return !this.msgs.slice(from).some(predicate); }
  close() { try { this.ws.close(); } catch {} }
}

function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'mb-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  return server;
}
async function healthy() {
  for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); }
  throw new Error('server not healthy');
}

function checkClientNeverSelfDismisses() {
  const src = fs.readFileSync(path.join(ROOT, 'js/megabonk.js'), 'utf8');
  const clear = src.slice(src.indexOf('function clearAlert'), src.indexOf('// ---------------------------------------------------------------- GM'));
  assert.ok(clear.length > 0);
  // The only path that removes the player alert is the server's megabonk:cleared.
  assert.match(src, /megabonk:cleared'\) return clearAlert/);
  assert.equal((src.match(/clearAlert\(/g) || []).length, 2, 'clearAlert is defined once and called only for megabonk:cleared');
  assert.doesNotMatch(src.slice(src.indexOf('function showAlert'), src.indexOf('function acknowledge')), /setTimeout\([^)]*remove|clearAlert/, 'no timed self-dismissal');
}

(async () => {
  checkClientNeverSelfDismisses();
  let server = spawnServer();
  const clients = [];
  try {
    await healthy();
    const gmToken = (await api('/api/auth/gm/login', { password: 'mb-pass' })).data.token;
    const openGm = async () => {
      const gm = await new Client('GM').open();
      clients.push(gm);
      gm.send({ type: 'host:recover', gmToken });
      await gm.next(m => m.type === 'host:recovered', 'host');
      return gm;
    };
    const creds = {};
    const connect = async name => {
      if (!creds[name]) {
        creds[name] = { email: `${name.toLowerCase()}@mb.test`, password: 'mb-password' };
        await api('/api/auth/player/register', { ...creds[name], name });
      }
      const token = (await api('/api/auth/player/login', creds[name])).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.next(m => m.type === 'join:success', `${name} join`);
      await sleep(150);
      return c;
    };
    const progress = async (gm, predicate, label, from) =>
      (await gm.next(m => m.type === 'megabonk:progress' && m.event && predicate(m.event), label, from)).event;
    const bonk = async (gm, extra = '') => {
      const from = gm.mark();
      gm.send({ type: 'gm:broadcast', text: '/megabonk' + extra });
      return from;
    };

    let gm = await openGm();
    let ana = await connect('Ana');
    let bo = await connect('Bo');
    let cy = await connect('Cy');

    // Pre-game: arm the battle (MEGABONK is meant for BATTLE_ARMED).
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await gm.next(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED', 'armed');
    const ritualBefore = JSON.stringify(gm.state.ritual || null);
    const chatMark = ana.mark();

    // 1 + 2. Trigger; every connected player gets the same event id.
    let from = await bonk(gm, ' all');
    let event = await progress(gm, e => e.total === 3, 'progress 0/3', from);
    assert.equal(event.acknowledged, 0);
    const alerts = await Promise.all([ana, bo, cy].map(c => c.next(m => m.type === 'megabonk:alert', `${c.name} alert`)));
    assert.ok(alerts.every(a => a.id === event.id));
    const firstId = event.id;
    assert.equal(await ana.none(m => m.type === 'chat:update' && m.messages.some(x => /megabonk/i.test(x.text || '')), chatMark), true, 'no chat broadcast');

    // Not a ritual vote, never starts the game.
    await sleep(200);
    assert.equal(JSON.stringify(gm.state.ritual || null), ritualBefore, 'acknowledging is not a ritual vote');
    assert.equal(gm.state.roomMode, 'BATTLE_ARMED', 'MEGABONK never starts the game');

    // A newer connection supersedes Ana's old one; the alert follows her.
    ana.close();
    ana = await connect('Ana');
    await ana.next(m => m.type === 'megabonk:alert' && m.id === firstId, 'alert on the new connection');

    // 3 + 4. Ana acknowledges; Bo and Cy stay pending; GM sees 1/3.
    from = gm.mark();
    const anaMark = ana.mark(), boMark = bo.mark();
    ana.send({ type: 'megabonk:ack', id: firstId });
    await ana.next(m => m.type === 'megabonk:cleared' && m.id === firstId, 'ana cleared', anaMark);
    event = await progress(gm, e => e.acknowledged === 1, 'progress 1/3', from);
    assert.deepEqual(event.players.filter(p => p.ackAt).map(p => p.name), ['Ana']);
    assert.deepEqual(event.players.filter(p => !p.ackAt).map(p => p.name).sort(), ['Bo', 'Cy']);
    assert.equal(await bo.none(m => m.type === 'megabonk:cleared', boMark), true, 'Bo keeps his own alert');
    // A repeat / stale ack changes nothing.
    ana.send({ type: 'megabonk:ack', id: firstId });
    ana.send({ type: 'megabonk:ack', id: 'megabonk-bogus' });
    await sleep(300);
    assert.equal(gm.msgs.filter(m => m.type === 'megabonk:progress').at(-1).event.acknowledged, 1);

    // State refreshes / chat never clear it.
    gm.send({ type: 'gm:broadcast', text: 'regular transmission' });
    await sleep(300);
    assert.equal(await bo.none(m => m.type === 'megabonk:cleared', boMark, 50), true);

    // 5. Unacknowledged Bo reconnects -> same alert again.
    bo.close();
    await sleep(300);
    bo = await connect('Bo');
    assert.equal((await bo.next(m => m.type === 'megabonk:alert', 'bo re-alert')).id, firstId);

    // 6. Acknowledged Ana reconnects -> nothing.
    ana.close();
    await sleep(300);
    ana = await connect('Ana');
    assert.equal(await ana.none(m => m.type === 'megabonk:alert', 0, 600), true, 'acknowledged players are not bonked again');

    // Survives a restart: Cy (pending) still gets it, Ana still does not.
    clients.forEach(c => c.close());
    clients.length = 0;
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    server = spawnServer();
    await healthy();
    gm = await openGm();
    event = await progress(gm, e => e.id === firstId, 'progress after restart');
    assert.equal(event.acknowledged, 1);
    cy = await connect('Cy');
    assert.equal((await cy.next(m => m.type === 'megabonk:alert', 'cy after restart')).id, firstId);
    ana = await connect('Ana');
    assert.equal(await ana.none(m => m.type === 'megabonk:alert', 0, 500), true);
    bo = await connect('Bo');
    await bo.next(m => m.type === 'megabonk:alert', 'bo after restart');

    // 7. A new MEGABONK needs everyone again, Ana included.
    from = await bonk(gm);
    event = await progress(gm, e => e.id !== firstId, 'new event', from);
    assert.equal(event.acknowledged, 0);
    assert.equal(event.total, 3);
    const secondId = event.id;
    await ana.next(m => m.type === 'megabonk:alert' && m.id === secondId, 'ana bonked again');
    // An ack for the OLD id does not count for the new one.
    ana.send({ type: 'megabonk:ack', id: firstId });
    await sleep(300);
    assert.equal(gm.msgs.filter(m => m.type === 'megabonk:progress').at(-1).event.acknowledged, 0);
    // Everyone acknowledges -> 3/3.
    for (const c of [ana, bo, cy]) c.send({ type: 'megabonk:ack', id: secondId });
    event = await progress(gm, e => e.id === secondId && e.acknowledged === 3, 'all acknowledged');
    assert.equal(event.total, 3);

    // END clears pending alerts and the tracker.
    from = await bonk(gm);
    const thirdId = (await progress(gm, e => e.id !== secondId, 'third', from)).id;
    await cy.next(m => m.type === 'megabonk:alert' && m.id === thirdId, 'third alert');
    const cyMark = cy.mark();
    from = gm.mark();
    gm.send({ type: 'gm:megabonkEnd' });
    await cy.next(m => m.type === 'megabonk:cleared' && m.id === thirdId, 'ended', cyMark);
    await gm.next(m => m.type === 'megabonk:progress' && m.event === null, 'tracker cleared', from);
    // Players cannot end it.
    from = await bonk(gm);
    const fourthId = (await progress(gm, e => e.id !== thirdId, 'fourth', from)).id;
    bo.send({ type: 'gm:megabonkEnd' });
    await sleep(300);
    assert.equal(gm.msgs.filter(m => m.type === 'megabonk:progress').at(-1).event.id, fourthId, 'only the GM can end it');

    // Refused during a live Battle; GM only.
    const fillers = [await connect('Dee'), await connect('Eli')];
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await sleep(300);
    [ana, bo, cy, ...fillers].forEach(p => p.send({ type: 'ritual:join' }));
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual 5/5');
    gm.send({ type: 'gm:timerLaunchCountdown' });
    await sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await gm.next(m => m.type === 'state:public' && m.roomMode === 'BATTLE', 'live battle');
    const gmErrMark = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/megabonk all' });
    assert.match((await gm.next(m => m.type === 'error', 'battle refusal', gmErrMark)).message, /NOT DURING A LIVE BATTLE/);
    const boErr = bo.mark();
    bo.send({ type: 'chat:guess', text: '/megabonk all' });
    await sleep(400);
    assert.equal(await bo.none(m => m.type === 'megabonk:alert' && m.id !== fourthId, boErr, 50), true, 'players cannot MEGABONK');

    // Custom message + single-player target (back in the Amusement Park).
    gm.send({ type: 'gm:setRoomMode', mode: 'CASUAL' });
    await gm.next(m => m.type === 'state:public' && m.roomMode === 'CASUAL', 'casual again');
    gm.send({ type: 'gm:megabonkEnd' });
    await sleep(300);
    from = gm.mark();
    const anaM = ana.mark(), boM = bo.mark();
    gm.send({ type: 'gm:broadcast', text: '/megabonk all Battle starts in 2 minutes, get ready' });
    const withMsg = await progress(gm, e => e.message === 'Battle starts in 2 minutes, get ready', 'message event', from);
    assert.equal(withMsg.scope, 'all');
    assert.equal((await ana.next(m => m.type === 'megabonk:alert', 'ana msg alert', anaM)).message, 'Battle starts in 2 minutes, get ready');
    gm.send({ type: 'gm:megabonkEnd' });
    await sleep(300);
    from = gm.mark();
    const anaM2 = ana.mark(), boM2 = bo.mark();
    gm.send({ type: 'gm:broadcast', text: '/megabonk @Bo wake up, you are AFK' });
    const one = await progress(gm, e => e.scope === 'one', 'single target', from);
    assert.equal(one.total, 1);
    assert.equal(one.players[0].name, 'Bo');
    assert.equal(one.message, 'wake up, you are AFK');
    assert.equal((await bo.next(m => m.type === 'megabonk:alert', 'bo alerted', boM2)).message, 'wake up, you are AFK');
    assert.equal(await ana.none(m => m.type === 'megabonk:alert', anaM2, 500), true, 'only the targeted player is alerted');
    const errMark = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/megabonk @Nobody hello' });
    assert.match((await gm.next(m => m.type === 'error', 'unknown target', errMark)).message, /NO CONNECTED LITTLE HERO/);
    gm.send({ type: 'gm:broadcast', text: '/megabonk sideways' });
    assert.match((await gm.next(m => m.type === 'error' && /INVALID/.test(m.message), 'bad syntax', errMark)).message, /megabonk all/);
    void boM; void anaM;
    // The GM command picker offers both forms.
    const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    assert.match(appSrc, /insert: '\/megabonk all '/);
    assert.match(appSrc, /insert: '\/megabonk @'/);

    // Outdated browser pages (no build reported) are told to refresh;
    // current pages and scripts connect normally.
    const handshake = (headers, hello) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers });
      ws.once('error', reject);
      ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return ws.send(JSON.stringify(hello));
        resolve(m); ws.close();
      });
    });
    const old = await handshake({ origin: 'https://asocengine.com' }, { type: 'protocol:hello', protocolVersion: 1 });
    assert.equal(old.type, 'protocol:mismatch');
    assert.equal(old.reload, true);
    assert.match(old.message, /REFRESH/);
    const fresh = await handshake({ origin: 'https://asocengine.com' }, { type: 'protocol:hello', protocolVersion: 1, clientBuild: 'x' });
    assert.equal(fresh.type, 'protocol:ready');
    assert.ok(fresh.clientBuild.player, 'the served build is announced');

    assert.equal(server.errors.trim(), '', 'no server errors');
    console.log('PASS MEGABONK: GM-only persistent alert to every connected player, per-player acknowledgement, live GM progress, re-delivered on reconnect until acknowledged, never again once acknowledged, new event needs fresh acks, survives restart, END, not a ritual vote, never starts the game, refused in live Battle');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL MEGABONK:', error);
  process.exit(1);
});
