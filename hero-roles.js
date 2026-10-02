'use strict';
// HERO ROLES -- DPS / TANK / HEAL for Battle. Pure rules (no sockets, no
// clock); server.js owns identity, the board, WOMF and broadcasting.
//
// Roles influence the battlefield, never the answer:
//   DPS  BURST         the whole room sees the NEXT clue of one column for
//                      BURST_MS, then it closes. Never a 5 or the FINAL.
//   TANK LAST STAND    mark an open column; if the Shadow Broker FAILS it, the
//                      +1 WOMF is absorbed once. Spent when placed.
//   HEAL RESURRECTION  restore one teammate's used ability. Never your own,
//                      never another RESURRECTION.
//
// Each player has one ability use per game (board). Stacking is capped on
// CHARGES, not picks: the team gets at most CHARGES_PER_ROLE uses of each
// ability per game however many players share a role.
// Picks are free before the battle starts and lock once it is live; the
// Shadow Broker can switch the whole system off for a session.

const ROLES = Object.freeze({
  dps: Object.freeze({ id: 'dps', name: 'DPS', ability: 'burst', abilityName: 'BURST', blurb: 'Create opportunity: show the room the next clue of a column.' }),
  tank: Object.freeze({ id: 'tank', name: 'TANK', ability: 'lastStand', abilityName: 'LAST STAND', blurb: 'Absorb punishment: a marked column fails without WOMF.' }),
  heal: Object.freeze({ id: 'heal', name: 'HEAL', ability: 'resurrect', abilityName: 'RESURRECTION', blurb: "Restore capability: give a teammate's ability back." })
});
const ROLE_IDS = Object.freeze(Object.keys(ROLES));
const COLUMNS = Object.freeze(['A', 'B', 'C', 'D']);
const CHARGES_PER_ROLE = 2;
const BURST_MS = Number(process.env.ASOC_BURST_MS) || 7000;

const zeroUses = () => ({ dps: 0, tank: 0, heal: 0 });

function createState() {
  return { enabled: true, picks: {}, used: {}, roleUses: zeroUses(), marks: {}, log: [] };
}

function normalizeState(raw) {
  const s = createState();
  if (!raw || typeof raw !== 'object') return s;
  s.enabled = raw.enabled !== false;
  Object.entries(raw.picks || {}).forEach(([id, role]) => { if (ROLES[role]) s.picks[String(id)] = role; });
  Object.entries(raw.used || {}).forEach(([id, v]) => { if (v === true) s.used[String(id)] = true; });
  ROLE_IDS.forEach(r => { s.roleUses[r] = Math.max(0, Math.min(CHARGES_PER_ROLE, Number(raw.roleUses?.[r]) || 0)); });
  Object.entries(raw.marks || {}).forEach(([col, by]) => { if (COLUMNS.includes(col)) s.marks[col] = String(by); });
  s.log = Array.isArray(raw.log) ? raw.log.slice(-30) : [];
  return s;
}

