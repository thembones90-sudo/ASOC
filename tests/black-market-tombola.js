'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-tombola-live-'));
const port = 19520 + process.pid % 200;
const root = path.join(__dirname, '..');
let logs = '', server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function boot() {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ASOC_DATA_DIR: data, ASOC_GM_PASSWORD: 'tombola-test-password', ASOC_EMAIL_VERIFICATION: '0', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => logs += b); server.stderr.on('data', b => logs += b);
}
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {} await wait(100); } throw Error('server did not boot'); }
async function api(url, body) { const response = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return response.json(); }
class Client {
  constructor(name) { this.name = name; this.messages = []; }
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', bytes => { const m = JSON.parse(String(bytes)); if (m.type === 'protocol:hello') this.send({ type: 'protocol:hello', protocolVersion: 1 }); else this.messages.push(m); });
    await this.next(m => m.type === 'protocol:ready'); return this;
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  mark() { return this.messages.length; }
  async next(predicate, from = 0) { for (let i = 0; i < 200; i++) { const m = this.messages.slice(from).find(predicate); if (m) return m; await wait(20); } throw Error(`${this.name} timed out: ${this.messages.slice(-3).map(m => m.type).join(',')}`); }
  close() { this.ws?.terminate(); }
}
const clients = [];
const snapshot = () => JSON.parse(fs.readFileSync(path.join(data, 'active-rooms.json'), 'utf8')).rooms[0];
const profiles = () => JSON.parse(fs.readFileSync(path.join(data, 'players.json'), 'utf8'));
(async () => {
  try {
    boot(); await ready();
    const login = await api('/api/auth/gm/login', { password: 'tombola-test-password' });
    let gm = await new Client('GM').open(); clients.push(gm); gm.send({ type: 'host:recover', gmToken: login.token }); await gm.next(m => m.type === 'host:recovered');
    const players = [];
    for (const name of ['Alpha', 'Beta', 'Spectator']) {
      const auth = await api('/api/auth/player/register', { email: name.toLowerCase() + '@tombola.test', name, password: 'tombola-player-password' });
      const c = await new Client(name).open(); clients.push(c); c.token = auth.token; c.send({ type: 'room:join', authToken: c.token, roomCode: 'MASTER', name });
      c.id = (await c.next(m => m.type === 'join:success')).playerId; players.push(c);
    }
    let [a, b, spectator] = players;
    let mark = a.mark(); a.send({ type: 'tombola:create' }); await a.next(m => m.type === 'tombola:error', mark);
    mark = gm.mark(); gm.send({ type: 'tombola:create' }); const lobby = (await gm.next(m => m.type === 'tombola:state' && m.state.phase === 'LOBBY', mark)).state;
    const id = lobby.id;
    for (const c of [a, b]) { const from = c.mark(); c.send({ type: 'tombola:join', roundId: id }); await c.next(m => m.type === 'tombola:state' && m.state.viewer.participant, from); }
    mark = gm.mark(); gm.send({ type: 'tombola:start', roundId: id }); await gm.next(m => m.type === 'tombola:state' && m.state.phase === 'PLAYING', mark);
    for (const c of clients) for (const m of c.messages.filter(m => m.type === 'tombola:state')) {
      assert.equal(m.state.inventory, undefined); assert.ok((m.state.fields || []).every(f => f.revealed || (!('kind' in f) && !('amount' in f))));
    }
    const currentActor = () => [a, b].find(c => c.id === snapshot().tombola.turnOrder[snapshot().tombola.turnIndex]);
    const field = (kind, amount) => { const round = snapshot().tombola; return round.inventory.findIndex((f, i) => f.kind === kind && (amount == null || f.amount === amount) && !round.reveals.some(r => r.field === i + 1)) + 1; };
    mark = spectator.mark(); spectator.send({ type: 'tombola:join', roundId: id }); await spectator.next(m => m.type === 'tombola:error', mark);
    const wrong = [a, b].find(c => c !== currentActor());
    mark = wrong.mark(); wrong.send({ type: 'tombola:pick', roundId: id, field: 1 }); await wrong.next(m => m.type === 'tombola:error', mark);
    const expected = { [a.id]: 0, [b.id]: 0 };
    async function pick(n, duplicate = false) {
      const c = currentActor(), round = snapshot().tombola, outcome = round.inventory[n - 1], balance = expected[c.id], from = c.mark();
      c.send({ type: 'tombola:pick', roundId: id, field: n, amount: 999999 });
      if (duplicate) c.send({ type: 'tombola:pick', roundId: id, field: n });
      const state = (await c.next(m => m.type === 'tombola:state' && m.state.fields[n - 1].revealed, from)).state;
      if (duplicate) await c.next(m => m.type === 'tombola:error', from);
      expected[c.id] = outcome.kind === 'BLESSING' ? balance + outcome.amount : outcome.kind === 'CURSE' ? Math.max(0, balance - outcome.amount) : balance;
      assert.equal(profiles()[c.id]?.shadowCoins || 0, expected[c.id], 'exact durable wallet change');
      assert.equal(state.fields[n - 1].actualAmount, expected[c.id] - balance);
      return state;
    }
    await pick(field('BLESSING', 1), true); await pick(field('BLESSING', 2));
    await pick(field('CURSE', 1)); await pick(field('CURSE', 10));
    const blood = field('BLOOD_TRIBUTE'), bloodState = await pick(blood);
    assert.equal(bloodState.phase, 'PLAYING');
    const debtorId = bloodState.tributePlayerId;
    assert.equal(snapshot().tombola.tributePactId, null, 'no debt demanded midgame');
    assert.ok(!clients.some(c => c.messages.some(m => m.type === 'blackMarket:tributeDemanded')));
    const before = snapshot().tombola, identities = [a, b].map(c => ({ id: c.id, token: c.token, name: c.name }));
    for (const c of clients) c.close();
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); boot(); await ready();
    const login2 = await api('/api/auth/gm/login', { password: 'tombola-test-password' });
    gm = await new Client('GM restored').open(); clients.push(gm); gm.send({ type: 'host:recover', gmToken: login2.token }); await gm.next(m => m.type === 'host:recovered');
    const restoredClients = [];
    for (const identity of identities) {
      const c = await new Client(identity.name).open(); clients.push(c); Object.assign(c, identity);
      c.send({ type: 'room:join', authToken: c.token, roomCode: 'MASTER', name: c.name }); await c.next(m => m.type === 'join:success'); restoredClients.push(c);
    }
    [a, b] = restoredClients;
    assert.deepEqual(snapshot().tombola.inventory, before.inventory);
    assert.deepEqual(snapshot().tombola.turnOrder, before.turnOrder);
    assert.equal(snapshot().tombola.turnIndex, before.turnIndex);
    assert.equal(snapshot().tombola.tributePlayerId, debtorId);
    while (snapshot().tombola.phase === 'PLAYING') {
      const round = snapshot().tombola, n = Array.from({ length: 36 }, (_, i) => i + 1).find(n => !round.reveals.some(r => r.field === n));
      await pick(n);
    }
    assert.equal(snapshot().tombola.reveals.length, 36);
    const debtor = [a, b].find(c => c.id === debtorId);
    await debtor.next(m => m.type === 'blackMarket:tributeDemanded');
    const debts = () => snapshot().blackMarket.byPlayer[debtorId].pacts.filter(p => p.id === `pact-${id}`);
    assert.equal(debts().length, 1); assert.equal(debts()[0].state, 'APPROVED_PENDING_TRIBUTE');
    mark = debtor.mark(); debtor.send({ type: 'tombola:sync' }); assert.ok((await debtor.next(m => m.type === 'tombola:state', mark)).state.requiredTribute);
    mark = gm.mark(); gm.send({ type: 'tombola:create' }); const fresh = (await gm.next(m => m.type === 'tombola:state' && m.state.phase === 'LOBBY', mark)).state;
    assert.equal(fresh.history.at(-1).revealedCount, 36);
    mark = debtor.mark(); debtor.send({ type: 'tombola:join', roundId: fresh.id }); await debtor.next(m => m.type === 'tombola:error', mark);
    mark = debtor.mark();
    debtor.send({ type: 'blackMarket:tributeSubmit', pactId: `pact-${id}`, consent: true, imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=' });
    await debtor.next(m => m.type === 'tombola:state' && !m.state.requiredTribute, mark);
    assert.equal(debts()[0].state, 'TRIBUTE_SUBMITTED');
    mark = debtor.mark(); gm.send({ type: 'blackMarket:tributeJudge', pactId: `pact-${id}`, accepted: false, comment: 'Test rejection requires a new offering' });
    await debtor.next(m => m.type === 'tombola:state' && m.state.requiredTribute, mark);
    assert.equal(debts()[0].state, 'TRIBUTE_REJECTED');
    mark = debtor.mark(); debtor.send({ type: 'tombola:join', roundId: fresh.id }); await debtor.next(m => m.type === 'tombola:error', mark);
    mark = debtor.mark(); debtor.send({ type: 'blackMarket:tributeSubmit', pactId: `pact-${id}`, consent: true, imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=' });
    await debtor.next(m => m.type === 'tombola:state' && !m.state.requiredTribute, mark);
    mark = debtor.mark(); debtor.send({ type: 'tombola:join', roundId: fresh.id }); await debtor.next(m => m.type === 'tombola:state' && m.state.viewer.participant, mark);
    console.log('PASS real Tombola sockets: auth, locked lobby, privacy, randomized turns, duplicate protection, exact SC ledger/floor, restart, all36 completion, deferred tribute, mandatory submission, GM rejection re-block, fresh round');
  } catch (error) { console.error(error); console.error(logs.slice(-1600)); process.exitCode = 1; }
  finally { for (const c of clients) c.close(); if (server?.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
