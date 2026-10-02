// SHADOW BROKER TRANSMOG regressions: the catalog, the server equip path
// (GM-only, locked/unknown refused, CUSTOM, persistence across a restart,
// ownership grants, no game-logic side effects) and the browser wardrobe
// (preview never broadcasts, equip repaints existing + new Broker messages,
// refresh/reconnect keep the look, no effect leaks between sets, stickers and
// images still render).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const C = require('../js/broker-transmog-catalog');

// ---------------------------------------------------------------------------
// Catalog
function catalog() {
  const REQUIRED = ['default-broker', 'void-broker', 'blood-broker', 'whiteout-broker', 'warsong-broker', 'sovereign-broker', 'glitch-broker', 'omen-broker', 'bloodfang-broker', 'illidan-broker'];
  const ids = C.SETS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'set ids are unique');
  REQUIRED.forEach(id => assert.ok(C.get(id), `catalog has ${id}`));
  assert.equal(C.get('bloodfang-broker').name, 'BLOODFANG');
  assert.equal(C.get('illidan-broker').name, 'THE BETRAYER');
  for (const set of C.SETS) {
    assert.match(set.id, /^[a-z0-9-]+$/);
    assert.ok(C.UNLOCK_METHODS.includes(set.unlock.method), `${set.id} unlock method`);
    assert.ok(C.AVATAR_EFFECTS.includes(set.avatarEffect), `${set.id} avatar effect`);
    assert.ok(C.MESSAGE_EFFECTS.includes(set.messageEffect), `${set.id} message effect`);
    assert.ok(C.AURAS.includes(set.aura), `${set.id} aura`);
    assert.ok(C.ENTRANCES.includes(set.entrance), `${set.id} entrance`);
    assert.ok(C.SOUNDS.includes(set.sound), `${set.id} sound`);
    assert.match(set.frameColor, /^#[0-9a-f]{6}$/i);
    [set.avatar, set.thumb].forEach(file => assert.ok(fs.existsSync(path.join(ROOT, file.split('?')[0])), `${set.id} asset ${file}`));
    // A set never borrows another first-collection set's identity wholesale.
    REQUIRED.filter(id => id !== set.id).forEach(other => {
      const o = C.get(other);
      assert.ok(!(o.avatar === set.avatar && o.messageEffect === set.messageEffect && o.aura === set.aura) || set.unlock.method !== 'default', `${set.id} is distinct from ${other}`);
    });
  }
  // Bloodfang and Illidan own their effects: no other set uses them.
  for (const [id, key] of [['bloodfang-broker', 'bloodfang'], ['illidan-broker', 'fel']]) {
    const set = C.get(id);
    assert.equal(set.avatarEffect, key);
    assert.equal(set.messageEffect, key);
    assert.equal(set.aura, key);
    C.SETS.filter(s => s.id !== id).forEach(s => assert.ok(![s.avatarEffect, s.messageEffect, s.aura].includes(key), `${key} effect does not leak into ${s.id}`));
  }
  // Illidan is not "Void but green".
  const illidan = C.get('illidan-broker'), vo = C.get('void-broker');
  assert.notEqual(illidan.messageEffect, vo.messageEffect);
  assert.notEqual(illidan.aura, vo.aura);
  assert.notEqual(illidan.avatarEffect, vo.avatarEffect);
  // Fallbacks and sanitation.
  assert.equal(C.resolveProfile('nope').transmogId, 'default-broker');
  const dirty = C.cleanProfile({ transmogId: 'custom', avatarData: 'javascript:alert(1)', frameColor: 'red', avatarEffect: 'explode', messageEffect: '<b>', aura: 'x', entrance: 'y', sound: 'z' });
  assert.equal(dirty.transmogId, 'custom');
  assert.equal(dirty.avatarData, C.resolveProfile('default-broker').avatarData);
  assert.equal(dirty.frameColor, '#9b5de0');
  assert.deepEqual([dirty.avatarEffect, dirty.messageEffect, dirty.aura, dirty.sound], ['none', 'none', 'none', 'none']);
  // Every set is open (the Shadow Broker has no limits).
  C.SETS.forEach(set => assert.equal(C.isUnlocked(set.id, []), true, `${set.id} is open`));
  assert.equal(C.isUnlocked('nope', ['nope']), false);
  console.log('PASS transmog catalog');
}

