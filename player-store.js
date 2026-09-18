/*
 * ASOC ENGINE - Player Store
 *
 * Persistent, all-time player profiles. Mirrors game-store.js's filesystem
 * approach (plain JSON, no dependencies) but keeps every profile in ONE
 * file (players.json) rather than one file per profile, since profiles are
 * small and updated far more often than games are.
 *
 * IDENTITY (v1, approved): a profile is matched by normalized display name
 * -- trimmed, case-insensitive. Two people who both type "Alex" share a
 * profile; that is an accepted, known limitation for a small recurring
 * group, not a bug. Matching never strips or mangles Unicode characters
 * (Serbian/etc. names are preserved exactly as typed) -- only trimming and
 * case-folding are applied to derive the lookup key. The profile's stored
 * display name always reflects the most recently typed capitalization.
 */

const fs = require('fs');
const path = require('path');

const PLAYERS_FILE = process.env.ASOC_PLAYERS_FILE
  ? path.resolve(process.env.ASOC_PLAYERS_FILE)
  : path.join(__dirname, 'players.json');
const PLAYERS_BACKUP_FILE = PLAYERS_FILE + '.bak';
let storageHealthy = true;

function normalizeNameKey(name) {
  return String(name || '').trim().toLocaleLowerCase();
}

function nowISO() {
  return new Date().toISOString();
}

function blankProfile(displayName) {
  return {
    id: normalizeNameKey(displayName),
    name: String(displayName || '').trim(),
    avatarData: '',
    frameColor: '#9B5DE0',
    createdAt: nowISO(),
    lastPlayed: nowISO(),
    lifetimeScore: 0,
    gamesPlayed: 0,
    gamesWon: 0,
    columnSolutions: 0,
    oneClueColumnSolutions: 0,
    finalSolutions: 0,
    earlyFinalSolutions: 0,
    earliestFinalColumnsKnown: null,
    bestColumnStreak: 0,
    purpleSolves: 0,
    blackSolves: 0
  };
}

const NUMERIC_PROFILE_FIELDS = [
  'lifetimeScore',
  'gamesPlayed',
  'gamesWon',
  'columnSolutions',
  'oneClueColumnSolutions',
  'finalSolutions',
  'earlyFinalSolutions',
  'bestColumnStreak',
  'purpleSolves',
  'blackSolves'
];

function validateAndNormalizePlayers(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Player database root must be an object');
  }

  const normalized = {};
  for (const [key, candidate] of Object.entries(raw)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`Invalid player profile at key "${key}"`);
    }

    const fallbackName = String(key || '').trim();
    const displayName = typeof candidate.name === 'string' && candidate.name.trim()
      ? candidate.name.trim()
      : fallbackName;
    if (!displayName) throw new Error(`Player profile "${key}" has no valid name`);

    const base = blankProfile(displayName);
    const profile = { ...base, ...candidate };

    profile.name = displayName;
    if (typeof profile.id !== 'string' || !profile.id.trim()) profile.id = fallbackName || normalizeNameKey(displayName);
    if (typeof profile.avatarData !== 'string') profile.avatarData = '';
    if (typeof profile.frameColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(profile.frameColor)) profile.frameColor = '#9B5DE0';
    if (typeof profile.createdAt !== 'string') profile.createdAt = base.createdAt;
    if (typeof profile.lastPlayed !== 'string') profile.lastPlayed = base.lastPlayed;

    for (const field of NUMERIC_PROFILE_FIELDS) {
      if (candidate[field] === undefined) {
        profile[field] = 0;
      } else if (!Number.isFinite(candidate[field])) {
        throw new Error(`Player profile "${key}" has invalid numeric field "${field}"`);
      }
    }

    if (candidate.earliestFinalColumnsKnown === undefined) {
      profile.earliestFinalColumnsKnown = null;
    } else if (
      candidate.earliestFinalColumnsKnown !== null &&
      !Number.isFinite(candidate.earliestFinalColumnsKnown)
    ) {
      throw new Error(`Player profile "${key}" has invalid earliestFinalColumnsKnown`);
    }

    normalized[key] = profile;
  }

  return normalized;
}

function readPlayersFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return validateAndNormalizePlayers(parsed);
}

function writeJsonAtomic(filePath, value) {
  const tmpFile = filePath + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmpFile, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw error;
  }
}

function loadPlayers() {
  if (!fs.existsSync(PLAYERS_FILE)) {
    if (!fs.existsSync(PLAYERS_BACKUP_FILE)) {
      storageHealthy = true;
      return {};
    }

    try {
      const backup = readPlayersFile(PLAYERS_BACKUP_FILE);
      writeJsonAtomic(PLAYERS_FILE, backup);
      storageHealthy = true;
      console.warn('[player-store] Restored players.json from backup because the main file was missing.');
      return backup;
    } catch (backupError) {
      storageHealthy = false;
      console.error('[player-store] Main player database is missing and backup is unusable:', backupError.message);
      return {};
    }
  }

  try {
    const players = readPlayersFile(PLAYERS_FILE);
    storageHealthy = true;
    return players;
  } catch (mainError) {
    console.error('[player-store] players.json is corrupt or invalid:', mainError.message);

    if (!fs.existsSync(PLAYERS_BACKUP_FILE)) {
      storageHealthy = false;
      console.error('[player-store] No valid backup exists. Refusing future writes until the database is repaired.');
      return {};
    }

    try {
      const backup = readPlayersFile(PLAYERS_BACKUP_FILE);
      const corruptPath = PLAYERS_FILE + '.corrupt-' + Date.now();
      fs.renameSync(PLAYERS_FILE, corruptPath);
      writeJsonAtomic(PLAYERS_FILE, backup);
      storageHealthy = true;
      console.warn(`[player-store] Recovered from backup. Corrupt file preserved as ${path.basename(corruptPath)}`);
      return backup;
    } catch (backupError) {
      storageHealthy = false;
      console.error('[player-store] Backup is also unusable. Refusing future writes:', backupError.message);
      return {};
    }
  }
}

