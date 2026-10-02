'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-sibicar-'));
process.env.ASOC_DATA_DIR = DATA;
const S = require('../sibicar');
const players = require('../player-store');

const ana = { id: 'sib-ana', name: 'Ana' };
const bo = { id: 'sib-bo', name: 'Bo' };
players.getOrCreateProfile(ana);
players.getOrCreateProfile(bo);
assert.equal(players.awardShadowCoins(ana, 500, 'sibicar-test-seed', { reason: 'test seed' }).ok, true);
assert.equal(players.awardShadowCoins(bo, 500, 'sibicar-test-seed-bo', { reason: 'test seed' }).ok, true);

const deterministic = S.createRound({ id: 'logic', playerId: ana.id, roomCode: 'MASTER', mode: 'WAGER', wager: 100, randomInt: (() => { const values = [1, 3, 0, 0, 0, 1, 1, 0]; return () => values.shift(); })() });
assert.equal(deterministic.ok, true);
assert.equal(S.finalPosition(deterministic.round.brainStart, deterministic.round.shuffle), deterministic.round.finalPosition, 'server derives final position from exact swaps');
assert.equal(Object.hasOwn(S.publicRound(deterministic.round), 'finalPosition'), false, 'pre-pick payload does not advertise winner');

const fun = S.createRound({ id: 'fun-1', playerId: ana.id, roomCode: 'MASTER', mode: 'FUN', randomInt: () => 0 }).round;
const beforeFun = players.getShadowCoins(ana);
assert.equal(players.createSibicarRound(ana, fun).ok, true);
assert.equal(players.getShadowCoins(ana), beforeFun, 'fun creation never changes balance');
let result = players.settleSibicarRound(ana, fun.id, fun.finalPosition);
assert.equal(result.ok, true); assert.equal(result.correct, true);
assert.equal(players.getShadowCoins(ana), beforeFun, 'fun settlement never changes balance');

function round(id, identity, wager, finalPosition) {
  return { id, playerId: identity.id, roomCode: 'MASTER', mode: 'WAGER', wager, status: 'ACTIVE', brainStart: 0, shuffle: [], finalPosition, selectedPosition: null, result: null, payout: 0, createdAt: Date.now(), settledAt: null };
}

const winning = round('win-1', ana, 100, 2);
assert.equal(players.createSibicarRound(ana, winning).ok, true);
assert.equal(players.getShadowCoins(ana), 400, 'valid wager debited exactly once');
assert.equal(players.createSibicarRound(ana, round('parallel', ana, 25, 0)).ok, false, 'second active round rejected');
assert.equal(players.settleSibicarRound(bo, winning.id, 2).ok, false, 'another player cannot settle owner round');
result = players.settleSibicarRound(ana, winning.id, 2);
assert.equal(result.correct, true); assert.equal(result.round.payout, 200); assert.equal(result.balance, 600, 'x2 total return makes net +stake');
const duplicateWin = players.settleSibicarRound(ana, winning.id, 2);
assert.equal(duplicateWin.duplicate, true); assert.equal(players.getShadowCoins(ana), 600, 'duplicate correct pick cannot duplicate payout');

const losing = round('lose-1', ana, 50, 1);
assert.equal(players.createSibicarRound(ana, losing).ok, true); assert.equal(players.getShadowCoins(ana), 550);
result = players.settleSibicarRound(ana, losing.id, 0);
assert.equal(result.correct, false); assert.equal(result.round.payout, 0); assert.equal(players.getShadowCoins(ana), 550, 'wrong guess returns nothing');
const duplicateLoss = players.settleSibicarRound(ana, losing.id, 0);
assert.equal(duplicateLoss.duplicate, true); assert.equal(players.getShadowCoins(ana), 550, 'wrong result settles once');

assert.equal(players.settleSibicarRound(ana, 'not-a-round', 0).ok, false, 'invalid round id rejected');
const active = round('invalid-pick', ana, 25, 0); assert.equal(players.createSibicarRound(ana, active).ok, true);
assert.equal(players.settleSibicarRound(ana, active.id, 3).ok, false, 'invalid head rejected');
assert.equal(players.getSibicarRound(ana).status, 'ACTIVE', 'invalid pick leaves round active');
assert.equal(players.settleSibicarRound(ana, active.id, 0).ok, true);

assert.equal(S.validateStart({ mode: 'WAGER', wager: 24 }).ok, false, 'below minimum rejected');
assert.equal(S.validateStart({ mode: 'WAGER', wager: 251 }).ok, false, 'above maximum rejected');
const poor = { id: 'sib-poor', name: 'Poor' }; players.getOrCreateProfile(poor);
assert.equal(players.createSibicarRound(poor, round('poor-1', poor, 25, 0)).error, 'NOT ENOUGH SHADOW COINS.', 'insufficient balance rejected without debit');

const restored = round('restore-1', bo, 25, 1); assert.equal(players.createSibicarRound(bo, restored).ok, true);
assert.equal(players.getSibicarRound(bo).id, restored.id, 'active round survives store reload path');
assert.equal(players.settleSibicarRound(bo, restored.id, 1).balance, 525);
assert.equal(players.settleSibicarRound(bo, restored.id, 1).balance, 525, 'reconnect/retry cannot duplicate payout');

const ledger = players.getShadowProfile(ana).shadowCoinLedger;
assert(ledger.some(entry => entry.kind === 'sibicar_wager' && entry.detail?.roundId === 'win-1'));
assert(ledger.some(entry => entry.kind === 'sibicar_win' && entry.detail?.roundId === 'win-1'));

fs.rmSync(DATA, { recursive:true, force:true });
console.log('PASS ŠIBICAR: fair shuffle, private durable rounds, atomic escrow, x2 total return, idempotent settlement');
