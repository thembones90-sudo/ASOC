// Unit tests for the RECOUNT data-capture layer: match-ledger.js (pure rules)
// and match-store.js (durable archive). No server needed.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MATCHES = path.join(os.tmpdir(), `asoc-test-matches-${process.pid}.json`);
process.env.ASOC_MATCHES_FILE = MATCHES; // must be set before requiring the store

const ledgerLib = require('../match-ledger');
const store = require('../match-store');

const keyFn = name => String(name || '').trim().toLocaleLowerCase();

function cleanup() {
  for (const file of fs.readdirSync(os.tmpdir())) {
    if (file.startsWith(path.basename(MATCHES))) { try { fs.unlinkSync(path.join(os.tmpdir(), file)); } catch {} }
  }
}

function testAttemptsAreJudgedOnly() {
  const l = ledgerLib.createLedger('board-1', 1000, [{ playerId: 'p1', playerName: 'Nina' }]);

  // Chatter is ACTIVITY, never an attempt.
  ledgerLib.recordActivity(l, 'p1', 'Nina', 1100);
  ledgerLib.recordActivity(l, 'p1', 'Nina', 1200);
  ledgerLib.recordActivity(l, 'p2', 'Marko', 1300);
  assert.equal(l.attempts.length, 0, 'unjudged messages must never become attempts');
  assert.equal(l.activity.p1.messages, 2);
  assert.ok(l.presence.p2, 'a message proves participation');

  // Judging creates the attempt; an invalid verdict is ignored.
  assert.equal(ledgerLib.recordAttempt(l, { messageId: 'm1', playerId: 'p1', verdict: 'maybe', now: 1 }), null);
  ledgerLib.recordAttempt(l, {
    messageId: 'm1', playerId: 'p1', playerName: 'Nina', submittedAt: 1150,
    verdict: 'wrong', target: 'A', text: '  The   QUICK Fox ', cluesRevealedTotal: 3, now: 1400
  });
  assert.equal(l.attempts.length, 1);
  assert.equal(l.attempts[0].target, null, 'a wrong verdict carries no target');
  assert.equal(l.attempts[0].textKey, 'the quick fox');

  // A flipped/retargeted verdict updates the SAME attempt (latest wins).
  ledgerLib.recordAttempt(l, {
    messageId: 'm1', playerId: 'p1', playerName: 'Nina', verdict: 'correct', target: 'B',
    text: 'x', cluesRevealedTotal: 5, now: 1500
  });
  assert.equal(l.attempts.length, 1);
  assert.equal(l.attempts[0].verdict, 'correct');
  assert.equal(l.attempts[0].target, 'B');
  assert.equal(l.attempts[0].cluesRevealedTotal, 5);
  assert.equal(l.attempts[0].seq, 1);
  console.log('PASS match ledger: attempts are GM-judged only');
}

function testPresence() {
  const l = ledgerLib.createLedger('board-1', 1000, []);
  ledgerLib.presenceOpen(l, 'p1', 'Nina', 1000);
  ledgerLib.presenceOpen(l, 'p1', 'Nina', 1200); // reconnect while open: no double count
  assert.equal(l.presence.p1.intervals.length, 1);
  ledgerLib.presenceClose(l, 'p1', 2000);
  ledgerLib.presenceOpen(l, 'p1', 'Nina', 3000);
  assert.equal(l.presence.p1.intervals.length, 2);
  ledgerLib.closeAllPresence(l, 4000);
  assert.deepEqual(l.presence.p1.intervals, [{ from: 1000, to: 2000 }, { from: 3000, to: 4000 }]);
  assert.equal(l.presence.p1.firstSeenAt, 1000, 'first-seen survives reconnects');
  console.log('PASS match ledger: presence intervals');
}

