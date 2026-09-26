// SHADOW COIN ECONOMY V1: ledger, cosmetic inventory, titles, cosmetic
// /commands, equip/unequip, relics, Shadow Roulette 0-12.
//   Pure: roulette coverage and payouts (0 is the house number), catalog
//         pricing, tiers, achievement gates, relics never purchasable,
//         nothing in the catalog touches gameplay.
//   Store: every balance change is logged; purchases are atomic and
//          single-shot; equip requires ownership; roulette settles net.
//   Live: buy / equip / title broadcast; locked vs owned premium commands
//         with cooldown; roulette limits, confirmation and payouts; all of
//         it survives a restart; Battle scores untouched.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const market = require('../shadow-market');

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
function checkPure() {
  const bet = raw => market.parseRouletteBet(raw).bet;
  // 13 pockets, 0 beats every even-money / group bet
  for (const type of ['red', 'black', 'odd', 'even', 'low', 'high']) assert.equal(market.betCovers(bet({ type }), 0), false, `0 defeats ${type}`);
  assert.equal(market.betCovers(bet({ type: 'number', value: 0 }), 0), true, 'a straight 0 wins on 0');
  for (let v = 0; v < 4; v++) assert.equal(market.betCovers(bet({ type: 'trio', value: v }), 0), false);
  // colours split 6/6 across 1-12
  const reds = [...Array(12)].map((_, i) => i + 1).filter(n => market.betCovers(bet({ type: 'red' }), n));
  assert.equal(reds.length, 6);
  assert.equal([...Array(12)].map((_, i) => i + 1).filter(n => market.betCovers(bet({ type: 'black' }), n)).length, 6);
  assert.equal(market.betCovers(bet({ type: 'low' }), 6), true);
  assert.equal(market.betCovers(bet({ type: 'high' }), 7), true);
  assert.equal(market.betCovers(bet({ type: 'quad', value: 2 }), 12), true);
  // payouts per the V1 spec
  assert.deepEqual(market.ROULETTE_PAYOUTS, { number: 12, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, trio: 3, quad: 2 });
  // no bet is player-favourable over the 13 pockets
  for (const raw of [{ type: 'number', value: 5 }, { type: 'red' }, { type: 'odd' }, { type: 'high' }, { type: 'trio', value: 1 }, { type: 'quad', value: 0 }]) {
    const b = bet(raw);
    let ev = 0;
    for (let n = 0; n < 13; n++) ev += market.betCovers(b, n) ? market.ROULETTE_PAYOUTS[b.type] : -1;
    assert.ok(ev <= 0, `${raw.type} never favours the player`);
  }
  // malformed bets are refused
  for (const raw of [null, {}, { type: 'number', value: 13 }, { type: 'number', value: -1 }, { type: 'trio', value: 4 }, { type: 'quad', value: 1.5 }, { type: 'split' }]) {
    assert.ok(market.parseRouletteBet(raw).error, `refuses ${JSON.stringify(raw)}`);
  }
  assert.equal(market.resolveRoulette(bet({ type: 'red' }), 0).line, 'THE HOUSE REMEMBERS.');
  assert.equal(market.ROULETTE_MAX_WAGER, 10);

  // catalog: every V1 category exists; relics are never purchasable
  const kinds = new Set(market.CATALOG.map(item => item.kind));
  for (const kind of ['appearance', 'effect', 'frame', 'title', 'command']) assert.ok(kinds.has(kind), `catalog has ${kind}`);
  for (const item of market.CATALOG) {
    if (item.relic) assert.equal(market.nextPrice(item, 0), null, `${item.id} is a relic`);
    else assert.ok(market.nextPrice(item, 0) > 0, `${item.id} has a price`);
    assert.ok(!('score' in item) && !('clue' in item) && !('timer' in item), 'cosmetic only');
  }
  const voidEye = market.getItem('fx-void-eye');
  assert.equal(market.tierCount(voidEye), 5);
  assert.equal(market.nextPrice(voidEye, 1), voidEye.tiers[1]);
  assert.equal(market.nextPrice(voidEye, 5), null, 'maxed tiers stop selling');
  const witness = market.getItem('title-final-witness');
  assert.equal(witness.price, 15);
  assert.equal(market.requirementMet(witness, { finalSolutions: 9 }), false);
  assert.equal(market.requirementMet(witness, { finalSolutions: 10 }), true);
  const womfTitle = market.getItem('title-womf-survivor');
  assert.equal(market.requirementMet(womfTitle, { relicProgress: {} }), false);
  assert.equal(market.requirementMet(womfTitle, { relicProgress: { wheelSurvivals: 1 } }), true);
  assert.equal(market.catalogFor({ relicProgress: { wheelSurvivals: 1 }, cosmetics: { owned: {} } }).find(i => i.id === 'title-womf-survivor').requires.met, true);
  // public cosmetics expose only equipped + owned items
  assert.deepEqual(market.publicCosmetics({ cosmetics: { owned: { 'fx-fire': 1 }, equipped: { effect: 'fx-fire', title: 'title-little-heretic' } } }), { effect: 'fx-fire', effectTier: 1 });
  assert.deepEqual(market.publicCosmetics({ cosmetics: {
    owned: { 'name-void': 1, 'sigil-crown': 1, 'cel-shatter': 1, 'card-void': 1 },
    equipped: { name: 'name-void', sigil: 'sigil-crown', celebration: 'cel-shatter', card: 'card-void' }
  } }), { name: 'name-void', sigil: 'sigil-crown', celebration: 'cel-shatter' }, 'the dossier card is not broadcast');
  for (const kind of ['celebration', 'name', 'sigil', 'card', 'showcase', 'relic']) assert.ok(kinds.has(kind), `catalog has ${kind}`);
  assert.equal(market.getItem('cel-final-witness').requires.min, 10);
  assert.equal(market.getItem('cel-final-witness').name, 'WITNESS THE FINAL', 'celebration name does not collide with the Final Witness title');
  // relics are earned only; showcase slots grow with the tiered upgrade
  for (const id of ['relic-spun-returned', 'relic-fastest-hand', 'relic-last-second-heretic', 'relic-word-killer']) {
    assert.equal(market.nextPrice(market.getItem(id), 0), null, `${id} is never sold`);
  }
  assert.equal(market.showcaseSlots({}), 1);
  assert.equal(market.showcaseSlots({ cosmetics: { owned: { 'showcase-slots': 2 } } }), 3);
  assert.equal(market.showcaseSlots({ cosmetics: { owned: { 'showcase-slots': 99 } } }), 3, 'corrupt showcase tiers are clamped');
  const dossier = market.dossierFor({
    name: 'Ana', finalSolutions: 3, gamesPlayed: 9,
    cosmetics: { owned: { 'relic-word-killer': 1, 'relic-fastest-hand': 1, 'card-gilded': 1 }, equipped: { card: 'card-gilded' }, showcase: ['relic-word-killer', 'relic-fastest-hand'] }
  });
  assert.equal(dossier.card, 'card-gilded');
  assert.deepEqual(dossier.showcase.map(r => r.id), ['relic-word-killer'], 'showcase is capped by slots');
  assert.equal(dossier.relicCount, 2);
  assert.equal(dossier.stats.finalSolutions, 3);
  assert.ok(!('shadowCoins' in dossier) && !('email' in dossier), 'no private fields');
}

