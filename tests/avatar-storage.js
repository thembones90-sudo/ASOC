// AVATAR STORAGE -- avatars live as content-addressed files, not inline in
// players.json / room state.
//   unit: normalize() stores valid images once (dedupe), rejects forged
//         signatures, oversize data, unknown URLs; the players.json migration
//         converts inline avatars, leaves invalid ones untouched, is idempotent
//   live: a legacy inline avatar migrates on boot; new uploads are stored as
//         files; /avatars/<hash> serves the exact bytes with immutable caching;
//         a remembered avatar URL is accepted on rejoin, a bogus one refused;
//         players.json and the recovery file carry no image data
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_AVATAR_TEST_PORT) || 18898;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PNG = name => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(name.repeat(40))]);
const dataUri = buf => 'data:image/png;base64,' + buf.toString('base64');

function unit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-avatar-unit-'));
  try {
    const script = `
      const assert = require('assert/strict');
      const fs = require('fs');
      const path = require('path');
      const store = require(${JSON.stringify(path.join(ROOT, 'avatar-store.js'))});
      const players = require(${JSON.stringify(path.join(ROOT, 'player-store.js'))});
      const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('unit-avatar'.repeat(30))]);
      const uri = 'data:image/png;base64,' + png.toString('base64');
      const url = store.normalize(uri);
      assert.match(url, /^\\/avatars\\/[a-f0-9]{32}\\.png$/);
      assert.equal(store.normalize(uri), url, 'same image -> same file (dedupe)');
      assert.deepEqual(fs.readFileSync(path.join(store.AVATAR_DIR, url.split('/').pop())), png, 'exact bytes stored');
      assert.equal(store.normalize(url), url, 'existing avatar URL accepted');
      assert.equal(store.normalize('/avatars/' + 'a'.repeat(32) + '.png'), null, 'unknown avatar URL rejected');
      assert.equal(store.normalize(''), '', 'explicit no-avatar kept');
      assert.equal(store.normalize('data:image/png;base64,' + Buffer.from('GIF89a-not-a-png').toString('base64')), null, 'forged signature rejected');
      assert.equal(store.normalize('data:image/png;base64,' + 'A'.repeat(200001)), null, 'oversize rejected');
      assert.equal(store.normalize('https://evil.example/x.png'), null, 'foreign URL rejected');

      players.getOrCreateProfile({ id: 'lh-legacy', name: 'Legacy' });
      players.getOrCreateProfile({ id: 'lh-broken', name: 'Broken' });
      const db = players.loadPlayers();
      db['lh-legacy'].avatarData = uri;
      db['lh-broken'].avatarData = 'data:image/png;base64,' + Buffer.from('not-an-image-at-all').toString('base64');
      players.savePlayersAtomic(db);
      const first = players.migrateAvatarsToFiles();
      assert.deepEqual(first, { migrated: 1, skipped: 1 });
      const after = players.loadPlayers();
      assert.equal(after['lh-legacy'].avatarData, url, 'inline avatar migrated to its file URL');
      assert.match(after['lh-broken'].avatarData, /^data:/, 'an invalid avatar is left untouched, never dropped');
      assert.deepEqual(players.migrateAvatarsToFiles(), { migrated: 0, skipped: 1 }, 'migration is idempotent');
      const updated = players.updateProfileAppearance({ id: 'lh-legacy', name: 'Legacy' }, { avatarData: 'data:image/png;base64,' + Buffer.from('junk-bytes-here!').toString('base64') });
      assert.equal(updated.avatarData, url, 'an invalid new avatar never replaces a valid one');`;
    execFileSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, ASOC_DATA_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers: body ? { 'content-type': 'application/json' } : {} }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let data = buffer.toString(); try { data = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buffer, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function startServer(DATA) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'avatar-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.out = ''; child.errors = '';
  child.stdout.on('data', c => { child.out += c; });
  child.stderr.on('data', c => { child.errors += c; });
  return child;
}
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await request('GET', '/health')).status === 200) return; } catch {} await sleep(150); } throw new Error('server not ready'); }
async function stop(child) { if (child.exitCode !== null) return; child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }

function join(token, name, avatarData) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const msgs = [];
    const timer = setTimeout(() => reject(new Error(`${name}: join timed out`)), 8000);
    ws.once('error', reject);
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'protocol:hello') return ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
      if (m.type === 'protocol:ready') {
        const payload = { type: 'room:join', authToken: token, roomCode: 'MASTER', name };
        if (avatarData !== undefined) payload.avatarData = avatarData;
        return ws.send(JSON.stringify(payload));
      }
      msgs.push(m);
      if (m.type === 'join:success' || m.type === 'error') { clearTimeout(timer); resolve({ ws, msgs, result: m }); }
    });
  });
}

