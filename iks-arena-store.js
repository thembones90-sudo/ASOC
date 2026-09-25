// IKS OKS HEALTH + GAUNTLET -- persistent health for Little Heroes.
//
// HEALTH IS ALWAYS LIVE. Every Little Hero has up to 10 health (default 10).
// Every decided IKS OKS game moves it: beating a hero lifesteals one bar
// (winner +1, capped at 10; loser -1); losing to the Shadow Broker costs one
// bar and beating it gains one (the Broker has no health). Draws move nothing.
// A hero at 0 is ELIMINATED: no IKS OKS at all until the Broker resets.
//
// THE GAUNTLET is an event on top, driven by the Shadow Broker:
//   idle    -- no event.
//   open    -- START GAUNTLET pressed. Every online hero is prompted and has
//              JOIN_MS to JOIN (restores them to full) or DECLINE. Heroes who
//              decline or let the offer lapse sit this round out, so idle
//              players can never stall it. No game counts while it is open.
//   running -- the join window closed with >= 2 fighters (otherwise the
//              gauntlet is called off). Games whose heroes all joined count
//              toward GAUNTLET_GAMES.
//   ended   -- after GAUNTLET_GAMES games, or as soon as one fighter stands.
//              The last one standing -- or at the limit the highest health
//              (ties share the crown) -- is the VICTOR, and burns.
// RESET restores every hero to 10 and clears any gauntlet.
//
// State survives restarts (durable-io atomic write).
const path = require('path');
const crypto = require('crypto');
const durable = require('./durable-io');

const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const FILE = path.join(DATA_DIR, 'iks-arena.json');
const FORMAT = 'asoc-iks-health';
const VERSION = 1;
const MAX_HEALTH = 10;   // ceiling for the Broker's HEALTH BARS setting
const MIN_HEALTH = 1;
const GAUNTLET_GAMES = Math.max(1, Number(process.env.ASOC_IKS_GAUNTLET_GAMES) || 50);
const STATUSES = new Set(['idle', 'open', 'running', 'ended']);
const JOIN_MS = Number(process.env.ASOC_IKS_JOIN_MS) || 60000;

let state = null;

function idleGauntlet() {
  return { status: 'idle', id: null, startedAt: null, joinDeadline: 0, gamesPlayed: 0, fighters: [], declined: [], victors: [], endedReason: null };
}

function freshState(maxHealth = MAX_HEALTH) {
  return { format: FORMAT, version: VERSION, maxHealth, health: {}, names: {}, gauntlet: idleGauntlet() };
}

function validMax(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= MIN_HEALTH && n <= MAX_HEALTH ? n : null;
}

// The Broker's chosen number of health bars (1..10).
function maxHealth() {
  return validMax(load().maxHealth) || MAX_HEALTH;
}

function clamp(hp) {
  return Math.max(0, Math.min(maxHealth(), Math.round(Number(hp) || 0)));
}

function load() {
  if (state) return state;
  try {
    if (durable.fs.existsSync(FILE)) {
      const parsed = JSON.parse(durable.fs.readFileSync(FILE, 'utf8'));
      if (parsed && parsed.format === FORMAT && parsed.version === VERSION) {
        const g = parsed.gauntlet && STATUSES.has(parsed.gauntlet.status) ? parsed.gauntlet : idleGauntlet();
        // Clamp against the file's own maximum: clamp() would re-enter load().
        const fileMax = validMax(parsed.maxHealth) || MAX_HEALTH;
        state = {
          ...freshState(fileMax),
          health: Object.fromEntries(Object.entries(parsed.health || {}).filter(([, hp]) => Number.isFinite(hp)).map(([id, hp]) => [id, Math.max(0, Math.min(fileMax, Math.round(hp)))])),
          names: parsed.names && typeof parsed.names === 'object' ? parsed.names : {},
          gauntlet: {
            ...idleGauntlet(),
            ...g,
            gamesPlayed: Math.max(0, Number(g.gamesPlayed) || 0),
            fighters: Array.isArray(g.fighters) ? g.fighters.map(String) : [],
            declined: Array.isArray(g.declined) ? g.declined.map(String) : [],
            joinDeadline: Number(g.joinDeadline) || 0,
            victors: Array.isArray(g.victors) ? g.victors.filter(v => v && v.id) : []
          }
        };
        return state;
      }
      // Older gauntlet-only files carry no always-live health; start clean.
    }
  } catch (error) {
    console.error('[iks-health] Could not read health file; starting at full health:', error.message);
  }
  state = freshState();
  return state;
}

