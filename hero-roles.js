'use strict';
// HERO ROLES -- DPS / TANK / HEAL. Decorative for now: a Little Hero picks a
// role and wears its badge (DPS red blade, TANK silver shield, HEAL green
// cross). Roles never touch clues, WOMF or scoring.
// Picks are free before the battle starts and lock once it is live; the
// Shadow Broker can switch the whole system off for a session.

const ROLES = Object.freeze({
  dps: Object.freeze({ id: 'dps', name: 'DPS' }),
  tank: Object.freeze({ id: 'tank', name: 'TANK' }),
  heal: Object.freeze({ id: 'heal', name: 'HEAL' })
});
const ROLE_IDS = Object.freeze(Object.keys(ROLES));

function createState() {
  return { enabled: true, picks: {} };
}

// Older saves carried ability state (used / roleUses / marks / log): dropped.
function normalizeState(raw) {
  const s = createState();
  if (!raw || typeof raw !== 'object') return s;
  s.enabled = raw.enabled !== false;
  Object.entries(raw.picks || {}).forEach(([id, role]) => { if (ROLES[role]) s.picks[String(id)] = role; });
  return s;
}

function setEnabled(s, enabled) { s.enabled = enabled !== false; }

function pick(s, playerId, role, { locked }) {
  if (!s.enabled) return { ok: false, error: 'ROLES ARE OFF FOR THIS SESSION' };
  if (locked) return { ok: false, error: 'ROLES ARE LOCKED WHILE THE BATTLE IS LIVE' };
  if (!ROLES[role]) return { ok: false, error: 'UNKNOWN ROLE' };
  const id = String(playerId);
  if (s.picks[id] === role) return { ok: true, already: true };
  s.picks[id] = role;
  return { ok: true };
}

function view(s, { locked, live }) {
  return { enabled: s.enabled, locked: !!locked, live: !!live, picks: { ...s.picks } };
}

module.exports = { ROLES, ROLE_IDS, createState, normalizeState, setEnabled, pick, view };
