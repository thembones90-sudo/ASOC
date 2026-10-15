'use strict';
// OUTBOUND WEBSOCKET PAYLOAD DIAGNOSTICS
//
// Privacy-safe, aggregate-only accounting of what the server puts on the
// wire. Every outbound frame is classified into a small whitelist of frame
// CATEGORIES and measured by byte length. Nothing else is retained: no
// message text, player name, room code, token, URL, image data or any other
// payload content ever reaches a counter or a log line.
//
// This exists to answer "why did the socket queue grow so large?" without
// logging anything sensitive. The production 48 MB backlog could not be
// attributed because the only signal was the raw buffered byte count; a
// per-category size histogram makes the offending frame class observable
// while keeping the payload itself private.
//
// Counters are bounded (a fixed category set) and a periodic aggregate line
// is emitted every REPORT_EVERY frames (override with
// ASOC_WS_PAYLOAD_REPORT_EVERY for tests). The server still owns the actual
// backpressure warnings; this module never disconnects or mutates a socket.

const LARGE_FRAME_BYTES = 512 * 1024;

// Only frame types the server actually emits are named. Anything else folds
// into 'other' so an unexpected or hostile payload can never smuggle a value
// into the log through the category field.
const CATEGORIES = Object.freeze([
  'state:public',
  'chat:update',
  'chat:delta',
  'chat:history',
  'players:update',
  'tribute:vault',
  'timer:tick',
  'join:success',
  'game:loaded',
  'host:recovered',
  'recount:update',
  'ritual:update'
]);

const REPORT_EVERY = Math.max(1, Number(process.env.ASOC_WS_PAYLOAD_REPORT_EVERY) || 500);

// The frame prefix is enough to read the type and is all this module ever
// inspects. A JSON frame opens with {"type":"..."; a bounded slice keeps the
// scan cheap on multi-megabyte frames.
function frameCategory(data) {
  const raw = Buffer.isBuffer(data)
    ? data.toString('utf8', 0, 96)
    : String(data).slice(0, 96);
  const match = /^\{"type":"([A-Za-z][A-Za-z0-9:_-]{0,31})"/.exec(raw);
  const type = match ? match[1] : '';
  return CATEGORIES.includes(type) ? type : 'other';
}

function frameBytes(data) {
  return Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data));
}

const stats = {
  frames: 0,
  bytes: 0,
  maxBytes: 0,
  maxBuffered: 0,
  largeFrames: 0,
  byCategory: new Map()
};

function bucket(category) {
  let entry = stats.byCategory.get(category);
  if (!entry) {
    entry = { frames: 0, bytes: 0, maxBytes: 0, largeFrames: 0 };
    stats.byCategory.set(category, entry);
  }
  return entry;
}

function snapshot() {
  const byCategory = {};
  for (const [key, entry] of stats.byCategory) byCategory[key] = { ...entry };
  return {
    frames: stats.frames,
    bytes: stats.bytes,
    maxBytes: stats.maxBytes,
    maxBuffered: stats.maxBuffered,
    largeFrames: stats.largeFrames,
    byCategory
  };
}

function report() {
  console.log('[ws-payload] ' + JSON.stringify(snapshot()));
}

function observe(data, bufferedBytes = 0) {
  const category = frameCategory(data);
  const bytes = frameBytes(data);
  const buffered = Number(bufferedBytes) || 0;
  stats.frames += 1;
  stats.bytes += bytes;
  if (bytes > stats.maxBytes) stats.maxBytes = bytes;
  if (buffered > stats.maxBuffered) stats.maxBuffered = buffered;
  const entry = bucket(category);
  entry.frames += 1;
  entry.bytes += bytes;
  if (bytes > entry.maxBytes) entry.maxBytes = bytes;
  if (bytes >= LARGE_FRAME_BYTES) {
    stats.largeFrames += 1;
    entry.largeFrames += 1;
  }
  if (stats.frames % REPORT_EVERY === 0) report();
  return { category, bytes };
}

function reset() {
  stats.frames = 0;
  stats.bytes = 0;
  stats.maxBytes = 0;
  stats.maxBuffered = 0;
  stats.largeFrames = 0;
  stats.byCategory.clear();
}

module.exports = { LARGE_FRAME_BYTES, CATEGORIES, frameCategory, observe, snapshot, reset, report };
