const { z } = require('zod');

const SINGLE_WORD = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;
const COLUMN_COUNT = 20;
const CLUE_COUNT = 10;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const generationCache = new Map();
let wordnetReady;
let wordnetVocabulary;

function normalizeWord(value) {
  const word = String(value || '').trim();
  return SINGLE_WORD.test(word) ? word.toUpperCase() : '';
}

function semanticKey(value) {
  let word = normalizeWord(value).replace(/[-']/g, '');
  const suffixes = ['FULLY', 'LESSNESS', 'FULNESS', 'ATION', 'MENTS', 'MENT', 'NESS', 'ABLE', 'IBLE', 'ALLY', 'ING', 'FUL', 'LESS', 'ER', 'ED', 'LY', 'ES', 'S', 'Y'];
  for (const suffix of suffixes) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  return word;
}

function sanitizeCandidates(items, expectedCount, excluded = [], allowExtra = false) {
  const blocked = new Set(excluded.map(normalizeWord).filter(Boolean));
  const blockedFamilies = new Set([...blocked].map(semanticKey));
  const seen = new Set();
  const seenFamilies = new Set();
  const clean = [];
  for (const item of Array.isArray(items) ? items : []) {
    const word = normalizeWord(item?.word);
    const family = semanticKey(word);
    if (!word || blocked.has(word) || seen.has(word) || blockedFamilies.has(family) || seenFamilies.has(family)) continue;
    seen.add(word);
    seenFamilies.add(family);
    clean.push({
      word,
      connection: String(item?.connection || '').trim().slice(0, 160),
      strength: Math.max(1, Math.min(5, Number(item?.strength) || 3)),
      difficulty: ['OBSCURE', 'HARD', 'MEDIUM', 'EASY', 'OBVIOUS'].includes(String(item?.difficulty || '').toUpperCase())
        ? String(item.difficulty).toUpperCase()
        : 'MEDIUM'
    });
    if (allowExtra && clean.length === expectedCount) break;
  }
  if (clean.length !== expectedCount) {
    throw new Error(`The generator returned ${clean.length} valid unique words; ${expectedCount} are required.`);
  }
  return clean;
}

function buildColumnPrompt({ finalSolution, theme, difficulty, count = COLUMN_COUNT, excludeWords = [] }) {
  return `You create boards for an English word-association game.
FINAL SOLUTION: ${finalSolution}
THEME: ${theme || 'UNSPECIFIED'}
DIFFICULTY: ${difficulty || 'GREEN'}

Return exactly ${count} diverse candidates for the four intermediate column solutions (A5-D5).
Every candidate must be exactly one English word: letters only, with a normal apostrophe or hyphen allowed only when lexically necessary. Never return a phrase.
Each word must connect meaningfully to the final solution while supporting at least four distinct one-word associations of its own.
Prefer lateral, playable connections over trivial grammatical variants or direct repetition.
Do not use these rejected or existing words, or simple grammatical variants of them: ${excludeWords.join(', ') || 'NONE'}.
Strength is an integer 1-5 measuring how defensible the relationship is. Difficulty is OBSCURE, HARD, MEDIUM, EASY, or OBVIOUS.
The connection is a short private explanation for the GM. Do not include numbering in the word.`;
}

function buildCluePrompt({ finalSolution, columnSolution, column, theme, difficulty, count = CLUE_COUNT, excludeWords = [] }) {
  return `You create one column for an English word-association game.
FINAL SOLUTION: ${finalSolution}
COLUMN ${column} SOLUTION: ${columnSolution}
THEME: ${theme || 'UNSPECIFIED'}
DIFFICULTY: ${difficulty || 'GREEN'}

Return exactly ${count} distinct candidate clue words connected to ${columnSolution}.
Every candidate must be exactly one English word: letters only, with a normal apostrophe or hyphen allowed only when lexically necessary. Never return a phrase.
Order them from rank 1 (most obscure, lateral, or specialist connection) to rank 10 (most familiar, popular, or obvious connection).
Do not return the column solution or final solution. Avoid simple inflections of either answer.
Do not use these rejected or existing words, or simple grammatical variants of them: ${excludeWords.join(', ') || 'NONE'}.
Strength is an integer 1-5 measuring how defensible the relationship is. Difficulty is OBSCURE, HARD, MEDIUM, EASY, or OBVIOUS.
The connection is a short private explanation for the GM. Do not include numbering in the word.`;
}

function buildAuditPrompt({ board, theme, difficulty }) {
  return `Act as an independent quality auditor for an English word-association game.
THEME: ${theme || 'UNSPECIFIED'}
DIFFICULTY: ${difficulty || 'GREEN'}
BOARD JSON: ${JSON.stringify(board)}

Audit whether every entry is one English word; each A1-A4 through D1-D4 clue connects fairly to its column solution; clue difficulty progresses from obscure at row 1 to popular/obvious at row 4; the four column solutions connect distinctly and defensibly to FINAL; columns do not repeat the same semantic family; and no clue leaks an answer through an inflection or near-duplicate.
Be strict but practical. Return a 0-100 score, verdict READY, REVIEW, or REBUILD, and concrete issues. Cell may be a board label, column letter, FINAL, or BOARD. Suggestions must remain one English word when proposing a replacement.`;
}

function cacheKey(input) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    return value;
  };
  return JSON.stringify(stable(input));
}

