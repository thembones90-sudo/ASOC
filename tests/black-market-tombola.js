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
    const field = (kind, amount) => snapshot().tombola.inventory.findIndex((f, i) => f.kind === kind && (amount == null || f.amount === amount) && !snapshot().tombola.reveals.some(r => r.field === i + 1)) + 1;
    mark = b.mark(); b.send({ type: 'tombola:pick', roundId: id, field: field('BLESSING', 1) }); await b.next(m => m.type === 'tombola:error', mark);
    mark = spectator.mark(); spectator.send({ type: 'tombola:pick', roundId: id, field: field('BLESSING', 1), playerId: a.id }); await spectator.next(m => m.type === 'tombola:error', mark);
    const first = field('BLESSING', 1); mark = a.mark(); a.send({ type: 'tombola:pick', roundId: id, field: first }); a.send({ type: 'tombola:pick', roundId: id, field: first });
    await a.next(m => m.type === 'tombola:state' && m.state.fields[first - 1].revealed, mark); await a.next(m => m.type === 'tombola:error', mark);
    assert.equal(profiles()[a.id].shadowCoins, 1, 'double click pays exactly once');
    async function pick(c, n) { const from = c.mark(); c.send({ type: 'tombola:pick', roundId: id, field: n, amount: 999999 }); return (await c.next(m => m.type === 'tombola:state' && m.state.fields[n - 1].revealed, from)).state; }
    await pick(b, field('BLESSING', 2)); await pick(a, field('CURSE', 1)); await pick(b, field('CURSE', 10));
    assert.equal(profiles()[a.id].shadowCoins, 0); assert.equal(profiles()[b.id].shadowCoins, 0, 'curse cannot create debt');
    assert.equal(snapshot().tombola.reveals.at(-1).actualAmount, -2, 'capped deduction is recorded');
    // Reconnect and restart without changing the concealed inventory or turn.
    const before = snapshot().tombola; for (const c of clients) c.close();
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); boot(); await ready();
    const login2 = await api('/api/auth/gm/login', { password: 'tombola-test-password' }); gm = await new Client('GM restored').open(); clients.push(gm); gm.send({ type: 'host:recover', gmToken: login2.token }); await gm.next(m => m.type === 'host:recovered');
    const a2 = await new Client('Alpha restored').open(); clients.push(a2); a2.send({ type: 'room:join', authToken: a.token, roomCode: 'MASTER', name: 'Alpha' }); await a2.next(m => m.type === 'join:success'); a2.id = a.id; a = a2;
    const restored = (await a.next(m => m.type === 'tombola:state' && m.state.id === id)).state;
    assert.equal(restored.currentPlayerId, a.id); assert.deepEqual(snapshot().tombola.inventory, before.inventory); assert.equal(restored.fields.filter(f => f.revealed).length, 4);
    mark = a.mark(); a.send({ type: 'tombola:pick', roundId: id, field: first }); await a.next(m => m.type === 'tombola:error', mark);
    assert.equal(profiles()[a.id].shadowCoins, 0, 'replaying a paid field after restart cannot pay twice');
    const blood = field('BLOOD_TRIBUTE'); const end = await pick(a, blood);
    assert.equal(end.phase, 'ENDED'); assert.equal(end.tributePlayerId, a.id); assert.equal(end.fields.filter(f => f.revealed).length, 5);
    await a.next(m => m.type === 'blackMarket:tributeDemanded');
    const debts = () => snapshot().blackMarket.byPlayer[a.id].pacts.filter(p => p.id === `pact-${id}`);
    assert.equal(debts().length, 1); assert.equal(debts()[0].title, 'BLOOD TRIBUTE REQUIRED'); assert.equal(debts()[0].state, 'APPROVED_PENDING_TRIBUTE');
    mark = a.mark(); a.send({ type: 'tombola:pick', roundId: id, field: blood }); await a.next(m => m.type === 'tombola:error', mark);
    assert.equal(debts().length, 1); assert.equal(profiles()[a.id].shadowCoins, 0);
    mark = gm.mark(); gm.send({ type: 'tombola:create' }); const fresh = (await gm.next(m => m.type === 'tombola:state' && m.state.phase === 'LOBBY', mark)).state;
    assert.notEqual(fresh.id, id); assert.equal(fresh.fields.filter(f => f.revealed).length, 0); assert.equal(fresh.participants.length, 0); assert.equal(fresh.history.at(-1).id, id);
    console.log('PASS real Tombola sockets: auth, lobby/start, privacy, race/double click, exact credit/debit/floor, restart, synchronized Blood Tribute, one Black Market debt, stopped picks, fresh round');
  } catch (error) { console.error(error); console.error(logs.slice(-1600)); process.exitCode = 1; }
  finally { for (const c of clients) c.close(); if (server?.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
