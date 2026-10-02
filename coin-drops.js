'use strict';
// COIN DROPS -- a Shadow Coin flashes onto every Little Hero's screen for a
// few seconds; the first click wins it. Warcraft-style tiers decide the
// value. Pure scheduling + rolling; server.js owns sockets, awards, storage.
//
//   12 normal drops a day, 08:00-16:00 Europe/Belgrade, >= 20 min apart.
//   LEGENDARY (25 SC) on 3 random days per week, once on each of those days.
//   Expected value of a normal drop ~1.86 SC -> ~22 SC/day + ~11 SC/day of
//   legendaries averaged over the week.

const TIME_ZONE = 'Europe/Belgrade';
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 16;
const DROPS_PER_DAY = 12;
const MIN_GAP_MS = 20 * 60 * 1000;
const LEGENDARY_DAYS_PER_WEEK = 3;
const VISIBLE_MS = 5000;
const CLAIM_GRACE_MS = 700;      // network slack after the coin vanishes
const MIN_REACTION_MS = 150;     // faster than a human: ignored
const STALE_MS = 2 * 60 * 1000;  // a drop missed by more (server was down) is skipped
const HISTORY_LIMIT = 200;

const TIERS = Object.freeze([
  { id: 'poor', label: 'POOR', min: 0.1, max: 0.5, weight: 40 },
  { id: 'common', label: 'COMMON', min: 0.5, max: 1.5, weight: 28 },
  { id: 'uncommon', label: 'UNCOMMON', min: 1.5, max: 3, weight: 18 },
  { id: 'rare', label: 'RARE', min: 3, max: 6, weight: 10 },
  { id: 'epic', label: 'EPIC', min: 10, max: 20, weight: 4 }
]);
const LEGENDARY = Object.freeze({ id: 'legendary', label: 'LEGENDARY', amount: 25 });

function localParts(ms) {
  const f = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return { y: +f.year, m: +f.month, d: +f.day, h: +f.hour, min: +f.minute, s: +f.second, weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(f.weekday) };
}
const dayKey = ms => { const p = localParts(ms); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
// Epoch ms of a wall-clock time in TIME_ZONE (DST-safe: refine the offset twice).
function zonedEpoch(y, m, d, h) {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess += Date.UTC(y, m - 1, d, h) - asUtc;
  }
  return guess;
}
function windowOf(ms) {
  const p = localParts(ms);
  return { start: zonedEpoch(p.y, p.m, p.d, WINDOW_START_HOUR), end: zonedEpoch(p.y, p.m, p.d, WINDOW_END_HOUR) };
}
// Monday's day key identifies the week; days of the week as day keys.
function weekDays(ms) {
  const p = localParts(ms);
  const noon = zonedEpoch(p.y, p.m, p.d, 12);
  return Array.from({ length: 7 }, (_, i) => dayKey(noon + (i - p.weekday) * 86400000));
}

function spreadTimes(start, end, count, gap, rng) {
  const span = end - start - VISIBLE_MS;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const times = Array.from({ length: count }, () => start + Math.floor(rng() * span)).sort((a, b) => a - b);
    if (times.every((t, i) => i === 0 || t - times[i - 1] >= gap)) return times;
  }
  // Fallback: even slots with jitter inside each slot.
  const slot = span / count;
  return Array.from({ length: count }, (_, i) => Math.floor(start + i * slot + rng() * Math.max(0, slot - gap)));
}

function blankState() { return { dayKey: null, drops: [], week: { key: null, days: [] }, history: [] }; }
function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    dayKey: typeof s.dayKey === 'string' ? s.dayKey : null,
    drops: Array.isArray(s.drops) ? s.drops.filter(d => d && Number.isFinite(d.at)) : [],
    week: s.week && typeof s.week === 'object' ? { key: s.week.key || null, days: Array.isArray(s.week.days) ? s.week.days : [] } : { key: null, days: [] },
    history: Array.isArray(s.history) ? s.history.slice(-HISTORY_LIMIT) : []
  };
}

// Make sure today's schedule exists. Returns true when the state changed.
function plan(state, now = Date.now(), rng = Math.random) {
  let changed = false;
  const days = weekDays(now);
  if (state.week.key !== days[0]) {
    // Legendary days are picked among the days still ahead this week.
    const today = dayKey(now);
    const ahead = days.filter(d => d >= today);
    const pool = ahead.slice();
    const picked = [];
    const want = Math.max(0, Math.round(LEGENDARY_DAYS_PER_WEEK * ahead.length / 7));
    while (picked.length < want && pool.length) picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    state.week = { key: days[0], days: picked.sort() };
    changed = true;
  }
  const today = dayKey(now);
  if (state.dayKey !== today) {
    const { start, end } = windowOf(now);
    const drops = spreadTimes(start, end, DROPS_PER_DAY, MIN_GAP_MS, rng).map(at => ({ at, kind: 'normal', done: false }));
    if (state.week.days.includes(today)) drops.push({ at: start + Math.floor(rng() * (end - start - VISIBLE_MS)), kind: 'legendary', done: false });
    state.dayKey = today;
    state.drops = drops.sort((a, b) => a.at - b.at);
    changed = true;
  }
  return changed;
}

// The next drop that should fire now, or null. Drops missed by more than
// STALE_MS (server down) are marked done without firing.
function due(state, now = Date.now()) {
  for (const drop of state.drops) {
    if (drop.done || drop.at > now) continue;
    if (now - drop.at > STALE_MS) { drop.done = true; drop.skipped = true; continue; }
    return drop;
  }
  return null;
}

function roll(kind = 'normal', rng = Math.random) {
  if (kind === 'legendary') return { tier: LEGENDARY.id, label: LEGENDARY.label, amount: LEGENDARY.amount };
  const forced = TIERS.find(t => t.id === kind);
  let tier = forced;
  if (!tier) {
    let pick = rng() * TIERS.reduce((sum, t) => sum + t.weight, 0);
    tier = TIERS.find(t => (pick -= t.weight) < 0) || TIERS[0];
  }
  const amount = Math.max(0.1, Math.round((tier.min + rng() * (tier.max - tier.min)) * 10) / 10);
  return { tier: tier.id, label: tier.label, amount };
}

module.exports = {
  TIME_ZONE, WINDOW_START_HOUR, WINDOW_END_HOUR, DROPS_PER_DAY, MIN_GAP_MS, LEGENDARY_DAYS_PER_WEEK,
  VISIBLE_MS, CLAIM_GRACE_MS, MIN_REACTION_MS, HISTORY_LIMIT, TIERS, LEGENDARY,
  dayKey, windowOf, weekDays, blankState, normalize, plan, due, roll
};