function cached(key) {
  const hit = generationCache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) { generationCache.delete(key); return null; }
  return JSON.parse(JSON.stringify(hit.value));
}

function storeCache(key, value) {
  generationCache.set(key, { at: Date.now(), value });
  if (generationCache.size > 250) generationCache.delete(generationCache.keys().next().value);
}

async function getWordNet() {
  const wordnet = require('wordnet');
  if (!wordnetReady) wordnetReady = wordnet.init();
  await wordnetReady;
  if (!wordnetVocabulary) wordnetVocabulary = new Set((await wordnet.list()).map(word => normalizeWord(word)).filter(Boolean));
  return wordnet;
}

function wordsFromDefinition(definition) {
  const direct = [];
  for (const item of definition?.meta?.words || []) direct.push(item.word);
  for (const pointer of definition?.meta?.pointers || []) {
    for (const item of pointer?.data?.meta?.words || []) direct.push(item.word);
  }
  const glossary = String(definition?.glossary || '').split(/[^A-Za-z'-]+/).filter(word => word.length > 3);
  return { direct, glossary };
}

async function localAssociations(anchor, limit = 250) {
  const wordnet = await getWordNet();
  const root = normalizeWord(anchor);
  const stop = new Set(['ABOUT','AFTER','AGAIN','AROUND','BECAUSE','BEFORE','BEING','CAUSE','COULD','DOES','EVERY','FORCE','FORM','FROM','HAVE','INTO','LIKE','MADE','MAKE','MEANS','OTHER','OVER','SAME','SOMETHING','THAN','THAT','THEIR','THEM','THEN','THERE','THESE','THING','THIS','THOSE','THROUGH','UNDER','USING','VERY','WHAT','WHEN','WHERE','WHICH','WHILE','WITH','WOULD']);
  const scores = new Map();
  const add = (value, score, reason) => {
    const word = normalizeWord(String(value || '').replace(/_/g, '-'));
    if (!word || word === root || stop.has(word) || !wordnetVocabulary.has(word)) return;
    const current = scores.get(word);
    if (!current || current.score < score) scores.set(word, { word, score, reason });
  };
  const roots = await wordnet.lookup(root.toLowerCase());
  roots.forEach(definition => {
    const words = wordsFromDefinition(definition);
    words.direct.forEach(word => add(word, 5, definition.glossary));
    words.glossary.forEach(word => add(word, 2, definition.glossary));
  });
  const firstWave = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, 45);
  await Promise.all(firstWave.map(async item => {
    const definitions = await wordnet.lookup(item.word.toLowerCase()).catch(() => []);
    definitions.slice(0, 3).forEach(definition => {
      const words = wordsFromDefinition(definition);
      words.direct.forEach(word => add(word, 3, definition.glossary));
      words.glossary.forEach(word => add(word, 1, definition.glossary));
    });
  }));
  return [...scores.values()].sort((a, b) => b.score - a.score || a.word.length - b.word.length).slice(0, limit);
}

async function generateLocalCandidates({ kind, finalSolution, columnSolution, column, count, excludeWords }) {
  const anchor = kind === 'columns' ? finalSolution : columnSolution;
  const associations = await localAssociations(anchor, 500);
  const blocked = [...excludeWords, finalSolution, ...(columnSolution ? [columnSolution] : [])];
  const strong = associations.filter(item => item.score >= 3);
  const pool = (strong.length >= count ? strong : associations).slice(0, Math.max(count * 6, 80));
  if (kind === 'clues') pool.sort((a, b) => b.word.length - a.word.length || b.score - a.score);
  const raw = pool.map((item, index) => {
    const band = Math.min(4, Math.floor(index / Math.max(1, pool.length / 5)));
    return {
      word: item.word,
      connection: String(item.reason || `WordNet relationship to ${anchor}`).replace(/\s+/g, ' ').slice(0, 160),
      strength: item.score,
      difficulty: kind === 'clues'
        ? ['OBSCURE', 'HARD', 'MEDIUM', 'EASY', 'OBVIOUS'][band]
        : ['OBVIOUS', 'EASY', 'MEDIUM', 'HARD', 'OBSCURE'][band]
    };
  });
  return { kind, column: column || undefined, model: 'local-wordnet', fallback: true, candidates: sanitizeCandidates(raw, count, blocked, true) };
}

async function auditLocalBoard(input) {
  const board = input.board || {};
  const issues = [];
  let score = 100;
  const final = normalizeWord(board.final);
  const finalRelations = new Set((final ? await localAssociations(final, 500) : []).map(item => semanticKey(item.word)));
  for (const col of ['A','B','C','D']) {
    const solution = normalizeWord(board.columns?.[col]?.solution);
    if (!solution) { issues.push({ severity: 'ERROR', cell: `${col}5`, problem: 'Column solution is not one English word.', suggestion: 'Replace it with one word.' }); score -= 18; continue; }
    if (final && !finalRelations.has(semanticKey(solution))) { issues.push({ severity: 'WARNING', cell: `${col}5`, problem: `${solution} has no close WordNet path to ${final}.`, suggestion: 'Review the intended bridge manually.' }); score -= 6; }
    const relations = new Set((await localAssociations(solution, 500)).map(item => semanticKey(item.word)));
    for (let index = 0; index < 4; index++) {
      const clue = normalizeWord(board.columns?.[col]?.clues?.[index]);
      const cell = `${col}${index + 1}`;
      if (!clue) { issues.push({ severity: 'ERROR', cell, problem: 'Clue is not one English word.', suggestion: 'Replace it with one word.' }); score -= 8; }
      else if (!relations.has(semanticKey(clue))) { issues.push({ severity: 'WARNING', cell, problem: `${clue} has no close WordNet path to ${solution}.`, suggestion: 'Confirm the association manually.' }); score -= 4; }
    }
  }
  score = Math.max(0, score);
  return { kind: 'audit', model: 'local-wordnet', fallback: true, audit: { score, verdict: score >= 85 ? 'READY' : score >= 60 ? 'REVIEW' : 'REBUILD', summary: 'Private local WordNet review completed. GM judgment remains final.', issues } };
}

async function generateForgeCandidates(input, options = {}) {
  if (input?.kind === 'audit') return auditForgeBoard(input, options);
  const kind = input?.kind === 'clues' ? 'clues' : 'columns';
  const finalSolution = normalizeWord(input?.finalSolution);
  if (!finalSolution) throw new Error('Enter a one-word English final solution first.');

  const columnSolution = kind === 'clues' ? normalizeWord(input?.columnSolution) : '';
  const column = /^[A-D]$/.test(String(input?.column || '').toUpperCase())
    ? String(input.column).toUpperCase()
    : '';
  if (kind === 'clues' && (!columnSolution || !column)) {
    throw new Error('Choose a valid column solution before generating its clues.');
  }

  const { generateText, Output } = await import('ai');
  const maxCount = kind === 'columns' ? COLUMN_COUNT : CLUE_COUNT;
  const count = Math.max(1, Math.min(maxCount, Number(input?.count) || maxCount));
  const excludeWords = Array.isArray(input?.excludeWords) ? input.excludeWords.map(normalizeWord).filter(Boolean).slice(0, 80) : [];
  const normalizedInput = { kind, finalSolution, columnSolution, column, theme: String(input?.theme || '').slice(0, 80), difficulty: String(input?.difficulty || 'GREEN').slice(0, 12), count, excludeWords };
  const key = cacheKey(normalizedInput);
  const hit = cached(key);
  if (hit) return { ...hit, cached: true };
  if (!options.generateText && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    const value = await generateLocalCandidates(normalizedInput);
    storeCache(key, value);
    return value;
  }
  const schema = z.object({
    candidates: z.array(z.object({
      word: z.string(),
      connection: z.string(),
      strength: z.number().int().min(1).max(5),
      difficulty: z.enum(['OBSCURE', 'HARD', 'MEDIUM', 'EASY', 'OBVIOUS'])
    })).length(count)
  });
  const prompt = kind === 'columns'
    ? buildColumnPrompt({ ...normalizedInput })
    : buildCluePrompt({ ...normalizedInput });
  const model = options.model || process.env.ASOC_AI_MODEL || 'openai/gpt-6-astra';
  let result;
  try {
    result = await (options.generateText || generateText)({
      model,
      output: Output.object({ schema }),
      prompt,
      temperature: 0.75
    });
  } catch (error) {
    if (options.generateText) throw error;
    const value = await generateLocalCandidates(normalizedInput);
    storeCache(key, value);
    return value;
  }
  const excluded = kind === 'columns' ? [finalSolution] : [finalSolution, columnSolution];
  const value = {
    kind,
    column: column || undefined,
    model,
    candidates: sanitizeCandidates(result.output?.candidates, count, [...excluded, ...excludeWords])
  };
  storeCache(key, value);
  return value;
}

async function auditForgeBoard(input, options = {}) {
  const board = input?.board && typeof input.board === 'object' ? input.board : null;
  if (!board) throw new Error('A complete board is required for semantic audit.');
  const normalizedInput = { kind: 'audit', board, theme: String(input?.theme || '').slice(0, 80), difficulty: String(input?.difficulty || 'GREEN').slice(0, 12) };
  const key = cacheKey(normalizedInput);
  const hit = cached(key);
  if (hit) return { ...hit, cached: true };
  if (!options.generateText && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    const value = await auditLocalBoard(normalizedInput);
    storeCache(key, value);
    return value;
  }
  const { generateText, Output } = await import('ai');
  const schema = z.object({
    score: z.number().int().min(0).max(100),
    verdict: z.enum(['READY', 'REVIEW', 'REBUILD']),
    summary: z.string(),
    issues: z.array(z.object({
      severity: z.enum(['ERROR', 'WARNING', 'NOTE']),
      cell: z.string(),
      problem: z.string(),
      suggestion: z.string()
    })).max(30)
  });
  const model = options.model || process.env.ASOC_AI_MODEL || 'openai/gpt-6-astra';
  let result;
  try {
    result = await (options.generateText || generateText)({
      model,
      output: Output.object({ schema }),
      prompt: buildAuditPrompt(normalizedInput),
      temperature: 0.2
    });
  } catch (error) {
    if (options.generateText) throw error;
    const value = await auditLocalBoard(normalizedInput);
    storeCache(key, value);
    return value;
  }
  const value = { kind: 'audit', model, audit: result.output };
  storeCache(key, value);
  return value;
}

module.exports = {
  SINGLE_WORD,
  COLUMN_COUNT,
  CLUE_COUNT,
  normalizeWord,
  semanticKey,
  sanitizeCandidates,
  buildColumnPrompt,
  buildCluePrompt,
  buildAuditPrompt,
  generateLocalCandidates,
  auditLocalBoard,
  auditForgeBoard,
  generateForgeCandidates
};
