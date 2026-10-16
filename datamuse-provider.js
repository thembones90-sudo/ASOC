'use strict';
// Provider-specific URLs/schema live here, never in the creator or game model.
const POS = Object.freeze({ n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' });
class ProviderResponseError extends Error {}
function buildUrl(word, mode) {
  const url = new URL('https://api.datamuse.com/words');
  url.search = new URLSearchParams({ [mode === 'associated' ? 'rel_trg' : 'ml']: word, max: '100', md: 'p' }).toString();
  return url;
}
function normalizeResponse(data, sourceWord) {
  if (!Array.isArray(data)) throw new ProviderResponseError();
  const words = new Map();
  for (const item of data.slice(0, 100)) {
    if (!item || typeof item.word !== 'string' || (item.score != null && (typeof item.score !== 'number' || !Number.isFinite(item.score))) || (item.tags != null && (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')))) throw new ProviderResponseError();
    const word = item.word.trim().toLowerCase();
    if (word === sourceWord || word.length > 60 || !/^[a-z]+(?:['-][a-z]+)*$/.test(word)) continue;
    const partsOfSpeech = [...new Set((item.tags || []).map(tag => Object.hasOwn(POS, tag) ? POS[tag] : null).filter(Boolean))];
    const score = item.score ?? null;
    const old = words.get(word);
    if (old) {
      old.partsOfSpeech = [...new Set([...old.partsOfSpeech, ...partsOfSpeech])];
      if (score !== null && (old.score === null || score > old.score)) old.score = score;
    } else words.set(word, { word: word.toUpperCase(), score, partsOfSpeech });
  }
  return [...words.values()].sort((a,b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.word.localeCompare(b.word));
}
module.exports = { id: 'datamuse', source: 'Datamuse', buildUrl, normalizeResponse, ProviderResponseError };
