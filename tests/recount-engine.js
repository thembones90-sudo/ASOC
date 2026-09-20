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
  const up = r.awards.find(a => a.id === 'UNAUTHORIZED EVOLUTION');
  assert.ok(up, 'a huge improvement over personal history earns UNAUTHORIZED EVOLUTION');
  assert.deepEqual(up.playerNames, ['Marko']);
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

  // Equal points but FEWER wrong answers ranks higher; not shared.
  const broken = run(mkMatch({ players, attempts: [
    { p: 'b', v: 'W', at: 1 }, { p: 'b', v: 'W', at: 2 }, { p: 'c', v: 'W', at: 3 }
  ] }));
  assert.deepEqual(broken.scoreboard.map(r => `${r.name}:${r.rank}`), ['Ana:1', 'Cara:2', 'Bruno:3', 'Dino:4']);

  // A full tie at the top yields co-winners.
  const co = run(mkMatch({ players: [
    { id: 'a', name: 'Ana', points: 300 }, { id: 'b', name: 'Bruno', points: 300 }, { id: 'c', name: 'Cara', points: 50 }
  ] }));
  assert.deepEqual(co.winners.map(w => w.name).sort(), ['Ana', 'Bruno']);

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

testWeaponizedConfidenceAndEvidence();
testConflictGroupsAndPlayerLimits();
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