function testFieldResolutionAndCompletion() {
  const l = ledgerLib.createLedger('board-1', 1000, []);
  const solved = (playerId, timestamp) => ({ solved: true, playerId, playerName: playerId, timestamp });

  // Nothing solved, failed or opened: the whole field is still closed.
  let fields = ledgerLib.resolveFields({ solvedTargets: {}, failedColumns: {}, ledger: l });
  assert.equal(ledgerLib.isComplete(fields), false);
  assert.equal(ledgerLib.refreshCompletion(l, fields, 2000), null);

  // The ending parameter is the WHOLE FIELD OPENED: a slot that is simply
  // revealed on the board counts, however it got opened (plain GM reveal,
  // REVEAL ALL, ...), alongside solved and failed.
  const allOpen = { A: true, B: true, C: true, D: true, FINAL: true };
  const opened = ledgerLib.resolveFields({ solvedTargets: {}, failedColumns: {}, revealed: allOpen, ledger: l });
  assert.equal(opened.A.status, 'revealed');
  assert.equal(ledgerLib.isComplete(opened), true, 'five opened slots end the game');
  const oneHidden = ledgerLib.resolveFields({ solvedTargets: {}, failedColumns: {}, revealed: { ...allOpen, FINAL: false }, ledger: l });
  assert.equal(oneHidden.FINAL.status, 'open');
  assert.equal(ledgerLib.isComplete(oneHidden), false, 'the Final still hidden is not the end');
  // Precedence keeps the most informative reason: solved > failed > revealed.
  const mixed = ledgerLib.resolveFields({
    solvedTargets: { A: { playerId: 'p1', timestamp: 1 } }, failedColumns: { A: true, B: true }, revealed: allOpen, ledger: l
  });
  assert.equal(mixed.A.status, 'solved');
  assert.equal(mixed.B.status, 'failed');
  assert.equal(mixed.C.status, 'revealed');

  // Four fields resolved, FINAL still open: NOT complete (Final-first is not the rule).
  ledgerLib.markFailed(l, 'B', 2100);
  fields = ledgerLib.resolveFields({
    solvedTargets: { A: solved('p1', 2050), C: solved('p2', 2060), D: solved('p1', 2070) },
    failedColumns: { B: true },
    ledger: l
  });
  assert.equal(fields.B.status, 'failed');
  assert.equal(fields.B.at, 2100);
  assert.equal(fields.FINAL.status, 'open');
  assert.equal(ledgerLib.isComplete(fields), false);

  // Final solved EARLY with columns still open is not the end either.
  const early = ledgerLib.resolveFields({
    solvedTargets: { FINAL: solved('p1', 1500) }, failedColumns: {}, ledger: ledgerLib.createLedger('b2', 1, [])
  });
  assert.equal(early.FINAL.status, 'solved');
  assert.equal(ledgerLib.isComplete(early), false);

  // All five resolved -> completes ONCE, stamped.
  ledgerLib.markFailed(l, 'FINAL', 2200);
  fields = ledgerLib.resolveFields({
    solvedTargets: { A: solved('p1', 2050), C: solved('p2', 2060), D: solved('p1', 2070) },
    failedColumns: { B: true }, ledger: l
  });
  assert.equal(fields.FINAL.status, 'failed');
  assert.equal(ledgerLib.refreshCompletion(l, fields, 2300), 'completed');
  assert.equal(l.completedAt, 2300);
  assert.equal(ledgerLib.refreshCompletion(l, fields, 2400), null, 'idempotent');
  assert.equal(l.completedAt, 2300);

  // A real solve outranks a GM-declared failure for the same field.
  fields = ledgerLib.resolveFields({
    solvedTargets: { A: solved('p1', 2050), B: solved('p3', 2500), C: solved('p2', 2060), D: solved('p1', 2070) },
    failedColumns: { B: true }, ledger: l
  });
  assert.equal(fields.B.status, 'solved');
  assert.equal(fields.B.playerId, 'p3');

  // Re-opening a field (a reversed verdict) un-completes the match.
  fields = ledgerLib.resolveFields({
    solvedTargets: { A: solved('p1', 2050), C: solved('p2', 2060) }, failedColumns: { B: true }, ledger: l
  });
  assert.equal(fields.D.status, 'open');
  assert.equal(ledgerLib.refreshCompletion(l, fields, 2600), 'reopened');
  assert.equal(l.completedAt, null);
  console.log('PASS match ledger: five-field completion rules');
}

function testPointsAndStandings() {
  const events = [
    { boardId: 'b1', playerId: 'p1', playerName: 'Nina', points: 400 },
    { boardId: 'b1', playerId: 'p1', playerName: 'Nina', points: 50 },
    { boardId: 'b1', playerId: 'p2', playerName: 'Marko', points: -200 },
    { boardId: 'OTHER', playerId: 'p1', playerName: 'Nina', points: 9999 }
  ];
  const points = ledgerLib.matchPointsByPlayer(events, 'b1');
  assert.equal(points.p1.points, 450, 'only THIS board counts');
  assert.equal(points.p2.points, -200, 'penalties are match points too');

  // Equal scores share the place; the next place is skipped (1, 2, 2, 4).
  const ranks = ledgerLib.competitionRanks([
    { key: 'a', score: 300 }, { key: 'b', score: 200 }, { key: 'c', score: 200 }, { key: 'd', score: 100 }
  ]);
  assert.deepEqual(ranks, { a: 1, b: 2, c: 2, d: 4 });

  // Before = after - this match's points (profile totals are written per event).
  const profiles = {
    nina: { name: 'Nina', lifetimeScore: 1000 },
    marko: { name: 'Marko', lifetimeScore: 900 },
    ivana: { name: 'Ivana', lifetimeScore: 800 }
  };
  const standings = ledgerLib.computeStandings(profiles, { nina: 100, marko: 300 });
  const nina = standings.find(s => s.key === 'nina');
  const marko = standings.find(s => s.key === 'marko');
  assert.equal(nina.lifetimeBefore, 900);
  assert.equal(marko.lifetimeBefore, 600);
  assert.equal(marko.rankBefore, 3, 'Marko was behind Ivana before this match');
  assert.equal(marko.rankAfter, 2);
  assert.equal(nina.rankBefore, 1);
  assert.equal(nina.rankAfter, 1);
  assert.equal(standings.length, 2, 'only participants are returned');
  console.log('PASS match ledger: match points and shared-place standings');
}

