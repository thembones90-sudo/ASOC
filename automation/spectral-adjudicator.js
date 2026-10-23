'use strict';

const { classifyMessage } = require('./answer-classifier');
const { normalizeAnswer, levenshtein } = require('./answer-normalize');
const NAME = 'SPECTRA';
const AVATAR = '/assets/profiles/spectra-warden.png?v=20261023';
const FRAME = '#9B5DE0';
const MODES = Object.freeze(['MANUAL', 'ASSISTED', 'AUTONOMOUS']);

function normalizeState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return { mode: MODES.includes(state.mode) ? state.mode : 'MANUAL', paused: state.paused === true,
    scheduleDisabled: state.scheduleDisabled === true,
    scheduleArmed: state.scheduleDisabled !== true && (state.scheduleArmed === true || state.mode === 'AUTONOMOUS'),
    lastScheduledDate: /^\d{4}-\d{2}-\d{2}$/.test(String(state.lastScheduledDate || '')) ? state.lastScheduledDate : null,
    launchScheduledAt: Number(state.launchScheduledAt) || null,
    scheduleStatus: ['SUMMONING', 'STARTED', 'CANCELLED', 'SKIPPED'].includes(state.scheduleStatus) ? state.scheduleStatus : null,
    scheduleBoardId: typeof state.scheduleBoardId === 'string' ? state.scheduleBoardId : null,
    pending: Array.isArray(state.pending) ? state.pending.slice(-100) : [],
    history: Array.isArray(state.history) ? state.history.slice(-100) : [] };
}

function suffixRelated(answer, solution) {
  const a = normalizeAnswer(answer), s = normalizeAnswer(solution);
  if (!a || !s) return false;
  return ['ful', 'less', 'ness', 'ly', 'ing', 'ed', 'er', 'est', 's'].some(x => a === `${s}${x}` || s === `${a}${x}`);
}

// Review cards are work for the current live board, never historical verdicts.
function actionablePending(pending, { active, boardId, messages, closedTargets = [] }) {
  if (!active) return [];
  const byId = new Map((messages || []).map(message => [message.id, message]));
  const seen = new Set();
  return (pending || []).filter(entry => {
    const message = byId.get(entry?.messageId);
    if (!message || seen.has(message.id) || message.source || message.deleted || message.verdict || message.boardId !== boardId || closedTargets.includes(entry.target)) return false;
    seen.add(message.id);
    return true;
  });
}

function inspect(message, context = {}) {
  const result = classifyMessage(message, context);
  if (result.kind !== 'ANSWER') return result;
  if (result.ambiguous) return { ...result, decision: 'ESCALATE', reason: 'AMBIGUOUS_TARGET' };
  const solution = context.solutions && context.solutions[result.target];
  if (!solution) return { ...result, decision: 'ESCALATE', reason: 'NO_SOLUTION' };
  // Automatic mode may award only an exact match for the explicitly named
  // target. Assisted/unknown modes and uncertain matches still consult the GM.
  if (normalizeAnswer(result.answer) === normalizeAnswer(solution)) return {
    ...result, decision: context.mode === 'AUTONOMOUS' ? 'ACCEPT' : 'ESCALATE', reason: 'EXACT'
  };
  if (suffixRelated(result.answer, solution)) return { ...result, decision: 'ESCALATE', reason: 'DERIVATIONAL' };
  if (levenshtein(normalizeAnswer(result.answer), normalizeAnswer(solution), 1) <= 1) return { ...result, decision: 'ESCALATE', reason: 'POSSIBLE_TYPO' };
  return { ...result, decision: 'REJECT', reason: 'CLEAR_MISMATCH' };
}

function publicState(value) { const s = normalizeState(value); return { name: NAME, mode: s.mode, paused: s.paused, scheduleArmed: s.scheduleArmed, nextRitualTime: '12:55 Europe/Belgrade', startTime: '13:00 Europe/Belgrade', signupDeadline: '13:05 Europe/Belgrade', scheduleStatus: s.scheduleStatus, pending: s.pending }; }
module.exports = { NAME, AVATAR, FRAME, MODES, normalizeState, inspect, publicState, actionablePending };
