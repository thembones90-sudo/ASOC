'use strict';

const SERBIAN_LATIN_FOLD = Object.freeze({ č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj' });

function normalizeUnicode(value) { return String(value ?? '').normalize('NFKC'); }

function normalizeAnswer(value) {
  return normalizeUnicode(value)
    .toLocaleLowerCase('sr-Latn-RS')
    .replace(/[“”„‟«»]/g, '"').replace(/[’‘‚‛`´]/g, "'").replace(/[‐‑‒–—―]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function foldSerbianLatin(value) {
  return normalizeAnswer(value).replace(/[čćžšđ]/g, char => SERBIAN_LATIN_FOLD[char]);
}

function tokens(value) { const normalized = normalizeAnswer(value); return normalized ? normalized.split(' ') : []; }

function levenshtein(a, b, maxDistance = Infinity) {
  const left = Array.from(normalizeAnswer(a));
  const right = Array.from(normalizeAnswer(b));
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const current = [i + 1];
    let rowMin = current[0];
    for (let j = 0; j < right.length; j++) {
      const cost = left[i] === right[j] ? 0 : 1;
      const value = Math.min(previous[j + 1] + 1, current[j] + 1, previous[j] + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[right.length];
}

function compareDeterministic(submission, expected) {
  const normalizedSubmission = normalizeAnswer(submission);
  const normalizedExpected = normalizeAnswer(expected);
  if (!normalizedSubmission || !normalizedExpected) return { exact: false, diacriticEquivalent: false, typoDistance: null };
  const exact = normalizedSubmission === normalizedExpected;
  const diacriticEquivalent = !exact && foldSerbianLatin(normalizedSubmission) === foldSerbianLatin(normalizedExpected);
  const maxTypoDistance = normalizedExpected.length >= 8 ? 2 : normalizedExpected.length >= 5 ? 1 : 0;
  const distance = exact || diacriticEquivalent || !maxTypoDistance ? null : levenshtein(normalizedSubmission, normalizedExpected, maxTypoDistance);
  return { exact, diacriticEquivalent, typoDistance: distance !== null && distance <= maxTypoDistance ? distance : null };
}

module.exports = { normalizeUnicode, normalizeAnswer, foldSerbianLatin, tokens, levenshtein, compareDeterministic };