function save() {
  durable.writeJson(FILE, state);
}

function healthOf(playerId) {
  const hp = load().health[String(playerId)];
  return hp === undefined ? maxHealth() : Math.min(hp, maxHealth());
}

function isFighter(playerId) {
  const g = load().gauntlet;
  return g.status !== 'idle' && g.fighters.includes(String(playerId));
}

function isEliminated(playerId) {
  return healthOf(playerId) <= 0;
}

function standingOf(playerId) {
  const id = String(playerId);
  const hp = healthOf(id);
  return {
    health: hp,
    maxHealth: maxHealth(),
    eliminated: hp <= 0,
    fighter: isFighter(id),
    victor: load().gauntlet.victors.some(v => v.id === id)
  };
}

function start(now = Date.now()) {
  const s = load();
  if (s.gauntlet.status === 'open' || s.gauntlet.status === 'running') return { ok: false, error: 'A GAUNTLET IS ALREADY UNDERWAY // RESET IT FIRST' };
  s.gauntlet = { ...idleGauntlet(), status: 'open', id: 'gauntlet-' + crypto.randomBytes(6).toString('hex'), startedAt: new Date(now).toISOString(), joinDeadline: now + JOIN_MS };
  save();
  return { ok: true, joinDeadline: s.gauntlet.joinDeadline };
}

function joinClosedError(g) {
  return g.status === 'running' || g.status === 'ended' ? 'THE GAUNTLET HAS BEGUN // JOINING IS CLOSED' : 'NO GAUNTLET IS OPEN';
}

function join(player, now = Date.now()) {
  const s = load();
  const g = s.gauntlet;
  if (g.status !== 'open') return { ok: false, error: joinClosedError(g) };
  if (now > g.joinDeadline) return { ok: false, error: 'THE JOIN WINDOW HAS CLOSED' };
  const id = String(player.id);
  if (g.fighters.includes(id)) return { ok: true, already: true };
  g.declined = g.declined.filter(d => d !== id);
  g.fighters.push(id);
  s.names[id] = String(player.name || s.names[id] || 'LITTLE HERO');
  s.health[id] = maxHealth(); // everyone enters the gauntlet whole
  save();
  return { ok: true };
}

// A hero turns the offer down: they sit this round out.
function decline(player, now = Date.now()) {
  const g = load().gauntlet;
  if (g.status !== 'open' || now > g.joinDeadline) return { ok: false, error: joinClosedError(g) };
  const id = String(player.id);
  if (g.fighters.includes(id)) return { ok: false, error: 'YOU ALREADY JOINED THE GAUNTLET' };
  if (!g.declined.includes(id)) g.declined.push(id);
  save();
  return { ok: true };
}

// Closes the join window. Returns { changed, begun, cancelled, fighters }.
function tick(now = Date.now()) {
  const s = load();
  const g = s.gauntlet;
  if (g.status !== 'open' || now <= g.joinDeadline) return { changed: false };
  if (g.fighters.length >= 2) {
    g.status = 'running';
    save();
    return { changed: true, begun: true, fighters: g.fighters.map(id => s.names[id] || 'LITTLE HERO') };
  }
  const fighters = g.fighters.map(id => s.names[id] || 'LITTLE HERO');
  s.gauntlet = idleGauntlet();
  save();
  return { changed: true, cancelled: true, fighters };
}

// Restores everyone to full; the HEALTH BARS setting survives.
function reset() {
  state = freshState(maxHealth());
  save();
}

