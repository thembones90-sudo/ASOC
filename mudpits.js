'use strict';

// THE MUD PITS -- a GM-invoked, server-authoritative sentence duel.
//
// Two contestants (the GM may be one of them) each write ONE sentence in
// private. Nobody -- GM included -- sees either entry until the pit reveals
// both at once. The crowd (active, authenticated contestants-excluded players)
// then votes for 60 seconds. The higher vote total takes the pit and exactly
// one Shadow Coin; ties and silent crowds award nothing.
//
// This module is deliberately PURE: no sockets, no timers, no I/O. The server
// owns delivery, persistence and the economy; this owns the rules. That split
// is what lets us unit-test concealment, timing, voting and settlement without
// standing up a server, and it is the same shape as roulette-carnage.js.
//
// CONCEALMENT INVARIANT: entry text lives only in `state.entries` and is never
// exposed by view() unless `state.revealedAt` is set. view() is the ONLY
// function the server is allowed to hand to a client, so text cannot leak
// through a state payload, a reconnect snapshot, or a spectator broadcast.

const PHASES = Object.freeze({
  WRITING: 'WRITING',
  REVEAL: 'REVEAL',
  VOTING: 'VOTING',
  RESULT: 'RESULT',
  CANCELLED: 'CANCELLED'
});

const PHASE_SET = new Set(Object.values(PHASES));

// A single sentence. Long enough for a cruel one-liner, short enough that the
// reveal card stays readable on a phone.
const MAX_TEXT = 250;

function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Production windows. Tests shrink these through the environment so a full
// duel can run inside a single test process without sleeping for minutes.
const WRITE_MS = envMs('ASOC_MUD_PITS_WRITE_MS', 90000);
const READ_MS = envMs('ASOC_MUD_PITS_READ_MS', 5000);
const VOTE_MS = envMs('ASOC_MUD_PITS_VOTE_MS', 60000);

// Input hygiene only: flatten to one line, strip ASCII control characters and
// collapse runs of whitespace. HTML escaping happens once on the client, right
// before insertion (same contract as sanitizeText in server.js). We do NOT
// HTML-encode here, or every "&" would double-escape on render.
function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    ;
}

