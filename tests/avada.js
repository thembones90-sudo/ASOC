// /avada -- AVADA KEDAVRA: a Shadow Market unlock (12 SC). Locked until bought,
// one target only, kills the target (dead 60 s, in the public state), a 10
// minute cooldown, the Broker never dies, and aimed at the Broker it always
// rebounds: the caster dies and the Broker is THE ONE WHO LIVED.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 19494;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-avada-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
assert.match(fs.readFileSync(path.join(ROOT, 'js', 'avada.js'), 'utf8'), /\/assets\/profiles\/dennis-ai\.png/,
  'the AVADA animation must render Dennis AI with his bundled profile photo');
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
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'cd-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_COIN_DROPS: '0', ASOC_TEST_AVADA_REBOUND: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  const clients = [];
  try {
    for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gm = await new Client('GM').open(); clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: (await api('/api/auth/gm/login', { password: 'cd-pass' })).data.token });
    await gm.next(m => m.type === 'host:recovered', 'host');
    const heroes = [];
    for (const n of ['Sissy', 'Cigan']) {
      const creds = { email: `${n.toLowerCase()}@av.test`, password: 'cd-password' };
      await api('/api/auth/player/register', { ...creds, name: n });
      const c = await new Client(n).open(); clients.push(c);
      c.send({ type: 'room:join', authToken: (await api('/api/auth/player/login', creds)).data.token, roomCode: 'MASTER', name: n });
      await c.next(m => m.type === 'join:success', 'join');
      heroes.push(c);
    }
    const [sissy, cigan] = heroes;
    const errorOf = (c, label, from) => c.next(m => /error/i.test(m.type) && m.message, label, from);
    // Earn coins the honest way: two EPIC drops each (>= 20 SC), then buy /avada.
    const earn = async hero => {
      for (let i = 0; i < 2; i++) {
        const m0 = hero.mark();
        gm.send({ type: 'gm:broadcast', text: '/coindrop epic' });
        const sp = await hero.next(m => m.type === 'coinDrop:spawn', 'spawn', m0);
        await sleep(200);
        hero.send({ type: 'coinDrop:claim', id: sp.drop.id });
        await hero.next(m => m.type === 'coinDrop:result' && m.ok, 'caught', m0);
        await sleep(700);
      }
    };

    let m0 = sissy.mark();
    sissy.send({ type: 'chat:guess', text: '/avada @Cigan' });
    assert.match((await errorOf(sissy, 'locked', m0)).message, /AVADA IS LOCKED/);

    await earn(sissy);
    m0 = sissy.mark();
    sissy.send({ type: 'shadow:buy', itemId: 'cmd-avada' });
    await sissy.next(m => /shadow/.test(m.type) && JSON.stringify(m).includes('cmd-avada'), 'bought', m0);

    // Never at everyone.
    await sleep(3200);
    m0 = sissy.mark();
    sissy.send({ type: 'chat:guess', text: '/avada all' });
    await errorOf(sissy, 'no all', m0);

    // The curse lands: Cigan dies (and the refused 'all' did not burn the cooldown).
    await sleep(3200);
    let g0 = gm.mark();
    sissy.send({ type: 'chat:guess', text: '/avada @Cigan' });
    const cast = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.emote?.act === 'avada'), 'cast', g0)).messages.find(x => x.emote?.act === 'avada');
    assert.equal(cast.emote.fx, 'avada');
    assert.equal(cast.emote.avada.rebound, false);
    assert.equal(cast.emote.avada.deadName, 'Cigan');
    assert.match(cast.text, /Sissy casts AVADA KEDAVRA on Cigan\. Cigan is no more\./);
    const st = await gm.next(m => m.type === 'state:public' && m.avada?.dead && Object.values(m.avada.dead).some(d => d.name === 'Cigan'), 'Cigan dead in public state', g0);
    const until = Object.values(st.avada.dead).find(d => d.name === 'Cigan').until;
    assert.ok(until - Date.now() > 50000 && until - Date.now() <= 60000, 'dead for 60 s');

    // 10-minute cooldown.
    await sleep(3200);
    m0 = sissy.mark();
    sissy.send({ type: 'chat:guess', text: '/avada @Cigan' });
    assert.match((await errorOf(sissy, 'cooldown', m0)).message, /RECHARGING \/\/ 10 MIN/);

    // Aimed at the Shadow Broker it ALWAYS rebounds (even with chance forced off).
    await earn(cigan);
    m0 = cigan.mark();
    cigan.send({ type: 'shadow:buy', itemId: 'cmd-avada' });
    await cigan.next(m => /shadow/.test(m.type) && JSON.stringify(m).includes('cmd-avada'), 'bought', m0);
    g0 = gm.mark();
    cigan.send({ type: 'chat:guess', text: '/avada @SHADOW BROKER' });
    const back = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.emote?.act === 'avada' && x.emote.avada?.rebound), 'rebound', g0)).messages.find(x => x.emote?.avada?.rebound);
    assert.equal(back.emote.avada.deadName, 'Cigan', 'the caster dies');
    assert.equal(back.emote.avada.atBroker, true);
    assert.match(back.text, /IT REBOUNDS! Cigan is no more\. SHADOW BROKER is THE ONE WHO LIVED\./);

    // The Shadow Broker casts freely and never misfires.
    g0 = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/avada @Sissy' });
    const gmCast = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.emote?.act === 'avada' && x.emote.actorName === 'SHADOW BROKER'), 'gm cast', g0)).messages.find(x => x.emote?.actorName === 'SHADOW BROKER' && x.emote?.act === 'avada');
    assert.equal(gmCast.emote.avada.rebound, false);
    assert.equal(gmCast.emote.avada.deadName, 'Sissy');
    console.log('PASS avada: locked until bought, single target, kills for 60 s, 10 min cooldown, rebounds at the Broker, Broker never misfires');
  } finally {
    clients.forEach(c => c.close());
    server.kill('SIGTERM');
    await new Promise(r => server.once('exit', r));
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
