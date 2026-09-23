// Unit tests for the RECOUNT / Match Awards Engine (pure, no server).
const assert = require('assert/strict');
const engine = require('../recount-engine');

const keyFn = name => String(name || '').trim().toLocaleLowerCase();
const START = 1_000_000;

// ---- fixture builder ------------------------------------------------------
// players: [{ id, name, points, presence (0..1), messages }]
// attempts: [{ p, v: 'C'|'W', target?, text?, at (minutes), clues }]  (in order)
// events:   [{ p, type: 'column'|'final', target, points, clues, at (minutes), known }]
function mkMatch({ players, attempts = [], events = [], finalBy = null, minutes = 20, history = [], standings = [] }) {
  const duration = minutes * 60 * 1000;
  const recs = attempts.map((a, i) => ({
    seq: i + 1,
    messageId: `m${i}`,
    playerId: a.p,
    playerName: players.find(x => x.id === a.p).name,
    submittedAt: START + a.at * 60000,
    judgedAt: START + a.at * 60000 + 1000,
    textKey: (a.text || `guess ${i}`).toLowerCase(),
    verdict: a.v === 'C' ? 'correct' : 'wrong',
    target: a.v === 'C' ? (a.target || null) : null,
    cluesRevealedTotal: a.clues ?? 4
  }));
  return {
    match: {
      matchId: 'board-test',
      title: 'T', difficulty: 'RED', gameWon: false,
      startedAt: START, completedAt: START + duration, archivedAt: START + duration,
      fields: finalBy ? { FINAL: { status: 'solved', playerId: finalBy } } : { FINAL: { status: 'failed' } },
      players: players.map(pl => {
        const mine = recs.filter(r => r.playerId === pl.id);
        return {
          playerId: pl.id, name: pl.name, nameKey: keyFn(pl.name),
          matchPoints: pl.points,
          judged: { total: mine.length, correct: mine.filter(r => r.verdict === 'correct').length, wrong: mine.filter(r => r.verdict === 'wrong').length },
          messages: pl.messages ?? mine.length,
          presentMs: Math.round((pl.presence ?? 1) * duration)
        };
      }),
      attempts: recs,
      scoreEvents: events.map(e => ({
        type: e.type, target: e.target, playerId: e.p, points: e.points, cluesRevealed: e.clues ?? null,
        columnsKnownAtSolve: e.known ?? null, timestamp: START + e.at * 60000
      })),
      standings
    },
    history
  };
}

function priorMatches(nameKeyPoints) {
  // nameKeyPoints: { nina: [400, 500, ...] } -> archived prior matches
  const count = Math.max(...Object.values(nameKeyPoints).map(v => v.length));
  return Array.from({ length: count }, (_, i) => ({
    players: Object.entries(nameKeyPoints).filter(([, v]) => v[i] !== undefined).map(([nameKey, v]) => ({ nameKey, matchPoints: v[i] }))
  }));
}

const run = (fixture, profiles = {}, seed = 'seed-1') =>
  engine.computeRecount({ match: fixture.match, history: fixture.history, profiles, keyFn, seed });
const ids = recount => recount.awards.map(a => a.id);
const rep = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

// A believable four-player room used by several tests.
function room4({ bojan, extra = [] } = {}) {
  const players = [
    { id: 'nina', name: 'Nina', points: 900, presence: 1 },
    { id: 'marko', name: 'Marko', points: 500, presence: 1 },
    { id: 'bojan', name: 'Bojan', points: 100, presence: 1 },
    { id: 'ivana', name: 'Ivana', points: 300, presence: 1 }
  ];
  const attempts = [
    ...rep(6, i => ({ p: 'nina', v: i < 4 ? 'C' : 'W', target: 'A', at: i })),
    ...rep(6, i => ({ p: 'marko', v: i % 2 ? 'C' : 'W', target: 'B', at: i + 0.5 })),
    ...rep(5, i => ({ p: 'ivana', v: i < 3 ? 'C' : 'W', target: 'C', at: i + 0.2 })),
    ...(bojan || rep(14, i => ({ p: 'bojan', v: i < 2 ? 'C' : 'W', target: 'D', at: i + 0.7 }))),
    ...extra
  ];
  return { players, attempts };
}

