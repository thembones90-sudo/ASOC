/*
 * ASOC ENGINE - Match Ledger
 *
 * The per-BOARD (one match = one board) record that the post-game RECOUNT and
 * Match Awards Engine will be computed from. This module is DATA CAPTURE
 * ONLY: pure functions over a plain JSON-serializable object, no I/O, no
 * clocks (callers pass `now`), no scoring decisions. server.js owns room
 * state and simply calls these hooks; room.match is persisted with the room
 * snapshot so it survives a crash.
 *
 * LOCKED RULES (Commander):
 *  - A match ends only when the WHOLE FIELD is OPENED: all four column
 *    solutions (A5-D5) AND the FINAL solution. However a field got opened
 *    -- a correct guess, a declared failure, or a plain GM reveal -- it
 *    counts. Solving the Final alone does not end the game: players can
 *    still solve the remaining columns.
 *  - An ATTEMPT is a GM-judged message and nothing else. Unjudged chat is
 *    never an attempt; it is recorded separately as ACTIVITY.
 *  - A real solve outranks a GM-declared failure for the same field.
 *
 * Deliberately NOT stored here: awards, rankings, commentary. Those are
 * derived later, from this ledger, by the awards engine.
 */

const FIELDS = ['A', 'B', 'C', 'D', 'FINAL'];
const TEXT_KEY_MAX = 80;

