'use strict';

// Pure clock arithmetic for the server's one-second scheduler. `elapsedMs`
// may be greater than one tick when synchronous durable I/O delayed the event
// loop; any overrun at the normal/Borrowed boundary carries across it.
function advanceBattleTimer(timer, elapsedMs, now) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (timer.phase === 'running') {
    const before = Math.max(0, Number(timer.remaining) || 0);
    timer.remaining = Math.max(0, before - elapsed);
    if (timer.remaining > 0) return { changed: true, transitioned: false };

    // A GM adjustment may already have set normal time to exactly zero; the
    // documented next scheduler tick starts a fresh reserve in that case.
    // Only carry overrun when this tick actually crossed a positive boundary.
    const borrowedElapsed = before > 0 ? Math.max(0, elapsed - before) : 0;
    timer.phase = 'borrowed';
    timer.borrowedRemaining = Math.max(0, (Number(timer.borrowedDuration) || 0) - borrowedElapsed);
    timer.borrowedStartedAt = now - borrowedElapsed;
    if (timer.borrowedRemaining <= 0) {
      timer.phase = 'expired';
      return { changed: true, transitioned: true, enteredBorrowed: true, expired: true };
    }
    return { changed: true, transitioned: true, enteredBorrowed: true, expired: false };
  }

  if (timer.phase === 'borrowed') {
    timer.borrowedRemaining = Math.max(0, (Number(timer.borrowedRemaining) || 0) - elapsed);
    if (timer.borrowedRemaining <= 0) {
      timer.phase = 'expired';
      return { changed: true, transitioned: true, enteredBorrowed: false, expired: true };
    }
    return { changed: true, transitioned: false };
  }

  return { changed: false, transitioned: false };
}

module.exports = { advanceBattleTimer };