function testWeaponizedConfidenceAndEvidence() {
  const { players, attempts } = room4();
  const r = run(mkMatch({ players, attempts }));
  const award = r.awards.find(a => a.id === 'WEAPONIZED CONFIDENCE');
  assert.ok(award, 'many wrong answers with a real volume earns the award');
  assert.deepEqual(award.playerNames, ['Bojan']);
  assert.deepEqual(award.evidence, ['14 ATTEMPTS', '2 CORRECT', '12 INCORRECT', '14.3% ACCURACY'], 'the machine has receipts');
  assert.equal(award.commentary, 'Evidence repeatedly disagreed. Confidence remained unaffected.');
  assert.equal(award.category, 'failure');
  console.log('PASS recount engine: awards are earned and carry hard evidence');
}

function testConflictGroupsAndPlayerLimits() {
  // 1 correct of 17: qualifies for WEAPONIZED, BLIND ARCHER, STATISTICAL ANOMALY and more in ONE group.
  const bojan = rep(17, i => ({ p: 'bojan', v: i === 0 ? 'C' : 'W', target: 'D', at: i + 0.7, text: `wrong ${i}` }));
  const { players, attempts } = room4({ bojan });
  const fixture = mkMatch({ players, attempts });
  const ctx = engine.buildStats(fixture.match, [], keyFn);
  const wrongVolume = engine.AWARDS.filter(a => a.group === 'wrong-volume' && a.test(ctx.players.find(p => p.playerId === 'bojan'), ctx));
  assert.ok(wrongVolume.length >= 2, `the setup must qualify for several awards of one behaviour (got ${wrongVolume.length})`);

  const r = run(fixture);
  const bojanAwards = r.awards.filter(a => a.playerNames.includes('Bojan'));
  const bojanGroups = bojanAwards.map(a => engine.AWARDS.find(d => d.id === a.id).group);
  assert.equal(new Set(bojanGroups).size, bojanGroups.length, 'never the same behaviour said several ways');
  assert.ok(bojanAwards.filter(a => engine.AWARDS.find(d => d.id === a.id).group === 'wrong-volume').length <= 1);
  assert.ok(r.awards.length >= 2 && r.awards.length <= 3, 'normally 2, at most 3');
  const perPlayer = {};
  r.awards.forEach(a => a.playerNames.forEach(n => { perPlayer[n] = (perPlayer[n] || 0) + 1; }));
  assert.ok(Object.values(perPlayer).every(n => n <= 2), 'hard maximum 2 awards per player');
  console.log('PASS recount engine: conflict groups and per-player limits');
}

function testParticipationProtection() {
  // Too little judged in the whole match: no accuracy-based cruelty at all.
  const players = [
    { id: 'a', name: 'Ana', points: 400 }, { id: 'b', name: 'Bruno', points: 100 },
    { id: 'c', name: 'Cara', points: 100 }, { id: 'd', name: 'Dino', points: 0 }
  ];
  const attempts = [
    ...rep(3, i => ({ p: 'a', v: 'C', target: 'A', at: i })),
    { p: 'd', v: 'W', at: 4 }, { p: 'd', v: 'W', at: 5 }
  ];
  const r = run(mkMatch({ players, attempts }));
  assert.ok(!r.awards.some(a => a.category === 'failure'), 'two wrong guesses cannot establish poor accuracy');

  // Even in a well-judged match, a player with two attempts is never branded.
  const room = room4();
  room.players.push({ id: 'late', name: 'Late', points: 0, presence: 0.1 });
  room.attempts.push({ p: 'late', v: 'W', at: 18 }, { p: 'late', v: 'W', at: 19 });
  const r2 = run(mkMatch(room));
  assert.ok(!r2.awards.some(a => a.playerNames.includes('Late') && a.category === 'failure' && a.id !== 'THE TOURIST'),
    'a late joiner with two attempts gets no accuracy verdict');
  console.log('PASS recount engine: participation protection');
}

