// ALL COLUMNS OPEN -> BORROWED TIME.
// When all four column solutions are on the board (solved or failed) and
// only the Final remains, the normal clock is forfeited and Borrowed Time
// (2:00 in production) starts; when it runs out the game is LOST.
//   - 3 columns open: the normal clock keeps running
//   - 4th column opens (mixed solved/failed): Borrowed Time within a second,
//     full reserve, normal time zero, Shadow Broker announcement once
//   - expiry: GAME LOST
//   - if the Final is solved before the last column opens: no Borrowed Time
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_ALLCOLS_TEST_PORT) || 18881;
const BORROWED_MS = 4000;
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
  constructor(name) { this.name = name; this.msgs = []; this.state = null; this.chat = []; }
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
        if (m.type === 'chat:update') this.chat = m.messages || [];
        if (m.type === 'join:success') this.playerId = m.playerId;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(predicate, label, from = 0, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) { const f = this.msgs.slice(from).find(predicate); if (f) return f; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function run(scenario) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-allcols-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'ac-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_TIMER_BORROWED_MS: String(BORROWED_MS) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'ac-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const players = [];
    for (const name of ['Ana', 'Bo', 'Cy', 'Dee', 'Eli']) {
      const creds = { email: `${name.toLowerCase()}@ac.test`, password: 'ac-password' };
      await api('/api/auth/player/register', { ...creds, name });
      const token = (await api('/api/auth/player/login', creds)).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.next(m => m.type === 'join:success', `${name} join`);
      players.push(c);
    }
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await sleep(400);
    players.forEach(p => p.send({ type: 'ritual:join' }));
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual 5/5');
    gm.send({ type: 'gm:timerLaunchCountdown' });
    await sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await gm.next(m => m.type === 'state:public' && m.timer?.phase === 'running', 'clock running');
    let cmd = 0;
    const command = (command, payload) => gm.send({ type: 'gm:command', command, payload, cmdId: `t-${++cmd}` });
    const phase = () => gm.state.timer.phase;

    if (scenario === 'final-first') {
      // The Final is solved while columns remain: no Borrowed Time ever.
      const from = gm.mark();
      players[0].send({ type: 'chat:guess', text: 'the final answer' });
      const msg = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'the final answer'), 'guess', from)).messages.find(x => x.text === 'the final answer');
      gm.send({ type: 'gm:judgeGuess', messageId: msg.id, verdict: 'correct', target: 'FINAL' });
      await sleep(600);
      for (const col of ['A', 'B', 'C', 'D']) { command('resolveColumn', { column: col, outcome: 'failed' }); await sleep(200); }
      await sleep(1600);
      assert.ok(!['borrowed', 'borrowed_paused'].includes(phase()), 'a solved Final never triggers Borrowed Time');
      assert.ok(!gm.chat.some(m => /ALL COLUMNS OPEN/.test(m.text || '')));
      return;
    }

    // Mixed outcomes: one solved from chat, one solved by the GM, two failed.
    const guessFrom = gm.mark();
    players[1].send({ type: 'chat:guess', text: 'column a answer' });
    const guess = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'column a answer'), 'col guess', guessFrom)).messages.find(x => x.text === 'column a answer');
    gm.send({ type: 'gm:judgeGuess', messageId: guess.id, verdict: 'correct', target: 'A' });
    await sleep(300);
    command('resolveColumn', { column: 'B', outcome: 'failed' });
    command('resolveColumn', { column: 'C', outcome: 'success' });
    await sleep(1600);
    assert.equal(phase(), 'running', 'three open columns do not trigger it');
    const normalBefore = gm.state.timer.remaining;
    assert.ok(normalBefore > 60000);

    const from = gm.mark();
    command('resolveColumn', { column: 'D', outcome: 'failed' });
    const borrowed = await gm.next(m => m.type === 'state:public' && m.timer?.phase === 'borrowed', 'borrowed time', from, 3000);
    assert.equal(borrowed.timer.remaining, 0, 'normal time is forfeited');
    assert.ok(borrowed.timer.borrowedRemaining > BORROWED_MS - 1500, 'full Borrowed Time reserve');
    const announce = await gm.next(m => m.type === 'chat:update' && m.messages.some(x => /ALL COLUMNS OPEN/.test(x.text || '')), 'announcement', from);
    assert.equal(announce.messages.filter(x => /ALL COLUMNS OPEN/.test(x.text || '')).length, 1);
    const playerSees = await players[0].next(m => m.type === 'state:public' && m.timer?.phase === 'borrowed', 'players see it');
    assert.ok(playerSees);

    // Nobody solves the Final: GAME LOST when Borrowed Time runs out.
    const lost = await gm.next(m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'game lost', from, BORROWED_MS + 4000);
    assert.ok(lost);
    await sleep(1500);
    assert.equal(gm.chat.filter(x => /ALL COLUMNS OPEN/.test(x.text || '')).length, 1, 'announced exactly once');
    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  await run('all-columns');
  await run('final-first');
  console.log('PASS all columns open -> Borrowed Time: triggers only when all four column solutions are open (solved or failed) with the Final unresolved, forfeits normal time, full reserve, announced once, expiry loses the game; a solved Final never triggers it');
})().catch(error => {
  console.error('FAIL all columns open -> Borrowed Time:', error);
  process.exit(1);
});
