'use strict';

const crypto = require('crypto');
const MODES = Object.freeze({ FUN: 'FUN', WAGER: 'WAGER' });
const STATUSES = Object.freeze({ ACTIVE: 'ACTIVE', WON: 'WON', LOST: 'LOST', CANCELLED: 'CANCELLED' });
const MIN_WAGER = 25;
const MAX_WAGER = 250;
const WAGER_OPTIONS = Object.freeze([25, 50, 100, 250]);
const MIN_SWAPS = 3;
const MAX_SWAPS = 5;

function cleanMode(value) { const mode = String(value || '').toUpperCase(); return mode === MODES.FUN || mode === MODES.WAGER ? mode : null; }
function validateStart(input = {}) {
  const mode = cleanMode(input.mode);
  if (!mode) return { ok: false, error: 'CHOOSE FUN MODE OR SHADOW COIN MODE.' };
  if (mode === MODES.FUN) return { ok: true, mode, wager: 0 };
  const wager = Number(input.wager);
  if (!Number.isInteger(wager)) return { ok: false, error: 'WAGER MUST BE A WHOLE SHADOW COIN AMOUNT.' };
  if (wager < MIN_WAGER) return { ok: false, error: `MINIMUM WAGER IS ${MIN_WAGER} SHADOW COINS.` };
  if (wager > MAX_WAGER) return { ok: false, error: `MAXIMUM WAGER IS ${MAX_WAGER} SHADOW COINS.` };
  if (!WAGER_OPTIONS.includes(wager)) return { ok: false, error: 'CHOOSE AN APPROVED WAGER.' };
  return { ok: true, mode, wager };
}
function createShuffle(randomInt = crypto.randomInt) {
  const count = randomInt(MIN_SWAPS, MAX_SWAPS + 1), swaps = [];
  let previous = '';
  for (let i = 0; i < count; i++) {
    let a, b, key;
    do { a = randomInt(0, 3); b = randomInt(0, 2); if (b >= a) b += 1; key = [Math.min(a, b), Math.max(a, b)].join('-'); } while (key === previous);
    previous = key; swaps.push([a, b]);
  }
  return swaps;
}
function finalPosition(brainStart, shuffle) {
  let position = Number(brainStart);
  for (const pair of shuffle || []) { const a = Number(pair?.[0]), b = Number(pair?.[1]); if (position === a) position = b; else if (position === b) position = a; }
  return position;
}
function createRound({ id, playerId, roomCode, mode, wager = 0, now = Date.now(), randomInt = crypto.randomInt }) {
  const checked = validateStart({ mode, wager }); if (!checked.ok) return checked;
  const brainStart = randomInt(0, 3), shuffle = createShuffle(randomInt);
  return { ok: true, round: { id: String(id), playerId: String(playerId), roomCode: String(roomCode || 'MASTER'), mode: checked.mode, wager: checked.wager, status: STATUSES.ACTIVE, brainStart, shuffle, finalPosition: finalPosition(brainStart, shuffle), selectedPosition: null, result: null, payout: 0, createdAt: Number(now), settledAt: null } };
}
function publicRound(round) {
  if (!round || round.status !== STATUSES.ACTIVE) return null;
  return { roundId: round.id, mode: round.mode, wager: round.wager, brainStart: round.brainStart, shuffle: round.shuffle.map(pair => [...pair]), createdAt: round.createdAt };
}
function validatePick(position) { const value = Number(position); return Number.isInteger(value) && value >= 0 && value <= 2 ? { ok: true, position: value } : { ok: false, error: 'CHOOSE ONE OF THE THREE HEADS.' }; }

module.exports = { MODES, STATUSES, MIN_WAGER, MAX_WAGER, WAGER_OPTIONS, MIN_SWAPS, MAX_SWAPS, cleanMode, validateStart, createShuffle, finalPosition, createRound, publicRound, validatePick };
