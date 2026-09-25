// IKS OKS GAUNTLET -- persistent health for Little Heroes.
//
// Lifecycle (driven by the Shadow Broker):
//   idle  -- no gauntlet. IKS OKS is casual; nobody has a health bar.
//   open  -- START GAUNTLET pressed. Little Heroes JOIN; every joiner has 10
//            health. Joining closes when the first gauntlet game is played.
//   running -- games between joined heroes (or a joined hero and the Broker)
//            count. Beating a hero lifesteals one bar (winner +1, capped at
//            10; loser -1). Losing to the Broker costs one bar, beating it
//            gains one. Draws move no health but still count as a game.
//            A hero at 0 is ELIMINATED: no IKS OKS at all until reset.
//   ended  -- after GAUNTLET_GAMES games, or as soon as only one fighter still
//            stands. The last one standing -- or, at the game limit, the
//            highest health (ties share the crown) -- is the VICTOR.
// RESET GAUNTLET returns to idle and clears everything.
//
// State survives restarts (durable-io atomic write).
const path = require('path');
const crypto = require('crypto');
const durable = require('./durable-io');

const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const FILE = path.join(DATA_DIR, 'iks-arena.json');
const FORMAT = 'asoc-iks-gauntlet';
const VERSION = 1;
const MAX_HEALTH = 10;
const GAUNTLET_GAMES = Math.max(1, Number(process.env.ASOC_IKS_GAUNTLET_GAMES) || 50);
const STATUSES = new Set(['idle', 'open', 'running', 'ended']);

let state = null;

function idleState() {
  return { format: FORMAT, version: VERSION, status: 'idle', gauntletId: null, startedAt: null, gamesPlayed: 0, health: {}, names: {}, victors: [], endedReason: null };
}

function clamp(hp) {
  return Math.max(0, Math.min(MAX_HEALTH, Math.round(Number(hp) || 0)));
}

function load() {
  if (state) return state;
  try {
    if (durable.fs.existsSync(FILE)) {
      const parsed = JSON.parse(durable.fs.readFileSync(FILE, 'utf8'));
      if (parsed && parsed.format === FORMAT && parsed.version === VERSION && STATUSES.has(parsed.status)) {
        state = {
          ...idleState(),
          ...parsed,
          gamesPlayed: Math.max(0, Number(parsed.gamesPlayed) || 0),
          health: Object.fromEntries(Object.entries(parsed.health || {}).filter(([, hp]) => Number.isFinite(hp)).map(([id, hp]) => [id, clamp(hp)])),
          names: parsed.names && typeof parsed.names === 'object' ? parsed.names : {},
          victors: Array.isArray(parsed.victors) ? parsed.victors.filter(v => v && v.id) : []
        };
        return state;
      }
      console.error('[iks-gauntlet] Unrecognized gauntlet file; starting idle');
    }
  } catch (error) {
    console.error('[iks-gauntlet] Could not read gauntlet file; starting idle:', error.message);
  }
  state = idleState();
  return state;
}

function save() {
  durable.writeJson(FILE, state);
}

function isParticipant(playerId) {
  const s = load();
  return s.status !== 'idle' && Object.prototype.hasOwnProperty.call(s.health, String(playerId));
}

function isEliminated(playerId) {
  return isParticipant(playerId) && load().health[String(playerId)] <= 0;
}

// null for a Little Hero outside the gauntlet (no health ring).
function standingOf(playerId) {
  if (!isParticipant(playerId)) return null;
  const s = load();
  const id = String(playerId);
  return {
    health: s.health[id],
    maxHealth: MAX_HEALTH,
    eliminated: s.health[id] <= 0,
    victor: s.victors.some(v => v.id === id)
  };
}

function start() {
  const s = load();
  if (s.status === 'open' || s.status === 'running') return { ok: false, error: 'A GAUNTLET IS ALREADY UNDERWAY // RESET IT FIRST' };
  state = { ...idleState(), status: 'open', gauntletId: 'gauntlet-' + crypto.randomBytes(6).toString('hex'), startedAt: new Date().toISOString() };
  save();
  return { ok: true };
}

function join(player) {
  const s = load();
  if (s.status !== 'open') return { ok: false, error: s.status === 'running' ? 'THE GAUNTLET HAS BEGUN // JOINING IS CLOSED' : 'NO GAUNTLET IS OPEN' };
  const id = String(player.id);
  if (isParticipant(id)) return { ok: true, already: true };
  s.health[id] = MAX_HEALTH;
  s.names[id] = String(player.name || 'LITTLE HERO');
  save();
  return { ok: true };
}

function reset() {
  state = idleState();
  save();
}

function crownHighest(s) {
  const top = Math.max(...Object.values(s.health));
  return Object.keys(s.health).filter(id => s.health[id] === top && top > 0).map(id => ({ id, name: s.names[id] || 'LITTLE HERO' }));
}

// A finished IKS OKS game. x / o: { id, name, isBroker }. winnerId null = draw.
// Returns null when the game is outside the gauntlet; otherwise what changed.
function recordGame({ x, o, winnerId }) {
  const s = load();
  if (s.status !== 'open' && s.status !== 'running') return null;
  const sides = [x, o];
  const heroes = sides.filter(side => side && !side.isBroker);
  // Counts only when every Little Hero in the game joined the gauntlet.
  if (!heroes.length || heroes.some(side => !isParticipant(side.id))) return null;
  if (s.status === 'open') s.status = 'running';

  const eliminated = [];
  if (winnerId) {
    const winner = sides.find(side => String(side.id) === String(winnerId));
    const loser = sides.find(side => side !== winner);
    if (winner && !winner.isBroker) s.health[String(winner.id)] = clamp(s.health[String(winner.id)] + 1);
    if (loser && !loser.isBroker) {
      const id = String(loser.id);
      const before = s.health[id];
      s.health[id] = clamp(before - 1);
      if (before > 0 && s.health[id] === 0) eliminated.push({ id, name: s.names[id] || 'LITTLE HERO' });
    }
  }
  s.gamesPlayed += 1;

  let victors = null;
  const fighters = Object.keys(s.health);
  const standing = fighters.filter(id => s.health[id] > 0);
  if (fighters.length >= 2 && standing.length === 1) {
    victors = [{ id: standing[0], name: s.names[standing[0]] || 'LITTLE HERO' }];
    s.endedReason = 'last-standing';
  } else if (s.gamesPlayed >= GAUNTLET_GAMES) {
    victors = crownHighest(s);
    s.endedReason = 'game-limit';
  }
  if (victors) {
    s.status = 'ended';
    s.victors = victors;
  }
  save();
  return { eliminated, victors, gamesPlayed: s.gamesPlayed, endedReason: victors ? s.endedReason : null };
}

function publicState() {
  const s = load();
  return {
    status: s.status,
    gauntletId: s.gauntletId,
    gamesPlayed: s.gamesPlayed,
    gamesTotal: GAUNTLET_GAMES,
    maxHealth: MAX_HEALTH,
    fighters: Object.keys(s.health).length,
    standing: Object.values(s.health).filter(hp => hp > 0).length,
    victors: s.victors.map(v => ({ id: v.id, name: v.name })),
    endedReason: s.endedReason
  };
}

// Tests only.
function _forget() { state = null; }

module.exports = { MAX_HEALTH, GAUNTLET_GAMES, isParticipant, isEliminated, standingOf, start, join, reset, recordGame, publicState, _forget };
