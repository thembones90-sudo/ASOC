/*
 * ASOC ENGINE - Player Store
 *
 * Persistent, all-time player profiles. Mirrors game-store.js's filesystem
 * approach (plain JSON, no dependencies) but keeps every profile in ONE
 * file (players.json) rather than one file per profile, since profiles are
 * small and updated far more often than games are.
 *
 * IDENTITY: authenticated accounts own lifetime profiles by account id.
 * Legacy profiles that were keyed by normalized display name are migrated
 * once, on the account's first authenticated use. This preserves old totals
 * while allowing two different accounts to use the same visible name without
 * sharing points, appearance, or career statistics.
 */

const fs = require('./durable-io').fs;
const path = require('path');

const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const PLAYERS_FILE = process.env.ASOC_PLAYERS_FILE
  ? path.resolve(process.env.ASOC_PLAYERS_FILE)
  : path.join(DATA_DIR, 'players.json');
fs.mkdirSync(path.dirname(PLAYERS_FILE), { recursive: true });
const PLAYERS_BACKUP_FILE = PLAYERS_FILE + '.bak';
let storageHealthy = true;

function normalizeNameKey(name) {
  return name && typeof name === 'object' ? String(name.id) : String(name || '').trim().toLocaleLowerCase();
}

function nowISO() {
  return new Date().toISOString();
}

function blankProfile(displayName) {
  const identity = displayName;
  displayName = typeof identity === 'object' ? identity.name : identity;
  return {
    id: normalizeNameKey(identity),
    ...(identity && typeof identity === 'object' ? { accountId: identity.id } : {}),
    name: String(displayName || '').trim(),
    avatarData: '',
    frameColor: '#9B5DE0',
    themeId: 'gunmetal',
    themeColor: '#343A42',
    createdAt: nowISO(),
    lastPlayed: nowISO(),
    bannedAt: null,
    bannedReason: '',
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
    blackSolves: 0,
    threefoldPlayed: 0,
    threefoldWins: 0,
    threefoldLosses: 0,
    threefoldDraws: 0,
    asocGamesEarned: 0,
    // SHADOW COINS: ASOC's persistent account-level currency. Changed ONLY
    // through the Shadow Coin API below (never adjustProfile, never client
    // input). shadowCoinUnits is authoritative: an integer count of TENTHS of
    // a coin (12.3 coins = 123), so fractional rewards stay exact.
    // shadowCoins mirrors it in coins for readability. shadowCoinReceipts
    // holds recent idempotency keys so no change ever applies twice.
    shadowCoinUnits: 0,
    shadowCoins: 0,
    shadowCoinReceipts: [],
    // Server-side transaction history: every balance change (reward, penalty,
    // purchase, roulette spin, reversal) appends one entry. Newest last.
    shadowCoinLedger: [],
    // Cosmetic inventory. owned: { itemId: tier } (tier 1 for untiered
    // items). equipped: one item id (or null) per visual slot. Purely
    // presentational -- no gameplay code ever reads this.
    cosmetics: blankCosmetics(),
    // Relic earning: counters (e.g. wheelSurvivals) and the idempotency keys
    // of the events that bumped them, so a replay never counts twice.
    relicProgress: {},
    relicReceipts: [],
    dailyContracts: null,
    sibicarRound: null
  };
}

function blankCosmetics() {
  return {
    owned: {},
    equipped: { appearance: null, effect: null, frame: null, title: null, celebration: null, name: null, sigil: null, card: null },
    // Relic ids shown on the dossier, in order (slot count checked by server).
    showcase: []
  };
}

function normalizeRelicProgress(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const n = Math.floor(Number(value));
      if (/^[a-zA-Z0-9]{1,32}$/.test(key) && n > 0) out[key] = n;
    }
  }
  return out;
}

function normalizeCosmetics(raw) {
  const out = blankCosmetics();
  if (!raw || typeof raw !== 'object') return out;
  if (raw.owned && typeof raw.owned === 'object' && !Array.isArray(raw.owned)) {
    for (const [id, tier] of Object.entries(raw.owned)) {
      const n = Math.floor(Number(tier));
      if (/^[a-z0-9-]{1,48}$/.test(id) && n > 0) out.owned[id] = Math.min(n, 10);
    }
  }
  if (raw.equipped && typeof raw.equipped === 'object') {
    for (const slot of Object.keys(out.equipped)) {
      const id = raw.equipped[slot];
      out.equipped[slot] = typeof id === 'string' && out.owned[id] ? id : null;
    }
  }
  if (Array.isArray(raw.showcase)) {
    out.showcase = [...new Set(raw.showcase.filter(id => typeof id === 'string' && out.owned[id]))].slice(0, 3);
  }
  return out;
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
  'blackSolves',
  'threefoldPlayed',
  'threefoldWins',
  'threefoldLosses',
  'threefoldDraws',
  'asocGamesEarned',
  'shadowCoins',
  'shadowCoinUnits'
];

