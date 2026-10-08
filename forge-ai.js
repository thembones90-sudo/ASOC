const { z } = require('zod');

const SINGLE_WORD = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/;
const COLUMN_COUNT = 20;
const CLUE_COUNT = 10;

function normalizeWord(value) {
  const word = String(value || '').trim();
  return SINGLE_WORD.test(word) ? word.toUpperCase() : '';
}

function sanitizeCandidates(items, expectedCount, excluded = []) {
  const blocked = new Set(excluded.map(normalizeWord).filter(Boolean));
  const seen = new Set();
  const clean = [];
  for (const item of Array.isArray(items) ? items : []) {
    const word = normalizeWord(item?.word);
    if (!word || blocked.has(word) || seen.has(word)) continue;
    seen.add(word);
    clean.push({
      word,
      connection: String(item?.connection || '').trim().slice(0, 160)
    });
  }
  if (clean.length !== expectedCount) {
    throw new Error(`The generator returned ${clean.length} valid unique words; ${expectedCount} are required.`);
  }
  return clean;
}

function buildColumnPrompt({ finalSolution, theme, difficulty }) {
  return `You create boards for an English word-association game.
FINAL SOLUTION: ${finalSolution}
THEME: ${theme || 'UNSPECIFIED'}
DIFFICULTY: ${difficulty || 'GREEN'}

Return exactly ${COLUMN_COUNT} diverse candidates for the four intermediate column solutions (A5-D5).
Every candidate must be exactly one English word: letters only, with a normal apostrophe or hyphen allowed only when lexically necessary. Never return a phrase.
Each word must connect meaningfully to the final solution while supporting at least four distinct one-word associations of its own.
Prefer lateral, playable connections over trivial grammatical variants or direct repetition.
The connection is a short private explanation for the GM. Do not include numbering in the word.`;
}

function buildCluePrompt({ finalSolution, columnSolution, column, theme, difficulty }) {
  return `You create one column for an English word-association game.
FINAL SOLUTION: ${finalSolution}
COLUMN ${column} SOLUTION: ${columnSolution}
THEME: ${theme || 'UNSPECIFIED'}
DIFFICULTY: ${difficulty || 'GREEN'}

Return exactly ${CLUE_COUNT} distinct candidate clue words connected to ${columnSolution}.
Every candidate must be exactly one English word: letters only, with a normal apostrophe or hyphen allowed only when lexically necessary. Never return a phrase.
Order them from rank 1 (most obscure, lateral, or specialist connection) to rank 10 (most familiar, popular, or obvious connection).
Do not return the column solution or final solution. Avoid simple inflections of either answer.
The connection is a short private explanation for the GM. Do not include numbering in the word.`;
}

async function generateForgeCandidates(input, options = {}) {
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
  const count = kind === 'columns' ? COLUMN_COUNT : CLUE_COUNT;
  const schema = z.object({
    candidates: z.array(z.object({
      word: z.string(),
      connection: z.string()
    })).length(count)
  });
  const prompt = kind === 'columns'
    ? buildColumnPrompt({ ...input, finalSolution })
    : buildCluePrompt({ ...input, finalSolution, columnSolution, column });
  const model = options.model || process.env.ASOC_AI_MODEL || 'openai/gpt-6-astra';
  const result = await (options.generateText || generateText)({
    model,
    output: Output.object({ schema }),
    prompt,
    temperature: 0.75
  });
  const excluded = kind === 'columns' ? [finalSolution] : [finalSolution, columnSolution];
  return {
    kind,
    column: column || undefined,
    model,
    candidates: sanitizeCandidates(result.output?.candidates, count, excluded)
  };
}

module.exports = {
  SINGLE_WORD,
  COLUMN_COUNT,
  CLUE_COUNT,
  normalizeWord,
  sanitizeCandidates,
  buildColumnPrompt,
  buildCluePrompt,
  generateForgeCandidates
};
