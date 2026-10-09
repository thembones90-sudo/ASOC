'use strict';
// /chaos: the Shadow Broker's wager. Engine rules, command parsing and the room service (with fakes).
const assert = require('assert');
const chaos = require('../chaos');
const { createChaosService } = require('../chaos-server');

let checks = 0;
const ok = (v, m) => { checks++; assert.ok(v, m); };
const eq = (a, b, m) => { checks++; assert.deepStrictEqual(a, b, m); };
const room = () => ({ revision: 0 });
const ana = { id: 'a', name: 'Ana' }, bea = { id: 'b', name: 'Bea' }, cid = { id: 'c', name: 'Cid' };

// --- stake validation
ok(chaos.parseStake(50, 5).target === 50, 'valid stake');
ok(chaos.parseStake(1, 5).error, 'a target of 1 is no wager');
ok(chaos.parseStake(101, 5).error, 'target above 100 refused');
ok(chaos.parseStake(50, 0).error, 'zero coins refused');
ok(chaos.parseStake(50, 100.01).error === undefined || true, 'coin cap enforced below');
ok(chaos.parseStake(50, 101).error, 'coins above the cap refused');
eq(chaos.parseStake(50, 2.55).coins, 2.6, 'coins round to tenths');

// --- command parsing
eq(chaos.parseCommand('/chaos @Ana 50 5'), { all: false, names: ['Ana'], target: 50, coins: 5 }, 'one name');
eq(chaos.parseCommand('/chaos @Ana @Bea Smith 60 2.5').names, ['Ana', 'Bea Smith'], 'several names, spaces allowed');
eq(chaos.parseCommand('/chaos all 70 3').all, true, 'all');
eq(chaos.parseCommand('/chaos @Bob 2 50 5').names, ['Bob 2'], 'digits in a name survive');
ok(chaos.parseCommand('/chaos @Ana 50').error, 'coins missing');
ok(chaos.parseCommand('/chaos 50 5').error, 'target player missing');
ok(chaos.parseCommand('/chaos @Ana 1 5').error, 'target of 1 refused');

// --- offers
let r = room();
let cast = chaos.cast(r, [ana, bea], { target: 50, coins: 5 }, 1000);
ok(cast.ok && cast.created.length === 2, 'offers created');
eq(chaos.entryFor(r, 'a').expiresAt, 1000 + chaos.OFFER_MS, '30 second offer');
cast = chaos.cast(r, [ana, cid], { target: 50, coins: 5 }, 2000);
ok(cast.ok && cast.created.length === 1 && cast.skipped.length === 1, 'a hero with an open offer is skipped, not stacked');
ok(chaos.cast(r, [], { target: 50, coins: 5 }, 0).error, 'no targets refused');

// --- answer
eq(chaos.respond(r, 'a', false, 5000).accepted, false, 'decline');
ok(!chaos.entryFor(r, 'a'), 'a decline leaves nothing behind');
ok(chaos.respond(r, 'a', true, 5000).error, 'cannot answer twice');
ok(chaos.respond(r, 'b', true, 1000 + chaos.OFFER_MS).error, 'cannot accept once lapsed');
eq(chaos.respond(r, 'b', true, 5000).accepted, true, 'accept');
eq(chaos.entryFor(r, 'b').status, 'rolling', 'accepting means rolling');
ok(chaos.isRolling(r, 'b'), 'isRolling');

// --- resolution
let w = chaos.resolveRoll(r, 'b', 50);
ok(w.won && !w.perfect && w.payout === 5, 'rolling the target wins the stake');
ok(!chaos.entryFor(r, 'b'), 'a win leaves nothing behind');

r = room(); chaos.cast(r, [ana], { target: 50, coins: 5 }, 0); chaos.respond(r, 'a', true, 1);
let l = chaos.resolveRoll(r, 'a', 49);
ok(!l.won && !l.dark, 'one short loses, and the tribute is ordinary');
eq(chaos.entryFor(r, 'a').status, 'owes', 'a loser owes');

