'use strict';

const { classifyMessage } = require('./answer-classifier');
const { compareDeterministic } = require('./answer-normalize');
const { validateAdjudicationResult } = require('./adjudication-schema');

function solutionEntries(board = {}, unresolvedTargets = []) {
  const allowed = new Set(unresolvedTargets);
  const entries = ['A', 'B', 'C', 'D'].map(target => ({ target, solution: board.columns?.[target]?.solution || '' }));
  entries.push({ target: 'FINAL', solution: board.finalSolution || '' });
  return entries.filter(entry => allowed.has(entry.target) && String(entry.solution).trim());
}

function resultFor(message, target, decision, confidence, proposedAction, reasoningSummary) {
  return validateAdjudicationResult({ submissionId: String(message.id || ''), playerId: String(message.playerId || ''), target, decision, confidence, proposedAction, reasoningSummary });
}

function adjudicateDeterministic(message, context = {}) {
  const classification = classifyMessage(message, context);
  if (classification.kind === 'IGNORE') return { stage: 'CLASSIFICATION', classification, result: null };
  const entries = solutionEntries(context.board, context.unresolvedTargets || []);
  const candidates = classification.target ? entries.filter(entry => entry.target === classification.target)
    : entries.filter(entry => (classification.candidateTargets || []).includes(entry.target));
  if (!candidates.length) return { stage: 'STATE_VALIDATION', classification, result: null, error: 'NO_LEGAL_TARGET' };
  const comparisons = candidates.map(entry => ({ entry, comparison: compareDeterministic(classification.answer, entry.solution) }));
  const matches = comparisons.filter(item => item.comparison.exact || item.comparison.diacriticEquivalent);
  if (matches.length === 1) return { stage: 'EXACT_VALIDATION', classification, result: resultFor(message, matches[0].entry.target, 'ACCEPT', matches[0].comparison.exact ? 1 : .99, 'APPLY_CORRECT_VERDICT', matches[0].comparison.exact ? 'Deterministic normalized exact match.' : 'Deterministic Serbian diacritic-equivalent match.') };
  if (matches.length > 1) return { stage: 'EXACT_VALIDATION', classification, result: resultFor(message, matches[0].entry.target, 'ESCALATE', .5, 'QUEUE_GM_REVIEW', 'Submission exactly matches more than one unresolved target.') };
  const typoCandidates = comparisons.filter(item => item.comparison.typoDistance !== null);
  const target = classification.target || typoCandidates[0]?.entry.target || candidates[0].target;
  return {
    stage: 'SEMANTIC_REQUIRED', classification,
    semanticContext: { targetCandidates: candidates.map(candidate => candidate.target), typoCandidateTargets: typoCandidates.map(candidate => candidate.entry.target) },
    result: resultFor(message, target, 'ESCALATE', typoCandidates.length === 1 ? .72 : .35, 'QUEUE_GM_REVIEW', typoCandidates.length === 1 ? 'Close typographical candidate requires semantic or GM validation.' : 'No deterministic exact match; semantic validation required.')
  };
}

module.exports = { solutionEntries, adjudicateDeterministic };
