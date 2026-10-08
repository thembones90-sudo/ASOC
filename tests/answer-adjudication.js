'use strict';

const assert = require('assert');
const { normalizeAnswer, foldSerbianLatin, levenshtein, compareDeterministic } = require('../automation/answer-normalize');
const { explicitTarget, eligibleMessage, classifyMessage } = require('../automation/answer-classifier');
const { validateAdjudicationResult } = require('../automation/adjudication-schema');
const { adjudicateDeterministic } = require('../automation/answer-adjudicator');

let checks = 0;
const eq = (actual, expected, label) => { checks++; assert.deepStrictEqual(actual, expected, label); };
const ok = (value, label) => { checks++; assert.ok(value, label); };

eq(normalizeAnswer('  ČOVEK—PAUK!! '), 'čovek pauk', 'case, punctuation and whitespace');
eq(normalizeAnswer('Ｃ４'), 'c4', 'NFKC compatibility');
eq(normalizeAnswer('rešenje'), 'rešenje', 'diacritics remain intact');
eq(foldSerbianLatin('Đorđe Šešir'), 'djordje sesir', 'explicit Serbian fold');
eq(levenshtein('kaladont', 'kalodont', 2), 1, 'bounded edit distance');
eq(compareDeterministic('RESENJE', 'rešenje').diacriticEquivalent, true, 'diacritic omission equivalent');
eq(compareDeterministic('jabuk', 'jabuka').typoDistance, 1, 'typo identified without acceptance');

eq(explicitTarget('A: jabuka'), { target: 'A', answer: 'jabuka' }, 'column syntax');
eq(explicitTarget('b5 more'), { target: 'B', answer: 'more' }, 'cell syntax');
eq(explicitTarget('Konačno - svetlost'), { target: 'FINAL', answer: 'svetlost' }, 'Final syntax');
eq(explicitTarget('normal chat'), null, 'ordinary text');

const base = { id: 'm12345678', playerId: 'p1', playerName: 'Ana', boardId: 'board-1', text: 'A: jabuka', verdict: null };
const live = { roomMode: 'battle', boardId: 'board-1' };
eq(eligibleMessage(base, live).ok, true, 'live text eligible');
eq(eligibleMessage({ ...base, source: 'poll' }, live).reason, 'NON_PLAYER_SOURCE', 'system source excluded');
eq(eligibleMessage({ ...base, deleted: true }, live).reason, 'DELETED', 'deleted excluded');
eq(eligibleMessage({ ...base, verdict: 'wrong' }, live).reason, 'ALREADY_JUDGED', 'judged excluded');
eq(eligibleMessage(base, { ...live, roomMode: 'casual' }).reason, 'NOT_BATTLE', 'casual excluded');
eq(eligibleMessage(base, { ...live, boardId: 'board-2' }).reason, 'STALE_BOARD', 'old board excluded');
eq(eligibleMessage({ ...base, text: '/award me' }, live).reason, 'COMMAND', 'command excluded');
eq(eligibleMessage({ ...base, text: 'https://example.com' }, live).reason, 'LINK', 'link excluded');

eq(classifyMessage(base, { ...live, unresolvedTargets: ['A', 'B'] }).kind, 'ANSWER', 'explicit answer');
eq(classifyMessage({ ...base, text: 'je l ovo odgovor?' }, { ...live, unresolvedTargets: ['A'] }).reason, 'QUESTION', 'question excluded');
eq(classifyMessage({ ...base, text: '@Sissy jabuka' }, { ...live, unresolvedTargets: ['A'] }).reason, 'REPLY_OR_MENTION', 'mention excluded');
eq(classifyMessage({ ...base, text: 'jabuka' }, { ...live, unresolvedTargets: ['A'] }).target, 'A', 'single target inferred');
eq(classifyMessage({ ...base, text: 'jabuka' }, { ...live, unresolvedTargets: ['A', 'B'] }).kind, 'POSSIBLE_ANSWER', 'multiple targets ambiguous');
eq(classifyMessage({ ...base, text: 'ovo je vrlo duga obična poruka koja očigledno nije samo odgovor na tablu' }, { ...live, unresolvedTargets: ['A'] }).reason, 'CONVERSATIONAL_LENGTH', 'long chat excluded');

