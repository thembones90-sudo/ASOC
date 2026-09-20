/*
 * ASOC ENGINE - Scoring Constants
 *
 * Centralized, tunable point values for the competitive/scoring layer.
 * Nothing in this file has logic -- it exists purely so values can be
 * rebalanced later without touching gameplay code (server.js).
 */

// Column solved after N revealed clues (1-4). Solving from the hardest
// clue (fewest reveals) carries the greatest reward. There is no 0 entry:
// a column cannot be scored with zero clues revealed (see COLUMN SCORING
// in server.js -- that state is rejected, never silently scored).
const COLUMN_SCORE_BY_CLUES = {
  1: 400,
  2: 300,
  3: 200,
  4: 100
};

// FINAL solved after N column solutions are already known (1-4). There is
// deliberately no 0 entry -- the Final cannot score before at least one
// column solution exists (see server.js's FINAL scoring guard).
const FINAL_SCORE_BY_COLUMNS = {
  1: 1200,
  2: 800,
  3: 500,
  4: 300
};

// Once the FINAL has been solved, any column solved AFTER it scores this
// fraction of its normal COLUMN_SCORE_BY_CLUES value -- with the meta answer
// known, a remaining column is easier to hit. Applies only to columns solved
// after a real Final solve (a failed Final does not make columns easier), and
// never to streak bonuses. Every base value is a multiple of 100, so 0.5
// always yields whole points (400/300/200/100 -> 200/150/100/50).
const COLUMN_SCORE_MULTIPLIER_AFTER_FINAL = 0.5;

// Column streak MILESTONE bonuses (not cumulative totals). Each milestone
// is awarded once, the moment it is reached, in addition to any bonus(es)
// already awarded earlier in the same streak. A full 4-column sweep by one
// player earns 50 + 125 + 250 = 425 in streak bonuses on top of the four
// individual column awards.
const STREAK_MILESTONE_BONUS = {
  2: 50,
  3: 125,
  4: 250
};

// Flat penalty applied to every active participant's session AND lifetime
// score when the GM explicitly declares the Final failed. Negative scores
// are allowed -- this value is never floored at zero.
const FAILED_FINAL_PENALTY = 200;

module.exports = {
  COLUMN_SCORE_BY_CLUES,
  COLUMN_SCORE_MULTIPLIER_AFTER_FINAL,
  FINAL_SCORE_BY_COLUMNS,
  STREAK_MILESTONE_BONUS,
  FAILED_FINAL_PENALTY
};
