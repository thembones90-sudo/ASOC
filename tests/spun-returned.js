// SPUN AND RETURNED -- "Survive 5 WOMF spins", end to end.
// A real Battle charges WOMF to 10/10, the GM spins the Wheel again and
// again (dismiss -> forgive -> reroll), and after every settled spin each
// Little Hero's wheelSurvivals counter must equal the number of spins they
// were on the Wheel and NOT selected. The relic is granted exactly when a
// counter reaches 5 (never before, never twice) with one RELIC UNEARTHED
// transmission, and the selected player's spin never counts.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_SPUN_TEST_PORT) || 18873;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-spun-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const RELIC = 'relic-spun-returned';

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
  constructor(name) { this.name = name; this.msgs = []; this.state = null; this.chat = []; this.ritual = null; }
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
        if (m.type === 'ritual:gmUpdate') this.ritual = m.ritual;
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
      await sleep(20);
    }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

function profiles() {
  const all = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8'));
  return Object.fromEntries(Object.values(all).filter(p => p && p.name).map(p => [p.name, p]));
}

(async () => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'spun-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_WHEEL_SPIN_DURATION_MS: '150', ASOC_COLUMN_REVEAL_DELAY_MS: '100' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = '';
  server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'spun-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.waitFor(m => m.type === 'host:recovered', 'host recovered');

    const names = ['Ana', 'Bo', 'Cy', 'Dee', 'Eli'];
    const players = [];
    for (const name of names) {
      const token = (await api('/api/auth/player/register', { email: `${name.toLowerCase()}@spun.test`, password: 'spun-password', name })).data.token;
      const c = await new Client(name).open();
      clients.push(c);
      c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await c.waitFor(m => m.type === 'join:success', `${name} join`);
      players.push(c);
    }
    await sleep(300);

    // Real Battles: a lost game charges WOMF +1 per failed column and +3
    // for the failed Final (7); a second game's failed columns reach 10/10.
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await gm.waitFor(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED', 'armed');
    const launch = async () => {
      const mark = gm.mark();
      players.forEach(p => p.send({ type: 'ritual:join' }));
      await gm.waitFor(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual 5/5', mark);
      gm.send({ type: 'gm:timerLaunchCountdown' });
      await sleep(200);
      gm.send({ type: 'gm:timerStart' });
      await gm.waitFor(m => m.type === 'state:public' && m.roomMode === 'BATTLE', 'live battle', mark);
    };
    await launch();
    for (const column of ['A', 'B', 'C', 'D']) { gm.send({ type: 'gm:failColumn', column }); await sleep(250); }
    gm.send({ type: 'gm:failFinal' });
    await gm.waitFor(m => m.type === 'state:public' && m.womf?.charge === 7, 'WOMF 7/10 after a lost game');
    let mark = gm.mark();
    gm.send({ type: 'gm:switchGame', gameId: 'sample-game' });
    await gm.waitFor(m => m.type === 'gm:switchGame:ack', 'NEXT GAME ack', mark);
    await sleep(350);
    await launch();
    for (const column of ['A', 'B', 'C']) { gm.send({ type: 'gm:failColumn', column }); await sleep(250); }
    await gm.waitFor(m => m.type === 'state:public' && m.womf?.charge === 10, 'WOMF 10/10');

    let from = gm.mark();
    gm.send({ type: 'gm:wheelOpen', segments: [] });
    await gm.waitFor(m => m.type === 'state:public' && m.wheel?.open && m.wheel.phase === 'idle', 'wheel open', from);

    const expected = Object.fromEntries(names.map(n => [n, 0]));
    const awardedAt = {};
    const seenTokens = new Set();
    let spins = 0;
    while (spins < 25 && !Object.values(expected).some(v => v >= 6)) {
      from = gm.mark();
      gm.send({ type: 'gm:wheelRoll' });
      const result = await gm.waitFor(m => m.type === 'state:public' && m.wheel?.phase === 'result' && !seenTokens.has(m.wheel.spinToken), `spin ${spins + 1} result`, from);
      spins++;
      seenTokens.add(result.wheel.spinToken);
      const segments = result.wheel.segments;
      assert.equal(segments.length, 5, 'every connected Little Hero is on the Wheel');
      const loser = segments[result.wheel.winnerIndex];
      segments.forEach(name => { if (name !== loser) expected[name]++; });
      await sleep(250);

      const store = profiles();
      for (const name of names) {
        const p = store[name];
        assert.equal(Number(p?.relicProgress?.wheelSurvivals || 0), expected[name], `spin ${spins}: ${name} survived ${expected[name]} spins`);
        const owns = Number(p?.cosmetics?.owned?.[RELIC] || 0) === 1;
        assert.equal(owns, expected[name] >= 5, `spin ${spins}: ${name} ${expected[name] >= 5 ? 'owns' : 'does not own yet'} SPUN AND RETURNED`);
        if (owns && !awardedAt[name]) awardedAt[name] = spins;
      }

      // DISMISS (arms the selected player's tribute), then FORGIVE: the
      // Wheel reopens idle for a fresh roll with WOMF still 10/10.
      from = gm.mark();
      gm.send({ type: 'gm:wheelClose' });
      await gm.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'required', 'tribute armed', from);
      from = gm.mark();
      gm.send({ type: 'gm:tributeForgive' });
      await gm.waitFor(m => m.type === 'state:public' && m.bloodTribute?.status === 'idle' && m.wheel?.open && m.wheel.phase === 'idle', 'forgiven, wheel idle', from);
    }

    const earners = Object.keys(awardedAt);
    assert.ok(earners.length >= 1, `someone survived 5 spins within ${spins} spins`);
    await sleep(200);
    for (const name of earners) {
      const lines = gm.chat.filter(m => m.source === 'shadowBroker' && m.text === `RELIC UNEARTHED // ${name} -- SPUN AND RETURNED`);
      assert.equal(lines.length, 1, `${name}: one RELIC UNEARTHED transmission, never repeated`);
    }
    // The selected player's spin never counted, and nobody below 5 has it.
    const store = profiles();
    for (const name of names) {
      assert.equal(Number(store[name].relicProgress.wheelSurvivals), expected[name]);
      if (expected[name] < 5) assert.ok(!store[name].cosmetics.owned[RELIC], `${name} has not earned it`);
    }

    assert.equal(errors.trim(), '', 'no server errors');
    console.log(`PASS SPUN AND RETURNED: ${spins} real WOMF spins; survival counters exact after every spin; relic granted exactly at the 5th survival (${earners.map(n => `${n}@spin${awardedAt[n]}`).join(', ')}), once, with one transmission; the selected player never counts`);
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(300);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error('FAIL', error); process.exit(1); });
