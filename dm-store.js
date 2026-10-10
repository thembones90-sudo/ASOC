'use strict';
// DIRECT MESSAGES -- durable store for one-to-one Little Hero conversations.
//
// One JSON file (ASOC_DATA_DIR/direct-messages.json) written through
// durable-io, loaded once and kept in memory. Identity is always the stable
// account id; display names are cached only for readability.
//
//   conversations  { [pairKey]: { id, members: [a, b], names, messages, readAt, lastAt } }
//   blocks         { [playerId]: [blockedPlayerId, ...] }
//   settings       { [playerId]: { allow: 'everyone' | 'nobody' } }
//   reports        [ { id, conversationId, reporterId, reporterName, reason, at, snapshot } ]
//
// Messages older than RETENTION_MS are pruned; report snapshots are kept
// for REPORT_RETENTION_MS so the Shadow Broker can still review them.
const path = require('path');
const crypto = require('crypto');
const durableIO = require('./durable-io');

const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const FILE = process.env.ASOC_DM_FILE ? path.resolve(process.env.ASOC_DM_FILE) : path.join(DATA_DIR, 'direct-messages.json');
const RETENTION_MS = Math.max(24 * 60 * 60 * 1000, Number(process.env.ASOC_DM_RETENTION_MS) || 30 * 24 * 60 * 60 * 1000);
const REPORT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 500;
const MAX_MESSAGES_PER_CONVERSATION = 1000;

let db = null;
let healthy = true;

function blank() { return { conversations: {}, blocks: {}, settings: {}, reports: [] }; }