// Balance-changing fields that the generic counters must never touch.
const CURRENCY_FIELDS = new Set(['shadowCoins', 'shadowCoinUnits']);
const COIN_UNIT = 10; // tenths
const COIN_RECEIPT_LIMIT = 1000;
const COIN_LEDGER_LIMIT = 500;

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
    if (candidate.accountId !== undefined) {
      if (typeof candidate.accountId !== 'string' || !candidate.accountId.trim() || candidate.accountId !== key) {
        throw new Error(`Player profile "${key}" has invalid account identity`);
      }
      profile.accountId = candidate.accountId;
      profile.id = candidate.accountId;
    } else if (typeof profile.id !== 'string' || !profile.id.trim()) {
      profile.id = fallbackName || normalizeNameKey(displayName);
    }
    if (typeof profile.avatarData !== 'string') profile.avatarData = '';
    if (typeof profile.frameColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(profile.frameColor)) profile.frameColor = '#9B5DE0';
    if (typeof profile.themeId !== 'string' || !/^[a-z0-9-]{1,32}$/.test(profile.themeId)) profile.themeId = 'gunmetal';
    if (typeof profile.themeColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(profile.themeColor)) profile.themeColor = '#343A42';
    if (typeof profile.createdAt !== 'string') profile.createdAt = base.createdAt;
    if (typeof profile.lastPlayed !== 'string') profile.lastPlayed = base.lastPlayed;
    if (profile.bannedAt !== null && typeof profile.bannedAt !== 'string') profile.bannedAt = null;
    if (typeof profile.bannedReason !== 'string') profile.bannedReason = '';

    for (const field of NUMERIC_PROFILE_FIELDS) {
      if (candidate[field] === undefined) {
        profile[field] = 0;
      } else if (!Number.isFinite(candidate[field])) {
        throw new Error(`Player profile "${key}" has invalid numeric field "${field}"`);
      }
    }
    if (!Array.isArray(profile.shadowCoinReceipts)) profile.shadowCoinReceipts = [];
    if (!Array.isArray(profile.shadowCoinLedger)) profile.shadowCoinLedger = [];
    profile.cosmetics = normalizeCosmetics(candidate.cosmetics);
    profile.relicProgress = normalizeRelicProgress(candidate.relicProgress);
    profile.relicReceipts = Array.isArray(candidate.relicReceipts) ? candidate.relicReceipts.filter(r => typeof r === 'string').slice(-500) : [];
    profile.dailyContracts = candidate.dailyContracts && typeof candidate.dailyContracts === 'object' ? candidate.dailyContracts : null;
    profile.sibicarRound = candidate.sibicarRound && typeof candidate.sibicarRound === 'object' ? candidate.sibicarRound : null;
    // Older profiles stored whole coins only; derive tenths from them once.
    const units = candidate.shadowCoinUnits === undefined
      ? Math.round((Number(profile.shadowCoins) || 0) * COIN_UNIT)
      : Math.round(Number(profile.shadowCoinUnits) || 0);
    profile.shadowCoinUnits = Math.max(0, units);
    profile.shadowCoins = profile.shadowCoinUnits / COIN_UNIT;

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

function writeJsonAtomic(filePath, value) { return require('./durable-io').writeJson(filePath, value); }

// IN-MEMORY CACHE of the validated database. The server is the only writer of
// players.json, and a full read + parse + validate costs ~100 ms per MB-scale
// file, so hot paths (roster broadcasts, coin reads, daily contracts) reuse
// the last validated copy whenever it provably still matches storage:
//   - inside a durable-io transaction: the queued text is the exact string
//     this store wrote (identity check), or
//   - otherwise: the file's inode/size/mtime equal what we last saw.
// Anything else (external edit, aborted transaction, corruption) falls back to
// the full validated read. Callers of loadPlayers() always receive a private
// deep copy they may mutate; peekPlayers() is the read-only shared view.
const durableIOModule = require('./durable-io');
const avatarStore = require('./avatar-store');
let playersCache = null; // { sig, text, data }
function playersFileSig() {
  try {
    const st = require('fs').statSync(PLAYERS_FILE);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}
function cachedPlayers() {
  if (!playersCache) return null;
  const queued = durableIOModule.pendingValue(PLAYERS_FILE);
  if (queued !== undefined) return queued === playersCache.text ? playersCache.data : null;
  if (playersCache.sig && playersCache.sig === playersFileSig()) return playersCache.data;
  return null;
}
function rememberPlayers(data, text = null) {
  const queued = durableIOModule.pendingValue(PLAYERS_FILE) !== undefined;
  playersCache = { sig: queued ? null : playersFileSig(), text, data: structuredClone(data) };
}
// A committed write re-validates the cache only when it is byte-for-byte the
// content the cache holds; any other write to the file (backup recovery,
// another code path) drops the cache so the next read is a full validated one.
durableIOModule.onCommit(writes => {
  if (!playersCache) return;
  const target = path.resolve(PLAYERS_FILE);
  for (const [file, data] of writes) {
    if (file !== target) continue;
    if (data === playersCache.text) playersCache.sig = playersFileSig();
    else playersCache = null;
  }
});

function loadPlayers() {
  const cached = cachedPlayers();
  if (cached) {
    storageHealthy = true;
    return structuredClone(cached);
  }
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
    const queued = durableIOModule.pendingValue(PLAYERS_FILE);
    rememberPlayers(players, queued === undefined ? null : queued);
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
      // The cached copy is the validated current file (see cachedPlayers).
      const previousGood = cachedPlayers() || readPlayersFile(PLAYERS_FILE);
      writeJsonAtomic(PLAYERS_BACKUP_FILE, previousGood);
    }

    const written = writeJsonAtomic(PLAYERS_FILE, normalized);
    rememberPlayers(normalized, written);

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
  if (!storageHealthy) throw Error('Player storage unavailable');
  if (!players[key]) {
    const legacyKey = typeof displayName === 'object' ? normalizeNameKey(displayName.name) : null;
    const legacy = legacyKey && players[legacyKey];
    if (legacy && !legacy.accountId && legacyKey !== key) {
      players[key] = { ...legacy, id: key, accountId: key, name: displayName.name };
      delete players[legacyKey];
    } else players[key] = blankProfile(displayName);
    savePlayersAtomic(players);
  }
  return { key, profile: players[key] };
}