(async () => {
  unit();

  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-avatar-'));
  let server = startServer(DATA);
  const sockets = [];
  try {
    await ready();
    const creds = { email: 'legacy@avatar.test', password: 'avatar-password', name: 'Legacy' };
    await request('POST', '/api/auth/player/register', creds);
    const legacyToken = (await request('POST', '/api/auth/player/login', creds)).data.token;
    const first = await join(legacyToken, 'Legacy');
    const legacyId = first.result.playerId;
    first.ws.close();
    await sleep(300);
    await stop(server);

    // Simulate a pre-migration database: an inline avatar on the profile.
    const legacyPng = PNG('legacy-avatar-bytes');
    const playersFile = path.join(DATA, 'players.json');
    const db = JSON.parse(fs.readFileSync(playersFile, 'utf8'));
    db[legacyId].avatarData = dataUri(legacyPng);
    fs.writeFileSync(playersFile, JSON.stringify(db, null, 2));

    server = startServer(DATA);
    await ready();
    assert.match(server.out, /\[avatars\] Migrated 1 inline avatar/, 'boot migration ran');
    const migrated = JSON.parse(fs.readFileSync(playersFile, 'utf8'))[legacyId].avatarData;
    assert.match(migrated, /^\/avatars\/[a-f0-9]{32}\.png$/);

    const served = await request('GET', migrated);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.match(served.headers['cache-control'], /immutable/);
    assert.equal(served.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(served.buffer, legacyPng, 'the migrated file is byte-identical');
    assert.equal((await request('GET', '/avatars/' + 'f'.repeat(32) + '.png')).status, 404);
    assert.equal((await request('GET', '/avatars/../players.json')).status, 404, 'no path traversal');

    // A new hero uploads an avatar: stored as a file, roster carries the URL.
    const credsB = { email: 'fresh@avatar.test', password: 'avatar-password', name: 'Fresh' };
    await request('POST', '/api/auth/player/register', credsB);
    const freshToken = (await request('POST', '/api/auth/player/login', credsB)).data.token;
    const freshPng = PNG('fresh-avatar-bytes');
    const fresh = await join(freshToken, 'Fresh', dataUri(freshPng));
    sockets.push(fresh.ws);
    assert.equal(fresh.result.type, 'join:success');
    const freshUrl = fresh.result.littleHero.avatarData;
    assert.match(freshUrl, /^\/avatars\/[a-f0-9]{32}\.png$/, 'the hero is told its stored avatar URL');
    await sleep(300);
    const roster = fresh.msgs.filter(m => m.type === 'players:update').pop();
    assert.equal(roster.players.find(p => p.name === 'Fresh').avatarData, freshUrl);
    assert.equal(roster.players.find(p => p.name === 'Legacy').avatarData, migrated, 'offline legacy hero shows the migrated avatar');

    // Rejoining with the remembered URL is accepted; a bogus URL is refused.
    fresh.ws.close();
    await sleep(200);
    const again = await join(freshToken, 'Fresh', freshUrl);
    sockets.push(again.ws);
    assert.equal(again.result.type, 'join:success', 'remembered avatar URL accepted');
    assert.equal(again.result.littleHero.avatarData, freshUrl);
    again.ws.close();
    await sleep(200);
    const bogus = await join(freshToken, 'Fresh', '/avatars/' + '0'.repeat(32) + '.png');
    sockets.push(bogus.ws);
    assert.equal(bogus.result.type, 'error');
    assert.match(bogus.result.message, /Invalid avatar/);

    await sleep(300);
    const playersText = fs.readFileSync(playersFile, 'utf8');
    const recoveryText = fs.readFileSync(path.join(DATA, 'active-rooms.json'), 'utf8');
    assert.ok(!/data:image/.test(playersText), 'players.json holds no inline images');
    assert.ok(!/data:image/.test(recoveryText), 'the recovery file holds no inline images');
    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    sockets.forEach(ws => { try { ws.close(); } catch {} });
    try { await stop(server); } catch {}
    fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  console.log('PASS avatar storage: content-addressed files with dedupe and signature checks, idempotent boot migration of inline avatars, immutable /avatars/ serving, remembered URLs accepted and bogus ones refused, no inline images in players.json or the recovery file');
})().catch(error => {
  console.error('FAIL avatar storage:', error);
  process.exit(1);
});