function load() {
  if (db) return db;
  try {
    const raw = durableIO.fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = { ...blank(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    if (!db.conversations || typeof db.conversations !== 'object') db.conversations = {};
    if (!db.blocks || typeof db.blocks !== 'object') db.blocks = {};
    if (!db.settings || typeof db.settings !== 'object') db.settings = {};
    if (!Array.isArray(db.reports)) db.reports = [];
  } catch (error) {
    if (error.code !== 'ENOENT') { console.error('[dm-store] load failed:', error.message); healthy = false; }
    db = blank();
  }
  prune();
  return db;
}

function save() {
  try { durableIO.writeJson(FILE, db); healthy = true; } catch (error) { healthy = false; console.error('[dm-store] save failed:', error.message); throw error; }
}

function prune(now = Date.now()) {
  for (const [key, convo] of Object.entries(db.conversations)) {
    convo.messages = (convo.messages || []).filter(m => now - Number(m.at || 0) < RETENTION_MS);
    if (!convo.messages.length) delete db.conversations[key];
  }
  db.reports = db.reports.filter(r => now - Number(r.at || 0) < REPORT_RETENTION_MS);
}

function pairKey(a, b) { return [String(a), String(b)].sort().join('|'); }
function newId(prefix) { return prefix + '-' + crypto.randomBytes(8).toString('hex'); }

function isBlocked(by, target) { return (load().blocks[String(by)] || []).includes(String(target)); }
function eitherBlocked(a, b) { return isBlocked(a, b) || isBlocked(b, a); }
function allowOf(playerId) { return load().settings[String(playerId)]?.allow === 'nobody' ? 'nobody' : 'everyone'; }

// Appends a message. Caller has already checked rooms/rate limits; this
// enforces blocks, the recipient's setting and text rules.
function send(from, to, text, now = Date.now(), media = null) {
  load();
  const body = String(text || '').replace(/\s+$/g, '').replace(/^\s+/g, '');
  const kind = String(media?.messageType || 'text');
  const gif = kind === 'gifRemote' && media.gif ? media.gif : null;
  const hasAttachment = !!(gif || media?.imageUrl || media?.audioUrl || media?.stickerUrl || media?.poll);
  if (!body && !hasAttachment) return { ok: false, error: 'Message is empty' };
  if (body.length > MAX_TEXT) return { ok: false, error: `Message is too long (max ${MAX_TEXT})` };
  if (String(from.id) === String(to.id)) return { ok: false, error: 'You cannot message yourself' };
  if (eitherBlocked(from.id, to.id)) return { ok: false, error: 'This message cannot be delivered' };
  if (allowOf(to.id) === 'nobody') return { ok: false, error: `${to.name} is not accepting direct messages` };
  const key = pairKey(from.id, to.id);
  const convo = db.conversations[key] || (db.conversations[key] = {
    id: newId('dm'), members: [String(from.id), String(to.id)].sort(), names: {}, messages: [], readAt: {}, lastAt: 0
  });
  convo.names[String(from.id)] = String(from.name || 'Little Hero').slice(0, 40);
  convo.names[String(to.id)] = String(to.name || convo.names[String(to.id)] || 'Little Hero').slice(0, 40);
  const message = { id: newId('dmm'), from: String(from.id), text: body, at: now };
  if (gif) {
    message.messageType = 'gifRemote';
    message.gif = {
      id: String(gif.id || '').slice(0, 120),
      gifUrl: String(gif.gifUrl || '').slice(0, 2048),
      previewUrl: String(gif.previewUrl || gif.gifUrl || '').slice(0, 2048),
      title: String(gif.title || 'GIF').slice(0, 120)
    };
  }
  if (kind === 'image' && media.imageUrl) { message.messageType = 'image'; message.imageUrl = String(media.imageUrl); }
  if (kind === 'voice' && media.audioUrl) { message.messageType = 'voice'; message.audioUrl = String(media.audioUrl); message.voiceSeconds = Math.max(1, Math.min(60, Number(media.voiceSeconds) || 1)); }
  if (kind === 'sticker' && media.stickerUrl) { message.messageType = 'sticker'; message.stickerUrl = String(media.stickerUrl); }
  if (kind === 'poll' && media.poll) { message.messageType = 'poll'; message.poll = JSON.parse(JSON.stringify(media.poll)); }
  if (media?.replyTo?.id) message.replyTo = { id:String(media.replyTo.id), from:String(media.replyTo.from || ''), name:String(media.replyTo.name || '').slice(0,40), excerpt:String(media.replyTo.excerpt || '').slice(0,120) };
  message.reactions = {};
  convo.messages.push(message);
  if (convo.messages.length > MAX_MESSAGES_PER_CONVERSATION) convo.messages.splice(0, convo.messages.length - MAX_MESSAGES_PER_CONVERSATION);
  convo.lastAt = now;
  convo.readAt[String(from.id)] = now;
  save();
  return { ok: true, conversation: convo, message };
}

function messageInConversation(conversationId, messageId) {
  const conversation = conversationById(conversationId);
  const message = conversation?.messages?.find(entry => entry.id === String(messageId));
  return conversation && message ? { conversation, message } : null;
}

function editMessage(conversationId, messageId, actorId, text, now = Date.now()) {
  const found = messageInConversation(conversationId, messageId);
  const body = String(text || '').trim();
  if (!found || found.message.from !== String(actorId)) return { ok:false, error:'Message not found' };
  if (!body || body.length > MAX_TEXT || found.message.messageType && found.message.messageType !== 'text') return { ok:false, error:'This message cannot be edited' };
  found.message.text = body; found.message.editedAt = now; save(); return { ok:true, ...found };
}

function deleteMessage(conversationId, messageId, actorId, isGm = false) {
  const found = messageInConversation(conversationId, messageId);
  if (!found || (!isGm && found.message.from !== String(actorId))) return { ok:false, error:'Message not found' };
  found.message.deleted = true; found.message.text = ''; found.message.reactions = {}; delete found.message.gif; delete found.message.imageUrl; delete found.message.audioUrl; delete found.message.voiceSeconds; delete found.message.stickerUrl; delete found.message.poll; save(); return { ok:true, ...found };
}

function reactMessage(conversationId, messageId, actorId, emoji) {
  const found = messageInConversation(conversationId, messageId);
  if (!found || found.message.deleted) return { ok:false, error:'Message not found' };
  const key = String(emoji || '').slice(0,40); if (!key) return { ok:false, error:'Invalid reaction' };
  const set = new Set(found.message.reactions?.[key] || []); set.has(String(actorId)) ? set.delete(String(actorId)) : set.add(String(actorId));
  found.message.reactions ||= {}; if (set.size) found.message.reactions[key] = [...set]; else delete found.message.reactions[key]; save(); return { ok:true, ...found };
}

function votePoll(conversationId, messageId, actorId, optionIndex) {
  const found = messageInConversation(conversationId, messageId); const poll = found?.message?.poll; const index = Number(optionIndex);
  if (poll?.expiresAt && Date.now() >= Number(poll.expiresAt)) poll.closedAt ||= Number(poll.expiresAt);
  if (!poll || poll.closedAt || !Number.isInteger(index) || index < 0 || index >= poll.options.length) return { ok:false, error:'Poll is unavailable' };
  poll.votes ||= {}; const id = String(actorId); if (!poll.allowMultiple) Object.keys(poll.votes).forEach(key => { poll.votes[key] = (poll.votes[key] || []).filter(x => x !== id); });
  const set = new Set(poll.votes[index] || []); set.has(id) ? set.delete(id) : set.add(id); poll.votes[index] = [...set]; save(); return { ok:true, ...found };
}

function conversationFor(a, b) { return load().conversations[pairKey(a, b)] || null; }
function conversationById(id) { return Object.values(load().conversations).find(c => c.id === id) || null; }

function purgeConversation(conversationId) {
  load();
  const id = String(conversationId || '');
  const entry = Object.entries(db.conversations).find(([, convo]) => convo.id === id);
  if (!entry) return null;
  const [key, convo] = entry;
  delete db.conversations[key];
  save();
  return convo;
}

function unreadCount(convo, playerId) {
  const readAt = Number(convo.readAt?.[String(playerId)] || 0);
  return convo.messages.filter(m => m.from !== String(playerId) && m.at > readAt).length;
}

// Conversation list for one player (hides threads with blocked players).
function listFor(playerId) {
  const id = String(playerId);
  return Object.values(load().conversations)
    .filter(c => c.members.includes(id))
    .map(c => {
      const otherId = c.members.find(m => m !== id);
      const last = c.messages[c.messages.length - 1] || null;
      return {
        id: c.id,
        other: { id: otherId, name: c.names[otherId] || 'Little Hero' },
        last: last ? { from: last.from, text: last.deleted ? 'MESSAGE DELETED' : last.text ? last.text.slice(0, 120) : ({ gifRemote:'GIF', image:'PHOTO', voice:'VOICE MESSAGE', sticker:'STICKER', poll:'POLL' }[last.messageType] || ''), at: last.at } : null,
        unread: unreadCount(c, id),
        blocked: isBlocked(id, otherId)
      };
    })
    .sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
}

function totalUnread(playerId) {
  const id = String(playerId);
  return Object.values(load().conversations)
    .filter(c => c.members.includes(id) && !isBlocked(id, c.members.find(m => m !== id)))
    .reduce((sum, c) => sum + unreadCount(c, id), 0);
}

function markRead(conversationId, playerId, now = Date.now()) {
  const convo = conversationById(conversationId);
  if (!convo || !convo.members.includes(String(playerId))) return false;
  convo.readAt[String(playerId)] = now;
  save();
  return true;
}

function setBlocked(by, target, blocked) {
  load();
  const list = new Set(db.blocks[String(by)] || []);
  if (blocked) list.add(String(target)); else list.delete(String(target));
  db.blocks[String(by)] = [...list];
  save();
  return [...list];
}

function setAllow(playerId, allow) {
  load();
  db.settings[String(playerId)] = { allow: allow === 'nobody' ? 'nobody' : 'everyone' };
  save();
  return db.settings[String(playerId)].allow;
}

function blockedBy(playerId) { return [...(load().blocks[String(playerId)] || [])]; }

function report(conversationId, reporter, reason, now = Date.now()) {
  const convo = conversationById(conversationId);
  if (!convo || !convo.members.includes(String(reporter.id))) return { ok: false, error: 'Conversation not found' };
  const entry = {
    id: newId('dmr'),
    conversationId: convo.id,
    members: [...convo.members],
    names: { ...convo.names },
    reporterId: String(reporter.id),
    reporterName: String(reporter.name || '').slice(0, 40),
    reason: String(reason || '').trim().slice(0, 300),
    at: now,
    snapshot: convo.messages.slice(-100).map(m => ({ ...m }))
  };
  db.reports.push(entry);
  save();
  return { ok: true, report: entry };
}

// ---- Shadow Broker oversight (read-only; never marks anything read) ----
function overview() {
  load();
  return {
    conversations: Object.values(db.conversations).map(c => ({
      id: c.id,
      members: c.members.map(id => ({ id, name: c.names[id] || 'Little Hero' })),
      count: c.messages.length,
      lastAt: c.lastAt,
      last: c.messages.length ? (c.messages[c.messages.length - 1].deleted ? 'MESSAGE DELETED' : c.messages[c.messages.length - 1].text || ({ gifRemote:'GIF', image:'PHOTO', voice:'VOICE MESSAGE', sticker:'STICKER', poll:'POLL' }[c.messages[c.messages.length - 1].messageType] || '')).slice(0, 120) : ''
    })).sort((a, b) => b.lastAt - a.lastAt),
    reports: db.reports.map(r => ({ id: r.id, conversationId: r.conversationId, names: r.names, reporterName: r.reporterName, reason: r.reason, at: r.at, count: r.snapshot.length })).sort((a, b) => b.at - a.at),
    blocks: Object.entries(db.blocks).filter(([, list]) => list.length).map(([id, list]) => ({ id, blocked: list }))
  };
}

function fullConversation(conversationId) {
  const convo = conversationById(conversationId);
  return convo ? JSON.parse(JSON.stringify(convo)) : null;
}

function fullReport(reportId) {
  const r = load().reports.find(entry => entry.id === reportId);
  return r ? JSON.parse(JSON.stringify(r)) : null;
}

// Tests only: forget the in-memory copy so the next call re-reads disk.
function _reset() { db = null; }

module.exports = {
  MAX_TEXT,
  RETENTION_MS,
  isHealthy() { try { load(); return healthy; } catch { return false; } },
  send, editMessage, deleteMessage, reactMessage, votePoll, listFor, totalUnread, markRead, conversationFor, conversationById, purgeConversation, unreadCount,
  setBlocked, blockedBy, isBlocked, setAllow, allowOf, report,
  overview, fullConversation, fullReport, pairKey, _reset
};
