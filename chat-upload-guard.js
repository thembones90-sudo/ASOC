'use strict';

// CHAT UPLOAD GUARD -- keeps player image uploads from exhausting the durable
// volume. Three independent protections:
//   1. per-actor throttle (count + bytes per window, and a minimum gap), so
//      one Little Hero cannot stream 5 MB uploads back to back;
//   2. a capacity guard: a total budget for chat-uploads/ plus a floor of
//      free disk space, so uploads are refused long before durable room /
//      player writes could fail (a failed durable write takes ASOC offline);
//   3. an orphan sweeper that removes upload files NOTHING references any
//      more. It is deliberately conservative: a file survives if its name
//      appears anywhere in live room state or in ANY durable JSON store
//      (chat history, Blood Tribute vault, Reliquary, DMs, match archive...),
//      if it carries a .tribute marker, or if it is younger than the grace
//      period. A file is only removed when no ASOC system can still use it.

const fs = require('fs');
const path = require('path');

const UPLOAD_NAME = /^[a-f0-9]{32}\.(?:png|jpg|webp|gif|webm|ogg|m4a)$/i;
const UPLOAD_NAME_GLOBAL = /[a-f0-9]{32}\.(?:png|jpg|webp|gif|webm|ogg|m4a)/gi;

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function createChatUploadGuard(options = {}) {
  const dir = options.dir;
  const limits = {
    windowMs: options.windowMs ?? numberEnv('ASOC_CHAT_UPLOAD_WINDOW_MS', 5 * 60 * 1000),
    maxCount: options.maxCount ?? numberEnv('ASOC_CHAT_UPLOAD_MAX_COUNT', 8),
    maxBytes: options.maxBytes ?? numberEnv('ASOC_CHAT_UPLOAD_MAX_WINDOW_BYTES', 25 * 1024 * 1024),
    minGapMs: options.minGapMs ?? numberEnv('ASOC_CHAT_UPLOAD_MIN_GAP_MS', 3000),
    budgetBytes: options.budgetBytes ?? numberEnv('ASOC_CHAT_UPLOAD_BUDGET_BYTES', 2 * 1024 * 1024 * 1024),
    minFreeBytes: options.minFreeBytes ?? numberEnv('ASOC_MIN_FREE_DISK_BYTES', 256 * 1024 * 1024),
    graceMs: options.graceMs ?? numberEnv('ASOC_CHAT_UPLOAD_SWEEP_GRACE_MS', 24 * 60 * 60 * 1000)
  };
  const history = new Map(); // actorKey -> [{ at, bytes }]
  let usedBytes = 0;

  function measure() {
    let total = 0;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!UPLOAD_NAME.test(name)) continue;
        try { total += fs.statSync(path.join(dir, name)).size; } catch {}
      }
    } catch {}
    usedBytes = total;
    return total;
  }
  measure();

  function recent(actorKey, now, lim = limits) {
    const kept = (history.get(actorKey) || []).filter(entry => now - entry.at < lim.windowMs);
    if (kept.length) history.set(actorKey, kept); else history.delete(actorKey);
    return kept;
  }

  // Checked BEFORE a body is read, so a throttled actor costs no bandwidth.
  // `overrides` gives a kind of upload (voice) its own allowance.
  function checkActor(actorKey, now = Date.now(), overrides = null) {
    const limits_ = overrides ? { ...limits, ...overrides } : limits;
    const entries = recent(actorKey, now, limits_);
    const last = entries[entries.length - 1];
    if (last && now - last.at < limits_.minGapMs) {
      return { ok: false, retryAfterMs: limits_.minGapMs - (now - last.at), error: 'Uploads are cooling down. Try again in a moment.' };
    }
    if (entries.length >= limits_.maxCount) {
      return { ok: false, retryAfterMs: limits_.windowMs - (now - entries[0].at), error: 'Upload limit reached. Try again in a few minutes.' };
    }
    const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (bytes >= limits_.maxBytes) {
      return { ok: false, retryAfterMs: limits_.windowMs - (now - entries[0].at), error: 'Upload volume limit reached. Try again in a few minutes.' };
    }
    return { ok: true };
  }

  // Reserves the slot as soon as an attempt is accepted, so parallel requests
  // cannot all pass checkActor before any of them finishes.
  function reserve(actorKey, now = Date.now()) {
    const entries = recent(actorKey, now);
    const entry = { at: now, bytes: 0 };
    entries.push(entry);
    history.set(actorKey, entries);
    return entry;
  }

  function freeDiskBytes() {
    if (typeof fs.statfsSync !== 'function') return Infinity;
    try {
      const stats = fs.statfsSync(dir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return Infinity;
    }
  }

  function checkCapacity(incomingBytes) {
    if (usedBytes + incomingBytes > limits.budgetBytes) {
      return { ok: false, error: 'Chat image storage is full. Uploads are paused until space is reclaimed.' };
    }
    if (freeDiskBytes() - incomingBytes < limits.minFreeBytes) {
      return { ok: false, error: 'Server storage is low. Uploads are paused to protect the game.' };
    }
    return { ok: true };
  }

  function recordStored(entry, bytes) {
    if (entry) entry.bytes = bytes;
    usedBytes += bytes;
  }

  // referenceSources: strings (serialized state) and file paths (JSON stores).
  function sweep({ texts = [], files = [], now = Date.now() } = {}) {
    const referenced = new Set();
    const collect = text => {
      for (const match of String(text || '').matchAll(UPLOAD_NAME_GLOBAL)) referenced.add(match[0].toLowerCase());
    };
    texts.forEach(collect);
    for (const file of files) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
        if (error.code === 'ENOENT') continue;
        // An unreadable store could hold references we cannot see: never
        // delete anything on a partial view.
        return { ok: false, error: `Cannot read ${path.basename(file)}: ${error.message}`, removed: [] };
      }
      collect(text);
    }
    let names;
    try { names = fs.readdirSync(dir); } catch (error) { return { ok: false, error: error.message, removed: [] }; }
    const markers = new Set(names.filter(name => name.endsWith('.tribute')).map(name => name.slice(0, -'.tribute'.length).toLowerCase()));
    const removed = [];
    for (const name of names) {
      if (!UPLOAD_NAME.test(name)) continue;
      const key = name.toLowerCase();
      if (referenced.has(key) || markers.has(key)) continue;
      const full = path.join(dir, name);
      let stats;
      try { stats = fs.statSync(full); } catch { continue; }
      if (now - stats.mtimeMs < limits.graceMs) continue;
      try { fs.unlinkSync(full); removed.push(name); } catch {}
    }
    measure();
    return { ok: true, removed, usedBytes };
  }

  return {
    limits,
    checkActor,
    reserve,
    checkCapacity,
    recordStored,
    sweep,
    measure,
    usedBytes: () => usedBytes
  };
}

module.exports = { createChatUploadGuard, UPLOAD_NAME };
