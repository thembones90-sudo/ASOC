// /fireworks: any Little Hero or the Shadow Broker lights a room-wide show.
// Pins: every socket gets fireworks:launch with the same seed, the player's
// chat line is a command (never adjudicable), the room and personal
// cooldowns refuse spam, and the GM can fire too.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 19491;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-fireworks-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function api(p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(t) }); } catch { resolve({ status: res.statusCode, data: t }); } }); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
class Client {
  constructor(name) { this.name = name; this.msgs = []; }
  open() { return new Promise((resolve, reject) => { this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`); this.ws.once('error', reject); this.ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 })); if (m.type === 'protocol:ready') return resolve(this); this.msgs.push(m); if (m.type === 'chat:update') this.chat = m.messages; }); }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(pred, label, from = 0, timeout = 6000) { const t = Date.now(); while (Date.now() - t < timeout) { const f = this.msgs.slice(from).find(pred); if (f) return f; await sleep(20); } throw new Error(`${this.name}: timed out waiting for ${label}`); }
  close() { try { this.ws.close(); } catch {} }
}

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'fw-pass', ASOC_EMAIL_VERIFICATION: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gm = await new Client('GM').open(); clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: (await api('/api/auth/gm/login', { password: 'fw-pass' })).data.token });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const heroes = [];
    for (const n of ['Sissy', 'Cigan']) {
      const creds = { email: `${n.toLowerCase()}@fw.test`, password: 'fw-password' };
      await api('/api/auth/player/register', { ...creds, name: n });
      const c = await new Client(n).open(); clients.push(c);
      c.send({ type: 'room:join', authToken: (await api('/api/auth/player/login', creds)).data.token, roomCode: 'MASTER', name: n });
      await c.next(m => m.type === 'join:success', 'join');
      heroes.push(c);
    }
    const [sissy, cigan] = heroes;
    let from = [gm.mark(), cigan.mark()];
    sissy.send({ type: 'chat:guess', text: '/fireworks Sretan rodjendan!' });
    const a = await gm.next(m => m.type === 'fireworks:launch', 'GM sees the show', from[0]);
    const b = await cigan.next(m => m.type === 'fireworks:launch', 'hero sees the show', from[1]);
    assert.equal(a.byName, 'Sissy');
    assert.equal(a.text, 'Sretan rodjendan!');
    assert.equal(a.seed, b.seed, 'every screen plays the same show');
    const line = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === '🎆 Sretan rodjendan!'), 'chat line', from[0])).messages.find(x => x.text === '🎆 Sretan rodjendan!');
    assert.equal(line.source, 'fireworks');
    assert.equal(line.adjudicable, false, 'a fireworks line is never a guess');
    // Room cooldown: nobody can stack a second show right away.
    let m0 = cigan.mark();
    await sleep(450);
    cigan.send({ type: 'chat:guess', text: '/fireworks' });
    let err = await cigan.next(m => m.type === 'error', 'room cooldown', m0);
    assert.match(err.message, /STILL SMOKING/);
    m0 = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/fireworks' });
    err = await gm.next(m => m.type === 'error', 'GM room cooldown', m0);
    assert.match(err.message, /STILL SMOKING/, 'the room cooldown holds for the GM too');
    // After the room cooldown the Broker lights one; Sissy's personal
    // cooldown still holds.
    await sleep(8200);
    m0 = sissy.mark();
    sissy.send({ type: 'chat:guess', text: '/fireworks' });
    err = await sissy.next(m => m.type === 'error', 'personal cooldown', m0);
    assert.match(err.message, /RELOADING/);
    from = cigan.mark();
    gm.send({ type: 'gm:broadcast', text: '/fireworks THE HOUSE CELEBRATES' });
    const g = await cigan.next(m => m.type === 'fireworks:launch', 'Broker show', from);
    assert.equal(g.byName, 'SHADOW BROKER');
    assert.equal(g.text, 'THE HOUSE CELEBRATES');
    console.log('PASS fireworks: room-wide show, same seed everywhere, never a guess, cooldowns');
    assert.equal(errors.trim(), '');
  } finally {
    clients.forEach(c => c.close());
    server.kill('SIGTERM'); await new Promise(r => server.once('exit', r));
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
