'use strict';

// CHAOS -- the Shadow Broker's wager. A targeted Little Hero is offered a roll:
// reach the target and win Shadow Coins, fall short and owe a Blood Tribute.
// Pure state machine: no sockets, no clock reads, no storage. Callers pass `now`.
//
// State lives on room.chaos.entries, keyed by player id, one entry per player:
//   offered  the offer is on the table (OFFER_MS, then it lapses as a decline)
//   rolling  accepted; a plain /roll is now the only way forward (ROLL_MS, then forfeit)
//   owes     the roll fell short; a Blood Tribute is owed (a natural 1 owes a DARK one)
//   judging  a tribute image is with the Shadow Broker
// Wins and declines leave no entry behind; the chat card is their record.
// A natural 100 always wins and pays DOUBLE. A natural 1 always loses and the tribute is DARK.

const OFFER_MS = 30000;
const ROLL_MS = 60000;
const MIN_ROLL_TARGET = 2;
const MAX_ROLL_TARGET = 100;
const MIN_COINS = 0.1;
const MAX_COINS = 100;
const MAX_TARGETS = 60;
const PERFECT_ROLL = 100;
const CRITICAL_FAIL_ROLL = 1;

const round1 = value => Math.round(value * 10) / 10;

function ensure(room) {
  if (!room.chaos || typeof room.chaos !== 'object' || Array.isArray(room.chaos)) room.chaos = {};
  if (!room.chaos.entries || typeof room.chaos.entries !== 'object' || Array.isArray(room.chaos.entries)) room.chaos.entries = {};
  room.chaos.seq = Number(room.chaos.seq) || 0;
  return room.chaos;
}

function entryFor(room, playerId) {
  return ensure(room).entries[String(playerId)] || null;
}

function parseStake(rawTarget, rawCoins) {
  const target = Number(rawTarget);
  const coins = Number(rawCoins);
  if (!Number.isInteger(target) || target < MIN_ROLL_TARGET || target > MAX_ROLL_TARGET) {
    return { error: `ROLL TARGET MUST BE A WHOLE NUMBER FROM ${MIN_ROLL_TARGET} TO ${MAX_ROLL_TARGET}` };
  }
  if (!Number.isFinite(coins) || coins < MIN_COINS || coins > MAX_COINS) {
    return { error: `SHADOW COINS MUST BE FROM ${MIN_COINS} TO ${MAX_COINS}` };
  }
  return { target, coins: round1(coins) };
}

// Offer the wager to each player. Anyone who already has a chaos entry is skipped, not stacked.
function cast(room, players, stake, now, castBy = 'SHADOW BROKER') {
  const state = ensure(room);
  const parsed = parseStake(stake?.target, stake?.coins);
  if (parsed.error) return { ok: false, error: parsed.error };
  const list = Array.isArray(players) ? players.filter(p => p && p.id !== undefined && p.id !== null && String(p.name || '').trim()) : [];
  if (!list.length) return { ok: false, error: 'CHAOS NEEDS AT LEAST ONE TARGET' };
  if (list.length > MAX_TARGETS) return { ok: false, error: `CHAOS TARGETS AT MOST ${MAX_TARGETS} HEROES AT ONCE` };
  state.seq += 1;
  const chaosId = 'chaos-' + now.toString(36) + '-' + state.seq;
  const created = [];
  const skipped = [];
  const seen = new Set();
  list.forEach((player, index) => {
    const id = String(player.id);
    if (seen.has(id)) return;
    seen.add(id);
    const name = String(player.name).trim();
    if (state.entries[id]) {
      skipped.push({ id, name, reason: state.entries[id].status === 'owes' || state.entries[id].status === 'judging' ? 'STILL OWES A BLOOD TRIBUTE' : 'ALREADY HAS A CHAOS OFFER' });
      return;
    }
    const entry = {
      id: `${chaosId}-${index}`,
      chaosId,
      playerId: id,
      playerName: name,
      target: parsed.target,
      coins: parsed.coins,
      castBy: String(castBy || 'SHADOW BROKER'),
      status: 'offered',
      offeredAt: now,
      expiresAt: now + OFFER_MS,
      rollEndsAt: null,
      roll: null,
      dark: false,
      pendingTributeId: null
    };
    state.entries[id] = entry;
    created.push(entry);
  });
  if (!created.length) return { ok: false, error: skipped.length === 1 ? `${skipped[0].name} ${skipped[0].reason}` : 'EVERY TARGET ALREADY HAS A CHAOS ENTRY', skipped };
  return { ok: true, chaosId, created, skipped };
}

function respond(room, playerId, accept, now) {
  const entry = entryFor(room, playerId);
  if (!entry || entry.status !== 'offered') return { ok: false, error: 'NO CHAOS OFFER AWAITS YOUR ANSWER' };
  if (now >= entry.expiresAt) return { ok: false, error: 'THE OFFER HAS LAPSED' };
  if (accept) {
    entry.status = 'rolling';
    entry.rollEndsAt = now + ROLL_MS;
    return { ok: true, accepted: true, entry };
  }
  delete room.chaos.entries[String(playerId)];
  return { ok: true, accepted: false, entry };
}

