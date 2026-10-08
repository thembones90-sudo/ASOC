const assert = require('assert/strict');
const { normalizeWord, sanitizeCandidates, buildColumnPrompt, buildCluePrompt, COLUMN_COUNT, CLUE_COUNT } = require('../forge-ai');

assert.equal(normalizeWord(' black hole '), '', 'phrases are rejected');
assert.equal(normalizeWord('spite'), 'SPITE', 'valid words are normalized');
assert.equal(normalizeWord('mother-in-law'), 'MOTHER-IN-LAW', 'lexical hyphenation remains one entry');
const invalid = Array.from({ length: COLUMN_COUNT }, (_, index) => ({ word: `word${index}`, connection: 'bad digits' }));
assert.throws(() => sanitizeCandidates(invalid, COLUMN_COUNT), /0 valid unique words/, 'invalid generated entries fail closed');
const words = ['ABLE','BAKER','CHARLIE','DELTA','EAGLE','FOXTROT','GAMMA','HOTEL','INDIA','JULIET','KAPPA','LIMA','MANGO','NOVEMBER','OSCAR','PAPA','QUEBEC','ROMEO','SIERRA','TANGO'];
assert.equal(sanitizeCandidates(words.map(word => ({ word, connection: `${word} link` })), COLUMN_COUNT, ['FINAL']).length, 20);
assert.match(buildColumnPrompt({ finalSolution: 'BUG' }), /exactly 20/i);
assert.match(buildColumnPrompt({ finalSolution: 'BUG' }), /one English word/i);
assert.match(buildCluePrompt({ finalSolution: 'BUG', columnSolution: 'CODE', column: 'A' }), /rank 1 \(most obscure/);
assert.match(buildCluePrompt({ finalSolution: 'BUG', columnSolution: 'CODE', column: 'A' }), /rank 10 \(most familiar/);
assert.equal(CLUE_COUNT, 10);
console.log('PASS Forge AI: one-word validation, exact pools and obscure-to-popular prompt contract');
