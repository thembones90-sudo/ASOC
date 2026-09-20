/*
 * ASOC ENGINE - RECOUNT / Match Awards Engine
 *
 * PURE and DETERMINISTIC: (archived match record, prior archived matches,
 * player profiles, seed) -> the post-game RECOUNT payload. No I/O, no clock,
 * no Math.random. The same inputs always produce the same RECOUNT, so a
 * refresh/reconnect can never regenerate different awards; the server also
 * stores the result with the match.
 *
 * DESIGN PRINCIPLE: the system never insults randomly. It observes,
 * calculates and presents evidence. Every award is EARNED by threshold logic
 * over recorded match data and carries the statistics that prove it.
 * Randomness is never used; ties and commentary variants are chosen by a
 * seeded cryptographic hash (matchId + award + player), which is repeatable.
 *
 * PIPELINE: per-player stats -> qualify (threshold logic) -> strength/severity
 * -> conflict groups (one award per underlying behaviour per player) ->
 * per-player limits -> pick the 2-3 most interesting valid awards. Nothing is
 * forced: no negative award is invented to fill a slot.
 *
 * DATA HONESTY: an "attempt" is a GM-judged message (Commander's rule). Wrong
 * verdicts carry no column, so clue exposure at a wrong attempt is the
 * BOARD-WIDE count of revealed clue cells. Awards whose claim cannot be
 * backed by recorded data are deliberately NOT shipped (see HELD_AWARDS).
 */

const crypto = require('crypto');

const T = Object.freeze({
  TOTAL_CLUE_CELLS: 16,
  // A match where the GM judged almost nothing cannot support accuracy-based
  // cruelty ("cruelty must be statistically justified").
  MIN_TOTAL_JUDGED_FOR_FAILURE: 10,
  // Historical awards need real history (archived matches with results shown).
  HISTORY_MIN_MATCHES: 5,
  HISTORY_MIN_AVG_POINTS: 200,
  MIN_MATCH_MS_FOR_INACTIVITY: 3 * 60 * 1000,
  MAX_AWARDS: 3,
  MAX_AWARDS_PER_PLAYER: 2,
  SECOND_AWARD_MIN_STRENGTH: 0.85,
  THIRD_AWARD_MIN_INTEREST: 0.72,
  CHAIN_WINDOW_MS: 90 * 1000
});

// Awards intentionally NOT implemented: no honest, recordable evidence exists.
// (The game does not record who opens clues, nor "team efficiency" over time,
// nor whether an answer "confused" the puzzle.) Listed so it is explicit.
const HELD_AWARDS = Object.freeze(['NEGATIVE SYNERGY', 'UNAUTHORIZED THINKING', 'THE TOUR GUIDE']);

// ---------------------------------------------------------------- helpers