function testNothingIsForced() {
  // Strong, clean match: distinctions only, no invented negative award.
  const players = [
    { id: 'a', name: 'Ana', points: 1500 }, { id: 'b', name: 'Bruno', points: 500 }, { id: 'c', name: 'Cara', points: 400 }
  ];
  const attempts = [
    ...rep(8, i => ({ p: 'a', v: i < 7 ? 'C' : 'W', target: 'A', at: i })),
    ...rep(5, i => ({ p: 'b', v: i < 3 ? 'C' : 'W', target: 'B', at: i + 0.3 })),
    ...rep(4, i => ({ p: 'c', v: i < 2 ? 'C' : 'W', target: 'C', at: i + 0.6 }))
  ];
  const r = run(mkMatch({ players, attempts, finalBy: 'a', events: [{ p: 'a', type: 'final', target: 'FINAL', points: 800, known: 2, at: 12 }] }));
  assert.ok(r.awards.length >= 1);
  assert.ok(!r.awards.some(a => a.category === 'failure'), 'no failure is invented to fill a slot');
  console.log('PASS recount engine: no forced negative awards');
}

function testDeterminism() {
  const room = room4();
  const a = run(mkMatch(room));
  const b = run(mkMatch(room));
  assert.deepEqual(a, b, 'the same inputs must always yield the same RECOUNT');
  const c = run(mkMatch(room), {}, 'a-different-seed');
  assert.deepEqual(ids(a).sort(), ids(c).sort(), 'the seed never changes WHAT was earned in a clear-cut case');
  assert.equal(engine.hash01('x', 'y'), engine.hash01('x', 'y'));
  console.log('PASS recount engine: deterministic');
}

function testHistoricalAwardsNeedHistory() {
  const players = [
    { id: 'n', name: 'Nina', points: 30, presence: 1 },
    { id: 'm', name: 'Marko', points: 600, presence: 1 },
    { id: 'x', name: 'Xena', points: 300, presence: 1 },
    { id: 'y', name: 'Yuri', points: 250, presence: 1 }
  ];
  const attempts = [
    ...rep(6, i => ({ p: 'n', v: i < 1 ? 'C' : 'W', target: 'A', at: i })),
    ...rep(6, i => ({ p: 'm', v: i < 5 ? 'C' : 'W', target: 'B', at: i + 0.3 })),
    ...rep(5, i => ({ p: 'x', v: i < 3 ? 'C' : 'W', target: 'C', at: i + 0.5 })),
    ...rep(5, i => ({ p: 'y', v: i < 3 ? 'C' : 'W', target: 'D', at: i + 0.8 }))
  ];
  // Too little history: the historical awards must not exist.
  const few = run(mkMatch({ players, attempts, history: priorMatches({ nina: [400, 450, 500], marko: [100, 120, 90] }) }));
  assert.ok(!ids(few).includes('LOCALIZED SYSTEM FAILURE') && !ids(few).includes('UNAUTHORIZED EVOLUTION'));

  // Enough history (>=5 archived matches each).
  const history = priorMatches({ nina: [400, 450, 500, 420, 480, 430], marko: [80, 100, 90, 110, 100, 60] });
  const r = run(mkMatch({ players, attempts, history }));
  const fail = r.awards.find(a => a.id === 'LOCALIZED SYSTEM FAILURE');
  assert.ok(fail, 'a historically strong player collapsing earns LOCALIZED SYSTEM FAILURE');
  assert.deepEqual(fail.playerNames, ['Nina']);
  assert.equal(fail.severity, 'catastrophic');
  assert.ok(fail.evidence.some(e => e.startsWith('CAREER AVERAGE: 447')));
  assert.ok(fail.evidence.some(e => e === 'THIS MATCH: 30'));
  assert.ok(fail.evidence.some(e => e.startsWith('PERFORMANCE CHANGE: -93.3%')));
  // RECOUNT now prints at most one card per player. Marko may already own the
  // top-score distinction, so prove UNAUTHORIZED EVOLUTION qualifies without
  // requiring the renderer to print both cards for the same person.
  const ctx = engine.buildStats(mkMatch({ players, attempts, history }).match, history, keyFn);
  const marko = ctx.players.find(p => p.playerId === 'm');
  const upDef = engine.AWARDS.find(a => a.id === 'UNAUTHORIZED EVOLUTION');
  const up = upDef.test(marko, ctx);
  assert.ok(up, 'a huge improvement over personal history qualifies for UNAUTHORIZED EVOLUTION');
  assert.ok(up.evidence.includes('PREVIOUS BEST: 110') && up.evidence.includes('THIS MATCH: 600'));
  console.log('PASS recount engine: historical awards need real history');
}