// Applies a point delta and/or stat-count deltas to one profile, persisting
// immediately. Pass negative values to reverse a previously-applied event
// (e.g. a GM verdict correction). `statDeltas` is a flat object of
// { statName: +1 | -1 | ... }; only known numeric stat fields are touched.
// `displayName` also refreshes the stored display capitalization.
function updateProfileAppearance(displayName, { avatarData, frameColor, themeId, themeColor } = {}) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);

  const profile = players[key];
  profile.name = String((typeof displayName === 'object' ? displayName.name : displayName) || '').trim() || profile.name;

  // Avatars are stored as files (avatar-store.js); the profile keeps only the
  // short /avatars/<hash> URL. An invalid image leaves the avatar unchanged.
  if (typeof avatarData === 'string') {
    const stored = avatarStore.normalize(avatarData);
    if (stored !== null) profile.avatarData = stored;
  }
  if (typeof frameColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(frameColor)) {
    profile.frameColor = frameColor.toUpperCase();
  }
  if (typeof themeId === 'string' && /^[a-z0-9-]{1,32}$/.test(themeId)) {
    profile.themeId = themeId;
  }
  if (typeof themeColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(themeColor)) {
    profile.themeColor = themeColor.toUpperCase();
  }

  savePlayersAtomic(players);
  return profile;
}

// ---------------------------------------------------------------------------
// SHADOW COINS -- one non-negative balance per player ACCOUNT, kept as an
// integer count of tenths (shadowCoinUnits) so +0.2 / -0.1 rewards are exact.
// Amounts in this API are in COINS with at most one decimal (1, 5, 0.2, 0.1).
// Identity must be an account object ({ id, name }): coins are never keyed by
// display name, so renames never touch the balance. Every change carries an
// idempotency key (`receiptId`): replaying the same change is a no-op.

// Coins -> tenths; null unless a positive amount with at most one decimal.
function coinUnits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const units = Math.round(n * COIN_UNIT);
  return Math.abs(units - n * COIN_UNIT) < 1e-6 && units > 0 ? units : null;
}

function unitsToCoins(units) {
  return Math.max(0, Math.round(Number(units) || 0)) / COIN_UNIT;
}

function coinProfile(players, identity) {
  if (!identity || typeof identity !== 'object' || !identity.id) throw new Error('Shadow Coins need an account identity');
  const key = normalizeNameKey(identity);
  if (!players[key]) players[key] = blankProfile(identity);
  const profile = players[key];
  if (!Number.isInteger(profile.shadowCoinUnits) || profile.shadowCoinUnits < 0) {
    profile.shadowCoinUnits = Math.max(0, Math.round((Number(profile.shadowCoins) || 0) * COIN_UNIT));
  }
  if (!Array.isArray(profile.shadowCoinReceipts)) profile.shadowCoinReceipts = [];
  if (!Array.isArray(profile.shadowCoinLedger)) profile.shadowCoinLedger = [];
  if (!profile.cosmetics || typeof profile.cosmetics !== 'object') profile.cosmetics = blankCosmetics();
  if (!Array.isArray(profile.cosmetics.showcase)) profile.cosmetics.showcase = [];
  if (!profile.relicProgress || typeof profile.relicProgress !== 'object') profile.relicProgress = {};
  if (!Array.isArray(profile.relicReceipts)) profile.relicReceipts = [];
  return profile;
}

