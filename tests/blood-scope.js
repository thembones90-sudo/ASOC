// THE BLOOD SCOPE -- server-authoritative selection, commit and obligation.
// Real server, real sockets: GM + three Little Heroes.
//   * only the GM can activate; one ritual at a time
//   * the victim is chosen server-side from the eligible online players
//   * the hunt publishes (seed, startedAt, durationMs) and creates NO debt
//   * the strike COMMITS exactly one obligation + exactly one announcement
//   * closing the overlay after commit never undoes it; aborting before it
//     creates nothing
//   * a victim who disconnects mid-hunt is still the committed victim
//   * a late client sees the committed state
//   * selection is unbiased across many rolls
//   * the GM command button works in AMUSE without WOMF charge and never spends it
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_SCOPE_TEST_PORT) || 18877;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-scope-'));
const SPIN_MS = 450;
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
  constructor(name) { this.name = name; this.msgs = []; this.state = null; this.chat = []; this.playerId = null; }
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
        if (m.type === 'chat:delta') {
          for (const msg of m.messages || []) {
            const i = this.chat.findIndex(x => x.id === msg.id);
            if (i >= 0) this.chat[i] = msg; else this.chat.push(msg);
          }
        }
        if (m.type === 'join:success') this.playerId = m.playerId || m.player?.id || this.playerId;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async waitFor(predicate, label, from = 0, timeout = 8000) {
    const started = Date.now();
    let i = from;
    while (Date.now() - started < timeout) {
      for (; i < this.msgs.length; i++) if (predicate(this.msgs[i])) return this.msgs[i];
      await sleep(15);
    }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

const scopeLines = client => client.chat.filter(m => m.messageType === 'bloodScope');

(async () => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'scope-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_WHEEL_SPIN_DURATION_MS: String(SPIN_MS) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = '';
  server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'scope-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.waitFor(m => m.type === 'host:recovered', 'host recovered');

    const names = ['Ana', 'Bo', 'Cy'];
    const players = [];
    const join = async name => {
      const token = (await api('/api/auth/player/register', { email: `${name.toLowerCase()}@scope.test`, password: 'scope-password', name })).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.waitFor(m => m.type === 'join:success', `${name} join`);
      return { c, token };
    };
    for (const name of names) players.push((await join(name)).c);
    await sleep(300);

    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await gm.waitFor(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED', 'armed');
    for (let i = 0; i < 10; i++) gm.send({ type: 'gm:womfAdd' });
    await gm.waitFor(m => m.type === 'state:public' && m.womf?.charge === 10, 'WOMF 10/10');

    // ---- 1. a regular player can neither open nor activate the scope -------
    let mark = gm.mark();
    players[0].send({ type: 'gm:wheelOpen', segments: [] });
    players[0].send({ type: 'gm:wheelRoll' });
    await sleep(250);
    assert.ok(!gm.state.wheel.open, 'a Little Hero cannot open the Blood Scope');
    assert.equal(gm.state.wheel.phase, 'idle');
    assert.equal(gm.state.bloodTribute.status, 'idle');

    // ---- 2. GM arms it: only connected Little Heroes, with immutable ids ---
    mark = gm.mark();
    gm.send({ type: 'gm:wheelOpen', segments: [] });
    const armed = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open && m.wheel.phase === 'idle', 'scope armed', mark);
    assert.deepEqual([...armed.wheel.segments].sort(), [...names].sort(), 'eligible pool = the connected Little Heroes (never the Shadow Broker)');
    assert.equal(armed.wheel.segmentIds.length, 3);
    assert.ok(armed.wheel.segmentIds.every(id => typeof id === 'string' && id.length > 0), 'every candidate carries an immutable id');

    // ---- 3. ACTIVATE: hunt publishes the event but creates no debt ---------
    mark = gm.mark();
    const p1mark = players[0].mark();
    gm.send({ type: 'gm:wheelRoll' });
    gm.send({ type: 'gm:wheelRoll' }); // duplicate activation must not start a second ritual
    const hunt = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.phase === 'spinning', 'hunt starts', mark);
    assert.ok(hunt.wheel.seed && hunt.wheel.startedAt && hunt.wheel.durationMs === SPIN_MS, 'event seed, shared start time and duration are published');
    assert.equal(hunt.bloodTribute.status, 'idle', 'no obligation exists while the scope is hunting');
    assert.equal(scopeLines(gm).length, 0, 'no announcement while the scope is hunting');
    const huntOnP1 = await players[0].waitFor(m => m.type === 'state:public' && m.wheel?.phase === 'spinning', 'player sees the hunt', p1mark);
    assert.equal(huntOnP1.wheel.eventId, hunt.wheel.eventId, 'every participant gets the same event');
    assert.equal(huntOnP1.wheel.winnerIndex, hunt.wheel.winnerIndex, 'every participant gets the same selected target');
    assert.equal(huntOnP1.wheel.seed, hunt.wheel.seed, 'every participant derives the hunt from the same seed');
    const errsDup = gm.msgs.slice(mark).filter(m => m.type === 'error');
    assert.ok(errsDup.some(m => /already spinning/i.test(m.message)), 'a second activation is rejected while one ritual is active');

    // ---- 4. the strike commits exactly one obligation + one announcement ----
    const committed = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.phase === 'result' && m.wheel.committedAt, 'strike commits', mark);
    const winnerId = committed.wheel.segmentIds[committed.wheel.winnerIndex];
    const winnerName = committed.wheel.segments[committed.wheel.winnerIndex];
    assert.equal(committed.bloodTribute.status, 'required');
    assert.equal(committed.bloodTribute.playerId, winnerId, 'obligation is bound to the selected immutable player id');
    assert.equal(committed.bloodTribute.playerName, winnerName);
    assert.equal(committed.bloodTribute.sourceLabel, 'BLOOD SCOPE', 'obligation is labelled SOURCE: BLOOD SCOPE');
    assert.equal(committed.bloodTribute.source, 'womf', 'it is the ordinary Blood Tribute demand (no second tribute system)');
    await sleep(200);
    const lines = scopeLines(gm);
    assert.equal(lines.length, 1, 'exactly one public announcement');
    assert.equal(lines[0].source, 'shadowBroker', 'attributed to the Shadow Broker identity');
    assert.equal(lines[0].playerId, null, 'never impersonates a Little Hero');
    assert.match(lines[0].text, new RegExp(`VICTIM: ${winnerName}`));
    assert.match(lines[0].text, /BLOOD TRIBUTE REQUIRED/);
    assert.equal(scopeLines(players[0]).length, 1, 'players receive the same single announcement');

    // ---- 5. no reroll while committed; closing the overlay keeps the debt ---
    mark = gm.mark();
    gm.send({ type: 'gm:wheelRoll' });
    await sleep(200);
    assert.ok(gm.msgs.slice(mark).some(m => m.type === 'error'), 'cannot roll again over a committed result');
    mark = gm.mark();
    gm.send({ type: 'gm:wheelClose' });
    const closed = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open === false, 'overlay closed', mark);
    assert.equal(closed.bloodTribute.status, 'required', 'closing the overlay after commit never undoes the obligation');
    assert.equal(closed.bloodTribute.playerId, winnerId);
    assert.equal(scopeLines(gm).length, 1, 'closing does not repeat the announcement');

    // ---- 6. a late client resumes on the committed state -------------------
    const late = (await join('Dee')).c;
    await sleep(200);
    assert.equal(late.state.bloodTribute.status, 'required', 'a reconnecting/late client sees the pending target');
    assert.equal(late.state.bloodTribute.playerId, winnerId);
    assert.equal(scopeLines(late).length, 1, 'a late joiner sees the completed announcement in history');
    late.close();

    // ---- 7. release the debt -> scope re-armed; ABORT before commit --------
    mark = gm.mark();
    gm.send({ type: 'gm:tributeForgive' });
    await gm.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'idle', 'debt released', mark);
    gm.send({ type: 'gm:wheelOpen', segments: [] });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open && m.wheel.phase === 'idle', 'scope re-armed', mark);
    const beforeAbort = scopeLines(gm).length;
    mark = gm.mark();
    gm.send({ type: 'gm:wheelRoll' });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.phase === 'spinning', 'second hunt', mark);
    gm.send({ type: 'gm:wheelClose' }); // ABORT ACQUISITION
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open === false, 'aborted', mark);
    await sleep(SPIN_MS + 400);
    assert.equal(gm.state.bloodTribute.status, 'idle', 'aborting before commitment creates no obligation');
    assert.equal(scopeLines(gm).length, beforeAbort, 'aborting before commitment posts no announcement');
    assert.equal(gm.state.wheel.committedAt || null, null);

    // ---- 8. fairness: every eligible hero is reachable, none dominates ------
    mark = gm.mark();
    gm.send({ type: 'gm:wheelOpen', segments: [] });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open && m.wheel.phase === 'idle', 'armed for fairness run', mark);
    const tally = Object.fromEntries(names.map(n => [n, 0]));
    const ROLLS = 60;
    for (let i = 0; i < ROLLS; i++) {
      mark = gm.mark();
      gm.send({ type: 'gm:wheelRoll' });
      const done = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.committedAt, `fairness roll ${i + 1}`, mark);
      const who = done.wheel.segments[done.wheel.winnerIndex];
      assert.ok(names.includes(who), 'only eligible Little Heroes are ever selected');
      tally[who]++;
      mark = gm.mark();
      gm.send({ type: 'gm:tributeForgive' });
      await gm.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'idle' && m.wheel?.open && m.wheel.phase === 'idle', 'reopened', mark);
    }
    names.forEach(n => assert.ok(tally[n] >= 7 && tally[n] <= 36, `selection is unbiased: ${n} was picked ${tally[n]}/${ROLLS} times`));

    // ---- 9. victim disconnects mid-hunt: the committed result still stands --
    mark = gm.mark();
    gm.send({ type: 'gm:wheelRoll' });
    const hunt3 = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.phase === 'spinning', 'final hunt', mark);
    const victim3 = hunt3.wheel.segmentIds[hunt3.wheel.winnerIndex];
    const victimName = hunt3.wheel.segments[hunt3.wheel.winnerIndex];
    players.find(p => p.name === victimName).close();
    const commit3 = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.committedAt && m.wheel.spinToken === hunt3.wheel.spinToken, 'commit after disconnect', mark);
    assert.equal(commit3.bloodTribute.playerId, victim3, 'a victim who disconnects mid-animation is still the committed victim');

    // ---- 10. COMMAND button: any mode, no WOMF charge, charge untouched -----
    mark = gm.mark();
    gm.send({ type: 'gm:tributeForgive' });
    await gm.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'idle', 'previous debt released', mark);
    gm.send({ type: 'gm:wheelClose' });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open === false, 'scope reset', mark);
    gm.send({ type: 'gm:setRoomMode', mode: 'CASUAL' });
    await gm.waitFor(m => m.type === 'state:public' && m.roomMode === 'CASUAL', 'AMUSE mode', mark);
    const chargeBefore = gm.state.womf.charge;

    mark = gm.mark();
    gm.send({ type: 'gm:wheelOpen', segments: [] }); // the WOMF path stays battle-only
    await gm.waitFor(m => m.type === 'error' && /Battle surface/i.test(m.message), 'WOMF path still battle-only', mark);
    assert.ok(!gm.state.wheel.open, 'the charge-gated path cannot open the scope in AMUSE');

    mark = gm.mark();
    gm.send({ type: 'gm:wheelOpen', segments: [], command: true });
    const cmdArmed = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open && m.wheel.phase === 'idle' && m.wheel.command === true, 'command scope armed in AMUSE', mark);
    assert.ok(cmdArmed.wheel.segmentIds.length >= 2);
    players.filter(p => p.ws.readyState === 1).forEach(p => assert.equal(p.state?.wheel?.command, true, 'players are told this is a command scope'));
    mark = gm.mark();
    gm.send({ type: 'gm:wheelRoll' });
    const cmdDone = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.committedAt, 'command scope commits in AMUSE', mark);
    assert.equal(cmdDone.bloodTribute.status, 'required');
    assert.equal(cmdDone.bloodTribute.sourceLabel, 'BLOOD SCOPE');
    assert.equal(cmdDone.bloodTribute.playerId, cmdDone.wheel.segmentIds[cmdDone.wheel.winnerIndex]);
    assert.equal(cmdDone.womf.charge, chargeBefore, 'summoning the scope never spends WOMF charge');
    mark = gm.mark();
    gm.send({ type: 'gm:tributeForgive' });
    const cmdForgiven = await gm.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'idle', 'command debt released', mark);
    assert.equal(cmdForgiven.wheel.open, false, 'a forgiven command scope closes instead of re-arming the WOMF wheel');
    assert.equal(cmdForgiven.womf.charge, chargeBefore, 'forgiving a command scope leaves WOMF charge alone');

    // ---- 11. RECALL THE SNIPE: voids an unpaid scope tribute, leaves charge alone
    mark = gm.mark();
    gm.send({ type: 'gm:wheelOpen', segments: [], command: true });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open && m.wheel.phase === 'idle', 'scope armed for recall test', mark);
    mark = gm.mark();
    gm.send({ type: 'gm:wheelRoll' });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.committedAt, 'strike landed', mark);
    assert.equal(gm.state.bloodTribute.status, 'required');
    mark = gm.mark();
    gm.send({ type: 'gm:scopeRecall' });
    const recalled = await gm.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'idle', 'snipe recalled', mark);
    assert.equal(recalled.wheel.open, false, 'recall takes the scope off every screen');
    assert.equal(recalled.womf.charge, chargeBefore, 'recall never touches WOMF charge');
    mark = gm.mark();
    gm.send({ type: 'gm:scopeRecall' });
    await gm.waitFor(m => m.type === 'error' && /No unpaid Blood Scope tribute/i.test(m.message), 'nothing left to recall', mark);

    assert.equal(errors.trim(), '', 'no server errors');
    console.log('PASS blood scope: GM-only activation, server-authoritative victim, hunt creates no debt, one commit + one announcement, close keeps debt, abort creates none, disconnect-safe, late-client recovery');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(100);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