// Broker's HEALTH BARS: 1..10. Everyone is restored to full at the new
// maximum. Refused while a gauntlet is open or running.
function setMaxHealth(value) {
  const n = validMax(value);
  if (!n) return { ok: false, error: `HEALTH BARS MUST BE ${MIN_HEALTH}-${MAX_HEALTH}` };
  const status = load().gauntlet.status;
  if (status === 'open' || status === 'running') return { ok: false, error: 'FINISH OR RESET THE GAUNTLET BEFORE CHANGING HEALTH BARS' };
  state = freshState(n);
  save();
  return { ok: true, maxHealth: n };
}

// A finished IKS OKS game. x / o: { id, name, isBroker }. winnerId null = draw.
// Always returns what changed (health moves on every decided game).
function recordGame({ x, o, winnerId }) {
  const s = load();
  const sides = [x, o].filter(Boolean);
  sides.forEach(side => { if (!side.isBroker) s.names[String(side.id)] = String(side.name || s.names[String(side.id)] || 'LITTLE HERO'); });

  const eliminated = [];
  if (winnerId) {
    const winner = sides.find(side => String(side.id) === String(winnerId));
    const loser = sides.find(side => side !== winner);
    if (winner && !winner.isBroker) s.health[String(winner.id)] = clamp(healthOf(winner.id) + 1);
    if (loser && !loser.isBroker) {
      const id = String(loser.id);
      const before = healthOf(id);
      s.health[id] = clamp(before - 1);
      if (before > 0 && s.health[id] === 0) eliminated.push({ id, name: s.names[id] || 'LITTLE HERO' });
    }
  }

  // Gauntlet bookkeeping: only games whose heroes all joined count.
  const g = s.gauntlet;
  let gauntlet = null;
  const heroes = sides.filter(side => !side.isBroker);
  if (g.status === 'running' && heroes.length && heroes.every(side => g.fighters.includes(String(side.id)))) {
    g.gamesPlayed += 1;
    let victors = null;
    const standing = g.fighters.filter(id => healthOf(id) > 0);
    if (g.fighters.length >= 2 && standing.length === 1) {
      victors = [{ id: standing[0], name: s.names[standing[0]] || 'LITTLE HERO' }];
      g.endedReason = 'last-standing';
    } else if (g.gamesPlayed >= GAUNTLET_GAMES) {
      const top = Math.max(...g.fighters.map(healthOf));
      victors = g.fighters.filter(id => top > 0 && healthOf(id) === top).map(id => ({ id, name: s.names[id] || 'LITTLE HERO' }));
      g.endedReason = 'game-limit';
    }
    if (victors) {
      g.status = 'ended';
      g.victors = victors;
    }
    gauntlet = { gamesPlayed: g.gamesPlayed, victors, endedReason: victors ? g.endedReason : null };
  }
  save();
  return { eliminated, gauntlet, victors: gauntlet?.victors || null, gamesPlayed: gauntlet?.gamesPlayed ?? null, endedReason: gauntlet?.endedReason || null };
}

function publicState() {
  const s = load();
  const g = s.gauntlet;
  return {
    status: g.status,
    gauntletId: g.id,
    gamesPlayed: g.gamesPlayed,
    gamesTotal: GAUNTLET_GAMES,
    maxHealth: maxHealth(),
    fighters: g.fighters.length,
    standing: g.fighters.filter(id => healthOf(id) > 0).length,
    victors: g.victors.map(v => ({ id: v.id, name: v.name })),
    endedReason: g.endedReason,
    joinDeadline: g.joinDeadline,
    joinMs: JOIN_MS,
    serverNow: Date.now(),
    fighterIds: g.fighters.slice(),
    declinedIds: g.declined.slice(),
    eliminated: Object.values(s.health).filter(hp => hp <= 0).length
  };
}

// Tests only.
function _forget() { state = null; }

module.exports = { MAX_HEALTH, MIN_HEALTH, GAUNTLET_GAMES, maxHealth, setMaxHealth, healthOf, isFighter, isEliminated, standingOf, start, join, decline, tick, reset, recordGame, publicState, _forget, JOIN_MS };