// Applies a signed change in tenths, appends the ledger entry, persists.
function recordCoinChange(players, profile, receiptId, units, { kind = 'adjust', reason = '', detail = null } = {}) {
  profile.shadowCoinUnits = Math.max(0, profile.shadowCoinUnits + units);
  profile.shadowCoins = unitsToCoins(profile.shadowCoinUnits);
  profile.shadowCoinReceipts.push(receiptId);
  if (profile.shadowCoinReceipts.length > COIN_RECEIPT_LIMIT) profile.shadowCoinReceipts.splice(0, profile.shadowCoinReceipts.length - COIN_RECEIPT_LIMIT);
  const entry = { id: receiptId, at: nowISO(), delta: (units < 0 ? -1 : 1) * unitsToCoins(Math.abs(units)), balance: profile.shadowCoins, kind, reason: String(reason || '').slice(0, 120) };
  if (detail) entry.detail = detail;
  profile.shadowCoinLedger.push(entry);
  if (profile.shadowCoinLedger.length > COIN_LEDGER_LIMIT) profile.shadowCoinLedger.splice(0, profile.shadowCoinLedger.length - COIN_LEDGER_LIMIT);
  // A refused save means the change did not happen: callers report failure
  // instead of a phantom success (the in-memory copy is discarded).
  return savePlayersAtomic(players);
}
const COIN_STORAGE_ERROR = 'Shadow Coin storage unavailable';

function getShadowCoins(identity) {
  const players = loadPlayers();
  const key = identity && typeof identity === 'object' ? normalizeNameKey(identity) : null;
  const profile = key ? players[key] : null;
  if (!profile) return 0;
  const units = Number.isInteger(profile.shadowCoinUnits) ? profile.shadowCoinUnits : Math.round((Number(profile.shadowCoins) || 0) * COIN_UNIT);
  return unitsToCoins(units);
}

// Grants `amount` coins once per receiptId. Returns { ok, balance, duplicate }.
function awardShadowCoins(identity, amount, receiptId, { reason = '' } = {}) {
  const units = coinUnits(amount);
  if (!units) return { ok: false, error: 'Award must be a positive amount in tenths of a coin' };
  if (!receiptId || typeof receiptId !== 'string') return { ok: false, error: 'Award needs a receipt id' };
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  if (profile.shadowCoinReceipts.includes(receiptId)) return { ok: true, duplicate: true, balance: unitsToCoins(profile.shadowCoinUnits) };
  profile.name = String(identity.name || profile.name || '').trim() || profile.name;
  if (!recordCoinChange(players, profile, receiptId, units, { kind: 'reward', reason })) return { ok: false, error: COIN_STORAGE_ERROR };
  if (reason) console.log(`[shadow-coins] +${unitsToCoins(units)} to ${profile.name} (${reason}) -> ${profile.shadowCoins}`);
  return { ok: true, balance: profile.shadowCoins, duplicate: false };
}

// A penalty or reversal: removes up to `amount`, never below zero, once per
// receiptId. Returns { ok, balance, deducted, duplicate }.
function deductShadowCoins(identity, amount, receiptId, { reason = '' } = {}) {
  const units = coinUnits(amount);
  if (!units) return { ok: false, error: 'Deduction must be a positive amount in tenths of a coin' };
  if (!receiptId || typeof receiptId !== 'string') return { ok: false, error: 'Deduction needs a receipt id' };
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  if (profile.shadowCoinReceipts.includes(receiptId)) return { ok: true, duplicate: true, balance: unitsToCoins(profile.shadowCoinUnits), deducted: 0 };
  const taken = Math.min(units, profile.shadowCoinUnits);
  if (!recordCoinChange(players, profile, receiptId, -taken, { kind: 'penalty', reason })) return { ok: false, error: COIN_STORAGE_ERROR };
  if (reason) console.log(`[shadow-coins] -${unitsToCoins(taken)} from ${profile.name} (${reason}) -> ${profile.shadowCoins}`);
  return { ok: true, balance: profile.shadowCoins, deducted: unitsToCoins(taken), duplicate: false };
}

// A plain spend: deducts `amount` once per receiptId, only with sufficient
// balance. Cosmetic purchases use purchaseCosmetic below.
function spendShadowCoins(identity, amount, receiptId, { reason = 'spend' } = {}) {
  const units = coinUnits(amount);
  if (!units) return { ok: false, error: 'Price must be a positive amount in tenths of a coin' };
  if (!receiptId || typeof receiptId !== 'string') return { ok: false, error: 'Purchase needs a receipt id' };
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  if (profile.shadowCoinReceipts.includes(receiptId)) return { ok: true, duplicate: true, balance: unitsToCoins(profile.shadowCoinUnits) };
  if (profile.shadowCoinUnits < units) return { ok: false, error: 'Not enough Shadow Coins', balance: unitsToCoins(profile.shadowCoinUnits) };
  if (!recordCoinChange(players, profile, receiptId, -units, { kind: 'purchase', reason })) return { ok: false, error: COIN_STORAGE_ERROR };
  return { ok: true, balance: profile.shadowCoins, duplicate: false };
}

// ---------------------------------------------------------------------------
// COSMETICS -- ownership and equip state. The server (via shadow-market.js)
// decides WHAT may be bought and at what price; this layer guarantees the
// money and the unlock move together in one atomic save.