// ---------------------------------------------------------------------------
function checkStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-economy-store-'));
  process.env.ASOC_DATA_DIR = dir;
  const storePath = require.resolve('../player-store');
  const durablePath = require.resolve('../durable-io');
  const fresh = () => { delete require.cache[storePath]; delete require.cache[durablePath]; return require('../player-store'); };
  try {
    let store = fresh();
    const ana = { id: 'acct-ana', name: 'Ana' };
    store.getOrCreateProfile(ana);
    store.awardShadowCoins(ana, 10, 'seed', { reason: 'seed' });
    store.deductShadowCoins(ana, 0.1, 'iks-loss', { reason: 'IKS OKS loss' });
    let ledger = store.getShadowProfile(ana).shadowCoinLedger;
    assert.equal(ledger.length, 2, 'every change is logged');
    assert.deepEqual(ledger.map(e => [e.kind, e.delta, e.balance]), [['reward', 10, 10], ['penalty', -0.1, 9.9]]);

    // purchase: atomic, single-shot, needs balance
    assert.equal(store.purchaseCosmetic(ana, 'fx-fire', 1, 8, 'market:fx-fire:1').ok, true);
    assert.equal(store.getShadowCoins(ana), 1.9);
    assert.equal(store.purchaseCosmetic(ana, 'fx-fire', 1, 8, 'market:fx-fire:1').duplicate, true, 'the same receipt never charges twice');
    assert.equal(store.purchaseCosmetic(ana, 'fx-fire', 1, 8, 'market:other').ok, false, 'already owned');
    assert.equal(store.purchaseCosmetic(ana, 'fx-frost', 1, 8, 'market:fx-frost:1').ok, false, 'insufficient balance');
    assert.equal(store.getShadowCoins(ana), 1.9);
    assert.equal(store.ownsCosmetic(ana, 'fx-fire'), true);
    assert.equal(store.ownsCosmetic(ana, 'fx-frost'), false);

    // equip requires ownership
    assert.equal(store.equipCosmetic(ana, 'effect', 'fx-frost').ok, false);
    assert.equal(store.equipCosmetic(ana, 'effect', 'fx-fire').ok, true);
    assert.equal(store.equipCosmetic(ana, 'bogus', null).ok, false);
    // relic grant
    assert.equal(store.grantRelic(ana, 'title-broker-mistake').ok, true);
    assert.equal(store.grantRelic(ana, 'title-broker-mistake').duplicate, true);

    // roulette: stake must be covered; net result logged once
    const win = store.settleRouletteSpin(ana, 1, 'spin-1', () => ({ won: true, odds: 1, pocket: 3, label: 'RED', color: 'red' }));
    assert.equal(win.ok, true);
    assert.equal(win.net, 1);
    assert.equal(store.getShadowCoins(ana), 2.9);
    const loss = store.settleRouletteSpin(ana, 2, 'spin-2', () => ({ won: false, odds: 1, pocket: 0, label: 'RED', color: 'zero' }));
    assert.equal(loss.net, -2);
    assert.equal(store.getShadowCoins(ana), 0.9);
    let resolved = false;
    assert.equal(store.settleRouletteSpin(ana, 5, 'spin-3', () => { resolved = true; return {}; }).ok, false, 'cannot stake more than the balance');
    assert.equal(resolved, false, 'the wheel never turns on an uncovered stake');
    assert.equal(store.settleRouletteSpin(ana, 0.5, 'spin-2', () => ({ won: true, odds: 12 })).ok, false, 'a spin receipt settles once');

    // persistence across reload
    store = fresh();
    const profile = store.getShadowProfile(ana);
    assert.equal(profile.shadowCoins, 0.9);
    assert.equal(profile.cosmetics.owned['fx-fire'], 1);
    assert.equal(profile.cosmetics.equipped.effect, 'fx-fire');
    assert.equal(profile.cosmetics.owned['title-broker-mistake'], 1);
    ledger = profile.shadowCoinLedger;
    assert.deepEqual(ledger.map(e => e.kind), ['reward', 'penalty', 'purchase', 'roulette', 'roulette']);
    assert.equal(ledger[3].detail.pocket, 3);
    assert.equal(ledger.at(-1).balance, 0.9);

    // relic counters are idempotent per event; showcase needs ownership
    assert.equal(store.bumpRelicProgress(ana, 'wheelSurvivals', 'womf:1'), 1);
    assert.equal(store.bumpRelicProgress(ana, 'wheelSurvivals', 'womf:1'), 1, 'the same spin never counts twice');
    assert.equal(store.bumpRelicProgress(ana, 'wheelSurvivals', 'womf:2'), 2);
    assert.equal(store.setShowcase(ana, ['relic-word-killer']).ok, false);
    assert.deepEqual(store.setShowcase(ana, ['title-broker-mistake']).showcase, ['title-broker-mistake']);
    assert.deepEqual(store.setShowcase(ana, ['title-broker-mistake', 'title-broker-mistake']).showcase, ['title-broker-mistake'], 'store deduplicates showcase ids');
    store = fresh();
    assert.equal(store.getShadowProfile(ana).relicProgress.wheelSurvivals, 2);
    assert.deepEqual(store.getShadowProfile(ana).cosmetics.showcase, ['title-broker-mistake']);

    // generic counters still cannot move currency
    store.adjustProfile(ana, { statDeltas: { shadowCoins: 500, shadowCoinUnits: 5000 } });
    assert.equal(store.getShadowCoins(ana), 0.9);

    // legacy profiles without the new fields load cleanly
    const file = path.join(dir, 'players.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw['acct-ana'].cosmetics;
    delete raw['acct-ana'].shadowCoinLedger;
    raw['acct-ana'].cosmetics = { owned: { 'BAD ID': 3, 'fx-smoke': 1 }, equipped: { effect: 'fx-glitch', frame: 'fx-smoke' } };
    fs.writeFileSync(file, JSON.stringify(raw));
    store = fresh();
    const legacy = store.getShadowProfile(ana);
    assert.deepEqual(legacy.cosmetics.owned, { 'fx-smoke': 1 }, 'invalid ids are dropped');
    assert.equal(legacy.cosmetics.equipped.effect, null, 'unowned equips are cleared');
    assert.deepEqual(legacy.shadowCoinLedger, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.ASOC_DATA_DIR;
  }
}

// ---------------------------------------------------------------------------
const PORT = Number(process.env.ASOC_ECONOMY_TEST_PORT) || 18811;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-economy-'));

function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.players = []; this.shadow = null; this.chat = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const m = JSON.parse(data.toString());
        if (m.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (m.type === 'protocol:ready') return resolve(this);
        this.msgs.push(m);
        if (m.type === 'players:update') this.players = m.players || [];
        if (m.type === 'shadow:state') this.shadow = m;
        if (m.type === 'chat:update') this.chat = m.messages || [];
        if (m.type === 'state:public') this.state = m;
        if (m.type === 'join:success') this.playerId = m.playerId;
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
  async ask(message, label) {
    const from = this.mark();
    this.send(message);
    return this.next(m => m.type === 'shadow:state' || m.type === 'shadow:error' || m.type === 'shadow:spinResult', label, from);
  }
  close() { try { this.ws.close(); } catch {} }
}

function spawnServer() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'economy-pass', ASOC_EMAIL_VERIFICATION: '0' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  server.errors = '';
  server.stderr.on('data', chunk => { server.errors += chunk; });
  return server;
}