// Normalized form of a judged answer, so "the same wrong answer submitted
// again" can be detected later without storing unbounded free text.
function normalizeTextKey(text) {
  return String(text || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim().slice(0, TEXT_KEY_MAX);
}

function createLedger(boardId, now, connectedPlayers = []) {
  const ledger = {
    version: 1,
    boardId,
    startedAt: now,
    attempts: [],   // GM-judged messages only (upserted by messageId)
    activity: {},   // playerId -> guess-channel message counts (judged or not)
    presence: {},   // playerId -> { name, firstSeenAt, intervals: [{ from, to|null }] }
    failedAt: {},   // field -> ms timestamp the GM declared it failed
    completedAt: null,
    // RECOUNT: nothing is shown until the host's manual SHOW RESULTS. The
    // stored payload lets every reconnect/late join receive the SAME RECOUNT
    // (never regenerated); both clear when the match re-opens or the board resets.
    resultsShownAt: null,
    recount: null
  };
  connectedPlayers.forEach(p => presenceOpen(ledger, p.playerId, p.playerName, now));
  return ledger;
}

function ensurePresence(ledger, playerId, name, now) {
  let entry = ledger.presence[playerId];
  if (!entry) entry = ledger.presence[playerId] = { name: name || '', firstSeenAt: now, intervals: [] };
  else if (name) entry.name = name;
  return entry;
}

// Opening is idempotent: a reconnect while an interval is already open (or a
// board reset re-opening for connected players) never double-counts time.
function presenceOpen(ledger, playerId, name, now) {
  const entry = ensurePresence(ledger, playerId, name, now);
  const last = entry.intervals[entry.intervals.length - 1];
  if (!last || last.to !== null) entry.intervals.push({ from: now, to: null });
}

function presenceClose(ledger, playerId, now) {
  const entry = ledger.presence[playerId];
  if (!entry) return;
  const last = entry.intervals[entry.intervals.length - 1];
  if (last && last.to === null) last.to = now;
}

function closeAllPresence(ledger, now) {
  Object.keys(ledger.presence).forEach(playerId => presenceClose(ledger, playerId, now));
}

// Any message on the guess channel proves participation. This is ACTIVITY,
// never an attempt -- attempts exist only once the GM judges a message.
function recordActivity(ledger, playerId, name, now) {
  ensurePresence(ledger, playerId, name, now);
  const activity = ledger.activity[playerId] ||
    (ledger.activity[playerId] = { name: name || '', messages: 0, firstAt: now, lastAt: now });
  if (name) activity.name = name;
  activity.messages += 1;
  activity.lastAt = now;
}

// Upsert by messageId. The GM can flip or retarget a verdict later, so the
// ledger always reflects the LATEST verdict for each judged message (and the
// clue exposure at that judging). `target` is only meaningful for 'correct';
// a 'wrong' verdict carries no target in the game today.
function recordAttempt(ledger, fields) {
  const { messageId, playerId, playerName, submittedAt, verdict, target, text, cluesRevealedTotal, now } = fields;
  if (!messageId || !playerId || (verdict !== 'correct' && verdict !== 'wrong')) return null;

  ensurePresence(ledger, playerId, playerName, now);
  let attempt = ledger.attempts.find(a => a.messageId === messageId);
  if (!attempt) {
    attempt = {
      seq: ledger.attempts.length + 1,
      messageId,
      playerId,
      playerName: playerName || '',
      submittedAt: submittedAt ?? null,
      textKey: normalizeTextKey(text)
    };
    ledger.attempts.push(attempt);
  }
  attempt.judgedAt = now;
  attempt.verdict = verdict;
  attempt.target = verdict === 'correct' ? (target || null) : null;
  attempt.cluesRevealedTotal = cluesRevealedTotal ?? null;
  return attempt;
}

function markFailed(ledger, field, now) {
  if (!FIELDS.includes(field)) return;
  if (!ledger.failedAt[field]) ledger.failedAt[field] = now;
}

// Per-field status, DERIVED from the authoritative sources each time rather
// than trusted from a cached flag. A field is OPEN only if it is none of:
//   solved   -- a correct guess was accepted (chat.solvedTargets)
//   failed   -- the GM declared it failed (womf.failedColumns / failedAt.FINAL)
//   revealed -- its slot is simply opened on the board (`revealed`), however
//               that happened, including a plain GM reveal or REVEAL ALL
// Precedence is solved > failed > revealed, so the archive keeps the most
// informative reason a field is no longer open. Hiding a merely-revealed
// slot re-opens it.
function resolveFields({ solvedTargets = {}, failedColumns = {}, revealed = {}, ledger }) {
  const fields = {};
  for (const field of FIELDS) {
    const solved = solvedTargets[field];
    const failed = field === 'FINAL' ? !!ledger.failedAt.FINAL : failedColumns[field] === true;
    if (solved) {
      fields[field] = {
        status: 'solved',
        playerId: solved.playerId || null,
        playerName: solved.playerName || '',
        at: solved.timestamp ?? null
      };
    } else if (failed) {
      fields[field] = { status: 'failed', at: ledger.failedAt[field] ?? null };
    } else if (revealed[field] === true) {
      fields[field] = { status: 'revealed', at: null };
    } else {
      fields[field] = { status: 'open' };
    }
  }
  return fields;
}

function isComplete(fields) {
  return FIELDS.every(field => fields[field] && fields[field].status !== 'open');
}

// Returns 'completed' | 'reopened' | null. `completedAt` is stamped once on
// the transition; a verdict reversal that re-opens a field clears it.
function refreshCompletion(ledger, fields, now) {
  const complete = isComplete(fields);
  if (complete && !ledger.completedAt) {
    ledger.completedAt = now;
    return 'completed';
  }
  if (!complete && ledger.completedAt) {
    ledger.completedAt = null;
    return 'reopened';
  }
  return null;
}

// Points earned on THIS board only (session score spans boards; events carry
// boardId). Includes streak bonuses and failed-Final penalties -- every event.
function matchPointsByPlayer(events, boardId) {
  const totals = {};
  for (const event of events || []) {
    if (event.boardId !== boardId || !event.playerId) continue;
    const entry = totals[event.playerId] || (totals[event.playerId] = { name: event.playerName || '', points: 0 });
    entry.name = event.playerName || entry.name;
    entry.points += event.points || 0;
  }
  return totals;
}

// Standard competition ranking: equal scores SHARE the place and the next
// place is skipped (1, 2, 2, 4).
function competitionRanks(entries) {
  const sorted = entries.slice().sort((a, b) => b.score - a.score);
  const ranks = {};
  let previousScore = null;
  let previousRank = 0;
  sorted.forEach((entry, index) => {
    const rank = previousScore !== null && entry.score === previousScore ? previousRank : index + 1;
    ranks[entry.key] = rank;
    previousScore = entry.score;
    previousRank = rank;
  });
  return ranks;
}

// Overall (all-time) standings before/after this match for the players who
// took part. Points are written to the profile as they are earned, so BEFORE
// is simply AFTER minus this match's points -- no separate snapshot needed.
// `profiles` is players.json's shape: { key: { name, lifetimeScore } }.
function computeStandings(profiles, matchPointsByKey) {
  const after = Object.entries(profiles || {}).map(([key, p]) => ({ key, name: p.name, score: p.lifetimeScore || 0 }));
  const before = after.map(e => ({ ...e, score: e.score - (matchPointsByKey[e.key] || 0) }));
  const rankAfter = competitionRanks(after);
  const rankBefore = competitionRanks(before);

  return Object.keys(matchPointsByKey)
    .filter(key => profiles && profiles[key])
    .map(key => ({
      key,
      name: profiles[key].name,
      lifetimeBefore: (profiles[key].lifetimeScore || 0) - (matchPointsByKey[key] || 0),
      lifetimeAfter: profiles[key].lifetimeScore || 0,
      rankBefore: rankBefore[key],
      rankAfter: rankAfter[key]
    }));
}

// The immutable snapshot written to the match archive at completion: enough
// for RECOUNT, the awards engine and a future GAME HISTORY, with no derived
// awards baked in. `keyFn` is the profile-key normalizer (display name).
function buildArchiveRecord(input) {
  const { matchId, roomCode, gameId, title, difficulty, ledger, fields, events, gameWon, matchResult, standings, keyFn, now } = input;
  const points = matchPointsByPlayer(events, matchId);

  const playerIds = new Set([
    ...Object.keys(ledger.presence),
    ...Object.keys(ledger.activity),
    ...ledger.attempts.map(a => a.playerId),
    ...Object.keys(points)
  ]);

  const endedAt = ledger.completedAt || now;
  const players = Array.from(playerIds).map(playerId => {
    const presence = ledger.presence[playerId];
    const name = (points[playerId] && points[playerId].name) ||
      (presence && presence.name) ||
      (ledger.activity[playerId] && ledger.activity[playerId].name) || '';
    const mine = ledger.attempts.filter(a => a.playerId === playerId);
    const presentMs = presence
      ? presence.intervals.reduce((sum, i) => sum + Math.max(0, (i.to === null ? endedAt : i.to) - i.from), 0)
      : 0;
    return {
      playerId,
      name,
      nameKey: keyFn(name),
      matchPoints: points[playerId] ? points[playerId].points : 0,
      judged: {
        total: mine.length,
        correct: mine.filter(a => a.verdict === 'correct').length,
        wrong: mine.filter(a => a.verdict === 'wrong').length
      },
      messages: ledger.activity[playerId] ? ledger.activity[playerId].messages : 0,
      firstSeenAt: presence ? presence.firstSeenAt : null,
      presentMs
    };
  });

  return {
    matchId,
    roomCode,
    gameId,
    title: title || '',
    difficulty: difficulty || null,
    startedAt: ledger.startedAt,
    completedAt: ledger.completedAt,
    archivedAt: now,
    gameWon: gameWon === true,
    outcome: matchResult?.outcome || (gameWon === true ? 'WON' : null),
    lossMessage: matchResult?.outcome === 'LOST' ? matchResult.message : null,
    finalSolution: matchResult?.outcome === 'LOST' ? matchResult.finalSolution : null,
    topPerformer: matchResult?.outcome === 'LOST' ? matchResult.topPerformer : null,
    fields,
    players,
    attempts: JSON.parse(JSON.stringify(ledger.attempts)),
    scoreEvents: JSON.parse(JSON.stringify((events || []).filter(event => event.boardId === matchId))),
    presence: JSON.parse(JSON.stringify(ledger.presence)),
    standings: standings || []
  };
}

module.exports = {
  FIELDS,
  normalizeTextKey,
  createLedger,
  presenceOpen,
  presenceClose,
  closeAllPresence,
  recordActivity,
  recordAttempt,
  markFailed,
  resolveFields,
  isComplete,
  refreshCompletion,
  matchPointsByPlayer,
  competitionRanks,
  computeStandings,
  buildArchiveRecord
};