function getShadowProfile(identity) {
  const players = loadPlayers();
  const key = identity && typeof identity === 'object' ? normalizeNameKey(identity) : null;
  const profile = key ? players[key] : null;
  if (!profile) return { ...blankProfile(identity), shadowCoinLedger: [], cosmetics: blankCosmetics() };
  if (!profile.cosmetics) profile.cosmetics = blankCosmetics();
  if (!Array.isArray(profile.shadowCoinLedger)) profile.shadowCoinLedger = [];
  return profile;
}

// Buys `tier` of `itemId` for `price` coins. The owned tier must be exactly
// tier - 1, so a double click or stale UI can never buy twice.
function purchaseCosmetic(identity, itemId, tier, price, receiptId, { reason = '' } = {}) {
  const units = coinUnits(price);
  if (!units) return { ok: false, error: 'Invalid price' };
  if (!receiptId || typeof receiptId !== 'string') return { ok: false, error: 'Purchase needs a receipt id' };
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  if (profile.shadowCoinReceipts.includes(receiptId)) return { ok: true, duplicate: true, balance: unitsToCoins(profile.shadowCoinUnits) };
  const owned = profile.cosmetics.owned || (profile.cosmetics.owned = {});
  if ((Number(owned[itemId]) || 0) !== tier - 1) return { ok: false, error: 'Already owned' };
  if (profile.shadowCoinUnits < units) return { ok: false, error: 'Not enough Shadow Coins', balance: unitsToCoins(profile.shadowCoinUnits) };
  owned[itemId] = tier;
  if (!recordCoinChange(players, profile, receiptId, -units, { kind: 'purchase', reason: reason || `bought ${itemId}`, detail: { itemId, tier } })) return { ok: false, error: COIN_STORAGE_ERROR };
  return { ok: true, balance: profile.shadowCoins, tier };
}

// Relics are granted, never bought. Idempotent per item.
function grantRelic(identity, itemId) {
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  if (Number(profile.cosmetics.owned[itemId]) > 0) return { ok: true, duplicate: true };
  profile.cosmetics.owned[itemId] = 1;
  savePlayersAtomic(players);
  return { ok: true };
}

// Equips an owned item into `slot`, or clears the slot with itemId null.
function equipCosmetic(identity, slot, itemId) {
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  const equipped = profile.cosmetics.equipped || (profile.cosmetics.equipped = blankCosmetics().equipped);
  if (!Object.prototype.hasOwnProperty.call(equipped, slot)) return { ok: false, error: 'Unknown slot' };
  if (itemId !== null && !(Number(profile.cosmetics.owned[itemId]) > 0)) return { ok: false, error: 'Not owned' };
  equipped[slot] = itemId;
  savePlayersAtomic(players);
  return { ok: true, equipped: { ...equipped } };
}

// Bumps a relic counter once per receiptId. Returns the counter value.
function bumpRelicProgress(identity, counter, receiptId) {
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  if (profile.relicReceipts.includes(receiptId)) return Number(profile.relicProgress[counter]) || 0;
  profile.relicProgress[counter] = (Number(profile.relicProgress[counter]) || 0) + 1;
  profile.relicReceipts.push(receiptId);
  if (profile.relicReceipts.length > 500) profile.relicReceipts.splice(0, profile.relicReceipts.length - 500);
  savePlayersAtomic(players);
  return profile.relicProgress[counter];
}

// Replaces the dossier showcase. The caller validates ids and slot count.
function setShowcase(identity, itemIds) {
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  // Server already deduplicates, but the store is the persistence boundary:
  // never let duplicate ids consume or fake showcase slots if called directly.
  const requested = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(id => String(id || '')))];
  const ids = requested.filter(id => Number(profile.cosmetics.owned[id]) > 0);
  if (ids.length !== requested.length) return { ok: false, error: 'Not owned' };
  profile.cosmetics.showcase = ids;
  savePlayersAtomic(players);
  return { ok: true, showcase: [...ids] };
}

function ownsCosmetic(identity, itemId) {
  return Number(getShadowProfile(identity).cosmetics?.owned?.[itemId]) > 0;
}

// One roulette spin, settled atomically: the stake must be covered, then
// resolve() picks the outcome and the NET result (payout - stake) is applied
// and logged as a single ledger entry with the full spin detail.
function settleRouletteSpin(identity, wager, receiptId, resolve) {
  const stake = coinUnits(wager);
  if (!stake) return { ok: false, error: 'Invalid wager' };
  const players = loadPlayers();
  const profile = coinProfile(players, identity);
  if (profile.shadowCoinReceipts.includes(receiptId)) return { ok: false, error: 'Spin already settled' };
  if (profile.shadowCoinUnits < stake) return { ok: false, error: 'Not enough Shadow Coins', balance: unitsToCoins(profile.shadowCoinUnits) };
  const outcome = resolve();
  const net = outcome.won ? stake * outcome.odds : -stake;
  const detail = { wager: unitsToCoins(stake), bet: outcome.label, pocket: outcome.pocket, won: outcome.won, payout: outcome.won ? unitsToCoins(stake * (outcome.odds + 1)) : 0 };
  if (!recordCoinChange(players, profile, receiptId, net, {
    kind: 'roulette',
    reason: `ROULETTE ${outcome.pocket} // ${outcome.label} // ${unitsToCoins(stake)} SC`,
    detail
  })) return { ok: false, error: COIN_STORAGE_ERROR };
  return { ok: true, balance: profile.shadowCoins, net: (net < 0 ? -1 : 1) * unitsToCoins(Math.abs(net)), outcome };
}

