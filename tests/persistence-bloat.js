// PERSISTENCE / BROADCAST BLOAT -- H3 + M1 regression coverage.
//   - chat messages and poll votes carry no avatar copies (memory, recovery
//     file, chat:update); the recovery file stays within a size budget
//   - players:update sends each avatar once per socket, then only its hash
//   - a restart restores offline identities' avatars from the stored profile
//   - long-offline identities leave the live roster; profile + coins remain
//   - daily-contract views and a capped attendance contract do not rewrite
//     players.json; the player-store cache never leaks mutations
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_BLOAT_TEST_PORT) || 18896;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const avatarFor = name => 'data:image/png;base64,' + Buffer.from(name).toString('base64').replace(/=/g, '') + 'A'.repeat(60000);
const AVATAR_MARK = 'A'.repeat(200);

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
  constructor(name) { this.name = name; this.msgs = []; this.raw = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const text = data.toString();
        const m = JSON.parse(text);
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m); this.raw.push(text);
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

function startServer(DATA, env = {}) {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'bloat-pass', ASOC_EMAIL_VERIFICATION: '0', ...env },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  return server;
}
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); } throw new Error('server not ready'); }
async function stop(server) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }

async function gmClient() {
  const token = (await api('/api/auth/gm/login', { password: 'bloat-pass' })).data.token;
  const gm = await new Client('GM').open();
  gm.send({ type: 'host:recover', gmToken: token });
  await gm.next(m => m.type === 'host:recovered', 'host');
  return gm;
}
async function joinHero(name, register = true) {
  const creds = { email: `${name.toLowerCase()}@bloat.test`, password: 'bloat-password' };
  if (register) await api('/api/auth/player/register', { ...creds, name });
  const token = (await api('/api/auth/player/login', creds)).data.token;
  const c = await new Client(name).open();
  c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name, avatarData: avatarFor(name) });
  const joined = await c.next(m => m.type === 'join:success', `${name} join`);
  c.playerId = joined.playerId;
  return c;
}

function unitPlayerStoreCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-bloat-unit-'));
  try {
    const script = `
      const assert = require('assert/strict');
      const fs = require('fs');
      const store = require(${JSON.stringify(path.join(ROOT, 'player-store.js'))});
      store.getOrCreateProfile({ id: 'lh-a', name: 'A' });
      const a = store.loadPlayers(); a['lh-a'].lifetimeScore = 999;
      assert.equal(store.loadPlayers()['lh-a'].lifetimeScore, 0, 'loadPlayers returns a private copy');
      store.adjustProfile({ id: 'lh-a', name: 'A' }, { pointsDelta: 5 });
      assert.equal(store.peekPlayers()['lh-a'].lifetimeScore, 5, 'cache follows saves');
      const file = ${JSON.stringify(path.join(dir, 'players.json'))};
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')); onDisk['lh-a'].lifetimeScore = 77;
      fs.writeFileSync(file, JSON.stringify(onDisk));
      assert.equal(store.loadPlayers()['lh-a'].lifetimeScore, 77, 'external edits are detected');`;
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, ASOC_DATA_DIR: dir } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

