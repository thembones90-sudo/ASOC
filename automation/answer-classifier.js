'use strict';

const { normalizeAnswer, tokens } = require('./answer-normalize');
const TARGETS = Object.freeze(['A', 'B', 'C', 'D', 'FINAL']);

function explicitTarget(raw) {
  const text = String(raw || '').trim();
  let match = text.match(/^([a-d])\s*(?:5|kolona|column)?\s*[:=\-]\s*(.+)$/iu);
  if (match) return { target: match[1].toUpperCase(), answer: match[2].trim() };
  match = text.match(/^(?:final|finalno|konačno|konacno|rešenje|resenje)\s*[:=\-]\s*(.+)$/iu);
  if (match) return { target: 'FINAL', answer: match[1].trim() };
  match = text.match(/^([a-d])5\s+(.+)$/iu);
  return match ? { target: match[1].toUpperCase(), answer: match[2].trim() } : null;
}

function eligibleMessage(message, context = {}) {
  if (!message || typeof message.text !== 'string') return { ok: false, reason: 'NO_TEXT' };
  if (message.deleted === true) return { ok: false, reason: 'DELETED' };
  if (message.source) return { ok: false, reason: 'NON_PLAYER_SOURCE' };
  if (message.verdict !== null && message.verdict !== undefined) return { ok: false, reason: 'ALREADY_JUDGED' };
  if (context.roomMode && context.roomMode !== 'battle') return { ok: false, reason: 'NOT_BATTLE' };
  if (context.boardId && message.boardId !== context.boardId) return { ok: false, reason: 'STALE_BOARD' };
  const text = message.text.trim();
  if (!text) return { ok: false, reason: 'EMPTY' };
  if (text.startsWith('/')) return { ok: false, reason: 'COMMAND' };
  if (/^(?:https?:\/\/|www\.)/i.test(text)) return { ok: false, reason: 'LINK' };
  return { ok: true };
}

function classifyMessage(message, context = {}) {
  const eligibility = eligibleMessage(message, context);
  if (!eligibility.ok) return { kind: 'IGNORE', reason: eligibility.reason };
  const raw = message.text.trim();
  const explicit = explicitTarget(raw);
  if (explicit) return normalizeAnswer(explicit.answer)
    ? { kind: 'ANSWER', target: explicit.target, answer: explicit.answer, explicit: true, confidence: 1 }
    : { kind: 'IGNORE', reason: 'EMPTY_ANSWER' };
  if (/^(?:re|odgovor|reply)\s*:/iu.test(raw) || /^[@>]/.test(raw)) return { kind: 'IGNORE', reason: 'REPLY_OR_MENTION' };
  if (/[?？]$/.test(raw)) return { kind: 'IGNORE', reason: 'QUESTION' };
  const wordList = tokens(raw);
  if (!wordList.length) return { kind: 'IGNORE', reason: 'EMPTY' };
  if (wordList.length > 7 || raw.length > 100) return { kind: 'IGNORE', reason: 'CONVERSATIONAL_LENGTH' };
  const unresolved = (Array.isArray(context.unresolvedTargets) ? context.unresolvedTargets : TARGETS).filter(target => TARGETS.includes(target));
  if (!unresolved.length) return { kind: 'IGNORE', reason: 'NO_OPEN_TARGETS' };
  if (unresolved.length === 1) return { kind: 'ANSWER', target: unresolved[0], answer: raw, explicit: false, confidence: .82 };
  return { kind: 'POSSIBLE_ANSWER', answer: raw, candidateTargets: unresolved, explicit: false, confidence: .45 };
}

module.exports = { TARGETS, explicitTarget, eligibleMessage, classifyMessage };