function savePlayersAtomic(players) {
  let normalized;
  try {
    normalized = validateAndNormalizePlayers(players);
  } catch (error) {
    console.error('[player-store] Refusing to save invalid player data:', error.message);
    return false;
  }

  if (!storageHealthy) {
    console.error('[player-store] Refusing to write because storage is in a protected unhealthy state.');
    return false;
  }

  try {
    if (fs.existsSync(PLAYERS_FILE)) {
      const previousGood = readPlayersFile(PLAYERS_FILE);
      writeJsonAtomic(PLAYERS_BACKUP_FILE, previousGood);
    }

    writeJsonAtomic(PLAYERS_FILE, normalized);

    if (!fs.existsSync(PLAYERS_BACKUP_FILE)) {
      writeJsonAtomic(PLAYERS_BACKUP_FILE, normalized);
    }

    storageHealthy = true;
    return true;
  } catch (error) {
    storageHealthy = false;
    console.error('[player-store] Failed to save players.json safely:', error.message);
    return false;
  }
}

// Loads (or creates) a profile for this display name and immediately
// persists if it was newly created. Returns { key, profile }.
function getOrCreateProfile(displayName) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) {
    players[key] = blankProfile(displayName);
    savePlayersAtomic(players);
  }
  return { key, profile: players[key] };
}

// Applies a point delta and/or stat-count deltas to one profile, persisting
// immediately. Pass negative values to reverse a previously-applied event
// (e.g. a GM verdict correction). `statDeltas` is a flat object of
// { statName: +1 | -1 | ... }; only known numeric stat fields are touched.
// `displayName` also refreshes the stored display capitalization.
function updateProfileAppearance(displayName, { avatarData, frameColor } = {}) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);

  const profile = players[key];
  profile.name = String(displayName || '').trim() || profile.name;

  if (typeof avatarData === 'string') profile.avatarData = avatarData;
  if (typeof frameColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(frameColor)) {
    profile.frameColor = frameColor.toUpperCase();
  }

  savePlayersAtomic(players);
  return profile;
}

function adjustProfile(displayName, { pointsDelta = 0, statDeltas = {} } = {}) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);

  const profile = players[key];
  profile.name = String(displayName || '').trim() || profile.name;
  profile.lastPlayed = nowISO();
  profile.lifetimeScore += pointsDelta;

  for (const [stat, delta] of Object.entries(statDeltas)) {
    if (typeof profile[stat] !== 'number') continue; // never touch non-numeric fields (id, name, dates) this way
    profile[stat] += delta;
  }

  savePlayersAtomic(players);
  return profile;
}

// bestColumnStreak and earliestFinalColumnsKnown are "best ever" records,
// not simple counters -- they only move in the record-setting direction.
function maybeRecordBestStreak(displayName, streakLength) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);
  const profile = players[key];
  if (streakLength > profile.bestColumnStreak) {
    profile.bestColumnStreak = streakLength;
    savePlayersAtomic(players);
  }
  return profile;
}

function maybeRecordEarliestFinal(displayName, columnsKnownAtSolve) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);
  const profile = players[key];
  if (profile.earliestFinalColumnsKnown === null || columnsKnownAtSolve < profile.earliestFinalColumnsKnown) {
    profile.earliestFinalColumnsKnown = columnsKnownAtSolve;
    savePlayersAtomic(players);
  }
  return profile;
}

// gamesPlayed/gamesWon are one-way board-finalization counters -- there is
// no "undo a finalized board" concept in this system, so no reversal path.
function recordBoardFinalization(displayName, { won }) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);
  const profile = players[key];
  profile.name = String(displayName || '').trim() || profile.name;
  profile.lastPlayed = nowISO();
  profile.gamesPlayed += 1;
  if (won) profile.gamesWon += 1;
  savePlayersAtomic(players);
  return profile;
}

function getAllTimeLeaderboard(limit = 50) {
  const players = loadPlayers();
  return Object.values(players)
    .sort((a, b) => b.lifetimeScore - a.lifetimeScore)
    .slice(0, limit);
}

module.exports = {
  PLAYERS_FILE,
  normalizeNameKey,
  loadPlayers,
  savePlayersAtomic,
  getOrCreateProfile,
  updateProfileAppearance,
  adjustProfile,
  maybeRecordBestStreak,
  maybeRecordEarliestFinal,
  recordBoardFinalization,
  getAllTimeLeaderboard
};