(async () => {
  unitPlayerStoreCache();

  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-bloat-'));
  let server = startServer(DATA, { ASOC_DAILY_ATTENDANCE_TICK_MS: '1000', ASOC_DAILY_ATTENDANCE_MS: '2000' });
  const clients = [];
  try {
    await ready();
    const gm = await gmClient(); clients.push(gm);
    const heroes = [];
    for (const name of ['Ava', 'Ben', 'Cat']) { const h = await joinHero(name); heroes.push(h); clients.push(h); }

    // Roster dedupe: Ava already received Ben's and Cat's avatars once.
    await sleep(400);
    const from = heroes[0].mark();
    const late = await joinHero('Dan'); clients.push(late);
    const update = await heroes[0].next(m => m.type === 'players:update' && m.players.some(p => p.name === 'Dan'), 'roster with Dan', from);
    const ben = update.players.find(p => p.name === 'Ben');
    const dan = update.players.find(p => p.name === 'Dan');
    assert.ok(ben.avatarHash, 'every roster entry carries an avatar hash');
    assert.equal(ben.avatarData, undefined, 'an avatar already sent to this socket is not re-sent');
    assert.ok(dan.avatarData === avatarFor('Dan'), 'a new avatar is sent once');
    const first = late.msgs.find(m => m.type === 'players:update');
    assert.ok(first.players.filter(p => typeof p.avatarData === 'string' && p.avatarData.length > 60000).length >= 4, 'a fresh socket receives every avatar once');

    // Chat + poll carry no avatar copies.
    for (let i = 0; i < 25; i++) { heroes[i % 3].send({ type: 'chat:guess', text: `park chatter ${i}` }); await sleep(i % 3 === 2 ? 1100 : 30); }
    await sleep(1500); // Battle Comms cooldown
    heroes[0].send({ type: 'chat:poll:create', question: 'Best ride?', options: ['Wheel', 'Coaster'], durationSeconds: 60 });
    const pollMsg = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.messageType === 'poll'), 'poll')).messages.find(x => x.messageType === 'poll');
    const voteFrom = gm.mark();
    heroes[1].send({ type: 'chat:poll:vote', messageId: pollMsg.id, optionIndex: 0 });
    heroes[2].send({ type: 'chat:poll:vote', messageId: pollMsg.id, optionIndex: 1 });
    await gm.next(m => m.type === 'chat:update' && Object.keys(m.messages.find(x => x.id === pollMsg.id)?.poll?.voters || {}).length === 2, 'votes', voteFrom);
    const lastChatRaw = gm.raw.filter(t => t.includes('"chat:update"')).pop();
    assert.ok(!lastChatRaw.includes(AVATAR_MARK), 'chat:update carries no avatar images');
    await sleep(300);
    const recovery = fs.readFileSync(path.join(DATA, 'active-rooms.json'), 'utf8');
    assert.ok(!recovery.includes(AVATAR_MARK), 'recovery file carries no avatar images');
    assert.ok(recovery.length < 200 * 1024, `recovery file stays small (${recovery.length} bytes for 4 avatar heroes + 25 messages + poll)`);

    // Daily contracts: once attendance is capped, ticks stop rewriting players.json.
    const playersFile = path.join(DATA, 'players.json');
    await gm.next(m => m.type === 'daily:gmUpdate' && m.players.length >= 4 && m.players.every(p => p.contracts?.find(c => c.id === 'attendance')?.complete), 'attendance complete', 0, 9000);
    await sleep(1500);
    const settled = fs.statSync(playersFile).mtimeMs;
    await sleep(3200);
    assert.equal(fs.statSync(playersFile).mtimeMs, settled, 'capped attendance ticks do not rewrite players.json');
    gm.send({ type: 'daily:sync' });
    heroes[0].send({ type: 'daily:sync' });
    await sleep(500);
    assert.equal(fs.statSync(playersFile).mtimeMs, settled, 'daily views are read-only');

    // Restart: offline identities come back with their profile avatar.
    const benId = heroes[1].playerId;
    clients.forEach(c => c.close()); clients.length = 0;
    await sleep(400);
    assert.equal(server.errors.trim(), '', 'no server errors');
    await stop(server);
    server = startServer(DATA);
    await ready();
    const gm2 = await gmClient(); clients.push(gm2);
    const roster = await gm2.next(m => m.type === 'players:update' && m.players.some(p => p.id === benId), 'restored roster');
    assert.ok(roster.players.find(p => p.id === benId).avatarData === avatarFor('Ben'), 'offline avatar restored from the stored profile');
    clients.forEach(c => c.close()); clients.length = 0;
    await sleep(300);
    await stop(server);

    // Long-offline identities: released from the roster, account kept.
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'active-rooms.json'), 'utf8'));
    saved.rooms[0].players.forEach(p => { if (p.id === benId) p.lastSeenAt = Date.now() - 2 * 60 * 60 * 1000; });
    fs.writeFileSync(path.join(DATA, 'active-rooms.json'), JSON.stringify(saved));
    server = startServer(DATA, { ASOC_OFFLINE_IDENTITY_TTL_MS: String(60 * 60 * 1000) });
    await ready();
    const gm3 = await gmClient(); clients.push(gm3);
    const pruned = await gm3.next(m => m.type === 'players:update', 'roster after prune');
    assert.ok(!pruned.players.some(p => p.id === benId), 'long-offline identity released from the roster');
    assert.ok(pruned.players.some(p => p.name === 'Ava'), 'recent identities kept');
    const profiles = JSON.parse(fs.readFileSync(playersFile, 'utf8'));
    assert.ok(profiles[benId], 'the account profile is untouched');
    const back = await joinHero('Ben', false); clients.push(back);
    assert.equal(back.playerId, benId, 'returning hero reclaims the same identity');
    await sleep(300);
    assert.equal(server.errors.trim(), '', 'no server errors after restart');
  } finally {
    clients.forEach(c => c.close());
    await require('./lib/stop-process')(server);
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  console.log('PASS persistence bloat: no avatar copies in chat/polls/recovery, recovery size bounded, roster avatars sent once per socket, profile avatars restored, long-offline identities released, daily views and capped attendance write nothing, cache never leaks mutations');
})().catch(error => {
  console.error('FAIL persistence bloat:', error);
  process.exit(1);
});
