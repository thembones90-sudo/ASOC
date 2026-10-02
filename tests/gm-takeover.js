// One Shadow Broker, any device: a second GM login (phone while the PC is
// connected) takes control instead of being rejected. The old device is told
// (host:superseded) and released; a stale saved host token falls back to a
// fresh takeover; the new device's commands work.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 19501;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-takeover-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function api(p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(t) }); } catch { resolve({ status: res.statusCode, data: t }); } }); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
class Client {
  constructor(name) { this.name = name; this.msgs = []; this.closed = null; }
  open() { return new Promise((resolve, reject) => { this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`); this.ws.once('error', reject); this.ws.on('close', code => { this.closed = code; }); this.ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 })); if (m.type === 'protocol:ready') return resolve(this); this.msgs.push(m); }); }); }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async next(pred, label, timeout = 6000) { const t = Date.now(); while (Date.now() - t < timeout) { const f = this.msgs.find(pred); if (f) return f; await sleep(20); } throw new Error(`${this.name}: timed out waiting for ${label}`); }
  close() { try { this.ws.close(); } catch {} }
}

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'take-pass', ASOC_EMAIL_VERIFICATION: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'take-pass' })).data.token;
    const pc = await new Client('PC').open(); clients.push(pc);
    pc.send({ type: 'host:recover', gmToken });
    const pcHost = await pc.next(m => m.type === 'host:recovered', 'PC host');

    // The phone logs in while the PC is connected: it takes control.
    const phone = await new Client('PHONE').open(); clients.push(phone);
    phone.send({ type: 'host:recover', gmToken });
    await phone.next(m => m.type === 'host:recovered', 'phone takes control');
    const notice = await pc.next(m => m.type === 'host:superseded', 'PC told');
    assert.match(notice.message, /ANOTHER DEVICE/);
    for (let i = 0; i < 100 && pc.closed === null; i++) await sleep(20);
    assert.equal(pc.closed, 4002, 'the old device is released with a distinct close code');
    assert.ok(!phone.msgs.some(m => m.type === 'error'), 'the phone is not rejected');

    // The phone's commands work.
    phone.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await phone.next(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED', 'phone command applied');

    // TAKE CONTROL on the PC with its stale saved host token falls back to a
    // fresh takeover instead of 'Invalid host token'.
    const pc2 = await new Client('PC2').open(); clients.push(pc2);
    pc2.send({ type: 'host:reconnect', roomCode: 'MASTER', hostToken: pcHost.hostToken, gmToken });
    await pc2.next(m => m.type === 'host:recovered', 'PC takes control back');
    await phone.next(m => m.type === 'host:superseded', 'phone told');
    assert.ok(!pc2.msgs.some(m => m.type === 'error'), 'no INVALID HOST TOKEN');

    // An unauthenticated socket still cannot take the seat.
    const intruder = await new Client('X').open(); clients.push(intruder);
    intruder.send({ type: 'host:recover', gmToken: 'nope' });
    await intruder.next(m => m.type === 'auth:required', 'intruder refused');
    await sleep(200);
    assert.ok(!pc2.msgs.some(m => m.type === 'host:superseded'), 'a bad GM token never supersedes the Broker');
    assert.equal(errors.trim(), '');
    console.log('PASS gm takeover: a second GM device takes control, the old one is told and released, stale tokens recover, intruders cannot');
  } finally {
    clients.forEach(c => c.close());
    server.kill('SIGTERM'); await new Promise(r => server.once('exit', r));
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