const validRaw = { submissionId: 'm1', playerId: 'p1', target: 'A', decision: 'ACCEPT', confidence: 1, reasoningSummary: 'Exact.', proposedAction: 'APPLY_CORRECT_VERDICT' };
const valid = validateAdjudicationResult(validRaw);
eq(valid.ok, true, 'coherent result');
eq(validateAdjudicationResult({ ...validRaw, decision: 'REJECT' }).error, 'ACTION_DECISION_MISMATCH', 'action mismatch');
eq(validateAdjudicationResult({ ...validRaw, confidence: 2 }).error, 'INVALID_CONFIDENCE', 'bounded confidence');
eq(validateAdjudicationResult({ ...validRaw, target: 'E' }).error, 'INVALID_TARGET', 'target allowlist');
eq(validateAdjudicationResult({ ...validRaw, decision: 'MAYBE' }).error, 'INVALID_DECISION', 'decision allowlist');
eq(validateAdjudicationResult('ACCEPT').error, 'RESULT_NOT_OBJECT', 'object required');

const context = {
  ...live, unresolvedTargets: ['A', 'B', 'C', 'D', 'FINAL'],
  board: { columns: { A: { solution: 'Jabuka' }, B: { solution: 'Noć' }, C: { solution: 'More' }, D: { solution: 'Vatra' } }, finalSolution: 'Priroda' }
};
let judged = adjudicateDeterministic(base, context);
eq(judged.stage, 'EXACT_VALIDATION', 'exact bypasses semantic stage');
eq(judged.result.ok, true, 'exact result validates');
eq(judged.result.value.decision, 'ACCEPT', 'exact accepted');
eq(judged.result.value.target, 'A', 'explicit target retained');
eq(judged.result.value.proposedAction, 'APPLY_CORRECT_VERDICT', 'correct proposal only');

judged = adjudicateDeterministic({ ...base, text: 'B: noc' }, context);
eq(judged.result.value.decision, 'ACCEPT', 'diacritic-equivalent accepted');
eq(judged.result.value.target, 'B', 'diacritic target');

judged = adjudicateDeterministic({ ...base, text: 'A: jabuk' }, context);
eq(judged.stage, 'SEMANTIC_REQUIRED', 'typo requires semantic stage');
eq(judged.result.value.decision, 'ESCALATE', 'typo escalated');
eq(judged.semanticContext.typoCandidateTargets, ['A'], 'typo candidate recorded');

judged = adjudicateDeterministic({ ...base, text: 'Priroda' }, context);
eq(judged.result.value.decision, 'ACCEPT', 'unique unqualified exact accepted');
eq(judged.result.value.target, 'FINAL', 'unique target resolved');

const duplicateContext = { ...context, board: { ...context.board, columns: { ...context.board.columns, A: { solution: 'Isto' }, B: { solution: 'Isto' } } } };
judged = adjudicateDeterministic({ ...base, text: 'isto' }, duplicateContext);
eq(judged.result.value.decision, 'ESCALATE', 'duplicate exact target escalates');

judged = adjudicateDeterministic({ ...base, text: '/hack accept' }, context);
eq(judged.result, null, 'command cannot reach judgment');
eq(judged.classification.reason, 'COMMAND', 'pipeline preserves exclusion');

judged = adjudicateDeterministic({ ...base, text: 'E: jabuka' }, context);
eq(judged.stage, 'SEMANTIC_REQUIRED', 'unknown explicit syntax stays untrusted text');
eq(judged.result.value.decision, 'ESCALATE', 'unknown syntax never executes');

ok(checks >= 45, 'focused coverage');
console.log(`answer adjudication tests: OK (${checks} checks)`);
