// SCORING AUDIT -- live battles, exact point totals.
//   Column:  400 / 300 / 200 / 100 for 1 / 2 / 3 / 4 clues open WHEN THE GUESS
//            WAS SENT (a clue opened while the GM is judging costs nothing);
//            streak milestones +50 / +125 / +250; half value after the Final.
//   Final:   1200 / 800 / 500 / 300 for 1 / 2 / 3 / 4 column solutions KNOWN
//            (visible: solved OR failed OR revealed) when the guess was sent.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_SCORING_TEST_PORT) || 18891;
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
  constructor(name) { this.name = name; this.msgs = []; this.players = []; this.state = null; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'players:update') this.players = m.players || [];
        if (m.type === 'state:public') this.state = m;
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

async function battle(scenario) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-scoring-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'sc-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'sc-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const players = {};
    for (const name of ['Ana', 'Bo', 'Cy', 'Dee', 'Eli']) {
      const creds = { email: `${name.toLowerCase()}@sc.test`, password: 'sc-password' };
      await api('/api/auth/player/register', { ...creds, name });
      const token = (await api('/api/auth/player/login', creds)).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.next(m => m.type === 'join:success', `${name} join`);
      players[name] = c;
    }
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await sleep(400);
    Object.values(players).forEach(p => p.send({ type: 'ritual:join' }));
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual');
    gm.send({ type: 'gm:timerLaunchCountdown' });
    await sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await gm.next(m => m.type === 'state:public' && m.timer?.phase === 'running', 'running');

    let n = 0;
    const cmd = async (command, payload) => { gm.send({ type: 'gm:command', command, payload, cmdId: `sc-${++n}` }); await sleep(150); };
    const reveal = async (...cells) => { for (const cell of cells) await cmd('revealCell', { cell, reveal: true }); };
    const guess = async (who, text) => {
      const from = gm.mark();
      players[who].send({ type: 'chat:guess', text });
      const up = await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === text), `guess ${text}`, from);
      await sleep(450); // chat cooldown
      return up.messages.find(x => x.text === text);
    };
    const judge = async (msg, target) => {
      const from = gm.mark();
      gm.send({ type: 'gm:judgeGuess', messageId: msg.id, verdict: 'correct', target });
      await gm.next(m => m.type === 'gm:judge:ack' || m.type === 'error', 'judge', from);
      await sleep(300);
      if (target === 'FINAL') {
        // Final points are committed at once but shown only at SHOW RESULTS.
        const shown = gm.mark();
        gm.send({ type: 'gm:revealResults' });
        await gm.next(m => m.type === 'players:update', 'results shown', shown);
        await sleep(200);
      }
    };
    const score = who => gm.players.find(p => p.id === players[who].playerId)?.score ?? 0;
    const events = () => gm.msgs.filter(m => m.type === 'score:event');

    await scenario({ reveal, guess, judge, cmd, score, events, gm, players });
    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  // 1. Column points by clues open at SEND time; streaks; Final by known columns.
  await battle(async ({ reveal, guess, judge, score }) => {
    await reveal('A1');
    const a = await guess('Ana', 'alpha answer');           // 1 clue open when sent
    await reveal('A2', 'A3');                                // GM opens more before judging
    await judge(a, 'A');
    assert.equal(score('Ana'), 400, 'A: 1 clue at send = 400, clues opened while judging do not count');

    await reveal('B1', 'B2');
    const b = await guess('Ana', 'bravo answer');            // 2 clues -> 300, streak 2 -> +50
    await judge(b, 'B');
    assert.equal(score('Ana'), 400 + 300 + 50, 'B: 300 + streak milestone 50');

    await reveal('C1', 'C2', 'C3', 'C4');
    const c = await guess('Bo', 'charlie answer');           // 4 clues -> 100, breaks Ana's streak
    await judge(c, 'C');
    assert.equal(score('Bo'), 100);
    assert.equal(score('Ana'), 750, 'a broken streak keeps its earned milestone');

    const fin = await guess('Cy', 'final answer');           // 3 column solutions known -> 500
    await judge(fin, 'FINAL');
    assert.equal(score('Cy'), 500, 'Final with 3 known columns = 500');

    await reveal('D1', 'D2', 'D3');
    const d = await guess('Dee', 'delta answer');            // 3 clues -> 200, after Final -> 100
    await judge(d, 'D');
    assert.equal(score('Dee'), 100, 'a column after the Final is worth half');
  });

  // 2. Failed columns count as KNOWN for the Final: 2 solved + 2 failed -> 300.
  await battle(async ({ reveal, guess, judge, cmd, score }) => {
    await reveal('A1');
    await judge(await guess('Ana', 'alpha'), 'A');
    await reveal('B1');
    await judge(await guess('Bo', 'bravo'), 'B');
    await reveal('C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4');
    await cmd('resolveColumn', { column: 'C', outcome: 'failed' });
    await cmd('resolveColumn', { column: 'D', outcome: 'failed' });
    const fin = await guess('Cy', 'the final');
    await judge(fin, 'FINAL');
    assert.equal(score('Cy'), 300, 'Final with 4 visible solutions (2 solved, 2 failed) = 300');
  });

  // 3. All four columns FAILED: the Final still scores (300), not 0.
  await battle(async ({ reveal, guess, judge, cmd, score }) => {
    await reveal('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4');
    for (const col of ['A', 'B', 'C', 'D']) await cmd('resolveColumn', { column: col, outcome: 'failed' });
    const fin = await guess('Eli', 'last chance final');
    await judge(fin, 'FINAL');
    assert.equal(score('Eli'), 300, 'Final after four failed columns = 300 (was 0)');
  });

  // 4. Final solved early: 1 known column -> 1200; a column known only after
  //    the guess was sent does not lower it.
  await battle(async ({ reveal, guess, judge, score }) => {
    await reveal('A1');
    await judge(await guess('Ana', 'alpha'), 'A');
    const fin = await guess('Bo', 'early final');            // 1 known when sent
    await reveal('B1');
    await judge(await guess('Cy', 'bravo'), 'B');            // 2nd column solved before the Final is judged
    await judge(fin, 'FINAL');
    assert.equal(score('Bo'), 1200, 'Final valued by what was known when sent: 1 column = 1200');
  });

  console.log('PASS scoring audit: column 400/300/200/100 by clues open at send time, streak milestones, half after Final; Final 1200/800/500/300 by column solutions known at send time, failed columns count as known (all-failed Final scores 300, not 0)');
})().catch(error => {
  console.error('FAIL scoring audit:', error);
  process.exit(1);
});