// Å IBICAR keeps escrow and the round record in the same atomic profile write.
function createSibicarRound(identity, round) {
  if (!round || round.status !== 'ACTIVE' || String(round.playerId) !== String(identity?.id)) return { ok: false, error: 'Invalid Å IBICAR round' };
  const players = loadPlayers(), profile = coinProfile(players, identity), current = profile.sibicarRound;
  if (current?.status === 'ACTIVE') return { ok: false, error: 'AN ACTIVE Å IBICAR ROUND ALREADY EXISTS.', round: current, balance: profile.shadowCoins };
  const wagerUnits = round.mode === 'WAGER' ? coinUnits(round.wager) : 0;
  if (round.mode === 'WAGER' && !wagerUnits) return { ok: false, error: 'Invalid wager' };
  if (wagerUnits && profile.shadowCoinUnits < wagerUnits) return { ok: false, error: 'NOT ENOUGH SHADOW COINS.', balance: profile.shadowCoins };
  const receiptId = `sibicar:${round.id}:wager`;
  if (wagerUnits) {
    if (profile.shadowCoinReceipts.includes(receiptId)) return { ok: false, error: 'Å IBICAR WAGER ALREADY RECORDED.' };
    profile.shadowCoinUnits -= wagerUnits; profile.shadowCoins = unitsToCoins(profile.shadowCoinUnits); profile.shadowCoinReceipts.push(receiptId);
    profile.shadowCoinLedger.push({ id: receiptId, at: nowISO(), delta: -unitsToCoins(wagerUnits), balance: profile.shadowCoins, kind: 'sibicar_wager', reason: `Å IBICAR WAGER // ${round.id}`, detail: { roundId: round.id, wager: round.wager } });
  }
  profile.sibicarRound = JSON.parse(JSON.stringify(round));
  if (profile.shadowCoinReceipts.length > COIN_RECEIPT_LIMIT) profile.shadowCoinReceipts.splice(0, profile.shadowCoinReceipts.length - COIN_RECEIPT_LIMIT);
  if (profile.shadowCoinLedger.length > COIN_LEDGER_LIMIT) profile.shadowCoinLedger.splice(0, profile.shadowCoinLedger.length - COIN_LEDGER_LIMIT);
  if (!savePlayersAtomic(players)) return { ok: false, error: COIN_STORAGE_ERROR };
  return { ok: true, round: profile.sibicarRound, balance: profile.shadowCoins };
}

function getSibicarRound(identity) {
  const players = loadPlayers(), key = identity && typeof identity === 'object' ? normalizeNameKey(identity) : null;
  return key && players[key]?.sibicarRound ? JSON.parse(JSON.stringify(players[key].sibicarRound)) : null;
}

function settleSibicarRound(identity, roundId, selectedPosition) {
  const players = loadPlayers(), profile = coinProfile(players, identity), round = profile.sibicarRound;
  if (!round || String(round.id) !== String(roundId)) return { ok: false, error: 'Å IBICAR ROUND NOT FOUND.' };
  if (String(round.playerId) !== String(identity?.id)) return { ok: false, error: 'THIS ROUND BELONGS TO ANOTHER PLAYER.' };
  if (round.status !== 'ACTIVE') return { ok: true, duplicate: true, round: JSON.parse(JSON.stringify(round)), balance: profile.shadowCoins };
  const position = Number(selectedPosition);
  if (!Number.isInteger(position) || position < 0 || position > 2) return { ok: false, error: 'CHOOSE ONE OF THE THREE HEADS.' };
  const correct = position === Number(round.finalPosition);
  round.selectedPosition = position; round.result = correct ? 'CORRECT' : 'WRONG'; round.status = correct ? 'WON' : 'LOST';
  round.payout = correct && round.mode === 'WAGER' ? Number(round.wager) * 2 : 0; round.settledAt = Date.now();
  if (round.payout > 0) {
    const payoutUnits = coinUnits(round.payout), receiptId = `sibicar:${round.id}:win`;
    if (!profile.shadowCoinReceipts.includes(receiptId)) {
      profile.shadowCoinUnits += payoutUnits; profile.shadowCoins = unitsToCoins(profile.shadowCoinUnits); profile.shadowCoinReceipts.push(receiptId);
      profile.shadowCoinLedger.push({ id: receiptId, at: nowISO(), delta: unitsToCoins(payoutUnits), balance: profile.shadowCoins, kind: 'sibicar_win', reason: `Å IBICAR WIN // ${round.id}`, detail: { roundId: round.id, wager: round.wager, payout: round.payout } });
    }
  }
  if (profile.shadowCoinReceipts.length > COIN_RECEIPT_LIMIT) profile.shadowCoinReceipts.splice(0, profile.shadowCoinReceipts.length - COIN_RECEIPT_LIMIT);
  if (profile.shadowCoinLedger.length > COIN_LEDGER_LIMIT) profile.shadowCoinLedger.splice(0, profile.shadowCoinLedger.length - COIN_LEDGER_LIMIT);
  if (!savePlayersAtomic(players)) return { ok: false, error: COIN_STORAGE_ERROR };
  return { ok: true, duplicate: false, correct, round: JSON.parse(JSON.stringify(round)), balance: profile.shadowCoins };
}

