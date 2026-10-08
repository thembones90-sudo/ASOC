'use strict';

const { classifyMessage } = require('./answer-classifier');
const { normalizeAnswer, levenshtein } = require('./answer-normalize');
const NAME = 'SPECTRAL ADJUDICATOR';
const MODES = Object.freeze(['MANUAL', 'ASSISTED', 'AUTONOMOUS']);

function normalizeState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return { mode: MODES.includes(state.mode) ? state.mode : 'MANUAL', paused: state.paused === true,
    scheduleArmed: state.scheduleArmed === true,
    lastScheduledDate: /^\d{4}-\d{2}-\d{2}$/.test(String(state.lastScheduledDate || '')) ? state.lastScheduledDate : null,
    launchScheduledAt: Number(state.launchScheduledAt) || null,
    pending: Array.isArray(state.pending) ? state.pending.slice(-100) : [],
    history: Array.isArray(state.history) ? state.history.slice(-100) : [] };
}

function suffixRelated(answer, solution) {
  const a = normalizeAnswer(answer), s = normalizeAnswer(solution);
  if (!a || !s) return false;
  return ['ful', 'less', 'ness', 'ly', 'ing', 'ed', 'er', 'est', 's'].some(x => a === `${s}${x}` || s === `${a}${x}`);
}

function inspect(message, context = {}) {
  const result = classifyMessage(message, context);
  if (result.kind !== 'ANSWER') return result;
  const solution = context.solutions && context.solutions[result.target];
  if (!solution) return { ...result, decision: 'ESCALATE', reason: 'NO_SOLUTION' };
  if (normalizeAnswer(result.answer) === normalizeAnswer(solution)) return { ...result, decision: 'ACCEPT', reason: 'EXACT' };
  if (suffixRelated(result.answer, solution)) return { ...result, decision: context.mode === 'AUTONOMOUS' ? 'ACCEPT' : 'ESCALATE', reason: 'DERIVATIONAL' };
  if (levenshtein(normalizeAnswer(result.answer), normalizeAnswer(solution), 1) <= 1) return { ...result, decision: 'ESCALATE', reason: 'POSSIBLE_TYPO' };
  return { ...result, decision: 'REJECT', reason: 'CLEAR_MISMATCH' };
}

function publicState(value) { const s = normalizeState(value); return { name: NAME, mode: s.mode, paused: s.paused, scheduleArmed: s.scheduleArmed, nextRitualTime: '12:55 Europe/Belgrade', pending: s.pending }; }
module.exports = { NAME, MODES, normalizeState, inspect, publicState };
