// Saving a game in the Forge must reach the live board without a manual reset:
// - the board's own game, untouched: the new words go live immediately
//   (game:loaded to the GM, liveRefreshed in the save response);
// - a board already in play keeps its words until RESET BOARD, which now
//   re-reads the game from disk;
// - gm:switchGame with keepMode stays in AMUSEMENT PARK.
// Private server on throwaway data (saves land in ASOC_DATA_DIR/games).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_BOARD_REFRESH_TEST_PORT) || 18801;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-board-refresh-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function api(urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-gm-token'] = token;
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'refresh-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors += chunk; });
  let ws;
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const token = (await api('/api/auth/gm/login', { password: 'refresh-pass' })).data.token;
    const msgs = [];
    ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
      socket.once('error', reject);
      socket.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return socket.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') { socket.send(JSON.stringify({ type: 'host:recover', gmToken: token })); return resolve(socket); }
        msgs.push(m);
      });
    });
    const waitFor = async (predicate, label, from = 0) => {
      for (let i = 0; i < 200; i++) {
        const found = msgs.slice(from).find(predicate);
        if (found) return found;
        await sleep(25);
      }
      throw new Error(`timed out waiting for ${label}`);
    };
    const send = m => ws.send(JSON.stringify(m));
    const loaded = await waitFor(m => m.type === 'game:loaded', 'initial game');
    const lastState = () => [...msgs].reverse().find(m => m.type === 'state:public');
    const game = JSON.parse(JSON.stringify(loaded.game));
    assert.ok(game.id, 'the board has a game');
    assert.equal(lastState().roomMode, 'CASUAL');

    // 1. Untouched board: saving its own game swaps the words immediately.
    game.columns.A.solution = 'FRESHWORD';
    let mark = msgs.length;
    let saved = await api('/api/games', game, token);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.liveRefreshed, true, 'the live board picked up the saved words');
    const live = await waitFor(m => m.type === 'game:loaded', 'game:loaded after save', mark);
    assert.equal(live.game.columns.A.solution, 'FRESHWORD');

    // 2. A board in play keeps its words; RESET BOARD re-reads them.
    send({ type: 'gm:command', command: 'revealCell', payload: { cell: 'A1', reveal: true }, cmdId: 'r1' });
    await waitFor(m => m.type === 'state:public' && m.cells?.A1?.revealed === true, 'A1 revealed');
    game.columns.A.solution = 'AFTERRESET';
    mark = msgs.length;
    saved = await api('/api/games', game, token);
    assert.equal(saved.data.liveRefreshed, false, 'a board in play is not rewritten mid-game');
    await sleep(300);
    assert.equal(msgs.slice(mark).some(m => m.type === 'game:loaded'), false);
    mark = msgs.length;
    send({ type: 'gm:command', command: 'resetBoard', payload: {}, cmdId: 'r2' });
    const afterReset = await waitFor(m => m.type === 'game:loaded', 'game:loaded after RESET BOARD', mark);
    assert.equal(afterReset.game.columns.A.solution, 'AFTERRESET', 'RESET BOARD uses the saved words, not a stale copy');

    // 3. A NEW game saved from the Forge while in AMUSEMENT PARK: keepMode
    //    puts it on the board without arming Battle.
    send({ type: 'gm:setRoomMode', mode: 'CASUAL' });
    await sleep(300);
    const fresh = { ...JSON.parse(JSON.stringify(game)), id: '', title: 'Imported Board' };
    fresh.columns.A.solution = 'IMPORTED';
    const created = await api('/api/games', fresh, token);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.notEqual(created.data.game.id, game.id);
    mark = msgs.length;
    send({ type: 'gm:switchGame', gameId: created.data.game.id, keepMode: true });
    const switched = await waitFor(m => m.type === 'game:loaded', 'switched to the imported game', mark);
    assert.equal(switched.game.columns.A.solution, 'IMPORTED');
    await sleep(200);
    const stateNow = lastState();
    assert.equal(stateNow.roomMode, 'CASUAL', 'a Forge load in AMUSEMENT PARK does not arm Battle');

    assert.equal(serverErrors.trim(), '', 'no server errors');
    console.log('PASS board refresh: saved games reach the live board, RESET BOARD re-reads the game, Forge loads keep the room mode');
  } finally {
    try { ws?.close(); } catch {}
    server.kill();
    await sleep(200);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('FAIL board refresh:', error);
  process.exit(1);
});