function hash01(...parts) {
  const digest = crypto.createHash('sha256').update(parts.join('|')).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const clamp01 = n => Math.max(0, Math.min(1, n));
const pct = n => `${(n * 100).toFixed(1)}%`;
const clock = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Standard competition ranking over a composite tiebreak: better key first,
// and only FULLY equal keys share the place (1, 2, 2, 4).
function rankByKeys(items, keyOf) {
  const sorted = items.slice().sort((a, b) => {
    const ka = keyOf(a), kb = keyOf(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  });
  let prev = null, prevRank = 0;
  return sorted.map((item, index) => {
    const key = keyOf(item).join(',');
    const rank = prev !== null && key === prev ? prevRank : index + 1;
    prev = key; prevRank = rank;
    return { item, rank };
  });
}

// ------------------------------------------------------------ player stats

function longestStreak(seq, symbol) {
  let best = 0, run = 0;
  for (const s of seq) { run = s === symbol ? run + 1 : 0; if (run > best) best = run; }
  return best;
}

function buildStats(match, history, keyFn) {
  const matchMs = Math.max(1, (match.completedAt || match.archivedAt || match.startedAt + 1) - match.startedAt);
  const events = match.scoreEvents || [];
  const attempts = (match.attempts || []).slice().sort((a, b) => a.seq - b.seq);

  // Which player got each target first (for "arrived after it was solved").
  const firstCorrectByTarget = {};
  attempts.filter(a => a.verdict === 'correct' && a.target).sort((a, b) => a.judgedAt - b.judgedAt).forEach(a => {
    if (!firstCorrectByTarget[a.target]) firstCorrectByTarget[a.target] = a.playerId;
  });

  const finalSolverId = match.fields && match.fields.FINAL && match.fields.FINAL.status === 'solved'
    ? match.fields.FINAL.playerId : null;

  const players = (match.players || []).map(pl => {
    const mine = attempts.filter(a => a.playerId === pl.playerId);
    const seq = mine.map(a => (a.verdict === 'correct' ? 'C' : 'W'));
    const correct = seq.filter(s => s === 'C').length;
    const wrong = seq.length - correct;

    const wrongCounts = {};
    mine.filter(a => a.verdict === 'wrong' && a.textKey).forEach(a => {
      wrongCounts[a.textKey] = (wrongCounts[a.textKey] || 0) + 1;
    });
    const repeatEntry = Object.entries(wrongCounts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] || null;

    const submitted = mine.map(a => a.submittedAt).filter(Number.isFinite).sort((a, b) => a - b);
    const gaps = submitted.slice(1).map((t, i) => t - submitted[i]);

    const myEvents = events.filter(e => e.playerId === pl.playerId);
    const columnEvents = myEvents.filter(e => e.type === 'column');
    const finalEvent = myEvents.find(e => e.type === 'final') || null;
    const solveTimes = [...columnEvents, ...(finalEvent ? [finalEvent] : [])].map(e => e.timestamp).sort((a, b) => a - b);

    let chain = 0;
    for (let i = 0; i < solveTimes.length; i++) {
      let run = 1;
      while (i + run < solveTimes.length && solveTimes[i + run] - solveTimes[i + run - 1] <= T.CHAIN_WINDOW_MS) run++;
      if (run > chain) chain = run;
    }

    // Longest stretch the player KEPT TRYING without a correct answer:
    // segments are delimited by the player's correct answers (and the match
    // start/end), and only a segment containing 3+ of their wrong attempts
    // counts -- someone who simply finished early is not "buffering".
    const endsAt = match.completedAt || match.startedAt + matchMs;
    const byTime = mine.slice().sort((a, b) => a.judgedAt - b.judgedAt);
    let drought = 0;
    let segStart = match.startedAt, segWrong = 0;
    for (const a of byTime) {
      if (a.verdict === 'correct') {
        if (segWrong >= 3) drought = Math.max(drought, a.judgedAt - segStart);
        segStart = a.judgedAt; segWrong = 0;
      } else {
        segWrong++;
      }
    }
    if (segWrong >= 3) drought = Math.max(drought, endsAt - segStart);

    const half = Math.ceil(mine.length / 2);
    const acc = list => (list.length ? list.filter(a => a.verdict === 'correct').length / list.length : null);

    const nameKey = pl.nameKey || keyFn(pl.name);
    const prior = (history || []).map(h => (h.players || []).find(p => p.nameKey === nameKey)).filter(Boolean);
    const priorPoints = prior.map(p => p.matchPoints);

    return {
      playerId: pl.playerId,
      name: pl.name,
      nameKey,
      points: pl.matchPoints || 0,
      judged: mine.length,
      correct,
      wrong,
      accuracy: mine.length ? correct / mine.length : null,
      messages: pl.messages || 0,
      presenceRatio: clamp01((pl.presentMs || 0) / matchMs),
      seq,
      flips: seq.reduce((n, s, i) => (i && s !== seq[i - 1] ? n + 1 : n), 0),
      longestWrong: longestStreak(seq, 'W'),
      longestCorrect: longestStreak(seq, 'C'),
      wrongRepeat: repeatEntry ? { text: repeatEntry[0], count: repeatEntry[1] } : { text: '', count: 0 },
      wrongAtMid: mine.filter(a => a.verdict === 'wrong' && (a.cluesRevealedTotal || 0) >= T.TOTAL_CLUE_CELLS / 2).length,
      wrongAtHigh: mine.filter(a => a.verdict === 'wrong' && (a.cluesRevealedTotal || 0) >= T.TOTAL_CLUE_CELLS * 0.75).length,
      dupCorrect: mine.filter(a => a.verdict === 'correct' && a.target && firstCorrectByTarget[a.target] !== pl.playerId).length,
      medianGapMs: median(gaps),
      firstHalfAcc: acc(mine.slice(0, half)),
      secondHalfAcc: acc(mine.slice(half)),
      firstHalfN: half,
      secondHalfN: mine.length - half,
      columnEvents,
      finalEvent,
      isFinalSolver: !!finalSolverId && finalSolverId === pl.playerId,
      solves: columnEvents.length + (finalEvent ? 1 : 0),
      firstSolveAt: solveTimes.length ? solveTimes[0] : null,
      chain,
      drought,
      history: priorPoints.length >= T.HISTORY_MIN_MATCHES
        ? { games: priorPoints.length, avg: priorPoints.reduce((a, b) => a + b, 0) / priorPoints.length, best: Math.max(...priorPoints) }
        : null
    };
  });

  const totalPositive = players.reduce((n, p) => n + Math.max(0, p.points), 0);
  players.forEach(p => {
    p.share = totalPositive > 0 ? Math.max(0, p.points) / totalPositive : 0;
    p.active = p.judged >= 3 || p.messages >= 3 || p.solves >= 1;
  });

  const active = players.filter(p => p.active);
  const totalJudged = players.reduce((n, p) => n + p.judged, 0);
  const totalCorrect = players.reduce((n, p) => n + p.correct, 0);
  const wrongs = active.map(p => p.wrong);
  const allSolves = players.flatMap(p => p.columnEvents.concat(p.finalEvent ? [p.finalEvent] : []));
  const earliest = allSolves.slice().sort((a, b) => a.timestamp - b.timestamp)[0] || null;
  const finalSolver = players.find(p => p.isFinalSolver) || null;

  const ctx = {
    matchMs,
    players,
    active,
    activeCount: active.length,
    totalJudged,
    roomAccuracy: totalJudged ? totalCorrect / totalJudged : null,
    maxWrong: wrongs.length ? Math.max(...wrongs) : 0,
    maxSolves: players.length ? Math.max(...players.map(p => p.solves)) : 0,
    medianOfMedianGaps: median(players.map(p => p.medianGapMs).filter(Number.isFinite)),
    activePoints: active.map(p => p.points),
    firstSolve: earliest,
    finalSolver,
    startedAt: match.startedAt
  };
  return ctx;
}

// ---------------------------------------------------------- award catalog

// Each definition: id, category (distinction|anomaly|failure), group (the
// underlying behaviour; only the strongest award per group per player may be
// selected), severity (failure tiers), rarity (0..1, rarer = more notable),
// needsJudged (accuracy-based: requires MIN_TOTAL_JUDGED_FOR_FAILURE judged in
// the whole match), test(p, ctx) -> { strength 0..1, evidence[] } | null, and
// lines[] (commentary variants for the SAME earned award).
const acc = p => (p.accuracy === null ? 0 : p.accuracy);
const attemptEvidence = p => [
  plural(p.judged, 'ATTEMPT', 'ATTEMPTS'), `${p.correct} CORRECT`, `${p.wrong} INCORRECT`, `${pct(acc(p))} ACCURACY`
];

const AWARDS = [
  // ---------------------------------------------------------- DISTINCTION
  { id: 'THE ARCHITECT', category: 'distinction', group: 'solving-volume', rarity: 0.4,
    lines: ['Structural dismantling unusually efficient.', 'Puzzle architecture reduced to rubble. Efficiently.'],
    test: (p, c) => (p.solves >= 2 && p.solves === c.maxSolves && c.players.filter(x => x.solves === c.maxSolves).length === 1)
      ? { strength: clamp01(0.55 + 0.15 * (p.solves - 2) + 0.25 * p.share),
          evidence: [plural(p.solves, 'MAJOR SOLUTION', 'MAJOR SOLUTIONS'), `${p.points} POINTS`] } : null },

  { id: 'THE CLOSER', category: 'distinction', group: 'final', rarity: 0.35,
    lines: ['Final structure resolved. Remaining resistance was cosmetic.', 'The last defence was located and removed.'],
    test: p => p.isFinalSolver
      ? { strength: clamp01(0.6 + (p.finalEvent && p.finalEvent.columnsKnownAtSolve <= 2 ? 0.2 : 0)),
          evidence: ['SOLVED THE FINAL SOLUTION'].concat(p.finalEvent ? [`AFTER ${plural(p.finalEvent.columnsKnownAtSolve, 'COLUMN', 'COLUMNS')} WERE KNOWN`] : []) } : null },

  { id: "SHADOW BROKER'S ASSET", category: 'distinction', group: 'winner', rarity: 0.3, coHolders: true,
    lines: ['Output exceeded every other monitored subject.', 'Highest yield recorded. The asset is retained.'],
    test: (p, c) => {
      const top = Math.max(...c.active.map(x => x.points));
      if (c.activeCount < 2 || top <= 0 || p.points !== top) return null;
      const second = c.active.map(x => x.points).filter(v => v < top).sort((a, b) => b - a)[0];
      const lead = second === undefined ? 1 : clamp01((top - second) / top);
      return { strength: clamp01(0.5 + 0.3 * lead), evidence: [`HIGHEST MATCH SCORE: ${p.points}`] };
    } },

  { id: 'COLD READ', category: 'distinction', group: 'efficiency', rarity: 0.5,
    lines: ['Minimal data required. Conclusion reached regardless.', 'One clue. One verdict. Correct.'],
    test: p => {
      const cold = p.columnEvents.filter(e => e.cluesRevealed === 1);
      return cold.length ? { strength: clamp01(0.7 + 0.1 * (cold.length - 1)),
        evidence: cold.map(e => `COLUMN ${e.target} SOLVED WITH 1 CLUE`) } : null;
    } },

  { id: 'FIRST BLOOD', category: 'distinction', group: 'timing', rarity: 0.2,
    lines: ['First structural breach recorded.'],
    test: (p, c) => (c.firstSolve && c.firstSolve.playerId === p.playerId && c.activeCount >= 2)
      ? { strength: 0.35, evidence: ['FIRST SOLUTION OF THE MATCH', `${c.firstSolve.target === 'FINAL' ? 'FINAL' : `COLUMN ${c.firstSolve.target}`} AT ${clock(c.firstSolve.timestamp - c.startedAt)}`] } : null },

  { id: 'CHAIN REACTION', category: 'distinction', group: 'timing', rarity: 0.5,
    lines: ['Successive collapses. Correlation confirmed.', 'One solution triggered the next. Cascade recorded.'],
    test: p => p.chain >= 2 ? { strength: clamp01(0.6 + 0.1 * (p.chain - 2)),
      evidence: [`${p.chain} SOLUTIONS WITHIN ${T.CHAIN_WINDOW_MS / 1000}S OF EACH OTHER`] } : null },

  { id: 'THE ORACLE', category: 'distinction', group: 'accuracy-high', rarity: 0.5,
    lines: ['Predictive capacity exceeds tolerance.', 'Answers arrived correct. Repeatedly.'],
    test: p => (p.judged >= 6 && acc(p) >= 0.8 && acc(p) < 1)
      ? { strength: clamp01(0.55 + (acc(p) - 0.8) * 1.5 + 0.02 * (p.judged - 6)), evidence: attemptEvidence(p) } : null },

  { id: 'PERFECT SPECIMEN', category: 'distinction', group: 'accuracy-high', rarity: 0.9,
    lines: ['No errors detected. Suspicious.', 'Flawless record. Monitoring continues.'],
    test: p => (p.judged >= 5 && acc(p) === 1)
      ? { strength: clamp01(0.8 + 0.02 * (p.judged - 5)), evidence: attemptEvidence(p) } : null },

  { id: 'SOLO CARRY', category: 'distinction', group: 'share', rarity: 0.8,
    lines: ['Remaining subjects contributed background noise.', 'The match was carried. The weight was not shared.'],
    test: (p, c) => (c.activeCount >= 3 && p.share >= 0.6)
      ? { strength: clamp01(0.6 + (p.share - 0.6)), evidence: [`${pct(p.share)} OF ALL POINTS EARNED`, `${p.points} POINTS`] } : null },

  { id: 'UNAUTHORIZED EVOLUTION', category: 'distinction', group: 'history-up', rarity: 0.85,
    lines: ['Rapid adaptation detected. Monitoring recommended.'],
    test: p => (p.history && p.history.best > 0 && p.points >= p.history.best * 1.5 && p.points >= p.history.avg * 2)
      ? { strength: clamp01(0.7 + Math.min(0.3, (p.points / p.history.best - 1.5) * 0.2)),
          evidence: [`PREVIOUS BEST: ${p.history.best}`, `THIS MATCH: ${p.points}`, `CAREER AVERAGE: ${Math.round(p.history.avg)}`] } : null },

  // -------------------------------------------------------------- ANOMALY
  { id: 'CHAOS THEORY', category: 'anomaly', group: 'volatility', rarity: 0.5,
    lines: ['Brilliance and incompetence alternated without detectable pattern.'],
    test: p => (p.judged >= 10 && p.correct >= 3 && p.wrong >= 3 && acc(p) >= 0.35 && acc(p) <= 0.65 && p.flips >= 5)
      ? { strength: clamp01(0.5 + (p.flips / p.judged) * 0.5), evidence: [`${p.correct} CORRECT`, `${p.wrong} INCORRECT`, `${p.flips} REVERSALS`] } : null },

  { id: 'THE EXPERIMENT', category: 'anomaly', group: 'volatility', rarity: 0.9,
    lines: ['Pattern does not fit any established category. Study is ongoing.'],
    test: p => (p.judged >= 12 && p.correct >= 3 && p.longestWrong >= 5 && p.longestCorrect >= 3)
      ? { strength: clamp01(0.85 + 0.01 * (p.longestWrong - 5)),
          evidence: [`LONGEST WRONG RUN: ${p.longestWrong}`, `LONGEST CORRECT RUN: ${p.longestCorrect}`, `${p.correct} CORRECT`, `${p.wrong} INCORRECT`] } : null },

  { id: 'ONE JOB', category: 'anomaly', group: 'contribution-odd', rarity: 0.6,
    lines: ['Minimal input. Critical output.', 'One job was assigned. It was completed.'],
    test: p => {
      if (p.solves !== 1 || p.judged > 3 || p.messages > 6) return null;
      const key = p.isFinalSolver || (p.columnEvents[0] && p.columnEvents[0].cluesRevealed === 1);
      return key ? { strength: 0.65, evidence: [`${plural(p.judged, 'JUDGED ATTEMPT', 'JUDGED ATTEMPTS')}`, p.isFinalSolver ? 'SOLVED THE FINAL SOLUTION' : `COLUMN ${p.columnEvents[0].target} SOLVED WITH 1 CLUE`, `${p.points} POINTS`] } : null;
    } },

  { id: 'TACTICAL SILENCE', category: 'anomaly', group: 'silence', rarity: 0.6,
    lines: ['Low signal. High impact. Noted.'],
    test: p => (p.messages <= 3 && p.judged >= 1 && p.points > 0 && p.share >= 0.25 && p.presenceRatio >= 0.5)
      ? { strength: clamp01(0.55 + p.share * 0.4), evidence: [plural(p.messages, 'MESSAGE', 'MESSAGES'), `${p.points} POINTS`, `${pct(p.share)} OF ALL POINTS`] } : null },

  { id: 'THE SURVIVOR', category: 'anomaly', group: 'arc', rarity: 0.6,
    lines: ['Early failure did not prove fatal.'],
    test: p => (p.judged >= 8 && p.firstHalfN >= 4 && p.secondHalfN >= 4 && p.firstHalfAcc <= 0.25 && p.secondHalfAcc >= 0.6)
      ? { strength: clamp01(0.6 + (p.secondHalfAcc - p.firstHalfAcc) * 0.3),
          evidence: [`FIRST HALF: ${pct(p.firstHalfAcc)} ACCURACY`, `SECOND HALF: ${pct(p.secondHalfAcc)} ACCURACY`] } : null },

  { id: 'LAST TO KNOW', category: 'anomaly', group: 'late', rarity: 0.4,
    lines: ['Arrived after the conclusion was already reached.'],
    test: p => p.dupCorrect >= 2 ? { strength: clamp01(0.5 + 0.1 * (p.dupCorrect - 2)),
      evidence: [`${p.dupCorrect} CORRECT ANSWERS ARRIVED AFTER THE TARGET WAS ALREADY SOLVED`] } : null },

  { id: 'THE DONOR', category: 'anomaly', group: 'donor', rarity: 0.5,
    lines: ['Contribution acknowledged. Ownership disputed.'],
    test: (p, c) => {
      const fs = c.finalSolver;
      if (!fs || fs.playerId === p.playerId || p.columnEvents.length < 2) return null;
      if (!(fs.points >= 1.5 * Math.max(1, p.points))) return null;
      return { strength: clamp01(0.55 + Math.min(0.3, (fs.points / Math.max(1, p.points) - 1.5) * 0.1)),
        evidence: [`${p.columnEvents.length} COLUMNS SOLVED`, `${p.points} POINTS`, `FINAL SOLVER SCORED ${fs.points}`] };
    } },

  // -------------------------------------------------------------- FAILURE
  { id: 'WEAPONIZED CONFIDENCE', category: 'failure', severity: 'major', group: 'wrong-volume', rarity: 0.5, needsJudged: true,
    lines: ['Evidence repeatedly disagreed. Confidence remained unaffected.'],
    test: (p, c) => (p.judged >= 7 && acc(p) < 0.3 && p.wrong >= Math.max(5, 0.75 * c.maxWrong))
      ? { strength: clamp01(0.55 + (0.3 - acc(p)) + 0.02 * (p.wrong - 5)), evidence: attemptEvidence(p) } : null },

  { id: 'THE BLIND ARCHER', category: 'failure', severity: 'major', group: 'wrong-volume', rarity: 0.5, needsJudged: true,
    lines: ['Volume was impressive. Direction was not.'],
    test: p => (p.judged >= 10 && p.correct <= 1)
      ? { strength: clamp01(0.6 + 0.02 * (p.judged - 10)), evidence: attemptEvidence(p) } : null },

  { id: 'STATISTICAL ANOMALY', category: 'failure', severity: 'minor', group: 'wrong-volume', rarity: 0.4, needsJudged: true,
    lines: ['Probability suggests this should have gone better.'],
    test: (p, c) => (p.judged >= 6 && acc(p) <= 0.2 && c.roomAccuracy !== null && acc(p) <= c.roomAccuracy - 0.3)
      ? { strength: clamp01(0.5 + (c.roomAccuracy - acc(p)) * 0.3), evidence: attemptEvidence(p).concat([`ROOM ACCURACY: ${pct(c.roomAccuracy)}`]) } : null },

  { id: 'MANUAL OVERRIDE REQUIRED', category: 'failure', severity: 'catastrophic', group: 'wrong-volume', rarity: 0.8, needsJudged: true,
    lines: ['Autonomous operation not recommended.'],
    test: p => (p.judged >= 12 && p.correct === 0)
      ? { strength: clamp01(0.85 + 0.01 * (p.judged - 12)), evidence: attemptEvidence(p) } : null },

  { id: 'RESOURCE CONSUMER', category: 'failure', severity: 'minor', group: 'wrong-volume', rarity: 0.35, needsJudged: true,
    lines: ['Input requirements exceeded output.'],
    test: p => (p.messages >= 12 && p.share <= 0.05 && p.wrong >= 4 && p.judged >= 5)
      ? { strength: clamp01(0.45 + 0.01 * (p.messages - 12)), evidence: [plural(p.messages, 'MESSAGE', 'MESSAGES'), `${p.wrong} INCORRECT`, `${pct(p.share)} OF ALL POINTS`] } : null },

  { id: 'THE RED HERRING', category: 'failure', severity: 'major', group: 'wrong-volume', rarity: 0.35, needsJudged: true,
    lines: ['Team required additional effort to recover from assistance.'],
    test: (p, c) => (p.wrong >= 5 && p.wrong === c.maxWrong && c.active.filter(x => x.wrong === c.maxWrong).length === 1 && acc(p) >= 0.3)
      ? { strength: clamp01(0.5 + 0.02 * (p.wrong - 5)), evidence: [`${p.wrong} INCORRECT ANSWERS: THE MOST OF ANY PLAYER`, `${pct(acc(p))} ACCURACY`] } : null },

  { id: 'THE FALSE PROPHET', category: 'failure', severity: 'major', group: 'repeat-wrong', rarity: 0.6, needsJudged: true,
    lines: ['Spoke with authority. Reality declined to cooperate.'],
    test: p => p.wrongRepeat.count >= 3
      ? { strength: clamp01(0.6 + 0.1 * (p.wrongRepeat.count - 3)), evidence: [`"${p.wrongRepeat.text.toUpperCase()}" REJECTED ${p.wrongRepeat.count} TIMES`] } : null },

  { id: 'THE CONFIDENCE PARADOX', category: 'failure', severity: 'major', group: 'speed-wrong', rarity: 0.55, needsJudged: true,
    lines: ['Speed: excellent. Judgment: absent.'],
    test: (p, c) => (p.judged >= 8 && p.medianGapMs !== null && p.medianGapMs <= 25000 &&
        c.medianOfMedianGaps !== null && p.medianGapMs <= c.medianOfMedianGaps && acc(p) <= 0.25)
      ? { strength: clamp01(0.55 + (0.25 - acc(p))), evidence: [`MEDIAN ${Math.round(p.medianGapMs / 1000)}S BETWEEN ATTEMPTS`, `${pct(acc(p))} ACCURACY`, plural(p.judged, 'ATTEMPT', 'ATTEMPTS')] } : null },

  { id: 'HUMAN CAPTCHA FAILURE', category: 'failure', severity: 'major', group: 'clue-exposed', rarity: 0.5, needsJudged: true,
    lines: ['Verification unsuccessful.'],
    test: p => p.wrongAtHigh >= 3
      ? { strength: clamp01(0.6 + 0.05 * (p.wrongAtHigh - 3)), evidence: [`${p.wrongAtHigh} INCORRECT ANSWERS WITH 12+ OF 16 CLUES ALREADY REVEALED`] } : null },

  { id: 'COGNITIVE FRIENDLY FIRE', category: 'failure', severity: 'major', group: 'clue-exposed', rarity: 0.45, needsJudged: true,
    lines: ['Information was provided. Damage increased.'],
    test: p => p.wrongAtMid >= 4
      ? { strength: clamp01(0.5 + 0.04 * (p.wrongAtMid - 4)), evidence: [`${p.wrongAtMid} INCORRECT ANSWERS WITH 8+ OF 16 CLUES ALREADY REVEALED`] } : null },

  { id: 'PATTERN RESISTANT', category: 'failure', severity: 'minor', group: 'clue-exposed', rarity: 0.35, needsJudged: true,
    lines: ['Pattern recognition module not found.'],
    test: p => (p.wrongAtMid >= 5 && acc(p) < 0.4)
      ? { strength: clamp01(0.4 + 0.03 * (p.wrongAtMid - 5)), evidence: [`${p.wrongAtMid} INCORRECT ANSWERS WITH 8+ OF 16 CLUES REVEALED`, `${pct(acc(p))} ACCURACY`] } : null },

  { id: 'THE LIABILITY', category: 'failure', severity: 'major', group: 'contribution-low', rarity: 0.5, needsJudged: true,
    lines: ['Team performance improved whenever this player stopped contributing.'],
    test: (p, c) => {
      if (c.activeCount < 4 || !(p.judged >= 5 || p.messages >= 8) || p.presenceRatio < 0.6) return null;
      const min = Math.min(...c.activePoints);
      const med = median(c.activePoints);
      if (p.points !== min || c.active.filter(x => x.points === min).length !== 1) return null;
      if (!(med > 0 && p.points <= 0.25 * med)) return null;
      return { strength: clamp01(0.55 + (0.25 - p.points / med) * 0.4), evidence: [`${p.points} POINTS`, `ACTIVE-PLAYER MEDIAN: ${Math.round(med)}`, plural(p.judged, 'JUDGED ATTEMPT', 'JUDGED ATTEMPTS')] };
    } },

  { id: 'THE ANCHOR', category: 'failure', severity: 'minor', group: 'contribution-low', rarity: 0.35, needsJudged: true,
    lines: ['Attached firmly to the bottom. Refused buoyancy.'],
    test: (p, c) => {
      if (c.activeCount < 4 || p.presenceRatio < 0.5) return null;
      const min = Math.min(...c.activePoints), top = Math.max(...c.activePoints);
      if (p.points !== min || c.active.filter(x => x.points === min).length !== 1 || top <= 0) return null;
      return p.points <= 0.1 * top ? { strength: clamp01(0.45 + (0.1 - Math.max(0, p.points) / top) * 0.5), evidence: [`${p.points} POINTS`, `TOP SCORE: ${top}`] } : null;
    } },

  { id: 'STRATEGIC IRRELEVANCE', category: 'failure', severity: 'catastrophic', group: 'contribution-low', rarity: 0.85, needsJudged: true,
    lines: ['Simulation results unchanged when contribution removed.'],
    test: (p, c) => (c.activeCount >= 4 && p.presenceRatio >= 0.6 && (p.messages + p.judged) >= 10 && p.correct === 0 && p.solves === 0 && p.share === 0)
      ? { strength: clamp01(0.85 + 0.01 * (p.messages + p.judged - 10)), evidence: [plural(p.messages, 'MESSAGE', 'MESSAGES'), plural(p.judged, 'JUDGED ATTEMPT', 'JUDGED ATTEMPTS'), '0 SOLUTIONS', '0% OF ALL POINTS'] } : null },

  { id: 'THE NPC', category: 'failure', severity: 'minor', group: 'inactive', rarity: 0.3, inactivity: true,
    lines: ['Present. Technically.'],
    test: (p, c) => (c.activeCount >= 3 && c.matchMs >= T.MIN_MATCH_MS_FOR_INACTIVITY && p.presenceRatio >= 0.5 && p.messages === 0 && p.judged === 0 && p.solves === 0)
      ? { strength: clamp01(0.4 + p.presenceRatio * 0.3), evidence: [`PRESENT FOR ${pct(p.presenceRatio)} OF THE MATCH`, '0 MESSAGES', '0 JUDGED ATTEMPTS'] } : null },

  { id: 'THE DECORATION', category: 'failure', severity: 'minor', group: 'inactive', rarity: 0.3, inactivity: true,
    lines: ['Aesthetic contribution accepted.'],
    test: (p, c) => (c.activeCount >= 3 && c.matchMs >= T.MIN_MATCH_MS_FOR_INACTIVITY && p.presenceRatio >= 0.5 && p.messages >= 1 && p.messages <= 3 && p.judged <= 1 && p.solves === 0)
      ? { strength: clamp01(0.35 + p.presenceRatio * 0.3), evidence: [`PRESENT FOR ${pct(p.presenceRatio)} OF THE MATCH`, plural(p.messages, 'MESSAGE', 'MESSAGES'), plural(p.judged, 'JUDGED ATTEMPT', 'JUDGED ATTEMPTS')] } : null },

  { id: 'THE TOURIST', category: 'failure', severity: 'minor', group: 'short-stay', rarity: 0.2, inactivity: true,
    lines: ['Visited. Did not stay.'],
    test: (p, c) => (c.matchMs >= 5 * 60 * 1000 && p.presenceRatio > 0 && p.presenceRatio <= 0.35 && p.messages >= 1 && p.solves === 0)
      ? { strength: clamp01(0.3 + (0.35 - p.presenceRatio)), evidence: [`PRESENT FOR ${pct(p.presenceRatio)} OF THE MATCH`, plural(p.messages, 'MESSAGE', 'MESSAGES')] } : null },

  { id: 'THOUGHTS AND PRAYERS', category: 'failure', severity: 'minor', group: 'noise', rarity: 0.4, needsJudged: true,
    lines: ['Intent detected. Utility unavailable.'],
    test: p => (p.messages >= 12 && p.judged <= 2 && p.solves === 0)
      ? { strength: clamp01(0.4 + 0.01 * (p.messages - 12)), evidence: [plural(p.messages, 'MESSAGE', 'MESSAGES'), plural(p.judged, 'JUDGED ATTEMPT', 'JUDGED ATTEMPTS'), '0 SOLUTIONS'] } : null },

  { id: 'BRAIN BUFFERING', category: 'failure', severity: 'minor', group: 'drought', rarity: 0.5, needsJudged: true,
    lines: ['Processing continued. Results did not.'],
    test: (p, c) => (c.matchMs >= 10 * 60 * 1000 && p.presenceRatio >= 0.7 && p.correct >= 1 && p.drought >= 0.6 * c.matchMs)
      ? { strength: clamp01(0.4 + (p.drought / c.matchMs - 0.6)), evidence: [`LONGEST PERIOD WITHOUT A CORRECT ANSWER: ${clock(p.drought)}`, `${pct(p.drought / c.matchMs)} OF THE MATCH`] } : null },

  { id: 'LOCALIZED SYSTEM FAILURE', category: 'failure', severity: 'catastrophic', group: 'history-down', rarity: 0.9,
    lines: ['Previous competence could not be reproduced.'],
    test: p => (p.history && p.history.avg >= T.HISTORY_MIN_AVG_POINTS && p.points <= 0.3 * p.history.avg && p.presenceRatio >= 0.6 && (p.judged >= 5 || p.messages >= 5))
      ? { strength: clamp01(0.8 + Math.min(0.2, (0.3 - p.points / p.history.avg) * 0.5)),
          evidence: [`CAREER AVERAGE: ${Math.round(p.history.avg)}`, `THIS MATCH: ${p.points}`, `PERFORMANCE CHANGE: ${(((p.points - p.history.avg) / p.history.avg) * 100).toFixed(1)}%`] } : null }
];

const SEVERITY_BONUS = { minor: 0, major: 0.05, catastrophic: 0.12 };

// ------------------------------------------------------------- selection

function selectAwards(ctx, seed) {
  const failureGate = ctx.totalJudged >= T.MIN_TOTAL_JUDGED_FOR_FAILURE;
  const candidates = [];

  for (const def of AWARDS) {
    if (def.category === 'failure' && def.needsJudged && !failureGate) continue;
    if (def.coHolders) {
      // Co-winners share one award card.
      const holders = ctx.players.filter(p => def.test(p, ctx));
      if (!holders.length) continue;
      const first = def.test(holders[0], ctx);
      candidates.push(makeCandidate(def, holders, first, seed));
      continue;
    }
    for (const p of ctx.players) {
      const r = def.test(p, ctx);
      if (r) candidates.push(makeCandidate(def, [p], r, seed));
    }
  }

  // Conflict groups: per player, only the strongest award of a group survives.
  const best = new Map();
  for (const cand of candidates) {
    for (const holder of cand.holders) {
      const k = `${holder.playerId}|${cand.def.group}`;
      const cur = best.get(k);
      if (!cur || cand.rank > cur.rank || (cand.rank === cur.rank && cand.tie > cur.tie)) best.set(k, cand);
    }
  }
  const survivors = Array.from(new Set(best.values())).sort((a, b) => b.interest - a.interest || b.tie - a.tie);

  // Selection with per-player limits and no repeating the same behaviour.
  const picked = [];
  const perPlayer = {};
  const groupsUsed = new Set();
  for (const cand of survivors) {
    if (picked.length >= T.MAX_AWARDS) break;
    if (picked.length >= 2 && !(cand.interest >= T.THIRD_AWARD_MIN_INTEREST || cand.def.severity === 'catastrophic' || cand.strength >= 0.9)) continue;
    if (groupsUsed.has(cand.def.group) && cand.strength < 0.9) continue;
    const blocked = cand.holders.some(h => {
      const mine = perPlayer[h.playerId] || [];
      if (mine.length >= T.MAX_AWARDS_PER_PLAYER) return true;
      if (mine.length === 1) {
        // A second award only if BOTH are exceptional and describe different behaviour.
        return !(cand.strength >= T.SECOND_AWARD_MIN_STRENGTH && mine[0].strength >= T.SECOND_AWARD_MIN_STRENGTH && mine[0].def.group !== cand.def.group);
      }
      return false;
    });
    if (blocked) continue;
    picked.push(cand);
    groupsUsed.add(cand.def.group);
    cand.holders.forEach(h => { (perPlayer[h.playerId] = perPlayer[h.playerId] || []).push(cand); });
  }
  return picked;
}

function makeCandidate(def, holders, result, seed) {
  const strength = clamp01(result.strength);
  const bonus = SEVERITY_BONUS[def.severity] || 0;
  return {
    def, holders, strength,
    evidence: result.evidence,
    interest: 0.55 * strength + 0.3 * def.rarity + bonus,
    rank: strength + bonus,
    tie: hash01(seed, def.id, holders.map(h => h.nameKey).join('+'))
  };
}

const CATEGORY_ORDER = { distinction: 0, anomaly: 1, failure: 2 };
const HEADERS = { distinction: 'MATCH DISTINCTION', anomaly: 'PERFORMANCE ANOMALY DETECTED', failure: 'STATISTICAL FINDING' };

function presentAwards(picked, seed) {
  const ordered = picked.slice().sort((a, b) => CATEGORY_ORDER[a.def.category] - CATEGORY_ORDER[b.def.category] || b.interest - a.interest);
  return ordered.map((cand, index) => {
    const lines = cand.def.lines;
    const variant = lines[Math.floor(hash01(seed, 'line', cand.def.id, cand.holders.map(h => h.nameKey).join('+')) * lines.length) % lines.length];
    return {
      id: cand.def.id,
      category: cand.def.category,
      severity: cand.def.severity || null,
      header: index === 2 ? 'ADDITIONAL FINDING' : HEADERS[cand.def.category],
      playerNames: cand.holders.map(h => h.name),
      evidence: cand.evidence,
      commentary: variant
    };
  });
}

// ------------------------------------------------------------- scoreboard

function buildScoreboard(match) {
  // Every recorded participant is listed -- including someone who was present
  // but silent. Ties break on FEWER wrong answers; only fully equal results
  // share the place.
  const participants = match.players || [];
  const ranked = rankByKeys(participants, p => [p.matchPoints, -(p.judged ? p.judged.wrong : 0)]);
  return ranked.map(({ item, rank }) => ({
    rank,
    name: item.name,
    points: item.matchPoints,
    judged: item.judged || { total: 0, correct: 0, wrong: 0 }
  }));
}

function buildOverall(match, profiles, keyFn) {
  const rows = Object.values(profiles || {}).map(p => ({ key: keyFn(p.name), name: p.name, total: p.lifetimeScore || 0, gamesPlayed: p.gamesPlayed || 0 }));
  const ranked = rankByKeys(rows, r => [r.total]);
  const moves = {};
  (match.standings || []).forEach(s => { moves[s.key] = s; });
  const inMatch = new Set((match.players || []).map(p => p.nameKey));

  const all = ranked.map(({ item, rank }) => {
    const s = moves[item.key];
    return {
      rank,
      name: item.name,
      total: item.total,
      gamesPlayed: item.gamesPlayed,
      average: item.gamesPlayed > 0 ? Math.round(item.total / item.gamesPlayed) : null,
      movement: s ? s.rankBefore - s.rankAfter : null, // +N = up N places, 0 = unchanged
      inMatch: inMatch.has(item.key)
    };
  });
  const TOP = 10;
  return all.filter((row, i) => i < TOP || row.inMatch);
}

// ------------------------------------------------------------------ main

function computeRecount({ match, history = [], profiles = {}, keyFn, seed }) {
  const scoreboard = buildScoreboard(match);
  const top = scoreboard.length ? scoreboard[0].points : 0;
  const lost = match.outcome === 'LOST';
  const winners = !lost && top > 0 ? scoreboard.filter(r => r.rank === 1) : [];
  const topPerformers = lost && scoreboard.length ? scoreboard.filter(r => r.rank === 1) : [];

  const ctx = buildStats(match, history, keyFn);
  const awards = presentAwards(selectAwards(ctx, seed || match.matchId), seed || match.matchId);

  return {
    version: 1,
    matchId: match.matchId,
    title: match.title || '',
    difficulty: match.difficulty || null,
    gameWon: match.gameWon === true,
    outcome: lost ? 'LOST' : (match.gameWon === true ? 'WON' : null),
    topLabel: lost ? 'TOP PERFORMER' : 'MATCH WINNER',
    summary: {
      players: scoreboard.length,
      highScore: top,
      totalPoints: scoreboard.reduce((n, r) => n + r.points, 0),
      complete: true
    },
    winners: winners.map(w => ({ name: w.name, points: w.points })),
    topPerformers: topPerformers.map(w => ({ name: w.name, points: w.points })),
    scoreboard,
    awards,
    overall: buildOverall(match, profiles, keyFn)
  };
}

module.exports = {
  T, AWARDS, HELD_AWARDS,
  hash01, rankByKeys, buildStats, selectAwards, presentAwards, buildScoreboard, buildOverall, computeRecount
};
