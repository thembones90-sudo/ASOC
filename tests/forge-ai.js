const assert = require('assert/strict');
const { normalizeWord, semanticKey, sanitizeCandidates, buildColumnPrompt, buildCluePrompt, buildAuditPrompt, generateLocalCandidates, COLUMN_COUNT, CLUE_COUNT } = require('../forge-ai');

assert.equal(normalizeWord(' black hole '), '', 'phrases are rejected');
assert.equal(normalizeWord('spite'), 'SPITE', 'valid words are normalized');
assert.equal(normalizeWord('mother-in-law'), 'MOTHER-IN-LAW', 'lexical hyphenation remains one entry');
assert.equal(semanticKey('spiteful'), semanticKey('spite'), 'simple grammatical variants share a semantic family');
const invalid = Array.from({ length: COLUMN_COUNT }, (_, index) => ({ word: `word${index}`, connection: 'bad digits' }));
assert.throws(() => sanitizeCandidates(invalid, COLUMN_COUNT), /0 valid unique words/, 'invalid generated entries fail closed');
const words = ['ABLE','BAKER','CHARLIE','DELTA','EAGLE','FOXTROT','GAMMA','HOTEL','INDIA','JULIET','KAPPA','LIMA','MANGO','NOVEMBER','OSCAR','PAPA','QUEBEC','ROMEO','SIERRA','TANGO'];
assert.equal(sanitizeCandidates(words.map(word => ({ word, connection: `${word} link` })), COLUMN_COUNT, ['FINAL']).length, 20);
assert.match(buildColumnPrompt({ finalSolution: 'BUG' }), /exactly 20/i);
assert.match(buildColumnPrompt({ finalSolution: 'BUG' }), /one English word/i);
assert.match(buildCluePrompt({ finalSolution: 'BUG', columnSolution: 'CODE', column: 'A' }), /rank 1 \(most obscure/);
assert.match(buildCluePrompt({ finalSolution: 'BUG', columnSolution: 'CODE', column: 'A' }), /rank 10 \(most familiar/);
assert.equal(CLUE_COUNT, 10);
assert.match(buildColumnPrompt({ finalSolution: 'BUG', count: 3, excludeWords: ['CODE'] }), /exactly 3/i, 'replacement pools request only the needed count');
assert.match(buildAuditPrompt({ board: { final: 'BUG' } }), /independent quality auditor/i);
assert.throws(() => sanitizeCandidates([{ word: 'SPITE' }, { word: 'SPITEFUL' }], 2), /1 valid unique words/, 'near-duplicate grammatical variants are rejected');
(async () => {
  const local = await generateLocalCandidates({ kind: 'columns', finalSolution: 'SPLASH', columnSolution: '', column: '', count: 20, excludeWords: [] });
  assert.equal(local.model, 'local-wordnet');
  assert.equal(local.candidates.length, 20, 'local fallback produces a complete candidate pool');
  assert.ok(local.candidates.every(candidate => normalizeWord(candidate.word)), 'local fallback preserves the one-word contract');
  console.log('PASS Forge AI: one-word validation, exact pools, local fallback and obscure-to-popular prompt contract');
})().catch(error => { console.error(error); process.exitCode = 1; });