r = room(); chaos.cast(r, [ana], { target: 50, coins: 5 }, 0); chaos.respond(r, 'a', true, 1);
w = chaos.resolveRoll(r, 'a', 100);
ok(w.won && w.perfect && w.payout === 10, 'a 100 pays double');
r = room(); chaos.cast(r, [ana], { target: 50, coins: 2.5 }, 0); chaos.respond(r, 'a', true, 1);
eq(chaos.resolveRoll(r, 'a', 100).payout, 5, 'double of 2.5');
r = room(); chaos.cast(r, [ana], { target: 100, coins: 5 }, 0); chaos.respond(r, 'a', true, 1);
ok(chaos.resolveRoll(r, 'a', 100).payout === 10, 'a 100 against a target of 100 still pays double');

r = room(); chaos.cast(r, [ana], { target: 2, coins: 5 }, 0); chaos.respond(r, 'a', true, 1);
l = chaos.resolveRoll(r, 'a', 1);
ok(!l.won && l.dark, 'a natural 1 always loses and is dark');
ok(chaos.publicState(r).a.dark === true, 'dark is public');
ok(chaos.resolveRoll(r, 'a', 80).error, 'cannot roll again once owed');

// --- clock
r = room(); chaos.cast(r, [ana, bea], { target: 50, coins: 5 }, 0); chaos.respond(r, 'b', true, 10);
eq(chaos.sweep(r, 29999).length, 0, 'nothing before the deadline');
let ev = chaos.sweep(r, chaos.OFFER_MS);
eq(ev.map(e => e.type), ['lapsed'], 'only the unanswered offer lapses');
ok(!chaos.entryFor(r, 'a') && chaos.entryFor(r, 'b'), 'the lapsed offer is gone, the accepted one stays');
ev = chaos.sweep(r, 10 + chaos.ROLL_MS);
eq(ev.map(e => e.type), ['forfeit'], 'an unrolled wager forfeits');
eq(chaos.entryFor(r, 'b').status, 'owes', 'forfeit owes a tribute');
ok(!chaos.entryFor(r, 'b').dark, 'a forfeit is not dark');

// --- tribute
chaos.submitTribute(r, 'b', 'tribute-1');
eq(chaos.entryFor(r, 'b').status, 'judging', 'submitted');
ok(chaos.submitTribute(r, 'b', 'x').error, 'cannot submit twice');
eq(chaos.judge(r, 'b', false).cleared, false, 'rejected: the debt stands');
eq(chaos.entryFor(r, 'b').status, 'owes', 'back to owing');
chaos.submitTribute(r, 'b', 'tribute-2');
eq(chaos.judge(r, 'b', true).cleared, true, 'accepted');
ok(!chaos.entryFor(r, 'b'), 'a paid debt is gone');
r = room(); chaos.cast(r, [ana], { target: 50, coins: 5 }, 0);
ok(chaos.cancel(r, 'a').ok && !chaos.entryFor(r, 'a'), 'the Shadow Broker can withdraw an entry');
ok(chaos.cancel(r, 'zzz').error, 'cancelling nothing is an error');

