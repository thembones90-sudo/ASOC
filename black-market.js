'use strict';

const crypto = require('crypto');

const REQUEST_LIMIT = 1200;
const TITLE_LIMIT = 120;
const NOTE_LIMIT = 800;
const CATEGORIES = new Set(['DESIGN', 'WRITING', 'TECH', 'RESEARCH', 'CUSTOM']);
const PACT_STATES = new Set([
  'SUBMITTED', 'COUNTEROFFERED', 'APPROVED_PENDING_TRIBUTE', 'DEBT_WAIVED',
  'TRIBUTE_SUBMITTED', 'TRIBUTE_REJECTED', 'OWED', 'IN_PROGRESS', 'FULFILLED',
  'DENIED', 'BROKEN'
]);

function cleanText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizePact(raw) {
  const state = PACT_STATES.has(raw?.state) ? raw.state : 'SUBMITTED';
  return {
    id: cleanText(raw?.id, 80) || ('pact-' + crypto.randomBytes(8).toString('hex')),
    playerId: cleanText(raw?.playerId, 120),
    playerName: cleanText(raw?.playerName, 80) || 'LITTLE HERO',
    title: cleanText(raw?.title, TITLE_LIMIT) || 'UNNAMED PETITION',
    category: CATEGORIES.has(raw?.category) ? raw.category : 'CUSTOM',
    request: cleanText(raw?.request, REQUEST_LIMIT),
    terms: cleanText(raw?.terms, NOTE_LIMIT),
    state,
    tributeRequired: raw?.tributeRequired === true,
    tributeImageData: state === 'TRIBUTE_SUBMITTED' ? String(raw?.tributeImageData || '') : '',
    tributeImageUrl: state === 'TRIBUTE_SUBMITTED' ? cleanText(raw?.tributeImageUrl, 240) : '',
    tributeId: cleanText(raw?.tributeId, 120) || null,
    rejectionReason: cleanText(raw?.rejectionReason, NOTE_LIMIT),
    tributeLevel: Math.max(1, Math.min(10, Math.round(Number(raw?.tributeLevel) || 1))),
    demandedAt: Number(raw?.demandedAt) || null,
    seenAt: Number(raw?.seenAt) || null,
    createdAt: Number(raw?.createdAt) || Date.now(),
    updatedAt: Number(raw?.updatedAt) || Date.now(),
    fulfilledAt: Number(raw?.fulfilledAt) || null
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const byPlayer = {};
  for (const [playerId, source] of Object.entries(state.byPlayer || {})) {
    if (!source || typeof source !== 'object') continue;
    const pacts = Array.isArray(source.pacts)
      ? source.pacts.map(normalizePact).filter(p => p.playerId === String(playerId)).slice(-100)
      : [];
    const rememberedLevel = Math.max(0, Math.min(10, Math.round(Number(source.tributeLevel) || 0)));
    const latestPactLevel = pacts.find(p => p.tributeRequired)?.tributeLevel || 0;
    byPlayer[String(playerId)] = { pacts, tributeLevel: rememberedLevel || latestPactLevel || 0 };
  }
  return { byPlayer };
}

function ensurePlayer(state, playerId) {
  const id = String(playerId || '');
  if (!id) return null;
  if (!state.byPlayer[id]) state.byPlayer[id] = { pacts: [], tributeLevel: 0 };
  if (!Number.isFinite(Number(state.byPlayer[id].tributeLevel))) state.byPlayer[id].tributeLevel = 0;
  return state.byPlayer[id];
}
function publicPact(pact, host = false) {
  const copy = {
    id: pact.id, playerId: pact.playerId, playerName: pact.playerName,
    title: pact.title, category: pact.category, request: pact.request, terms: pact.terms,
    state: pact.state, tributeRequired: pact.tributeRequired,
    tributeId: pact.tributeId, rejectionReason: pact.rejectionReason,
    tributeLevel: pact.tributeLevel, demandedAt: pact.demandedAt, seenAt: pact.seenAt,
    createdAt: pact.createdAt, updatedAt: pact.updatedAt, fulfilledAt: pact.fulfilledAt
  };
  if (host && pact.state === 'TRIBUTE_SUBMITTED') {
    copy.tributeImageData = pact.tributeImageData;
    copy.tributeImageUrl = pact.tributeImageUrl;
  }
  return copy;
}

function playerView(state, playerId) {
  const bucket = ensurePlayer(state, playerId);
  const pacts = (bucket?.pacts || []).map(p => publicPact(p, false)).reverse();
  return { revision: pacts.reduce((max, pact) => Math.max(max, Number(pact.updatedAt) || 0), 0), tributeLevel: Math.max(0, Math.min(10, Number(bucket?.tributeLevel) || 0)), pacts };
}

function gmView(state) {
  const pacts = Object.values(state.byPlayer || {})
    .flatMap(bucket => bucket.pacts || [])
    .map(p => publicPact(p, true))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return { revision: pacts.reduce((max, pact) => Math.max(max, Number(pact.updatedAt) || 0), 0), pacts };
}

function createPetition(state, player, raw) {
  const bucket = ensurePlayer(state, player.id);
  const active = bucket.pacts.find(p => !['FULFILLED', 'DENIED', 'BROKEN'].includes(p.state));
  if (active) return { error: 'ONE PACT ALREADY BINDS YOU' };
  const request = cleanText(raw?.request, REQUEST_LIMIT);
  if (!request) return { error: 'A PETITION REQUIRES WORDS' };
  const pact = normalizePact({
    playerId: String(player.id),
    playerName: player.name,
    title: cleanText(raw?.title, TITLE_LIMIT) || request.slice(0, 60),
    category: CATEGORIES.has(raw?.category) ? raw.category : 'CUSTOM',
    request,
    state: 'SUBMITTED'
  });
  bucket.pacts.push(pact);
  return { pact };
}

function findPact(state, pactId) {
  const id = String(pactId || '');
  for (const bucket of Object.values(state.byPlayer || {})) {
    const pact = (bucket.pacts || []).find(p => p.id === id);
    if (pact) return pact;
  }
  return null;
}

function createGmTributeDebt(state, player, raw) {
  const bucket = ensurePlayer(state, player?.id);
  if (!bucket) return { error: 'LITTLE HERO NOT FOUND' };
  const reason = cleanText(raw?.reason, REQUEST_LIMIT);
  const tributeLevel = Math.max(1, Math.min(10, Math.round(Number(raw?.tributeLevel) || 1)));
  const now = Date.now();
  const pact = normalizePact({
    playerId: String(player.id),
    playerName: player.name,
    title: 'BLOOD TRIBUTE REQUIRED',
    category: 'CUSTOM',
    request: reason || 'A debt has been called by the Shadow Broker.',
    terms: 'Payment is due to the Reliquary.',
    state: 'APPROVED_PENDING_TRIBUTE',
    tributeRequired: true,
    tributeLevel,
    demandedAt: now,
    updatedAt: now
  });
  bucket.tributeLevel = tributeLevel;
  bucket.pacts.push(pact);
  return { pact };
}

function markTributeSeen(state, playerId, pactId) {
  const pact = findPact(state, pactId);
  if (!pact || pact.playerId !== String(playerId) || !pact.tributeRequired || !pact.demandedAt) {
    return { error: 'TRIBUTE DEMAND NOT FOUND' };
  }
  if (!pact.seenAt) {
    pact.seenAt = Date.now();
    pact.updatedAt = pact.seenAt;
  }
  return { pact };
}

function gmDecision(state, raw) {
  const pact = findPact(state, raw?.pactId);
  if (!pact) return { error: 'PACT NOT FOUND' };
  const action = String(raw?.action || '');
  const now = Date.now();
  if (action === 'accept') {
    pact.terms = cleanText(raw?.terms, NOTE_LIMIT);
    pact.tributeRequired = true;
    pact.state = 'APPROVED_PENDING_TRIBUTE';
  } else if (action === 'waive') {
    pact.terms = cleanText(raw?.terms, NOTE_LIMIT);
    pact.tributeRequired = false;
    pact.state = 'OWED';
  } else if (action === 'counter') {
    pact.terms = cleanText(raw?.terms, NOTE_LIMIT);
    if (!pact.terms) return { error: 'REWRITTEN TERMS REQUIRED' };
    pact.tributeRequired = raw?.tributeRequired !== false;
    pact.state = 'COUNTEROFFERED';
  } else if (action === 'deny') {
    pact.terms = cleanText(raw?.terms, NOTE_LIMIT);
    pact.state = 'DENIED';
    pact.tributeImageData = '';
    pact.tributeImageUrl = '';
  } else if (action === 'progress') {
    pact.state = 'IN_PROGRESS';
  } else if (action === 'fulfill') {
    pact.state = 'FULFILLED';
    pact.fulfilledAt = now;
  } else if (action === 'break') {
    pact.state = 'BROKEN';
    pact.tributeImageData = '';
    pact.tributeImageUrl = '';
  } else {
    return { error: 'UNKNOWN PACT ACTION' };
  }
  pact.updatedAt = now;
  return { pact };
}

function acceptCounter(state, playerId, pactId) {
  const pact = findPact(state, pactId);
  if (!pact || pact.playerId !== String(playerId) || pact.state !== 'COUNTEROFFERED') {
    return { error: 'NO REWRITTEN TERMS AWAIT YOU' };
  }
  pact.state = pact.tributeRequired ? 'APPROVED_PENDING_TRIBUTE' : 'OWED';
  pact.updatedAt = Date.now();
  return { pact };
}

function submitTribute(state, playerId, pactId, imageRef, consent) {
  const pact = findPact(state, pactId);
  if (!pact || pact.playerId !== String(playerId)) return { error: 'PACT NOT FOUND' };
  if (pact.state !== 'APPROVED_PENDING_TRIBUTE' && pact.state !== 'TRIBUTE_REJECTED') {
    return { error: 'BLOOD IS NOT OWED FOR THIS PACT' };
  }
  if (consent !== true) return { error: 'TRIBUTE TERMS MUST BE ACKNOWLEDGED' };
  const value = String(imageRef || '');
  pact.tributeImageData = value.startsWith('data:image/') ? value : '';
  pact.tributeImageUrl = /^\/uploads\/chat\/[a-f0-9]{32}\.(?:png|jpg|webp)$/i.test(value) ? value : '';
  if (!pact.tributeImageData && !pact.tributeImageUrl) return { error: 'THE OFFERING IS INVALID' };
  pact.rejectionReason = '';
  pact.state = 'TRIBUTE_SUBMITTED';
  pact.updatedAt = Date.now();
  return { pact };
}

function judgeTribute(state, pactId, accepted, reason, tributeId) {
  const pact = findPact(state, pactId);
  if (!pact || pact.state !== 'TRIBUTE_SUBMITTED') return { error: 'NO TRIBUTE AWAITS JUDGMENT' };
  if (accepted) {
    pact.tributeId = tributeId;
    pact.tributeImageData = '';
    pact.tributeImageUrl = '';
    pact.state = 'OWED';
  } else {
    pact.tributeImageData = '';
    pact.tributeImageUrl = '';
    pact.rejectionReason = cleanText(reason, NOTE_LIMIT);
    pact.state = 'TRIBUTE_REJECTED';
  }
  pact.updatedAt = Date.now();
  return { pact };
}

module.exports = {
  normalizeState,
  playerView,
  gmView,
  createPetition,
  createGmTributeDebt,
  markTributeSeen,
  gmDecision,
  acceptCounter,
  submitTribute,
  judgeTribute,
  findPact
};
