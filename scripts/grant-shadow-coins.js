#!/usr/bin/env node
// Deliberate, one-off administrative Shadow Coin grant.
//
//   node scripts/grant-shadow-coins.js --amount 10 --receipt admin:grant:2026-10-01:10 \
//        --created-before 2026-10-01T20:00:00+02:00 --reason "Shadow Broker gift" --yes
//
// - STOP the ASOC server first: the server caches players.json and a running
//   instance could overwrite the grant with its own next save.
// - Set ASOC_DATA_DIR to the production data directory (e.g. /data).
// - The receipt makes the grant exactly-once per account: re-running with the
//   same receipt pays nobody twice.
// - --created-before limits the grant to accounts that existed at that time.
// - Without --yes it only reports what would happen (dry run).
'use strict';

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf('--' + name);
  return index === -1 ? null : args[index + 1];
}

const amount = Number(arg('amount'));
const receipt = String(arg('receipt') || '').trim();
const createdBefore = arg('created-before');
const reason = arg('reason') || 'Shadow Broker grant';
const confirmed = args.includes('--yes');

if (!Number.isFinite(amount) || amount <= 0 || !receipt || !createdBefore) {
  console.error('Usage: node scripts/grant-shadow-coins.js --amount <SC> --receipt <unique-id> --created-before <ISO time> [--reason <text>] [--yes]');
  process.exit(2);
}

const playerStore = require('../player-store');
const players = playerStore.loadPlayers();
if (!playerStore.storageHealthy()) {
  console.error('Player storage is unhealthy; refusing to grant.');
  process.exit(1);
}
const cutoff = new Date(createdBefore).getTime();
if (!Number.isFinite(cutoff)) {
  console.error('Invalid --created-before time.');
  process.exit(2);
}
const profiles = Object.values(players).filter(p => p && p.id);
const eligible = profiles.filter(p => !p.createdAt || new Date(p.createdAt).getTime() <= cutoff);
const pending = eligible.filter(p => !(p.shadowCoinReceipts || []).includes(receipt));
console.log(`Profiles: ${profiles.length}, existing before cutoff: ${eligible.length}, not yet granted: ${pending.length}`);

if (!confirmed) {
  console.log('Dry run. Re-run with --yes to grant ' + amount + ' SC to ' + pending.length + ' profile(s).');
  process.exit(0);
}
const result = playerStore.grantAllShadowCoins(amount, receipt, { reason, createdBefore });
if (!result.ok) {
  console.error('Grant failed:', result.error);
  process.exit(1);
}
console.log(`Granted ${result.amount} SC to ${result.granted} profile(s); ${result.skipped} already had it; ${result.ineligible} created after the cutoff.`);