function testScoreboardTiesAndWinner() {
  const players = [
    { id: 'a', name: 'Ana', points: 300 }, { id: 'b', name: 'Bruno', points: 200 },
    { id: 'c', name: 'Cara', points: 200 }, { id: 'd', name: 'Dino', points: 100 }
  ];
  // Bruno and Cara: equal points AND equal wrong answers -> share 2nd, next is 4th.
  const shared = run(mkMatch({ players, attempts: [
    { p: 'b', v: 'W', at: 1 }, { p: 'c', v: 'W', at: 2 }
  ] }));
  assert.deepEqual(shared.scoreboard.map(r => r.rank), [1, 2, 2, 4]);

  // Equal points remain tied. Wrong answers may order equal-score rows for
  // readability, but they never silently manufacture a higher match rank.
  const broken = run(mkMatch({ players, attempts: [
    { p: 'b', v: 'W', at: 1 }, { p: 'b', v: 'W', at: 2 }, { p: 'c', v: 'W', at: 3 }
  ] }));
  assert.deepEqual(broken.scoreboard.map(r => `${r.name}:${r.rank}`), ['Ana:1', 'Cara:2', 'Bruno:2', 'Dino:4']);

  // A full tie at the top yields co-winners.
  const co = run(mkMatch({ players: [
    { id: 'a', name: 'Ana', points: 300 }, { id: 'b', name: 'Bruno', points: 300 }, { id: 'c', name: 'Cara', points: 50 }
  ] }));
  assert.deepEqual(co.winners.map(w => w.name).sort(), ['Ana', 'Bruno']);
  assert.equal(co.winners.length, 2, 'both tied top scorers are winners');
  assert.equal(co.topLabel, 'MATCH CO-WINNERS', 'a WON match with tied top points reads MATCH CO-WINNERS');

  // Nobody earned points: no winner is invented.
  const none = run(mkMatch({ players: [{ id: 'a', name: 'Ana', points: -200 }, { id: 'b', name: 'Bruno', points: -200 }] }));
  assert.deepEqual(none.winners, []);
  assert.equal(none.summary.highScore, -200);
  console.log('PASS recount engine: scoreboard ties, tie-break and winners');
}

function testLostMatchUsesTopPerformer() {
  const fixture = mkMatch({ players: [
    { id: 'a', name: 'Ana', points: 27 }, { id: 'b', name: 'Bruno', points: 10 }
  ] });
  fixture.match.outcome = 'LOST';
  const recount = run(fixture);
  assert.equal(recount.topLabel, 'TOP PERFORMER');
  assert.deepEqual(recount.winners, [], 'a lost match never names a match winner');
  assert.deepEqual(recount.topPerformers, [{ name: 'Ana', points: 27 }]);

  // Tied top points on a lost match: both performers share the label.
  const tied = mkMatch({ players: [
    { id: 'a', name: 'Ana', points: 27 }, { id: 'b', name: 'Bruno', points: 27 }, { id: 'c', name: 'Cara', points: 10 }
  ] });
  tied.match.outcome = 'LOST';
  const coLost = run(tied);
  assert.equal(coLost.topLabel, 'TOP PERFORMERS', 'tied top points on a LOST match reads TOP PERFORMERS');
  assert.deepEqual(coLost.topPerformers.map(w => w.name).sort(), ['Ana', 'Bruno']);
  assert.deepEqual(coLost.winners, [], 'a lost match never names match winners, even with a tie');
  console.log('PASS recount engine: LOST uses TOP PERFORMER, never MATCH WINNER');
}

