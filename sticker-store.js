'use strict';
// STICKERS -- durable per-player sticker libraries ("My stickers").
//
// One JSON file (ASOC_DATA_DIR/stickers.json) written through durable-io,
// loaded once and kept in memory:
//
//   libraries { [playerId]: [ { id, url, addedAt } ] }   newest first
//
// The image files themselves live in chat-uploads/ like any chat image; this
// file referencing them is what keeps the orphan sweeper from removing a
// saved sticker after its chat message scrolls out of history. A library
// entry may also point at a built-in pack sticker (/assets/stickers/...) or
// at a sticker someone else made ("add to my stickers").
const path = require('path');
const crypto = require('crypto');
const durableIO = require('./durable-io');

const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const FILE = process.env.ASOC_STICKER_FILE ? path.resolve(process.env.ASOC_STICKER_FILE) : path.join(DATA_DIR, 'stickers.json');
const MAX_PER_PLAYER = 120;
const UPLOAD_URL = /^\/uploads\/chat\/[a-f0-9]{32}\.(?:png|webp|gif)$/i;
const PACK_URL = /^\/assets\/stickers\/[a-z0-9-]{1,40}\.(?:svg|png|webp)$/;

let db = null;

function load() {
  if (db) return db;
  try {
    const parsed = JSON.parse(durableIO.fs.readFileSync(FILE, 'utf8'));
    db = { libraries: parsed && typeof parsed.libraries === 'object' && parsed.libraries ? parsed.libraries : {} };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[sticker-store] load failed:', error.message);
    db = { libraries: {} };
  }
  return db;
}

function save() { durableIO.writeJson(FILE, db); }

function validUrl(url) { return typeof url === 'string' && (UPLOAD_URL.test(url) || PACK_URL.test(url)); }

function list(playerId) {
  return (load().libraries[String(playerId)] || []).map(entry => ({ id: entry.id, url: entry.url, addedAt: entry.addedAt }));
}

function has(playerId, url) { return (load().libraries[String(playerId)] || []).some(entry => entry.url === url); }

// Adds a sticker to the front of a player's library. Re-adding an existing
// one just moves it to the front. Returns { ok, sticker } or { ok:false, error }.
function add(playerId, url, now = Date.now()) {
  if (!validUrl(url)) return { ok: false, error: 'Not a sticker' };
  load();
  const key = String(playerId);
  const library = db.libraries[key] || [];
  const existing = library.find(entry => entry.url === url);
  const rest = library.filter(entry => entry.url !== url);
  if (!existing && rest.length >= MAX_PER_PLAYER) return { ok: false, error: `Sticker library is full (${MAX_PER_PLAYER}). Remove one first.` };
  const sticker = existing || { id: 'st-' + crypto.randomBytes(6).toString('hex'), url, addedAt: now };
  db.libraries[key] = [sticker, ...rest];
  save();
  return { ok: true, sticker: { id: sticker.id, url: sticker.url, addedAt: sticker.addedAt } };
}

function remove(playerId, id) {
  load();
  const key = String(playerId);
  const library = db.libraries[key] || [];
  const next = library.filter(entry => entry.id !== id);
  if (next.length === library.length) return { ok: false, error: 'Sticker not found' };
  if (next.length) db.libraries[key] = next; else delete db.libraries[key];
  save();
  return { ok: true };
}

function _reset() { db = null; }

module.exports = { FILE, MAX_PER_PLAYER, validUrl, isPackUrl: url => PACK_URL.test(String(url || '')), list, has, add, remove, _reset };
