/*
 * ASOC ENGINE - Match Store
 *
 * Persistent archive of COMPLETED matches (one record per finished board),
 * the foundation for RECOUNT, the Match Awards Engine's historical
 * comparisons, and a future GAME HISTORY. Plain JSON in one file
 * (matches.json), same durability rules as player-store.js:
 *
 *  - writes are temp-file-then-rename, so an interrupted write can't corrupt
 *  - a one-write-behind matches.json.bak is kept
 *  - a corrupt main file is quarantined as matches.json.corrupt-<ts> and
 *    restored from the backup
 *  - if BOTH are unusable, further writes are refused rather than
 *    overwriting the evidence with an empty archive
 *
 * A record is keyed by matchId (the board id). A match that is re-opened
 * (e.g. the GM reverses an accepted verdict) is removed here and re-written
 * when it next completes. History starts when capture goes live: nothing is
 * backfilled.
 */

const fs = require('fs');
const path = require('path');

const MATCHES_FILE = process.env.ASOC_MATCHES_FILE
  ? path.resolve(process.env.ASOC_MATCHES_FILE)
  : path.join(__dirname, 'matches.json');
const MATCHES_BACKUP_FILE = MATCHES_FILE + '.bak';
let storageHealthy = true;

function validate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Match archive root must be an object');
  }
  const matches = raw.matches === undefined ? {} : raw.matches;
  if (!matches || typeof matches !== 'object' || Array.isArray(matches)) {
    throw new Error('Match archive "matches" must be an object');
  }
  for (const [key, record] of Object.entries(matches)) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.matchId !== 'string') {
      throw new Error(`Invalid match record at key "${key}"`);
    }
  }
  return { version: 1, matches };
}

function readFile(filePath) {
  return validate(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function writeJsonAtomic(filePath, value) {
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function load() {
  if (!fs.existsSync(MATCHES_FILE)) {
    if (!fs.existsSync(MATCHES_BACKUP_FILE)) {
      storageHealthy = true;
      return { version: 1, matches: {} };
    }
    try {
      const backup = readFile(MATCHES_BACKUP_FILE);
      writeJsonAtomic(MATCHES_FILE, backup);
      storageHealthy = true;
      console.warn('[match-store] Restored matches.json from backup because the main file was missing.');
      return backup;
    } catch (error) {
      storageHealthy = false;
      console.error('[match-store] Main archive missing and backup unusable:', error.message);
      return { version: 1, matches: {} };
    }
  }

  try {
    const archive = readFile(MATCHES_FILE);
    storageHealthy = true;
    return archive;
  } catch (mainError) {
    console.error('[match-store] matches.json is corrupt or invalid:', mainError.message);
    if (!fs.existsSync(MATCHES_BACKUP_FILE)) {
      storageHealthy = false;
      console.error('[match-store] No valid backup exists. Refusing future writes until repaired.');
      return { version: 1, matches: {} };
    }
    try {
      const backup = readFile(MATCHES_BACKUP_FILE);
      const corruptPath = MATCHES_FILE + '.corrupt-' + Date.now();
      fs.renameSync(MATCHES_FILE, corruptPath);
      writeJsonAtomic(MATCHES_FILE, backup);
      storageHealthy = true;
      console.warn(`[match-store] Recovered from backup. Corrupt file preserved as ${path.basename(corruptPath)}`);
      return backup;
    } catch (backupError) {
      storageHealthy = false;
      console.error('[match-store] Backup is also unusable. Refusing future writes:', backupError.message);
      return { version: 1, matches: {} };
    }
  }
}

function saveAtomic(archive) {
  let normalized;
  try {
    normalized = validate(archive);
  } catch (error) {
    console.error('[match-store] Refusing to save invalid archive:', error.message);
    return false;
  }
  if (!storageHealthy) {
    console.error('[match-store] Refusing to write because storage is in a protected unhealthy state.');
    return false;
  }
  try {
    if (fs.existsSync(MATCHES_FILE)) writeJsonAtomic(MATCHES_BACKUP_FILE, readFile(MATCHES_FILE));
    writeJsonAtomic(MATCHES_FILE, normalized);
    if (!fs.existsSync(MATCHES_BACKUP_FILE)) writeJsonAtomic(MATCHES_BACKUP_FILE, normalized);
    storageHealthy = true;
    return true;
  } catch (error) {
    storageHealthy = false;
    console.error('[match-store] Failed to save matches.json safely:', error.message);
    return false;
  }
}

function upsertMatch(record) {
  const archive = load();
  if (!storageHealthy) return false;
  archive.matches[record.matchId] = record;
  return saveAtomic(archive);
}

function removeMatch(matchId) {
  const archive = load();
  if (!storageHealthy || !archive.matches[matchId]) return false;
  delete archive.matches[matchId];
  return saveAtomic(archive);
}

function getMatch(matchId) {
  return load().matches[matchId] || null;
}

function listMatches() {
  return Object.values(load().matches).sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
}

module.exports = { MATCHES_FILE, upsertMatch, removeMatch, getMatch, listMatches };
