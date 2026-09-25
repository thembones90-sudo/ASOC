// Battle-flow regressions found by the ABUSE-to-RECOUNT audit. Plays real
// battles as the Shadow Broker + 5 Little Heroes against a private server on
// throwaway data, and pins the six mechanics that used to derail a game.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_BATTLE_FLOW_PORT) || 18720;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-battle-flow-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.state = null; this.chat = []; this.ritual = null; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (message.type === 'protocol:ready') return resolve(this);
        this.msgs.push(message);
        if (message.type === 'state:public') this.state = message;
        if (message.type === 'chat:update') this.chat = message.messages || [];
        if (message.type === 'ritual:gmUpdate') this.ritual = message.ritual;
      });
    });
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  mark() { return this.msgs.length; }
  errorsSince(mark) { return this.msgs.slice(mark).filter(m => m.type === 'error').map(m => m.message); }
  async waitFor(predicate, label, timeout = 6000) {
    const started = Date.now();
    let index = 0;
    while (Date.now() - started < timeout) {
      for (; index < this.msgs.length; index++) if (predicate(this.msgs[index])) return this.msgs[index];
      await sleep(20);
    }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

let gm;
const players = [];
const tokens = [];
const settle = (ms = 350) => sleep(ms);
const command = (name, payload = {}) => gm.send({ type: 'gm:command', command: name, payload, cmdId: `flow-${name}-${Math.random()}` });

async function joinPlayer(index) {
  const client = await new Client(`P${index + 1}`).open();
  client.send({ type: 'room:join', authToken: tokens[index], roomCode: 'MASTER', name: `Flow Hero ${index + 1}` });
  await client.waitFor(m => m.type === 'join:success', `player ${index + 1} join`);
  return client;
}

async function voteRitual() {
  for (const player of players) player.send({ type: 'ritual:join' });
  await gm.waitFor(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual 5/5');
}

async function launchBattle() {
  await voteRitual();
  gm.send({ type: 'gm:timerLaunchCountdown' });
  await settle(200);
  gm.send({ type: 'gm:timerStart' });
  await settle();
  assert.equal(gm.state.roomMode, 'BATTLE');
  assert.equal(gm.state.timer.phase, 'running');
}

async function nextGame() {
  gm.send({ type: 'gm:switchGame', gameId: 'sample-game' });
  await gm.waitFor(m => m.type === 'gm:switchGame:ack', 'NEXT GAME ack');
  await settle();
}

async function guess(player, text) {
  player.send({ type: 'chat:guess', text });
  await gm.waitFor(m => m.type === 'chat:update' && m.messages.some(x => x.text === text), `guess ${text}`);
  await sleep(380); // player chat cooldown
  return gm.chat.find(x => x.text === text);
}

async function gamesWon() {
  const probe = players[0];
  const mark = probe.mark();
  probe.send({ type: 'leaderboard:getAllTime' });
  const board = await probe.waitFor((m, i) => m.type === 'leaderboard:allTime', 'all-time leaderboard');
  probe.msgs.splice(mark);
  return Object.fromEntries((board.players || []).map(p => [p.name, p.gamesWon || 0]));
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'battle-flow-pass', ASOC_EMAIL_VERIFICATION: '0',
      ASOC_COLUMN_REVEAL_DELAY_MS: '200', ASOC_WHEEL_SPIN_DURATION_MS: '200' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors += chunk; });

  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'battle-flow-pass' })).data.token;
    for (let i = 0; i < 5; i++) {
      const response = await api('/api/auth/player/register', { email: `flow-hero-${i + 1}@asoc.test`, password: 'flow-hero-password', name: `Flow Hero ${i + 1}` });
      tokens.push(response.data.token);
    }
    gm = await new Client('GM').open();
    gm.send({ type: 'host:recover', gmToken });
    await gm.waitFor(m => m.type === 'host:recovered', 'host recovered');
    for (let i = 0; i < 5; i++) players.push(await joinPlayer(i));
    await settle();

    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await settle();
    assert.equal(gm.state.roomMode, 'BATTLE_ARMED', 'ABUSE arms the room');
    assert.equal(gm.ritual?.active, true, 'ABUSE opens the Summon Ritual');

    // 1. A voter dropping during the accepted T-10 launch no longer aborts it.
    await voteRitual();
    gm.send({ type: 'gm:timerLaunchCountdown' });
    await players[0].waitFor(m => m.type === 'battle:launchCountdown', 'players see T-10');
    players[4].close();
    await gm.waitFor(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 4, 'vote dropped to 4/5');
    let mark = gm.mark();
    gm.send({ type: 'gm:timerStart' });
    await settle();
    assert.deepEqual(gm.errorsSince(mark), [], 'launch accepted at 5/5 still starts after a voter drops');
    assert.equal(gm.state.roomMode, 'BATTLE');
    players[4] = await joinPlayer(4);

    // 2. A FINAL misjudged CORRECT and corrected to WRONG fully reopens the board.
    const winsBefore = await gamesWon();
    const misclick = await guess(players[3], 'FINAL MISCLICK');
    gm.send({ type: 'gm:judgeGuess', messageId: misclick.id, verdict: 'correct', target: 'FINAL', reveal: true });
    await settle();
    assert.equal(gm.state.finalSolution.revealed, true);
    assert.equal(gm.state.timer.phase, 'stopped', 'a solved FINAL stops the clock');
    const winsCredited = await gamesWon();
    assert.equal(winsCredited['Flow Hero 1'], (winsBefore['Flow Hero 1'] || 0) + 1, 'FINAL GREEN credits a lifetime win');
    gm.send({ type: 'gm:judgeGuess', messageId: misclick.id, verdict: 'wrong' });
    await settle();
    assert.equal(gm.state.finalSolution.revealed, false, 'undo re-hides the Final answer');
    assert.equal(gm.state.timer.phase, 'running', 'undo resumes the clock');
    assert.deepEqual(await gamesWon(), winsBefore, 'undo reverses the lifetime win');
    mark = gm.mark();
    gm.send({ type: 'gm:solutionCountdown', target: 'FINAL', seconds: 60 });
    await settle();
    assert.deepEqual(gm.errorsSince(mark), [], 'the reopened FINAL is playable again');

    // 3. Solution countdowns freeze with the clock and re-arm on resume.
    gm.send({ type: 'gm:solutionCountdown', target: 'D', seconds: 60 });
    await settle();
    gm.send({ type: 'gm:timerPause' });
    await settle();
    const frozen = gm.state.solutionCountdowns.D;
    assert.equal(frozen.paused, true, 'pause freezes a running countdown');
    assert.equal(frozen.deadline, null);
    assert.ok(frozen.remainingMs > 55000 && frozen.remainingMs <= 60000);
    await sleep(1200);
    gm.send({ type: 'gm:solutionCountdown', target: 'C', seconds: 60 });
    await settle();
    assert.equal(gm.state.solutionCountdowns.C.paused, true, 'a countdown started while paused starts frozen');
    assert.equal(gm.state.solutionCountdowns.D.remainingMs, frozen.remainingMs, 'frozen time does not drain');
    gm.send({ type: 'gm:timerResume' });
    await settle();
    const resumed = gm.state.solutionCountdowns.D;
    assert.ok(Number.isFinite(resumed.deadline) && !resumed.paused, 'resume re-arms with a real deadline');
    assert.ok(Math.abs((resumed.deadline - Date.now()) - frozen.remainingMs) < 2000, 'resume continues from the frozen remaining time');
    assert.equal(gm.state.cells.D5.revealed, false, 'nothing auto-failed while paused');

    // 4. NEXT GAME starts clean.
    command('revealCell', { cell: 'B1' });
    await settle();
    players[2].send({ type: 'player:hintRequest', cell: 'B1' });
    await settle();
    assert.ok(gm.state.hintClaims.B1);
    await nextGame();
    assert.deepEqual(gm.state.hintClaims || {}, {}, 'NEXT GAME drops the previous board\'s hint claims');
    assert.deepEqual(gm.state.solutionCountdowns || {}, {}, 'NEXT GAME drops the previous board\'s countdowns');
    await launchBattle();
    command('revealCell', { cell: 'B1' });
    await settle();
    mark = players[2].mark();
    players[2].send({ type: 'player:hintRequest', cell: 'B1' });
    await settle();
    assert.deepEqual(players[2].errorsSince(mark), [], 'the same row hint is available on the new board');

    // 5. REVEAL ALL mid-battle stops the clock, HIDE resumes it, GAME LOST stays available.
    command('revealAll');
    await settle();
    assert.equal(gm.state.timer.phase, 'stopped', 'REVEAL ALL mid-battle stops the clock');
    command('hideFinal');
    await settle();
    assert.equal(gm.state.timer.phase, 'running', 'hiding a GM-revealed Final resumes play');
    command('revealFinal');
    await settle();
    assert.equal(gm.state.timer.phase, 'stopped');
    mark = gm.mark();
    gm.send({ type: 'gm:failFinal' });
    await settle();
    assert.deepEqual(gm.errorsSince(mark), [], 'GAME LOST remains available after a GM reveal');
    assert.equal(gm.state.matchResult?.outcome, 'LOST');

    // 6. A Wheel still on its result when RECOUNT opens can be dismissed.
    await nextGame();
    await launchBattle();
    for (const column of ['A', 'B', 'C', 'D']) gm.send({ type: 'gm:failColumn', column });
    await settle();
    gm.send({ type: 'gm:failFinal' });
    await settle();
    assert.equal(gm.state.matchResult?.outcome, 'LOST');
    assert.equal(gm.state.womf.charge, 10, 'failed columns + FINAL RED charge WOMF to 10');
    gm.send({ type: 'gm:wheelOpen', segments: [] });
    await settle();
    gm.send({ type: 'gm:wheelRoll' });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.phase === 'result', 'wheel result');
    gm.send({ type: 'gm:finishGame' });
    await settle();
    gm.send({ type: 'gm:showRecount' });
    await settle();
    assert.equal(gm.state.roomMode, 'RECOUNT');
    mark = gm.mark();
    gm.send({ type: 'gm:wheelClose' });
    await settle();
    assert.deepEqual(gm.errorsSince(mark), [], 'the Wheel is dismissible during RECOUNT');
    assert.equal(gm.state.wheel.open, false, 'the Wheel leaves every screen');
    assert.equal(gm.state.bloodTribute?.status, 'required', 'the Blood Tribute is demanded');

    assert.equal(serverErrors.trim(), '', 'no server errors');
    console.log('PASS battle flow: launch lock, FINAL undo, countdown pause, NEXT GAME reset, REVEAL ALL, Wheel in RECOUNT');
  } finally {
    [gm, ...players].forEach(client => client?.close());
    server.kill();
    await sleep(200);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('FAIL battle flow:', error);
  process.exit(1);
});
