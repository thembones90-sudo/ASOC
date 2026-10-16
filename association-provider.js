'use strict';

// Official API only; deliberately independent of authored games and persistence.
const datamuse = require('./datamuse-provider');
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
function normalizeMode(value = 'associated') {
  if (!['associated', 'means_like'].includes(value)) throw new AssociationError(400, 'Choose ASSOCIATED or MEANS LIKE.');
  return value;
}
function createAssociationProvider({ provider = datamuse, fetchImpl = globalThis.fetch, configureRequest = (url, init) => ({ url, init }), now = Date.now, ttlMs = 86400000, timeoutMs = 10000, maxEntries = 256, minIntervalMs = 1500 } = {}) {
  const cache = new Map(), pending = new Map();
  let nextRequestAt = 0;
  return {
    async fetch(value, options = {}) {
      const word = normalizeWord(value);
      const mode = normalizeMode(options.mode);
      const cacheKey = `${provider.id}|${word}|${mode}`;
      const hit = cache.get(cacheKey);
      if (hit && hit.expiresAt > now()) return { ...hit.result, cached: true };
      if (pending.has(cacheKey)) return pending.get(cacheKey);
      if (pending.size >= 2 || now() < nextRequestAt) throw new AssociationError(429, 'Please wait a moment before fetching another word.');
      nextRequestAt = now() + minIntervalMs;
      const task = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          // Server-only adapter supports future documented auth without changing the UI.
          const request = configureRequest(provider.buildUrl(word, mode), { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
          const response = await fetchImpl(request.url, request.init);
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
          let items;
          try { items = provider.normalizeResponse(data, word); } catch { throw new AssociationError(502, 'Association service returned an invalid response.'); }
          const result = { source: provider.source, provider: provider.id, word: word.toUpperCase(), mode, items, fetchedAt: new Date(now()).toISOString() };
          cache.delete(cacheKey);
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
          cache.set(cacheKey, { result, expiresAt: now() + ttlMs });
          return { ...result, cached: false };
        } catch (error) {
          if (error instanceof AssociationError) throw error;
          throw new AssociationError(502, controller.signal.aborted ? 'Association service timed out. Try again.' : 'Association service temporarily unavailable.');
        } finally { clearTimeout(timer); }
      })();
      pending.set(cacheKey, task);
      try { return await task; } finally { pending.delete(cacheKey); }
    }
  };
}
module.exports = { createAssociationProvider, normalizeWord, normalizeMode, AssociationError };
