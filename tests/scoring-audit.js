// SCORING + SHADOW COIN AUDIT -- live battles, exact points and coins.
//   Column (clues open when the guess was SUBMITTED):
//     500 / 325 / 200 / 100 pts   +1.0 / 0.7 / 0.4 / 0.2 SC
//   Column after a legitimate Final solve:
//     250 / 160 / 100 / 50 pts    +0.5 / 0.4 / 0.2 / 0.1 SC
//   Final (column solutions VISIBLE -- A5-D5 on the board -- at submission):
//     2200 / 1400 / 850 / 450 pts +5 / 3 / 2 / 1 SC;  0 visible = 0 pts, 0 SC
//   Streak milestones: +50 / +100 / +150 POINTS ONLY (4-streak = 300).
//   Failed Final: no point or coin penalty.
//   Verdict correction reverses the exact points and coins; re-accepting
//   pays again (at the value that applies now).
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
const round1 = n => Math.round(n * 10) / 10;

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

async function battle(label, scenario) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-scoring-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'sc-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_COLUMN_REVEAL_DELAY_MS: '150' },
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
    const judge = async (msg, target, verdict = 'correct') => {
      const from = gm.mark();
      gm.send({ type: 'gm:judgeGuess', messageId: msg.id, verdict, target });
      await gm.next(m => m.type === 'gm:judge:ack' || m.type === 'error', 'judge', from);
      await sleep(350); // chat-solved columns show their solution after 150ms
      if (target === 'FINAL' && verdict === 'correct') {
        // Final points are committed at once but shown only at SHOW RESULTS.
        const shown = gm.mark();
        gm.send({ type: 'gm:revealResults' });
        await gm.next(m => m.type === 'players:update', 'results shown', shown);
        await sleep(200);
      }
    };
    const me = who => gm.players.find(p => p.id === players[who].playerId) || {};
    const score = who => me(who).score ?? 0;
    const coins = who => round1(me(who).shadowCoins ?? 0);
    const expect = (who, pts, sc, why) => {
      assert.equal(score(who), pts, `${label}: ${who} points // ${why}`);
      assert.equal(coins(who), round1(sc), `${label}: ${who} Shadow Coins // ${why}`);
    };

    await scenario({ reveal, guess, judge, cmd, expect, score, coins, gm });
    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  // 1. Column table, submission-time snapshot, points-only streak milestones,
  //    Final with 4 visible, verdict correction + re-acceptance after the Final.
  await battle('columns', async ({ reveal, guess, judge, expect }) => {
    await reveal('A1');
    const a = await guess('Ana', 'alpha');                  // 1 clue when submitted
    await reveal('A2', 'A3');                               // opened while the GM judges
    await judge(a, 'A');
    expect('Ana', 500, 1.0, '1 clue at submission = 500 / 1.0 (later clues do not count)');

    await reveal('B1', 'B2');
    await judge(await guess('Ana', 'bravo'), 'B');
    expect('Ana', 500 + 325 + 50, 1.0 + 0.7, '2 clues = 325 / 0.7, streak x2 +50 points only');

    await reveal('C1', 'C2', 'C3');
    await judge(await guess('Ana', 'charlie'), 'C');
    expect('Ana', 875 + 200 + 100, 1.7 + 0.4, '3 clues = 200 / 0.4, streak x3 +100 points only');

    await reveal('D1', 'D2', 'D3', 'D4');
    const d = await guess('Ana', 'delta');
    await judge(d, 'D');
    expect('Ana', 1175 + 100 + 150, 2.1 + 0.2, '4 clues = 100 / 0.2, streak x4 +150: sweep bonus 300 total');

    await judge(await guess('Bo', 'final'), 'FINAL');
    expect('Bo', 450, 1.0, 'Final with 4 visible solutions = 450 / 1.0');

    // Correction: D wrong -> exactly 100 pts + 150 streak and 0.2 SC come back off.
    await judge(d, 'D', 'wrong');
    expect('Ana', 1175, 2.1, 'reversing D removes its exact points, streak and coins');
    // Re-accepting D now places it AFTER the Final: after-Final value 50 / 0.1,
    // and the 4-streak (A,B,C,D all Ana) is rebuilt.
    await judge(d, 'D');
    expect('Ana', 1175 + 50 + 150, 2.1 + 0.1, 're-accepting pays again, at the after-Final value');
  });

  // 2. Final values by visible solutions: 1 -> 2200 / 5.0.
  await battle('final-1', async ({ reveal, guess, judge, cmd, expect }) => {
    await reveal('A1', 'A2', 'A3', 'A4');
    await cmd('resolveColumn', { column: 'A', outcome: 'failed' });   // failed AND visible
    await judge(await guess('Cy', 'final'), 'FINAL');
    expect('Cy', 2200, 5.0, 'Final with 1 visible solution = 2200 / 5.0');
  });

  // 3. 2 visible -> 1400 / 3.0; 3 visible -> 850 / 2.0 (sent before the 3rd reveal
  //    would not count it, so each count is set up before the guess).
  await battle('final-2', async ({ reveal, guess, judge, cmd, expect }) => {
    await reveal('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4');
    await cmd('resolveColumn', { column: 'A', outcome: 'failed' });
    await cmd('resolveColumn', { column: 'B', outcome: 'failed' });
    await judge(await guess('Dee', 'final'), 'FINAL');
    expect('Dee', 1400, 3.0, 'Final with 2 visible = 1400 / 3.0');
  });
  await battle('final-3', async ({ reveal, guess, judge, cmd, expect }) => {
    await reveal('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4');
    for (const col of ['A', 'B', 'C']) await cmd('resolveColumn', { column: col, outcome: 'failed' });
    await judge(await guess('Eli', 'final'), 'FINAL');
    expect('Eli', 850, 2.0, 'Final with 3 visible = 850 / 2.0');
  });

  // 4. Zero visible: 0 points, 0 coins -- but the Final IS solved.
  await battle('final-0', async ({ guess, judge, expect, gm }) => {
    await judge(await guess('Ana', 'bold final'), 'FINAL');
    expect('Ana', 0, 0, 'Final with zero visible solutions = 0 / 0');
    assert.ok(gm.msgs.some(m => m.type === 'score:finalReveal' && m.outcome === 'success'), 'the correct Final is still accepted as the solve');
  });

  // 5. Failed-but-hidden does not reduce the Final; failed-and-visible does.
  await battle('hidden-failed', async ({ reveal, guess, judge, cmd, expect, gm }) => {
    await reveal('A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4');
    gm.send({ type: 'gm:failColumn', column: 'A' });          // failed (reveals A5)...
    await sleep(250);
    await cmd('revealCell', { cell: 'A5', reveal: false });    // ...then hidden again
    await cmd('resolveColumn', { column: 'B', outcome: 'failed' }); // failed AND visible
    assert.equal(gm.state.cells?.A5?.revealed === true, false, 'A5 is hidden');
    await judge(await guess('Bo', 'final'), 'FINAL');
    expect('Bo', 2200, 5.0, 'only the visible failed solution (B) counts: 1 visible = 2200 / 5.0');
  });

  // 6. Post-Final columns: 250 / 160 / 100 / 50 and 0.5 / 0.4 / 0.2 / 0.1
  //    (different solvers, so no streak bonuses interfere).
  await battle('after-final', async ({ reveal, guess, judge, expect }) => {
    await reveal('A5');                                         // 1 visible so the Final scores
    await judge(await guess('Eli', 'final'), 'FINAL');
    await reveal('B1');
    await judge(await guess('Ana', 'b'), 'B');
    expect('Ana', 250, 0.5, 'after the Final, 1 clue = 250 / 0.5');
    await reveal('C1', 'C2');
    await judge(await guess('Bo', 'c'), 'C');
    expect('Bo', 160, 0.4, 'after the Final, 2 clues = 160 / 0.4');
    await reveal('D1', 'D2', 'D3');
    await judge(await guess('Cy', 'd'), 'D');
    expect('Cy', 100, 0.2, 'after the Final, 3 clues = 100 / 0.2');
  });
  await battle('after-final-4', async ({ reveal, guess, judge, expect }) => {
    await reveal('A5');
    await judge(await guess('Eli', 'final'), 'FINAL');
    await reveal('B1', 'B2', 'B3', 'B4');
    await judge(await guess('Dee', 'b'), 'B');
    expect('Dee', 50, 0.1, 'after the Final, 4 clues = 50 / 0.1');
  });

  // 7. Failed Final: no point or coin penalty for anyone.
  await battle('failed-final', async ({ reveal, guess, judge, expect, gm }) => {
    await reveal('A1');
    await judge(await guess('Ana', 'alpha'), 'A');
    expect('Ana', 500, 1.0, 'before the failed Final');
    const lost = gm.mark();
    gm.send({ type: 'gm:failFinal' });
    await gm.next(m => m.type === 'state:public' && m.matchResult?.outcome === 'LOST', 'game lost', lost);
    await sleep(400);
    expect('Ana', 500, 1.0, 'a failed Final deducts no points and no coins');
    expect('Bo', 0, 0, 'players without solves are not pushed negative');
  });

  console.log('PASS scoring + Shadow Coin audit: column 500/325/200/100 (+1.0/0.7/0.4/0.2 SC) by clues at submission; Final 2200/1400/850/450 (+5/3/2/1 SC) by VISIBLE solutions at submission, zero visible = 0/0; failed-but-hidden columns do not count; after-Final columns 250/160/100/50 (+0.5/0.4/0.2/0.1 SC); streaks +50/+100/+150 points only; failed Final no penalty; corrections reverse and re-issue exactly');
})().catch(error => {
  console.error('FAIL scoring audit:', error);
  process.exit(1);
});
