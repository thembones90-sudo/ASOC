// BACKDOOR // RESET SCOREBOARD: wipes all Battle scoring (session scores,
// lifetime points and records, the completed-match archive) while every
// Little Hero keeps their Shadow Coins, cosmetics and relics. Host only,
// typed confirmation, never during a battle, backup written first.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_SCOREBOARD_TEST_PORT) || 18901;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-scoreboard-'));
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

(async () => {
  // A past completed match so there is history to clear.
  fs.writeFileSync(path.join(DATA, 'matches.json'), JSON.stringify({ version: 1, matches: { 'old-match': { matchId: 'old-match', completedAt: Date.now() - 86400000, resultsShownAt: Date.now() - 86000000, players: [] } } }));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'sb-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'sb-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const players = [];
    for (const name of ['Ana', 'Bo', 'Cy', 'Dee', 'Eli']) {
      const creds = { email: `${name.toLowerCase()}@sb.test`, password: 'sb-password' };
      await api('/api/auth/player/register', { ...creds, name });
      const token = (await api('/api/auth/player/login', creds)).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.next(m => m.type === 'join:success', `${name} join`);
      players.push(c);
    }
    const ana = players[0];

    // Play a little: Ana solves column A with 1 clue (500 pts, 1.0 SC).
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await sleep(400);
    players.forEach(p => p.send({ type: 'ritual:join' }));
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual');
    gm.send({ type: 'gm:timerLaunchCountdown' });
    await sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await gm.next(m => m.type === 'state:public' && m.timer?.phase === 'running', 'running');
    gm.send({ type: 'gm:command', command: 'revealCell', payload: { cell: 'A1', reveal: true }, cmdId: 'sb-1' });
    await sleep(200);
    let from = gm.mark();
    ana.send({ type: 'chat:guess', text: 'alpha' });
    const msg = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'alpha'), 'guess', from)).messages.find(x => x.text === 'alpha');
    gm.send({ type: 'gm:judgeGuess', messageId: msg.id, verdict: 'correct', target: 'A' });
    await sleep(500);
    const before = gm.players.find(p => p.id === ana.playerId);
    assert.equal(before.score, 500);
    assert.equal(before.shadowCoins, 1);

    // Refused during a battle.
    from = gm.mark();
    gm.send({ type: 'gm:resetScoreboard', confirm: 'RESET' });
    assert.match((await gm.next(m => m.type === 'error', 'battle refusal', from)).message, /NOT DURING A BATTLE/);

    // Back to the Amusement Park.
    gm.send({ type: 'gm:setRoomMode', mode: 'CASUAL' });
    await gm.next(m => m.type === 'state:public' && m.roomMode === 'CASUAL', 'casual');

    // Refused without the typed confirmation, and for players.
    from = gm.mark();
    gm.send({ type: 'gm:resetScoreboard' });
    assert.match((await gm.next(m => m.type === 'error', 'unconfirmed', from)).message, /not confirmed/);
    from = ana.mark();
    ana.send({ type: 'gm:resetScoreboard', confirm: 'RESET' });
    assert.match((await ana.next(m => m.type === 'error', 'player refused', from)).message, /Only the Shadow Broker/);

    const profileBefore = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'))[ana.playerId];
    assert.equal(profileBefore.lifetimeScore, 500);
    assert.equal(profileBefore.columnSolutions, 1);

    // RESET.
    from = gm.mark();
    gm.send({ type: 'gm:resetScoreboard', confirm: 'RESET' });
    const done = await gm.next(m => m.type === 'gm:scoreboardReset', 'reset ack', from);
    assert.ok(done.profiles >= 5);
    assert.equal(done.matches, 1);
    await sleep(300);

    // Session scores zero, coins kept.
    const after = gm.players.find(p => p.id === ana.playerId);
    assert.equal(after.score, 0, 'session score wiped');
    assert.equal(after.shadowCoins, 1, 'Shadow Coins are kept');
    // Lifetime records zero, coins/ledger kept.
    const profile = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'))[ana.playerId];
    for (const field of ['lifetimeScore', 'gamesPlayed', 'gamesWon', 'columnSolutions', 'oneClueColumnSolutions', 'finalSolutions', 'bestColumnStreak']) {
      assert.equal(profile[field], 0, `${field} wiped`);
    }
    assert.equal(profile.shadowCoinUnits, 10, 'coin balance kept');
    assert.ok(profile.shadowCoinLedger.length >= 1, 'coin ledger kept');
    // Match history wiped; backup written.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'matches.json'), 'utf8')).matches, {});
    const backup = path.join(DATA, 'backups', done.backup);
    assert.ok(fs.existsSync(path.join(backup, 'players.json')) && fs.existsSync(path.join(backup, 'matches.json')), 'backup written');
    assert.equal(JSON.parse(fs.readFileSync(path.join(backup, 'players.json'), 'utf8'))[ana.playerId].lifetimeScore, 500, 'the backup holds the old scores');
    // All-time leaderboard refreshed to zero.
    const board = gm.msgs.filter(m => m.type === 'leaderboard:allTime').at(-1);
    assert.ok(board.players.every(p => p.lifetimeScore === 0));

    // The Backdoor button exists and requires typing RESET.
    const backdoor = fs.readFileSync(path.join(ROOT, 'js/backdoor.js'), 'utf8');
    assert.match(backdoor, /RESET SCOREBOARD[\s\S]{0,900}Type RESET to confirm/);

    assert.equal(server.errors.trim(), '', 'no server errors');
    console.log('PASS scoreboard reset: host-only, typed confirmation, refused during battle; wipes session scores, lifetime points/records and match history; keeps Shadow Coins and ledger; backup written first');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL scoreboard reset:', error);
  process.exit(1);
});