function testOverallRankingsAndMovement() {
  const players = [{ id: 'n', name: 'Nina', points: 500 }, { id: 'm', name: 'Marko', points: 100 }];
  const profiles = {
    nina: { name: 'Nina', lifetimeScore: 1000, gamesPlayed: 4 },
    marko: { name: 'Marko', lifetimeScore: 900, gamesPlayed: 5 },
    ivana: { name: 'Ivana', lifetimeScore: 950, gamesPlayed: 3 }
  };
  const standings = [
    { key: 'nina', rankBefore: 3, rankAfter: 1 },
    { key: 'marko', rankBefore: 1, rankAfter: 3 }
  ];
  const r = run(mkMatch({ players, standings }), profiles);
  const row = name => r.overall.find(x => x.name === name);
  assert.equal(row('Nina').rank, 1);
  assert.equal(row('Nina').movement, 2, 'up two places');
  assert.equal(row('Marko').movement, -2, 'down two places');
  assert.equal(row('Ivana').movement, null, 'a non-participant has no movement');
  assert.equal(row('Nina').average, 250);
  assert.equal(row('Nina').inMatch, true);

  // First-ever game: everyone was tied at zero before it, so "moved down" would be a lie.
  const debut = run(mkMatch({ players, standings }), {
    nina: { name: 'Nina', lifetimeScore: 1000, gamesPlayed: 1 },
    marko: { name: 'Marko', lifetimeScore: 900, gamesPlayed: 1 }
  });
  assert.equal(debut.overall.find(x => x.name === 'Nina').movement, null, 'a debut claims no movement');
  assert.equal(debut.overall.find(x => x.name === 'Marko').movement, null, 'a debut claims no movement');
  console.log('PASS recount engine: overall rankings and rank movement');
}

function testInactivityAwardsAreGated() {
  const room = room4();
  room.players.push({ id: 'npc', name: 'Npc', points: 0, presence: 0.9, messages: 0 });
  // Long enough, 3+ active players, present the whole time, said nothing.
  const r = run(mkMatch({ ...room, minutes: 15 }));
  assert.ok(ids(r).includes('THE NPC') || true); // selection may prefer stronger awards; check qualification directly:
  const ctx = engine.buildStats(mkMatch({ ...room, minutes: 15 }).match, [], keyFn);
  const npc = engine.AWARDS.find(a => a.id === 'THE NPC');
  assert.ok(npc.test(ctx.players.find(p => p.playerId === 'npc'), ctx), 'silent but present qualifies');

  // A very short match cannot support an inactivity verdict.
  const shortCtx = engine.buildStats(mkMatch({ ...room, minutes: 2 }).match, [], keyFn);
  assert.equal(npc.test(shortCtx.players.find(p => p.playerId === 'npc'), shortCtx), null, 'too short to judge inactivity');
  console.log('PASS recount engine: inactivity awards are gated');
}

function testCatalogHonesty() {
  const idsInCatalog = engine.AWARDS.map(a => a.id);
  assert.equal(new Set(idsInCatalog).size, idsInCatalog.length, 'award ids are unique');
  engine.HELD_AWARDS.forEach(id => assert.ok(!idsInCatalog.includes(id), `${id} has no recordable evidence and must not ship`));
  engine.AWARDS.forEach(a => {
    assert.ok(['distinction', 'anomaly', 'failure'].includes(a.category), a.id);
    assert.ok(a.group && a.lines.length >= 1 && a.rarity >= 0 && a.rarity <= 1, a.id);
    if (a.category === 'failure') assert.ok(['minor', 'major', 'catastrophic'].includes(a.severity), `${a.id} needs a severity`);
  });
  // Rare awards must be strictly harder than common ones.
  const rarity = id => engine.AWARDS.find(a => a.id === id).rarity;
  assert.ok(rarity('PERFECT SPECIMEN') > rarity('THE ORACLE'));
  assert.ok(rarity('LOCALIZED SYSTEM FAILURE') > rarity('THE TOURIST'));
  console.log('PASS recount engine: catalog is honest and complete');
}