// A new board: every ability is ready again, marks are cleared. Picks stay.
function resetGame(s) {
  s.used = {};
  s.roleUses = zeroUses();
  s.marks = {};
  s.log = [];
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

// ctx: { live, blocked } -- live = battle running; blocked = a reason the
// board is not accepting abilities (resolved match, confirmation pending).
function readiness(s, playerId, ctx) {
  const id = String(playerId);
  const role = s.picks[id];
  if (!s.enabled) return { ok: false, error: 'ROLES ARE OFF FOR THIS SESSION' };
  if (!role) return { ok: false, error: 'PICK A ROLE FIRST' };
  if (!ctx.live) return { ok: false, error: 'ABILITIES WAKE WHEN THE BATTLE STARTS' };
  if (ctx.blocked) return { ok: false, error: ctx.blocked };
  if (s.used[id]) return { ok: false, error: 'YOUR ABILITY IS ALREADY USED THIS GAME' };
  if (s.roleUses[role] >= CHARGES_PER_ROLE) return { ok: false, error: `THE TEAM HAS USED ${ROLES[role].abilityName} ${CHARGES_PER_ROLE}/${CHARGES_PER_ROLE} THIS GAME` };
  return { ok: true, role };
}

function spend(s, playerId, role, entry) {
  s.used[String(playerId)] = true;
  s.roleUses[role] += 1;
  s.log.push({ ...entry, role, by: String(playerId), at: entry.at || Date.now() });
  s.log = s.log.slice(-30);
}

// BURST: the caller resolves the column's next clue (ctx.nextClue(col) ->
// string | null). The clue is never a 5 or the FINAL by construction.
function burst(s, playerId, column, ctx) {
  const r = readiness(s, playerId, ctx);
  if (!r.ok) return r;
  if (r.role !== 'dps') return { ok: false, error: 'ONLY A DPS CAN BURST' };
  if (!COLUMNS.includes(column)) return { ok: false, error: 'PICK A COLUMN' };
  const clue = ctx.nextClue(column);
  if (clue == null) return { ok: false, error: `COLUMN ${column} HAS NO CLOSED CLUES LEFT` };
  spend(s, playerId, 'dps', { ability: 'burst', column, at: ctx.now });
  return { ok: true, column, clue, until: (ctx.now || Date.now()) + BURST_MS };
}

// LAST STAND: ctx.columnOpen(col) -> not solved, not already failed.
function lastStand(s, playerId, column, ctx) {
  const r = readiness(s, playerId, ctx);
  if (!r.ok) return r;
  if (r.role !== 'tank') return { ok: false, error: 'ONLY A TANK CAN MAKE A LAST STAND' };
  if (!COLUMNS.includes(column)) return { ok: false, error: 'PICK A COLUMN' };
  if (!ctx.columnOpen(column)) return { ok: false, error: `COLUMN ${column} IS ALREADY DECIDED` };
  if (s.marks[column]) return { ok: false, error: `COLUMN ${column} ALREADY HAS A LAST STAND` };
  s.marks[column] = String(playerId);
  spend(s, playerId, 'tank', { ability: 'lastStand', column, at: ctx.now });
  return { ok: true, column };
}

function resurrect(s, playerId, targetId, ctx) {
  const r = readiness(s, playerId, ctx);
  if (!r.ok) return r;
  if (r.role !== 'heal') return { ok: false, error: 'ONLY A HEAL CAN RESURRECT' };
  const target = String(targetId || '');
  if (target === String(playerId)) return { ok: false, error: 'RESURRECTION CANNOT TARGET YOURSELF' };
  const targetRole = s.picks[target];
  if (!targetRole) return { ok: false, error: 'THAT HERO HAS NO ROLE' };
  if (targetRole === 'heal') return { ok: false, error: 'RESURRECTION CANNOT RESTORE ANOTHER RESURRECTION' };
  if (!s.used[target]) return { ok: false, error: 'THAT ABILITY IS STILL READY' };
  delete s.used[target];
  s.roleUses[targetRole] = Math.max(0, s.roleUses[targetRole] - 1);
  spend(s, playerId, 'heal', { ability: 'resurrect', target, at: ctx.now });
  return { ok: true, target, targetRole };
}

// Called when the Shadow Broker FAILS a column for the first time this board.
// Returns the TANK who absorbed it, or null.
function absorbFail(s, column) {
  const by = s.marks[column];
  if (!by) return null;
  delete s.marks[column];
  return by;
}

function view(s, { locked, live }) {
  return {
    enabled: s.enabled,
    locked: !!locked,
    live: !!live,
    cap: CHARGES_PER_ROLE,
    burstMs: BURST_MS,
    picks: { ...s.picks },
    used: { ...s.used },
    roleUses: { ...s.roleUses },
    marks: Object.fromEntries(Object.keys(s.marks).map(col => [col, true]))
  };
}

module.exports = {
  ROLES, ROLE_IDS, COLUMNS, CHARGES_PER_ROLE, BURST_MS,
  createState, normalizeState, resetGame, setEnabled, pick, readiness, burst, lastStand, resurrect, absorbFail, view
};