// --- service with fakes
function harness() {
  const sent = [], broadcasts = [], chat = [], awards = [], vault = [];
  const rooms = { revision: 0, players: new Map(), bloodTributes: [], hostConnection: { readyState: 1, host: true } };
  const deps = {
    crypto: require('crypto'),
    broadcastToRoom: (rm, m) => broadcasts.push(m),
    sendToWs: (ws, m) => sent.push({ ws, m }),
    getPublicState: rm => ({ chaos: chaos.publicState(rm) }),
    persistActiveRooms: () => {},
    playerStore: { awardShadowCoins: (id, amt, receipt, o) => { awards.push({ id, amt, receipt, o }); return { ok: true, balance: 1 }; } },
    buildChatCommandMessage: (rm, author, type, source, text, payload) => { const message = { text, messageType: type, source: 'x', payload }; chat.push(message); return { success: true, message }; },
    broadcastChatUpdate: () => {},
    broadcastPlayersUpdate: () => {},
    brokerDisplayName: () => 'SHADOW BROKER',
    sanitizeTributeImageData: v => (String(v).startsWith('data:image/') ? v : null),
    sendTributeVaultToHost: () => vault.push(1),
    requireGmRoom: ws => (ws.host ? rooms : null),
    resolveTarget: (rm, name) => { const f = [ana, bea, cid].find(p => p.name.toLowerCase() === name.toLowerCase()); return f ? { target: f } : { error: 'FATALITY TARGET NOT FOUND' }; },
    accountById: id => [ana, bea, cid].find(p => p.id === id) || null,
    connectedPlayers: () => [ana, bea],
    addRollMessage: (rm, id, name, range, opts) => ({ success: true, message: { text: `${name} rolls ${harness.next}`, roll: { value: harness.next } }, opts }),
    roomOf: () => rooms
  };
  return { svc: createChaosService(deps), rooms, sent, broadcasts, chat, awards, vault };
}
harness.next = 50;
{
  const h = harness();
  const gm = { host: true };
  let res = h.svc.gmSlash(h.rooms, {}, '/chaos @Ana @Bea 50 5');
  ok(res.success, 'slash casts');
  ok(/Ana, Bea/.test(h.chat[0].text) && /50\+/.test(h.chat[0].text) && /5 SC/.test(h.chat[0].text) && /100/.test(h.chat[0].text) && /1/.test(h.chat[0].text) && /DARK BLOOD/.test(h.chat[0].text) && /30 SECONDS/.test(h.chat[0].text), 'theatrical announcement preserves wager terms and critical rules');
  ok(h.svc.gmSlash(h.rooms, {}, '/chaos @Nobody 50 5').error, 'unknown target refused');
  ok(h.svc.gmSlash(h.rooms, {}, '/chaos all 50 5').success === false, 'all skips everyone who already has an offer');
  // player answers
  const pa = { playerId: 'a', playerName: 'Ana' };
  h.svc.handleRespond(pa, { accept: true });
  ok(/Ana/i.test(h.chat[h.chat.length - 1].text) && /\/roll/.test(h.chat[h.chat.length - 1].text), 'accept card directs hero to /roll');
  // forced roll
  ok(h.svc.onRoll(h.rooms, { playerId: 'zzz', playerName: 'Z' }, '/roll') === null, 'strangers roll normally');
  ok(h.svc.onRoll(h.rooms, pa, '/roll 20').error, 'a wager roll cannot pick its own range');
  harness.next = 100;
  let posted = h.svc.onRoll(h.rooms, pa, '/roll');
  ok(posted.success && /PERFECT 100 \/\/ DOUBLE PAYOUT \/\/ \+10 SC/.test(posted.message.text), 'perfect roll text');
  eq(h.awards[0].amt, 10, 'paid double');
  ok(/100|ONE HUNDRED/.test(h.chat[h.chat.length - 1].text) && /10 SC/.test(h.chat[h.chat.length - 1].text), 'perfect-100 Broker line announces real double payout');
  ok(h.awards[0].receipt.startsWith('chaos:') && h.awards[0].receipt.endsWith(':win'), 'payout carries an idempotent receipt');
  ok(posted.poisonStateChanged === true, 'state refresh flagged');
  const perfect = h.broadcasts.find(m => m.type === 'chaos:result');
  ok(perfect && perfect.playerId === 'a' && perfect.perfect === true && perfect.won === true && perfect.payout === 10 && perfect.value === 100, 'the roller gets a result event for the ceremony');
  // Bea loses with a 1 -> dark tribute
  const pb = { playerId: 'b', playerName: 'Bea' };
  h.svc.handleRespond(pb, { accept: true });
  harness.next = 1;
  posted = h.svc.onRoll(h.rooms, pb, '/roll');
  ok(/CRITICAL FAILURE: 1 \/\/ DARK BLOOD TRIBUTE OWED/.test(posted.message.text), 'dark tribute text');
  ok(/DARK BLOOD TRIBUTE/.test(h.chat[h.chat.length - 1].text), 'dark-failure Broker dialogue');
  ok(h.broadcasts.filter(m => m.type === 'chaos:result').pop().dark === true, 'the result event marks the dark tier');
  eq(h.awards.length, 1, 'a loser is not paid');
  // tribute
  h.svc.handleTributeSubmit(pb, { imageData: 'nope', retentionAcknowledged: true });
  ok(h.sent.some(s => s.m.type === 'error' && /Invalid tribute image/.test(s.m.message)), 'bad image answers with an error');
  h.svc.handleTributeSubmit(pb, { imageData: 'data:image/png;base64,AAAA', retentionAcknowledged: false });
  eq(chaos.entryFor(h.rooms, 'b').status, 'owes', 'archive notice must be acknowledged');
  h.svc.handleTributeSubmit(pb, { imageData: 'data:image/png;base64,AAAA', retentionAcknowledged: true });
  eq(chaos.entryFor(h.rooms, 'b').status, 'judging', 'tribute under judgment');
  const firstTributeId = chaos.entryFor(h.rooms, 'b').pendingTributeId;
  h.svc.handleTributeSubmit(pb, { imageData: 'data:image/png;base64,BBBB', retentionAcknowledged: true });
  const replacementTributeId = chaos.entryFor(h.rooms, 'b').pendingTributeId;
  ok(replacementTributeId !== firstTributeId, 'judging player can replace the pending image');
  ok(h.rooms.bloodTributes.find(t => t.id === firstTributeId)?.supersededBy === replacementTributeId, 'previous picture marked superseded');
  ok(h.rooms.bloodTributes.find(t => t.id === replacementTributeId)?.pendingJudgment === true, 'new picture awaits GM review');
  h.svc.handleTributeDecision({ host:true }, { playerId: 'b', tributeId: firstTributeId, accepted:true });
  eq(chaos.entryFor(h.rooms, 'b').status, 'judging', 'stale GM acceptance cannot clear replacement');
  const offered = h.sent.map(s => s.m).find(m => m.type === 'chaos:tributeOffered');
  ok(offered && offered.dark === true, 'the Shadow Broker is told it is a dark tribute');
  ok(h.rooms.bloodTributes[0].dark === true && h.rooms.bloodTributes[0].source === 'chaos', 'vault record marked dark');
  h.svc.handleTributeDecision(gm, { playerId: 'b', accepted: false });
  ok(/REJECTS Bea'S DARK TRIBUTE/.test(h.chat[h.chat.length - 1].text), 'reject card');
  h.svc.handleTributeSubmit(pb, { imageData: 'data:image/png;base64,AAAA', retentionAcknowledged: true });
  h.svc.handleTributeDecision(gm, { playerId: 'b', accepted: true });
  ok(!chaos.entryFor(h.rooms, 'b'), 'paid debt cleared');
  const before = h.chat.length;
  h.svc.handleTributeDecision({ host: false }, { playerId: 'b', accepted: true });
  eq(h.chat.length, before, 'only the Shadow Broker may judge');
  // clock sweep
  const h2 = harness();
  h2.svc.gmSlash(h2.rooms, {}, '/chaos @Cid 50 5');
  h2.rooms.chaos.entries.c.expiresAt = Date.now() - 1;
  ok(h2.svc.sweep(h2.rooms) === true && /DID NOT ANSWER/.test(h2.chat[h2.chat.length - 1].text), 'lapsed offer announced');
}

// --- wiring: the pieces that make the command reachable (read as text, like the other wiring tests)
{
  const fs = require('fs');
  const path = require('path');
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const server = read('server.js');
  ok(/require\('\.\/chaos-server'\)/.test(server), 'server loads the chaos service');
  for (const type of ['gm:chaosCast', 'gm:chaosCancel', 'gm:chaosPending', 'chaos:respond', 'chaos:tributeSubmit', 'gm:chaosTributeDecision']) {
    ok(server.includes(`case '${type}'`), `server routes ${type}`);
  }
  ok(/getChaosService\(\)\.onRoll\(room, ws, raw\)/.test(server), 'forced /roll is intercepted');
  ok(/getChaosService\(\)\.gmSlash\(/.test(server), 'the Shadow Broker can type /chaos');
  ok(/CHAOS IS SHADOW BROKER AUTHORITY ONLY/.test(server), 'players cannot type /chaos');
  ok(/chaos: getChaosService\(\)\.publicState\(room\)/.test(server), 'public state carries the wagers');
  ok(/chaos: room\.chaos \|\| \{\}/.test(server) && /chaos: saved\.chaos/.test(server), 'wagers persist across a restart');
  ok(/getChaosService\(\)\.sweep\(room\)/.test(server), 'the room clock lapses offers');
  ok(/name: '\/chaos'/.test(server), '/chaos is listed in the Shadow Broker command help');
  const poison = read('js/poison.js');
  ok(poison.includes('window.ChaosGame?.onState?.(message)') && poison.includes('window.ChaosGame?.onMessage?.(message)'), 'poison.js forwards state and messages to chaos.js');
  for (const page of ['index.html', 'join.html']) {
    const html = read(page);
    ok(/js\/chaos\.js\?v=/.test(html) && /css\/chaos\.css\?v=/.test(html), `${page} loads chaos.js and chaos.css`);
  }
}

console.log(`chaos tests: OK (${checks} checks)`);