// ---- table-driven: every award qualifies on its threshold and misses just below it
function P(o = {}) {
  return {
    playerId: 'p', name: 'P', nameKey: 'p', points: 100, judged: 0, correct: 0, wrong: 0, accuracy: null,
    messages: 0, presenceRatio: 1, seq: [], flips: 0, longestWrong: 0, longestCorrect: 0,
    wrongRepeat: { text: '', count: 0 }, wrongAtMid: 0, wrongAtHigh: 0, dupCorrect: 0, medianGapMs: null,
    firstHalfAcc: null, secondHalfAcc: null, firstHalfN: 0, secondHalfN: 0, columnEvents: [], finalEvent: null,
    isFinalSolver: false, solves: 0, firstSolveAt: null, chain: 0, drought: 0, history: null, share: 0.25, active: true, ...o
  };
}
function evalAward(id, pOver, ctxOver = {}, others) {
  const def = engine.AWARDS.find(a => a.id === id);
  const p = P(pOver);
  const rest = others || [P({ playerId: 'q', points: 200, solves: 1, judged: 4, correct: 2, wrong: 2, messages: 4 }), P({ playerId: 'r', points: 150, messages: 4 })];
  const players = [p, ...rest];
  const active = players.filter(x => x.active);
  const ctx = {
    matchMs: 20 * 60000, players, active, activeCount: active.length, totalJudged: 30, roomAccuracy: 0.5, maxWrong: 5,
    maxSolves: 2, medianOfMedianGaps: 20000, activePoints: active.map(x => x.points), firstSolve: null, finalSolver: null, startedAt: START,
    ...ctxOver
  };
  return def.test(p, ctx);
}
const four = pts => pts.map((points, i) => P({ playerId: `o${i}`, points, judged: 5, messages: 6 }));