// ---------------------------------------------------------------------------
// Server
const PORT = 19441;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-transmog-'));
function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let data = buf; try { data = JSON.parse(buf.toString()); } catch {} resolve({ status: res.statusCode, data, headers: res.headers, bytes: buf.length }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
class Client {
  constructor(name) { this.name = name; this.msgs = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const raw = data.toString();
        const m = JSON.parse(raw);
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        m._bytes = raw.length;
        this.msgs.push(m);
        if (m.type === 'state:public') this.state = m;
      });
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  mark() { return this.msgs.length; }
  async next(pred, label, from = 0, timeout = 6000) {
    const t = Date.now();
    while (Date.now() - t < timeout) { const f = this.msgs.slice(from).find(pred); if (f) return f; await sleep(20); }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}
function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'transmog-pass', ASOC_EMAIL_VERIFICATION: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  server.errors = '';
  server.stderr.on('data', c => { server.errors += c; });
  return server;
}
async function healthy() { for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); } throw new Error('server not healthy'); }
async function stop(server) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }

// Strip everything TRANSMOG may legitimately change, then compare.
const gameView = s => { const o = { ...s }; ['brokerProfile', 'brokerTransmogId', 'brokerTransmogSeq', 'brokerWardrobe', 'revision', 'serverTime', 'serverNow', 'now', 'timestamp', '_bytes'].forEach(k => delete o[k]); return JSON.stringify(o); };