function isRolling(room, playerId) {
  return entryFor(room, playerId)?.status === 'rolling';
}

// A rolling player's /roll resolves the wager. Reaching the target wins; anything lower owes tribute.
// 100 pays double the stake; 1 is a critical failure and owes a DARK Blood Tribute.
function resolveRoll(room, playerId, value) {
  const entry = entryFor(room, playerId);
  if (!entry || entry.status !== 'rolling') return { ok: false, error: 'NO CHAOS ROLL IS OWED' };
  entry.roll = Number(value) || 0;
  if (entry.roll >= entry.target) {
    delete room.chaos.entries[String(playerId)];
    const perfect = entry.roll === PERFECT_ROLL;
    return { ok: true, won: true, perfect, payout: perfect ? round1(entry.coins * 2) : entry.coins, entry };
  }
  entry.status = 'owes';
  entry.rollEndsAt = null;
  entry.dark = entry.roll === CRITICAL_FAIL_ROLL;
  return { ok: true, won: false, dark: entry.dark, entry };
}

// Lapsed offers count as declines; an accepted roll left unrolled is a forfeit and owes the tribute.
function sweep(room, now) {
  const state = ensure(room);
  const events = [];
  for (const entry of Object.values(state.entries)) {
    if (entry.status === 'offered' && now >= entry.expiresAt) {
      delete state.entries[entry.playerId];
      events.push({ type: 'lapsed', entry });
    } else if (entry.status === 'rolling' && now >= entry.rollEndsAt) {
      entry.status = 'owes';
      entry.roll = 0;
      entry.rollEndsAt = null;
      events.push({ type: 'forfeit', entry });
    }
  }
  return events;
}

function submitTribute(room, playerId, tributeId) {
  const entry = entryFor(room, playerId);
  if (!entry || entry.status !== 'owes') return { ok: false, error: 'NO CHAOS TRIBUTE IS OWED' };
  entry.status = 'judging';
  entry.pendingTributeId = String(tributeId);
  return { ok: true, entry };
}

function judge(room, playerId, accepted) {
  const entry = entryFor(room, playerId);
  if (!entry || entry.status !== 'judging') return { ok: false, error: 'NO CHAOS TRIBUTE AWAITS JUDGMENT' };
  if (accepted) {
    delete room.chaos.entries[String(playerId)];
    return { ok: true, cleared: true, entry };
  }
  entry.status = 'owes';
  entry.pendingTributeId = null;
  return { ok: true, cleared: false, entry };
}

function cancel(room, playerId) {
  const entry = entryFor(room, playerId);
  if (!entry) return { ok: false, error: 'THAT HERO HAS NO CHAOS ENTRY' };
  delete room.chaos.entries[String(playerId)];
  return { ok: true, entry };
}

function publicState(room, now = Date.now()) {
  const out = {};
  for (const entry of Object.values(ensure(room).entries)) {
    out[entry.playerId] = {
      serverNow: now,
      id: entry.id,
      chaosId: entry.chaosId,
      playerId: entry.playerId,
      playerName: entry.playerName,
      target: entry.target,
      coins: entry.coins,
      status: entry.status,
      expiresAt: entry.status === 'offered' ? entry.expiresAt : null,
      rollEndsAt: entry.status === 'rolling' ? entry.rollEndsAt : null,
      roll: Number.isFinite(entry.roll) ? entry.roll : null,
      dark: entry.dark === true,
      pendingTribute: entry.status === 'judging'
    };
  }
  return out;
}

// "/chaos @Ana @Bea 50 5", "/chaos all 60 2.5": names first, then roll target, then coins.
function parseCommand(raw) {
  const match = String(raw || '').trim().match(/^\/chaos(?:\s+(.*?))?\s+(\d{1,3})\s+(\d{1,3}(?:\.\d)?)\s*$/i);
  if (!match || !String(match[1] || '').trim()) {
    return { error: 'CHAOS INVALID // USE /chaos @Name [@Name2 ...] <roll target> <coins>  OR  /chaos all <roll target> <coins>' };
  }
  const body = match[1].replace(/[​-‍﻿]/g, '').replace(/ /g, ' ').trim();
  const stake = parseStake(match[2], match[3]);
  if (stake.error) return { error: stake.error };
  if (/^(all|all online|everyone)$/i.test(body.replace(/^@+\s*/, ''))) return { all: true, names: [], ...stake };
  const names = body.split('@').map(part => part.replace(/,/g, ' ').trim()).filter(Boolean);
  if (!names.length) return { error: 'CHAOS NEEDS AT LEAST ONE @NAME OR "all"' };
  return { all: false, names, ...stake };
}

module.exports = {
  OFFER_MS, ROLL_MS, MIN_ROLL_TARGET, MAX_ROLL_TARGET, MIN_COINS, MAX_COINS, MAX_TARGETS, PERFECT_ROLL, CRITICAL_FAIL_ROLL,
  ensure, entryFor, parseStake, cast, respond, isRolling, resolveRoll, sweep, submitTribute, judge, cancel, publicState, parseCommand
};
