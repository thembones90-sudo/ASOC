'use strict';

const crypto = require('crypto');

const ACTIVE = new Set(['OFFERED', 'ACTIVE', 'CLAIMED']);
const TERMINAL = new Set(['COMPLETED', 'DECLINED', 'FAILED', 'EXPIRED', 'CANCELLED']);
const VISIBILITIES = new Set(['PRIVATE', 'CLASSIFIED', 'PUBLIC']);
const TRANSITIONS = Object.freeze({
  OFFERED: new Set(['ACTIVE', 'DECLINED', 'CANCELLED']),
  ACTIVE: new Set(['CLAIMED', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED']),
  CLAIMED: new Set(['ACTIVE', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'])
});
const HISTORY_LIMIT = 200;

function cleanText(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function normalizeQuest(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const status = ACTIVE.has(raw.status) || TERMINAL.has(raw.status) ? raw.status : 'CANCELLED';
  const visibility = VISIBILITIES.has(raw.visibility) ? raw.visibility : 'PRIVATE';
  return {
    id: String(raw.id), targetPlayerId: String(raw.targetPlayerId || ''),
    targetPlayerName: cleanText(raw.targetPlayerName, 80), issuer: 'SHADOW BROKER',
    directive: cleanText(raw.directive), rewardCoins: Number(raw.rewardCoins) || 0,
    durationMs: Number(raw.durationMs) || 0, visibility, status,
    createdAt: Number(raw.createdAt) || Date.now(), acceptedAt: Number(raw.acceptedAt) || null,
    deadline: Number(raw.deadline) || null, claimedAt: Number(raw.claimedAt) || null,
    resolvedAt: Number(raw.resolvedAt) || null,
    resolutionReason: raw.resolutionReason ? cleanText(raw.resolutionReason, 200) : null,
    rewardReceipt: raw.rewardReceipt ? String(raw.rewardReceipt) : null
  };
}

function normalizeState(raw) {
  const state = { active: {}, history: [] };
  for (const quest of Object.values(raw?.active || {})) {
    const normalized = normalizeQuest(quest);
    if (!normalized) continue;
    if (ACTIVE.has(normalized.status)) state.active[normalized.id] = normalized;
    else state.history.push(normalized);
  }
  for (const quest of Array.isArray(raw?.history) ? raw.history : []) {
    const normalized = normalizeQuest(quest);
    if (normalized && TERMINAL.has(normalized.status)) state.history.push(normalized);
  }
  state.history.sort((a, b) => (b.resolvedAt || b.createdAt) - (a.resolvedAt || a.createdAt));
  state.history = state.history.slice(0, HISTORY_LIMIT);
  return state;
}

function validateCreate(input) {
  const directive = cleanText(input?.directive);
  const rewardCoins = Number(input?.rewardCoins);
  const durationMs = Number(input?.durationMs);
  const visibility = String(input?.visibility || '').toUpperCase();
  if (!directive) return { error: 'QUEST DIRECTIVE REQUIRED' };
  if (String(input?.directive || '').trim().length > 500) return { error: 'QUEST DIRECTIVE MAXIMUM IS 500 CHARACTERS' };
  if (!Number.isFinite(rewardCoins) || rewardCoins < 0.1 || rewardCoins > 50 || Math.round(rewardCoins * 10) !== rewardCoins * 10) return { error: 'QUEST REWARD MUST BE 0.1–50 SC WITH ONE DECIMAL PLACE' };
  if (!Number.isFinite(durationMs) || durationMs < 30000 || durationMs > 86400000 || !Number.isInteger(durationMs)) return { error: 'QUEST DURATION MUST BE 30 SECONDS–24 HOURS' };
  if (!VISIBILITIES.has(visibility)) return { error: 'QUEST VISIBILITY INVALID' };
  return { directive, rewardCoins, durationMs, visibility };
}

function create(input, target, now = Date.now()) {
  const valid = validateCreate(input);
  if (valid.error) return valid;
  return { quest: {
    id: `quest-${now.toString(36)}-${crypto.randomBytes(5).toString('hex')}`,
    targetPlayerId: String(target.id), targetPlayerName: cleanText(target.name, 80), issuer: 'SHADOW BROKER',
    ...valid, status: 'OFFERED', createdAt: now, acceptedAt: null, deadline: null,
    claimedAt: null, resolvedAt: null, resolutionReason: null, rewardReceipt: null
  } };
}

function canTransition(quest, next) {
  return !!quest && !!TRANSITIONS[quest.status]?.has(next);
}

function transition(state, questId, next, now = Date.now(), reason = null) {
  const quest = state.active[String(questId || '')];
  if (!quest) return { error: 'QUEST NOT FOUND OR ALREADY RESOLVED' };
  if (!TRANSITIONS[quest.status]?.has(next)) return { error: `INVALID QUEST TRANSITION // ${quest.status} → ${next}` };
  if (next === 'ACTIVE' && quest.status === 'OFFERED') {
    quest.acceptedAt = now;
    quest.deadline = now + quest.durationMs;
  }
  if (next === 'CLAIMED') quest.claimedAt = now;
  if (next === 'ACTIVE' && quest.status === 'CLAIMED') quest.claimedAt = null;
  quest.status = next;
  if (TERMINAL.has(next)) {
    quest.resolvedAt = now;
    quest.resolutionReason = reason ? cleanText(reason, 200) : null;
    delete state.active[quest.id];
    state.history.unshift(quest);
    state.history = state.history.slice(0, HISTORY_LIMIT);
  }
  return { quest };
}

function expire(state, now = Date.now()) {
  const expired = [];
  for (const quest of Object.values(state.active)) {
    if ((quest.status === 'ACTIVE' || quest.status === 'CLAIMED') && quest.deadline && quest.deadline <= now) {
      const result = transition(state, quest.id, 'EXPIRED', now, 'TIME LIMIT EXPIRED');
      if (result.quest) expired.push(result.quest);
    }
  }
  return expired;
}

module.exports = { ACTIVE, TERMINAL, VISIBILITIES, HISTORY_LIMIT, cleanText, normalizeState, validateCreate, create, canTransition, transition, expire };
