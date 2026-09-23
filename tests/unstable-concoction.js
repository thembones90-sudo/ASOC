'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const concoction = require('../unstable-concoction');

const now = 1_800_000_000_000;
const target = { id: 'p1', name: 'SISSY', isTestPersona: false };

const state = concoction.normalizeState();
const first = concoction.tryStart(state, target, 'CASUAL', now, () => 0);
assert.strictEqual(first.accepted, true, 'first Casual spin should be accepted');
assert.strictEqual(first.pendingSpin.outcome, '+1 ASOC GAME');
assert.strictEqual(state.cooldownUntil, now + concoction.COOLDOWN_MS);
assert.strictEqual(concoction.COOLDOWN_MS, 24 * 60 * 60 * 1000);
assert.strictEqual(state.pendingSpin.playerId, 'p1');

const raced = concoction.tryStart(state, target, 'CASUAL', now, () => 1);
assert.strictEqual(raced.accepted, false, 'second spin must lose the race');
assert.strictEqual(raced.reason, 'COOLDOWN');

const recovered = concoction.normalizeState(JSON.parse(JSON.stringify(state)));
assert.strictEqual(recovered.cooldownUntil, state.cooldownUntil);
assert.strictEqual(recovered.pendingSpin.token, state.pendingSpin.token);
assert.strictEqual(concoction.publicState(recovered).outcome, undefined, 'public state must hide predetermined outcome');
const battleState = concoction.normalizeState();
const battle = concoction.tryStart(battleState, target, 'BATTLE', now, () => 0);
assert.strictEqual(battle.accepted, false);
assert.strictEqual(battle.reason, 'CASUAL_ONLY');

const outcomes = [0, 1, 2].map(index => {
  const s = concoction.normalizeState();
  return concoction.tryStart(s, target, 'CASUAL', now, () => index).pendingSpin.outcome;
});
assert.deepStrictEqual(outcomes, ['+1 ASOC GAME', 'BLOOD TRIBUTE', 'FUCK OFF']);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-concoction-'));
process.env.ASOC_DATA_DIR = tmp;
process.env.ASOC_PLAYERS_FILE = path.join(tmp, 'players.json');
delete require.cache[require.resolve('../player-store')];
const playerStore = require('../player-store');
playerStore.getOrCreateProfile({ id: 'p1', name: 'SISSY' });
playerStore.adjustProfile({ id: 'p1', name: 'SISSY' }, { statDeltas: { asocGamesEarned: 1 } });
delete require.cache[require.resolve('../player-store')];
const reloadedStore = require('../player-store');
const profile = reloadedStore.loadPlayers().p1;
assert.strictEqual(profile.asocGamesEarned, 1, '+1 ASOC GAME reward must persist');
fs.rmSync(tmp, { recursive: true, force: true });

console.log('PASS unstable concoction cooldown, race lock, outcomes, Casual-only gate and persistent reward');
