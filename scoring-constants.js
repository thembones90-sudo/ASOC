/*
 * ASOC ENGINE - Scoring Constants
 *
 * Centralized, tunable point AND Shadow Coin values for Battle Mode.
 * Nothing in this file has logic -- it exists purely so values can be
 * rebalanced later without touching gameplay code (server.js).
 *
 * Every lookup is keyed by what was on the board WHEN THE GUESS WAS
 * SUBMITTED (server.js freezes it on the chat message), never by the board
 * at judging time.
 */

// Column solved with N clues revealed at submission (1-4). There is no 0
// entry: a column cannot be scored with zero clues revealed (server.js
// rejects that state rather than silently scoring it).
const COLUMN_SCORE_BY_CLUES = {
  1: 500,
  2: 325,
  3: 200,
  4: 100
};
const COLUMN_COINS_BY_CLUES = {
  1: 1.0,
  2: 0.7,
  3: 0.4,
  4: 0.2
};

// A column solved AFTER a legitimate Final solve (the meta answer is known,
// so the column is easier). Explicit values, not a multiplier. Never applied
// to streak bonuses; a failed Final does not make columns easier.
const COLUMN_SCORE_AFTER_FINAL_BY_CLUES = {
  1: 250,
  2: 160,
  3: 100,
  4: 50
};
const COLUMN_COINS_AFTER_FINAL_BY_CLUES = {
  1: 0.5,
  2: 0.4,
  3: 0.2,
  4: 0.1
};

// FINAL solved with N column solutions VISIBLE (their A5-D5 solution cell
// on the board) at submission. A Final accepted with zero visible solutions
// is still a solve, but earns nothing.
const FINAL_SCORE_BY_COLUMNS = {
  0: 0,
  1: 2200,
  2: 1400,
  3: 850,
  4: 450
};
const FINAL_COINS_BY_COLUMNS = {
  0: 0,
  1: 5.0,
  2: 3.0,
  3: 2.0,
  4: 1.0
};

// Column streak MILESTONE bonuses -- POINTS ONLY, never Shadow Coins. Each
// milestone is awarded once, the moment it is reached, on top of earlier
// milestones in the same streak: a four-column sweep earns 50 + 100 + 150 =
// 300 bonus points.
const STREAK_MILESTONE_BONUS = {
  2: 50,
  3: 100,
  4: 150
};

// Declaring the Final failed costs nobody points or Shadow Coins: players
// simply receive no Final reward. (GAME LOST, WOMF, match result, story and
// RECOUNT consequences are unchanged.)
const FAILED_FINAL_PENALTY = 0;

module.exports = {
  COLUMN_SCORE_BY_CLUES,
  COLUMN_COINS_BY_CLUES,
  COLUMN_SCORE_AFTER_FINAL_BY_CLUES,
  COLUMN_COINS_AFTER_FINAL_BY_CLUES,
  FINAL_SCORE_BY_COLUMNS,
  FINAL_COINS_BY_COLUMNS,
  STREAK_MILESTONE_BONUS,
  FAILED_FINAL_PENALTY
};