function testArchiveRecordShape() {
  const l = ledgerLib.createLedger('b1', 1000, [{ playerId: 'p1', playerName: 'Nina' }]);
  ledgerLib.recordActivity(l, 'p1', 'Nina', 1100);
  ledgerLib.recordActivity(l, 'p2', 'Marko', 1200);
  ledgerLib.recordAttempt(l, { messageId: 'm1', playerId: 'p1', playerName: 'Nina', verdict: 'correct', target: 'A', text: 'a', now: 1300 });
  ledgerLib.recordAttempt(l, { messageId: 'm2', playerId: 'p1', playerName: 'Nina', verdict: 'wrong', text: 'b', now: 1400 });
  ledgerLib.presenceClose(l, 'p1', 1900);
  l.completedAt = 2000;

  const record = ledgerLib.buildArchiveRecord({
    matchId: 'b1', roomCode: 'ABCD', gameId: 'g', title: 'T', difficulty: 'RED',
    ledger: l, fields: { A: { status: 'solved' } },
    events: [{ boardId: 'b1', playerId: 'p1', playerName: 'Nina', points: 400 }],
    gameWon: true, standings: [], keyFn, now: 2100
  });
  const nina = record.players.find(p => p.playerId === 'p1');
  const marko = record.players.find(p => p.playerId === 'p2');
  assert.equal(nina.matchPoints, 400);
  assert.deepEqual(nina.judged, { total: 2, correct: 1, wrong: 1 });
  assert.equal(nina.messages, 1);
  assert.equal(nina.presentMs, 900);
  assert.equal(nina.nameKey, 'nina');
  assert.equal(marko.matchPoints, 0, 'a participant with no events still took part');
  assert.equal(marko.judged.total, 0, 'unjudged chatter is not an attempt');
  assert.equal(record.completedAt, 2000);
  assert.equal(record.gameWon, true);
  assert.ok(!('awards' in record), 'awards are derived later, never baked into the archive');
  console.log('PASS match ledger: archive record shape');
}

function testStoreDurability() {
  cleanup();
  const rec = id => ({ matchId: id, completedAt: Number(id.slice(1)), players: [] });

  assert.equal(store.upsertMatch(rec('m1')), true);
  assert.equal(store.upsertMatch(rec('m2')), true);
  assert.equal(store.getMatch('m1').matchId, 'm1');
  assert.deepEqual(store.listMatches().map(m => m.matchId), ['m1', 'm2']);
  assert.equal(store.removeMatch('m2'), true);
  assert.equal(store.getMatch('m2'), null);
  assert.equal(store.removeMatch('nope'), false);
  assert.equal(store.upsertMatch(rec('m2')), true);

  // Corrupt main file -> quarantined and restored from the one-write-behind backup.
  fs.writeFileSync(MATCHES, '{ not json');
  const recovered = store.getMatch('m1');
  assert.ok(recovered, 'restored from backup after corruption');
  assert.ok(
    fs.readdirSync(os.tmpdir()).some(f => f.startsWith(path.basename(MATCHES) + '.corrupt-')),
    'the corrupt file is preserved as evidence'
  );

  // Both copies unusable -> refuse to write (never overwrite the evidence).
  fs.writeFileSync(MATCHES, '{ garbage 1');
  fs.writeFileSync(MATCHES + '.bak', '{ garbage 2');
  assert.equal(store.upsertMatch(rec('m9')), false);
  assert.equal(fs.readFileSync(MATCHES, 'utf8'), '{ garbage 1', 'the unusable file is left untouched');
  console.log('PASS match store: atomic archive, backup recovery, fail-safe');
}

try {
  testAttemptsAreJudgedOnly();
  testPresence();
  testFieldResolutionAndCompletion();
  testPointsAndStandings();
  testArchiveRecordShape();
  testStoreDurability();
  console.log('ALL MATCH LEDGER TESTS PASSED');
} finally {
  cleanup();
}
