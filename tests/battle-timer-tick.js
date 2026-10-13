'use strict';

const assert = require('assert');
const { advanceBattleTimer } = require('../battle-timer-tick');

let timer = { phase: 'running', remaining: 10000, borrowedDuration: 120000, borrowedRemaining: 120000 };
let result = advanceBattleTimer(timer, 1250, 50000);
assert.deepEqual(result, { changed: true, transitioned: false });
assert.equal(timer.remaining, 8750, 'ordinary ticks use measured elapsed time');

timer = { phase: 'running', remaining: 5000, borrowedDuration: 120000, borrowedRemaining: 120000 };
result = advanceBattleTimer(timer, 40000, 100000);
assert.equal(timer.phase, 'borrowed', 'a delayed tick crosses into Borrowed Time');
assert.equal(timer.borrowedRemaining, 85000, 'normal-time overrun is charged to Borrowed Time');
assert.equal(timer.borrowedStartedAt, 65000, 'Borrowed Time records its actual wall-clock boundary');
assert.equal(result.transitioned, true);

timer = { phase: 'running', remaining: 0, borrowedDuration: 120000, borrowedRemaining: 120000 };
result = advanceBattleTimer(timer, 1000, 110000);
assert.equal(timer.phase, 'borrowed');
assert.equal(timer.borrowedRemaining, 120000, 'a GM adjustment to zero starts a fresh reserve on the next tick');

timer = { phase: 'running', remaining: 5000, borrowedDuration: 120000, borrowedRemaining: 120000 };
result = advanceBattleTimer(timer, 130000, 200000);
assert.equal(timer.phase, 'expired', 'one long stall may cross both clock boundaries');
assert.equal(timer.borrowedRemaining, 0);
assert.equal(result.expired, true);

timer = { phase: 'borrowed', remaining: 0, borrowedDuration: 120000, borrowedRemaining: 3000 };
result = advanceBattleTimer(timer, 3500, 250000);
assert.equal(timer.phase, 'expired', 'Borrowed Time expiry uses measured elapsed time');
assert.equal(result.expired, true);

timer = { phase: 'paused', remaining: 9000, borrowedDuration: 120000, borrowedRemaining: 120000 };
result = advanceBattleTimer(timer, 40000, 300000);
assert.equal(timer.remaining, 9000, 'paused timers never advance');
assert.equal(result.changed, false);

console.log('PASS battle timer tick: elapsed-time accounting, boundary carry, expiry, paused safety');
