'use strict';

// Official API only; deliberately independent of authored games and persistence.
const ENDPOINT = 'https://api.wordassociations.net/associations/v1.0/json/search';
const POS = new Set(['noun', 'verb', 'adjective', 'adverb']);
class AssociationError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function normalizeWord(value) {
  if (typeof value !== 'string') throw new AssociationError(400, 'Enter one English word (maximum 60 characters).');
  const word = value.trim().toLowerCase();
  if (!word || word.length > 60 || !/^[a-z]+(?:['-][a-z]+)*$/.test(word)) {
    throw new AssociationError(400, 'Enter one English word (maximum 60 characters).');
  }
  return word;
}
function upstreamError(code) {
  if (code === 401 || code === 403) return new AssociationError(503, 'Association service authentication failed. Ask the GM to check server configuration.');
  if (code === 429) return new AssociationError(429, 'Association API limit reached. Try again later.');
  return new AssociationError(502, 'Association service temporarily unavailable.');
}
function normalizeResponse(data, word) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.code)) throw new AssociationError(502, 'Association service returned an invalid response.');
  if (data.code !== 200) throw upstreamError(data.code);
  if (!Array.isArray(data.response) || data.response.length !== 1 || !Array.isArray(data.response[0]?.items) || String(data.response[0]?.text).trim().toLowerCase() !== word) {
    throw new AssociationError(502, 'Association service returned an invalid response.');
  }
  const words = new Map();
  for (const item of data.response[0].items) {
    if (!item || typeof item.item !== 'string' || (item.weight != null && (typeof item.weight !== 'number' || !Number.isFinite(item.weight)))) {
      throw new AssociationError(502, 'Association service returned an invalid response.');
    }
    let candidate;
    try { candidate = normalizeWord(item.item); } catch { continue; } // ASOC never offers multi-word answers.
    if (candidate === word) continue;
    const old = words.get(candidate);
    const pos = POS.has(item.pos) ? item.pos : null;
    const weight = item.weight ?? null;
    if (old) {
      if (pos && !old.partsOfSpeech.includes(pos)) old.partsOfSpeech.push(pos);
      if (weight !== null && (old.weight === null || weight > old.weight)) old.weight = weight;
    } else words.set(candidate, { word: candidate.toUpperCase(), partsOfSpeech: pos ? [pos] : [], weight });
  }
  return [...words.values()].sort((a, b) => (b.weight ?? -Infinity) - (a.weight ?? -Infinity) || a.word.localeCompare(b.word));
}
function createAssociationProvider({ getKey = () => process.env.WORD_ASSOCIATIONS_API_KEY, fetchImpl = globalThis.fetch, now = Date.now, ttlMs = 86400000, timeoutMs = 10000, maxEntries = 256, minIntervalMs = 1500 } = {}) {
  const cache = new Map(), pending = new Map();
  let nextRequestAt = 0;
  return {
    async fetch(value) {
      const word = normalizeWord(value);
      const key = getKey();
      if (!key) throw new AssociationError(503, 'Association Forge is not configured. Set WORD_ASSOCIATIONS_API_KEY on the server.');
      const hit = cache.get(word);
      if (hit && hit.expiresAt > now()) return { ...hit.result, cached: true };
      if (pending.has(word)) return pending.get(word);
      if (pending.size >= 2 || now() < nextRequestAt) throw new AssociationError(429, 'Please wait a moment before fetching another word.');
      nextRequestAt = now() + minIntervalMs;
      const task = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const query = new URLSearchParams({ apikey: key, text: word, lang: 'en', type: 'stimulus', limit: '300', indent: 'no' });
          const response = await fetchImpl(`${ENDPOINT}?${query}`, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
          if (!response.ok) throw upstreamError(response.status);
          // Bounded read prevents an unexpectedly large response monopolizing memory.
          const chunks = []; let bytes = 0;
          for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) { controller.abort(); throw new AssociationError(502, 'Association service returned an invalid response.'); }
            chunks.push(Buffer.from(chunk));
          }
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AssociationError(502, 'Association service returned an invalid response.'); }
          const result = { source: 'Word Associations Network', word: word.toUpperCase(), direction: 'stimulus', items: normalizeResponse(data, word), fetchedAt: new Date(now()).toISOString() };
          cache.delete(word);
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
          cache.set(word, { result, expiresAt: now() + ttlMs });
          return { ...result, cached: false };
        } catch (error) {
          if (error instanceof AssociationError) throw error;
          throw new AssociationError(502, controller.signal.aborted ? 'Association service timed out. Try again.' : 'Association service temporarily unavailable.');
        } finally { clearTimeout(timer); }
      })();
      pending.set(word, task);
      try { return await task; } finally { pending.delete(word); }
    }
  };
}
module.exports = { createAssociationProvider, normalizeWord, normalizeResponse, AssociationError };