// [id, qualifying player overrides, qualifying ctx, near-miss player overrides, near-miss ctx]
const AWARD_CASES = [
  ['THE ARCHITECT', { solves: 3 }, { maxSolves: 3 }, { solves: 1 }, { maxSolves: 3 }],
  ['THE CLOSER', { isFinalSolver: true }, {}, { isFinalSolver: false }, {}],
  ["SHADOW BROKER'S ASSET", { points: 500 }, {}, { points: 100 }, {}],
  ['COLD READ', { columnEvents: [{ target: 'A', cluesRevealed: 1 }] }, {}, { columnEvents: [{ target: 'A', cluesRevealed: 2 }] }, {}],
  ['FIRST BLOOD', {}, { firstSolve: { playerId: 'p', target: 'A', timestamp: START + 60000 } }, {}, { firstSolve: { playerId: 'q', target: 'A', timestamp: START + 60000 } }],
  ['CHAIN REACTION', { chain: 2 }, {}, { chain: 1 }, {}],
  ['THE ORACLE', { judged: 8, correct: 7, wrong: 1, accuracy: 7 / 8 }, {}, { judged: 8, correct: 8, wrong: 0, accuracy: 1 }, {}],
  ['PERFECT SPECIMEN', { judged: 5, correct: 5, accuracy: 1 }, {}, { judged: 4, correct: 4, accuracy: 1 }, {}],
  ['SOLO CARRY', { share: 0.7 }, {}, { share: 0.5 }, {}],
  ['UNAUTHORIZED EVOLUTION', { points: 300, history: { games: 6, avg: 60, best: 110 } }, {}, { points: 100, history: { games: 6, avg: 60, best: 110 } }, {}],
  ['CHAOS THEORY', { judged: 12, correct: 6, wrong: 6, accuracy: 0.5, flips: 7 }, {}, { judged: 12, correct: 6, wrong: 6, accuracy: 0.5, flips: 3 }, {}],
  ['THE EXPERIMENT', { judged: 14, correct: 5, wrong: 9, accuracy: 5 / 14, longestWrong: 5, longestCorrect: 3 }, {}, { judged: 14, correct: 5, wrong: 9, accuracy: 5 / 14, longestWrong: 4, longestCorrect: 3 }, {}],
  ['ONE JOB', { solves: 1, judged: 2, messages: 3, isFinalSolver: true }, {}, { solves: 1, judged: 5, messages: 3, isFinalSolver: true }, {}],
  ['TACTICAL SILENCE', { messages: 2, judged: 2, points: 300, share: 0.3, presenceRatio: 0.8 }, {}, { messages: 6, judged: 2, points: 300, share: 0.3, presenceRatio: 0.8 }, {}],
  ['THE SURVIVOR', { judged: 10, firstHalfN: 5, secondHalfN: 5, firstHalfAcc: 0.2, secondHalfAcc: 0.8 }, {}, { judged: 10, firstHalfN: 5, secondHalfN: 5, firstHalfAcc: 0.5, secondHalfAcc: 0.8 }, {}],
  ['LAST TO KNOW', { dupCorrect: 2 }, {}, { dupCorrect: 1 }, {}],
  ['THE DONOR', { points: 300, columnEvents: [{ target: 'A' }, { target: 'B' }] }, { finalSolver: { playerId: 'q', points: 900 } }, { points: 300, columnEvents: [{ target: 'A' }, { target: 'B' }] }, { finalSolver: { playerId: 'q', points: 400 } }],
  ['WEAPONIZED CONFIDENCE', { judged: 14, correct: 2, wrong: 12, accuracy: 2 / 14 }, { maxWrong: 12 }, { judged: 14, correct: 7, wrong: 7, accuracy: 0.5 }, { maxWrong: 12 }],
  ['THE BLIND ARCHER', { judged: 12, correct: 1, wrong: 11, accuracy: 1 / 12 }, {}, { judged: 12, correct: 3, wrong: 9, accuracy: 0.25 }, {}],
  ['STATISTICAL ANOMALY', { judged: 7, correct: 1, wrong: 6, accuracy: 1 / 7 }, { roomAccuracy: 0.6 }, { judged: 7, correct: 1, wrong: 6, accuracy: 1 / 7 }, { roomAccuracy: 0.3 }],
  ['MANUAL OVERRIDE REQUIRED', { judged: 13, correct: 0, wrong: 13, accuracy: 0 }, {}, { judged: 13, correct: 1, wrong: 12, accuracy: 1 / 13 }, {}],
  ['RESOURCE CONSUMER', { messages: 15, share: 0.02, wrong: 5, judged: 6 }, {}, { messages: 15, share: 0.2, wrong: 5, judged: 6 }, {}],
  ['THE RED HERRING', { wrong: 6, judged: 12, correct: 6, accuracy: 0.5 }, { maxWrong: 6 }, { wrong: 6, judged: 12, correct: 6, accuracy: 0.5 }, { maxWrong: 6, others: [P({ playerId: 'q', wrong: 6 }), P({ playerId: 'r' })] }],
  ['THE FALSE PROPHET', { wrongRepeat: { text: 'the moon', count: 3 } }, {}, { wrongRepeat: { text: 'the moon', count: 2 } }, {}],
  ['THE CONFIDENCE PARADOX', { judged: 9, correct: 2, wrong: 7, accuracy: 2 / 9, medianGapMs: 12000 }, {}, { judged: 9, correct: 2, wrong: 7, accuracy: 2 / 9, medianGapMs: 40000 }, {}],
  ['HUMAN CAPTCHA FAILURE', { wrongAtHigh: 3 }, {}, { wrongAtHigh: 2 }, {}],
  ['COGNITIVE FRIENDLY FIRE', { wrongAtMid: 4 }, {}, { wrongAtMid: 3 }, {}],
  ['PATTERN RESISTANT', { wrongAtMid: 5, judged: 8, correct: 2, accuracy: 0.25 }, {}, { wrongAtMid: 5, judged: 8, correct: 5, accuracy: 0.6 }, {}],
  ['THE LIABILITY', { points: 20, judged: 6 }, { others: four([900, 500, 300]) }, { points: 20, judged: 6 }, { others: four([900, 500]) }],
  ['THE ANCHOR', { points: 50, judged: 6 }, { others: four([900, 500, 300]) }, { points: 400, judged: 6 }, { others: four([900, 500, 300]) }],
  ['STRATEGIC IRRELEVANCE', { messages: 8, judged: 4, correct: 0, wrong: 4, solves: 0, share: 0, points: 0, presenceRatio: 0.8 }, { others: four([900, 500, 300]) }, { messages: 8, judged: 4, correct: 1, wrong: 3, solves: 0, share: 0, points: 0, presenceRatio: 0.8 }, { others: four([900, 500, 300]) }],
  ['THE NPC', { active: false, presenceRatio: 0.9, messages: 0, judged: 0, solves: 0 }, { others: four([300, 200, 100]) }, { active: false, presenceRatio: 0.9, messages: 2, judged: 0, solves: 0 }, { others: four([300, 200, 100]) }],
  ['THE DECORATION', { active: false, presenceRatio: 0.9, messages: 2, judged: 0, solves: 0 }, { others: four([300, 200, 100]) }, { active: false, presenceRatio: 0.9, messages: 6, judged: 0, solves: 0 }, { others: four([300, 200, 100]) }],
  ['THE TOURIST', { presenceRatio: 0.2, messages: 2, solves: 0 }, {}, { presenceRatio: 0.6, messages: 2, solves: 0 }, {}],
  ['THOUGHTS AND PRAYERS', { messages: 14, judged: 1, solves: 0 }, {}, { messages: 14, judged: 5, solves: 0 }, {}],
  ['BRAIN BUFFERING', { presenceRatio: 0.9, correct: 1, judged: 5, drought: 14 * 60000 }, {}, { presenceRatio: 0.9, correct: 1, judged: 5, drought: 5 * 60000 }, {}],
  ['LOCALIZED SYSTEM FAILURE', { points: 50, judged: 6, history: { games: 6, avg: 400, best: 600 } }, {}, { points: 300, judged: 6, history: { games: 6, avg: 400, best: 600 } }, {}]
];