async function serverSuite() {
  let server = spawnServer();
  const clients = [];
  const hero = async name => {
    const creds = { email: `${name.toLowerCase()}@transmog.test`, password: 'transmog-password' };
    await api('/api/auth/player/register', { ...creds, name });
    const token = (await api('/api/auth/player/login', creds)).data.token;
    const c = await new Client(name).open(); clients.push(c);
    c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
    await c.next(m => m.type === 'state:public', `${name} state`);
    return c;
  };
  const gmOpen = async () => {
    const g = await new Client('GM').open(); clients.push(g);
    g.send({ type: 'host:recover', gmToken: (await api('/api/auth/gm/login', { password: 'transmog-pass' })).data.token });
    await g.next(m => m.type === 'host:recovered', 'host');
    return g;
  };
  const equip = async (gm, watcher, message) => {
    const from = watcher.mark(), gfrom = gm.mark();
    const prevSeq = Number(watcher.state?.brokerTransmogSeq) || 0;
    gm.send(message);
    return Promise.race([
      watcher.next(m => m.type === 'state:public' && m.brokerTransmogSeq > prevSeq, 'equip state', from),
      gm.next(m => m.type === 'error' && m.code === 'TRANSMOG', 'equip error', gfrom).then(m => ({ error: m.message }))
    ]);
  };
  try {
    await healthy();
    const gm = await gmOpen();
    const ana = await hero('Ana');
    assert.equal(ana.state.brokerTransmogId, 'default-broker', 'DEFAULT on a fresh room');
    const before = gameView(ana.state);

    // 1. A Little Hero cannot equip.
    let from = ana.mark();
    ana.send({ type: 'gm:brokerTransmog', transmogId: 'bloodfang-broker' });
    let err = await ana.next(m => m.type === 'error' && m.code === 'TRANSMOG', 'player refused', from);
    assert.match(err.message, /ONLY THE SHADOW BROKER/);
    ana.send({ type: 'gm:brokerProfile', profile: { avatarEffect: 'fel' } });
    await ana.next(m => m.type === 'error' && m.code === 'TRANSMOG', 'player custom refused', from + 1);
    await sleep(200);
    assert.equal(ana.state.brokerTransmogId, 'default-broker');

    // 14. Bloodfang equips and reaches the player.
    let st = await equip(gm, ana, { type: 'gm:brokerTransmog', transmogId: 'bloodfang-broker' });
    assert.equal(st.brokerTransmogId, 'bloodfang-broker');
    assert.equal(st.brokerProfile.messageEffect, 'bloodfang');
    assert.match(st.brokerProfile.avatarData, /^assets\/transmog\/bloodfang\/avatar\.webp(\?v=\w+)?$/);
    // 17. No game logic moved.
    assert.equal(gameView(st), before, 'Bloodfang changed nothing but appearance');

    // 15. Illidan.
    st = await equip(gm, ana, { type: 'gm:brokerTransmog', transmogId: 'illidan-broker' });
    assert.equal(st.brokerTransmogId, 'illidan-broker');
    assert.equal(st.brokerProfile.aura, 'fel');
    assert.equal(gameView(st), before, 'Illidan changed nothing but appearance');

    // 10. Unknown id: refused, appearance unchanged.
    st = await equip(gm, ana, { type: 'gm:brokerTransmog', transmogId: 'not-a-set' });
    assert.match(st.error, /UNKNOWN APPEARANCE/);
    await sleep(200);
    assert.equal(ana.state.brokerTransmogId, 'illidan-broker', 'a refused equip changes nothing');

    // 13. CUSTOM still works; the uploaded image is served, not broadcast.
    const png = fs.readFileSync(path.join(ROOT, 'assets/transmog/void/thumb.webp')).toString('base64');
    st = await equip(gm, ana, { type: 'gm:brokerProfile', profile: { avatarData: `data:image/webp;base64,${png}`, frameColor: '#123456', avatarEffect: 'glitch', messageEffect: 'static', aura: 'static' } });
    assert.equal(st.brokerTransmogId, 'custom');
    assert.match(st.brokerProfile.avatarData, /^\/api\/broker-avatar\?room=MASTER&v=\d+$/);
    assert.ok(st._bytes < png.length, 'state:public does not carry the uploaded image');
    const img = await api(st.brokerProfile.avatarData);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/webp');
    assert.equal(img.bytes, Buffer.from(png, 'base64').length);

    // 12. DEFAULT always works; 18. switching never moves game state.
    st = await equip(gm, ana, { type: 'gm:brokerTransmog', transmogId: 'default-broker' });
    assert.equal(st.brokerTransmogId, 'default-broker');
    for (const id of ['void-broker', 'blood-broker', 'whiteout-broker', 'warsong-broker', 'sovereign-broker', 'glitch-broker', 'omen-broker']) {
      st = await equip(gm, ana, { type: 'gm:brokerTransmog', transmogId: id });
      assert.equal(st.brokerTransmogId, id);
      assert.equal(gameView(st), before, `${id} changed nothing but appearance`);
    }

    // 8. Reconnect keeps it.
    st = await equip(gm, ana, { type: 'gm:brokerTransmog', transmogId: 'illidan-broker' });
    const seq = st.brokerTransmogSeq;
    const bo = await hero('Bo');
    assert.equal(bo.state.brokerTransmogId, 'illidan-broker', 'a joining hero sees the equipped look');

    // 9. Restart: the persisted room restores the equipped set; a granted
    // appearance becomes equippable.
    clients.forEach(c => c.close()); clients.length = 0;
    await stop(server);
    server = spawnServer();
    await healthy();
    const gm2 = await gmOpen();
    const ana2 = await hero('Ana');
    assert.equal(ana2.state.brokerTransmogId, 'illidan-broker', 'TRANSMOG survives a restart');
    assert.equal(ana2.state.brokerTransmogSeq, seq);
    st = await equip(gm2, ana2, { type: 'gm:brokerTransmog', transmogId: 'omen-broker' });
    assert.equal(st.brokerTransmogId, 'omen-broker', 'equips work after a restart');
    assert.equal(server.errors.trim(), '');
    console.log('PASS transmog server');
  } finally {
    clients.forEach(c => c.close());
    await stop(server).catch(() => {});
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Browser
async function browserSuite() {
  const H = require('./lib/browser-harness');
  const { chromium } = require('playwright');
  const s = await H.startServer({ port: 19442 });
  let browser;
  try {
    browser = await chromium.launch(H.launchOptions());
    const pctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await H.openHeroPage(pctx, s, await H.heroToken(s, 'Tami'));
    const gctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const tok = (await s.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token;
    await gctx.addInitScript(t => sessionStorage.setItem('asoc_gm_token', t), tok);
    const g = await gctx.newPage();
    const errors = [];
    g.on('pageerror', e => errors.push('GM: ' + e.message));
    p.on('pageerror', e => errors.push('HERO: ' + e.message));
    await g.goto(s.base + '/index.html');
    await g.waitForFunction(() => window.App?.roomCode === 'MASTER', null, { timeout: 15000 });
    await H.sleep(600);
    const say = async text => {
      await g.evaluate(t => { const c = document.getElementById('shadow-broker-composer'); c.textContent = t; c.dispatchEvent(new Event('input', { bubbles: true })); }, text);
      await g.press('#shadow-broker-composer', 'Enter');
    };
    await say('Before the change');
    await p.waitForSelector('.chat-broker-entry .shadow-broker-transmission');
    const look = page => page.evaluate(() => ({
      set: document.documentElement.dataset.brokerSet,
      aura: document.documentElement.dataset.brokerAura,
      effects: [...new Set([...document.querySelectorAll('.shadow-broker-transmission[data-broker-message-effect]')].filter(n => !n.closest('#broker-transmog-overlay')).map(n => n.dataset.brokerMessageEffect))],
      avatars: [...new Set([...document.querySelectorAll('img[data-broker-avatar]')].filter(n => !n.closest('#broker-transmog-overlay,.btm-entrance')).map(n => n.getAttribute('src')))],
      avatarFx: [...new Set([...document.querySelectorAll('img[data-broker-avatar]')].filter(n => !n.closest('#broker-transmog-overlay,.btm-entrance')).map(n => n.dataset.brokerEffect))]
    }));

    // 2. Preview stays local.
    await g.click('#broker-transmog-btn');
    await g.click('[data-btm-set="illidan-broker"]');
    await H.sleep(500);
    assert.equal(await g.textContent('#btm-equip'), 'EQUIP');
    assert.match(await g.textContent('#btm-stage'), /PREVIEW \/\/ NOT EQUIPPED/);
    assert.equal((await look(p)).set, 'default-broker', 'preview never reaches players');
    assert.equal((await look(g)).set, 'default-broker', 'preview never repaints the live console');
    // Cancel discards it.
    await g.keyboard.press('Escape');
    assert.equal(await g.isVisible('#broker-transmog-overlay'), false);
    assert.equal((await look(g)).set, 'default-broker');
    // Nothing in the vault is locked.
    await g.click('#broker-transmog-btn');
    assert.equal(await g.$$eval('.btm-tile.is-locked', n => n.length), 0);

    // 3/4/5. Equip Illidan: both pages repaint, existing messages included.
    await g.click('[data-btm-set="illidan-broker"]');
    await g.click('#btm-equip');
    for (const page of [p, g]) await page.waitForFunction(() => document.documentElement.dataset.brokerSet === 'illidan-broker', null, { timeout: 5000 });
    for (const page of [p, g]) {
      const l = await look(page);
      assert.equal(l.aura, 'fel');
      assert.deepEqual(l.effects, ['fel'], 'existing Broker messages repainted');
      assert.equal(l.avatars.length, 1);
      assert.match(l.avatars[0], /^assets\/transmog\/illidan\/avatar\.webp/);
      assert.deepEqual(l.avatarFx, ['fel']);
    }
    assert.ok(await p.$('.btm-entrance'), 'players see the entrance');
    await g.waitForFunction(() => document.getElementById('btm-equip').textContent === 'EQUIPPED');
    await g.click('[data-btm="close"]');

    // 6. New Broker messages arrive in the equipped style.
    await say('After the change');
    await p.waitForFunction(() => [...document.querySelectorAll('.chat-broker-entry')].some(n => /After the change/.test(n.textContent) && n.querySelector('.shadow-broker-transmission')?.dataset.brokerMessageEffect === 'fel'), null, { timeout: 5000 });

    // 20. Switching sets leaves nothing of the previous one behind.
    await g.click('#broker-transmog-btn');
    await g.click('[data-btm-set="bloodfang-broker"]');
    await g.click('#btm-equip');
    for (const page of [p, g]) await page.waitForFunction(() => document.documentElement.dataset.brokerSet === 'bloodfang-broker', null, { timeout: 5000 });
    for (const page of [p, g]) {
      const l = await look(page);
      assert.deepEqual(l.effects, ['bloodfang']);
      assert.deepEqual(l.avatarFx, ['bloodfang']);
      assert.equal(l.aura, 'bloodfang');
      assert.equal(await page.evaluate(() => document.querySelectorAll(':not(#broker-transmog-overlay *)[data-broker-effect="fel"], :not(#broker-transmog-overlay *)[data-broker-message-effect="fel"]').length), 0, 'no fel leftovers');
    }
    await g.click('[data-btm="close"]');

    // 7. Refresh keeps it (hero and GM); no replayed entrance on load.
    await p.reload();
    await p.waitForFunction(() => document.documentElement.dataset.brokerSet === 'bloodfang-broker', null, { timeout: 15000 });
    await p.waitForSelector('.chat-broker-entry .shadow-broker-transmission[data-broker-message-effect="bloodfang"]');
    assert.equal(await p.$('.btm-entrance'), null, 'refresh does not replay the entrance');
    await g.reload();
    await g.waitForFunction(() => document.documentElement.dataset.brokerSet === 'bloodfang-broker', null, { timeout: 15000 });

    // 19. Stickers still arrive as stickers after a TRANSMOG.
    await p.click('#chat-image-upload-btn'); await p.click('[data-chat-attachment="sticker"]');
    await p.waitForSelector('.stk-tray [data-stk-tab]'); await p.click('[data-stk-tab="pack"]');
    await p.click('.stk-tray [data-stk-send="/assets/stickers/nice-try-dipshit.webp"]');
    await g.waitForSelector('#gm-chat-messages .sticker-message .chat-sticker img[src="/assets/stickers/nice-try-dipshit.webp"]', { timeout: 8000 });

    assert.deepEqual(errors, []);
    console.log('PASS transmog browser');
  } finally {
    await browser?.close();
    await s.stop();
  }
}

(async () => {
  catalog();
  await serverSuite();
  await browserSuite();
})().catch(error => { console.error(error); process.exit(1); });