function adjustProfile(displayName, { pointsDelta = 0, statDeltas = {} } = {}) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);

  const profile = players[key];
  profile.name = String((typeof displayName === 'object' ? displayName.name : displayName) || '').trim() || profile.name;
  profile.lastPlayed = nowISO();
  profile.lifetimeScore += pointsDelta;

  for (const [stat, delta] of Object.entries(statDeltas)) {
    if (typeof profile[stat] !== 'number') continue; // never touch non-numeric fields (id, name, dates) this way
    if (CURRENCY_FIELDS.has(stat)) continue; // currency moves only through the Shadow Coin API
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

// gamesPlayed/gamesWon are board-finalization counters. The one reversal is a
// GM correcting a mistaken FINAL GREEN before GAME WON/LOST: server.js
// unfinalizeBoard() subtracts exactly what was credited via adjustProfile().
function recordBoardFinalization(displayName, { won }) {
  const key = normalizeNameKey(displayName);
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(displayName);
  const profile = players[key];
  profile.name = String((typeof displayName === 'object' ? displayName.name : displayName) || '').trim() || profile.name;
  profile.lastPlayed = nowISO();
  profile.gamesPlayed += 1;
  if (won) profile.gamesWon += 1;
  savePlayersAtomic(players);
  return profile;
}

function getModerationStatus(identity) {
  const players = loadPlayers();
  const profile = players[normalizeNameKey(identity)];
  return {
    banned: !!profile?.bannedAt,
    bannedAt: profile?.bannedAt || null,
    reason: profile?.bannedReason || ''
  };
}

function setBan(identity, banned = true, reason = '') {
  const key = normalizeNameKey(identity);
  if (!key) throw new Error('Player identity is required for moderation');
  const players = loadPlayers();
  if (!players[key]) players[key] = blankProfile(identity);
  const profile = players[key];
  const displayName = typeof identity === 'object' ? identity.name : identity;
  if (String(displayName || '').trim()) profile.name = String(displayName).trim();
  profile.bannedAt = banned ? nowISO() : null;
  profile.bannedReason = banned ? String(reason || '').trim().slice(0, 160) : '';
  savePlayersAtomic(players);
  return {
    banned: !!profile.bannedAt,
    bannedAt: profile.bannedAt,
    reason: profile.bannedReason
  };
}

// SCOREBOARD RESET -- the Shadow Broker's "start playing for real" switch.
// Zeroes every Battle scoreboard field on every profile. Deliberately KEEPS
// Shadow Coins (balance, receipts, ledger), cosmetics, relics and relic
// progress, identity/appearance, moderation state and IKS OKS records.
const SCOREBOARD_FIELDS = [
  'lifetimeScore', 'gamesPlayed', 'gamesWon', 'columnSolutions', 'oneClueColumnSolutions',
  'finalSolutions', 'earlyFinalSolutions', 'bestColumnStreak', 'purpleSolves', 'blackSolves'
];
function resetScoreboard() {
  const players = loadPlayers();
  if (!storageHealthy) throw Error('Player storage unavailable');
  let count = 0;
  for (const profile of Object.values(players)) {
    for (const field of SCOREBOARD_FIELDS) profile[field] = 0;
    profile.earliestFinalColumnsKnown = null;
    count++;
  }
  savePlayersAtomic(players);
  return { profiles: count };
}

// Idempotent per receipt. `createdBefore` (ms epoch or ISO) limits the grant to
// profiles that already existed at that moment; profiles with no creation
// timestamp predate tracking and count as existing.
function grantAllShadowCoins(amount, receiptId, { reason = '', createdBefore = null } = {}) {
  const units = coinUnits(amount);
  if (!units) return { ok: false, error: 'Invalid Shadow Coin amount', granted: 0, skipped: 0 };
  const receipt = String(receiptId || '').trim();
  if (!receipt) return { ok: false, error: 'Shadow Coin receipt required', granted: 0, skipped: 0 };

  const players = loadPlayers();
  if (!storageHealthy) throw Error('Player storage unavailable');

  let granted = 0;
  let skipped = 0;
  const cutoff = createdBefore === null || createdBefore === undefined ? null : new Date(createdBefore).getTime();
  if (cutoff !== null && !Number.isFinite(cutoff)) return { ok: false, error: 'Invalid creation cutoff', granted: 0, skipped: 0 };
  let ineligible = 0;
  for (const profile of Object.values(players)) {
    if (!profile || !profile.id) continue;
    const created = profile.createdAt ? new Date(profile.createdAt).getTime() : null;
    if (cutoff !== null && Number.isFinite(created) && created > cutoff) { ineligible++; continue; }
    if (!Number.isInteger(profile.shadowCoinUnits) || profile.shadowCoinUnits < 0) {
      profile.shadowCoinUnits = Math.max(0, Math.round((Number(profile.shadowCoins) || 0) * COIN_UNIT));
    }
    if (!Array.isArray(profile.shadowCoinReceipts)) profile.shadowCoinReceipts = [];
    if (!Array.isArray(profile.shadowCoinLedger)) profile.shadowCoinLedger = [];

    if (profile.shadowCoinReceipts.includes(receipt)) {
      skipped++;
      continue;
    }

    profile.shadowCoinUnits += units;
    profile.shadowCoins = unitsToCoins(profile.shadowCoinUnits);
    profile.shadowCoinReceipts.push(receipt);
    if (profile.shadowCoinReceipts.length > COIN_RECEIPT_LIMIT) {
      profile.shadowCoinReceipts.splice(0, profile.shadowCoinReceipts.length - COIN_RECEIPT_LIMIT);
    }
    profile.shadowCoinLedger.push({
      id: receipt,
      at: nowISO(),
      delta: unitsToCoins(units),
      balance: profile.shadowCoins,
      kind: 'admin_grant',
      reason: String(reason || '').slice(0, 120)
    });
    if (profile.shadowCoinLedger.length > COIN_LEDGER_LIMIT) {
      profile.shadowCoinLedger.splice(0, profile.shadowCoinLedger.length - COIN_LEDGER_LIMIT);
    }
    granted++;
  }

  if (granted && !savePlayersAtomic(players)) return { ok: false, error: COIN_STORAGE_ERROR, granted: 0, skipped };
  return { ok: true, granted, skipped, ineligible, amount: unitsToCoins(units) };
}

function clampNegativeLifetimeScores() {
  const players = loadPlayers();
  if (!storageHealthy) return { changed: 0, names: [], error: 'Player storage unavailable' };
  const names = [];
  for (const profile of Object.values(players)) {
    if (!profile || !Number.isFinite(profile.lifetimeScore) || profile.lifetimeScore >= 0) continue;
    profile.lifetimeScore = 0;
    names.push(profile.name || profile.id || 'UNKNOWN');
  }
  if (names.length && !savePlayersAtomic(players)) {
    return { changed: 0, names: [], error: 'Player storage refused the score clamp write' };
  }
  return { changed: names.length, names };
}

function getAllTimeLeaderboard(limit = 50) {
  const players = loadPlayers();
  return Object.values(players)
    .filter(profile => {
      const name = String(profile?.name || '').trim().toUpperCase();
      return name !== 'TEST SUBJECT' && name !== 'SHADOW BROKER';
    })
    .sort((a, b) => b.lifetimeScore - a.lifetimeScore)
    .slice(0, limit);
}

// One-time (idempotent) migration: inline data-URI avatars become files and
// profiles keep the /avatars/<hash> URL. An avatar that fails validation is
// left untouched rather than dropped. Returns { migrated, skipped }.
function migrateAvatarsToFiles() {
  const players = loadPlayers();
  if (!storageHealthy) return { migrated: 0, skipped: 0, error: 'Player storage unavailable' };
  let migrated = 0;
  let skipped = 0;
  for (const profile of Object.values(players)) {
    const value = profile?.avatarData;
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const stored = avatarStore.storeDataUri(value);
    if (stored) { profile.avatarData = stored; migrated++; } else skipped++;
  }
  if (migrated && !savePlayersAtomic(players)) return { migrated: 0, skipped, error: 'Player storage refused the migration write' };
  return { migrated, skipped };
}

// Read-only shared view for hot read paths. NEVER mutate the result.
function peekPlayers() {
  const cached = cachedPlayers();
  if (cached) return cached;
  const fresh = loadPlayers();
  return cachedPlayers() || fresh;
}

module.exports = {
  isHealthy() { peekPlayers(); return storageHealthy; },
  peekPlayers,
  migrateAvatarsToFiles,
  storageHealthy() { return storageHealthy; },
  PLAYERS_FILE,
  normalizeNameKey,
  loadPlayers,
  savePlayersAtomic,
  getOrCreateProfile,
  updateProfileAppearance,
  adjustProfile,
  getShadowCoins,
  grantAllShadowCoins,
  awardShadowCoins,
  deductShadowCoins,
  spendShadowCoins,
  getShadowProfile,
  resetScoreboard,
  SCOREBOARD_FIELDS,
  purchaseCosmetic,
  grantRelic,
  equipCosmetic,
  ownsCosmetic,
  bumpRelicProgress,
  setShowcase,
  settleRouletteSpin,
  createSibicarRound,
  getSibicarRound,
  settleSibicarRound,
  maybeRecordBestStreak,
  maybeRecordEarliestFinal,
  recordBoardFinalization,
  getModerationStatus,
  setBan,
  getAllTimeLeaderboard,
  clampNegativeLifetimeScores
};