async function healthy() {
  for (let i = 0; i < 80; i++) { try { if ((await api('/health')).status === 200) return; } catch {} await sleep(150); }
  throw new Error('server not healthy');
}

async function stop(server) {
  server.kill('SIGTERM');
  await new Promise(resolve => server.once('exit', resolve));
}

async function runServer() {
  let server = spawnServer();
  const clients = [];
  const creds = {};
  const connect = async (name) => {
    if (!creds[name]) {
      creds[name] = { email: `${name.toLowerCase()}@economy.test`, password: 'economy-password' };
      await api('/api/auth/player/register', { ...creds[name], name });
    }
    const token = (await api('/api/auth/player/login', creds[name])).data.token;
    const c = await new Client(name).open();
    clients.push(c);
    c.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
    await c.next(m => m.type === 'join:success', `${name} join`);
    await sleep(150);
    return c;
  };
  const gmLogin = async () => (await api('/api/auth/gm/login', { password: 'economy-pass' })).data.token;
  const openGm = async () => {
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: await gmLogin() });
    await gm.next(m => m.type === 'host:recovered', 'host');
    return gm;
  };
  try {
    await healthy();
    await openGm();
    let ana = await connect('Ana');
    let bo = await connect('Bo');

    // With 0 coins: state works, purchases and spins are refused.
    let reply = await ana.ask({ type: 'shadow:state' }, 'state');
    assert.equal(reply.type, 'shadow:state');
    assert.equal(reply.balance, 0);
    assert.ok(reply.catalog.length >= 20);
    assert.equal((await ana.ask({ type: 'shadow:buy', itemId: 'title-little-heretic' }, 'broke buy')).message, 'Not enough Shadow Coins');
    assert.equal((await ana.ask({ type: 'shadow:spin', bet: { type: 'red' }, wager: 1 }, 'broke spin')).type, 'shadow:error');
    // Premium command locked for a non-owner.
    let from = ana.mark();
    ana.send({ type: 'chat:guess', text: '/smite @Bo' });
    let err = await ana.next(m => m.type === 'error', 'locked smite', from);
    assert.match(err.message, /LOCKED/);

    // Seed balance offline (the only earning paths are gameplay rewards).
    const anaId = ana.playerId;
    clients.forEach(c => c.close());
    clients.length = 0;
    await stop(server);
    process.env.ASOC_DATA_DIR = DATA;
    const storePath = require.resolve('../player-store');
    const durablePath = require.resolve('../durable-io');
    delete require.cache[storePath]; delete require.cache[durablePath];
    const store = require('../player-store');
    store.awardShadowCoins({ id: anaId, name: 'Ana' }, 100, 'test:seed', { reason: 'test seed' });
    delete process.env.ASOC_DATA_DIR;
    server = spawnServer();
    await healthy();
    const gm = await openGm();
    ana = await connect('Ana');
    bo = await connect('Bo');

    reply = await ana.ask({ type: 'shadow:state' }, 'seeded state');
    assert.equal(reply.balance, 100);

    // Buying: unknown / relic / gated are refused; a real buy charges once and auto-equips.
    assert.equal((await ana.ask({ type: 'shadow:buy', itemId: 'nope' }, 'unknown')).type, 'shadow:error');
    assert.match((await ana.ask({ type: 'shadow:buy', itemId: 'title-broker-mistake' }, 'relic')).message, /Relics/);
    assert.match((await ana.ask({ type: 'shadow:buy', itemId: 'title-final-witness' }, 'gated')).message, /Solve 10 Finals/);
    reply = await ana.ask({ type: 'shadow:buy', itemId: 'title-little-heretic' }, 'buy title');
    assert.equal(reply.type, 'shadow:state');
    assert.equal(reply.balance, 97);
    assert.equal(reply.equipped.title, 'title-little-heretic');
    assert.match(reply.notice, /ACQUIRED/);
    assert.equal((await ana.ask({ type: 'shadow:buy', itemId: 'title-little-heretic' }, 'rebuy')).type, 'shadow:error');
    // Tiered upgrade: Void Eye I then II.
    reply = await ana.ask({ type: 'shadow:buy', itemId: 'fx-void-eye' }, 'void I');
    assert.equal(reply.balance, 93);
    reply = await ana.ask({ type: 'shadow:buy', itemId: 'fx-void-eye' }, 'void II');
    assert.equal(reply.balance, 87);
    assert.equal(reply.catalog.find(i => i.id === 'fx-void-eye').tier, 2);
    await sleep(150);
    // Everyone sees the equipped cosmetics; nothing else about the profile.
    const seen = gm.players.find(p => p.id === anaId);
    assert.deepEqual(seen.cosmetics, { effect: 'fx-void-eye', effectTier: 2, title: 'Little Heretic' });
    assert.equal(bo.players.find(p => p.id === anaId).cosmetics.title, 'Little Heretic');
    // Equip / unequip, and slot mismatches are refused.
    assert.equal((await ana.ask({ type: 'shadow:equip', slot: 'frame', itemId: 'fx-void-eye' }, 'wrong slot')).type, 'shadow:error');
    assert.equal((await ana.ask({ type: 'shadow:equip', slot: 'effect', itemId: 'fx-fire' }, 'unowned')).type, 'shadow:error');
    reply = await ana.ask({ type: 'shadow:equip', slot: 'title', itemId: null }, 'unequip');
    assert.equal(reply.equipped.title, null);
    await sleep(150);
    assert.equal(gm.players.find(p => p.id === anaId).cosmetics.title, undefined);

    // Premium command: owned works (card with fx), cooldown blocks spam.
    await ana.ask({ type: 'shadow:buy', itemId: 'cmd-smite' }, 'buy smite');
    from = gm.mark();
    ana.send({ type: 'chat:guess', text: '/smite @Bo' });
    const update = await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.emote?.act === 'smite'), 'smite card', from);
    const card = update.messages.find(x => x.emote?.act === 'smite');
    assert.equal(card.emote.fx, 'smite');
    assert.equal(card.emote.targetName, 'Bo');
    assert.equal(card.verdict, null, 'a cosmetic command is never adjudicated');
    from = ana.mark();
    await sleep(1200);
    ana.send({ type: 'chat:guess', text: '/smite @Bo' });
    err = await ana.next(m => m.type === 'error', 'cooldown', from);
    assert.match(err.message, /RECHARGING/);
    // /love: owned by Ana, target optional; the Broker may aim it too.
    assert.match((await ana.ask({ type: 'shadow:buy', itemId: 'fx-hearts' }, 'lovestruck')).notice, /LOVESTRUCK ACQUIRED/);
    await ana.ask({ type: 'shadow:buy', itemId: 'cmd-love' }, 'buy love');
    // The premium cooldown is shared across commands: /smite just fired.
    from = ana.mark();
    ana.send({ type: 'chat:guess', text: '/love' });
    assert.match((await ana.next(m => m.type === 'error', 'love cooldown', from)).message, /LOVE RECHARGING/);
    from = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/love' });
    const loveCard = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.emote?.act === 'love'), 'love card', from))
      .messages.find(x => x.emote?.act === 'love');
    assert.equal(loveCard.emote.fx, 'love');
    assert.equal(loveCard.emote.targetId, null, '/love without a target spreads love to the room');
    assert.match(loveCard.emote.lines.other, /spreads love across the room/);
    from = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/love @Bo' });
    const aimed = (await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.emote?.act === 'love' && x.emote.targetName === 'Bo'), 'aimed love', from))
      .messages.find(x => x.emote?.act === 'love' && x.emote.targetName === 'Bo');
    assert.match(aimed.emote.lines.target, /sends you love/);
    await sleep(150);
    assert.equal(bo.players.find(p => p.id === anaId).cosmetics.effect, 'fx-hearts');
    // Bo does not own it.
    from = bo.mark();
    bo.send({ type: 'chat:guess', text: '/smite @Ana' });
    assert.match((await bo.next(m => m.type === 'error', 'bo locked', from)).message, /LOCKED/);

    // Roulette: limits, confirmation, and a settled spin.
    const balanceBefore = (await ana.ask({ type: 'shadow:state' }, 'pre-spin')).balance;
    assert.match((await ana.ask({ type: 'shadow:spin', bet: { type: 'red' }, wager: 11 }, 'over max')).message, /Wager must be/);
    assert.match((await ana.ask({ type: 'shadow:spin', bet: { type: 'red' }, wager: 0 }, 'zero')).message, /Wager must be/);
    assert.match((await ana.ask({ type: 'shadow:spin', bet: { type: 'red' }, wager: 6 }, 'unconfirmed')).message, /confirmed/);
    assert.match((await ana.ask({ type: 'shadow:spin', bet: { type: 'number', value: 13 }, wager: 1 }, 'bad bet')).message, /0 to 12/);
    from = ana.mark();
    ana.send({ type: 'shadow:spin', bet: { type: 'number', value: 7 }, wager: 1 });
    const spin = await ana.next(m => m.type === 'shadow:spinResult' || m.type === 'shadow:error', 'spin', from);
    assert.equal(spin.type, 'shadow:spinResult', spin.message);
    assert.ok(spin.outcome.pocket >= 0 && spin.outcome.pocket <= 12);
    assert.equal(spin.net, spin.outcome.pocket === 7 ? 12 : -1);
    assert.equal(spin.balance, Math.round((balanceBefore + spin.net) * 10) / 10);
    // Rate limit.
    assert.match((await ana.ask({ type: 'shadow:spin', bet: { type: 'red' }, wager: 1 }, 'too fast')).message, /still turning/);
    await sleep(1600);
    from = ana.mark();
    ana.send({ type: 'shadow:spin', bet: { type: 'red' }, wager: 6, confirm: true });
    const big = await ana.next(m => m.type === 'shadow:spinResult', 'confirmed big spin', from);
    assert.equal(Math.abs(big.net), 6);

    // Ledger shows everything, newest first.
    reply = await ana.ask({ type: 'shadow:state' }, 'ledger');
    const kinds = reply.ledger.map(e => e.kind);
    assert.deepEqual(kinds.slice(0, 2), ['roulette', 'roulette']);
    assert.equal(kinds.filter(k => k === 'purchase').length, 6);
    assert.equal(kinds.at(-1), 'reward');
    assert.equal(reply.ledger[0].balance, reply.balance);

    // Battle score untouched by any of it.
    assert.equal(gm.players.find(p => p.id === anaId).score, 0);

    // Name style + sigil + celebration: bought, equipped, broadcast.
    await ana.ask({ type: 'shadow:buy', itemId: 'name-void' }, 'name');
    await ana.ask({ type: 'shadow:buy', itemId: 'sigil-crown' }, 'sigil');
    reply = await ana.ask({ type: 'shadow:buy', itemId: 'cel-broker-nod' }, 'celebration');
    assert.equal(reply.equipped.celebration, 'cel-broker-nod');
    assert.match((await ana.ask({ type: 'shadow:buy', itemId: 'cel-final-witness' }, 'gated cel')).message, /Solve 10 Finals/);
    await sleep(150);
    assert.deepEqual(
      (({ name, sigil, celebration }) => ({ name, sigil, celebration }))(bo.players.find(p => p.id === anaId).cosmetics),
      { name: 'name-void', sigil: 'sigil-crown', celebration: 'cel-broker-nod' }
    );

    // Relics through real events: a live battle.
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await sleep(350);
    // The Summon Ritual needs five voices.
    const fillers = [await connect('Cy'), await connect('Dee'), await connect('Eli')];
    [ana, bo, ...fillers].forEach(p => p.send({ type: 'ritual:join' }));
    await gm.next(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual 5/5');
    gm.send({ type: 'gm:timerLaunchCountdown' });
    await sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await sleep(400);
    const say = async (player, text) => {
      const since = gm.mark();
      player.send({ type: 'chat:guess', text });
      const update = await gm.next(m => m.type === 'chat:update' && m.messages.some(x => x.text === text), `guess ${text}`, since);
      await sleep(400);
      return update.messages.find(x => x.text === text);
    };
    const judge = async (messageId, target) => {
      const since = gm.mark();
      gm.send({ type: 'gm:judgeGuess', messageId, verdict: 'correct', target });
      await gm.next(m => m.type === 'gm:judge:ack' || m.type === 'error', 'judge', since);
      await sleep(250);
    };
    // Ana makes the first solve of the match (FASTEST HAND progress 1/10).
    await judge((await say(ana, 'relic alpha')).id, 'A');
    reply = await ana.ask({ type: 'shadow:state' }, 'fastest progress');
    assert.equal(reply.catalog.find(i => i.id === 'relic-fastest-hand').earn.progress, 1);
    // A second solve in the same match is not a first solve.
    await judge((await say(ana, 'relic beta')).id, 'B');
    reply = await ana.ask({ type: 'shadow:state' }, 'fastest progress unchanged');
    assert.equal(reply.catalog.find(i => i.id === 'relic-fastest-hand').earn.progress, 1);
    // Bo solved no column and takes the Final: LAST-SECOND HERETIC.
    const chatMark = gm.mark();
    await judge((await say(bo, 'relic final')).id, 'FINAL');
    const unearthed = await gm.next(m => m.type === 'chat:update' && m.messages.some(x => /RELIC UNEARTHED \/\/ Bo -- LAST-SECOND HERETIC/.test(x.text || '')), 'relic announcement', chatMark);
    assert.ok(unearthed);
    reply = await bo.ask({ type: 'shadow:state' }, 'bo relics');
    assert.equal(reply.catalog.find(i => i.id === 'relic-last-second-heretic').tier, 1);
    assert.equal(reply.catalog.find(i => i.id === 'relic-last-second-heretic').nextPrice, null);

    // GM grants SHADOW BROKER'S MISTAKE with /relic; a second grant is refused.
    let gmMark = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/relic @Ana' });
    await gm.next(m => m.type === 'chat:update' && m.messages.some(x => /RELIC UNEARTHED \/\/ Ana -- SHADOW BROKER'S MISTAKE/.test(x.text || '')), '/relic', gmMark);
    gmMark = gm.mark();
    gm.send({ type: 'gm:broadcast', text: '/relic @Ana' });
    assert.match((await gm.next(m => m.type === 'error', 'second /relic', gmMark)).message, /ALREADY HOLDS/);

    // Showcase: one base slot; relics only; more slots are bought.
    assert.match((await ana.ask({ type: 'shadow:showcase', itemIds: ['fx-void-eye'] }, 'not a relic')).message, /Only relics/);
    assert.match((await ana.ask({ type: 'shadow:showcase', itemIds: ['relic-word-killer'] }, 'unowned')).message, /Not owned/);
    reply = await ana.ask({ type: 'shadow:showcase', itemIds: ['title-broker-mistake'] }, 'showcase');
    assert.deepEqual(reply.showcase, ['title-broker-mistake']);
    assert.equal(reply.showcaseSlots, 1);
    assert.match((await ana.ask({ type: 'shadow:showcase', itemIds: ['title-broker-mistake', 'relic-fastest-hand'] }, 'too many')).message, /slots/);
    reply = await ana.ask({ type: 'shadow:buy', itemId: 'showcase-slots' }, 'slot 2');
    assert.equal(reply.showcaseSlots, 2);
    reply = await ana.ask({ type: 'shadow:buy', itemId: 'card-gilded' }, 'card');
    assert.equal(reply.equipped.card, 'card-gilded');

    // Dossier: Bo and the GM can read Ana's public dossier.
    from = bo.mark();
    bo.send({ type: 'shadow:dossier', playerId: anaId });
    const dossier = (await bo.next(m => m.type === 'shadow:dossierResult', 'dossier', from)).dossier;
    assert.equal(dossier.name, 'Ana');
    assert.equal(dossier.card, 'card-gilded');
    assert.deepEqual(dossier.showcase.map(r => r.id), ['title-broker-mistake']);
    assert.equal(dossier.cosmetics.sigil, 'sigil-crown');
    assert.equal(typeof dossier.stats.columnSolutions, 'number');
    assert.ok(!('shadowCoins' in dossier) && !('ledger' in dossier), 'dossier stays public-only');
    from = gm.mark();
    gm.send({ type: 'shadow:dossier', playerId: anaId });
    assert.equal((await gm.next(m => m.type === 'shadow:dossierResult', 'gm dossier', from)).dossier.name, 'Ana');
    from = bo.mark();
    bo.send({ type: 'shadow:dossier', playerId: 'nobody' });
    assert.equal((await bo.next(m => m.type === 'shadow:error', 'missing dossier', from)).message, 'No dossier on file');

    // Restart: inventory, equips and balance persist.
    const finalBalance = reply.balance;
    clients.forEach(c => c.close());
    clients.length = 0;
    await stop(server);
    server = spawnServer();
    await healthy();
    const gm2 = await openGm();
    ana = await connect('Ana');
    reply = await ana.ask({ type: 'shadow:state' }, 'after restart');
    assert.equal(reply.balance, finalBalance);
    assert.equal(reply.equipped.effect, 'fx-hearts');
    assert.equal(reply.catalog.find(i => i.id === 'cmd-smite').tier, 1);
    await sleep(200);
    assert.equal(gm2.players.find(p => p.id === anaId).cosmetics.effect, 'fx-hearts');
    assert.equal(reply.catalog.find(i => i.id === 'fx-void-eye').tier, 2, 'owned tiers survive switching effects');

    // The GM (Shadow Broker) has no Shadow Coin account.
    assert.equal((await gm2.ask({ type: 'shadow:state' }, 'gm state')).type, 'shadow:error');

    assert.equal(server.errors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(c => c.close());
    server.kill();
    await sleep(250);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

(async () => {
  checkPure();
  checkStore();
  await runServer();
  console.log('PASS Shadow Coin economy V1: ledger on every change, atomic single-shot purchases, tiers, achievement gates, relics unbuyable, equip/unequip broadcast, locked/owned premium /commands with cooldown, Shadow Roulette 0-12 limits/confirmation/payouts, persistence across restart, gameplay untouched');
})().catch(error => {
  console.error('FAIL Shadow Coin economy:', error);
  process.exit(1);
});
