'use strict';

const crypto = require('crypto');

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SPIN_MS = 4200;
const OUTCOMES = Object.freeze([
  '+1 ASOC GAME',
  'BLOOD TRIBUTE',
  'FUCK OFF'
]);

function normalizeState(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const cooldownUntil = Number(source.cooldownUntil) || 0;
  const pending = source.pendingSpin && typeof source.pendingSpin === 'object'
    ? source.pendingSpin
    : null;
  const pendingSpin = pending && OUTCOMES.includes(pending.outcome) &&
    typeof pending.token === 'string' && typeof pending.playerId === 'string'
    ? {
        token: pending.token,
        playerId: pending.playerId,
        playerName: String(pending.playerName || 'LITTLE HERO').slice(0, 40),
        outcome: pending.outcome,
        acceptedAt: Number(pending.acceptedAt) || 0,
        resolvesAt: Number(pending.resolvesAt) || 0,
        isTestPersona: pending.isTestPersona === true
      }
    : null;
  return { cooldownUntil: Math.max(0, cooldownUntil), pendingSpin };
}

function chooseOutcome(randomInt = crypto.randomInt) {
  return OUTCOMES[randomInt(0, OUTCOMES.length)];
}

function tryStart(state, target, roomMode, now = Date.now(), randomInt = crypto.randomInt) {
  if (roomMode !== 'CASUAL') return { accepted: false, reason: 'CASUAL_ONLY' };
  if (!target || typeof target.id !== 'string' || !target.id) {
    return { accepted: false, reason: 'CONNECTED_PLAYER_REQUIRED' };
  }
  if (state.pendingSpin || Number(state.cooldownUntil) > now) {
    return { accepted: false, reason: 'COOLDOWN', cooldownUntil: Number(state.cooldownUntil) || 0 };
  }

  const pendingSpin = {
    token: 'concoction-' + crypto.randomBytes(8).toString('hex'),
    playerId: target.id,
    playerName: String(target.name || 'LITTLE HERO').slice(0, 40),
    outcome: chooseOutcome(randomInt),
    acceptedAt: now,
    resolvesAt: now + SPIN_MS,
    isTestPersona: target.isTestPersona === true
  };
  state.cooldownUntil = now + COOLDOWN_MS;
  state.pendingSpin = pendingSpin;
  return { accepted: true, pendingSpin, cooldownUntil: state.cooldownUntil };
}

function publicState(state) {
  const normalized = normalizeState(state);
  const spin = normalized.pendingSpin;
  return {
    cooldownUntil: normalized.cooldownUntil,
    spinning: !!spin,
    ...(spin ? {
      spinToken: spin.token,
      playerId: spin.playerId,
      playerName: spin.playerName,
      acceptedAt: spin.acceptedAt,
      resolvesAt: spin.resolvesAt
    } : {})
  };
}

module.exports = { COOLDOWN_MS, SPIN_MS, OUTCOMES, normalizeState, chooseOutcome, tryStart, publicState };
