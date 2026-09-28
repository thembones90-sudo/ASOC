// AMUSEMENT PARK PAUSE -- H4 regression coverage.
// BATTLE -> CASUAL -> wait -> BATTLE must freeze battle time and resume it
// exactly, without resetting anything:
//   - normal clock: paused in CASUAL, no drain, resumes 'running' with the
//     same remaining time; solution countdowns freeze and re-arm
//   - Borrowed Time: paused in CASUAL, waiting longer than the whole reserve
//     never declares GAME LOST; back in BATTLE it resumes and still expires
//   - board, WOMF, scores and chat survive; a GM-paused clock stays paused
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_CASUAL_PAUSE_TEST_PORT) || 18895;
const BORROWED_MS = 3000;
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

async function battle(scenario) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-casual-pause-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'cp-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_TIMER_BORROWED_MS: String(BORROWED_MS) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'cp-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const players = [];
    for (const name of ['Ana', 'Bo', 'Cy', 'Dee', 'Eli']) {
      const creds = { email: `${name.toLowerCase()}@cp.test`, password: 'cp-password' };
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
    const command = (name, payload) => gm.send({ type: 'gm:command', command: name, payload, cmdId: `cp-${++cmd}` });
    const mode = async (target, expect) => {
      const from = gm.mark();
      gm.send({ type: 'gm:setRoomMode', mode: target });
      return gm.next(m => m.type === 'state:public' && m.roomMode === expect, `mode ${expect}`, from);
    };
    await scenario({ gm, players, command, mode });
    assert.equal(errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    await require('./lib/stop-process')(server);
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

(async () => {
  // 1. Normal clock + solution countdown + preserved battle state.
  await battle(async ({ gm, players, command, mode }) => {
    command('revealCell', { cell: 'A1' });
    command('resolveColumn', { column: 'B', outcome: 'failed' });
    gm.send({ type: 'gm:solutionCountdown', target: 'D', seconds: 60 });
    await sleep(600);
    const before = gm.state;
    assert.equal(before.timer.phase, 'running');
    const womfBefore = JSON.stringify(before.womf);
    const cellsBefore = JSON.stringify(before.cells);

    const casual = await mode('CASUAL', 'CASUAL');
    assert.equal(casual.timer.phase, 'paused', 'entering AMUSEMENT PARK pauses the battle clock');
    const frozenRemaining = casual.timer.remaining;
    assert.equal(casual.solutionCountdowns.D.paused, true, 'solution countdown frozen in CASUAL');
    const frozenCountdown = casual.solutionCountdowns.D.remainingMs;
    players[0].send({ type: 'chat:guess', text: 'just hanging out in the park' });
    await sleep(2600);
    assert.equal(gm.state.timer.phase, 'paused');
    assert.equal(gm.state.timer.remaining, frozenRemaining, 'no battle time drains in CASUAL');
    assert.equal(gm.state.solutionCountdowns.D.remainingMs, frozenCountdown, 'countdown does not drain in CASUAL');

    const back = await mode('BATTLE', 'BATTLE');
    assert.equal(back.timer.phase, 'running', 'returning to BATTLE resumes the clock');
    assert.ok(Math.abs(back.timer.remaining - frozenRemaining) <= 1000, 'resumes with the time that was left');
    assert.ok(Number.isFinite(back.solutionCountdowns.D.deadline) && !back.solutionCountdowns.D.paused, 'countdown re-armed');
    assert.equal(JSON.stringify(back.womf), womfBefore, 'WOMF untouched');
    assert.equal(JSON.stringify(back.cells), cellsBefore, 'board untouched');
    assert.ok(gm.chat.some(m => m.text === 'just hanging out in the park'), 'chat preserved');

    // A clock the GM paused stays paused through CASUAL and back.
    gm.send({ type: 'gm:timerPause' });
    await sleep(300);
    await mode('CASUAL', 'CASUAL');
    const again = await mode('BATTLE', 'BATTLE');
    assert.equal(again.timer.phase, 'paused', 'a GM-paused clock is not auto-resumed');
  });

  // 2. Borrowed Time: CASUAL longer than the whole reserve never loses the game.
  await battle(async ({ gm, command, mode }) => {
    for (const column of ['A', 'B', 'C', 'D']) command('resolveColumn', { column, outcome: 'failed' });
    await gm.next(m => m.type === 'state:public' && m.timer?.phase === 'borrowed', 'borrowed time', 0, 4000);
    const casual = await mode('CASUAL', 'CASUAL');
    assert.equal(casual.timer.phase, 'borrowed_paused', 'Borrowed Time pauses in AMUSEMENT PARK');
    const reserve = casual.timer.borrowedRemaining;
    await sleep(BORROWED_MS + 2000);
    assert.equal(gm.state.matchResult, null, 'no GAME LOST while the room is CASUAL');
    assert.equal(gm.state.timer.phase, 'borrowed_paused');
    assert.equal(gm.state.timer.borrowedRemaining, reserve, 'Borrowed Time does not drain in CASUAL');

    const back = await mode('BATTLE', 'BATTLE');
    assert.equal(back.timer.phase, 'borrowed', 'Borrowed Time resumes on return');
    assert.ok(Math.abs(back.timer.borrowedRemaining - reserve) <= 1000);
    const lost = await gm.next(m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'game lost after resume', 0, BORROWED_MS + 4000);
    assert.equal(lost.roomMode, 'BATTLE', 'GAME LOST only ever happens on the Battle surface');
  });

  console.log('PASS casual battle pause: BATTLE->CASUAL freezes the clock, Borrowed Time and solution countdowns; no GAME LOST in CASUAL; BATTLE resumes exact timing; board/WOMF/chat preserved; GM pause respected');
})().catch(error => {
  console.error('FAIL casual battle pause:', error);
  process.exit(1);
});
