'use strict';

const DECISIONS = Object.freeze(['ACCEPT', 'REJECT', 'ESCALATE']);
const TARGETS = Object.freeze(['A', 'B', 'C', 'D', 'FINAL']);
const ACTIONS = Object.freeze(['APPLY_CORRECT_VERDICT', 'APPLY_WRONG_VERDICT', 'QUEUE_GM_REVIEW']);
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function validateAdjudicationResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'RESULT_NOT_OBJECT' };
  const value = {
    submissionId: clean(raw.submissionId, 120), playerId: clean(raw.playerId, 120),
    target: clean(raw.target, 12).toUpperCase(), decision: clean(raw.decision, 20).toUpperCase(),
    confidence: Number(raw.confidence), reasoningSummary: clean(raw.reasoningSummary, 280),
    proposedAction: clean(raw.proposedAction, 40).toUpperCase()
  };
  if (!value.submissionId || !value.playerId) return { ok: false, error: 'MISSING_IDENTITY' };
  if (!DECISIONS.includes(value.decision)) return { ok: false, error: 'INVALID_DECISION' };
  if (!TARGETS.includes(value.target)) return { ok: false, error: 'INVALID_TARGET' };
  if (!ACTIONS.includes(value.proposedAction)) return { ok: false, error: 'INVALID_ACTION' };
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return { ok: false, error: 'INVALID_CONFIDENCE' };
  const expected = value.decision === 'ACCEPT' ? 'APPLY_CORRECT_VERDICT' : value.decision === 'REJECT' ? 'APPLY_WRONG_VERDICT' : 'QUEUE_GM_REVIEW';
  if (value.proposedAction !== expected) return { ok: false, error: 'ACTION_DECISION_MISMATCH' };
  return { ok: true, value };
}

module.exports = { DECISIONS, TARGETS, ACTIONS, validateAdjudicationResult };