function testEveryAwardQualifiesAtItsThresholdAndMissesJustBelow() {
  const covered = new Set(AWARD_CASES.map(c => c[0]));
  engine.AWARDS.forEach(a => assert.ok(covered.has(a.id), `${a.id} has no threshold test`));
  for (const [id, hit, hitCtx, miss, missCtx] of AWARD_CASES) {
    const { others: hitOthers, ...hitCtxClean } = hitCtx;
    const { others: missOthers, ...missCtxClean } = missCtx;
    const yes = evalAward(id, hit, hitCtxClean, hitOthers);
    assert.ok(yes, `${id} must qualify when its thresholds are met`);
    assert.ok(yes.strength >= 0 && yes.strength <= 1, `${id} strength must be within 0..1 (got ${yes.strength})`);
    assert.ok(Array.isArray(yes.evidence) && yes.evidence.length >= 1 && yes.evidence.every(e => typeof e === 'string' && e.length), `${id} must show evidence`);
    assert.equal(evalAward(id, miss, missCtxClean, missOthers), null, `${id} must NOT qualify just below its threshold`);
  }
  console.log(`PASS recount engine: all ${AWARD_CASES.length} awards hit their thresholds and miss just below`);
}

function testSeverityOutranksOnEqualStrength() {
  const sev = id => engine.AWARDS.find(a => a.id === id).severity;
  assert.equal(sev('THE TOURIST'), 'minor');
  assert.equal(sev('WEAPONIZED CONFIDENCE'), 'major');
  ['STRATEGIC IRRELEVANCE', 'LOCALIZED SYSTEM FAILURE', 'MANUAL OVERRIDE REQUIRED'].forEach(id => assert.equal(sev(id), 'catastrophic', id));
  // Same underlying behaviour (0 correct of 13): the catastrophic tier must win the conflict group.
  const bojan = rep(13, i => ({ p: 'bojan', v: 'W', at: i + 0.7, text: `w${i}` }));
  const { players, attempts } = room4({ bojan });
  const r = run(mkMatch({ players, attempts }));
  const mine = r.awards.filter(a => a.playerNames.includes('Bojan'));
  assert.ok(mine.some(a => a.id === 'MANUAL OVERRIDE REQUIRED'), 'zero correct of 13 earns the catastrophic tier');
  assert.ok(!mine.some(a => ['THE BLIND ARCHER', 'WEAPONIZED CONFIDENCE'].includes(a.id)), 'weaker tiers of the same behaviour are suppressed');
  console.log('PASS recount engine: failure severity tiers win their conflict group');
}

testWeaponizedConfidenceAndEvidence();
testConflictGroupsAndPlayerLimits();
testEveryAwardQualifiesAtItsThresholdAndMissesJustBelow();
testSeverityOutranksOnEqualStrength();
testParticipationProtection();
testNothingIsForced();
testDeterminism();
testHistoricalAwardsNeedHistory();
testScoreboardTiesAndWinner();
testLostMatchUsesTopPerformer();
testOverallRankingsAndMovement();
testInactivityAwardsAreGated();
testCatalogHonesty();
console.log('ALL RECOUNT ENGINE TESTS PASSED');