function validateEntry(value) {
  if (typeof value !== 'string') return { ok: false, error: 'WRITE ONE SENTENCE FIRST' };
  const cleaned = cleanText(value);
  if (!cleaned) return { ok: false, error: 'WRITE ONE SENTENCE FIRST' };
  if (cleaned.length > MAX_TEXT) return { ok: false, error: `YOUR SENTENCE MUST BE ${MAX_TEXT} CHARACTERS OR LESS` };
  const terminals = cleaned.match(/[.!?](?=\s+[A-ZÀ-Ž0-9"'“„])/g) || [];
  if (terminals.length > 0) return { ok: false, error: 'ONE SENTENCE ONLY' };
  return { ok: true, text: cleaned };
}

function isContestant(state, id) {
  return !!state && state.contestantIds.includes(String(id || ''));
}

function idList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const id = String((raw && raw.id != null ? raw.id : raw) || '');
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// Build a brand new duel. `contestants` is [{id, name}, {id, name}] and the
// caller (server) has already resolved both to live, distinct, non-test
// identities. newDuel trusts that resolution but still enforces distinctness
// so a malformed call can never produce a one-sided pit.
function newDuel({ id, contestants, now = Date.now() } = {}) {
  const ids = idList(contestants).slice(0, 2);
  if (!id) throw new Error('mudpits:newDuel requires an id');
  if (ids.length !== 2) throw new Error('mudpits:newDuel requires two distinct contestants');

  const names = {};
  for (const c of contestants) {
    const cid = String((c && c.id != null ? c.id : c) || '');
    if (cid) names[cid] = String((c && c.name) || 'LITTLE HERO').slice(0, 40);
  }

  const entries = {};
  const submitted = {};
  for (const cid of ids) {
    entries[cid] = null;
    submitted[cid] = false;
  }

  return {
    id: String(id),
    phase: PHASES.WRITING,
    createdAt: now,
    contestantIds: ids,
    names,
    entries,
    submitted,
    submittedAt: {},
    revealedAt: null,
    writeDeadline: now + WRITE_MS,
    readDeadline: null,
    voteDeadline: null,
    votes: {},
    settled: false,
    settledAt: null,
    winnerId: null,
    tie: false,
    noEntries: false,
    awarded: false,
    awardedTo: null,
    cancelled: false,
    cancelReason: null
  };
}

function asDeadline(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Rehydrate persisted state defensively. Anything that fails validation
// returns null, which the server treats as "no duel" -- a corrupt snapshot
// must never resurrect as a half-built pit.
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!PHASE_SET.has(raw.phase)) return null;

  const id = String(raw.id || '');
  if (!id) return null;

  const contestantIds = idList(raw.contestantIds).slice(0, 2);
  if (contestantIds.length !== 2) return null;

  const names = {};
  const rawNames = raw.names && typeof raw.names === 'object' ? raw.names : {};
  for (const cid of contestantIds) {
    names[cid] = String(rawNames[cid] || 'LITTLE HERO').slice(0, 40);
  }

  const rawEntries = raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
  const rawSubmitted = raw.submitted && typeof raw.submitted === 'object' ? raw.submitted : {};
  const entries = {};
  const submitted = {};
  for (const cid of contestantIds) {
    entries[cid] = cleanText(rawEntries[cid]) || null;
    submitted[cid] = rawSubmitted[cid] === true || !!entries[cid];
  }

  const rawVotes = raw.votes && typeof raw.votes === 'object' ? raw.votes : {};
  const votes = {};
  for (const [voter, pick] of Object.entries(rawVotes)) {
    const voterId = String(voter || '');
    const pickId = String(pick || '');
    if (voterId && contestantIds.includes(pickId)) votes[voterId] = pickId;
  }

  const revealedAt = asDeadline(raw.revealedAt);
  const phase = raw.phase;
  // A snapshot taken after reveal must keep its revealedAt, or we would
  // un-reveal text that was already public. Phases past WRITING imply reveal.
  const impliedReveal = phase === PHASES.REVEAL || phase === PHASES.VOTING || phase === PHASES.RESULT;

  const state = {
    id,
    phase,
    createdAt: Number(raw.createdAt) || Date.now(),
    contestantIds,
    names,
    entries,
    submitted,
    submittedAt: raw.submittedAt && typeof raw.submittedAt === 'object' ? raw.submittedAt : {},
    revealedAt: revealedAt || (impliedReveal ? Date.now() : null),
    writeDeadline: asDeadline(raw.writeDeadline) || Date.now(),
    readDeadline: asDeadline(raw.readDeadline),
    voteDeadline: asDeadline(raw.voteDeadline),
    votes,
    settled: raw.settled === true || phase === PHASES.RESULT || phase === PHASES.CANCELLED,
    settledAt: asDeadline(raw.settledAt),
    winnerId: contestantIds.includes(String(raw.winnerId || '')) ? String(raw.winnerId) : null,
    tie: raw.tie === true,
    noEntries: raw.noEntries === true,
    awarded: raw.awarded === true,
    awardedTo: raw.awardedTo && contestantIds.includes(String(raw.awardedTo.id || ''))
      ? { id: String(raw.awardedTo.id), name: String(raw.awardedTo.name || names[raw.awardedTo.id] || 'LITTLE HERO') }
      : null,
    cancelled: raw.cancelled === true || phase === PHASES.CANCELLED,
    cancelReason: raw.cancelReason ? String(raw.cancelReason).slice(0, 120) : null
  };

  if (state.phase === PHASES.REVEAL && !state.readDeadline) state.readDeadline = Date.now();
  if (state.phase === PHASES.VOTING && !state.voteDeadline) state.voteDeadline = Date.now();
  return state;
}

// Lock in what was written at the writing deadline and open the read window.
function reveal(state, at) {
  state.phase = PHASES.REVEAL;
  state.revealedAt = at;
  state.readDeadline = at + READ_MS;
  for (const cid of state.contestantIds) {
    if (state.entries[cid]) {
      state.submitted[cid] = true;
    } else {
      state.entries[cid] = null;
      state.submitted[cid] = false;
    }
  }
}

function openVoting(state, at) {
  state.phase = PHASES.VOTING;
  state.voteDeadline = at + VOTE_MS;
}

function tally(state) {
  const counts = {};
  for (const cid of state.contestantIds) counts[cid] = 0;
  for (const pick of Object.values(state.votes)) {
    if (counts[pick] != null) counts[pick] += 1;
  }
  return counts;
}

function totalVotes(state) {
  return Object.keys(state.votes).length;
}

function settle(state, at) {
  state.phase = PHASES.RESULT;
  state.settled = true;
  state.settledAt = at;

  const counts = tally(state);
  state.counts = counts;

  const withEntries = state.contestantIds.filter(cid => !!state.entries[cid]);
  state.noEntries = withEntries.length === 0;

  let winnerId = null;
  if (withEntries.length === state.contestantIds.length) {
    const ranked = withEntries.slice().sort((a, b) => counts[b] - counts[a]);
    const top = counts[ranked[0]];
    const runnerUp = ranked[1] != null ? counts[ranked[1]] : -1;
    if (top > 0 && top > runnerUp) winnerId = ranked[0];
  }
  state.winnerId = winnerId;
  state.tie = !winnerId;
}

// Advance time-based phase changes. Returns which transitions fired so the
// server can announce exactly once. Idempotent: calling it twice in the same
// window does nothing the second time.
function tick(state, now = Date.now()) {
  const events = [];
  if (!state || state.settled || state.phase === PHASES.CANCELLED) {
    return { changed: false, events, settled: !!(state && state.settled), winnerId: state ? state.winnerId : null };
  }

  if (state.phase === PHASES.WRITING && now >= state.writeDeadline) {
    reveal(state, state.writeDeadline);
    events.push('reveal');
  }
  if (state.phase === PHASES.REVEAL && now >= (state.readDeadline || 0)) {
    openVoting(state, now);
    events.push('voting');
  }
  if (state.phase === PHASES.VOTING && now >= (state.voteDeadline || 0)) {
    settle(state, now);
    events.push('result');
  }

  return {
    changed: events.length > 0,
    events,
    settled: state.settled,
    winnerId: state.winnerId
  };
}

function saveDraft(state, contestantId, text, now = Date.now()) {
  const cid = String(contestantId || '');
  if (!state) return { ok: false, error: 'NO DUEL IS RUNNING' };
  if (state.phase !== PHASES.WRITING) return { ok: false, error: 'THE WRITING WINDOW HAS CLOSED' };
  if (!isContestant(state, cid)) return { ok: false, error: 'YOU ARE NOT IN THIS DUEL' };
  if (state.submitted[cid]) return { ok: false, error: 'YOUR ENTRY IS LOCKED' };

  const cleaned = cleanText(text);
  state.entries[cid] = cleaned || null;
  state.submittedAt[cid] = now;
  return { ok: true, entry: cleaned };
}

// SUBMIT locks the draft permanently. The only way text changes after this is
// the timeout path for someone who never submitted.
function submit(state, contestantId, text, now = Date.now()) {
  const cid = String(contestantId || '');
  if (!state) return { ok: false, error: 'NO DUEL IS RUNNING' };
  if (state.phase !== PHASES.WRITING) return { ok: false, error: 'THE WRITING WINDOW HAS CLOSED' };
  if (!isContestant(state, cid)) return { ok: false, error: 'YOU ARE NOT IN THIS DUEL' };
  if (state.submitted[cid]) return { ok: false, error: 'YOUR ENTRY IS ALREADY LOCKED' };

  const checked = validateEntry(text);
  if (!checked.ok) return checked;
  const cleaned = checked.text;

  state.entries[cid] = cleaned;
  state.submitted[cid] = true;
  state.submittedAt[cid] = now;

  let revealed = false;
  const both = state.contestantIds.every(id => state.submitted[id]);
  if (both) {
    reveal(state, now);
    revealed = true;
  }
  return { ok: true, revealed };
}

function castVote(state, voterId, contestantId, now = Date.now()) {
  const vid = String(voterId || '');
  const pick = String(contestantId || '');
  if (!state) return { ok: false, error: 'NO DUEL IS RUNNING' };
  if (state.phase !== PHASES.VOTING) return { ok: false, error: 'VOTING IS NOT OPEN' };
  if (!vid) return { ok: false, error: 'YOU CANNOT VOTE' };
  if (isContestant(state, vid)) return { ok: false, error: 'CONTESTANTS CANNOT VOTE' };
  if (state.votes[vid]) return { ok: false, error: 'YOU ALREADY VOTED' };
  if (!isContestant(state, pick)) return { ok: false, error: 'PICK A CONTESTANT' };
  if (!state.entries[pick]) return { ok: false, error: 'THAT CONTESTANT HAS NO ENTRY' };

  state.votes[vid] = pick;
  return { ok: true, vote: pick, totalVotes: totalVotes(state) };
}

function cancel(state, reason, now = Date.now()) {
  if (!state) return { ok: false, error: 'NO DUEL IS RUNNING' };
  if (state.settled) return { ok: false, error: 'THE DUEL IS ALREADY DECIDED' };
  state.phase = PHASES.CANCELLED;
  state.cancelled = true;
  state.settled = true;
  state.settledAt = now;
  state.cancelReason = reason ? String(reason).slice(0, 120) : 'THE SHADOW BROKER CLOSED THE PIT';
  return { ok: true };
}

// The single function the server may hand to a client. Role-aware and
// viewer-aware; entry text appears only once revealedAt is set.
function view(state, viewerId, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const isGm = opts.isGm === true;
  const eligibleVoter = opts.eligibleVoter === true;
  const viewer = String(viewerId || '');

  if (!state) {
    return { active: false, phase: null, serverNow: now };
  }

  const revealed = !!state.revealedAt;
  const video = state.phase === PHASES.RESULT || state.phase === PHASES.CANCELLED;
  const contestant = isContestant(state, viewer);

  const contestants = state.contestantIds.map(cid => ({
    id: cid,
    name: state.names[cid] || 'LITTLE HERO',
    submitted: state.submitted[cid] === true,
    vote: video && state.counts ? state.counts[cid] : undefined
  }));

  const entries = revealed
    ? state.contestantIds.map(cid => ({
        id: cid,
        name: state.names[cid] || 'LITTLE HERO',
        text: state.entries[cid] || null
      }))
    : null;

  const nonEmptyTargets = state.contestantIds.filter(cid => !!state.entries[cid]);
  const myVote = state.votes[viewer] || null;

  return {
    active: true,
    id: state.id,
    phase: state.phase,
    serverNow: now,
    contestants,
    names: Object.assign({}, state.names),
    revealed,
    entries,
    counts: video && state.counts ? Object.assign({}, state.counts) : null,
    totalVotes: totalVotes(state),
    writeDeadline: state.writeDeadline,
    readDeadline: state.readDeadline,
    voteDeadline: state.voteDeadline,
    settledAt: state.settledAt,
    winnerId: state.winnerId,
    tie: state.tie === true,
    noEntries: state.noEntries === true,
    awarded: state.awarded === true,
    awardedTo: state.awardedTo ? { id: state.awardedTo.id, name: state.awardedTo.name } : null,
    cancelled: state.cancelled === true,
    cancelReason: state.cancelReason || null,
    viewer: {
      id: viewer,
      isContestant: contestant,
      isGm,
      canSubmit: contestant && state.phase === PHASES.WRITING && !state.submitted[viewer],
      submitted: contestant && state.submitted[viewer] === true,
      // Once a contestant seals an entry, even that contestant must not get
      // the plaintext back through a broadcast/reconnect projection. Drafts
      // remain visible only while still editable; all sealed text waits for
      // the single reveal transition below.
      myDraft: contestant && !revealed && state.phase === PHASES.WRITING && !state.submitted[viewer]
        ? (state.entries[viewer] || '') : null,
      canVote: eligibleVoter && !contestant && state.phase === PHASES.VOTING
        && !myVote && nonEmptyTargets.length > 0,
      hasVoted: !!myVote,
      myVote,
      canCancel: isGm && !state.settled && state.phase !== PHASES.CANCELLED
    }
  };
}

module.exports = {
  PHASES,
  MAX_TEXT,
  WRITE_MS,
  READ_MS,
  VOTE_MS,
  newDuel,
  normalizeState,
  tick,
  saveDraft,
  submit,
  castVote,
  cancel,
  view,
  tally,
  totalVotes,
  isContestant,
  cleanText
};
