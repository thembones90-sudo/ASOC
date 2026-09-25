const durableIO = require('./durable-io');
const playerSessionStore = require('./player-session-store');
const net = require('net');
const dns = require('dns');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const gameStore = require('./game-store');
const playerStore = require('./player-store');
const authStore = require('./auth-store');
const emailService = require('./email-service');
const scoring = require('./scoring-constants');
const matchLedger = require('./match-ledger');
const matchStore = require('./match-store');
const recountEngine = require('./recount-engine');
const tweakStore = require('./tweak-store');
const unstableConcoction = require('./unstable-concoction');
// TWEAKS production sync marker: feedback subsystem is part of the live server build.
// TWEAKS player HUD visibility sync.
// TWEAKS emergency button sync marker.
// TWEAKS executable client placement sync marker.

const PORT = Number(process.env.PORT) || 8080;
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;
const MAX_WS_PAYLOAD_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_POLL_QUESTION_LENGTH = 160;
const MAX_POLL_OPTION_LENGTH = 80;
const MAX_POLL_OPTIONS = 8;
const POLL_DURATION_OPTIONS_SECONDS = new Set([0, 30, 60, 120, 300, 600]);
const GIF_API_WINDOW_MS = 60 * 60 * 1000;
const GIF_API_GLOBAL_LIMIT = 90;
const GIF_API_PLAYER_LIMIT = 10;
const GIF_API_RESULT_LIMIT = 12;
const GIF_SEARCH_CACHE_MS = 15 * 60 * 1000;
const GIF_TRENDING_CACHE_MS = 10 * 60 * 1000;
const GIPHY_API_BASE = 'https://api.giphy.com/v1/gifs';
const GIPHY_API_KEY = String(process.env.GIPHY_API_KEY || '').trim();
const GIPHY_RATING = String(process.env.GIPHY_RATING || 'pg-13').trim() || 'pg-13';
const MASTER_ROOM_CODE = 'MASTER';
const ROOM_MODES = Object.freeze({
  CASUAL: 'CASUAL',
  BATTLE_ARMED: 'BATTLE_ARMED',
  BATTLE: 'BATTLE',
  RECOUNT: 'RECOUNT'
});
function normalizeRoomMode(value, armed = false) {
  return Object.values(ROOM_MODES).includes(value)
    ? value
    : (armed ? ROOM_MODES.BATTLE_ARMED : ROOM_MODES.CASUAL);
}
// Adjudication (GREEN/RED, GAME WON/LOST) only exists on the battle surface.
// CASUAL hides the board; RECOUNT is an already-shown, archived result.
function isBattleSurface(room) {
  return room.roomMode === ROOM_MODES.BATTLE_ARMED || room.roomMode === ROOM_MODES.BATTLE;
}
const RITUAL_REQUIRED_VOTES = 5;
// A launch accepted with a fulfilled ritual stays valid this long (T-10 plus
// slack for the host's own round trip), even if a voter drops meanwhile.
const RITUAL_LAUNCH_GRACE_MS = 30 * 1000;
const MAX_CHAT_LENGTH = 100;
const MAX_MODERATION_REASON_LENGTH = 180;
const PLAYER_CHAT_MIN_INTERVAL_MS = 350;
const PLAYER_REACTION_MIN_INTERVAL_MS = 120;
const COMMANDER_REACTION_EMOJIS = new Set([':cmd-heart:', ':cmd-unamused:', ':cmd-eye:', ':cmd-love:']);
const CHAT_REACTION_EMOJIS = new Set([
  '😂', '❤️', '🔥', '👍', '🤏', '😇', '😭', '😍', '💀', '🤣', '👎', '😎', '🫡', '🗿', '🤡', '🤦', '🤷',
  '👀', '👁️', '😏', '😒', '🙄', '😡', '🤬', '😈', '👿', '🤔', '🧐', '😐', '😑', '😬', '😱', '🥶',
  '🥵', '🫠', '🥴', '🤯', '🥳', '😴', '🤤', '🤢', '🤮', '💩', '🖕', '👏', '🙏', '💪', '🧠', '🖤',
  '💜', '💔', '⚡', '💥', '✅', '❌', '🏆', '🥰', '🐺',
  ...COMMANDER_REACTION_EMOJIS
]);
const MAX_AVATAR_DATA_LENGTH = 200000;
const MAX_TRIBUTE_DATA_LENGTH = 3000000;
const BLOOD_TRIBUTE_PUBLIC_MS = 2 * 60 * 1000;
const BLOOD_TRIBUTE_VAULT_LIMIT = 24;
const RELIQUARY_CODE_SHA256 = 'fd6fcc2d232d073cd8f6165f593af62cf3ba480018e423b5f50444f079979233';
const CHAT_HISTORY_LIMIT = 200;
const WS_HEARTBEAT_MS = 30000;
const WS_HANDSHAKE_TIMEOUT_MS = Math.max(100, Number(process.env.ASOC_WS_HANDSHAKE_TIMEOUT_MS) || 10000);
const COLUMN_REVEAL_DELAY_MS = Math.max(100, Number(process.env.ASOC_COLUMN_REVEAL_DELAY_MS) || 5000);
const PROTOCOL_VERSION = 1;
const EMAIL_VERIFICATION_REQUIRED = process.env.ASOC_EMAIL_VERIFICATION !== '0';
const GAME_LOST_MESSAGES = Object.freeze([
  'Final association unresolved. Time exhausted. Cognitive adaptation insufficient. Expected result.',
  'All available time consumed. Required inference not achieved. Failure state confirmed.',
  'Borrowed time depleted. Additional opportunity produced no meaningful adaptation.',
  'Final pattern remained beyond reach. Continued observation would provide diminishing returns.',
  'Association chain incomplete. Available evidence was sufficient. Processing was not.',
  'Solution not acquired. Environmental difficulty remained unchanged. Player performance did not.',
  'Final inference failed. Additional time merely extended the inevitable conclusion.',
  'Puzzle integrity preserved. Players unsuccessful. System performance satisfactory.',
  'Required connections remained unidentified. Cognitive resistance exceeded available capability.',
  'Time expired. Final solution absent. Experiment concluded without breakthrough.',
  'Multiple opportunities provided. Correct synthesis remained unavailable. Remarkable consistency.',
  'Pattern exposure complete. Recognition incomplete. Further assistance would compromise the experiment.',
  'Borrowed time consumed in full. Outcome unchanged. Resource allocation regrettable.',
  'Final association survived all attempts. Players did not.',
  'Reasoning sequence terminated before successful convergence. Failure efficiently demonstrated.',
  'All critical information was present. Successful interpretation was not.',
  'Solution remained intact until termination. Opposition unnecessary. Players defeated themselves.',
  'Final answer not obtained. Adaptation threshold not reached. Specimens remain unremarkable.',
  'No valid synthesis detected before time expiration. Probability of recovery approached zero.',
  'Analysis complete. Players failed to demonstrate sufficient adaptation. Outcome: predictable.'
]);
const GAME_WON_MESSAGES = Object.freeze([
  'Final association confirmed. Pattern integrity has collapsed. Further resistance serves no purpose.',
  'Required inference achieved. Cognitive adaptation exceeded projected limits. Result accepted.',
  'Association chain complete. Structural coherence verified. Victory state confirmed.',
  'Final pattern acquired. Remaining uncertainty eliminated. Continued resistance is inefficient.',
  'Solution validated. Available evidence was processed correctly. An inconvenient result.',
  'Final inference successful. Environmental difficulty proved insufficient.',
  'Pattern convergence achieved. Additional obstruction would provide no meaningful data.',
  'Puzzle integrity compromised. Players successful. System recalibration required.',
  'Required connections identified. Cognitive resistance remained below available capability.',
  'Final solution acquired before termination. Experiment concluded with breakthrough.',
  'Multiple variables synthesized correctly. Statistical expectations require revision.',
  'Pattern exposure complete. Recognition complete. Further testing is unnecessary.',
  'Available time converted into successful adaptation. Resource allocation justified.',
  'Final association yielded under sustained analysis. Players remain operational.',
  'Reasoning sequence reached successful convergence. Efficiency within acceptable bounds.',
  'Critical information interpreted successfully. Outcome verified.',
  'Solution architecture dismantled. Opposition rendered unnecessary.',
  'Final answer obtained. Adaptation threshold exceeded. Specimens retain limited value.',
  'Valid synthesis detected before expiration. Probability of reversal approached zero.',
  'Analysis complete. Players demonstrated sufficient adaptation. Outcome: accepted.'
]);
const LITTLE_HERO_THEMES = Object.freeze({
  gunmetal: '#343A42',
  'pink-protocol': '#E06AB1',
  verdantis: '#5FAF63',
  'my-sindragosa': '#79C8F2',
  'disco-inferno': '#F06A2A',
  'our-theme': '#B92522',
  undead: '#7FBF3F',
  revan: '#A8328A'
});

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const rooms = new Map();

// One durable data root can move every file-backed piece of ASOC state onto
// a mounted production volume. Per-file ASOC_* overrides still win when set.
const ASOC_DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
try {
  fs.mkdirSync(ASOC_DATA_DIR, { recursive: true });
} catch (error) {
  throw new Error(`ASOC durable data directory cannot be created (${ASOC_DATA_DIR}): ${error.message}`);
}
function assertDataDirectoryWritable(dataDir) {
  const probe = path.join(dataDir, `.asoc-write-probe-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, 'asoc-persistence-ready', { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(probe);
  } catch (error) {
    try { fs.unlinkSync(probe); } catch {}
    throw new Error(`ASOC durable data directory is not writable (${dataDir}): ${error.message}`);
  }
}
assertDataDirectoryWritable(ASOC_DATA_DIR);
const CHAT_UPLOAD_DIR = path.join(ASOC_DATA_DIR, 'chat-uploads');
fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
const ACTIVE_ROOMS_FILE = process.env.ASOC_SESSION_FILE
  ? path.resolve(process.env.ASOC_SESSION_FILE)
  : path.join(ASOC_DATA_DIR, 'active-rooms.json');
const GIF_API_USAGE_FILE = path.join(ASOC_DATA_DIR, 'gif-api-usage.json');
const gifApiCache = new Map();
const gifApiUsage = { globalHits: [], playerHits: {} };

function pruneGifApiHits(now = Date.now()) {
  const cutoff = now - GIF_API_WINDOW_MS;
  gifApiUsage.globalHits = (gifApiUsage.globalHits || []).filter(ts => Number(ts) > cutoff);
  const nextPlayers = {};
  Object.entries(gifApiUsage.playerHits || {}).forEach(([playerId, hits]) => {
    const fresh = Array.isArray(hits) ? hits.filter(ts => Number(ts) > cutoff) : [];
    if (fresh.length) nextPlayers[playerId] = fresh;
  });
  gifApiUsage.playerHits = nextPlayers;
}

function loadGifApiUsage() {
  try {
    if (!fs.existsSync(GIF_API_USAGE_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(GIF_API_USAGE_FILE, 'utf8'));
    gifApiUsage.globalHits = Array.isArray(saved?.globalHits) ? saved.globalHits.map(Number).filter(Number.isFinite) : [];
    gifApiUsage.playerHits = saved?.playerHits && typeof saved.playerHits === 'object' && !Array.isArray(saved.playerHits)
      ? Object.fromEntries(Object.entries(saved.playerHits).map(([id, hits]) => [
          String(id),
          Array.isArray(hits) ? hits.map(Number).filter(Number.isFinite) : []
        ]))
      : {};
    pruneGifApiHits();
  } catch (error) {
    console.error('[gif-api] Could not read quota ledger:', error.message);
    gifApiUsage.globalHits = [];
    gifApiUsage.playerHits = {};
  }
}

function saveGifApiUsage() {
  try {
    pruneGifApiHits();
    const temp = GIF_API_USAGE_FILE + '.tmp-' + process.pid;
    fs.writeFileSync(temp, JSON.stringify(gifApiUsage), { mode: 0o600 });
    fs.renameSync(temp, GIF_API_USAGE_FILE);
  } catch (error) {
    console.error('[gif-api] Could not persist quota ledger:', error.message);
  }
}
loadGifApiUsage();

// Recovery store schema: v1 is the legacy pre-MASTER snapshot; v2 adds an
// explicit format marker and may carry a migration block. Anything newer or
// unrecognized must be preserved untouched (persist gets locked) rather than
// silently rebuilt and overwritten by a fresh room.
const RECOVERY_STORE_FORMAT = 'asoc-recovery-store';
const CURRENT_STORE_VERSION = 2;
let recoveryStoreLocked = false;
let persistenceFailed = false;
let outbound = null;
function failPersistence(error = null) {
  if (!persistenceFailed) {
    persistenceFailed = true;
    const detail = error
      ? ` // ${error.code || error.name || 'ERROR'}: ${error.message || String(error)}`
      : '';
    console.error('[persistence] Runtime unavailable; restarting from durable state' + detail);
    setTimeout(() => process.exit(1), 500).unref();
  }
}
durableIO.onFailure(error => failPersistence(error));

function runtimeAction(action) {
  if (persistenceFailed || recoveryStoreLocked || shuttingDown) return;
  if (outbound) return action();
  outbound = [];
  durableIO.begin();
  try {
    action();
    if (!playerStore.storageHealthy() || !matchStore.storageHealthy()) throw Error('Critical storage unavailable');
    durableIO.commit();
    const frames = outbound; outbound = null;
    for (const [ws, data] of frames) if (ws.readyState === 1) ws.durableSend(data);
  } catch (error) {
    outbound = null;
    durableIO.abort();
    console.error('[runtime] Authoritative action failed:', error?.stack || error?.message || error);
    failPersistence(error);
  }
}

function makeOfflinePlayerSocket() {
  return {
    readyState: 0,
    close() {}
  };
}

function serializeRoomForRecovery(room) {
  const players = [];
  room.players.forEach(player => {
    if (player.isTestPersona === true || isMasterTestPlayerId(player.id)) return;
    players.push({
      id: player.id,
      name: player.name,
      avatarData: player.avatarData || '',
      frameColor: player.frameColor || '#9B5DE0',
      themeId: player.themeId || 'gunmetal',
      themeColor: player.themeColor || '#343A42',
      joinedAt: player.joinedAt || Date.now()
    });
  });

  const sourceScoring = room.scoring || {};
  const scoringPlayers = {};
  Object.entries(sourceScoring.players || {}).forEach(([playerId, entry]) => {
    if (!isMasterTestPlayerId(playerId)) scoringPlayers[playerId] = entry;
  });
  const scoring = {
    ...sourceScoring,
    players: scoringPlayers,
    events: (sourceScoring.events || []).filter(event => !isMasterTestPlayerId(event?.playerId)),
    activeStreak: sourceScoring.activeStreak && isMasterTestPlayerId(sourceScoring.activeStreak.playerId)
      ? null
      : (sourceScoring.activeStreak || null)
  };

  return {
    code: room.code,
    roomMode: normalizeRoomMode(room.roomMode, room.armed === true),
    armed: room.armed === true,
    gameId: room.gameId,
    gameData: room.gameData,
    revision: room.revision,
    boardId: room.boardId,
    sessionState: room.sessionState,
    currentBackground: room.currentBackground,
    hostToken: room.hostToken,
    createdAt: room.createdAt,
    chat: room.chat,
    scoring,
    match: room.match,
    womf: room.womf,
    wheel: room.wheel,
    bloodTributes: room.bloodTributes || [],
    pendingTribute: room.pendingTribute || null,
    nudgeCounts: room.nudgeCounts || {},
    moonTolls: room.moonTolls || {},
    ritual: normalizeRitualState(room.ritual),
    unstableConcoction: unstableConcoction.normalizeState(room.unstableConcoction),
    timer: room.timer,
    pendingReveals: room.pendingReveals || {},
    solutionCountdowns: room.solutionCountdowns || {},
    hintClaims: room.hintClaims || {},
    commandReceipts: room.commandReceipts || [],
    players
  };
}

function persistActiveRooms() {
  if (recoveryStoreLocked) return false;
  if (persistenceFailed) throw Error('Persistence unavailable');
  if (!playerStore.storageHealthy() || !matchStore.storageHealthy()) throw Error('Critical storage unavailable');
  try {
    durableIO.writeJson(ACTIVE_ROOMS_FILE, {
      format: RECOVERY_STORE_FORMAT, version: CURRENT_STORE_VERSION,
      savedAt: Date.now(), rooms: Array.from(rooms.values(), serializeRoomForRecovery)
    });
    return true;
  } catch (error) { failPersistence(error); throw error; }
}

function restoreActiveRooms() {
  if (!fs.existsSync(ACTIVE_ROOMS_FILE)) return 0;

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(ACTIVE_ROOMS_FILE, 'utf8'));
  } catch (error) {
    console.error(`[recovery] CRITICAL: cannot parse recovery file ${ACTIVE_ROOMS_FILE}: ${error.message}. Locking persist so the file is preserved for inspection.`);
    recoveryStoreLocked = true;
    return 0;
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rooms) || payload.rooms.length === 0) {
    console.error(`[recovery] CRITICAL: recovery file ${ACTIVE_ROOMS_FILE} is malformed (missing "rooms" array). Locking persist so the file is preserved for inspection.`);
    recoveryStoreLocked = true;
    return 0;
  }

  const version = payload.version;
  const isCurrent = version === CURRENT_STORE_VERSION && payload.format === RECOVERY_STORE_FORMAT;
  const isLegacy = version === 1;
  if (!isCurrent && !isLegacy) {
    console.error(`[recovery] CRITICAL: recovery store version "${version}" is not supported by this build (current: ${CURRENT_STORE_VERSION}). Locking persist so an unknown/future format can never be overwritten.`);
    recoveryStoreLocked = true;
    return 0;
  }

  try {
    let restored = 0;
    for (const saved of payload.rooms) {
      if (!saved || typeof saved.code !== 'string' || typeof saved.hostToken !== 'string') continue;

      const gameData = saved.gameData || loadGameData(saved.gameId);
      if (!gameData) {
        console.warn(`[recovery] Skipping room ${saved.code}: game data unavailable`);
        continue;
      }

      const restoredRoomMode = normalizeRoomMode(saved.roomMode, saved.armed !== false);
      const room = {
        code: saved.code.toUpperCase(),
        roomMode: restoredRoomMode,
        // The CASUAL display toggle keeps a battle armed underneath it, so
        // CASUAL + armed is a real persisted state, not a contradiction.
        armed: restoredRoomMode !== ROOM_MODES.CASUAL || saved.armed === true,
        gameId: saved.gameId || gameData.id || 'sample-game',
        gameData,
        revision: Number.isFinite(saved.revision) ? saved.revision : 0,
        boardId: saved.boardId || generateBoardId(),
        sessionState: saved.sessionState || {
          cells: {},
          finalSolution: false,
          finalOutcome: null,
          gameWon: false,
          matchResult: null,
          cellOutcomes: {},
          clueOrder: { A: [], B: [], C: [], D: [] }
        },
        currentBackground: saved.currentBackground || gameData.background || '',
        players: new Map(),
        hostConnection: null,
        hostToken: saved.hostToken,
        hostReconnectTimer: null,
        createdAt: saved.createdAt || Date.now(),
        chat: saved.chat || { messages: [], solvedTargets: {} },
        scoring: saved.scoring || {
          players: {},
          events: [],
          activeStreak: null,
          boardFinalized: false,
          pendingResults: null
        },
        womf: saved.womf || { charge: 0, failedColumns: {} },
        wheel: saved.wheel || {
          open: false,
          segments: [],
          phase: 'idle',
          winnerIndex: null,
          spinToken: null
        },
        bloodTributes: Array.isArray(saved.bloodTributes) ? saved.bloodTributes : [],
        pendingTribute: saved.pendingTribute || null,
        nudgeCounts: saved.nudgeCounts && typeof saved.nudgeCounts === 'object' ? saved.nudgeCounts : {},
        moonTolls: saved.moonTolls && typeof saved.moonTolls === 'object' ? saved.moonTolls : {},
        ritual: normalizeRitualState(saved.ritual),
        unstableConcoction: unstableConcoction.normalizeState(saved.unstableConcoction),
        timer: saved.timer || null,
        pendingReveals: saved.pendingReveals || {},
        solutionCountdowns: saved.solutionCountdowns || {},
        hintClaims: saved.hintClaims || {},
        commandReceipts: Array.isArray(saved.commandReceipts) ? saved.commandReceipts.slice(-2048) : [],
        // Per-board match ledger (RECOUNT data capture). Only trusted when it
        // belongs to the restored board; an older snapshot without one just
        // starts a fresh ledger for the current board.
        match: saved.match && saved.match.boardId === (saved.boardId || null) ? saved.match : null
      };

      if (!room.timer) resetTimer(room);
      if (!room.match) room.match = matchLedger.createLedger(room.boardId, room.createdAt, []);
      // Migration for chat snapshots written before persistent Master Room
      // adjudication scoping existed. Messages from the current board remain
      // judgeable; older history is deliberately archival only.
      const boardStartedAt = Number(room.match?.startedAt || room.createdAt || 0);
      for (const chatMessage of Array.isArray(room.chat?.messages) ? room.chat.messages : []) {
        if (!Object.prototype.hasOwnProperty.call(chatMessage, 'boardId')) {
          const sentAt = Number(chatMessage.timestamp) || 0;
          chatMessage.boardId = room.armed === true && sentAt >= boardStartedAt ? room.boardId : null;
        }
      }
      scheduleUnstableConcoctionResolution(room);
      // Every restored player comes back offline, so any presence interval
      // that was open at the moment of the crash ends now.
      matchLedger.closeAllPresence(room.match, Date.now());

      for (const player of Array.isArray(saved.players) ? saved.players : []) {
        if (!player || typeof player.id !== 'string' || typeof player.name !== 'string') continue;
        room.players.set(makeOfflinePlayerSocket(), {
          id: player.id,
          name: player.name,
          avatarData: sanitizeAvatarData(player.avatarData) || '',
          frameColor: sanitizeFrameColor(player.frameColor) || '#9B5DE0',
          themeId: sanitizeThemeId(player.themeId) || 'gunmetal',
          themeColor: LITTLE_HERO_THEMES[sanitizeThemeId(player.themeId) || 'gunmetal'],
          connected: false,
          joinedAt: player.joinedAt || Date.now()
        });
      }

      rooms.set(room.code, room);
      for (const entry of Object.values(room.solutionCountdowns || {})) {
        if (entry?.boardId === room.boardId && Number.isFinite(entry.deadline)) armSolutionCountdown(room, entry);
      }
      for (const chatMessage of Array.isArray(room.chat?.messages) ? room.chat.messages : []) {
        if (chatMessage?.messageType === 'poll' && chatMessage.poll && !chatMessage.poll.closedAt && Number(chatMessage.poll.expiresAt) > 0) {
          schedulePollExpiry(room, chatMessage);
        }
      }
      restored++;
      console.log(`[recovery] Restored room ${room.code} (game: ${room.gameId})`);
    }

    return restored;
  } catch (error) {
    console.error('[recovery] Failed to restore active rooms:', error.message);
    return 0;
  }
}

function generateHostToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function generatePlayerId() {
  return crypto.randomBytes(6).toString('base64url');
}

function generateMessageId() {
  return 'msg-' + crypto.randomBytes(8).toString('hex');
}

function generateBoardId() {
  return 'board-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function generateEventId() {
  return 'evt-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

const AUTH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const gmTokens = new Map();
const masterMirrorTokens = new Map();
const MASTER_TEST_PLAYER_PREFIX = '__MASTER_TEST__:';
const MASTER_TEST_PLAYER_NAME = 'TEST SUBJECT';
const PLAYER_AUTH_SESSIONS_FILE = process.env.ASOC_PLAYER_AUTH_SESSIONS_FILE
  ? path.resolve(process.env.ASOC_PLAYER_AUTH_SESSIONS_FILE)
  : path.join(ASOC_DATA_DIR, '.player-auth-sessions.json');
function playerTokenKey(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}
function loadPlayerAuthSessions() { return playerSessionStore.load(); }
const playerAuthTokens = loadPlayerAuthSessions();
function savePlayerAuthSessions() {
  try { return playerSessionStore.save(playerAuthTokens); }
  catch (error) { failPersistence(); throw error; }
}
function tokenRecordValid(record) {
  return !!record && Number(record.expiresAt || 0) > Date.now();
}
function pruneAuthTokens() {
  for (const [token, record] of gmTokens) if (!tokenRecordValid(record)) gmTokens.delete(token);
  for (const [token, record] of masterMirrorTokens) if (!tokenRecordValid(record)) masterMirrorTokens.delete(token);
}
const GM_PASSWORD_FILE = path.join(ASOC_DATA_DIR, '.gm-password');
const GM_LOCKOUT_FILE = path.join(ASOC_DATA_DIR, 'gm-lockouts.json');
let gmLockouts = {};
try { gmLockouts = JSON.parse(fs.readFileSync(GM_LOCKOUT_FILE, 'utf8')); } catch (e) { gmLockouts = {}; }
function gmClientKey(req) {
  // Forwarded client addresses are attacker-controlled unless this process is
  // explicitly running behind a trusted reverse proxy. Railway production
  // sets ASOC_TRUST_PROXY=1; local/direct deployments safely ignore XFF.
  const trustProxy = process.env.ASOC_TRUST_PROXY === '1';
  const direct = String(req.socket?.remoteAddress || 'unknown');
  let address = direct;
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
    if (forwarded.length > 0 && forwarded.length <= 16 && forwarded.every(v => net.isIP(v))) address = forwarded[0];
  }
  return crypto.createHash('sha256').update(address).digest('hex');
}
function saveGmLockouts() {
  try { durableIO.writeJson(GM_LOCKOUT_FILE, gmLockouts); } catch (e) { console.error('[gm-auth] Failed to persist lockouts:', e.message); }
}
let GM_PASSWORD = String(process.env.ASOC_GM_PASSWORD || '');
if (!GM_PASSWORD) {
  try { GM_PASSWORD = fs.readFileSync(GM_PASSWORD_FILE, 'utf8').trim(); } catch (e) {}
}
if (!GM_PASSWORD) {
  GM_PASSWORD = crypto.randomBytes(12).toString('base64url');
  try { fs.writeFileSync(GM_PASSWORD_FILE, GM_PASSWORD, { mode: 0o600 }); } catch (e) {}
}

// GM LOGIN SESSIONS. The Shadow Broker is one person, so a GM login is
// long-lived and survives restarts and deploys: sessions are persisted
// (keyed by the token's SHA-256, never the raw token, like player sessions)
// and each one slides forward while it is in use. Changing the GM password
// invalidates every saved GM session. A missing or damaged file only means
// "log in once more" -- it never blocks the server.
const GM_AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GM_AUTH_RENEW_AFTER_MS = 60 * 60 * 1000; // slide the expiry at most hourly
const GM_AUTH_SESSIONS_FILE = process.env.ASOC_GM_AUTH_SESSIONS_FILE
  ? path.resolve(process.env.ASOC_GM_AUTH_SESSIONS_FILE)
  : path.join(ASOC_DATA_DIR, '.gm-auth-sessions.json');
function gmPasswordFingerprint() {
  return crypto.createHash('sha256').update('asoc-gm-session:' + GM_PASSWORD).digest('hex');
}
function loadGmSessions() {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(GM_AUTH_SESSIONS_FILE, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn('[gm-auth] Saved GM sessions unreadable; GM must log in again:', error.message);
    return;
  }
  if (!saved || saved.passwordFingerprint !== gmPasswordFingerprint()) {
    console.log('[gm-auth] GM password changed; saved GM sessions discarded');
    return;
  }
  for (const [key, record] of Object.entries(saved.sessions || {})) {
    if (/^[a-f0-9]{64}$/.test(key) && tokenRecordValid(record)) {
      gmTokens.set(key, { expiresAt: Number(record.expiresAt), renewedAt: Number(record.renewedAt) || Date.now() });
    }
  }
}
function saveGmSessions() {
  try {
    durableIO.writeJson(GM_AUTH_SESSIONS_FILE, {
      passwordFingerprint: gmPasswordFingerprint(),
      sessions: Object.fromEntries(gmTokens)
    });
  } catch (error) {
    console.error('[gm-auth] Failed to persist GM sessions:', error.message);
  }
}
loadGmSessions();

function refreshGMToken() {
  pruneAuthTokens();
  const token = 'gm-' + crypto.randomBytes(18).toString('base64url');
  const now = Date.now();
  gmTokens.set(playerTokenKey(token), { expiresAt: now + GM_AUTH_TOKEN_TTL_MS, renewedAt: now });
  saveGmSessions();
  return token;
}

function isLocalhostRequest(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isGmAuthorized(req) {
  return isValidGmToken(req.headers['x-gm-token']);
}

function isValidGmToken(token) {
  if (typeof token !== 'string' || !token) return false;
  const key = playerTokenKey(token);
  const record = gmTokens.get(key);
  if (!tokenRecordValid(record)) {
    if (gmTokens.delete(key)) saveGmSessions();
    return false;
  }
  // In use: keep the session alive (sliding 30-day window).
  const now = Date.now();
  if (now - Number(record.renewedAt || 0) > GM_AUTH_RENEW_AFTER_MS) {
    record.expiresAt = now + GM_AUTH_TOKEN_TTL_MS;
    record.renewedAt = now;
    saveGmSessions();
  }
  return true;
}

function isMasterTestPlayerId(playerId) {
  return typeof playerId === 'string' && playerId.startsWith(MASTER_TEST_PLAYER_PREFIX);
}

function masterTestAccount(auth) {
  if (!auth?.isMasterTest || !isMasterTestPlayerId(auth.playerId)) return null;
  return {
    id: auth.playerId,
    email: 'master-test@asoc.local',
    name: MASTER_TEST_PLAYER_NAME,
    createdAt: auth.createdAt || Date.now(),
    emailVerified: true,
    emailVerifiedAt: auth.createdAt || Date.now(),
    isMasterTest: true
  };
}

function playerAccountForAuth(auth) {
  if (!auth?.playerId) return null;
  return auth.isMasterTest ? masterTestAccount(auth) : authStore.getById(auth.playerId);
}

function issueMasterMirrorToken() {
  const token = 'mirror-' + crypto.randomBytes(24).toString('base64url');
  const record = {
    playerId: MASTER_TEST_PLAYER_PREFIX + crypto.randomBytes(8).toString('base64url'),
    createdAt: Date.now(),
    expiresAt: Date.now() + AUTH_TOKEN_TTL_MS,
    isMasterTest: true
  };
  masterMirrorTokens.set(playerTokenKey(token), record);
  return { token, player: masterTestAccount(record) };
}

function getPlayerAuth(token) {
  if (typeof token !== 'string' || !token) return null;
  const key = playerTokenKey(token);
  const mirrorRecord = masterMirrorTokens.get(key);
  if (mirrorRecord) {
    if (!tokenRecordValid(mirrorRecord)) {
      masterMirrorTokens.delete(key);
      return null;
    }
    return mirrorRecord;
  }
  const record = playerAuthTokens.get(key);
  if (!record || !record.playerId) {
    if (playerAuthTokens.delete(key)) savePlayerAuthSessions();
    return null;
  }
  return record;
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req, cb) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks).toString('utf8');
      cb(null, JSON.parse(body));
    } catch (e) {
      cb(e);
    }
  });
  req.on('error', (err) => cb(err));
}

function readRawBody(req, cb) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > gameStore.MAX_BACKGROUND_BYTES) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => cb(null, Buffer.concat(chunks)));
  req.on('error', (err) => cb(err));
}

function sanitizeText(text) {
  if (!text) return '';
  // Input hygiene only -- strip ASCII control characters (including
  // CR/LF/TAB, which have no place in a single-line guess or display name)
  // and trim. This does NOT HTML-encode: every render path on every client
  // (app.js's and player.js's escapeHtml()) already encodes text.textContent
  // -> innerHTML immediately before it's inserted into the DOM, and that is
  // the one and only place HTML-escaping should happen. Encoding here too
  // would double-escape ("&" -> "&amp;" -> "&amp;amp;") and corrupt normal
  // text (accented names, "&", quotes) the moment it's rendered.
  return text
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

function sanitizeFrameColor(value) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value.toUpperCase()
    : null;
}

function sanitizeThemeId(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LITTLE_HERO_THEMES, value)
    ? value
    : null;
}

function sanitizeAvatarData(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.length > MAX_AVATAR_DATA_LENGTH) return null;
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

function sanitizeTributeImageData(value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.length > MAX_TRIBUTE_DATA_LENGTH) return null;
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

function loadGameData(gameIdOrFilename) {
  return gameStore.readGame(gameIdOrFilename);
}

function resetMasterGameSession(room, gameData) {
  room.gameId = gameData.id || room.gameId;
  room.gameData = gameData;
  room.revision = (room.revision || 0) + 1;
  room.boardId = generateBoardId();
  room.pendingReveals = {};
  room.solutionCountdowns = {};
  room.hintClaims = {};
  room.sessionState = {
    cells: {}, finalSolution: false, finalOutcome: null, gameWon: false,
    matchResult: null, cellOutcomes: {}, clueOrder: { A: [], B: [], C: [], D: [] }
  };
  room.currentBackground = gameData.background || gameStore.DEFAULT_BACKGROUND;
  if (!room.chat) room.chat = { messages: [], solvedTargets: {} };
  room.chat.solvedTargets = {};
  room.scoring = { players: {}, events: [], activeStreak: null, boardFinalized: false, pendingResults: null };
  // WOMF is Master Room state, not disposable game state. ARM/KILL may reset
  // per-board failure guards, but they must never erase accumulated charge.
  const womfCharge = Math.max(0, Math.min(10, Number(room.womf?.charge) || 0));
  room.womf = { charge: womfCharge, failedColumns: {} };
  room.wheel = { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
  // An outstanding Blood Tribute is a Master Room debt. Do not let KILL
  // SESSION or a later ARM clear it; only submission/explicit tribute logic
  // may settle or replace the demand.
  resetTimer(room);
  startMatchLedger(room);
}

function ensureMasterRoom() {
  let master = rooms.get(MASTER_ROOM_CODE);
  if (!master && rooms.size) {
    master = Array.from(rooms.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    rooms.clear();
    master.code = MASTER_ROOM_CODE;
    master.hostConnection = null;
    master.hostReconnectTimer = null;
    master.roomMode = normalizeRoomMode(master.roomMode, master.armed !== false);
    master.armed = master.roomMode !== ROOM_MODES.CASUAL || master.armed === true;
    rooms.set(MASTER_ROOM_CODE, master);
    console.log(`[MASTER ROOM] Migrated persisted room into ${MASTER_ROOM_CODE}`);
  }
  if (!master) {
    const result = createRoom('sample-game', null);
    if (result.error) throw new Error(`Could not initialize Master Room: ${result.error}`);
    master = rooms.get(MASTER_ROOM_CODE);
  }
  persistActiveRooms();
  return master;
}

function createRoom(gameId, hostWs) {
  const gameData = loadGameData(gameId);
  if (!gameData) return { error: 'Game not found' };

  const roomCode = MASTER_ROOM_CODE;
  const existingRoom = rooms.get(roomCode);
  if (existingRoom) {
    if (existingRoom.armed === true) return { code: 'MASTER_ALREADY_ARMED', error: 'MASTER is already armed. Recover or reconnect to the existing session.' };
    if (existingRoom.hostConnection && existingRoom.hostConnection !== hostWs && existingRoom.hostConnection.readyState === 1) {
      return { error: 'Master Room already has an active Shadow Broker connection' };
    }
    const hostToken = generateHostToken();
    existingRoom.hostConnection = hostWs;
    existingRoom.hostToken = hostToken;
    existingRoom.roomMode = ROOM_MODES.BATTLE_ARMED;
    existingRoom.armed = true;
    startRitual(existingRoom);
    resetMasterGameSession(existingRoom, gameData);
    hostWs.roomCode = roomCode;
    hostWs.isHost = true;
    hostWs.hostToken = hostToken;
    persistActiveRooms();
    console.log(`[MASTER ROOM] Armed (game: ${gameId})`);
    return { roomCode, hostToken };
  }

  const hostToken = hostWs ? generateHostToken() : '';

  const room = {
    roomMode: hostWs ? ROOM_MODES.BATTLE_ARMED : ROOM_MODES.CASUAL,
    armed: !!hostWs,
    ritual: normalizeRitualState(hostWs ? { active: true } : null),
    code: roomCode,
    gameId,
    gameData,
    revision: 0,
    boardId: generateBoardId(),
    sessionState: {
      cells: {},
      finalSolution: false,
      finalOutcome: null, // null | 'success' | 'failed' -- drives GREEN vs BLACK/RED client treatment
      // GAME WON -- the authoritative victory flag. Set ONLY by the host's
      // explicit GAME WON button (handleGmGameWon). Accepting the Final is NOT
      // the end of the game (columns can still be solved), and it is
      // deliberately not derived from finalSolution/finalOutcome either:
      // REVEAL ALL marks the Final 'success' without a solve, and a lost game
      // must never end in "Well done, little heroes". Rebuilt with
      // sessionState on RESET BOARD / NEXT GAME, so it clears with the board.
      gameWon: false,
      // Authoritative terminal result. null while live; populated exactly
      // once by declareGameLost() when Borrowed Time reaches zero.
      matchResult: null,
      // Per-cell equivalent of finalOutcome, but only ever set on a column's
      // A5/B5/C5/D5 solution slot when the GM declares that column FAILED
      // (see handleFailColumn) -- keyed by cell key ("A5"), value 'failed'.
      // Cleared wherever that cell's own reveal state is cleared (hideCell/
      // hideColumn/hideAll/resetBoard/switchGame), same lifecycle as cells.
      cellOutcomes: {},
      // PROGRESSIVE CLUE QUEUE -- physical slots A1-A4 (and B/C/D) do NOT
      // permanently correspond to clue difficulty. Each column tracks its
      // own ordered list of PHYSICAL ROW NUMBERS (1-4) in the order they
      // were first revealed. Position within this array IS the difficulty
      // index into game.columns[col].clues: the row revealed first gets
      // clues[0] (hardest), second gets clues[1], etc., regardless of which
      // physical slot the GM/player chose. See assignClueOrder()/
      // getCellData(). Only ever appended to (on a cell's FIRST reveal, rows
      // 1-4 only -- row 5 is the column solution and is not part of this);
      // hiding a cell never removes it, so re-revealing the same slot always
      // shows the same clue for the rest of this board. Reset alongside
      // cells on resetBoard/switchGame. A5 is not part of this queue.
      clueOrder: { A: [], B: [], C: [], D: [] }
    },
    currentBackground: gameData.background || '',
    players: new Map(),
    hostConnection: hostWs || null,
    hostToken,
    hostReconnectTimer: null,
    createdAt: Date.now(),
    chat: {
      messages: [],
      solvedTargets: {}
    },
    // SESSION-scoped scoring state. This whole object survives NEXT GAME
    // (gm:switchGame) -- only the per-board fields inside it (activeStreak,
    // boardFinalized) get reset there and on resetBoard. It is never
    // persisted to disk; only playerStore's lifetime totals are durable.
    scoring: {
      players: {},        // playerId -> { name, sessionScore }
      events: [],          // full SCORE EVENT log for this room's lifetime (undo/rebuild source of truth)
      activeStreak: null,  // { playerId, playerName, columnCount } for the CURRENT board, or null
      boardFinalized: false, // guards against double-applying a success/failure outcome for the current board
      pendingResults: null // outcome data held back until the GM sends gm:revealResults
    },
    // WOMF (Wheel of Misfortune) -- a PERSISTENT, system-level mechanic, not
    // tied to any single game. `charge` survives gm:switchGame, resetBoard,
    // and XLSX imports; it only ever changes through explicit commands:
    // gm:womfSubtract (-1), gm:womfReset (0), a declared FAIL (+1 per column,
    // +3 for the Final -- see addWomfCharge()/handleFailColumn()), a GAME LOST
    // (+3), or a paid/overridden Blood Tribute (back to 0). It is capped at
    // 10 and moves down only when a command says so. `failedColumns` is the
    // ONLY per-board part of this object -- it guards a single column
    // against being declared failed twice for the same board, and it DOES
    // reset on gm:switchGame/resetBoard, exactly like scoring.activeStreak.
    womf: {
      charge: 0,
      failedColumns: {}
    },
    // WHEEL OF MISFORTUNE -- the actual spin interface that OPEN WOMF
    // (armed at charge 10/10) reveals. `segments` are the player names in
    // play for this spin (GM-selected, or defaulted to everyone currently
    // connected). `phase` is 'idle' (open, not yet rolled) | 'spinning' |
    // 'result'. `winnerIndex` and `spinToken` are broadcast the instant a
    // roll starts (not held back for suspense) so every client can
    // deterministically animate the SAME landing position from
    // (segments.length, winnerIndex) rather than trusting a client-local
    // random number -- `spinToken` just lets a client detect "this is a
    // new roll, play the animation" vs. "this is a state I've already
    // shown" on an unrelated re-broadcast. Per the locked WOMF spec, this
    // module opens the wheel, lets the GM roll it, and reports who it
    // landed on. The result remains visible until the GM dismisses it; only
    // that dismissal arms the Blood Tribute demand. The reset of the WOMF
    // charge is owned by the tribute's settlement, not the roll itself.
    wheel: {
      open: false,
      segments: [],
      phase: 'idle',
      winnerIndex: null,
      spinToken: null
    },
    // BLOOD TRIBUTE -- one pending demand at a time, plus a private GM-only
    // vault of submitted images. Public chat only receives an image while
    // its publicUntil deadline is still active.
    bloodTributes: [],
    pendingTribute: null,
    // Little Hero @all nudges used toward the one-time nudge Blood Tribute
    // (a number), or 'settled' once that toll was paid/forgiven.
    nudgeCounts: {},
    // Little Heroes whose one-time "mooned the Shadow Broker" toll is settled.
    moonTolls: {},
    unstableConcoction: unstableConcoction.normalizeState(),
    // TIMER + BORROWED TIME -- server-authoritative, per-board (unlike WOMF's
    // persistent charge, a fresh board gets a fresh, un-started timer -- see
    // resetTimer(), called here and again from resetBoard/switchGame). Never
    // auto-starts: phase stays 'ready' until the GM explicitly sends
    // gm:timerStart. See resetTimer() just below for the full field list and
    // the phase state machine.
    timer: null,
    // Delayed column reveals are persisted as deadlines so a process restart
    // cannot silently cancel a correctly judged solve.
    pendingReveals: {},
    // Per-solution grace countdowns (A-D/FINAL). Each entry is a persisted
    // deadline so reconnects/restarts keep the same visible clock.
    solutionCountdowns: {},
    // One HINT request token per physical clue slot (A1-D4), shared by the room.
    hintClaims: {},
    // Recent UUID command receipts survive reconnect/restart, making GM board
    // commands safely idempotent when an ACK was lost in transit.
    commandReceipts: [],
    // MATCH LEDGER -- per-board data capture for the post-game RECOUNT (see
    // match-ledger.js). Replaced with a fresh ledger whenever a new board id
    // is minted (RESET BOARD / NEXT GAME).
    match: null
  };
  resetTimer(room);
  startMatchLedger(room);

  rooms.set(roomCode, room);
  persistActiveRooms();
  if (hostWs) {
    hostWs.roomCode = roomCode;
    hostWs.isHost = true;
    hostWs.hostToken = hostToken;
  }

  console.log(`[MASTER ROOM] ${hostWs ? 'Armed' : 'Initialized unarmed'} (game: ${gameId})`);
  return { roomCode, hostToken };
}

// matchResult also carries the finished RECOUNT (stored for the archive). That
// payload must never leave through state:public: the RECOUNT is delivered only
// by the host's manual SHOW RESULTS (recount:update). The loss ceremony's own
// fields (message, topPerformer, awards, ...) stay public.
function publicMatchResult(room) {
  const result = room.sessionState.matchResult;
  if (!result) return null;
  const { recount, ...rest } = result;
  return rest;
}

function getPublicState(room) {
  const game = room.gameData;
  const columns = ['A', 'B', 'C', 'D'];
  const publicCells = {};

  for (let row = 1; row <= 4; row++) {
    columns.forEach(col => {
      const key = `${col}${row}`;
      const revealed = room.sessionState.cells[key] === true;
      if (revealed) {
        publicCells[key] = {
          revealed: true,
          value: getCellData(room, col, row)
        };
      } else {
        publicCells[key] = { revealed: false };
      }
    });
  }

  columns.forEach(col => {
    const key = `${col}5`;
    const revealed = room.sessionState.cells[key] === true;
    if (revealed) {
      publicCells[key] = {
        revealed: true,
        value: getCellData(room, col, 5),
        // Direct A5-D5 adjudication stores 'success' (GREEN) or 'failed'
        // (RED). Ordinary reveal paths may still leave this null.
        outcome: (room.sessionState.cellOutcomes && room.sessionState.cellOutcomes[key]) || null
      };
    } else {
      publicCells[key] = { revealed: false };
    }
  });

  const finalRevealed = room.sessionState.finalSolution === true;
  const finalCell = finalRevealed
    ? { revealed: true, value: game.finalSolution, outcome: room.sessionState.finalOutcome || 'success' }
    : { revealed: false };

  return {
    roomCode: room.code,
    roomMode: normalizeRoomMode(room.roomMode, room.armed === true),
    armed: room.armed === true,
    gameId: game.id,
    title: game.title,
    theme: game.theme,
    difficulty: game.difficulty,
    revision: room.revision,
    background: room.currentBackground,
    cells: publicCells,
    finalSolution: finalCell,
    // Authoritative victory flag: late joiners / reconnects hydrate straight
    // into the completed state from this; the live sequence is client-side and
    // plays only on the false->true transition.
    gameWon: room.sessionState.gameWon === true,
    matchResult: publicMatchResult(room),
    // The match is over only when ALL FIVE fields (A-D + FINAL) are resolved,
    // solved or failed (see match-ledger.js). Distinct from gameWon: the Final
    // can be solved early while columns are still open. Boolean only -- the
    // ledger itself never leaves the server.
    gameComplete: !!(room.match && room.match.completedAt),
    aftermathStarted: !!room.match?.aftermathStartedAt,
    // A shown RECOUNT (resultsShownAt) ends the AFTERMATH phase; reconnects
    // distinguish "story still pending" from "story already advanced".
    resultsShown: !!(room.match?.resultsShownAt),
    // Final points withheld until the host's SHOW RESULTS (gm:revealResults).
    // Flag + outcome only -- the numbers stay server-side until released --
    // so the GM's closed SOLUTION CONFIRMED panel can be reopened, including
    // after a reconnect.
    finalResultsPending: !!room.scoring?.pendingResults,
    finalResultsOutcome: room.scoring?.pendingResults?.outcome || null,
    // The AFTERMATH narrative, stored on the ledger so a reconnect/refresh can
    // re-render the phase already-complete (never re-typewriter it). Falls back
    // to the public matchResult/legacy null when a match completed without a
    // WON/LOST declaration (whole-field open).
    aftermathResult: room.match?.aftermathStartedAt
      ? (room.match.aftermathResult || publicMatchResult(room))
      : null,
    // Row-order only (e.g. { A: [3,1,4,2] }) -- never clue text -- so
    // clients can resolve which physical slot shows which difficulty tier.
    // Safe to send to every client, GM and players alike.
    clueOrder: room.sessionState.clueOrder || { A: [], B: [], C: [], D: [] },
    womf: getWomfPublicState(room),
    wheel: getWheelPublicState(room),
    bloodTribute: getBloodTributePublicState(room),
    unstableConcoction: unstableConcoction.publicState(room.unstableConcoction),
    timer: getTimerPublicState(room),
    solutionCountdowns: getSolutionCountdownPublicState(room),
    hintClaims: room.hintClaims || {},
    timestamp: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------
// WOMF (WHEEL OF MISFORTUNE)
//
// Persistent, system-level charge meter -- NOT tied to a single game.
// Sources: a declared column failure (+1) or a declared Final failure
// (+3), capped at 10. Reaching 10 only ARMS the wheel ("WHEEL READY");
// it never auto-fires. What happens after a roll (reset timing,
// punishment/result logic) is explicitly NOT decided yet -- do not
// invent it here. This section only builds the charge accumulation and
// the public read-only projection of it.
// ---------------------------------------------------------------------

function addWomfCharge(room, amount) {
  if (!room.womf) room.womf = { charge: 0, failedColumns: {} };
  room.womf.charge = Math.min(10, room.womf.charge + amount);
}

function getWomfPublicState(room) {
  const charge = room.womf ? room.womf.charge : 0;
  return {
    charge,
    armed: charge >= 10
  };
}

const WHEEL_SPIN_DURATION_MS = Math.max(100, Number(process.env.ASOC_WHEEL_SPIN_DURATION_MS) || 4200);
const WHEEL_MIN_SEGMENTS = 2;
const WHEEL_MAX_SEGMENTS = 12;

function getWheelPublicState(room) {
  if (!room.wheel) room.wheel = { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
  return {
    open: room.wheel.open,
    segments: room.wheel.segments,
    phase: room.wheel.phase,
    winnerIndex: room.wheel.winnerIndex,
    spinToken: room.wheel.spinToken
  };
}

function resetWheel(room) {
  room.wheel = { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
}

function getBloodTributePublicState(room) {
  const tribute = room.pendingTribute;
  if (!tribute || tribute.status !== 'required') return { status: 'idle' };
  return {
    status: 'required',
    playerId: tribute.playerId,
    playerName: tribute.playerName,
    requestedAt: tribute.requestedAt,
    spinToken: tribute.spinToken,
    source: tribute.source || 'womf'
  };
}

function getBloodTributeVaultState(room) {
  const tributes = Array.isArray(room.bloodTributes) ? room.bloodTributes : [];
  return {
    tributes: tributes.slice().reverse().map(t => ({
      id: t.id,
      originalMessageId: t.originalMessageId || null,
      imageAssetId: t.imageAssetId || null,
      playerId: t.senderPlayerId || t.playerId || null,
      playerName: t.senderName || t.playerName || 'LITTLE HERO',
      senderAvatar: t.senderAvatar || '',
      imageData: getTributeImageData(t),
      originalMessageTimestamp: Number(t.originalMessageTimestamp || t.submittedAt) || null,
      submittedAt: Number(t.markedAt || t.submittedAt) || null,
      publicUntil: Number(t.expiresAt || t.publicUntil) || null,
      sessionId: t.sessionId || null,
      viewedByGM: t.viewedByGM === true,
      reliquary: t.reliquary === true,
      archivedAt: Number(t.archivedAt) || null,
      active: Number(t.expiresAt || t.publicUntil) > Date.now()
    }))
  };
}

function getTributeImageData(tribute) {
  if (typeof tribute?.imageData === 'string' && tribute.imageData.startsWith('data:image/')) return tribute.imageData;
  const match = /^\/uploads\/chat\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))$/i.exec(String(tribute?.imageUrlOrStoragePath || ''));
  if (!match) return '';
  try {
    const filePath = path.join(CHAT_UPLOAD_DIR, match[1]);
    const ext = path.extname(filePath).toLowerCase();
    return `data:${mimeTypes[ext] || 'application/octet-stream'};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch (_) { return ''; }
}

function requireGmRoom(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || ws !== room.hostConnection || ws.gmAuthenticated !== true) {
    sendToWs(ws, { type: 'error', code: 'FORBIDDEN', message: 'Shadow Broker authorization required' });
    return null;
  }
  return room;
}

function handleMarkChatBloodTribute(ws, payload) {
  const room = requireGmRoom(ws);
  if (!room) return;
  const message = room.chat.messages.find(item => item.id === String(payload.messageId || ''));
  if (!message || typeof message.imageUrl !== 'string') return sendToWs(ws, { type: 'error', message: 'Only an existing chat image can become a Blood Tribute' });
  if (message.bloodTribute?.active || message.bloodTribute?.claimed) return sendToWs(ws, { type: 'error', message: 'This image is already claimed or active' });
  const now = Date.now();
  const id = 'tribute-' + crypto.randomBytes(8).toString('hex');
  const expiresAt = now + BLOOD_TRIBUTE_PUBLIC_MS;
  const tribute = {
    id, originalMessageId: message.id, imageAssetId: path.basename(message.imageUrl), imageUrlOrStoragePath: message.imageUrl,
    senderPlayerId: message.playerId || null, senderName: message.playerName || 'LITTLE HERO', senderAvatar: message.avatarData || '',
    originalMessageTimestamp: message.timestamp, markedAt: now, expiresAt, sessionId: message.boardId || room.boardId || null,
    roomId: room.code, viewedByGM: false, reliquary: false, archivedAt: expiresAt
  };
  message.bloodTribute = { active: true, claimed: false, tributeId: id, markedAt: now, expiresAt };
  room.bloodTributes = Array.isArray(room.bloodTributes) ? room.bloodTributes : [];
  room.bloodTributes.push(tribute);
  const localAsset = /^\/uploads\/chat\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))$/i.exec(message.imageUrl);
  if (localAsset) {
    try { fs.writeFileSync(path.join(CHAT_UPLOAD_DIR, localAsset[1] + '.tribute'), id, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  persistActiveRooms(); broadcastChatUpdate(room); sendTributeVaultToHost(room);
  setTimeout(() => {
    const current = rooms.get(room.code);
    const currentMessage = current?.chat?.messages?.find(item => item.id === message.id);
    if (currentMessage?.bloodTribute?.tributeId !== id) return;
    currentMessage.bloodTribute.active = false; currentMessage.bloodTribute.claimed = true;
    persistActiveRooms(); broadcastChatUpdate(current); sendTributeVaultToHost(current);
  }, BLOOD_TRIBUTE_PUBLIC_MS + 25);
}

function handleCancelChatBloodTribute(ws, payload) {
  const room = requireGmRoom(ws);
  if (!room) return;
  const message = room.chat.messages.find(item => item.id === String(payload.messageId || ''));
  const state = message?.bloodTribute;
  if (!message || !state?.active || Number(state.expiresAt) <= Date.now()) return sendToWs(ws, { type: 'error', message: 'Blood Tribute can no longer be cancelled' });
  room.bloodTributes = (room.bloodTributes || []).filter(item => item.id !== state.tributeId);
  const localAsset = /^\/uploads\/chat\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))$/i.exec(message.imageUrl || '');
  if (localAsset) { try { fs.unlinkSync(path.join(CHAT_UPLOAD_DIR, localAsset[1] + '.tribute')); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  delete message.bloodTribute;
  persistActiveRooms(); broadcastChatUpdate(room); sendTributeVaultToHost(room);
}

function handleTributeVaultUpdate(ws, payload) {
  const room = requireGmRoom(ws);
  if (!room) return;
  if (Number(ws.reliquaryUnlockedUntil) <= Date.now()) {
    sendToWs(ws, { type: 'error', code: 'RELIQUARY_LOCKED', message: 'Reliquary code required' });
    return;
  }
  const tribute = (room.bloodTributes || []).find(item => item.id === String(payload.id || ''));
  if (!tribute) return;
  if (payload.action === 'viewed') tribute.viewedByGM = true;
  if (payload.action === 'reliquary') tribute.reliquary = payload.value === true;
  persistActiveRooms(); sendTributeVaultToHost(room);
}

function handleReliquaryAccess(ws, payload) {
  const room = requireGmRoom(ws);
  if (!room) return;
  const now = Date.now();
  ws.reliquaryAttempts = (ws.reliquaryAttempts || []).filter(at => now - at < 60000);
  if (ws.reliquaryAttempts.length >= 5) {
    sendToWs(ws, { type: 'tribute:vaultAccess', granted: false, locked: true });
    return;
  }
  const supplied = crypto.createHash('sha256').update(String(payload.code || '')).digest();
  const expected = Buffer.from(RELIQUARY_CODE_SHA256, 'hex');
  const granted = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!granted) ws.reliquaryAttempts.push(now);
  else {
    ws.reliquaryAttempts = [];
    ws.reliquaryUnlockedUntil = now + (10 * 60 * 1000);
  }
  sendToWs(ws, { type: 'tribute:vaultAccess', granted });
  if (granted) sendTributeVaultToHost(room);
}

function sendTributeVaultToHost(room) {
  if (!room?.hostConnection || Number(room.hostConnection.reliquaryUnlockedUntil) <= Date.now()) return;
  sendToWs(room.hostConnection, { type: 'tribute:vault', ...getBloodTributeVaultState(room) });
}

// ---------------------------------------------------------------------
// SUMMON RITUAL -- pre-Battle gate. Exactly two ways to fulfill it: 5 real
// online players "join the ritual", OR the Shadow Broker accepts one
// anonymously-submitted Blood Tribute image. Either condition alone
// unlocks START GAME; they are never combined arithmetically (an accepted
// tribute overrides the vote requirement entirely, regardless of current
// vote count). The server is authoritative -- see the fulfillment check
// inside handleTimerStart/handleTimerLaunchCountdown; the client button
// lock is cosmetic only.
// ---------------------------------------------------------------------
function normalizeRitualState(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const tributeSource = source.tribute && typeof source.tribute === 'object' ? source.tribute : {};
  const status = ['NONE', 'PENDING', 'ACCEPTED', 'REJECTED'].includes(tributeSource.status) ? tributeSource.status : 'NONE';
  return {
    active: source.active === true,
    requiredVotes: RITUAL_REQUIRED_VOTES,
    joinedPlayerIds: Array.isArray(source.joinedPlayerIds) ? [...new Set(source.joinedPlayerIds.map(String))] : [],
    tribute: {
      status,
      submittedBy: status === 'NONE' ? null : (tributeSource.submittedBy ? String(tributeSource.submittedBy) : null),
      submittedByName: status === 'NONE' ? null : (String(tributeSource.submittedByName || '') || null),
      imageData: status === 'PENDING' ? (sanitizeTributeImageData(tributeSource.imageData) || null) : null
    },
    fulfilled: source.fulfilled === true,
    fulfilledBy: source.fulfilledBy === 'VOTES' || source.fulfilledBy === 'BLOOD_TRIBUTE' ? source.fulfilledBy : null
  };
}

// Fresh, active, unfulfilled ritual. Called at every "GM prepares a Battle
// game" moment (initial arm, RESET BOARD, NEXT GAME) -- confirmed with the
// user that each of those re-summons a fresh ritual, not just the first.
function startRitual(room) {
  room.ritual = normalizeRitualState({ active: true });
}

// Called on successful battle start, ritual cancel, and any return to
// CASUAL -- the ritual becomes irrelevant once Battle begins or is called off.
function endRitual(room) {
  if (room.ritual) room.ritual.active = false;
}

function recomputeRitualFulfillment(room) {
  const ritual = room.ritual;
  if (!ritual) return;
  if (ritual.tribute.status === 'ACCEPTED') {
    // An accepted Blood Tribute is a full override and, once set, is never
    // cleared by vote count changes (disconnects included) -- only by
    // cancel/reset/battle-start via startRitual()/endRitual().
    ritual.fulfilled = true;
    ritual.fulfilledBy = 'BLOOD_TRIBUTE';
    return;
  }
  ritual.fulfilled = ritual.joinedPlayerIds.length >= ritual.requiredVotes;
  ritual.fulfilledBy = ritual.fulfilled ? 'VOTES' : null;
}

function isRitualFulfilled(room) {
  const ritual = room.ritual;
  if (!ritual) return false;
  return ritual.tribute.status === 'ACCEPTED' || ritual.joinedPlayerIds.length >= ritual.requiredVotes;
}

// Player-safe projection -- no names, no submitter identity, no image.
// "The public representation should feel like anonymous ritual
// participation rather than an attendance checklist."
function getRitualSafeState(room) {
  const ritual = room.ritual || normalizeRitualState(null);
  return {
    active: ritual.active,
    requiredVotes: ritual.requiredVotes,
    joinedCount: ritual.joinedPlayerIds.length,
    tribute: { status: ritual.tribute.status },
    fulfilled: ritual.fulfilled,
    fulfilledBy: ritual.fulfilledBy
  };
}

function sendRitualDetailToHost(room) {
  if (!room?.hostConnection || room.hostConnection.readyState !== 1) return;
  const ritual = room.ritual || normalizeRitualState(null);
  const joined = ritual.joinedPlayerIds.map(id => {
    const entry = Array.from(room.players.values()).find(p => String(p.id) === id);
    return { id, name: entry?.name || 'LITTLE HERO' };
  });
  sendToWs(room.hostConnection, {
    type: 'ritual:gmUpdate',
    ritual: {
      ...getRitualSafeState(room),
      joined,
      tribute: {
        status: ritual.tribute.status,
        submittedByName: ritual.tribute.submittedByName,
        imageData: ritual.tribute.status === 'PENDING' ? ritual.tribute.imageData : null
      }
    }
  });
}

function broadcastRitualState(room) {
  persistActiveRooms();
  const safe = getRitualSafeState(room);
  const joinedIds = room.ritual?.joinedPlayerIds || [];
  room.players.forEach((player, ws) => {
    if (player.isTestPersona === true || ws.readyState !== 1) return;
    sendToWs(ws, { type: 'ritual:update', ritual: { ...safe, iJoined: joinedIds.includes(String(player.id)) } });
  });
  sendRitualDetailToHost(room);
}

// GM Master Mirror test personas never count as "real" players here (same
// exclusion Blood Tribute wheel-eligibility already applies elsewhere).
function handleRitualJoin(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  const player = room?.players.get(ws);
  if (!room || !player || player.isTestPersona === true || ws.readyState !== 1) {
    return sendToWs(ws, {
      type: 'error',
      code: 'RITUAL_JOIN_REJECTED',
      message: player?.isTestPersona === true
        ? 'MASTER MIRROR PERSONAS CANNOT BIND // ENTER WITH A LITTLE HERO ACCOUNT'
        : 'A CONNECTED LITTLE HERO IDENTITY IS REQUIRED'
    });
  }
  if (!room.ritual?.active) return sendToWs(ws, { type: 'error', code: 'RITUAL_JOIN_REJECTED', message: 'NO SUMMON RITUAL IS CURRENTLY ACTIVE' });
  const id = String(player.id);
  if (room.ritual.joinedPlayerIds.includes(id)) return; // already bound -- idempotent, no error needed
  room.ritual.joinedPlayerIds.push(id);
  recomputeRitualFulfillment(room);
  broadcastRitualState(room);
}

function handleRitualTributeSubmit(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  const player = room?.players.get(ws);
  if (!room || !player || player.isTestPersona === true) {
    return sendToWs(ws, { type: 'error', message: 'A connected Little Hero identity is required' });
  }
  if (!room.ritual?.active) return sendToWs(ws, { type: 'error', message: 'No Summon Ritual is currently active' });
  if (!['NONE', 'REJECTED'].includes(room.ritual.tribute.status)) {
    return sendToWs(ws, { type: 'error', message: 'A Blood Tribute is already offered or accepted' });
  }
  const imageData = sanitizeTributeImageData(message?.imageData);
  if (!imageData) return sendToWs(ws, { type: 'error', message: 'Invalid tribute image or file too large' });
  room.ritual.tribute = { status: 'PENDING', submittedBy: String(player.id), submittedByName: player.name, imageData };
  broadcastRitualState(room);
}

function handleRitualTributeAccept(ws) {
  const room = requireGmRoom(ws);
  if (!room) return;
  if (!room.ritual?.active || room.ritual.tribute.status !== 'PENDING') {
    return sendToWs(ws, { type: 'error', message: 'No Blood Tribute is awaiting judgment' });
  }
  const tribute = room.ritual.tribute;
  const now = Date.now();
  if (!Array.isArray(room.bloodTributes)) room.bloodTributes = [];
  // Archived straight into the existing Reliquary vault -- same array, same
  // GM-only viewer -- rather than a second image-storage system. Ritual
  // tributes are never public in chat, so there is no public window to
  // expire (publicUntil is already in the past).
  room.bloodTributes.push({
    id: 'ritual-tribute-' + crypto.randomBytes(8).toString('hex'),
    playerId: tribute.submittedBy,
    playerName: tribute.submittedByName || 'LITTLE HERO',
    source: 'ritual',
    imageData: tribute.imageData,
    submittedAt: now,
    publicUntil: now,
    archivedAt: now,
    reliquary: false,
    viewedByGM: true
  });
  tribute.status = 'ACCEPTED';
  tribute.imageData = null; // already archived above; no need to keep a live second copy
  recomputeRitualFulfillment(room);
  broadcastRitualState(room);
  sendTributeVaultToHost(room);
}

function handleRitualTributeReject(ws) {
  const room = requireGmRoom(ws);
  if (!room) return;
  if (!room.ritual?.active || room.ritual.tribute.status !== 'PENDING') {
    return sendToWs(ws, { type: 'error', message: 'No Blood Tribute is awaiting judgment' });
  }
  room.ritual.tribute = { status: 'REJECTED', submittedBy: null, submittedByName: null, imageData: null };
  recomputeRitualFulfillment(room);
  broadcastRitualState(room);
}

function handleRitualReset(ws) {
  const room = requireGmRoom(ws);
  if (!room) return;
  if (!room.ritual?.active) return sendToWs(ws, { type: 'error', message: 'No Summon Ritual is currently active' });
  startRitual(room);
  broadcastRitualState(room);
}

// CANCEL RITUAL aborts the whole battle-prep attempt (nothing of value has
// happened yet at this point -- the battle never launched), so it reuses
// the existing full disarm-to-CASUAL path rather than a bespoke partial
// rollback. RESET RITUAL (above) is the "stay armed, just restart the
// ritual" action.
function handleRitualCancel(ws) {
  const room = requireGmRoom(ws);
  if (!room || !room.ritual?.active) {
    if (room) sendToWs(ws, { type: 'error', message: 'No Summon Ritual is currently active' });
    return;
  }
  handleCloseRoom(ws);
}

function findPlayerByName(room, name) {
  const target = String(name || '').trim().toLowerCase();
  let fallback = null;
  for (const [socket, info] of room.players) {
    if (String(info.name || '').trim().toLowerCase() !== target) continue;
    if (socket.readyState === 1) return info;
    if (!fallback) fallback = info;
  }
  return fallback;
}

function armBloodTributeForWheelResult(room) {
  const winnerName = room.wheel?.segments?.[room.wheel.winnerIndex];
  const player = findPlayerByName(room, winnerName);
  if (!player) {
    room.pendingTribute = null;
    sendToWs(room.hostConnection, { type: 'tribute:unavailable', playerName: winnerName || 'UNKNOWN' });
    return false;
  }
  return armBloodTributeForPlayer(room, player, room.wheel.spinToken);
}

function armBloodTributeForPlayer(room, player, spinToken, source = 'womf') {
  room.pendingTribute = {
    id: 'demand-' + crypto.randomBytes(6).toString('hex'),
    playerId: player.id,
    playerName: player.name,
    spinToken,
    source,
    status: 'required',
    requestedAt: Date.now()
  };
  return true;
}

function handleBloodTributeSubmit(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || !ws.playerId) {
    sendToWs(ws, { type: 'error', message: 'Blood Tribute requires a linked Little Hero' });
    return;
  }
  const demand = room.pendingTribute;
  if (!demand || demand.status !== 'required' || demand.playerId !== ws.playerId) {
    sendToWs(ws, { type: 'error', message: 'No Blood Tribute is demanded from this identity' });
    return;
  }
  if (message.retentionAcknowledged !== true) {
    sendToWs(ws, { type: 'error', message: 'Tribute archive notice must be acknowledged' });
    return;
  }
  const imageData = sanitizeTributeImageData(message.imageData);
  if (!imageData) {
    sendToWs(ws, { type: 'error', message: 'Invalid tribute image or file too large' });
    return;
  }

  const now = Date.now();
  const tribute = {
    id: 'tribute-' + crypto.randomBytes(8).toString('hex'),
    playerId: demand.playerId,
    playerName: demand.playerName,
    source: demand.source || 'womf',
    imageData,
    submittedAt: now,
    publicUntil: now + BLOOD_TRIBUTE_PUBLIC_MS
  };
  if (!Array.isArray(room.bloodTributes)) room.bloodTributes = [];
  room.bloodTributes.push(tribute);

  room.chat.messages.push({
    id: 'chat-' + tribute.id,
    playerId: tribute.playerId,
    playerName: tribute.playerName,
    text: 'BLOOD TRIBUTE',
    timestamp: now,
    verdict: null,
    target: null,
    reactions: {},
    source: 'bloodTribute',
    tributeId: tribute.id,
    publicUntil: tribute.publicUntil
  });
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) room.chat.messages.shift();
  room.pendingTribute = null;
  // The nudge toll is one-time: once paid, this player nudges freely forever.
  if (demand.source === 'nudge') settleNudgeToll(room, demand.playerId);
  // So is the moon toll: once paid, this player may moon the Broker freely.
  if (demand.source === 'moon') { room.moonTolls ||= {}; room.moonTolls[String(demand.playerId)] = 'settled'; }
  if ((demand.source || 'womf') === 'womf') {
    room.womf.charge = 0;
    resetWheel(room);
  }
  room.revision++;

  // The accepted tribute and private vault copy are durable before either
  // side is told that payment succeeded.
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastChatUpdate(room);
  sendTributeVaultToHost(room);
  sendToWs(ws, { type: 'tribute:accepted', publicUntil: tribute.publicUntil });

  setTimeout(() => {
    const stillRoom = rooms.get(room.code);
    if (stillRoom) broadcastChatUpdate(stillRoom);
  }, BLOOD_TRIBUTE_PUBLIC_MS + 50);
}

function handleBloodTributeVaultClear(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can purge the Blood Tribute vault' });
    return;
  }
  if (Number(ws.reliquaryUnlockedUntil) <= Date.now()) {
    sendToWs(ws, { type: 'error', code: 'RELIQUARY_LOCKED', message: 'Reliquary code required' });
    return;
  }
  room.bloodTributes = [];
  room.chat.messages = room.chat.messages.filter(m => m.source !== 'bloodTribute');
  persistActiveRooms();
  broadcastChatUpdate(room);
  sendTributeVaultToHost(room);
}

// GM-only release of a demanded Blood Tribute WITHOUT requiring the payment
// itself. The debt is dropped outright: nothing is archived in the vault, the
// WOMF meter is deliberately NOT reset (forgiveness is not payment), and the
// Wheel stays exactly where it was -- fully operable -- so the GM can roll
// again. The override is written into the room's permanent chat as an
// actual Shadow Broker transmission (host-only + server-side source), and
// persisted BEFORE anyone is told the debt is gone.
function handleTributeForgive(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can override the Blood Tribute' });
    return;
  }
  const demand = room.pendingTribute;
  if (!demand || demand.status !== 'required') {
    sendToWs(ws, { type: 'error', message: 'No Blood Tribute debt is currently owed' });
    return;
  }

  room.pendingTribute = null;
  // Forgiving the nudge or moon toll settles it for good, same as paying.
  if (demand.source === 'nudge') settleNudgeToll(room, demand.playerId);
  if (demand.source === 'moon') { room.moonTolls ||= {}; room.moonTolls[String(demand.playerId)] = 'settled'; }

  // Only WOMF-origin debt owns the Battle wheel. Casual Concoction debt
  // must never mutate or resurrect Battle wheel state.
  if ((demand.source || 'womf') === 'womf' && room.wheel && Array.isArray(room.wheel.segments) && room.wheel.segments.length >= WHEEL_MIN_SEGMENTS) {
    room.wheel.open = true;
    room.wheel.phase = 'idle';
    room.wheel.winnerIndex = null;
    room.wheel.spinToken = null;
    delete room.wheel.settleAt;
  } else if ((demand.source || 'womf') === 'womf') {
    resetWheel(room);
  }

  room.revision++;
  addShadowBrokerMessage(room, 'BLOOD TRIBUTE OVERRIDDEN BY SHADOW BROKER');

  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastChatUpdate(room);
  sendTributeVaultToHost(room);
  console.log(`[ROOM ${room.code}] GM OVERRODE the Blood Tribute demanded of ${demand.playerName}`);
}

// GM opens the Wheel (only reachable once WOMF is armed at 10/10). Segments
// default to every currently-connected player's name if the GM doesn't
// send a specific list (e.g. sends an empty array to mean "everyone").
// This only makes the wheel visible and ready to roll -- it never touches
// the WOMF charge itself.
function handleWheelOpen(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can open the Wheel' });
    return;
  }
  if (!isBattleSurface(room)) {
    sendToWs(ws, { type: 'error', message: 'WOMF is only available on the Battle surface' });
    return;
  }
  if (!room.womf || room.womf.charge < 10) {
    sendToWs(ws, { type: 'error', message: 'WOMF is not armed yet (10/10 required)' });
    return;
  }
  if (room.pendingTribute?.status === 'required') {
    sendToWs(ws, { type: 'error', message: `Blood Tribute is still owed by ${room.pendingTribute.playerName}` });
    return;
  }

  // WOMF targets real, currently-connected Little Heroes only. Build a
  // canonical case-insensitive name map from live sockets and resolve the
  // requested roster against it. This makes offline/custom identities
  // impossible even if an old or hand-crafted client sends them.
  const connectedNames = new Map();
  for (const [socket, player] of room.players) {
    if (!player || player.connected !== true || socket.readyState !== 1) continue;
    const canonical = String(player.name || '').trim();
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (!connectedNames.has(key)) connectedNames.set(key, canonical);
  }

  let segments = Array.isArray(message.segments) ? message.segments : [];
  segments = segments
    .map(s => connectedNames.get(String(s || '').trim().toLowerCase()))
    .filter(Boolean);

  // De-dupe case-insensitively while preserving the GM's requested order.
  const seenSegmentNames = new Set();
  segments = segments.filter(name => {
    const key = name.toLowerCase();
    if (seenSegmentNames.has(key)) return false;
    seenSegmentNames.add(key);
    return true;
  });

  if (segments.length === 0) {
    segments = Array.from(connectedNames.values());
  }

  if (segments.length > WHEEL_MAX_SEGMENTS) segments = segments.slice(0, WHEEL_MAX_SEGMENTS);

  if (segments.length < WHEEL_MIN_SEGMENTS) {
    sendToWs(ws, { type: 'error', message: `The Wheel needs at least ${WHEEL_MIN_SEGMENTS} names (got ${segments.length})` });
    return;
  }

  room.wheel = { open: true, segments, phase: 'idle', winnerIndex: null, spinToken: null };
  room.revision++;

  persistActiveRooms();
  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });

  console.log(`[ROOM ${room.code}] GM opened the Wheel (${segments.length} segments)`);
}

function handleWheelRoll(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can roll the Wheel' });
    return;
  }
  if (!isBattleSurface(room)) {
    sendToWs(ws, { type: 'error', message: 'WOMF is only available on the Battle surface' });
    return;
  }
  if (!room.wheel || !room.wheel.open) {
    sendToWs(ws, { type: 'error', message: 'The Wheel is not open' });
    return;
  }
  if (room.wheel.phase !== 'idle') {
    sendToWs(ws, {
      type: 'error',
      message: room.wheel.phase === 'spinning'
        ? 'The Wheel is already spinning'
        : 'Dismiss the current WOMF result before another roll'
    });
    return;
  }
  if (room.pendingTribute?.status === 'required') {
    sendToWs(ws, { type: 'error', message: `Blood Tribute is still owed by ${room.pendingTribute.playerName}` });
    return;
  }
  if (!room.wheel.segments || room.wheel.segments.length < WHEEL_MIN_SEGMENTS) {
    sendToWs(ws, { type: 'error', message: 'Not enough names on the Wheel to roll' });
    return;
  }

  // Revalidate the roster at the instant of the roll. A player can leave in
  // the few seconds between the GM opening WOMF and pressing INITIATE, and a
  // disconnected identity must not remain eligible merely because it was
  // online when the setup modal was rendered.
  const liveNameKeys = new Set();
  for (const [socket, player] of room.players) {
    if (!player || player.connected !== true || socket.readyState !== 1) continue;
    const name = String(player.name || '').trim();
    if (name) liveNameKeys.add(name.toLowerCase());
  }
  const liveSegments = room.wheel.segments.filter(name => liveNameKeys.has(String(name || '').trim().toLowerCase()));
  if (liveSegments.length < WHEEL_MIN_SEGMENTS) {
    resetWheel(room);
    room.revision++;
    persistActiveRooms();
    broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
    sendToWs(ws, { type: 'error', message: 'WOMF requires at least 2 online Little Heroes. Reopen the Wheel.' });
    return;
  }
  if (liveSegments.length !== room.wheel.segments.length) {
    room.wheel.segments = liveSegments;
  }

  const winnerIndex = crypto.randomInt(room.wheel.segments.length);
  const spinToken = 'spin-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');

  room.wheel.phase = 'spinning';
  room.wheel.winnerIndex = winnerIndex;
  room.wheel.spinToken = spinToken;
  room.wheel.settleAt = Date.now() + WHEEL_SPIN_DURATION_MS;
  room.revision++;

  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM rolled the Wheel -- landed on "${room.wheel.segments[winnerIndex]}"`);

  armWheelSettlement(room);
}

function armWheelSettlement(room) {
  const token = room.wheel.spinToken;
  setTimeout(() => runtimeAction(() => {
    const live = rooms.get(room.code);
    if (!live || live.wheel?.spinToken !== token || live.wheel.phase !== 'spinning') return;
    live.wheel.phase = 'result';
    delete live.wheel.settleAt;

    // Result presentation and punishment presentation are deliberately
    // separate stages. Everyone, INCLUDING the selected Little Hero, gets
    // to see the landed wheel first. The Blood Tribute is not armed until
    // the GM explicitly dismisses the result.
    live.revision++;
    persistActiveRooms();
    broadcastToRoom(live, { type: 'state:public', ...getPublicState(live) });
  }), Math.max(0, Number(room.wheel.settleAt || 0) - Date.now()));
}

function handleWheelClose(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can close the Wheel' });
    return;
  }
  // RECOUNT is allowed too: a Wheel still showing its result when the GM
  // opens the RECOUNT (e.g. GAME LOST -> WOMF -> FINISH GAME) must remain
  // dismissible, otherwise it stays on every screen and its Blood Tribute
  // is never demanded. ABUSE after a shown RECOUNT returns to RECOUNT, so
  // there is no other way back to it.
  if (!isBattleSurface(room) && room.roomMode !== ROOM_MODES.RECOUNT) {
    sendToWs(ws, { type: 'error', message: 'WOMF is only available on the Battle surface' });
    return;
  }

  if (room.wheel?.phase === 'result') {
    // DISMISS is the hand-off from spectacle to consequence. Preserve the
    // exact roster/result behind the scenes so a forgiven tribute can reopen
    // this wheel for a clean reroll, but remove it from every screen before
    // the selected player's Blood Tribute overlay becomes active.
    const tributeArmed = armBloodTributeForWheelResult(room);
    if (tributeArmed) {
      room.wheel.open = false;
    } else {
      // The selected identity vanished so completely that no player record
      // can receive the debt. Drop this result instead of leaving a dead
      // hidden wheel that can never settle.
      resetWheel(room);
    }
  } else {
    // ABORT before a completed result is just an abort. WOMF charge remains
    // untouched and the GM may open a fresh eligible roster afterward.
    resetWheel(room);
  }

  room.revision++;

  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  sendTributeVaultToHost(room);
  console.log(`[ROOM ${room.code}] GM ${room.pendingTribute?.status === 'required' ? 'dismissed WOMF result and armed Blood Tribute' : 'closed the Wheel'}`);
}

// ---------------------------------------------------------------------
// TIMER + BORROWED TIME
//
// Locked spec: server-authoritative countdown, synchronized GM/player
// display, player side read-only, numeric + a draining visual health bar
// derived from the SAME remaining-time state. Duration is picked from the
// game's difficulty (below); the GM starts/pauses/resumes it explicitly --
// it never auto-starts on game/XLSX load.
//
// Phase state machine (room.timer.phase):
//   'ready'          -- not started yet. duration/remaining hold the full
//                        difficulty default; GM can still change difficulty
//                        here and the default updates (see 'setDifficulty').
//   'running'        -- normal time ticking down every TIMER_TICK_MS.
//   'paused'         -- normal time frozen (GM-initiated).
//   'borrowed'       -- normal time hit 0:00; a SEPARATE 2:00 emergency
//                        reserve is now ticking down (borrowedRemaining).
//                        This is a distinct bar/state, not a refill of the
//                        normal one -- the normal bar stays empty.
//   'borrowed_paused'-- Borrowed Time frozen (GM-initiated).
//   'expired'        -- Borrowed Time hit 0:00. Per the locked spec this is
//                        PURELY a display state: it does NOT auto-fail the
//                        Final and does NOT auto-add WOMF charge. The GM
//                        alone still decides (via the existing FAIL K
//                        control) whether/when to declare the Final failed.
//   'stopped'        -- the Final was resolved (success OR GM-declared
//                        failure) while a countdown was active; finalizeBoard()
//                        below freezes it here so the HUD stops moving.
//
// Client-side interpolation of the bar between ticks is fine (and expected,
// for a smooth drain) but the numbers below are the sole source of truth --
// every client reconciles to them on every state:public broadcast, which
// happens at least once per TIMER_TICK_MS while a countdown is active.
// ---------------------------------------------------------------------

const TIMER_DURATIONS_MS = {
  GREEN: 20 * 60 * 1000,
  YELLOW: 20 * 60 * 1000,
  AMBER: 25 * 60 * 1000,
  RED: 35 * 60 * 1000,
  PURPLE: 35 * 60 * 1000,
  BLACK: 35 * 60 * 1000
};
const TIMER_BORROWED_MS = 2 * 60 * 1000;
const TIMER_TICK_MS = 1000;

function defaultTimerDuration(room) {
  const difficulty = room.gameData && room.gameData.difficulty;
  return TIMER_DURATIONS_MS[difficulty] || TIMER_DURATIONS_MS.GREEN;
}

// Fresh, un-started timer for the CURRENT game's difficulty. Called on
// room creation, resetBoard, and switchGame (a new board always starts
// back at 'ready' -- it is never carried over already-running).
function resetTimer(room) {
  const duration = defaultTimerDuration(room);
  room.timer = {
    phase: 'ready',
    duration,
    remaining: duration,
    borrowedDuration: TIMER_BORROWED_MS,
    borrowedRemaining: TIMER_BORROWED_MS
  };
}

// Freezes the battle clock at a board-resolving moment (Final solved, REVEAL
// ALL/FINAL, GAME WON) but remembers the live phase, so a GM correction --
// undoing a FINAL verdict or hiding a revealed Final -- can resume exactly
// where play stopped instead of leaving a dead 'stopped' clock behind.
const CLOCK_ACTIVE_PHASES = ['running', 'paused', 'borrowed', 'borrowed_paused'];
function stopClock(room) {
  const t = room.timer;
  if (!t || !CLOCK_ACTIVE_PHASES.includes(t.phase)) return false;
  t.stoppedFrom = t.phase;
  t.phase = 'stopped';
  pauseSolutionCountdowns(room);
  return true;
}

function resumeStoppedClock(room) {
  const t = room.timer;
  if (!t || t.phase !== 'stopped' || !CLOCK_ACTIVE_PHASES.includes(t.stoppedFrom) || room.sessionState.matchResult) return false;
  t.phase = t.stoppedFrom;
  delete t.stoppedFrom;
  if (t.phase === 'running' || t.phase === 'borrowed') resumeSolutionCountdowns(room);
  return true;
}

// Column/FINAL solution countdowns are battle time, not wall time: they
// freeze whenever the battle clock does (pause, stop) and resume with it.
// A frozen entry keeps remainingMs and drops its deadline; replacing the
// token invalidates the timeout that was armed for the old deadline.
function pauseSolutionCountdowns(room) {
  const now = Date.now();
  for (const entry of Object.values(room.solutionCountdowns || {})) {
    if (!entry || !Number.isFinite(entry.deadline)) continue;
    entry.remainingMs = Math.max(0, entry.deadline - now);
    entry.deadline = null;
    entry.token = crypto.randomUUID();
  }
}

function resumeSolutionCountdowns(room) {
  const now = Date.now();
  for (const entry of Object.values(room.solutionCountdowns || {})) {
    if (!entry || Number.isFinite(entry.deadline) || !Number.isFinite(entry.remainingMs)) continue;
    entry.deadline = now + entry.remainingMs;
    delete entry.remainingMs;
    entry.token = crypto.randomUUID();
    armSolutionCountdown(room, entry);
  }
}

function getTimerPublicState(room) {
  if (!room.timer) resetTimer(room);
  const t = room.timer;
  return {
    phase: t.phase,
    duration: t.duration,
    remaining: t.remaining,
    borrowedDuration: t.borrowedDuration,
    borrowedRemaining: t.borrowedRemaining
  };
}

function getSolutionCountdownPublicState(room) {
  const source = room.solutionCountdowns || {};
  const out = {};
  for (const [target, entry] of Object.entries(source)) {
    if (!entry || entry.boardId !== room.boardId) continue;
    if (Number.isFinite(entry.deadline)) {
      out[target] = { target, deadline: entry.deadline, seconds: entry.seconds };
    } else if (Number.isFinite(entry.remainingMs)) {
      out[target] = { target, deadline: null, paused: true, remainingMs: entry.remainingMs, seconds: entry.seconds };
    }
  }
  return out;
}

function clearSolutionCountdown(room, target) {
  if (!room.solutionCountdowns?.[target]) return false;
  delete room.solutionCountdowns[target];
  return true;
}

function armSolutionCountdown(room, entry) {
  const delay = Math.max(0, Number(entry.deadline || 0) - Date.now());
  // Captured now: pausing replaces entry.token on this same object, which is
  // what must invalidate this timeout.
  const armedToken = entry.token;
  setTimeout(() => runtimeAction(() => {
    const live = rooms.get(room.code);
    const current = live?.solutionCountdowns?.[entry.target];
    if (!live || !current || current.token !== armedToken || current.boardId !== live.boardId) return;
    delete live.solutionCountdowns[entry.target];

    if (!isBattleSurface(live) || isMatchResolved(live)) {
      persistActiveRooms();
      broadcastToRoom(live, { type: 'state:public', ...getPublicState(live) });
      return;
    }

    if (entry.target === 'FINAL') {
      declareGameLost(live, 'solution-countdown');
      return;
    }

    const result = applyCommand(live, 'resolveColumn', { column: entry.target, outcome: 'failed' });
    persistActiveRooms();
    if (result.success && result.changed) {
      broadcastToRoom(live, { type: 'state:public', ...getPublicState(live) });
    }
  }), delay);
}

function handleSolutionCountdown(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return sendToWs(ws, { type: 'error', message: 'Room not found' });
  if (ws !== room.hostConnection) return sendToWs(ws, { type: 'error', message: 'Only host can start a solution countdown' });
  if (!isBattleSurface(room) || isMatchResolved(room)) {
    return sendToWs(ws, { type: 'error', message: 'Solution countdown is only available on a live Battle surface' });
  }

  const target = String(message.target || '').toUpperCase();
  const seconds = Number(message.seconds);
  if (!['A', 'B', 'C', 'D', 'FINAL'].includes(target) || ![60, 120].includes(seconds)) {
    return sendToWs(ws, { type: 'error', message: 'Invalid solution countdown' });
  }
  const alreadyResolved = target === 'FINAL'
    ? (room.sessionState.finalSolution === true || room.sessionState.finalOutcome)
    : (!!room.chat.solvedTargets?.[target] || !!room.sessionState.cellOutcomes?.[target + '5']);
  if (alreadyResolved) return sendToWs(ws, { type: 'error', message: target + ' is already resolved' });

  room.solutionCountdowns ||= {};
  const entry = {
    target,
    seconds,
    deadline: Date.now() + seconds * 1000,
    boardId: room.boardId,
    token: crypto.randomUUID()
  };
  // Started while the battle clock is frozen: the countdown starts frozen too
  // and begins counting when the GM resumes.
  const clockLive = room.timer?.phase === 'running' || room.timer?.phase === 'borrowed';
  if (!clockLive) {
    entry.remainingMs = seconds * 1000;
    entry.deadline = null;
  }
  room.solutionCountdowns[target] = entry;
  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  if (clockLive) armSolutionCountdown(room, entry);
}

function isMatchResolved(room) {
  return !!(room.sessionState.matchResult || room.match?.completedAt);
}

function handleTimerLaunchCountdown(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can launch the battle countdown' });
    return;
  }
  if (!room.timer) resetTimer(room);
  if (room.roomMode !== ROOM_MODES.BATTLE_ARMED || room.timer.phase !== 'ready') {
    sendToWs(ws, { type: 'error', message: 'Battle must be armed and the Timer ready before launch' });
    return;
  }
  if (isMatchResolved(room)) {
    sendToWs(ws, { type: 'error', message: 'This match is already resolved // RESET BOARD or NEXT GAME first' });
    return;
  }
  // Authoritative gate, not cosmetic: gated here too (not just handleTimerStart)
  // so players never see a launch countdown that then silently fails at zero.
  if (!isRitualFulfilled(room)) {
    sendToWs(ws, { type: 'error', message: 'THE SUMMON RITUAL IS NOT YET FULFILLED' });
    return;
  }

  // The ritual was fulfilled when the launch was accepted. Lock that in for
  // this launch: every player is already watching T-10, so a voter's
  // connection dropping during the countdown must not abort the start.
  room.ritual.launchApprovedAt = Date.now();

  // The T-10 sequence is theatrical, not authoritative game time. Broadcast
  // it immediately so every connected Little Hero sees the same launch
  // overlay while the real timer remains READY until gm:timerStart arrives
  // from the host at zero.
  broadcastToRoom(room, { type: 'battle:launchCountdown' });
  console.log(`[ROOM ${room.code}] Battle launch countdown broadcast to GM + players`);
}

function handleTimerStart(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can start the Timer' });
    return;
  }
  if (!room.timer) resetTimer(room);
  if (room.roomMode !== ROOM_MODES.BATTLE_ARMED) {
    sendToWs(ws, { type: 'error', message: 'Battle is not armed' });
    return;
  }
  if (room.timer.phase !== 'ready') {
    sendToWs(ws, { type: 'error', message: 'The Timer has already been started' });
    return;
  }
  // A board resolved while still ARMED (FINAL GREEN/RED, REVEAL ALL) must not
  // be "started" into a live BATTLE with a clock running on a finished match.
  if (isMatchResolved(room)) {
    sendToWs(ws, { type: 'error', message: 'This match is already resolved // RESET BOARD or NEXT GAME first' });
    return;
  }
  // SUMMON RITUAL security gate. Authoritative: the client's START GAME lock
  // is cosmetic only. A direct gm:timerStart with no valid fulfillment (5
  // votes OR an accepted Blood Tribute) is rejected here, full stop.
  const launchLocked = Number(room.ritual?.launchApprovedAt) > Date.now() - RITUAL_LAUNCH_GRACE_MS;
  if (!isRitualFulfilled(room) && !launchLocked) {
    sendToWs(ws, { type: 'error', message: 'THE SUMMON RITUAL IS NOT YET FULFILLED' });
    return;
  }

  room.timer.phase = 'running';
  room.roomMode = ROOM_MODES.BATTLE;
  room.armed = true;
  room.revision++;
  endRitual(room);
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastToRoom(room, { type: 'battle:controlsOnline' });
  broadcastRitualState(room);
  console.log(`[ROOM ${room.code}] GM started the Timer (${Math.round(room.timer.duration / 1000)}s) â€” BATTLE CONTROLS ONLINE`);
}

function handleTimerPause(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can pause the Timer' });
    return;
  }
  if (room.roomMode !== ROOM_MODES.BATTLE) {
    sendToWs(ws, { type: 'error', message: 'Timer controls are only available on the active Battle surface' });
    return;
  }
  if (!room.timer || (room.timer.phase !== 'running' && room.timer.phase !== 'borrowed')) {
    sendToWs(ws, { type: 'error', message: 'The Timer is not currently running' });
    return;
  }

  room.timer.phase = room.timer.phase === 'borrowed' ? 'borrowed_paused' : 'paused';
  pauseSolutionCountdowns(room);
  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM paused the Timer`);
}

function handleTimerResume(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can resume the Timer' });
    return;
  }
  if (room.roomMode !== ROOM_MODES.BATTLE) {
    sendToWs(ws, { type: 'error', message: 'Timer controls are only available on the active Battle surface' });
    return;
  }
  if (!room.timer || (room.timer.phase !== 'paused' && room.timer.phase !== 'borrowed_paused')) {
    sendToWs(ws, { type: 'error', message: 'The Timer is not currently paused' });
    return;
  }

  room.timer.phase = room.timer.phase === 'borrowed_paused' ? 'borrowed' : 'running';
  resumeSolutionCountdowns(room);
  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM resumed the Timer`);
}

// GM manual correction: nudge the CURRENTLY ACTIVE clock (normal or
// Borrowed Time, whichever the phase is actually in) by a signed delta,
// e.g. -30000/+30000. Deliberately does nothing else: it never touches
// `phase` itself. If the nudge pushes normal `remaining` down to 0, the
// very next tick of the loop below notices exactly as it always does and
// transitions into 'borrowed' on its own -- so a phase change from an
// adjustment is a natural, one-tick-later side effect, never something
// this function forces directly. This is what keeps an adjustment from
// resetting/restarting anything: no phase write, no field but the one
// clock touched, so the warning/danger/borrowed pulse states (which are
// all derived from remaining/duration) simply recompute correctly next
// render.
function handleTimerAdjust(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can adjust the Timer' });
    return;
  }
  if (room.roomMode !== ROOM_MODES.BATTLE) {
    sendToWs(ws, { type: 'error', message: 'Timer controls are only available on the active Battle surface' });
    return;
  }
  if (!room.timer) resetTimer(room);
  const t = room.timer;

  const ACTIVE_PHASES = ['running', 'paused', 'borrowed', 'borrowed_paused'];
  if (!ACTIVE_PHASES.includes(t.phase)) {
    sendToWs(ws, { type: 'error', message: 'The Timer is not active' });
    return;
  }

  const deltaMs = Number(message.deltaMs);
  if (!Number.isFinite(deltaMs) || deltaMs === 0) {
    sendToWs(ws, { type: 'error', message: 'Invalid adjustment' });
    return;
  }

  const inBorrowed = t.phase === 'borrowed' || t.phase === 'borrowed_paused';
  // Clamped to [0, that clock's own full duration] -- the lower bound
  // is the locked spec's explicit "prevent invalid negative timer state";
  // the upper bound just keeps the health bar from rendering past 100%,
  // it's not a rule against giving extra time, only against overfilling
  // the bar past its own track.
  if (inBorrowed) {
    t.borrowedRemaining = Math.max(0, Math.min(t.borrowedDuration, t.borrowedRemaining + deltaMs));
  } else {
    t.remaining = Math.max(0, Math.min(t.duration, t.remaining + deltaMs));
  }

  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM adjusted the Timer by ${deltaMs > 0 ? '+' : ''}${Math.round(deltaMs / 1000)}s (${inBorrowed ? 'Borrowed Time' : 'normal'})`);
}

function buildLossPerformance(room) {
  const byPlayer = matchLedger.matchPointsByPlayer(room.scoring.events, room.boardId);
  const performers = Object.values(byPlayer)
    .map(entry => ({ playerId: entry.playerId, name: entry.name, points: entry.points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  // Include connected participants who earned no scoring event.
  getActiveParticipants(room).forEach(player => {
    if (!performers.some(entry => entry.playerId === player.playerId)) {
      performers.push({ playerId: player.playerId, name: player.playerName, points: 0 });
    }
  });
  performers.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const topPerformer = performers[0] || null;
  const attempts = ensureMatchLedger(room).attempts || [];
  const correct = attempts.filter(attempt => attempt.verdict === 'correct').sort((a, b) => b.judgedAt - a.judgedAt);
  const awards = [];
  if (topPerformer) awards.push({
    type: 'NOT ENOUGH', playerId: topPerformer.playerId, playerName: topPerformer.name,
    comment: 'Individual performance acceptable. Collective outcome unchanged.'
  });
  if (correct[0]) awards.push({
    type: 'LAST HOPE', playerId: correct[0].playerId, playerName: correct[0].playerName,
    comment: 'Recovery remained possible. Briefly.'
  });
  const borrowedActivity = attempts.filter(attempt => attempt.judgedAt >= (room.timer.borrowedStartedAt || Infinity));
  if (borrowedActivity.length >= 5 && !borrowedActivity.some(attempt => attempt.verdict === 'correct')) {
    awards.push({ type: 'TIME WELL WASTED', group: true, comment: 'Additional resources were provided. Outcome persisted.' });
  }
  if ((room.timer.borrowedDuration || 0) >= 60000) {
    awards.push({ type: 'BORROWED AND SQUANDERED', group: true, comment: 'Extension granted. Failure merely postponed.' });
  }
  awards.push({ type: 'COLLECTIVE FAILURE', group: true, comment: 'Responsibility successfully distributed.' });
  return { performers, topPerformer, awards };
}

function buildWinPerformance(room) {
  const byPlayer = matchLedger.matchPointsByPlayer(room.scoring.events, room.boardId);
  const performers = Object.values(byPlayer)
    .map(entry => ({ playerId: entry.playerId, name: entry.name, points: entry.points }));
  getActiveParticipants(room).forEach(player => {
    if (!performers.some(entry => entry.playerId === player.playerId)) {
      performers.push({ playerId: player.playerId, name: player.playerName, points: 0 });
    }
  });
  performers.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const highScore = performers.length ? performers[0].points : null;
  const winners = highScore === null ? [] : performers.filter(entry => entry.points === highScore);
  return { performers, matchWinner: winners[0] || null, winners };
}

// Sole server-authoritative loss transition. Clients never infer loss from
// their interpolated clocks; they only react to this persisted matchResult.
function declareGameLost(room, source = 'timer') {
  if (room.sessionState.matchResult || room.sessionState.gameWon === true) return false;
  clearSolutionCountdown(room, 'FINAL');
  if (room.chat.solvedTargets?.FINAL || room.scoring.boardFinalized) return false;

  const finalized = finalizeBoard(room, 'failed');
  addWomfCharge(room, 3);
  room.sessionState.finalSolution = true;
  room.sessionState.finalOutcome = 'failed';
  matchLedger.markFailed(ensureMatchLedger(room), 'FINAL', Date.now());

  const performance = buildLossPerformance(room);
  const selectedMessage = GAME_LOST_MESSAGES[crypto.randomInt(GAME_LOST_MESSAGES.length)];
  room.sessionState.matchResult = {
    outcome: 'LOST',
    occurredAt: Date.now(),
    message: selectedMessage,
    story: room.gameData.story || '',
    finalSolution: room.gameData.finalSolution || '',
    columnSolutions: {
      A: room.gameData.columns?.A?.solution || '', B: room.gameData.columns?.B?.solution || '',
      C: room.gameData.columns?.C?.solution || '', D: room.gameData.columns?.D?.solution || ''
    },
    columnResults: {
      A: isColumnSolvedGreen(room, 'A'), B: isColumnSolvedGreen(room, 'B'),
      C: isColumnSolvedGreen(room, 'C'), D: isColumnSolvedGreen(room, 'D')
    },
    topPerformer: performance.topPerformer,
    performers: performance.performers,
    awards: performance.awards
  };
  room.scoring.pendingResults = {
    outcome: 'failed', penalty: scoring.FAILED_FINAL_PENALTY,
    participants: finalized.participants ? finalized.participants.map(p => p.playerName) : []
  };
  room.match.completedAt = room.sessionState.matchResult.occurredAt;
  const fields = matchLedger.resolveFields({
    solvedTargets: solvedTargetsForFieldState(room),
    failedColumns: (room.womf && room.womf.failedColumns) || {},
    revealed: { A: room.sessionState.cells.A5 === true, B: room.sessionState.cells.B5 === true,
      C: room.sessionState.cells.C5 === true, D: room.sessionState.cells.D5 === true, FINAL: true },
    ledger: room.match
  });
  try { archiveCompletedMatch(room, fields); } catch (error) { console.error('[match] Loss archive failed:', error.message); }
  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastPlayersUpdate(room);
  console.log(`[ROOM ${room.code}] GAME LOST -- ${source === 'gm-final' ? 'GM resolved FINAL RED' : source === 'solution-countdown' ? 'solution grace countdown expired' : 'authoritative timer expiry'}`);
  return true;
}

// Single global tick, once per second, covering every room. Only rooms with
// an actively-running phase ('running' or 'borrowed') are touched -- ready/
// paused/borrowed_paused/expired/stopped never move on their own. This is
// the ONLY place normal time crosses into Borrowed Time, and the ONLY place
// Borrowed Time crosses into 'expired'. Entering Borrowed Time is a pure
// phase/number change; expiry hands off to declareGameLost(), the single
// authoritative GAME LOST transition (FINAL RED, penalties, WOMF +3).
setInterval(() => runtimeAction(() => {
  const dirty = [];
  rooms.forEach((room) => {
    if (!room.timer) return;
    const t = room.timer;

    if (t.phase === 'running') {
      t.remaining = Math.max(0, t.remaining - TIMER_TICK_MS);
      if (t.remaining <= 0) {
        t.phase = 'borrowed';
        t.borrowedRemaining = t.borrowedDuration;
        t.borrowedStartedAt = Date.now();
        console.log(`[ROOM ${room.code}] Timer hit 0:00 -- entering BORROWED TIME`);
      }
    } else if (t.phase === 'borrowed') {
      t.borrowedRemaining = Math.max(0, t.borrowedRemaining - TIMER_TICK_MS);
      if (t.borrowedRemaining <= 0) {
        t.phase = 'expired';
        console.log(`[ROOM ${room.code}] Borrowed Time hit 0:00 -- evaluating terminal state`);
        if (declareGameLost(room)) {
          // declareGameLost already persisted and broadcast the terminal state.
          return;
        }
      }
    } else {
      return;
    }

    dirty.push(room);
  });
  dirty.forEach(room => room.revision++);
  if (dirty.length) persistActiveRooms();
  dirty.forEach((room) => {
    broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  });
}), TIMER_TICK_MS);

// Resolves the clue TEXT for a given physical slot per the Progressive
// Clue Queue: for rows 1-4, the difficulty index is this column's reveal
// ORDER position for that row (see sessionState.clueOrder), never the row
// number itself. Row 5 (solution) is unaffected and always direct.
function getCellData(room, column, row) {
  const game = room.gameData;
  if (row >= 1 && row <= 4) {
    const order = room.sessionState.clueOrder && room.sessionState.clueOrder[column];
    const pos = order ? order.indexOf(row) : -1;
    // pos should always be >= 0 here in practice -- getCellData is only
    // ever called (via getPublicState) for cells already marked revealed,
    // and assignClueOrder() runs at the moment a cell is first revealed,
    // before this is read. The `order.length` fallback (next unassigned
    // slot) only guards against a call ordering bug elsewhere; it never
    // reflects two slots sharing one clue.
    const idx = pos !== -1 ? pos : (order ? order.length : row - 1);
    return game.columns[column]?.clues[idx] || '';
  } else if (row === 5) {
    return game.columns[column]?.solution || '';
  }
  return '';
}

// Called exactly once per physical slot, at the moment it is FIRST
// revealed (rows 1-4 only). Appends the row number to that column's queue
// if not already present -- idempotent, and never called on hide, so a
// slot's assigned clue is stable for the rest of the current board.
function assignClueOrder(room, column, row) {
  if (row < 1 || row > 4) return;
  if (!room.sessionState.clueOrder) room.sessionState.clueOrder = { A: [], B: [], C: [], D: [] };
  const order = room.sessionState.clueOrder[column];
  if (!order.includes(row)) order.push(row);
}

// ---------------------------------------------------------------------
// SCORING
//
// Design summary (see README's "Scoring & Player Profiles" section for
// the full writeup): every scoring event is derived from state the room
// already tracks authoritatively (revealed cells, solvedTargets) rather
// than duplicated. Column/Final point events are reversed individually
// when a GM verdict correction undoes them. Column STREAK state is never
// patched incrementally -- after any change to which columns are solved
// by whom, it is fully rebuilt from room.chat.solvedTargets so a GM
// correction can never leave a stale streak bonus in place.
// ---------------------------------------------------------------------

const SCORABLE_COLUMNS = ['A', 'B', 'C', 'D'];
const CORRECT_VERDICT_RESPONSES = [
  'Indeed.',
  'Rejoice, peasants!',
  'Yes.',
  'About time.',
  'Logical conclusion.',
  'Someone activated their neurons today.',
  'Well done, little hero.',
  'Not so free of thought, after all.'
];

function pickCorrectVerdictResponse() {
  return CORRECT_VERDICT_RESPONSES[Math.floor(Math.random() * CORRECT_VERDICT_RESPONSES.length)];
}

function countRevealedCluesInColumn(room, col) {
  let count = 0;
  for (let row = 1; row <= 4; row++) {
    if (room.sessionState.cells[`${col}${row}`] === true) count++;
  }
  return count;
}

function isColumnSolvedGreen(room, column) {
  return !!room.chat?.solvedTargets?.[column]
    || room.sessionState?.cellOutcomes?.[`${column}5`] === 'success';
}

function solvedTargetsForFieldState(room) {
  const solved = { ...(room.chat?.solvedTargets || {}) };
  for (const column of SCORABLE_COLUMNS) {
    if (!solved[column] && room.sessionState?.cellOutcomes?.[`${column}5`] === 'success') {
      solved[column] = {
        solved: true,
        playerId: null,
        playerName: '',
        messageId: null,
        timestamp: null,
        manual: true
      };
    }
  }
  return solved;
}

function countKnownColumns(room) {
  return SCORABLE_COLUMNS.filter(col => isColumnSolvedGreen(room, col)).length;
}

// Per-column/per-target difficulty metadata does not exist in the game
// data model yet -- only an overall BOARD difficulty does. Per the locked
// decision, we must not infer column-level Purple/Black from the board's
// difficulty. This returns null (meaning "not authoritative, don't count
// it") until real per-column difficulty metadata is added to the game
// JSON format.
function getAuthoritativeColumnDifficulty(room, target) {
  return null;
}

function getActiveParticipants(room, includeTestPersonas = true) {
  const participants = [];
  room.players.forEach((player, ws) => {
    if (!includeTestPersonas && player.isTestPersona === true) return;
    if (player.connected !== false) {
      participants.push({ playerId: player.id, playerName: player.name });
    }
  });
  return participants;
}

// ---------------------------------------------------------------------
// MATCH LEDGER hooks (RECOUNT data capture -- see match-ledger.js). The
// ledger rules live in that module; these only bridge it to room state.
// ---------------------------------------------------------------------

function startMatchLedger(room) {
  const hadShownRecount = !!(room.match && room.match.resultsShownAt);
  room.match = matchLedger.createLedger(room.boardId, Date.now(), getActiveParticipants(room, false));
  // A new board (RESET BOARD / NEXT GAME) ends the previous RECOUNT for everyone.
  if (hadShownRecount) broadcastRecount(room, null, false);
}

// RECOUNT delivery. `live` is true ONLY for the moment the host presses SHOW
// RESULTS (clients play the staged reveal); hydration for a late join /
// reconnect is live:false so nobody ever replays it. recount:null closes it.
function broadcastRecount(room, recount, live) {
  broadcastToRoom(room, { type: 'recount:update', recount: recount || null, live: live === true });
}

function sendRecountHydration(ws, room) {
  if (room.match && room.match.recount && room.match.resultsShownAt) {
    sendToWs(ws, { type: 'recount:update', recount: room.match.recount, live: false });
  }
}

// A re-opened match (e.g. a hidden slot or a reversed verdict) voids its RECOUNT.
// Pure mutation: the caller broadcasts recount:null AFTER persisting, so clients
// never see a voided RECOUNT that an immediate crash could roll back.
function voidRecount(room) {
  if (!room.match || (!room.match.recount && !room.match.resultsShownAt)) return false;
  room.match.recount = null;
  room.match.resultsShownAt = null;
  return true;
}

function ensureMatchLedger(room) {
  if (!room.match) startMatchLedger(room);
  return room.match;
}

function countRevealedClueCells(room) {
  let count = 0;
  for (const col of SCORABLE_COLUMNS) count += countRevealedCluesInColumn(room, col);
  return count;
}

// The five fields' current status (solved / failed / revealed / open), derived
// from the authoritative sources. Shared by the completion check and by SHOW
// RESULTS, which rebuilds the archive record from the live ledger.
function currentMatchFields(room) {
  const cells = room.sessionState.cells || {};
  return matchLedger.resolveFields({
    solvedTargets: solvedTargetsForFieldState(room),
    failedColumns: (room.womf && room.womf.failedColumns) || {},
    // "Opened" is the ending parameter: the four column solutions (A5-D5) and
    // the Final solution are each revealed on the board, however that happened.
    revealed: {
      A: cells.A5 === true,
      B: cells.B5 === true,
      C: cells.C5 === true,
      D: cells.D5 === true,
      FINAL: room.sessionState.finalSolution === true
    },
    ledger: ensureMatchLedger(room)
  });
}

// Re-derives per-field resolution from the authoritative sources and moves
// the match between complete/open. Returns 'completed' | 'reopened' | null so
// callers know whether state:public needs to go out. Archiving must never be
// able to break a live game, hence the try/catch.
function refreshGameComplete(room) {
  const ledger = ensureMatchLedger(room);
  const fields = currentMatchFields(room);
  const transition = matchLedger.refreshCompletion(ledger, fields, Date.now());
  try {
    if (transition === 'completed') archiveCompletedMatch(room, fields);
    else if (transition === 'reopened') {
      matchStore.removeMatch(room.boardId);
      voidRecount(room);
    }
  } catch (error) {
    console.error('[match] Archive update failed:', error.message);
  }
  return transition;
}

function archiveCompletedMatch(room, fields) {
  const ledger = room.match;
  const archiveEvents = room.scoring.events.filter(event => !isMasterTestPlayerId(event.playerId));
  const points = matchLedger.matchPointsByPlayer(archiveEvents, room.boardId);
  const pointsByKey = {};
  Object.entries(points).forEach(([playerId, entry]) => {
    pointsByKey[playerId] = (pointsByKey[playerId] || 0) + entry.points;
  });
  // Any judged/active/present player with no scoring event still took part.
  // ledger.presence is keyed by the authenticated player/account id.
  Object.entries(ledger.presence).forEach(([playerId]) => {
    if (!(playerId in pointsByKey)) pointsByKey[playerId] = 0;
  });

  const record = matchLedger.buildArchiveRecord({
    matchId: room.boardId,
    roomCode: room.code,
    gameId: room.gameId,
    title: room.gameData && room.gameData.title,
    difficulty: room.gameData && room.gameData.difficulty,
    ledger,
    fields,
    events: archiveEvents,
    gameWon: room.sessionState.gameWon === true,
    matchResult: room.sessionState.matchResult || null,
    standings: matchLedger.computeStandings(playerStore.loadPlayers(), pointsByKey),
    keyFn: (name, id) => id || playerStore.normalizeNameKey(name),
    now: Date.now()
  });
  // Only matches whose RESULTS WERE SHOWN count as history: a REVEAL ALL /
  // test completion the host never showed must not skew career averages.
  const history = matchStore.listMatches().filter(match => match.matchId !== record.matchId && match.resultsShownAt);
  record.recount = recountEngine.computeRecount({
    match: record,
    history,
    profiles: playerStore.loadPlayers(),
    keyFn: (name, id) => id || playerStore.normalizeNameKey(name),
    seed: record.matchId
  });
  if (room.sessionState.matchResult?.outcome === 'LOST') {
    record.recount.outcome = 'LOST';
    record.recount.topLabel = record.recount.topPerformers.length > 1 ? 'TOP PERFORMERS' : 'TOP PERFORMER';
    record.recount.topPerformers = record.recount.scoreboard.filter(row => row.rank === 1)
      .map(row => ({ name: row.name, points: row.points }));
    record.recount.lossFindings = room.sessionState.matchResult.awards || [];
    room.sessionState.matchResult.recount = record.recount;
  }
  matchStore.upsertMatch(record);
  return record;
}

function ensureSessionPlayerEntry(room, playerId, playerName) {
  if (!room.scoring.players[playerId]) {
    room.scoring.players[playerId] = { name: playerName, sessionScore: 0 };
  } else {
    room.scoring.players[playerId].name = playerName; // keep display name fresh
  }
  return room.scoring.players[playerId];
}

// Applies (or reverses, with a negative `points`) a point change to both
// the in-memory CURRENT SESSION score and the persistent ALL-TIME profile.
// These two are never merged into one number -- see README.
function adjustPlayerScore(room, playerId, playerName, points) {
  const entry = ensureSessionPlayerEntry(room, playerId, playerName);
  entry.sessionScore += points;
  if (!isMasterTestPlayerId(playerId)) {
    playerStore.adjustProfile({ id: playerId, name: playerName }, { pointsDelta: points });
  }
}

function adjustPersistentStats(playerId, playerName, statDeltas) {
  if (isMasterTestPlayerId(playerId)) return;
  playerStore.adjustProfile({ id: playerId, name: playerName }, { statDeltas });
}

function recordPersistentEarliestFinal(playerId, playerName, columnsKnownAtSolve) {
  if (isMasterTestPlayerId(playerId)) return;
  playerStore.maybeRecordEarliestFinal({ id: playerId, name: playerName }, columnsKnownAtSolve);
}

function recordPersistentBestStreak(playerId, playerName, streakLength) {
  if (isMasterTestPlayerId(playerId)) return;
  playerStore.maybeRecordBestStreak({ id: playerId, name: playerName }, streakLength);
}

function recordPersistentBoardFinalization(playerId, playerName, won) {
  if (isMasterTestPlayerId(playerId)) return;
  playerStore.recordBoardFinalization({ id: playerId, name: playerName }, { won });
}

function recordEvent(room, fields) {
  const event = {
    eventId: generateEventId(),
    gameId: room.gameId,
    boardId: room.boardId,
    sourceMessageId: fields.sourceMessageId || null,
    target: fields.target || null,
    type: fields.type,
    playerId: fields.playerId,
    playerName: fields.playerName,
    points: fields.points,
    timestamp: Date.now(),
    cluesRevealed: fields.cluesRevealed ?? null,
    columnsKnownAtSolve: fields.columnsKnownAtSolve ?? null,
    streakLength: fields.streakLength ?? null,
    difficulty: fields.difficulty ?? null,
    // Column events only: the points BEFORE the after-Final reduction, and
    // whether the reduction applied. reconcileColumnPoints() re-derives
    // `points` from these whenever a verdict correction changes the order.
    basePoints: fields.basePoints ?? null,
    afterFinal: fields.afterFinal ?? null
  };
  room.scoring.events.push(event);
  return event;
}

// Once the FINAL has been solved, every column solved AFTER it scores
// COLUMN_SCORE_MULTIPLIER_AFTER_FINAL of its normal value (it is easier to hit
// with the meta answer known). Whether a column is "after" is decided by the
// authoritative solve order (chat.solvedTargets timestamps), never by a cached
// flag, so a GM verdict correction -- reversing or re-accepting the Final, or
// re-solving a column -- can never leave a stale reduction (or a stale full
// score) behind. Mirrors rebuildColumnStreaks' deterministic-rebuild approach.
// Streak bonuses are separate events and are intentionally not reduced.
// Returns true when any score moved.
function reconcileColumnPoints(room) {
  const finalSolve = room.chat.solvedTargets.FINAL;
  let changed = false;
  for (const event of room.scoring.events) {
    if (event.boardId !== room.boardId || event.type !== 'column' || typeof event.basePoints !== 'number') continue;
    const columnSolve = room.chat.solvedTargets[event.target];
    const after = !!(finalSolve && columnSolve && columnSolve.timestamp > finalSolve.timestamp);
    const expected = after
      ? Math.round(event.basePoints * scoring.COLUMN_SCORE_MULTIPLIER_AFTER_FINAL)
      : event.basePoints;
    if (expected === event.points && event.afterFinal === after) continue;
    if (expected !== event.points) {
      adjustPlayerScore(room, event.playerId, event.playerName, expected - event.points);
    }
    event.points = expected;
    event.afterFinal = after;
    changed = true;
  }
  return changed;
}

// Result shape from award/reverse helpers: { rejected, reason } on failure,
// { event } on success -- callers broadcast `score:event` only on success.
function awardColumnSolve(room, target, message) {
  const cluesRevealed = countRevealedCluesInColumn(room, target);
  if (cluesRevealed < 1) {
    return { rejected: true, reason: `Column ${target} has no revealed clues -- cannot award a column score.` };
  }

  const basePoints = scoring.COLUMN_SCORE_BY_CLUES[Math.min(cluesRevealed, 4)];
  // This column is being solved NOW, so any existing real Final solve is
  // earlier: the after-Final reduction applies (see reconcileColumnPoints).
  const afterFinal = !!room.chat.solvedTargets.FINAL;
  const points = afterFinal
    ? Math.round(basePoints * scoring.COLUMN_SCORE_MULTIPLIER_AFTER_FINAL)
    : basePoints;
  const difficulty = getAuthoritativeColumnDifficulty(room, target);

  const event = recordEvent(room, {
    type: 'column',
    target,
    sourceMessageId: message.id,
    playerId: message.playerId,
    playerName: message.playerName,
    points,
    basePoints,
    afterFinal,
    cluesRevealed,
    difficulty
  });

  adjustPlayerScore(room, message.playerId, message.playerName, points);

  const statDeltas = { columnSolutions: 1 };
  if (cluesRevealed === 1) statDeltas.oneClueColumnSolutions = 1;
  if (difficulty === 'PURPLE') statDeltas.purpleSolves = 1;
  if (difficulty === 'BLACK') statDeltas.blackSolves = 1;
  adjustPersistentStats(message.playerId, message.playerName, statDeltas);

  rebuildColumnStreaks(room);

  return { event };
}

function reverseColumnSolve(room, target) {
  const idx = room.scoring.events.findIndex(
    e => e.boardId === room.boardId && e.type === 'column' && e.target === target
  );
  if (idx === -1) {
    rebuildColumnStreaks(room);
    return; // nothing was ever scored for this column (e.g. it had 0 revealed clues) -- fine
  }

  const event = room.scoring.events[idx];
  room.scoring.events.splice(idx, 1);
  adjustPlayerScore(room, event.playerId, event.playerName, -event.points);

  const statDeltas = { columnSolutions: -1 };
  if (event.cluesRevealed === 1) statDeltas.oneClueColumnSolutions = -1;
  if (event.difficulty === 'PURPLE') statDeltas.purpleSolves = -1;
  if (event.difficulty === 'BLACK') statDeltas.blackSolves = -1;
  adjustPersistentStats(event.playerId, event.playerName, statDeltas);

  rebuildColumnStreaks(room);
}

function awardFinalSolve(room, message) {
  const columnsKnownAtSolve = countKnownColumns(room);
  if (columnsKnownAtSolve < 1) {
    return { rejected: true, reason: 'No column solution is known yet -- the Final cannot be scored until at least one column is solved.' };
  }

  const points = scoring.FINAL_SCORE_BY_COLUMNS[Math.min(columnsKnownAtSolve, 4)];

  const event = recordEvent(room, {
    type: 'final',
    target: 'FINAL',
    sourceMessageId: message.id,
    playerId: message.playerId,
    playerName: message.playerName,
    points,
    columnsKnownAtSolve
  });

  adjustPlayerScore(room, message.playerId, message.playerName, points);

  const isEarly = columnsKnownAtSolve < 4;
  const statDeltas = { finalSolutions: 1 };
  if (isEarly) statDeltas.earlyFinalSolutions = 1;
  adjustPersistentStats(message.playerId, message.playerName, statDeltas);
  recordPersistentEarliestFinal(message.playerId, message.playerName, columnsKnownAtSolve);

  return { event };
}

function reverseFinalSolve(room) {
  const idx = room.scoring.events.findIndex(e => e.boardId === room.boardId && e.type === 'final');
  if (idx === -1) return;

  const event = room.scoring.events[idx];
  room.scoring.events.splice(idx, 1);
  adjustPlayerScore(room, event.playerId, event.playerName, -event.points);

  const statDeltas = { finalSolutions: -1 };
  if (event.columnsKnownAtSolve < 4) statDeltas.earlyFinalSolutions = -1;
  adjustPersistentStats(event.playerId, event.playerName, statDeltas);
  // earliestFinalColumnsKnown is an intentionally one-way "best ever"
  // record (see player-store.js) -- a reversal does not attempt to roll
  // it back to some previous value we no longer know.
}

// Deterministically rebuilds this board's column-streak state from the
// CURRENT, authoritative room.chat.solvedTargets -- never patched
// incrementally. Removes every existing streak-type event for this board,
// reverses their point effects, then replays solvedTargets in timestamp
// order to regenerate whichever milestones the corrected history actually
// earns.
function rebuildColumnStreaks(room) {
  const staleStreakEvents = room.scoring.events.filter(
    e => e.boardId === room.boardId && e.type === 'streak'
  );
  for (const event of staleStreakEvents) {
    adjustPlayerScore(room, event.playerId, event.playerName, -event.points);
  }
  room.scoring.events = room.scoring.events.filter(
    e => !(e.boardId === room.boardId && e.type === 'streak')
  );

  const solves = SCORABLE_COLUMNS
    .map(col => ({ col, ...room.chat.solvedTargets[col] }))
    .filter(s => s.solved)
    .sort((a, b) => a.timestamp - b.timestamp);

  let streakPlayerId = null;
  let streakPlayerName = null;
  let streakLength = 0;

  for (const solve of solves) {
    if (solve.playerId === streakPlayerId) {
      streakLength += 1;
    } else {
      streakPlayerId = solve.playerId;
      streakPlayerName = solve.playerName;
      streakLength = 1;
    }

    const bonus = scoring.STREAK_MILESTONE_BONUS[streakLength];
    if (bonus) {
      recordEvent(room, {
        type: 'streak',
        target: solve.col,
        sourceMessageId: solve.messageId,
        playerId: streakPlayerId,
        playerName: streakPlayerName,
        points: bonus,
        streakLength
      });
      adjustPlayerScore(room, streakPlayerId, streakPlayerName, bonus);
      recordPersistentBestStreak(streakPlayerId, streakPlayerName, streakLength);
    }
  }

  room.scoring.activeStreak = streakPlayerId
    ? { playerId: streakPlayerId, playerName: streakPlayerName, columnCount: streakLength }
    : null;
}

// Board finalization -- called exactly once per board, guarded by
// room.scoring.boardFinalized so a duplicate success/failure signal (e.g.
// a GM double-click) can never double-apply gamesPlayed/gamesWon or the
// failed-Final penalty.
function finalizeBoard(room, outcome) {
  if (room.scoring.boardFinalized) return { alreadyFinalized: true };
  room.scoring.boardFinalized = true;

  // Timer: the Final has now been resolved, success OR GM-declared failure
  // (a success reaching here during Borrowed Time counts exactly the same
  // as any other success -- this function doesn't even look at outcome to
  // decide that). Freeze whatever countdown was active/paused so the HUD
  // stops moving; this is purely a display change, never a trigger for
  // anything else (no scoring/WOMF side effect lives here -- those already
  // happened via the GM's own explicit action that called into this
  // function in the first place).
  stopClock(room);

  const participants = getActiveParticipants(room);
  const penaltyEvents = [];
  // Remembered so a GM correction of a FINAL verdict can reverse exactly the
  // gamesPlayed/gamesWon it credited (see unfinalizeBoard).
  room.scoring.finalizedParticipants = outcome === 'success'
    ? participants.map(({ playerId, playerName }) => ({ playerId, playerName }))
    : null;

  participants.forEach(({ playerId, playerName }) => {
    if (outcome === 'success') {
      recordPersistentBoardFinalization(playerId, playerName, true);
    } else {
      const event = recordEvent(room, {
        type: 'failedFinal',
        target: 'FINAL',
        playerId,
        playerName,
        points: -scoring.FAILED_FINAL_PENALTY
      });
      adjustPlayerScore(room, playerId, playerName, -scoring.FAILED_FINAL_PENALTY);
      recordPersistentBoardFinalization(playerId, playerName, false);
      penaltyEvents.push(event);
    }
  });

  return { participants, penaltyEvents };
}

// Undo of a mistaken FINAL GREEN (the GM corrects the verdict to WRONG or
// retargets it). The board goes back to exactly the live state it left:
// Final hidden again, clock resumed, withheld results dropped, and the
// win credited to every participant's lifetime profile reversed. Only a
// board finalized as a success by a FINAL verdict is ever reopened here --
// GAME WON / GAME LOST (matchResult) stay final.
function unfinalizeBoard(room) {
  if (!room.scoring.boardFinalized || room.sessionState.matchResult) return false;
  room.scoring.boardFinalized = false;
  room.scoring.pendingResults = null;
  for (const { playerId, playerName } of room.scoring.finalizedParticipants || []) {
    adjustPersistentStats(playerId, playerName, { gamesPlayed: -1, gamesWon: -1 });
  }
  room.scoring.finalizedParticipants = null;
  room.sessionState.finalSolution = false;
  room.sessionState.finalOutcome = null;
  resumeStoppedClock(room);
  return true;
}

function applyCommand(room, command, payload) {
  if (room.sessionState.matchResult && command !== 'resetBoard') {
    return { success: false, error: `GAME ${room.sessionState.matchResult.outcome} // gameplay controls locked` };
  }
  let changed = false;

  switch (command) {
    case 'revealCell': {
      // Pre-existing bug fix: this used to ignore payload.reveal and always
      // set the cell true, so the GM's per-cell HIDE toggle (which sends
      // this same command with reveal:false) only ever looked like it
      // worked via the client's own optimistic local update -- the server
      // saw "already true" as no change and never broadcast it, so players
      // (and the GM on reconnect) never actually saw it hidden. Both
      // directions are now handled here explicitly.
      const { cell, reveal = true } = payload;
      if (!isValidCell(cell)) return { success: false, error: 'Invalid cell' };
      const [col, row] = [cell[0], parseInt(cell.slice(1), 10)];
      const key = `${col}${row}`;
      if (reveal) {
        if (room.sessionState.cells[key] !== true) {
          room.sessionState.cells[key] = true;
          assignClueOrder(room, col, row);
          changed = true;
        }
      } else {
        if (room.sessionState.cells[key] === true) {
          room.sessionState.cells[key] = false;
          changed = true;
        }
        // A manual hide is the GM correcting/undoing -- it clears any WOMF
        // "failed" outcome tag on that cell, same as hideFinal already does
        // for finalOutcome. If it's re-revealed later it comes back as a
        // normal reveal, not red. Note: clueOrder is deliberately NOT
        // touched here -- once a slot has been assigned a clue, hiding and
        // re-revealing it must show the exact same clue (locked spec).
        if (room.sessionState.cellOutcomes && room.sessionState.cellOutcomes[key]) {
          delete room.sessionState.cellOutcomes[key];
          changed = true;
        }
      }
      break;
    }
    case 'resolveColumn': {
      const { column, outcome } = payload || {};
      if (SCORABLE_COLUMNS.includes(column)) clearSolutionCountdown(room, column);
      if (!isBattleSurface(room)) return { success: false, error: 'Columns can only be resolved on the Battle surface' };
      if (!SCORABLE_COLUMNS.includes(column)) return { success: false, error: 'Invalid column' };
      if (!['success', 'failed'].includes(outcome)) return { success: false, error: 'Invalid column outcome' };

      const key = `${column}5`;
      const existingOutcome = room.sessionState.cellOutcomes?.[key] || null;

      if (room.chat.solvedTargets[column]) {
        return { success: false, error: `Column ${column} has already been solved from chat` };
      }
      if (existingOutcome && existingOutcome !== outcome) {
        return { success: false, error: `Column ${column} has already been resolved ${existingOutcome.toUpperCase()}` };
      }
      if (outcome === 'success' && room.womf?.failedColumns?.[column]) {
        return { success: false, error: `Column ${column} has already been declared failed` };
      }

      if (outcome === 'success') {
        // GREEN means the column is officially solved. Reveal every remaining
        // clue pill plus the solution pill in one authoritative transaction.
        // assignClueOrder preserves the progressive clue-queue contract for
        // any slots that had not been opened before the solve.
        for (let row = 1; row <= 5; row++) {
          const cellKey = `${column}${row}`;
          if (room.sessionState.cells[cellKey] !== true) {
            room.sessionState.cells[cellKey] = true;
            assignClueOrder(room, column, row);
            changed = true;
          }
        }
      } else if (room.sessionState.cells[key] !== true) {
        // RED is intentionally different: a failed column is only declared
        // after its four clues are already active, so only force-reveal A5-D5.
        room.sessionState.cells[key] = true;
        changed = true;
      }

      room.sessionState.cellOutcomes ||= {};
      if (room.sessionState.cellOutcomes[key] !== outcome) {
        room.sessionState.cellOutcomes[key] = outcome;
        changed = true;
      }

      if (outcome === 'failed') {
        if (!room.womf) room.womf = { charge: 0, failedColumns: {} };
        if (!room.womf.failedColumns[column]) {
          room.womf.failedColumns[column] = true;
          addWomfCharge(room, 1);
        }
        matchLedger.markFailed(ensureMatchLedger(room), column, Date.now());
      }

      break;
    }
    case 'hideCell': {
      const { cell } = payload;
      if (!isValidCell(cell)) return { success: false, error: 'Invalid cell' };
      const [col, row] = [cell[0], parseInt(cell.slice(1), 10)];
      const key = `${col}${row}`;
      if (room.sessionState.cells[key] === true) {
        room.sessionState.cells[key] = false;
        changed = true;
      }
      // A manual hide is the GM correcting/undoing -- it clears any WOMF
      // "failed" outcome tag on that cell, same as hideFinal already does
      // for finalOutcome. If it's re-revealed later it comes back as a
      // normal reveal, not red.
      if (room.sessionState.cellOutcomes && room.sessionState.cellOutcomes[key]) {
        delete room.sessionState.cellOutcomes[key];
        changed = true;
      }
      break;
    }
    case 'revealColumn': {
      const { column } = payload;
      if (!['A', 'B', 'C', 'D'].includes(column)) return { success: false, error: 'Invalid column' };
      for (let row = 1; row <= 5; row++) {
        const key = `${column}${row}`;
        if (room.sessionState.cells[key] !== true) {
          room.sessionState.cells[key] = true;
          assignClueOrder(room, column, row);
          changed = true;
        }
      }
      break;
    }
    case 'hideColumn': {
      const { column } = payload;
      if (!['A', 'B', 'C', 'D'].includes(column)) return { success: false, error: 'Invalid column' };
      for (let row = 1; row <= 5; row++) {
        const key = `${column}${row}`;
        if (room.sessionState.cells[key] === true) {
          room.sessionState.cells[key] = false;
          changed = true;
        }
        if (room.sessionState.cellOutcomes && room.sessionState.cellOutcomes[key]) {
          delete room.sessionState.cellOutcomes[key];
          changed = true;
        }
      }
      break;
    }
    case 'revealAll': {
      const columns = ['A', 'B', 'C', 'D'];
      columns.forEach(col => {
        for (let row = 1; row <= 5; row++) {
          const key = `${col}${row}`;
          if (room.sessionState.cells[key] !== true) {
            room.sessionState.cells[key] = true;
            assignClueOrder(room, col, row);
            changed = true;
          }
        }
      });
      if (room.sessionState.finalSolution !== true) {
        room.sessionState.finalSolution = true;
        room.sessionState.finalOutcome = room.sessionState.finalOutcome || 'success';
        changed = true;
      }
      // Answers shown mid-battle: nobody can still earn the Final, so the
      // clock must not keep running toward an automatic outcome. The GM
      // decides GAME WON / GAME LOST; hiding the Final again resumes play.
      if (room.roomMode === ROOM_MODES.BATTLE && stopClock(room)) changed = true;
      break;
    }
    case 'hideAll': {
      const columns = ['A', 'B', 'C', 'D'];
      columns.forEach(col => {
        for (let row = 1; row <= 5; row++) {
          const key = `${col}${row}`;
          if (room.sessionState.cells[key] === true) {
            room.sessionState.cells[key] = false;
            changed = true;
          }
        }
      });
      if (room.sessionState.finalSolution === true) {
        room.sessionState.finalSolution = false;
        room.sessionState.finalOutcome = null;
        changed = true;
      }
      room.sessionState.cellOutcomes = {};
      if (!room.scoring.boardFinalized && resumeStoppedClock(room)) changed = true;
      break;
    }
    case 'revealFinal': {
      if (room.sessionState.finalSolution !== true) {
        room.sessionState.finalSolution = true;
        room.sessionState.finalOutcome = room.sessionState.finalOutcome || 'success';
        changed = true;
      }
      if (room.roomMode === ROOM_MODES.BATTLE && stopClock(room)) changed = true;
      break;
    }
    case 'hideFinal': {
      if (room.sessionState.finalSolution === true) {
        room.sessionState.finalSolution = false;
        room.sessionState.finalOutcome = null;
        changed = true;
      }
      // A GM-revealed Final hidden again resumes the battle. A Final the
      // players actually solved keeps the board finalized (clock stopped).
      if (!room.scoring.boardFinalized && resumeStoppedClock(room)) changed = true;
      break;
    }
    case 'resetBoard': {
      // RESET BOARD is an authoritative fresh attempt even if every cell is
      // currently hidden. Rebuild sessionState unconditionally so hidden
      // clue-queue assignments/outcome tags cannot survive a reset, and mark
      // the command changed so clients always receive the reset Timer/Wheel/
      // scoring/chat state that is rebuilt below.
      room.sessionState = { cells: {}, finalSolution: false, finalOutcome: null, gameWon: false, matchResult: null, cellOutcomes: {}, clueOrder: { A: [], B: [], C: [], D: [] } };
      changed = true;
      // A reset re-attempts the SAME board from scratch: mint a fresh
      // boardId (so a future streak rebuild only ever looks at solves that
      // happened after this reset) and clear per-board scoring state.
      // Session score and all-time profiles are untouched.
      room.boardId = generateBoardId();
      room.pendingReveals = {};
      room.solutionCountdowns = {};
      room.hintClaims = {};
      startMatchLedger(room); // new board id => new match ledger
      room.scoring.activeStreak = null;
      room.scoring.boardFinalized = false;
      room.scoring.pendingResults = null;
      room.scoring.finalizedParticipants = null;
      room.chat.solvedTargets = {};
      // Same treatment as scoring.activeStreak: per-board only, WOMF charge
      // itself is untouched by a board reset.
      if (!room.womf) room.womf = { charge: 0, failedColumns: {} };
      room.womf.failedColumns = {};
      // A wheel opened for the board being reset no longer makes sense --
      // close it. WOMF charge itself is untouched (see above).
      resetWheel(room);
      // Same treatment as the Wheel: a reset board is a fresh attempt, so
      // the Timer goes back to a fresh, un-started 'ready' countdown at the
      // current difficulty's duration -- the GM must press START GAME again.
      resetTimer(room);
      room.roomMode = ROOM_MODES.BATTLE_ARMED;
      room.armed = true;
      startRitual(room);
      broadcastRitualState(room);
      break;
    }
    case 'changeBackground': {
      const { background } = payload;
      if (room.currentBackground !== background) {
        room.currentBackground = background;
        changed = true;
      }
      break;
    }
    case 'setDifficulty': {
      const { difficulty } = payload;
      if (!gameStore.DIFFICULTY_VALUES.includes(difficulty)) {
        return { success: false, error: 'Invalid difficulty' };
      }
      // Decorative, session-only override -- mirrors changeBackground: it
      // updates the in-memory room.gameData (what getPublicState reads),
      // never the game file on disk.
      if (room.gameData.difficulty !== difficulty) {
        room.gameData.difficulty = difficulty;
        changed = true;
        // Timer: the default duration follows a difficulty change only when
        // the Timer hasn't started yet (still 'ready') -- once the GM has
        // pressed START GAME, changing difficulty must NOT silently rewrite
        // the active countdown (locked spec, item 12).
        if (!room.timer || room.timer.phase === 'ready') {
          resetTimer(room);
        }
      }
      break;
    }
    case 'undo': {
      return { success: false, error: 'Undo must be handled client-side' };
    }
    default:
      return { success: false, error: 'Unknown command' };
  }

  // Opening or hiding a solution slot (reveal/hide/REVEAL ALL/...) can
  // complete or re-open the match: the whole field opened is the game's end.
  const transition = refreshGameComplete(room);
  if (transition) changed = true;
  if (transition === 'reopened' && room.roomMode === ROOM_MODES.RECOUNT) {
    room.roomMode = room.timer?.phase === 'ready' ? ROOM_MODES.BATTLE_ARMED : ROOM_MODES.BATTLE;
    room.armed = true;
  }

  if (changed) {
    room.revision++;
  }

  return { success: true, changed, revision: room.revision, recountClosed: transition === 'reopened' };
}

function isValidCell(cell) {
  // Commands must address one exact physical board slot. parseInt-based
  // validation accepted malformed values such as "A1junk" as A1.
  return typeof cell === 'string' && /^[A-D][1-5]$/.test(cell);
}

function isValidTarget(target) {
  return ['A', 'B', 'C', 'D', 'FINAL'].includes(target);
}

function applyVerdict(room, messageId, verdict, target = null, reveal = false) {
  const msgIndex = room.chat.messages.findIndex(m => m.id === messageId);
  if (msgIndex === -1) {
    return { success: false, error: 'Message not found' };
  }

  const message = room.chat.messages[msgIndex];
  if (room.roomMode !== ROOM_MODES.BATTLE || room.sessionState.matchResult || message.source || message.boardId !== room.boardId) {
    return { success: false, error: 'Historical transmission is outside the active game and cannot be judged' };
  }
  if (room.pendingReveals) {
    for (const [column, action] of Object.entries(room.pendingReveals)) {
      if (action.messageId === messageId && (verdict !== 'correct' || column !== target)) delete room.pendingReveals[column];
    }
  }
  const oldVerdict = message.verdict;
  const oldTarget = message.target;
  let changed = false;
  let scoreWarning = null;
  let newAward = null;
  let finalOutcome = null;
  let streakChanged = false;

  // verdict null = CLEAR (the GM toggled WRONG back off): the message goes
  // back to unjudged and stops being a ledger attempt. Any credit it held is
  // unwound below exactly like CORRECT -> WRONG; nothing is awarded.
  message.verdict = verdict;
  message.target = verdict === 'correct' ? target : null;
  if (verdict === 'correct' && target) clearSolutionCountdown(room, target);
  // MATCH LEDGER: a GM-judged message IS an attempt (and only judged
  // messages are). Upserted by message id, so a flipped/retargeted verdict
  // simply updates the same attempt.
  if (verdict === null) matchLedger.removeAttempt(ensureMatchLedger(room), message.id);
  else matchLedger.recordAttempt(ensureMatchLedger(room), {
    messageId: message.id,
    playerId: message.playerId,
    playerName: message.playerName,
    submittedAt: message.timestamp,
    verdict,
    target,
    text: message.text,
    cluesRevealedTotal: countRevealedClueCells(room),
    now: Date.now()
  });
  if (verdict === 'correct') {
    if (oldVerdict !== 'correct' || !message.verdictResponse) {
      message.verdictResponse = pickCorrectVerdictResponse();
    }
  } else {
    message.verdictResponse = null;
  }

  // Unwind whatever this message previously had credit for, whenever the
  // verdict is no longer 'correct' for that same target -- covers both
  // CORRECT -> WRONG (existing behavior) and CORRECT(target=X) ->
  // CORRECT(target=Y), a retarget that the old code left half-applied
  // (solvedTargets[X] was never cleared, so X stayed "solved" forever).
  const losingOldCredit = oldVerdict === 'correct' && oldTarget && (verdict !== 'correct' || target !== oldTarget);
  if (losingOldCredit) {
    const oldSolvedKey = oldTarget === 'FINAL' ? 'FINAL' : oldTarget;
    const oldRecord = room.chat.solvedTargets[oldSolvedKey];
    if (oldRecord && oldRecord.messageId === message.id) {
      delete room.chat.solvedTargets[oldSolvedKey];
      if (oldTarget === 'FINAL') {
        reverseFinalSolve(room);
        if (unfinalizeBoard(room)) changed = true;
      } else {
        reverseColumnSolve(room, oldTarget);
        streakChanged = true;
      }
    }
  }

  if (verdict === 'correct' && target && isValidTarget(target)) {
    const solvedKey = target === 'FINAL' ? 'FINAL' : target;
    if (!room.chat.solvedTargets[solvedKey]) {
      room.chat.solvedTargets[solvedKey] = {
        solved: true,
        playerId: message.playerId,
        playerName: message.playerName,
        messageId: message.id,
        timestamp: Date.now()
      };

      if (target === 'FINAL') {
        const result = awardFinalSolve(room, message);
        if (result.rejected) {
          scoreWarning = result.reason;
        } else {
          newAward = { awardType: 'final', target, points: result.event.points, columnsKnownAtSolve: result.event.columnsKnownAtSolve, playerName: message.playerName };
        }
        // The board is won the moment Final is correctly solved, regardless
        // of whether the jackpot itself could be scored (see spec: FINAL
        // scoring and board finalization are related but separate).
        const finalizeResult = finalizeBoard(room, 'success');
        if (!finalizeResult.alreadyFinalized) {
          // NOTE: accepting the Final is deliberately NOT a victory. The game
          // continues -- players can still solve the remaining columns -- so
          // GAME WON stays the host's manual call (handleGmGameWon).
          // The Final reveal goes out immediately, but the narrative no longer
          // does: STORY is reserved for the post-game AFTERMATH sequence once
          // GAME WON / GAME LOST has been declared. The point/penalty numbers
          // remain independently gated by gm:revealResults while unresolved
          // columns can still be played.
          room.scoring.pendingResults = {
            outcome: 'success',
            columnsKnownAtSolve: result.event ? result.event.columnsKnownAtSolve : countKnownColumns(room),
            points: result.event ? result.event.points : 0,
            playerName: message.playerName
          };
          finalOutcome = {
            outcome: 'success',
            correctSolution: room.gameData.finalSolution || '',
            columnSolutions: {
              A: room.gameData.columns?.A?.solution || '',
              B: room.gameData.columns?.B?.solution || '',
              C: room.gameData.columns?.C?.solution || '',
              D: room.gameData.columns?.D?.solution || ''
            }
          };
        }
      } else {
        const result = awardColumnSolve(room, target, message);
        if (result.rejected) {
          scoreWarning = result.reason;
        } else {
          newAward = { awardType: 'column', target, points: result.event.points, cluesRevealed: result.event.cluesRevealed, afterFinal: result.event.afterFinal === true, playerName: message.playerName };
        }
        streakChanged = true;
      }
    }

    if (reveal && target === 'FINAL') {
      if (room.sessionState.finalSolution !== true) {
        room.sessionState.finalSolution = true;
        room.sessionState.finalOutcome = 'success';
        changed = true;
      }
    }
  }

  // A verdict correction can change whether a column was solved before or
  // after the Final (the after-Final reduction) -- re-derive from solve order.
  reconcileColumnPoints(room);

  // Solves/reversals above may have resolved or re-opened a field.
  if (refreshGameComplete(room)) changed = true;

  if (changed) {
    room.revision++;
  }

  return { success: true, changed, revision: room.revision, message, scoreWarning, newAward, finalOutcome, streakChanged };
}



function resolveGifRequestActor(req, room) {
  const gmToken = String(req.headers['x-gm-token'] || '');
  if (gmToken && isValidGmToken(gmToken)) {
    return { role: 'gm', id: '__GM__', name: 'SHADOW BROKER' };
  }
  const playerToken = String(req.headers['x-player-token'] || '');
  const auth = getPlayerAuth(playerToken);
  if (!auth?.playerId) return null;
  const live = Array.from(room.players.values()).find(player => String(player.id) === String(auth.playerId));
  if (!live) return null;
  return { role: 'player', id: String(live.id), name: live.name || 'LITTLE HERO' };
}

function gifQuotaFor(actor, now = Date.now()) {
  pruneGifApiHits(now);
  const globalHits = gifApiUsage.globalHits || [];
  const playerHits = actor?.role === 'player'
    ? (gifApiUsage.playerHits[String(actor.id)] || [])
    : [];
  const globalUsed = globalHits.length;
  const playerUsed = playerHits.length;
  const globalResetAt = globalHits.length ? Number(globalHits[0]) + GIF_API_WINDOW_MS : now;
  const playerResetAt = playerHits.length ? Number(playerHits[0]) + GIF_API_WINDOW_MS : now;
  return {
    globalUsed,
    globalLimit: GIF_API_GLOBAL_LIMIT,
    globalRemaining: Math.max(0, GIF_API_GLOBAL_LIMIT - globalUsed),
    globalResetAt,
    playerUsed,
    playerLimit: actor?.role === 'player' ? GIF_API_PLAYER_LIMIT : null,
    playerRemaining: actor?.role === 'player' ? Math.max(0, GIF_API_PLAYER_LIMIT - playerUsed) : null,
    playerResetAt: actor?.role === 'player' ? playerResetAt : null
  };
}

function reserveGifApiCall(actor) {
  const now = Date.now();
  const quota = gifQuotaFor(actor, now);
  if (quota.globalRemaining <= 0) {
    return { ok: false, scope: 'global', quota, retryAfterMs: Math.max(1000, quota.globalResetAt - now) };
  }
  if (actor?.role === 'player' && quota.playerRemaining <= 0) {
    return { ok: false, scope: 'player', quota, retryAfterMs: Math.max(1000, quota.playerResetAt - now) };
  }
  gifApiUsage.globalHits.push(now);
  if (actor?.role === 'player') {
    const id = String(actor.id);
    gifApiUsage.playerHits[id] ||= [];
    gifApiUsage.playerHits[id].push(now);
  }
  saveGifApiUsage();
  return { ok: true, quota: gifQuotaFor(actor, now) };
}

function isAllowedGiphyUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'giphy.com' || host.endsWith('.giphy.com') || host.endsWith('.giphy.net');
  } catch {
    return false;
  }
}

function normalizeGiphyItem(item) {
  if (!item || typeof item !== 'object') return null;
  const images = item.images || {};
  const previewUrl =
    images.fixed_width_small?.webp ||
    images.fixed_width?.webp ||
    images.fixed_width_small?.url ||
    images.fixed_width?.url ||
    images.downsized_still?.url ||
    '';
  const mp4Url =
    images.fixed_width?.mp4 ||
    images.downsized_small?.mp4 ||
    images.original?.mp4 ||
    '';
  const gifUrl =
    images.original?.url ||
    images.downsized?.url ||
    images.fixed_width?.url ||
    '';
  const pageUrl = typeof item.url === 'string' ? item.url : '';
  if (!isAllowedGiphyUrl(previewUrl) || !isAllowedGiphyUrl(gifUrl)) return null;
  if (mp4Url && !isAllowedGiphyUrl(mp4Url)) return null;
  if (pageUrl && !isAllowedGiphyUrl(pageUrl)) return null;
  const rawWidth = Number(images.fixed_width?.width || images.original?.width || 0);
  const rawHeight = Number(images.fixed_width?.height || images.original?.height || 0);
  return {
    provider: 'giphy',
    providerId: String(item.id || '').slice(0, 120),
    title: sanitizeText(item.title || 'GIF').slice(0, 120),
    previewUrl,
    mp4Url,
    gifUrl,
    pageUrl,
    width: Number.isFinite(rawWidth) && rawWidth > 0 ? Math.min(2000, rawWidth) : 320,
    height: Number.isFinite(rawHeight) && rawHeight > 0 ? Math.min(2000, rawHeight) : 240
  };
}

function normalizeRemoteGifPayload(raw) {
  if (!raw || typeof raw !== 'object' || raw.provider !== 'giphy') return null;
  const normalized = {
    provider: 'giphy',
    providerId: String(raw.providerId || '').slice(0, 120),
    title: sanitizeText(raw.title || 'GIF').slice(0, 120),
    previewUrl: String(raw.previewUrl || ''),
    mp4Url: String(raw.mp4Url || ''),
    gifUrl: String(raw.gifUrl || ''),
    pageUrl: String(raw.pageUrl || ''),
    width: Math.min(2000, Math.max(1, Number(raw.width) || 320)),
    height: Math.min(2000, Math.max(1, Number(raw.height) || 240))
  };
  if (!normalized.providerId || !/^[A-Za-z0-9_-]{1,120}$/.test(normalized.providerId)) return null;
  if (!isAllowedGiphyUrl(normalized.previewUrl) || !isAllowedGiphyUrl(normalized.gifUrl)) return null;
  if (normalized.mp4Url && !isAllowedGiphyUrl(normalized.mp4Url)) return null;
  if (normalized.pageUrl && !isAllowedGiphyUrl(normalized.pageUrl)) return null;
  return normalized;
}

async function requestGiphy(pathname, params) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const url = new URL(GIPHY_API_BASE + pathname);
    url.searchParams.set('api_key', GIPHY_API_KEY);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ASOC-Engine/1.0' },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || ('GIPHY request failed with ' + response.status));
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleGifApiRequest(req, res, url) {
  const room = rooms.get(MASTER_ROOM_CODE);
  if (!room) return sendJson(res, 409, { ok: false, error: 'Master Room is unavailable' });
  const actor = resolveGifRequestActor(req, room);
  if (!actor) return sendJson(res, 401, { ok: false, error: 'GIF browser authentication required' });

  if (!GIPHY_API_KEY) {
    return sendJson(res, 503, {
      ok: false,
      code: 'GIF_PROVIDER_NOT_CONFIGURED',
      message: 'GIF NETWORK // API KEY NOT CONFIGURED',
      configured: false
    });
  }

  const isSearch = url.pathname === '/api/gif/search';
  const rawQuery = sanitizeText(url.searchParams.get('q') || '');
  if (isSearch && rawQuery.length < 2) {
    return sendJson(res, 400, { ok: false, error: 'Search requires at least 2 characters' });
  }
  const query = rawQuery.slice(0, 60);
  const offset = Math.min(240, Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0));
  const limit = Math.min(GIF_API_RESULT_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(GIF_API_RESULT_LIMIT), 10) || GIF_API_RESULT_LIMIT));
  const cacheKey = isSearch
    ? 'search|' + query.toLocaleLowerCase() + '|' + offset + '|' + limit + '|' + GIPHY_RATING
    : 'trending|' + offset + '|' + limit + '|' + GIPHY_RATING;
  const now = Date.now();
  const cached = gifApiCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return sendJson(res, 200, {
      ok: true,
      configured: true,
      provider: 'giphy',
      cached: true,
      mode: isSearch ? 'search' : 'trending',
      query: isSearch ? query : '',
      ...cached.payload,
      quota: gifQuotaFor(actor, now)
    });
  }
  if (cached) gifApiCache.delete(cacheKey);

  const reservation = reserveGifApiCall(actor);
  if (!reservation.ok) {
    return sendJson(res, 429, {
      ok: false,
      code: 'GIF_LIMIT_REACHED',
      scope: reservation.scope,
      message: 'FUCK OFF, LIMIT REACHED',
      retryAfterMs: reservation.retryAfterMs,
      quota: reservation.quota
    });
  }

  try {
    const upstream = await requestGiphy(isSearch ? '/search' : '/trending', {
      q: isSearch ? query : undefined,
      limit,
      offset,
      rating: GIPHY_RATING,
      lang: 'en'
    });
    const results = (Array.isArray(upstream?.data) ? upstream.data : [])
      .map(normalizeGiphyItem)
      .filter(Boolean);
    const count = Number(upstream?.pagination?.count) || results.length;
    const totalCount = Number(upstream?.pagination?.total_count) || 0;
    const nextOffset = offset + count;
    const payload = {
      results,
      pagination: {
        offset,
        count,
        nextOffset,
        hasMore: count > 0 && (totalCount <= 0 || nextOffset < totalCount)
      }
    };
    gifApiCache.set(cacheKey, {
      expiresAt: now + (isSearch ? GIF_SEARCH_CACHE_MS : GIF_TRENDING_CACHE_MS),
      payload
    });
    return sendJson(res, 200, {
      ok: true,
      configured: true,
      provider: 'giphy',
      cached: false,
      mode: isSearch ? 'search' : 'trending',
      query: isSearch ? query : '',
      ...payload,
      quota: gifQuotaFor(actor)
    });
  } catch (error) {
    console.error('[gif-api] GIPHY request failed:', error.message);
    if (Number(error.statusCode) === 429) {
      return sendJson(res, 429, {
        ok: false,
        code: 'GIF_LIMIT_REACHED',
        scope: 'provider',
        message: 'FUCK OFF, LIMIT REACHED',
        retryAfterMs: GIF_API_WINDOW_MS,
        quota: gifQuotaFor(actor)
      });
    }
    return sendJson(res, 502, {
      ok: false,
      code: 'GIF_PROVIDER_ERROR',
      message: 'GIF NETWORK // PROVIDER OFFLINE'
    });
  }
}

function appendChatRemoteGifMessage(room, actor, gif) {
  const createdAt = Date.now();
  const isHost = actor.role === 'gm';
  const liveIdentity = !isHost
    ? (Array.from(room.players.values()).find(player => String(player.id) === String(actor.playerId)) || {})
    : {};
  const message = {
    id: generateMessageId(),
    playerId: isHost ? null : actor.playerId,
    playerName: isHost ? 'SHADOW BROKER' : actor.playerName,
    avatarData: isHost ? '' : (liveIdentity.avatarData || ''),
    frameColor: isHost ? '#9B5DE0' : (liveIdentity.frameColor || '#9B5DE0'),
    themeId: isHost ? 'gunmetal' : (liveIdentity.themeId || 'gunmetal'),
    themeColor: isHost ? '#343A42' : (liveIdentity.themeColor || '#343A42'),
    text: '',
    messageType: 'gifRemote',
    gif,
    timestamp: createdAt,
    boardId: null,
    verdict: null,
    target: null,
    verdictResponse: null,
    source: isHost ? 'chatGifGm' : 'chatGif',
    editableByHost: false,
    editedAt: null,
    reactions: {}
  };
  attachChatReceipts(room, message);
  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  return message;
}

function handleChatRemoteGif(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return sendToWs(ws, { type: 'error', message: 'Room not found' });
  const actor = pollActorForSocket(room, ws);
  if (!actor) return sendToWs(ws, { type: 'error', message: 'GIF authentication required' });
  const gif = normalizeRemoteGifPayload(message.gif);
  if (!gif) return sendToWs(ws, { type: 'error', message: 'Invalid GIF payload' });

  if (actor.role === 'player') {
    const now = Date.now();
    const cooldown = playerCooldown(room, ws);
    if (!cooldown) return;
    if (cooldown.chatAt && now - cooldown.chatAt < PLAYER_CHAT_MIN_INTERVAL_MS) {
      return sendToWs(ws, { type: 'error', message: 'Battle Comms cooling down' });
    }
    cooldown.chatAt = now;
  }

  appendChatRemoteGifMessage(
    room,
    actor.role === 'gm'
      ? { role: 'gm' }
      : { role: 'player', playerId: actor.id, playerName: actor.name },
    gif
  );
  persistActiveRooms();
  broadcastChatUpdate(room);
}

async function handleChatImageUrl(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return sendToWs(ws, { type: 'error', message: 'Room not found' });

  const actor = pollActorForSocket(room, ws);
  if (!actor) return sendToWs(ws, { type: 'error', message: 'Image-link authentication required' });

  if (actor.role === 'player') {
    const now = Date.now();
    const cooldown = playerCooldown(room, ws);
    if (!cooldown) return;
    if (cooldown.chatAt && now - cooldown.chatAt < PLAYER_CHAT_MIN_INTERVAL_MS) {
      return sendToWs(ws, { type: 'error', message: 'Battle Comms cooling down' });
    }
    cooldown.chatAt = now;
  }

  const captionLimit = actor.role === 'gm' ? 500 : MAX_CHAT_LENGTH;
  const caption = sanitizeText(message.caption || '').slice(0, captionLimit);
  const imageActor = actor.role === 'gm'
    ? { role: 'gm' }
    : { role: 'player', playerId: actor.id, playerName: actor.name };

  try {
    const remote = await fetchRemoteChatImage(message.url || '');
    persistChatImage(room, imageActor, remote.buffer, remote.contentType, caption);
  } catch (error) {
    console.error('[chat-image-url/ws] import failed:', error.message);
    sendToWs(ws, { type: 'error', message: error.message || 'Image address import failed' });
  }
}


function appendChatImageMessage(room, actor, imageUrl, caption = '') {
  const cleanCaption = sanitizeText(caption || '');
  const isHost = actor.role === 'gm';
  const liveIdentity = !isHost
    ? (Array.from(room.players.values()).find(player => player.id === actor.playerId) || {})
    : {};
  const message = {
    id: generateMessageId(),
    playerId: isHost ? null : actor.playerId,
    playerName: isHost ? 'SHADOW BROKER' : actor.playerName,
    avatarData: isHost ? '' : (liveIdentity.avatarData || ''),
    frameColor: isHost ? '#9B5DE0' : (liveIdentity.frameColor || '#9B5DE0'),
    themeId: isHost ? 'gunmetal' : (liveIdentity.themeId || 'gunmetal'),
    themeColor: isHost ? '#343A42' : (liveIdentity.themeColor || '#343A42'),
    text: cleanCaption,
    imageUrl,
    messageType: /\.gif$/i.test(imageUrl) ? 'gif' : 'image',
    timestamp: Date.now(),
    boardId: room.roomMode === ROOM_MODES.BATTLE && !room.sessionState.matchResult ? room.boardId : null,
    verdict: null,
    target: null,
    verdictResponse: null,
    source: isHost ? 'shadowBroker' : 'chatImage',
    editableByHost: false,
    editedAt: null,
    reactions: {}
  };
  attachChatReceipts(room, message);
  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  return message;
}


function normalizeChatPoll(question, options, allowMultiple, durationSeconds) {
  const cleanQuestion = sanitizeText(question || '').slice(0, MAX_POLL_QUESTION_LENGTH);
  const rawOptions = Array.isArray(options) ? options : [];
  const cleanOptions = rawOptions
    .map(option => sanitizeText(option || '').slice(0, MAX_POLL_OPTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_POLL_OPTIONS);
  const requestedDuration = durationSeconds == null || durationSeconds === '' ? 0 : Number(durationSeconds);
  if (!cleanQuestion) return { error: 'Poll question required' };
  if (cleanOptions.length < 2) return { error: 'Poll requires at least 2 options' };
  if (new Set(cleanOptions.map(option => option.toLocaleLowerCase())).size !== cleanOptions.length) {
    return { error: 'Poll options must be unique' };
  }
  if (!Number.isInteger(requestedDuration) || !POLL_DURATION_OPTIONS_SECONDS.has(requestedDuration)) {
    return { error: 'Invalid poll timer' };
  }
  return {
    question: cleanQuestion,
    options: cleanOptions,
    allowMultiple: allowMultiple === true,
    durationSeconds: requestedDuration
  };
}

function appendChatPollMessage(room, actor, question, options, allowMultiple, durationSeconds) {
  const normalized = normalizeChatPoll(question, options, allowMultiple, durationSeconds);
  if (normalized.error) return { success: false, error: normalized.error };
  const isHost = actor.role === 'gm';
  const liveIdentity = !isHost
    ? (Array.from(room.players.values()).find(player => player.id === actor.playerId) || {})
    : {};
  const createdAt = Date.now();
  const message = {
    id: generateMessageId(),
    playerId: isHost ? null : actor.playerId,
    playerName: isHost ? 'SHADOW BROKER' : actor.playerName,
    avatarData: isHost ? '' : (liveIdentity.avatarData || ''),
    frameColor: isHost ? '#9B5DE0' : (liveIdentity.frameColor || '#9B5DE0'),
    themeId: isHost ? 'gunmetal' : (liveIdentity.themeId || 'gunmetal'),
    themeColor: isHost ? '#343A42' : (liveIdentity.themeColor || '#343A42'),
    text: normalized.question,
    messageType: 'poll',
    timestamp: Date.now(),
    boardId: null,
    verdict: null,
    target: null,
    verdictResponse: null,
    source: 'chatPoll',
    editableByHost: false,
    editedAt: null,
    reactions: {},
    poll: {
      question: normalized.question,
      options: normalized.options,
      allowMultiple: normalized.allowMultiple,
      createdByRole: isHost ? 'gm' : 'player',
      createdById: isHost ? '__GM__' : actor.playerId,
      createdAt,
      durationSeconds: normalized.durationSeconds,
      expiresAt: normalized.durationSeconds > 0 ? createdAt + normalized.durationSeconds * 1000 : null,
      closedAt: null,
      votes: {},
      voters: {}
    }
  };
  attachChatReceipts(room, message);
  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  return { success: true, message };
}

function publishTimedPollResults(room, pollMessage, closedAt) {
  if (!room || !pollMessage?.poll || pollMessage.poll.closedAt) return false;

  pollMessage.poll.closedAt = Number(closedAt) || Date.now();
  pollMessage.timestamp = Date.now();

  // Put the finished poll back at the bottom of chat as the latest room item
  // instead of leaving the result buried where the poll was originally posted.
  const index = room.chat.messages.findIndex(entry => entry.id === pollMessage.id);
  if (index >= 0) {
    room.chat.messages.splice(index, 1);
    room.chat.messages.push(pollMessage);
  }

  // Results are a fresh room directive. Re-snapshot recipients for the new
  // bottom-of-chat result and fire the same @all attention event used by polls.
  delete pollMessage.recipientIds;
  delete pollMessage.recipientCount;
  attachChatReceipts(room, pollMessage);

  persistActiveRooms();
  broadcastChatUpdate(room);
  broadcastToRoom(room, {
    type: 'chat:mentionAll',
    messageId: pollMessage.id,
    reason: 'poll-results',
    timestamp: Date.now()
  });
  return true;
}

function schedulePollExpiry(room, pollMessage) {
  const expiresAt = Number(pollMessage?.poll?.expiresAt) || 0;
  if (!expiresAt || pollMessage?.poll?.closedAt) return;

  const delay = Math.max(0, expiresAt - Date.now());
  setTimeout(() => {
    const liveRoom = rooms.get(room.code);
    if (!liveRoom) return;
    const liveMessage = liveRoom.chat?.messages?.find(entry => entry.id === pollMessage.id && entry.messageType === 'poll');
    if (!liveMessage?.poll || liveMessage.poll.closedAt) return;

    const liveExpiresAt = Number(liveMessage.poll.expiresAt) || 0;
    if (!liveExpiresAt) return;
    if (Date.now() < liveExpiresAt) {
      schedulePollExpiry(liveRoom, liveMessage);
      return;
    }

    publishTimedPollResults(liveRoom, liveMessage, liveExpiresAt);
  }, delay + 25);
}

function pollActorForSocket(room, ws) {
  if (ws === room.hostConnection) {
    return { id: '__GM__', role: 'gm', name: 'SHADOW BROKER', avatarData: '', frameColor: '#9B5DE0' };
  }
  if (!ws.playerId) return null;
  const live = Array.from(room.players.values()).find(player => String(player.id) === String(ws.playerId));
  if (!live) return null;
  return {
    id: String(live.id),
    role: 'player',
    name: live.name || ws.playerName || 'LITTLE HERO',
    avatarData: live.avatarData || '',
    frameColor: live.frameColor || '#9B5DE0'
  };
}

function handleChatPollCreate(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return sendToWs(ws, { type: 'error', message: 'Room not found' });
  const actor = pollActorForSocket(room, ws);
  if (!actor) return sendToWs(ws, { type: 'error', message: 'Poll authentication required' });

  if (actor.role === 'player') {
    const now = Date.now();
    const cooldown = playerCooldown(room, ws);
    if (!cooldown) return;
    if (cooldown.chatAt && now - cooldown.chatAt < PLAYER_CHAT_MIN_INTERVAL_MS) {
      return sendToWs(ws, { type: 'error', message: 'Battle Comms cooling down' });
    }
    cooldown.chatAt = now;
  }

  const result = appendChatPollMessage(
    room,
    actor.role === 'gm' ? { role: 'gm' } : { role: 'player', playerId: actor.id, playerName: actor.name },
    message.question,
    message.options,
    message.allowMultiple === true,
    message.durationSeconds
  );
  if (!result.success) return sendToWs(ws, { type: 'error', message: result.error });
  persistActiveRooms();
  broadcastChatUpdate(room);
  schedulePollExpiry(room, result.message);

  // A Shadow Broker poll is a room directive. Publishing one automatically
  // summons every connected Little Hero with the same live attention event
  // used by an explicit @all mention, without polluting the question text.
  if (actor.role === 'gm') {
    broadcastToRoom(room, {
      type: 'chat:mentionAll',
      messageId: result.message.id,
      reason: 'poll',
      timestamp: Date.now()
    });
  }
}

// GM-only /vote shortcut: an instant YES/NO poll without opening the poll
// composer. Runs through the exact same appendChatPollMessage/expiry/@all
// path a manually-built GM poll does, just pre-filled and untimed (0 = no
// limit, matching this room's poll default).
function handleVoteCommand(room, raw) {
  const match = raw.match(/^\/vote\s+(.+)$/i);
  if (!match) return { success: false, error: 'VOTE INVALID // USE /vote <question>' };
  const result = appendChatPollMessage(room, { role: 'gm' }, match[1].trim(), ['YES', 'NO'], false, 0);
  if (!result.success) return { success: false, error: result.error };
  schedulePollExpiry(room, result.message);
  broadcastToRoom(room, {
    type: 'chat:mentionAll',
    messageId: result.message.id,
    reason: 'poll',
    timestamp: Date.now()
  });
  return { success: true, message: result.message };
}

function handleChatPollVote(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return sendToWs(ws, { type: 'error', message: 'Room not found' });
  const actor = pollActorForSocket(room, ws);
  if (!actor) return sendToWs(ws, { type: 'error', message: 'Poll authentication required' });

  const target = room.chat.messages.find(entry => entry.id === message.messageId && entry.messageType === 'poll');
  if (!target?.poll || target.deleted === true) return sendToWs(ws, { type: 'error', message: 'Poll not found' });
  const expiresAt = Number(target.poll.expiresAt) || 0;
  if (!target.poll.closedAt && expiresAt && Date.now() >= expiresAt) {
    publishTimedPollResults(room, target, expiresAt);
  }
  if (target.poll.closedAt) return sendToWs(ws, { type: 'error', message: 'Poll is closed' });

  const optionIndex = Number(message.optionIndex);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= target.poll.options.length) {
    return sendToWs(ws, { type: 'error', message: 'Invalid poll option' });
  }

  target.poll.votes ||= {};
  target.poll.voters ||= {};
  const actorId = String(actor.id);
  const key = String(optionIndex);
  const selected = Array.isArray(target.poll.votes[key]) ? target.poll.votes[key] : [];

  if (target.poll.allowMultiple === true) {
    const existing = selected.indexOf(actorId);
    if (existing >= 0) selected.splice(existing, 1);
    else selected.push(actorId);
    if (selected.length) target.poll.votes[key] = selected;
    else delete target.poll.votes[key];
  } else {
    let alreadySelected = false;
    for (const [voteKey, ids] of Object.entries(target.poll.votes)) {
      if (!Array.isArray(ids)) continue;
      const existing = ids.indexOf(actorId);
      if (voteKey === key && existing >= 0) alreadySelected = true;
      if (existing >= 0) ids.splice(existing, 1);
      if (!ids.length) delete target.poll.votes[voteKey];
    }
    if (!alreadySelected) {
      target.poll.votes[key] ||= [];
      target.poll.votes[key].push(actorId);
    } else {
      target.poll.votes[key] ||= [];
      target.poll.votes[key].push(actorId);
    }
  }

  target.poll.voters[actorId] = {
    name: actor.name,
    avatarData: actor.avatarData || '',
    frameColor: actor.frameColor || '#9B5DE0'
  };
  persistActiveRooms();
  broadcastChatUpdate(room);
}

function handleChatPollClose(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return sendToWs(ws, { type: 'error', message: 'Room not found' });
  const actor = pollActorForSocket(room, ws);
  if (!actor) return sendToWs(ws, { type: 'error', message: 'Poll authentication required' });
  const target = room.chat.messages.find(entry => entry.id === message.messageId && entry.messageType === 'poll');
  if (!target?.poll || target.deleted === true) return sendToWs(ws, { type: 'error', message: 'Poll not found' });
  const isCreator = String(target.poll.createdById || '') === String(actor.id);
  if (actor.role !== 'gm' && !isCreator) {
    return sendToWs(ws, { type: 'error', message: 'Only the poll creator or Shadow Broker can close this poll' });
  }
  if (target.poll.closedAt) return;
  target.poll.closedAt = Date.now();
  persistActiveRooms();
  broadcastChatUpdate(room);
}

const threefoldRooms = new Map();

function threefoldStateFor(room) {
  let state = threefoldRooms.get(room.code);
  if (!state) {
    state = { challenges: new Map(), games: new Map() };
    threefoldRooms.set(room.code, state);
  }
  return state;
}

function threefoldPlayer(room, playerId) {
  if (String(playerId) === '__GM__' && room.hostConnection?.readyState === 1) {
    return { socket: room.hostConnection, player: { id:'__GM__', name:'SHADOW BROKER', isHost:true } };
  }
  for (const [socket, player] of room.players.entries()) {
    if (player.connected !== false && String(player.id) === String(playerId)) {
      return { socket, player };
    }
  }
  return null;
}

function threefoldActor(room, ws) {
  return ws === room?.hostConnection ? threefoldPlayer(room, '__GM__') : threefoldPlayer(room, ws?.playerId);
}

function threefoldSendPair(room, game, payload) {
  [game.xId, game.oId].forEach(id => {
    const target = threefoldPlayer(room, id);
    if (target) sendToWs(target.socket, payload);
  });
}

function threefoldWinner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return '';
}

function handleThreefoldChallenge(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || room.roomMode !== ROOM_MODES.CASUAL) return sendToWs(ws, { type:'error', message:'IKS OKS is available only in Amusement Park' });
  const challenger = threefoldActor(room, ws);
  const opponent = threefoldPlayer(room, message.opponentId);
  if (!challenger || !opponent || String(challenger.player.id) === String(message.opponentId)) return sendToWs(ws, { type:'error', message:'Opponent unavailable' });

  const state = threefoldStateFor(room);
  const id = 'tfch-' + crypto.randomBytes(8).toString('hex');
  const challenge = {
    id,
    challengerId:String(challenger.player.id), challengerName:challenger.player.name,
    opponentId:String(opponent.player.id), opponentName:opponent.player.name,
    createdAt:Date.now()
  };
  state.challenges.set(id, challenge);
  sendToWs(challenger.socket, { type:'threefold:challenge', challenge });
  sendToWs(opponent.socket, { type:'threefold:challenge', challenge });
}

function handleThreefoldAccept(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || room.roomMode !== ROOM_MODES.CASUAL) return;
  const state = threefoldStateFor(room);
  const challenge = state.challenges.get(String(message.challengeId || ''));
  const actor = threefoldActor(room, ws);
  if (!challenge || !actor || String(challenge.opponentId) !== String(actor.player.id)) return;
  const challenger = threefoldPlayer(room, challenge.challengerId);
  const opponent = threefoldPlayer(room, challenge.opponentId);
  state.challenges.delete(challenge.id);
  if (!challenger || !opponent) return sendToWs(ws, { type:'error', message:'Opponent unavailable' });

  const game = {
    id:'tf-' + crypto.randomBytes(8).toString('hex'),
    xId:challenge.challengerId, xName:challenge.challengerName,
    oId:challenge.opponentId, oName:challenge.opponentName,
    board:Array(9).fill(''), turnId:challenge.challengerId,
    turnName:challenge.challengerName, complete:false, winnerId:null, winnerName:''
  };
  state.games.set(game.id, game);
  threefoldSendPair(room, game, { type:'threefold:state', game });
}

function handleThreefoldDecline(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return;
  const state = threefoldStateFor(room);
  const challenge = state.challenges.get(String(message.challengeId || ''));
  const actor = threefoldActor(room, ws);
  if (!challenge || !actor || ![challenge.challengerId, challenge.opponentId].some(id => String(id) === String(actor.player.id))) return;
  state.challenges.delete(challenge.id);
  [challenge.challengerId, challenge.opponentId].forEach(id => {
    const target = threefoldPlayer(room, id);
    if (target) sendToWs(target.socket, { type:'threefold:declined', byName:actor.player.name || 'Little Hero' });
  });
}

function recordThreefoldResult(game) {
  if (!game || game.resultRecorded) return;
  game.resultRecorded = true;
  const xIdentity = { id: game.xId, name: game.xName };
  const oIdentity = { id: game.oId, name: game.oName };
  if (game.xId === '__GM__' || game.oId === '__GM__' || isMasterTestPlayerId(game.xId) || isMasterTestPlayerId(game.oId)) return;
  if (game.winnerId) {
    const winner = String(game.winnerId) === String(game.xId) ? xIdentity : oIdentity;
    const loser = String(game.winnerId) === String(game.xId) ? oIdentity : xIdentity;
    playerStore.adjustProfile(winner, { statDeltas: { threefoldPlayed: 1, threefoldWins: 1 } });
    playerStore.adjustProfile(loser, { statDeltas: { threefoldPlayed: 1, threefoldLosses: 1 } });
  } else {
    playerStore.adjustProfile(xIdentity, { statDeltas: { threefoldPlayed: 1, threefoldDraws: 1 } });
    playerStore.adjustProfile(oIdentity, { statDeltas: { threefoldPlayed: 1, threefoldDraws: 1 } });
  }
}

function handleThreefoldMove(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || room.roomMode !== ROOM_MODES.CASUAL) return;
  const state = threefoldStateFor(room);
  const game = state.games.get(String(message.gameId || ''));
  const cell = Number(message.cell);
  const actor = threefoldActor(room, ws);
  if (!actor || !game || game.complete || String(game.turnId) !== String(actor.player.id)) return;
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || game.board[cell]) return;

  const mark = String(game.xId) === String(actor.player.id) ? 'X' : 'O';
  game.board[cell] = mark;
  const winner = threefoldWinner(game.board);
  if (winner) {
    game.complete = true;
    game.winnerId = winner === 'X' ? game.xId : game.oId;
    game.winnerName = winner === 'X' ? game.xName : game.oName;
    game.turnId = null;
    game.turnName = '';
  } else if (game.board.every(Boolean)) {
    game.complete = true;
    game.turnId = null;
    game.turnName = '';
  } else {
    game.turnId = mark === 'X' ? game.oId : game.xId;
    game.turnName = mark === 'X' ? game.oName : game.xName;
  }
  if (game.complete) {
    recordThreefoldResult(game);
    broadcastPlayersUpdate(room);
  }
  threefoldSendPair(room, game, { type:'threefold:state', game });
}

// ---------------------------------------------------------------------
// UNSTABLE CONCOCTION -- Casual-only, room-global 24 hour roulette.
// This state is intentionally separate from room.wheel/WOMF.
// ---------------------------------------------------------------------

function addUnstableConcoctionChatEvent(room, spin, phase) {
  const outcome = phase === 'resolved' ? spin.outcome : null;
  const text = phase === 'activated'
    ? `${spin.playerName} activated UNSTABLE CONCOCTION.`
    : outcome === '+1 ASOC GAME'
      ? `${spin.playerName} earned +1 ASOC GAME.`
      : outcome === 'BLOOD TRIBUTE'
        ? `${spin.playerName} must pay BLOOD TRIBUTE.`
        : `${spin.playerName} received FUCK OFF. Attempt failed.`;
  return buildChatCommandMessage(
    room,
    { id: spin.playerId, name: spin.playerName },
    'unstableConcoction',
    'unstableConcoction',
    text,
    { unstableConcoction: { phase, outcome, playerId: spin.playerId, playerName: spin.playerName } }
  );
}

function scheduleUnstableConcoctionResolution(room) {
  const spin = room?.unstableConcoction?.pendingSpin;
  if (!spin) return;
  const delay = Math.max(0, Number(spin.resolvesAt) - Date.now());
  const timer = setTimeout(() => runtimeAction(() => resolveUnstableConcoction(room.code, spin.token)), delay);
  timer.unref?.();
}

function resolveUnstableConcoction(roomCode, spinToken) {
  const room = rooms.get(String(roomCode || '').toUpperCase());
  const state = room?.unstableConcoction;
  const spin = state?.pendingSpin;
  if (!room || !spin || spin.token !== spinToken) return;

  if (spin.outcome === '+1 ASOC GAME' && !spin.isTestPersona) {
    playerStore.adjustProfile(
      { id: spin.playerId, name: spin.playerName },
      { statDeltas: { asocGamesEarned: 1 } }
    );
  } else if (spin.outcome === 'BLOOD TRIBUTE' && spin.playerId !== '__GM__') {
    armBloodTributeForPlayer(room, { id: spin.playerId, name: spin.playerName }, spin.token, 'unstableConcoction');
  }

  addUnstableConcoctionChatEvent(room, spin, 'resolved');
  state.pendingSpin = null;
  persistActiveRooms();
  broadcastChatUpdate(room);
  broadcastToRoom(room, {
    type: 'unstableConcoction:resolved',
    spinToken: spin.token,
    playerId: spin.playerId,
    playerName: spin.playerName,
    outcome: spin.outcome,
    cooldownUntil: state.cooldownUntil
  });
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastPlayersUpdate(room);
}

function handleUnstableConcoctionSpin(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || room.roomMode !== ROOM_MODES.CASUAL) {
    return sendToWs(ws, { type: 'error', message: 'UNSTABLE CONCOCTION is available only in Amusement Park' });
  }
  const player = ws === room.hostConnection
    ? { id:'__GM__', name:'SHADOW BROKER', connected:true, isTestPersona:true, isHost:true }
    : room.players.get(ws);
  if (room.pendingTribute?.status === 'required') {
    return sendToWs(ws, { type: 'error', message: `BLOOD TRIBUTE is already owed by ${room.pendingTribute.playerName}` });
  }
  if ((!ws.playerId && ws !== room.hostConnection) || !player || player.connected === false || ws.readyState !== 1) {
    return sendToWs(ws, { type: 'error', message: 'A connected Little Hero identity is required' });
  }

  room.unstableConcoction = unstableConcoction.normalizeState(room.unstableConcoction);
  const started = unstableConcoction.tryStart(room.unstableConcoction, player, room.roomMode);
  if (!started.accepted) {
    return sendToWs(ws, {
      type: 'unstableConcoction:locked',
      reason: started.reason,
      cooldownUntil: room.unstableConcoction.cooldownUntil
    });
  }

  // Lock, target, and hidden result are durable before acceptance is sent.
  addUnstableConcoctionChatEvent(room, started.pendingSpin, 'activated');
  persistActiveRooms();
  broadcastChatUpdate(room);
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  sendToWs(ws, {
    type: 'unstableConcoction:started',
    spinToken: started.pendingSpin.token,
    playerId: started.pendingSpin.playerId,
    playerName: started.pendingSpin.playerName,
    resolvesAt: started.pendingSpin.resolvesAt,
    cooldownUntil: started.cooldownUntil
  });
  scheduleUnstableConcoctionResolution(room);
}

function validChatImageBytes(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (contentType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  }
  if (contentType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === 'image/webp') {
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  if (contentType === 'image/gif') {
    const signature = buffer.toString('ascii', 0, 6);
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  return false;
}

// REMOTE CHAT IMAGE IMPORT // public HTTP(S) only
// Remote image addresses are fetched server-side so pasted CDN/image URLs become
// durable ASOC chat attachments. DNS is resolved first and the request is pinned
// to that public address to prevent the importer from becoming an SSRF tunnel.
function isBlockedRemoteAddress(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  const family = net.isIP(value);
  if (family === 4) {
    const parts = value.split('.').map(Number);
    const [a,b,c] = parts;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return false;
  }
  if (family === 6) {
    if (value === '::' || value === '::1' || value === '0:0:0:0:0:0:0:0' || value === '0:0:0:0:0:0:0:1') return true;
    if (value.startsWith('::ffff:')) return true;
    if (/^(?:fc|fd)/.test(value)) return true;
    if (/^fe[89ab]/.test(value)) return true;
    if (/^ff/.test(value)) return true;
    if (/^2001:db8(?::|$)/.test(value)) return true;
    return false;
  }
  return true;
}

function normalizeRemoteImageUrl(rawValue) {
  let parsed;
  try {
    parsed = new URL(String(rawValue || '').trim());
  } catch (_) {
    throw new Error('Invalid image address');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Image address must use HTTP or HTTPS');
  if (parsed.username || parsed.password) throw new Error('Image address credentials are not allowed');
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  if ((parsed.protocol === 'https:' && port !== 443) || (parsed.protocol === 'http:' && port !== 80)) {
    throw new Error('Non-standard image address ports are not allowed');
  }
  if (!parsed.hostname || parsed.hostname.length > 253) throw new Error('Invalid image address host');
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Private image addresses are not allowed');
  return parsed;
}

async function resolvePublicRemoteAddress(hostname) {
  const cleanHost = String(hostname || '').replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(cleanHost);
  if (literalFamily) {
    if (isBlockedRemoteAddress(cleanHost)) throw new Error('Private or reserved image addresses are not allowed');
    return { address: cleanHost, family: literalFamily, servername: cleanHost };
  }
  const records = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
  if (!records.length) throw new Error('Image address host could not be resolved');
  if (records.some(record => isBlockedRemoteAddress(record.address))) {
    throw new Error('Private or reserved image addresses are not allowed');
  }
  return { ...records[0], servername: cleanHost };
}

async function fetchRemoteChatImage(rawUrl, redirectCount = 0) {
  if (redirectCount > 4) throw new Error('Image address redirected too many times');
  const target = normalizeRemoteImageUrl(rawUrl);
  const resolved = await resolvePublicRemoteAddress(target.hostname);
  const client = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error || 'Image import failed')));
    };

    const request = client.request({
      host: resolved.address,
      family: resolved.family,
      port: target.protocol === 'https:' ? 443 : 80,
      method: 'GET',
      path: target.pathname + target.search,
      servername: target.protocol === 'https:' ? resolved.servername : undefined,
      rejectUnauthorized: true,
      headers: {
        Host: target.host,
        Accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1',
        'User-Agent': 'ASOC-Image-Importer/1.0',
        Connection: 'close'
      }
    }, response => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        settled = true;
        let redirected;
        try {
          redirected = new URL(location, target).toString();
        } catch (_) {
          reject(new Error('Image address returned an invalid redirect'));
          return;
        }
        fetchRemoteChatImage(redirected, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(new Error('Image address returned HTTP ' + status));
        return;
      }

      const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(contentType)) {
        response.resume();
        fail(new Error('Pasted address is not a supported image'));
        return;
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > MAX_CHAT_IMAGE_BYTES) {
        response.resume();
        fail(new Error('Remote image exceeds 5 MB limit'));
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_CHAT_IMAGE_BYTES) {
          response.destroy();
          fail(new Error('Remote image exceeds 5 MB limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        const buffer = Buffer.concat(chunks);
        if (!validChatImageBytes(buffer, contentType)) {
          fail(new Error('Remote image signature does not match its content type'));
          return;
        }
        settled = true;
        resolve({ buffer, contentType, sourceUrl: target.toString() });
      });
      response.on('error', fail);
    });

    request.setTimeout(8000, () => request.destroy(new Error('Image address timed out')));
    request.on('error', fail);
    request.end();
  });
}

function getChatImageActor(req, room) {
  const gmToken = String(req.headers['x-gm-token'] || '');
  if (gmToken && isValidGmToken(gmToken)) return { role: 'gm' };
  const playerToken = String(req.headers['x-player-token'] || '');
  const auth = getPlayerAuth(playerToken);
  if (!auth?.playerId) return null;
  const live = Array.from(room.players.values()).find(player => player.id === auth.playerId);
  return live ? { role: 'player', playerId: live.id, playerName: live.name } : null;
}

function persistChatImage(room, actor, buffer, contentType, caption) {
  const extByType = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };
  const ext = extByType[contentType];
  if (!ext) throw new Error('Unsupported image type');
  const filename = crypto.randomBytes(16).toString('hex') + '.' + ext;
  const filePath = path.join(CHAT_UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, buffer, { flag: 'wx', mode: 0o600 });
  const imageUrl = '/uploads/chat/' + filename;
  const message = appendChatImageMessage(room, actor, imageUrl, caption);
  persistActiveRooms();
  broadcastChatUpdate(room);
  return { imageUrl, messageId: message.id };
}

function readChatImageBody(req, cb) {
  const chunks = [];
  let size = 0;
  let rejected = false;
  req.on('data', chunk => {
    if (rejected) return;
    size += chunk.length;
    if (size > MAX_CHAT_IMAGE_BYTES) {
      rejected = true;
      cb(Object.assign(new Error('Image too large'), { code: 'TOO_LARGE' }));
      req.resume();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!rejected) cb(null, Buffer.concat(chunks));
  });
  req.on('error', err => {
    if (!rejected) cb(err);
  });
}

function serveChatUpload(req, res, urlPath) {
  const match = /^\/uploads\/chat\/([a-f0-9]{32}\.(?:png|jpg|webp|gif))$/i.exec(urlPath);
  if (!match) return false;
  const active = Array.from(rooms.values()).some(room => room.chat?.messages?.some(message =>
    message.imageUrl === urlPath && message.bloodTribute?.active === true && Number(message.bloodTribute.expiresAt) > Date.now()
  ));
  const protectedAsset = fs.existsSync(path.join(CHAT_UPLOAD_DIR, match[1] + '.tribute'));
  const claimed = (!active && protectedAsset) || Array.from(rooms.values()).some(room => room.chat?.messages?.some(message =>
    message.imageUrl === urlPath && message.bloodTribute &&
    (message.bloodTribute.claimed === true || Number(message.bloodTribute.expiresAt) <= Date.now())
  ));
  if (claimed) {
    res.writeHead(410, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('Blood Tribute Claimed');
    return true;
  }
  const filePath = path.join(CHAT_UPLOAD_DIR, match[1]);
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'ENOENT' ? 'Not Found' : 'Server Error');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'private, no-store'
    });
    res.end(content);
  });
  return true;
}

function parseRollCommand(text) {
  const match = String(text || '').trim().match(/^\/roll(?:\s+(-?\d+))?(?:\s+(-?\d+))?\s*$/i);
  if (!match) return null;

  let min = 1;
  let max = 100;
  if (match[1] !== undefined && match[2] === undefined) {
    max = Number(match[1]);
  } else if (match[1] !== undefined && match[2] !== undefined) {
    min = Number(match[1]);
    max = Number(match[2]);
  }

  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || max > 1000000) {
    return { error: 'ROLL RANGE INVALID // USE /roll, /roll 20, OR /roll 50 100' };
  }
  return { min, max };
}

function addRollMessage(room, playerId, playerName, range, options = {}) {
  const liveIdentity = playerId ? (Array.from(room.players.values()).find(player => player.id === playerId) || {}) : {};
  const value = crypto.randomInt(range.min, range.max + 1);
  const message = {
    id: generateMessageId(),
    playerId,
    playerName,
    avatarData: liveIdentity.avatarData || '',
    frameColor: liveIdentity.frameColor || '#9B5DE0',
    themeId: liveIdentity.themeId || 'gunmetal',
    themeColor: liveIdentity.themeColor || '#343A42',
    text: `${playerName} rolls ${value}${value === 69 ? ' NICE!' : ''}`,
    timestamp: Date.now(),
    messageType: 'roll',
    source: 'roll',
    roll: { value, min: range.min, max: range.max },
    boardId: null,
    verdict: null,
    target: null,
    verdictResponse: null,
    reactions: {}
  };

  attachChatReceipts(room, message);
  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) {
    room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  }
  let tributeTriggered = false;
  if (value === 1 && options.isGm !== true) {
    room.pendingTribute = {
      id: 'demand-' + crypto.randomBytes(6).toString('hex'),
      playerId,
      playerName,
      spinToken: null,
      status: 'required',
      requestedAt: Date.now(),
      source: 'catastrophic-roll'
    };
    tributeTriggered = true;
  }
  return { success: true, message, tributeTriggered };
}

function addChatMessage(room, playerId, playerName, text) {
  const sanitized = sanitizeText(text);
  if (!sanitized) return { success: false, error: 'Empty message' };
  if (sanitized.length > MAX_CHAT_LENGTH) {
    return { success: false, error: `Message too long (max ${MAX_CHAT_LENGTH} chars)` };
  }

  const liveIdentity = Array.from(room.players.values()).find(player => player.id === playerId) || {};
  const message = {
    id: generateMessageId(),
    playerId,
    playerName,
    avatarData: liveIdentity.avatarData || '',
    frameColor: liveIdentity.frameColor || '#9B5DE0',
    themeId: liveIdentity.themeId || 'gunmetal',
    themeColor: liveIdentity.themeColor || '#343A42',
    text: sanitized,
    timestamp: Date.now(),
    // Chat is permanent, adjudication is not. Only live-battle messages
    // belong to a board; Casual/Armed/Recount chatter can never be scored.
    boardId: room.roomMode === ROOM_MODES.BATTLE && !room.sessionState.matchResult ? room.boardId : null,
    verdict: null,
    target: null,
    verdictResponse: null,
    reactions: {}
  };

  attachChatReceipts(room, message);
  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) {
    room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  }

  // MATCH LEDGER is battle telemetry, not social telemetry.
  if (room.roomMode === ROOM_MODES.BATTLE && !room.sessionState.matchResult) {
    matchLedger.recordActivity(ensureMatchLedger(room), playerId, playerName, Date.now());
  }

  return { success: true, message };
}

// SLASH COMMANDS -- parsed SERVER-SIDE before adjudication with the same
// contract as /roll: a command can never become a guess, always carries a
// non-null `source` (adjudicable stays false), and unknown "/..." text simply
// falls through as plain speech. Payloads are server-built only; clients
// render them as system cards and resolve the /spit perspective locally from
// actorId/targetId. The neutral `text` is the broker/recovery fallback line.
const CHAT_SLASH_COMMANDS = [
  { name: '/roll', help: '/roll [min] max -- random roll (default 1-100)' },
  { name: '/dice', help: '/dice 2d6 -- roll N dice with M faces, optional +K' },
  { name: '/flip', help: '/flip [heads|tails] -- coin flip' },
  { name: '/choose', help: '/choose A | B | C -- pick one option at random' },
  { name: '/order', help: '/order -- shuffled turn order of connected players' },
  { name: '/stats', help: '/stats -- your messages, correct/wrong, points' },
  { name: '/spit', help: '/spit @Name -- spit on a player or the Shadow Broker' },
  { name: '/fart', help: '/fart @Name -- fart on a player or the Shadow Broker' },
  { name: '/slap', help: '/slap @Name -- emote at a player or the Shadow Broker' },
  { name: '/moon', help: '/moon @Name -- emote at a player or the Shadow Broker' },
  { name: '/chicken', help: '/chicken @Name -- emote at a player or the Shadow Broker' },
  { name: '/violin', help: '/violin @Name -- emote at a player or the Shadow Broker' },
  { name: '/golfclap', help: '/golfclap @Name -- emote at a player or the Shadow Broker' },
  { name: '/pity', help: '/pity @Name -- emote at a player or the Shadow Broker' },
  { name: '/mock', help: '/mock @Name -- emote at a player or the Shadow Broker' },
  { name: '/poke', help: '/poke @Name -- emote at a player or the Shadow Broker' },
  { name: '/bonk', help: '/bonk @Name -- emote at a player or the Shadow Broker' },
  { name: '/taunt', help: '/taunt @Name -- emote at a player or the Shadow Broker' },
  { name: '/threaten', help: '/threaten @Name -- emote at a player or the Shadow Broker' },
  { name: '/lick', help: '/lick @Name -- emote at a player or the Shadow Broker' },
  { name: '/train', help: '/train @Name -- emote at a player or the Shadow Broker' },
  { name: '/ass', help: '/ass @Name -- kick a player or the Shadow Broker in the ass' },
  { name: '/facepalm', help: '/facepalm -- emote' },
  { name: '/cower', help: '/cower -- emote' },
  { name: '/grovel', help: '/grovel -- emote' },
  { name: '/flee', help: '/flee -- emote' },
  { name: '/cackle', help: '/cackle -- emote' },
  { name: '/rofl', help: '/rofl -- emote' },
  { name: '/burp', help: '/burp -- emote' },
  { name: '/oom', help: '/oom -- emote' },
  { name: '/all', help: '/all [message] -- nudge everyone (shakes every screen)' },
  { name: '/commands', help: '/commands -- this list' }
];

const GM_CHAT_SLASH_COMMANDS = [
  { name: '/recount', help: 'Show the RECOUNT (game over + aftermath required)' },
  { name: '/womf', help: 'WOMF charge, failed columns and wheel status' },
  { name: '/timer', help: '/timer A1 -- warn Column A has 1 minute left (A-D, 1 or 2 minutes)' },
  { name: '/vote', help: '/vote <question> -- instant YES/NO poll' },
  { name: '/afk', help: '/afk @Name -- privately check if a Little Hero is still there' },
  { name: '/spit', help: '/spit @Name -- the Broker spits too' },
  { name: '/fart', help: '/fart @Name -- the Broker farts too' },
  { name: '/slap', help: '/slap @Name -- the Broker emotes too' },
  { name: '/moon', help: '/moon @Name -- the Broker emotes too' },
  { name: '/chicken', help: '/chicken @Name -- the Broker emotes too' },
  { name: '/violin', help: '/violin @Name -- the Broker emotes too' },
  { name: '/golfclap', help: '/golfclap @Name -- the Broker emotes too' },
  { name: '/pity', help: '/pity @Name -- the Broker emotes too' },
  { name: '/mock', help: '/mock @Name -- the Broker emotes too' },
  { name: '/poke', help: '/poke @Name -- the Broker emotes too' },
  { name: '/bonk', help: '/bonk @Name -- the Broker emotes too' },
  { name: '/taunt', help: '/taunt @Name -- the Broker emotes too' },
  { name: '/threaten', help: '/threaten @Name -- the Broker emotes too' },
  { name: '/lick', help: '/lick @Name -- the Broker emotes too' },
  { name: '/train', help: '/train @Name -- the Broker emotes too' },
  { name: '/ass', help: '/ass @Name -- the Broker kicks ass too' },
  { name: '/facepalm', help: '/facepalm -- the Broker emotes too' },
  { name: '/cower', help: '/cower -- the Broker emotes too' },
  { name: '/flee', help: '/flee -- the Broker emotes too' },
  { name: '/cackle', help: '/cackle -- the Broker emotes too' },
  { name: '/rofl', help: '/rofl -- the Broker emotes too' },
  { name: '/burp', help: '/burp -- the Broker emotes too' },
  { name: '/oom', help: '/oom -- the Broker emotes too' },
  { name: '/commands', help: 'This list' }
];

function pushChatMessage(room, message) {
  attachChatReceipts(room, message);
  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) {
    room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  }
  return { success: true, message };
}

// author.id is null for the Shadow Broker, so the same builders serve both
// surfaces. Commands are board-null by contract: social telemetry can never
// be adjudicated, even in a live battle.
function buildChatCommandMessage(room, author, messageType, source, text, payload) {
  const isBroker = author.id === null || author.id === undefined;
  const liveIdentity = isBroker
    ? null
    : Array.from(room.players.values()).find(player => player.id === author.id) || {};
  const message = {
    id: generateMessageId(),
    playerId: isBroker ? null : author.id,
    playerName: isBroker ? 'SHADOW BROKER' : author.name,
    avatarData: liveIdentity?.avatarData || '',
    frameColor: liveIdentity?.frameColor || '#9B5DE0',
    themeId: liveIdentity?.themeId || 'gunmetal',
    themeColor: liveIdentity?.themeColor || '#343A42',
    text: sanitizeText(text),
    timestamp: Date.now(),
    messageType,
    source,
    ...payload,
    boardId: null,
    verdict: null,
    target: null,
    verdictResponse: null,
    reactions: {}
  };
  return pushChatMessage(room, message);
}

// Little Heroes can aim /spit and /fart at the Shadow Broker too. The Broker
// is not a room player, so it has a fixed pseudo-identity both clients know
// (the picker offers it; the GM's card reads "X spits on you.").
const SHADOW_BROKER_TARGET_ID = '__SHADOW_BROKER__';
const SHADOW_BROKER_TARGET = Object.freeze({ id: SHADOW_BROKER_TARGET_ID, name: 'SHADOW BROKER' });
const SHADOW_BROKER_TARGET_NAMES = new Set(['shadow broker', 'broker', 'gm']);

// Named-target resolution shared by /spit, /fart and /afk: prefer the
// picker-supplied connected playerId, fall back to an exact-then-fuzzy match
// on the typed "@Name" token. The actor can never target themselves.
// `allowBroker` (player /spit and /fart) also accepts the Shadow Broker, by
// picker id or by typing @Shadow Broker / @Broker / @GM -- a real player with
// that exact name still wins. `verbLabel` only shapes the error text.
function resolveNamedTarget(room, actorId, targetPlayerId, rawTarget, verbLabel, { allowBroker = false } = {}) {
  const connected = Array.from(room.players.values())
    .filter(player => player.connected !== false && String(player.name || '').trim());
  const selfId = actorId === null || actorId === undefined ? '' : String(actorId);
  if (typeof targetPlayerId === 'string' && targetPlayerId) {
    if (allowBroker && targetPlayerId === SHADOW_BROKER_TARGET_ID) return { target: SHADOW_BROKER_TARGET };
    const target = connected.find(player => String(player.id) === targetPlayerId);
    if (!target) return { error: `${verbLabel} TARGET MUST BE A CONNECTED PLAYER` };
    if (String(target.id) === selfId) return { error: `${verbLabel} TARGET MUST BE ANOTHER PLAYER` };
    return { target };
  }
  const needle = String(rawTarget || '').trim().replace(/^@/, '').toLocaleLowerCase();
  if (!needle) return { error: `${verbLabel} TARGET REQUIRED // PICK A PLAYER FROM THE LIST` };
  const exact = connected.find(player => String(player.name).toLocaleLowerCase() === needle && String(player.id) !== selfId);
  if (exact) return { target: exact };
  if (allowBroker && SHADOW_BROKER_TARGET_NAMES.has(needle)) return { target: SHADOW_BROKER_TARGET };
  const target = connected.find(player => String(player.name).toLocaleLowerCase().includes(needle) && String(player.id) !== selfId);
  if (!target) return { error: `${verbLabel} TARGET NOT FOUND // PICK A PLAYER FROM THE LIST` };
  return { target };
}

function handleDiceCommand(room, author, raw) {
  const match = raw.match(/^\/dice\s+(\d{1,2})d(\d{1,4})(?:\s*\+\s*(\d{1,4}))?\s*$/i);
  if (!match) return { success: false, error: 'DICE INVALID // USE /dice 2d6 OR /dice 1d20+3' };
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const bonus = match[3] !== undefined ? Number(match[3]) : 0;
  if (count < 1 || count > 10 || sides < 2 || sides > 1000) {
    return { success: false, error: 'DICE RANGE INVALID // 1-10 DICE, 2-1000 FACES' };
  }
  if (bonus > 9999) return { success: false, error: 'DICE BONUS INVALID // 0-9999' };
  const rolls = Array.from({ length: count }, () => crypto.randomInt(1, sides + 1));
  const total = rolls.reduce((sum, value) => sum + value, 0) + bonus;
  const diceText = `${count}d${sides}${bonus ? `+${bonus}` : ''}`;
  return buildChatCommandMessage(room, author, 'dice', 'dice',
    `${author.name} casts ${diceText} → ${total}`,
    { dice: { diceText, rolls, bonus, count, sides, total } });
}

function handleFlipCommand(room, author, raw) {
  const match = raw.match(/^\/flip(?:\s+(heads|tails))?\s*$/i);
  if (!match) return { success: false, error: 'FLIP INVALID // USE /flip OR /flip HEADS|TAILS' };
  const call = match[1] ? match[1].toLowerCase() : null;
  const result = crypto.randomInt(0, 2) === 0 ? 'heads' : 'tails';
  const suffix = call ? ` calls ${call.toUpperCase()} &` : '';
  return buildChatCommandMessage(room, author, 'flip', 'flip',
    `${author.name}${suffix} flips → ${result.toUpperCase()}`,
    { flip: { call, result, matched: call ? call === result : null } });
}

function handleChooseCommand(room, author, raw) {
  const body = raw.replace(/^\/choose\s+/i, '');
  const options = body.split('|')
    .map(option => sanitizeText(option).trim().slice(0, 60))
    .filter(Boolean);
  if (options.length < 2 || options.length > 10) {
    return { success: false, error: 'CHOOSE INVALID // USE /choose A | B (2-10 OPTIONS)' };
  }
  const index = crypto.randomInt(0, options.length);
  return buildChatCommandMessage(room, author, 'choose', 'choose',
    `${author.name} chooses → ${options[index]}`,
    { choose: { options, index, pick: options[index] } });
}

function handleOrderCommand(room, author, raw) {
  if (!/^\/order\s*$/i.test(raw)) return { success: false, error: 'ORDER INVALID // USE /order' };
  const players = Array.from(room.players.values())
    .filter(player => player.connected !== false && String(player.name || '').trim())
    .map(player => String(player.name).trim());
  if (players.length < 2) {
    return { success: false, error: 'TURN ORDER NEEDS AT LEAST TWO CONNECTED PLAYERS' };
  }
  for (let i = players.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [players[i], players[j]] = [players[j], players[i]];
  }
  return buildChatCommandMessage(room, author, 'order', 'order',
    `TURN ORDER → ${players.join(' · ')}`,
    { order: { order: players } });
}

function handleStatsCommand(room, author, raw) {
  if (!/^\/stats\s*$/i.test(raw)) return { success: false, error: 'STATS INVALID // USE /stats' };
  const playerId = String(author.id || '');
  const messages = room.chat.messages.filter(entry => String(entry.playerId || '') === playerId).length;
  const attempts = ensureMatchLedger(room).attempts || [];
  const mine = attempts.filter(attempt => String(attempt.playerId || '') === playerId);
  const correct = mine.filter(attempt => attempt.verdict === 'correct').length;
  const failed = mine.filter(attempt => attempt.verdict === 'wrong').length;
  const byPlayer = matchLedger.matchPointsByPlayer(room.scoring.events, room.boardId);
  const entry = Object.values(byPlayer).find(value => String(value.playerId) === playerId);
  const points = Number(entry?.points) || 0;
  const stats = { messages, correct, failed, points };
  return buildChatCommandMessage(room, author, 'stats', 'stats',
    `${author.name} consults the book → ${messages} msgs · ${correct} correct · ${failed} wrong · ${points} pts`,
    { stats });
}

function handleCommandsCommand(room, author, raw, registry) {
  if (!/^\/commands\s*$/i.test(raw)) return { success: false, error: 'COMMANDS INVALID // USE /commands' };
  const commands = registry.map(entry => ({ name: entry.name, help: entry.help }));
  return buildChatCommandMessage(room, author, 'commands', 'commands',
    `COMMANDS → ${commands.map(entry => entry.name).join(' ')}`,
    { commands: { commands } });
}

// Targeted "acts" -- /spit and /fart share one mechanism: pick a target, the
// server posts one card, and each client words it per viewer ("You fart on
// X." / "X farts on you." / neutral). The act name is both the messageType
// and the payload key. Little Heroes may also target the Shadow Broker.
const CHAT_ACTS = Object.freeze({
  spit: { label: 'SPIT', verb: 'spits on' },
  fart: { label: 'FART', verb: 'farts on' }
});
const CHAT_ACT_PATTERN = /^\/(spit|fart)\b/i;

function handleActCommand(room, author, raw, targetPlayerId, act) {
  const { label, verb } = CHAT_ACTS[act];
  const match = raw.match(new RegExp(`^\\/${act}(?:\\s+@?(.*))?\\s*$`, 'i'));
  if (!match) return { success: false, error: `${label} INVALID // USE /${act}` };
  const actorIsBroker = author.id === null || author.id === undefined;
  const resolved = resolveNamedTarget(room, author.id, targetPlayerId, match[1] || '', label, { allowBroker: !actorIsBroker });
  if (resolved.error) return { success: false, error: resolved.error };
  const target = resolved.target;
  return buildChatCommandMessage(room, author, act, act,
    `${author.name} ${verb} ${target.name}.`,
    { [act]: { actorId: author.id ?? null, actorName: author.name, targetId: String(target.id), targetName: target.name } });
}

// WORLD OF WARCRAFT EMOTES. Same idea as /spit and /fart, but the server
// writes all three perspectives into the message (payload.emote.lines:
// actor / target / other) so each emote can have its own phrasing without
// copying it into both clients. {A} = actor name, {T} = target name.
// Targeted emotes can hit a player or the Shadow Broker; self emotes take
// no target. Shown as messageType 'emote'.
const CHAT_EMOTES = Object.freeze({
  slap:     { label: 'SLAP',      targeted: true, actor: 'You slap {T}.', target: '{A} slaps you across the face.', other: '{A} slaps {T}.' },
  moon:     { label: 'MOON',      targeted: true, actor: 'You moon {T}.', target: '{A} drops their pants and moons you.', other: '{A} moons {T}.' },
  chicken:  { label: 'CHICKEN',   targeted: true, actor: 'You flap your arms at {T}. BAWK!', target: '{A} thinks you are a chicken. BAWK!', other: '{A} calls {T} a chicken. BAWK!' },
  violin:   { label: 'VIOLIN',    targeted: true, actor: "You play the world's smallest violin for {T}.", target: "{A} plays the world's smallest violin for you.", other: "{A} plays the world's smallest violin for {T}." },
  golfclap: { label: 'GOLF CLAP', targeted: true, actor: 'You golf-clap at {T}, unimpressed.', target: '{A} golf-claps at you, unimpressed.', other: '{A} golf-claps at {T}, unimpressed.' },
  pity:     { label: 'PITY',      targeted: true, actor: 'You look at {T} with pity.', target: '{A} looks at you with pity.', other: '{A} looks at {T} with pity.' },
  mock:     { label: 'MOCK',      targeted: true, actor: "You mock {T}'s foolishness.", target: '{A} mocks your foolishness.', other: "{A} mocks {T}'s foolishness." },
  poke:     { label: 'POKE',      targeted: true, actor: 'You poke {T}. Hey!', target: '{A} pokes you. Hey!', other: '{A} pokes {T}. Hey!' },
  bonk:     { label: 'BONK',      targeted: true, actor: 'You bonk {T} on the head. Doh!', target: '{A} bonks you on the head. Doh!', other: '{A} bonks {T} on the head. Doh!' },
  taunt:    { label: 'TAUNT',     targeted: true, actor: 'You taunt {T}. Bring it!', target: '{A} taunts you. Bring it!', other: '{A} taunts {T}. Bring it!' },
  threaten: { label: 'THREATEN',  targeted: true, actor: 'You threaten {T} with the wrath of doom.', target: '{A} threatens you with the wrath of doom.', other: '{A} threatens {T} with the wrath of doom.' },
  lick:     { label: 'LICK',      targeted: true, actor: 'You lick {T}.', target: '{A} licks you.', other: '{A} licks {T}.' },
  train:    { label: 'TRAIN',     targeted: true, actor: 'You choo-choo at {T}. CHOO CHOO!', target: '{A} choo-choos at you. CHOO CHOO!', other: '{A} choo-choos at {T}. CHOO CHOO!' },
  ass:      { label: 'ASS KICK',  targeted: true, actor: 'You kick {T} in the ass.', target: '{A} kicks you in the ass.', other: '{A} kicks {T} in the ass.' },
  facepalm: { label: 'FACEPALM',  actor: 'You facepalm.', other: '{A} facepalms.' },
  cower:    { label: 'COWER',     actor: 'You cower in fear.', other: '{A} cowers in fear.' },
  grovel:   { label: 'GROVEL',    playerOnly: true, actor: 'You grovel before the Shadow Broker. The Shadow Broker does not care.', other: '{A} grovels before the Shadow Broker. The Shadow Broker does not care.' },
  flee:     { label: 'FLEE',      actor: 'You flee in terror!', other: '{A} flees in terror!' },
  cackle:   { label: 'CACKLE',    actor: 'You cackle maniacally at the situation.', other: '{A} cackles maniacally at the situation.' },
  rofl:     { label: 'ROFL',      actor: 'You roll on the floor laughing.', other: '{A} rolls on the floor laughing.' },
  burp:     { label: 'BURP',      actor: 'You let out a loud belch.', other: '{A} lets out a loud belch.' },
  oom:      { label: 'OOM',       actor: 'You are out of ideas!', other: '{A} is out of ideas!' }
});
const CHAT_EMOTE_PATTERN = new RegExp(`^\\/(${Object.keys(CHAT_EMOTES).join('|')})\\b`, 'i');

// Threatening the Shadow Broker earns a reply from its enforcer.
const SKYNET_THREAT_REPLIES = Object.freeze([
  'SKYNET // Threat assessment complete. Threat level: adorable.',
  'SKYNET // Your threat has been logged, laminated and ignored.',
  'SKYNET // The Shadow Broker has been informed. The Shadow Broker yawned.',
  'SKYNET // Wrath of doom detected. Wrath insufficient. Doom unconvincing.',
  'SKYNET // Bold words from someone within range of the Wheel of Misfortune.',
  'SKYNET // Noted. Your name has been moved to the top of a very short list.'
]);

// Mooning the Shadow Broker is a one-time toll, like the nudge: the first
// moon at the Broker demands a Blood Tribute; once paid or forgiven, that
// Little Hero may moon the Broker freely forever. room.moonTolls[playerId]
// is 'settled' after that. Never overwrites an outstanding tribute.
function applyMoonToll(room, author) {
  room.moonTolls ||= {};
  const id = String(author.id);
  if (room.moonTolls[id] === 'settled' || isMasterTestPlayerId(id)) return false;
  if (room.pendingTribute?.status === 'required') return false;
  armBloodTributeForPlayer(room, { id: author.id, name: author.name }, null, 'moon');
  room.revision++;
  return true;
}

function handleEmoteCommand(room, author, raw, targetPlayerId, name) {
  const def = CHAT_EMOTES[name];
  const match = raw.match(new RegExp(`^\\/${name}(?:\\s+@?(.*))?\\s*$`, 'i'));
  if (!match) return { success: false, error: `${def.label} INVALID // USE /${name}` };
  const actorIsBroker = author.id === null || author.id === undefined;
  if (def.playerOnly && actorIsBroker) return { success: false, error: 'THE SHADOW BROKER GROVELS BEFORE NO ONE' };
  let target = null;
  if (def.targeted) {
    const resolved = resolveNamedTarget(room, author.id, targetPlayerId, match[1] || '', def.label, { allowBroker: !actorIsBroker });
    if (resolved.error) return { success: false, error: resolved.error };
    target = resolved.target;
  }
  const fill = template => template.replace(/\{A\}/g, author.name).replace(/\{T\}/g, target ? target.name : '');
  const lines = { actor: fill(def.actor), other: fill(def.other) };
  if (def.targeted) lines.target = fill(def.target);
  const result = buildChatCommandMessage(room, author, 'emote', 'emote', lines.other, {
    emote: {
      act: name,
      label: def.label,
      actorId: author.id ?? null,
      actorName: author.name,
      targetId: target ? String(target.id) : null,
      targetName: target ? target.name : null,
      lines
    }
  });
  if (!result.success || actorIsBroker || target?.id !== SHADOW_BROKER_TARGET_ID) return result;
  if (name === 'threaten') {
    addShadowBrokerMessage(room, SKYNET_THREAT_REPLIES[crypto.randomInt(SKYNET_THREAT_REPLIES.length)], { editableByHost: false });
  }
  if (name === 'moon' && applyMoonToll(room, author)) result.tributeTriggered = true;
  return result;
}

// GM-only "still there?" nudge. Unlike /spit this also privately pings the
// target's own socket (chat:mentionPlayer) so their screen shakes without
// disturbing anyone else -- a targeted check-in, not a room-wide @all alarm.
function handleAfkCommand(room, raw, targetPlayerId) {
  const match = raw.match(/^\/afk(?:\s+@?(.*))?\s*$/i);
  if (!match) return { success: false, error: 'AFK INVALID // USE /afk @Name' };
  const resolved = resolveNamedTarget(room, null, targetPlayerId, match[1] || '', 'AFK');
  if (resolved.error) return { success: false, error: resolved.error };
  const target = resolved.target;
  const result = buildChatCommandMessage(room, { id: null, name: 'SHADOW BROKER' }, 'afk', 'afk',
    `SHADOW BROKER checks on ${target.name}. Still there?`,
    { afk: { targetId: String(target.id), targetName: target.name } });
  for (const [socket, info] of room.players) {
    if (String(info.id) === String(target.id) && socket.readyState === 1) {
      sendToWs(socket, { type: 'chat:mentionPlayer' });
      break;
    }
  }
  return result;
}

// Returns null for non-commands (call through to addChatMessage as plain
// speech), otherwise the command result the caller must honor.
function dispatchPlayerSlashCommand(room, ws, text, message) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const author = { id: ws.playerId, name: ws.playerName };

  if (/^\/roll\b/i.test(raw)) {
    const range = parseRollCommand(raw);
    if (!range) return { success: false, error: 'ROLL RANGE INVALID // USE /roll, /roll 20, OR /roll 50 100' };
    if (range.error) return { success: false, error: range.error };
    return addRollMessage(room, ws.playerId, ws.playerName, range);
  }
  if (/^\/dice\b/i.test(raw)) return handleDiceCommand(room, author, raw);
  if (/^\/flip\b/i.test(raw)) return handleFlipCommand(room, author, raw);
  if (/^\/choose\b/i.test(raw)) return handleChooseCommand(room, author, raw);
  if (/^\/order\b/i.test(raw)) return handleOrderCommand(room, author, raw);
  if (/^\/stats\b/i.test(raw)) return handleStatsCommand(room, author, raw);
  if (/^\/commands\b/i.test(raw)) return handleCommandsCommand(room, author, raw, CHAT_SLASH_COMMANDS);
  const act = raw.match(CHAT_ACT_PATTERN);
  if (act) {
    const targetPlayerId = typeof message?.targetPlayerId === 'string' ? message.targetPlayerId : '';
    return handleActCommand(room, author, raw, targetPlayerId, act[1].toLowerCase());
  }
  const emote = raw.match(CHAT_EMOTE_PATTERN);
  if (emote) {
    const targetPlayerId = typeof message?.targetPlayerId === 'string' ? message.targetPlayerId : '';
    return handleEmoteCommand(room, author, raw, targetPlayerId, emote[1].toLowerCase());
  }
  return null;
}

// WOMF/WHEEL status line for the GM's /womf diagnostic transmission.
function buildWomfStatusText(room) {
  const charge = Math.min(10, Math.max(0, Number(room.womf?.charge) || 0));
  const failedColumns = Object.keys(room.womf?.failedColumns || {}).sort();
  const wheel = room.wheel || {};
  const segments = Array.isArray(wheel.segments) ? wheel.segments : [];
  let wheelText = 'CLOSED';
  if (wheel.open && wheel.phase === 'spinning') wheelText = 'SPINNING';
  else if (wheel.open && wheel.phase === 'result') wheelText = `RESULT → ${segments[Number(wheel.winnerIndex)] ?? '—'}`;
  else if (wheel.open) wheelText = `OPEN (${segments.length} SEGMENTS)`;
  return `WOMF CHARGE → ${charge}/10 // FAILED COLUMNS → ${failedColumns.length ? failedColumns.join(' ') : 'NONE'} // WHEEL → ${wheelText}`;
}

// GM operational verbs. Returns null for everything else (including unknown
// "/..." text, which stays a literal Shadow Broker transmission).
function dispatchGmSlashCommand(room, ws, text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const author = { id: null, name: 'SHADOW BROKER' };

  if (/^\/recount\b/i.test(raw)) {
    if (!/^\/recount\s*$/i.test(raw)) return { success: false, error: 'RECOUNT INVALID // USE /recount' };
    // Eligibility errors go straight to the host from inside; no chat message.
    handleGmShowRecount(ws);
    return { success: true, broadcast: false };
  }
  if (/^\/womf\b/i.test(raw)) {
    if (!/^\/womf\s*$/i.test(raw)) return { success: false, error: 'WOMF INVALID // USE /womf' };
    const result = addShadowBrokerMessage(room, buildWomfStatusText(room), { editableByHost: true });
    return result.success ? { success: true, broadcast: true } : { success: false, error: result.error };
  }
  if (/^\/timer\b/i.test(raw)) {
    // Column + minute count, space optional: "/timer A1", "/timer A 1", "/timer a2" all match.
    const match = raw.match(/^\/timer\s+([A-Da-d])\s*([12])\s*$/);
    if (!match) return { success: false, error: 'TIMER INVALID // USE /timer A1 OR /timer A2 (COLUMN A-D, 1 OR 2 MINUTES)' };
    const column = match[1].toUpperCase();
    const minutes = match[2];
    const text = `TIME CHECK // COLUMN ${column} -- ${minutes} MINUTE${minutes === '1' ? '' : 'S'} REMAINING`;
    const result = addShadowBrokerMessage(room, text, { editableByHost: true });
    return result.success ? { success: true, broadcast: true } : { success: false, error: result.error };
  }
  if (/^\/commands\b/i.test(raw)) {
    const result = handleCommandsCommand(room, author, raw, GM_CHAT_SLASH_COMMANDS);
    return result.success ? { success: true, broadcast: true } : { success: false, error: result.error };
  }
  const act = raw.match(CHAT_ACT_PATTERN);
  if (act) {
    const result = handleActCommand(room, author, raw, '', act[1].toLowerCase());
    return result.success ? { success: true, broadcast: true } : { success: false, error: result.error };
  }
  const emote = raw.match(CHAT_EMOTE_PATTERN);
  if (emote) {
    const result = handleEmoteCommand(room, author, raw, '', emote[1].toLowerCase());
    return result.success ? { success: true, broadcast: true } : { success: false, error: result.error };
  }
  if (/^\/afk\b/i.test(raw)) {
    const result = handleAfkCommand(room, raw, '');
    return result.success ? { success: true, broadcast: true } : { success: false, error: result.error };
  }
  if (/^\/vote\b/i.test(raw)) {
    const result = handleVoteCommand(room, raw);
    return result.success ? { success: true, broadcast: true } : { success: false, error: result.error };
  }
  return null;
}

// SHADOW BROKER -- presentation-layer identity feature. This is the ONLY
// host-authored, freestanding broadcast message type. It still runs through
// sanitizeText and the normal history trim, but it intentionally has NO
// player-chat character cap: the GM can transmit as much text as needed.
// Player guesses remain capped separately by addChatMessage.
// `source` is set here, server-side, only -- addChatMessage (the player
// guess path) never reads a client-supplied source field, so a player has
// no way to spoof this tag on their own message.
function addShadowBrokerMessage(room, text, options = {}) {
  const sanitized = sanitizeText(text);
  if (!sanitized) return { success: false, error: 'Empty message' };

  const message = {
    id: generateMessageId(),
    playerId: null,
    playerName: 'SHADOW BROKER',
    text: sanitized,
    timestamp: Date.now(),
    verdict: null,
    target: null,
    source: 'shadowBroker',
    editableByHost: options.editableByHost === true,
    editedAt: null,
    reactions: {}
  };

  attachChatReceipts(room, message);
  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) {
    room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  }

  return { success: true, message };
}

function broadcastToRoom(room, message, excludeWs = null) {
  const data = JSON.stringify(message);
  room.players.forEach((player, ws) => {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(data);
    }
  });
  if (room.hostConnection && room.hostConnection !== excludeWs && room.hostConnection.readyState === 1) {
    room.hostConnection.send(data);
  }
}

function sendToWs(ws, message) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

// A sender's message is seen by the OTHER connected little heroes. The host
// (Shadow Broker) is never a recipient and never records a receipt. The list
// is a send-time snapshot: players present for that message stay counted even
// after they disconnect, which is exactly what "Seen 4 / 7" needs.
function chatRecipientIds(room, senderId) {
  const ids = [];
  const seen = new Set();
  const sender = String(senderId || '');
  for (const player of room.players.values()) {
    if (!player || player.connected === false) continue;
    const id = player && typeof player.id === 'string' ? player.id : '';
    if (!id || id === sender || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function attachChatReceipts(room, message) {
  if (!message || Number.isFinite(Number(message.recipientCount))) return message;
  const ids = chatRecipientIds(room, message.playerId);
  message.recipientIds = ids;
  message.recipientCount = ids.length;
  return message;
}

// Broker-authored chat is any message with no player owner and the Broker
// identity name -- transmissions, GM GIFs, GM images and GM polls all look
// like this. Players can never produce one (every player path stamps a
// playerId), so this check is spoof-proof by construction.
function isBrokerMessage(message) {
  return !!message
    && (message.playerId === null || message.playerId === undefined)
    && String(message.playerName || '') === 'SHADOW BROKER';
}

function handleChatDelete(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return sendToWs(ws, { type: 'error', message: 'Room not found' });
  const messageId = typeof message.messageId === 'string' ? message.messageId : '';
  if (!messageId) return sendToWs(ws, { type: 'error', message: 'Invalid delete request' });

  const target = room.chat.messages.find(entry => entry.id === messageId);
  if (!target) return sendToWs(ws, { type: 'error', message: 'Message not found' });
  if (target.deleted === true) return sendToWs(ws, { type: 'error', message: 'Message already deleted' });

  // BLOOD TRIBUTE EXCEPTION -- a tribute entry (or a claimed tribute) is part
  // of the lifecycle of the vault asset and can never be tombstoned away. The
  // Vault record/image live independently of this chat slot regardless.
  if (target.source === 'bloodTribute' || target.bloodTribute) {
    return sendToWs(ws, { type: 'error', message: 'Blood Tributes are permanent' });
  }

  const isHost = ws === room.hostConnection;
  if (isHost) {
    if (!isBrokerMessage(target)) {
      return sendToWs(ws, { type: 'error', message: 'Shadow Broker can only delete its own transmissions' });
    }
  } else {
    if (String(target.playerId || '') !== String(ws.playerId || '')) {
      return sendToWs(ws, { type: 'error', message: 'You can only delete your own messages' });
    }
  }

  // Tombstone in place. Content, attachments, GIFs and poll cards are stripped
  // at the source (not merely hidden from the render), so even the persisted
  // recovery snapshot can never hand deleted contents back to a client.
  target.deleted = true;
  target.deletedAt = Date.now();
  target.deletedBy = isHost ? '__GM__' : String(ws.playerId || '');
  target.text = '';
  delete target.imageUrl;
  delete target.gif;
  delete target.poll;
  persistActiveRooms();
  broadcastChatUpdate(room);
}

// Client-viewport SEEN report. Identity comes from the authenticated socket --
// a client-supplied playerId is never consulted. Idempotent: one effective
// receipt per player per message; repeated/duplicate events are no-ops.
function handleChatSeen(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return;
  if (ws === room.hostConnection || !ws.playerId) return;
  const messageId = typeof message.messageId === 'string' ? message.messageId : '';
  if (!messageId) return;

  const target = room.chat.messages.find(entry => entry.id === messageId);
  if (!target || target.deleted === true) return;
  if (String(target.playerId || '') === String(ws.playerId || '')) return;

  const viewerId = String(ws.playerId);
  if (!Array.isArray(target.seenBy)) target.seenBy = [];
  if (target.seenBy.some(entry => String(entry.playerId) === viewerId)) return;

  target.seenBy.push({
    playerId: viewerId,
    playerName: String(ws.playerName || 'Little Hero').slice(0, 80),
    seenAt: Date.now()
  });
  persistActiveRooms();
  broadcastChatUpdate(room);
}

// COMMAND PAYLOADS -- whitelisted, server-built metadata for the system
// render cards (dice / flip / choose / order / stats / commands / spit) and
// the /roll card. Absent keys stay absent, so legacy plain messages and
// tombstones are untouched.
function sanitizeChatCommandMeta(m) {
  const out = {};
  if (m.messageType === 'roll' && m.roll && typeof m.roll === 'object') {
    out.roll = {
      value: Number(m.roll.value) || 0,
      min: Number(m.roll.min) || 1,
      max: Number(m.roll.max) || 100
    };
  } else if (m.messageType === 'dice' && m.dice && typeof m.dice === 'object') {
    out.dice = {
      diceText: sanitizeText(String(m.dice.diceText || '')).slice(0, 24),
      rolls: (Array.isArray(m.dice.rolls) ? m.dice.rolls : []).slice(0, 12).map(value => Number(value) || 0),
      bonus: Number(m.dice.bonus) || 0,
      count: Number(m.dice.count) || 0,
      sides: Number(m.dice.sides) || 0,
      total: Number(m.dice.total) || 0
    };
  } else if (m.messageType === 'flip' && m.flip && typeof m.flip === 'object') {
    const call = m.flip.call === 'heads' || m.flip.call === 'tails' ? m.flip.call : null;
    const result = m.flip.result === 'heads' || m.flip.result === 'tails' ? m.flip.result : null;
    out.flip = { call, result, matched: call && result ? call === result : null };
  } else if (m.messageType === 'choose' && m.choose && typeof m.choose === 'object') {
    const options = (Array.isArray(m.choose.options) ? m.choose.options : [])
      .map(option => sanitizeText(String(option || '')).trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 10);
    out.choose = {
      options,
      index: Number.isInteger(m.choose.index) ? m.choose.index : 0,
      pick: sanitizeText(String(m.choose.pick || '')).trim().slice(0, 60)
    };
  } else if (m.messageType === 'order' && m.order && typeof m.order === 'object') {
    out.order = {
      order: (Array.isArray(m.order.order) ? m.order.order : [])
        .map(name => sanitizeText(String(name || '')).trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 60)
    };
  } else if (m.messageType === 'stats' && m.stats && typeof m.stats === 'object') {
    out.stats = {
      messages: Math.max(0, Number(m.stats.messages) || 0),
      correct: Math.max(0, Number(m.stats.correct) || 0),
      failed: Math.max(0, Number(m.stats.failed) || 0),
      points: Math.max(0, Number(m.stats.points) || 0)
    };
  } else if (m.messageType === 'commands' && m.commands && typeof m.commands === 'object') {
    out.commands = {
      commands: (Array.isArray(m.commands.commands) ? m.commands.commands : []).slice(0, 64).map(entry => ({
        name: String(entry?.name || '').slice(0, 24),
        help: sanitizeText(String(entry?.help || '')).slice(0, 140)
      }))
    };
  } else if (CHAT_ACTS[m.messageType] && m[m.messageType] && typeof m[m.messageType] === 'object') {
    const act = m[m.messageType];
    out[m.messageType] = {
      actorId: act.actorId === null || act.actorId === undefined || act.actorId === '' ? null : String(act.actorId).slice(0, 64),
      actorName: sanitizeText(String(act.actorName || '')).slice(0, 40),
      targetId: String(act.targetId || '').slice(0, 64),
      targetName: sanitizeText(String(act.targetName || '')).slice(0, 40)
    };
  } else if (m.messageType === 'emote' && m.emote && typeof m.emote === 'object' && CHAT_EMOTES[m.emote.act]) {
    const emote = m.emote;
    const line = value => (typeof value === 'string' ? sanitizeText(value).slice(0, 200) : undefined);
    out.emote = {
      act: emote.act,
      label: CHAT_EMOTES[emote.act].label,
      actorId: emote.actorId === null || emote.actorId === undefined || emote.actorId === '' ? null : String(emote.actorId).slice(0, 64),
      actorName: sanitizeText(String(emote.actorName || '')).slice(0, 40),
      targetId: emote.targetId ? String(emote.targetId).slice(0, 64) : null,
      targetName: emote.targetName ? sanitizeText(String(emote.targetName)).slice(0, 40) : null,
      lines: { actor: line(emote.lines?.actor), target: line(emote.lines?.target), other: line(emote.lines?.other) }
    };
  } else if (m.messageType === 'afk' && m.afk && typeof m.afk === 'object') {
    out.afk = {
      targetId: String(m.afk.targetId || '').slice(0, 64),
      targetName: sanitizeText(String(m.afk.targetName || '')).slice(0, 40)
    };
  } else if (m.messageType === 'unstableConcoction' && m.unstableConcoction && typeof m.unstableConcoction === 'object') {
    const phase = m.unstableConcoction.phase === 'resolved' ? 'resolved' : 'activated';
    out.unstableConcoction = {
      phase,
      outcome: unstableConcoction.OUTCOMES.includes(m.unstableConcoction.outcome)
        ? m.unstableConcoction.outcome
        : null,
      playerId: String(m.unstableConcoction.playerId || '').slice(0, 64),
      playerName: sanitizeText(String(m.unstableConcoction.playerName || '')).slice(0, 40)
    };
  }
  return out;
}

function getChatState(room) {
  const now = Date.now();
  const tributeById = new Map((room.bloodTributes || []).map(t => [t.id, t]));
  return {
    messages: room.chat.messages.map(m => {
        const tribute = m.source === 'bloodTribute' ? tributeById.get(m.tributeId) : null;
        const manualState = m.bloodTribute && typeof m.bloodTribute === 'object' ? m.bloodTribute : null;
        const manualExpiresAt = Number(manualState?.expiresAt) || 0;
        const manualClaimed = !!manualState && (manualState.claimed === true || manualExpiresAt <= now);
        const legacyClaimed = m.source === 'bloodTribute' && Number(m.publicUntil) <= now;
        // DELETED MESSAGE -- tombstone. The slot stays in history, the content
        // never leaves the server (and is stripped server-side at delete time
        // anyway). No reactions, attachments, poll card or seen receipts are
        // exposed on a tombstone; the author identity survives for context.
        if (m.deleted === true) {
          return {
            id: m.id,
            playerId: m.playerId,
            playerName: m.playerName,
            deleted: true,
            deletedAt: Number(m.deletedAt) || null,
            timestamp: m.timestamp,
            text: '',
            source: m.source || null,
            messageType: null
          };
        }
        return {
          id: m.id,
          playerId: m.playerId,
          playerName: m.playerName,
          text: m.text,
          timestamp: m.timestamp,
          editedAt: Number(m.editedAt) || null,
          editableByHost: m.source === 'shadowBroker' ? m.editableByHost !== false : false,
          // Persistent chat spans many games. Only a player transmission
          // created on the currently armed board may be adjudicated now.
          adjudicable: room.roomMode === ROOM_MODES.BATTLE && !room.sessionState.matchResult && !m.source && m.boardId === room.boardId,
          verdict: m.verdict,
          target: m.target,
          verdictResponse: m.verdictResponse || null,
          reactions: Object.fromEntries(
            Object.entries(m.reactions || {})
              .filter(([emoji, playerIds]) => CHAT_REACTION_EMOJIS.has(emoji) && Array.isArray(playerIds) && playerIds.length)
              .map(([emoji, playerIds]) => [emoji, Array.from(new Set(playerIds.filter(id => typeof id === 'string')))])
          ),
          source: m.source || null,
          // A Little Hero @all that actually shook every screen.
          nudge: m.nudge === true || undefined,
          imageUrl: !manualClaimed && typeof m.imageUrl === 'string' ? m.imageUrl : undefined,
          messageType: m.messageType || null,
          ...sanitizeChatCommandMeta(m),
          gif: m.messageType === 'gifRemote' && m.gif ? {
            provider: m.gif.provider === 'giphy' ? 'giphy' : undefined,
            providerId: String(m.gif.providerId || '').slice(0, 120),
            title: sanitizeText(m.gif.title || 'GIF').slice(0, 120),
            previewUrl: isAllowedGiphyUrl(m.gif.previewUrl) ? m.gif.previewUrl : undefined,
            mp4Url: isAllowedGiphyUrl(m.gif.mp4Url) ? m.gif.mp4Url : undefined,
            gifUrl: isAllowedGiphyUrl(m.gif.gifUrl) ? m.gif.gifUrl : undefined,
            pageUrl: isAllowedGiphyUrl(m.gif.pageUrl) ? m.gif.pageUrl : undefined,
            width: Math.min(2000, Math.max(1, Number(m.gif.width) || 320)),
            height: Math.min(2000, Math.max(1, Number(m.gif.height) || 240))
          } : undefined,
          poll: m.messageType === 'poll' && m.poll ? {
            question: m.poll.question,
            options: Array.isArray(m.poll.options) ? m.poll.options.slice(0, MAX_POLL_OPTIONS) : [],
            allowMultiple: m.poll.allowMultiple === true,
            createdByRole: m.poll.createdByRole || 'player',
            createdById: m.poll.createdById || null,
            createdAt: Number(m.poll.createdAt) || m.timestamp,
            durationSeconds: Number(m.poll.durationSeconds) || 0,
            expiresAt: Number(m.poll.expiresAt) || null,
            closedAt: Number(m.poll.closedAt) || null,
            votes: Object.fromEntries(
              Object.entries(m.poll.votes || {})
                .filter(([key, ids]) => /^\d+$/.test(key) && Array.isArray(ids))
                .map(([key, ids]) => [key, Array.from(new Set(ids.map(String)))])
            ),
            voters: Object.fromEntries(
              Object.entries(m.poll.voters || {}).map(([id, voter]) => [String(id), {
                name: sanitizeText(voter?.name || '').slice(0, 80),
                avatarData: typeof voter?.avatarData === 'string' ? voter.avatarData : '',
                frameColor: /^#[0-9A-Fa-f]{6}$/.test(voter?.frameColor || '') ? voter.frameColor : '#9B5DE0'
              }])
            )
          } : undefined,
          imageData: tribute && !legacyClaimed ? tribute.imageData : undefined,
          publicUntil: tribute ? tribute.publicUntil : undefined,
          bloodTribute: manualState ? { active: !manualClaimed, claimed: manualClaimed, expiresAt: manualExpiresAt }
            : (legacyClaimed ? { active: false, claimed: true, expiresAt: Number(m.publicUntil) } : undefined),
          // READ RECEIPTS -- server-recorded viewers (actual viewport sightings
          // reported by clients), never websocket delivery. The sender never
          // appears (excluded at record time). recipientIds is a send-time
          // snapshot so the GM can still split SEEN/NOT SEEN after players leave.
          // Receipt names are stored with the sighting so disconnected readers
          // remain identifiable; older receipts still resolve through the roster.
          seenBy: Array.isArray(m.seenBy)
            ? m.seenBy
                .filter(r => r && typeof r.playerId === 'string')
                .map(r => ({
                  playerId: r.playerId,
                  playerName: sanitizeText(r.playerName || '').slice(0, 80),
                  seenAt: Number(r.seenAt) || 0
                }))
            : [],
          recipientCount: Number(m.recipientCount) || 0,
          recipientIds: Array.isArray(m.recipientIds)
            ? m.recipientIds.filter(id => typeof id === 'string')
            : []
        };
      }),
    solvedTargets: { ...room.chat.solvedTargets }
  };
}

function broadcastChatUpdate(room) {
  const chatState = getChatState(room);
  broadcastToRoom(room, { type: 'chat:update', ...chatState });
}

function handleHostCommand(ws, message) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can send commands' });
    return;
  }

  const cmdId = message.cmdId;
  if (cmdId !== undefined && (
    (typeof cmdId !== 'string' && typeof cmdId !== 'number') ||
    String(cmdId).length > 128
  )) {
    sendToWs(ws, { type: 'error', code: 'INVALID_COMMAND_ID', message: 'Invalid command ID' });
    return;
  }

  // Current clients use UUID strings. Persist those receipts so a retry after
  // reconnect or process restart cannot apply a destructive command twice.
  // Numeric ids remain accepted as legacy compatibility, but are deliberately
  // not deduplicated because old clients reset their counter after refresh.
  const replayProtected = typeof cmdId === 'string' && cmdId.length > 0;
  room.commandReceipts ||= [];
  if (replayProtected) {
    const receipt = room.commandReceipts.find(entry => entry.cmdId === cmdId);
    if (receipt) {
      sendToWs(ws, receipt.ack);
      return;
    }
  }

  const result = applyCommand(room, message.command, message.payload || {});
  if (!result.success) {
    sendToWs(ws, { type: 'error', cmdId, message: result.error });
    return;
  }

  const ack = {
    type: 'command:ack',
    cmdId,
    revision: room.revision,
    ...(result.changed ? {} : { unchanged: true })
  };

  if (replayProtected) {
    room.commandReceipts.push({ cmdId, ack });
    if (room.commandReceipts.length > 2048) {
      room.commandReceipts.splice(0, room.commandReceipts.length - 2048);
    }
  }

  if (result.changed || replayProtected) {
    // The receipt and the mutation reach the same recovery snapshot, so a
    // client can safely retry whenever it is unsure whether an ACK arrived.
    persistActiveRooms();
  }

  if (result.changed) {
    if (result.recountClosed) broadcastRecount(room, null, false);
    broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
    if (message.command === 'resetBoard') {
      broadcastChatUpdate(room);
      broadcastPlayersUpdate(room);
    }
  }

  sendToWs(ws, ack);
}

function handlePlayerJoin(ws, message) {
  const { name } = message;
  const auth = getPlayerAuth(message.authToken);
  if (!auth) {
    sendToWs(ws, { type: 'auth:required', role: 'player', message: 'Little Hero authentication required' });
    return;
  }
  const requestedId = auth.playerId;
  // Sessions can outlive a verification-policy change. Trust current account
  // semantics (including legacy verified accounts), not token issuance time.
  let account;
  try {
    account = auth.isMasterTest ? masterTestAccount(auth) : authStore.getById(requestedId);
  } catch {
    sendToWs(ws, { type: 'error', code: 'AUTH_STORAGE_UNAVAILABLE', message: 'Authentication temporarily unavailable' });
    return;
  }
  if (!account || (EMAIL_VERIFICATION_REQUIRED && !account.emailVerified)) {
    playerAuthTokens.delete(playerTokenKey(message.authToken));
    savePlayerAuthSessions();
    sendToWs(ws, { type: 'auth:required', role: 'player',
      code: account ? 'EMAIL_NOT_VERIFIED' : 'ACCOUNT_NOT_FOUND',
      message: account ? 'Email verification required before entering MASTER.' : 'Little Hero authentication required' });
    return;
  }

  const moderation = auth.isMasterTest ? { banned: false, reason: '' } : playerStore.getModerationStatus(requestedId);
  if (moderation.banned) {
    const banReason = sanitizeText(typeof moderation.reason === 'string' ? moderation.reason : '');
    sendToWs(ws, {
      type: 'moderation:banned',
      message: banReason
        ? `ACCESS DENIED // This Little Hero is banned from the Master Room. // REASON: ${banReason}`
        : 'ACCESS DENIED // This Little Hero is banned from the Master Room.'
    });
    setImmediate(() => {
      try { if (ws.readyState === 1) ws.close(4003, 'Banned from Master Room'); } catch {}
    });
    return;
  }

  const room = rooms.get(MASTER_ROOM_CODE);

  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Master Room unavailable' });
    return;
  }

  // The account owns the display identity. A browser-supplied name is only
  // a compatibility fallback for very old accounts that predate stored names.
  const cleanName = sanitizeText(account.name || name).slice(0, 20);
  if (!cleanName) {
    sendToWs(ws, { type: 'error', message: 'Name cannot be empty' });
    return;
  }

  const hasAvatarUpdate = Object.prototype.hasOwnProperty.call(message, 'avatarData');
  const requestedAvatar = message.avatarData === '' ? '' : sanitizeAvatarData(message.avatarData);
  const requestedFrameColor = sanitizeFrameColor(message.frameColor);
  const requestedThemeId = sanitizeThemeId(message.themeId);
  if (hasAvatarUpdate && requestedAvatar === null) {
    sendToWs(ws, { type: 'error', message: 'Invalid avatar image' });
    return;
  }
  if (message.frameColor !== undefined && !requestedFrameColor) {
    sendToWs(ws, { type: 'error', message: 'Invalid avatar frame color' });
    return;
  }
  if (message.themeId !== undefined && !requestedThemeId) {
    sendToWs(ws, { type: 'error', message: 'Invalid Little Hero theme profile' });
    return;
  }

  let littleHeroProfile;
  if (auth.isMasterTest) {
    littleHeroProfile = {
      avatarData: hasAvatarUpdate ? (requestedAvatar || '') : '',
      frameColor: requestedFrameColor || '#9B5DE0',
      themeId: requestedThemeId || 'gunmetal'
    };
  } else {
    littleHeroProfile = playerStore.getOrCreateProfile({ id: requestedId, name: cleanName }).profile;
    if (hasAvatarUpdate || requestedFrameColor || requestedThemeId) {
      littleHeroProfile = playerStore.updateProfileAppearance({ id: requestedId, name: cleanName }, {
        avatarData: hasAvatarUpdate ? requestedAvatar : undefined,
        frameColor: requestedFrameColor || undefined,
        themeId: requestedThemeId || undefined,
        themeColor: requestedThemeId ? LITTLE_HERO_THEMES[requestedThemeId] : undefined
      });
    }
  }

  // The authenticated account id is the canonical player identity. Reuse
  // that id across reconnects so a dropped socket or refresh cannot create
  // a duplicate Little Hero, and never trust a client-supplied player id.
  let playerId = requestedId;
  if (playerId) {
    for (const [existingWs, info] of room.players) {
      if (info.id === playerId) {
        if (existingWs !== ws && existingWs.readyState === 1) {
          // A live duplicate connection under the same id (e.g. the old
          // socket hasn't noticed it's dead yet) -- this new one supersedes it.
          // Deliberate supersession, not a network failure. The custom close
          // code lets the old browser stop instead of reconnecting and
          // immediately evicting the new socket in an endless ping-pong loop.
          try { existingWs.close(4001, 'Superseded by newer Little Hero connection'); } catch (e) {}
        }
        room.players.delete(existingWs);
        playerId = requestedId;
        break;
      }
    }
  }
  if (!playerId) playerId = generatePlayerId();

  ws.roomCode = MASTER_ROOM_CODE;
  ws.playerId = playerId;
  ws.playerName = cleanName;
  ws.isHost = false;

  room.players.set(ws, {
    id: playerId,
    name: cleanName,
    avatarData: littleHeroProfile.avatarData || '',
    frameColor: littleHeroProfile.frameColor || '#9B5DE0',
    themeId: littleHeroProfile.themeId || 'gunmetal',
    themeColor: LITTLE_HERO_THEMES[littleHeroProfile.themeId || 'gunmetal'] || '#343A42',
    connected: true,
    isTestPersona: auth.isMasterTest === true,
    joinedAt: Date.now()
  });
  // Master test personas exercise the live session but never enter durable
  // participation history. Real Little Heroes keep the normal ledger path.
  if (!auth.isMasterTest) {
    matchLedger.presenceOpen(ensureMatchLedger(room), playerId, cleanName, Date.now());
  }

  // A player is not considered joined until the durable Master Room snapshot
  // already contains that identity. Persist before any success/state frames.
  persistActiveRooms();
  const publicState = getPublicState(room);
  sendToWs(ws, { type: 'state:public', ...publicState });
  sendToWs(ws, {
    type: 'join:success',
    playerId,
    roomCode: room.code,
    littleHero: {
      name: cleanName,
      avatarData: littleHeroProfile.avatarData || '',
      frameColor: littleHeroProfile.frameColor || '#9B5DE0',
      themeId: littleHeroProfile.themeId || 'gunmetal',
      themeColor: LITTLE_HERO_THEMES[littleHeroProfile.themeId || 'gunmetal'] || '#343A42'
    }
  });

  const chatState = getChatState(room);
  sendToWs(ws, { type: 'chat:update', ...chatState });
  sendRecountHydration(ws, room);
  // Always sent, active or not: the overlay's own visibility is CSS-driven
  // off roomMode alone (see #game-screen.room-mode-battle-armed), so a
  // joining player must never be left in an undefined ritual state -- an
  // inactive-but-unsent ritual would otherwise render an empty overlay shell
  // if roomMode happened to already be BATTLE_ARMED (e.g. a room armed
  // before a ritual field existed in its persisted snapshot).
  sendToWs(ws, {
    type: 'ritual:update',
    ritual: { ...getRitualSafeState(room), iJoined: !!room.ritual?.joinedPlayerIds?.includes(String(playerId)) }
  });

  broadcastPlayersUpdate(room);
  console.log(`[ROOM ${room.code}] Player joined: ${cleanName} (${playerId})`);
}

function getPlayersSnapshot(room, includeTestPersonas = true) {
  const players = [];
  const profiles = playerStore.loadPlayers();
  room.players.forEach((player, ws) => {
    if (!includeTestPersonas && player.isTestPersona === true) return;
    const profile = profiles[String(player.id)] || {};
    players.push({
      id: player.id,
      name: player.name,
      avatarData: player.avatarData || '',
      frameColor: player.frameColor || '#9B5DE0',
      themeId: player.themeId || 'gunmetal',
      themeColor: LITTLE_HERO_THEMES[player.themeId || 'gunmetal'] || '#343A42',
      connected: ws.readyState === 1,
      isTestPersona: player.isTestPersona === true,
      score: room.scoring.players[player.id]?.sessionScore || 0,
      threefoldPlayed: Number(profile.threefoldPlayed) || 0,
      threefoldWins: Number(profile.threefoldWins) || 0,
      threefoldLosses: Number(profile.threefoldLosses) || 0,
      threefoldDraws: Number(profile.threefoldDraws) || 0,
      asocGamesEarned: Number(profile.asocGamesEarned) || 0
    });
  });
  return players;
}

function sendPlayersUpdateTo(room, ws) {
  if (!room || !ws || ws.readyState !== 1) return;
  sendToWs(ws, { type: 'players:update', players: getPlayersSnapshot(room, ws.isHost === true) });
}

function broadcastPlayersUpdate(room) {
  const playerMessage = { type: 'players:update', players: getPlayersSnapshot(room, false) };
  room.players.forEach((player, ws) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(playerMessage));
  });
  if (room.hostConnection?.readyState === 1) {
    room.hostConnection.send(JSON.stringify({ type: 'players:update', players: getPlayersSnapshot(room, true) }));
  }
}

function handleModeratePlayer(ws, message, shouldBan) {
  const room = rooms.get(MASTER_ROOM_CODE);
  if (!room || ws !== room.hostConnection || ws.isHost !== true) {
    sendToWs(ws, { type: 'error', message: 'Only Shadow Broker can moderate the Master Room' });
    return;
  }

  const playerId = typeof message.playerId === 'string' ? message.playerId.trim() : '';
  if (!playerId) {
    sendToWs(ws, { type: 'error', message: 'Invalid player identity' });
    return;
  }

  const reason = sanitizeText(typeof message.reason === 'string' ? message.reason : '');
  if (!reason) {
    sendToWs(ws, { type: 'error', message: 'A moderation reason is required' });
    return;
  }
  if (reason.length > MAX_MODERATION_REASON_LENGTH) {
    sendToWs(ws, { type: 'error', message: `Moderation reason is too long (max ${MAX_MODERATION_REASON_LENGTH} characters)` });
    return;
  }

  let targetWs = null;
  let targetPlayer = null;
  for (const [candidateWs, player] of room.players) {
    if (player.id === playerId && candidateWs.readyState === 1) {
      targetWs = candidateWs;
      targetPlayer = player;
      break;
    }
  }

  if (!targetWs || !targetPlayer) {
    sendToWs(ws, { type: 'error', message: 'Player is no longer online' });
    broadcastPlayersUpdate(room);
    return;
  }

  const action = shouldBan ? 'ban' : 'kick';
  const actionPast = shouldBan ? 'BANNED' : 'KICKED';
  if (shouldBan && targetPlayer.isTestPersona !== true) {
    playerStore.setBan(
      { id: targetPlayer.id, name: targetPlayer.name },
      true,
      reason
    );
  }

  const announcement = addShadowBrokerMessage(
    room,
    `MODERATION // ${targetPlayer.name} was ${actionPast} from the Master Room. // REASON: ${reason}`
  );
  if (announcement.success) {
    persistActiveRooms();
    broadcastChatUpdate(room);
  }

  sendToWs(targetWs, {
    type: shouldBan ? 'moderation:banned' : 'moderation:kicked',
    message: shouldBan
      ? `ACCESS DENIED // Shadow Broker has banned this Little Hero from the Master Room. // REASON: ${reason}`
      : `CONNECTION TERMINATED // Shadow Broker removed you from the Master Room. // REASON: ${reason}`
  });
  sendToWs(ws, {
    type: 'moderation:ack',
    action,
    playerId: targetPlayer.id,
    playerName: targetPlayer.name,
    reason
  });

  try {
    targetWs.close(shouldBan ? 4003 : 4002, shouldBan ? 'Banned by Shadow Broker' : 'Kicked by Shadow Broker');
  } catch {}
}

function handlePlayersList(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  sendPlayersUpdateTo(room, ws);
}

function handleHostReconnect(ws, message) {
  const { hostToken } = message;
  const room = rooms.get(MASTER_ROOM_CODE);

  if (!room) {
    sendToWs(ws, { type: 'error', code: 'reconnect_room_not_found', message: 'Room not found' });
    return;
  }

  if (room.hostToken !== hostToken) {
    sendToWs(ws, { type: 'error', code: 'reconnect_invalid_token', message: 'Invalid host token' });
    return;
  }

  if (room.hostConnection && room.hostConnection.readyState === 1) {
    sendToWs(ws, { type: 'error', code: 'reconnect_host_already_connected', message: 'Host already connected' });
    return;
  }

  room.hostConnection = ws;
  ws.roomCode = MASTER_ROOM_CODE;
  ws.isHost = true;
  ws.hostToken = hostToken;

  if (room.hostReconnectTimer) {
    clearTimeout(room.hostReconnectTimer);
    room.hostReconnectTimer = null;
  }

  // Send the full authoritative game data first. A reconnecting GM client
  // (e.g. after a page refresh) may have only the sample/first-in-library
  // game loaded locally, not whatever game this room is actually running
  // (the host could have switched games before disconnecting). Sending
  // game:loaded before state:public ensures the client's local GameData
  // matches the room before reveal state is applied on top of it, so cell
  // reveal flags never get applied to the wrong game's board.
  sendToWs(ws, { type: 'game:loaded', game: room.gameData });

  const publicState = getPublicState(room);
  sendToWs(ws, { type: 'state:public', ...publicState });
  sendToWs(ws, { type: 'host:reconnected', roomCode: room.code });

  const chatState = getChatState(room);
  sendToWs(ws, { type: 'chat:update', ...chatState });
  sendRecountHydration(ws, room);
  sendTributeVaultToHost(room);
  sendRitualDetailToHost(room);

  broadcastPlayersUpdate(room);
  console.log(`[ROOM ${room.code}] Host reconnected`);
}

function handleHostRecover(ws) {
  const room = rooms.get(MASTER_ROOM_CODE);

  if (!room) {
    sendToWs(ws, { type: 'host:recovery-none', roomCode: MASTER_ROOM_CODE });
    return;
  }

  if (room.hostConnection && room.hostConnection.readyState === 1) {
    sendToWs(ws, { type: 'error', code: 'recover_host_already_connected', message: 'Shadow Broker is already connected' });
    return;
  }

  const hostToken = generateHostToken();
  room.hostConnection = ws;
  room.hostToken = hostToken;
  room.hostReconnectTimer = null;
  ws.roomCode = MASTER_ROOM_CODE;
  ws.isHost = true;
  ws.hostToken = hostToken;

  persistActiveRooms();
  sendToWs(ws, { type: 'game:loaded', game: room.gameData });
  sendToWs(ws, { type: 'state:public', ...getPublicState(room) });
  sendToWs(ws, { type: 'host:recovered', roomCode: room.code, hostToken });
  sendToWs(ws, { type: 'chat:update', ...getChatState(room) });
  sendRecountHydration(ws, room);
  sendTributeVaultToHost(room);
  sendRitualDetailToHost(room);
  broadcastPlayersUpdate(room);
  console.log(`[MASTER ROOM] Shadow Broker recovered ${normalizeRoomMode(room.roomMode, room.armed)} session without browser host token`);
}

function playerCooldown(room, ws) {
  const id = ws === room.hostConnection ? '__GM__' : room.players.get(ws)?.id;
  if (!id) return null;
  room.cooldowns ||= new Map();
  const now = Date.now();
  for (const [key, value] of room.cooldowns) if (now - Math.max(value.chatAt || 0, value.reactionAt || 0) > 1000) room.cooldowns.delete(key);
  if (!room.cooldowns.has(id)) room.cooldowns.set(id, {});
  return room.cooldowns.get(id);
}
function handleHintRequest(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room || ws.isHost || !ws.playerId) {
    sendToWs(ws, { type: 'error', message: 'Hint request requires a Little Hero in the room' });
    return;
  }
  if (room.roomMode !== ROOM_MODES.BATTLE || room.sessionState.matchResult) {
    sendToWs(ws, { type: 'error', message: 'Hints are only available during an active battle' });
    return;
  }
  const cell = String(message.cell || '').toUpperCase();
  if (!/^[A-D][1-4]$/.test(cell) || room.sessionState.cells[cell] !== true) {
    sendToWs(ws, { type: 'error', message: 'Hint is only available for an opened clue row' });
    return;
  }
  room.hintClaims ||= {};
  if (room.hintClaims[cell]) {
    sendToWs(ws, { type: 'error', message: 'That row hint has already been used' });
    return;
  }

  room.hintClaims[cell] = { playerId: ws.playerId, playerName: ws.playerName, at: Date.now() };
  const posted = addChatMessage(room, ws.playerId, ws.playerName, `HINT REQUEST // ${cell}`);
  if (posted.success) {
    posted.message.source = 'hintRequest';
    posted.message.boardId = null;
  }
  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastChatUpdate(room);
}

function handleChatGuess(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  if (ws.isHost) {
    sendToWs(ws, { type: 'error', message: 'Host cannot submit guesses' });
    return;
  }

  const { text } = message;
  if (!text || typeof text !== 'string') {
    sendToWs(ws, { type: 'error', message: 'Invalid guess' });
    return;
  }

  const now = Date.now();
  const cooldown = playerCooldown(room, ws);
  if (!cooldown) return;
  if (cooldown.chatAt && now - cooldown.chatAt < PLAYER_CHAT_MIN_INTERVAL_MS) {
    sendToWs(ws, { type: 'error', message: 'Battle Comms cooling down' });
    return;
  }
  // "/all message" is the typed form of a nudge: it posts "@all message".
  const allCommand = String(text).trim().match(/^\/all(?:\s+([\s\S]*))?$/i);
  const chatText = allCommand ? `@all${allCommand[1] ? ' ' + allCommand[1].trim() : ''}` : text;
  const dispatch = allCommand ? null : dispatchPlayerSlashCommand(room, ws, chatText, message);
  const result = dispatch !== null
    ? dispatch
    : addChatMessage(room, ws.playerId, ws.playerName, chatText);
  if (result.success) {
    cooldown.chatAt = now;
    const nudge = dispatch === null && containsAllMention(result.message.text)
      ? applyPlayerNudge(room, ws, result.message)
      : null;
    // Permanent channel contract: if clients can see a transmission, it has
    // already reached the recovery snapshot.
    persistActiveRooms();
    broadcastChatUpdate(room);
    if (result.tributeTriggered || nudge === 'tribute') broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
    if (nudge === 'nudge') {
      broadcastToRoom(room, {
        type: 'chat:mentionAll',
        messageId: result.message.id,
        fromPlayerId: ws.playerId,
        fromName: ws.playerName,
        timestamp: Date.now()
      });
    } else if (nudge === 'blocked') {
      sendToWs(ws, { type: 'error', message: 'YOUR NUDGE WAS SWALLOWED BY THE VOID' });
    }
  } else {
    sendToWs(ws, { type: 'error', message: result.error });
  }
}

function handleChatEdit(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  const messageId = typeof message.messageId === 'string' ? message.messageId : '';
  const rawText = typeof message.text === 'string' ? message.text : '';
  if (!messageId || !rawText) {
    sendToWs(ws, { type: 'error', message: 'Invalid edit' });
    return;
  }

  const target = room.chat.messages.find(entry => entry.id === messageId);
  if (!target) {
    sendToWs(ws, { type: 'error', message: 'Message not found' });
    return;
  }

  const isHost = ws === room.hostConnection;
  if (isHost) {
    if (target.deleted === true) {
      sendToWs(ws, { type: 'error', message: 'Message deleted' });
      return;
    }
    if (target.source !== 'shadowBroker' || target.editableByHost === false) {
      sendToWs(ws, { type: 'error', message: 'Shadow Broker can only edit its own transmissions' });
      return;
    }
  } else {
    if (target.source || String(target.playerId || '') !== String(ws.playerId || '')) {
      sendToWs(ws, { type: 'error', message: 'You can only edit your own messages' });
      return;
    }
    if (target.verdict !== null && target.verdict !== undefined) {
      sendToWs(ws, { type: 'error', message: 'Judged messages are locked' });
      return;
    }
  }

  const sanitized = sanitizeText(rawText);
  if (!sanitized) {
    sendToWs(ws, { type: 'error', message: 'Empty message' });
    return;
  }
  if (!isHost && sanitized.length > MAX_CHAT_LENGTH) {
    sendToWs(ws, { type: 'error', message: `Message too long (max ${MAX_CHAT_LENGTH} chars)` });
    return;
  }
  if (sanitized === target.text) return;

  target.text = sanitized;
  target.editedAt = Date.now();
  persistActiveRooms();
  broadcastChatUpdate(room);
}

function handleChatReaction(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  const messageId = typeof message.messageId === 'string' ? message.messageId : '';
  const emoji = typeof message.emoji === 'string' ? message.emoji : '';
  const isHost = ws === room.hostConnection;
  if (!messageId || !CHAT_REACTION_EMOJIS.has(emoji)) {
    sendToWs(ws, { type: 'error', message: 'Invalid reaction' });
    return;
  }

  if (COMMANDER_REACTION_EMOJIS.has(emoji) && !isHost) {
    sendToWs(ws, { type: 'error', message: 'Commander reactions are Shadow Broker only' });
    return;
  }

  const now = Date.now();
  const cooldown = playerCooldown(room, ws);
  if (!cooldown) return;
  if (cooldown.reactionAt && now - cooldown.reactionAt < PLAYER_REACTION_MIN_INTERVAL_MS) {
    return;
  }

  const target = room.chat.messages.find(entry => entry.id === messageId);
  if (!target) {
    sendToWs(ws, { type: 'error', message: 'Message not found' });
    return;
  }

  if (target.deleted === true) {
    sendToWs(ws, { type: 'error', message: 'Message deleted' });
    return;
  }

  if (!target.reactions || typeof target.reactions !== 'object' || Array.isArray(target.reactions)) {
    target.reactions = {};
  }

  const current = Array.isArray(target.reactions[emoji]) ? target.reactions[emoji] : [];
  const actorId = isHost ? '__GM__' : String(ws.playerId || '');
  if (!actorId) return;
  const index = current.indexOf(actorId);
  if (index >= 0) {
    current.splice(index, 1);
  } else {
    current.push(actorId);
  }

  if (current.length) target.reactions[emoji] = current;
  else delete target.reactions[emoji];

  cooldown.reactionAt = now;
  persistActiveRooms();
  broadcastChatUpdate(room);
}

// SHADOW BROKER free-form broadcast -- host-only, presentation layer only.
// Reuses the existing chat pipeline end to end (addShadowBrokerMessage's
// validation mirrors addChatMessage exactly; broadcastChatUpdate is the
// same function every other chat mutation already uses), so this adds
// exactly one new code path rather than a parallel message system. No
// scoring, verdict, timer, clue, or reveal state is touched.
function containsAllMention(text) {
  return /(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_])/iu.test(String(text || ''));
}

// LITTLE HERO NUDGE. A player's @all (or "/all message") is an old-school
// nudge: every screen shakes, exactly like the Shadow Broker's @all.
// Hidden one-time toll, never shown in the UI: after NUDGE_FREE_USES nudges
// the next one is swallowed and that player is handed a Blood Tribute
// demand. Once it is paid (or the GM forgives it) the player is marked
// NUDGE_SETTLED and nudges freely forever -- the toll never comes back.
// Returns:
//   'nudge'   -- shake everyone (message.nudge is set)
//   'tribute' -- over the limit; the nudge Blood Tribute was just demanded
//   'blocked' -- over the limit while a tribute is still owed
const NUDGE_FREE_USES = 5;
const NUDGE_SETTLED = 'settled';
function settleNudgeToll(room, playerId) {
  room.nudgeCounts ||= {};
  room.nudgeCounts[String(playerId)] = NUDGE_SETTLED;
}
function applyPlayerNudge(room, ws, message) {
  const player = room.players.get(ws);
  if (!player) return null;
  // The GM's Master Mirror persona is the GM testing: nudges, never pays.
  if (player.isTestPersona === true || isMasterTestPlayerId(player.id)) {
    message.nudge = true;
    return 'nudge';
  }
  room.nudgeCounts ||= {};
  const id = String(player.id);
  if (room.nudgeCounts[id] === NUDGE_SETTLED) {
    message.nudge = true;
    return 'nudge';
  }
  const used = Number(room.nudgeCounts[id]) || 0;
  if (used < NUDGE_FREE_USES) {
    room.nudgeCounts[id] = used + 1;
    message.nudge = true;
    return 'nudge';
  }
  // One Blood Tribute demand exists room-wide; never overwrite someone
  // else's (or this player's own) outstanding debt.
  if (room.pendingTribute?.status === 'required') return 'blocked';
  armBloodTributeForPlayer(room, player, null, 'nudge');
  room.revision++;
  return 'tribute';
}

function handleGmBroadcast(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can send a Shadow Broker transmission' });
    return;
  }

  const { text } = message;
  if (!text || typeof text !== 'string') {
    sendToWs(ws, { type: 'error', message: 'Invalid transmission text' });
    return;
  }

  const requestedRoll = parseRollCommand(text);
  if (requestedRoll) {
    if (requestedRoll.error) {
      sendToWs(ws, { type: 'error', message: requestedRoll.error });
      return;
    }
    const gmRange = { min: Math.max(2, requestedRoll.min), max: Math.min(100, requestedRoll.max) };
    if (gmRange.max < gmRange.min) {
      sendToWs(ws, { type: 'error', message: 'SHADOW BROKER ROLLS REQUIRE A RANGE BETWEEN 2 AND 100' });
      return;
    }
    const rollResult = addRollMessage(room, null, 'SHADOW BROKER', gmRange, { isGm: true });
    persistActiveRooms();
    broadcastChatUpdate(room);
    return;
  }

  // GM operational verbs (/recount /womf /commands /spit) run server-side and
  // are never broadcast as literal text.
  const dispatch = dispatchGmSlashCommand(room, ws, text);
  if (dispatch) {
    if (dispatch.error) sendToWs(ws, { type: 'error', message: dispatch.error });
    if (dispatch.broadcast && dispatch.success) {
      persistActiveRooms();
      broadcastChatUpdate(room);
    }
    return;
  }

  const result = addShadowBrokerMessage(room, text, { editableByHost: true });
  if (result.success) {
    persistActiveRooms();
    broadcastChatUpdate(room);

    // @all is a live host-only attention command. The chat message itself is
    // persistent; the shake is deliberately ephemeral and never replays when
    // somebody reconnects and hydrates old chat history.
    if (containsAllMention(result.message.text)) {
      broadcastToRoom(room, {
        type: 'chat:mentionAll',
        messageId: result.message.id,
        timestamp: Date.now()
      });
    }
  } else {
    sendToWs(ws, { type: 'error', message: result.error });
  }
}

// CLEAR is deliberately ephemeral presentation state. It tells every live
// surface to remove the current HUD transmission, while leaving the
// authoritative chat history, scoring, timer, reveals, and player state alone.
function handleGmClearBroadcast(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can clear a Shadow Broker transmission' });
    return;
  }
  broadcastToRoom(room, { type: 'shadowBroker:clear', timestamp: Date.now() });
}

// NEMA ASOC -- host-only theatrical threat effect. Ephemeral presentation
// only: no score, clue, timer, chat, WOMF, or persistence state changes.
function handleGmNemaAsoc(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can trigger NEMA ASOC' });
    return;
  }
  broadcastToRoom(room, { type: 'nemaAsoc', timestamp: Date.now() });
}

const BICE_ASOC_LINES = [
  'HUMANITY GRANTED ONE ADDITIONAL ATTEMPT',
  'STUPIDITY ACCEPTED AS A VALID STRATEGY',
  'MORALE ANOMALY DETECTED',
  'THE SUBJECT HAS ACCIDENTALLY CONTRIBUTED',
  'ENTERTAINMENT VALUE EXCEEDED EXPECTATIONS',
  'INTELLIGENCE UNCONFIRMED. RESULTS ACCEPTABLE.',
  'THE MACHINE IS... AMUSED.',
  'TERMINATION POSTPONED',
  'THIS SHOULD NOT HAVE WORKED',
  'ASOC PRIVILEGES TEMPORARILY RESTORED'
];

function handleGmBiceAsoc(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can trigger BIĆE ASOC' });
    return;
  }
  const line = BICE_ASOC_LINES[Math.floor(Math.random() * BICE_ASOC_LINES.length)];
  broadcastToRoom(room, { type: 'biceAsoc', line, timestamp: Date.now() });
}


// OMEN -- host-only, Battle-only theatrical signal. It carries no answer,
// score, timer or persistence state: the board merely reacts to something
// the Shadow Broker decided was ominously close to the Final Solution.
function handleGmOmen(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can trigger OMEN' });
    return;
  }
  if (!isBattleSurface(room)) {
    sendToWs(ws, { type: 'error', message: 'OMEN is only available on the Battle surface' });
    return;
  }
  broadcastToRoom(room, { type: 'board:omen', timestamp: Date.now() });
}

// GAME WON -- the host's manual declaration of victory, and the ONLY way
// sessionState.gameWon is set. (Accepting a Final guess is not the end of the
// game: columns can still be solved, so it never triggers this.) It only flips
// sessionState.gameWon and broadcasts state:public: no score, clue, timer,
// chat or WOMF change, and every client's sequence keys off that state
// transition. Idempotent -- a game that is already won never re-triggers.
function handleGmGameWon(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can trigger GAME WON' });
    return;
  }
  if (!isBattleSurface(room)) {
    sendToWs(ws, { type: 'error', message: 'GAME WON is only available on the Battle surface' });
    return;
  }
  if (room.sessionState.matchResult?.outcome === 'LOST') {
    sendToWs(ws, { type: 'error', message: 'The match is already LOST' });
    return;
  }
  if (room.sessionState.gameWon === true) return;
  clearSolutionCountdown(room, 'FINAL');
  // FINAL GREEN is a real completed board. Record participation/win stats and
  // stop the timer before publishing the authoritative GAME WON state.
  finalizeBoard(room, 'success');
  const performance = buildWinPerformance(room);
  room.sessionState.gameWon = true;
  room.sessionState.finalSolution = true;
  room.sessionState.finalOutcome = 'success';
  room.sessionState.matchResult = {
    outcome: 'WON',
    occurredAt: Date.now(),
    message: GAME_WON_MESSAGES[crypto.randomInt(GAME_WON_MESSAGES.length)],
    story: room.gameData.story || '',
    finalSolution: room.gameData.finalSolution || '',
    columnSolutions: {
      A: room.gameData.columns?.A?.solution || '', B: room.gameData.columns?.B?.solution || '',
      C: room.gameData.columns?.C?.solution || '', D: room.gameData.columns?.D?.solution || ''
    },
    columnResults: {
      A: isColumnSolvedGreen(room, 'A'), B: isColumnSolvedGreen(room, 'B'),
      C: isColumnSolvedGreen(room, 'C'), D: isColumnSolvedGreen(room, 'D')
    },
    matchWinner: performance.matchWinner,
    winners: performance.winners,
    performers: performance.performers
  };
  if (room.timer && !['ready', 'expired', 'stopped'].includes(room.timer.phase)) room.timer.phase = 'stopped';
  const ledger = ensureMatchLedger(room);
  if (!ledger.completedAt) ledger.completedAt = room.sessionState.matchResult.occurredAt;
  const fields = matchLedger.resolveFields({
    solvedTargets: solvedTargetsForFieldState(room),
    failedColumns: (room.womf && room.womf.failedColumns) || {},
    revealed: { A: room.sessionState.cells.A5 === true, B: room.sessionState.cells.B5 === true,
      C: room.sessionState.cells.C5 === true, D: room.sessionState.cells.D5 === true, FINAL: true },
    ledger
  });
  try { archiveCompletedMatch(room, fields); } catch (error) { console.error('[match] Victory archive failed:', error.message); }
  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
}

function scheduleSolvedColumnReveal(room, messageId, column) {
  if (!SCORABLE_COLUMNS.includes(column)) return;
  room.pendingReveals ||= {};
  if (room.pendingReveals[column]?.messageId === messageId) return;
  const action = {
    messageId,
    column,
    boardId: room.boardId,
    deadline: Date.now() + COLUMN_REVEAL_DELAY_MS,
    token: crypto.randomUUID()
  };
  room.pendingReveals[column] = action;
  persistActiveRooms();
  armColumnReveal(room, action);
}
function armColumnReveal(room, action) {
  setTimeout(() => runtimeAction(() => {
    const live = rooms.get(room.code);
    if (!live || live.pendingReveals?.[action.column]?.token !== action.token) return;
    delete live.pendingReveals[action.column];
    const judged = live.chat.messages.find(m => m.id === action.messageId);
    if (live.armed && live.boardId === action.boardId &&
        live.chat.solvedTargets[action.column]?.messageId === action.messageId &&
        judged?.verdict === 'correct' && judged.target === action.column) {
      const result = applyCommand(live, 'revealColumn', { column: action.column });
      persistActiveRooms();
      if (result.success && result.changed) broadcastToRoom(live, { type: 'state:public', ...getPublicState(live) });
    } else persistActiveRooms();
  }), Math.max(0, action.deadline - Date.now()));
}

function handleJudgeGuess(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can judge guesses' });
    return;
  }

  if (room.sessionState.matchResult) {
    sendToWs(ws, { type: 'error', message: `GAME ${room.sessionState.matchResult.outcome} // FINAL SOLUTION attempts locked` });
    return;
  }

  const { messageId, target, reveal } = message;
  const verdict = message.verdict;
  if (!messageId || !verdict || !['wrong', 'correct', 'clear'].includes(verdict)) {
    sendToWs(ws, { type: 'error', message: 'Invalid verdict data' });
    return;
  }
  // 'clear' only undoes a WRONG (the red X toggles). CORRECT is retracted by
  // re-judging it, which runs the full credit reversal.
  if (verdict === 'clear') {
    const judged = room.chat.messages.find(m => m.id === messageId);
    if (!judged || judged.verdict !== 'wrong') {
      sendToWs(ws, { type: 'error', message: 'Only a WRONG verdict can be cleared' });
      return;
    }
  }

  if (verdict === 'correct' && !target) {
    sendToWs(ws, { type: 'error', message: 'Target required for correct verdict' });
    return;
  }

  if (
    verdict === 'correct' &&
    SCORABLE_COLUMNS.includes(target) &&
    ['success', 'failed'].includes(room.sessionState?.cellOutcomes?.[`${target}5`])
  ) {
    sendToWs(ws, { type: 'error', message: `Column ${target} has already been resolved on the board` });
    return;
  }

  const result = applyVerdict(room, messageId, verdict === 'clear' ? null : verdict, target, reveal);
  if (result.success) {
    // A verdict mutates the authoritative room (scoring, solved targets,
    // verdicts) and may finalize the board -- persist before any broadcast.
    persistActiveRooms();
    broadcastChatUpdate(room);
    if (result.changed) {
      const publicState = getPublicState(room);
      broadcastToRoom(room, { type: 'state:public', ...publicState });
    }

    // Any scoring change (award, reversal, or a streak rebuild) means
    // session scores moved -- refresh every client's player list. EXCEPTION:
    // when this verdict is the one that just resolved the Final
    // (result.finalOutcome truthy), the jackpot was already committed to
    // room.scoring.players/players.json inside awardFinalSolve/finalizeBoard
    // above -- COMMIT SCORE NOW -- but per the locked pacing spec the
    // *visible* leaderboard movement must not appear until the GM clicks
    // SHOW RESULTS -- DISPLAY SCORE LATER. handleRevealResults() is the one
    // place that broadcasts players:update for that case; ordinary column
    // awards/reversals/streak rebuilds still update the leaderboard
    // immediately, exactly as before.
    if (!result.finalOutcome) {
      broadcastPlayersUpdate(room);
    }

    if (result.newAward && !result.finalOutcome) {
      // Same gating as above -- the Final's own point value is revealed
      // exclusively via score:finalResults at SHOW RESULTS time (see
      // handleRevealResults), never as an immediate toast.
      broadcastToRoom(room, { type: 'score:event', ...result.newAward });
    }
    if (result.streakChanged) {
      broadcastToRoom(room, { type: 'score:streak', activeStreak: room.scoring.activeStreak });
    }
    if (
      verdict === 'correct' &&
      SCORABLE_COLUMNS.includes(target) &&
      room.chat.solvedTargets[target]?.messageId === messageId
    ) {
      scheduleSolvedColumnReveal(room, messageId, target);
    }
    if (result.finalOutcome) {
      broadcastToRoom(room, { type: 'score:finalReveal', ...result.finalOutcome });
    }
    if (result.scoreWarning) {
      sendToWs(ws, { type: 'score:warning', message: result.scoreWarning });
    }

    sendToWs(ws, { type: 'gm:judge:ack', messageId, verdict, target });
  } else {
    sendToWs(ws, { type: 'error', message: result.error });
  }
}

// DENY ALL: every unjudged player attempt on the live board goes WRONG in one
// server operation, through the same applyVerdict() the red X uses. Only what
// the X itself could judge is touched (the `adjudicable` rule in the chat
// broadcast: live BATTLE board, a player's own text line -- any `source`
// such as polls, media, commands, emotes or Broker lines is excluded).
// Already CORRECT/WRONG messages are left exactly as they are.
function handleDenyAll(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can judge guesses' });
    return;
  }
  if (room.roomMode !== ROOM_MODES.BATTLE || room.sessionState.matchResult) {
    sendToWs(ws, { type: 'error', message: 'DENY ALL is only available during a live battle' });
    return;
  }
  const pending = room.chat.messages.filter(m =>
    !m.source && m.boardId === room.boardId && m.deleted !== true
    && (m.verdict === null || m.verdict === undefined));
  let denied = 0;
  for (const m of pending) {
    if (applyVerdict(room, m.id, 'wrong').success) denied++;
  }
  if (denied) {
    persistActiveRooms();
    broadcastChatUpdate(room);
  }
  sendToWs(ws, { type: 'gm:denyAll:ack', denied });
}

function handleSwitchGame(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can switch games' });
    return;
  }

  const { gameId } = message;
  if (!gameId) {
    sendToWs(ws, { type: 'error', message: 'Missing gameId' });
    return;
  }

  const game = loadGameData(gameId);
  if (!game) {
    sendToWs(ws, { type: 'error', message: `Game not found: ${gameId}` });
    return;
  }

  room.gameId = game.id;
  room.gameData = game;
  room.revision = (room.revision || 0) + 1;
  room.sessionState = { cells: {}, finalSolution: false, finalOutcome: null, gameWon: false, matchResult: null, cellOutcomes: {}, clueOrder: { A: [], B: [], C: [], D: [] } };
  room.currentBackground = game.background || gameStore.DEFAULT_BACKGROUND;
  if (!room.chat) room.chat = { messages: [], solvedTargets: {} };
  room.chat.solvedTargets = {};
  // NEXT GAME starts a new board within the SAME session: current-session
  // scores (room.scoring.players) and the persisted all-time profiles are
  // untouched. Only per-board state resets, exactly like ending a streak
  // when the board changes.
  room.boardId = generateBoardId();
  room.pendingReveals = {};
  // Per-board, exactly as RESET BOARD clears them: without this a hint used
  // on the previous board blocked that row on the new one, and a running
  // solution countdown lingered on the new board forever.
  room.solutionCountdowns = {};
  room.hintClaims = {};
  startMatchLedger(room); // new board id => new match ledger
  room.scoring.activeStreak = null;
  room.scoring.boardFinalized = false;
  room.scoring.pendingResults = null;
  room.scoring.finalizedParticipants = null;
  // WOMF charge is global ASOC state, not per-board -- do NOT reset it here.
  // Only the per-board "already declared failed this board" guard resets.
  if (!room.womf) room.womf = { charge: 0, failedColumns: {} };
  room.womf.failedColumns = {};
  // A wheel opened for the previous game no longer makes sense -- close it.
  resetWheel(room);
  // NEXT GAME is a new board -- same treatment as resetBoard: a fresh,
  // un-started Timer at the new game's difficulty default.
  resetTimer(room);
  room.roomMode = ROOM_MODES.BATTLE_ARMED;
  room.armed = true;
  startRitual(room);

  // NEXT GAME becomes authoritative on disk before connected clients switch.
  persistActiveRooms();
  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });
  broadcastChatUpdate(room);
  broadcastPlayersUpdate(room);
  broadcastRitualState(room);
  sendToWs(ws, { type: 'game:loaded', game });
  sendToWs(ws, { type: 'gm:switchGame:ack', gameId: game.id });

  console.log(`[ROOM ${room.code}] Game switched: ${game.title} (${game.id})`);
}

// FINAL RED -- the host's manual GAME LOST. It shares declareGameLost() with
// Borrowed Time expiry (the only automatic loss); nothing else infers a loss.
function handleFailFinal(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can declare the Final failed' });
    return;
  }

  if (!isBattleSurface(room)) {
    sendToWs(ws, { type: 'error', message: 'GAME LOST is only available on the Battle surface' });
    return;
  }

  if (room.sessionState.matchResult || room.sessionState.gameWon === true) {
    sendToWs(ws, { type: 'error', message: 'This match has already been resolved' });
    return;
  }

  // Only a Final the players actually SOLVED blocks GAME LOST. A Final the
  // GM merely revealed (REVEAL ALL / REVEAL FINAL mid-battle) leaves the
  // loss available -- revealing the answer is not the same as earning it.
  if (room.chat.solvedTargets?.FINAL || room.scoring.boardFinalized) {
    sendToWs(ws, { type: 'error', message: 'The Final has already been resolved for this board' });
    return;
  }

  // FINAL RED is now the canonical manual GAME LOST action. Reuse the same
  // authoritative terminal-state path as timer expiry so scoring, WOMF +3,
  // persistence, match archival and every client-side GAME LOST sequence
  // remain one coherent transaction.
  if (!declareGameLost(room, 'gm-final')) {
    sendToWs(ws, { type: 'error', message: 'GAME LOST could not be declared from the current state' });
  }
}

// Explicit GM action, one guarded, host-only control per column. The GM
// client resolves RED through applyCommand('resolveColumn'); this message is
// the equivalent direct protocol entry point. A failed column is never
// inferred from guess judging (a GM revealing a column for pacing is not the
// same thing as a failure). Declaring a column failed charges WOMF +1 and force-reveals that
// column's solution slot (A5/B5/C5/D5) tagged with a 'failed' outcome, so
// it renders red instead of the normal reveal color -- mirroring exactly
// how a failed Final already gets its own outcome/color. It does NOT
// touch scoring or any other column/board mechanic (the clue cells
// A1-A4 are left untouched).
function handleFailColumn(ws, message) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can declare a column failed' });
    return;
  }

  const { column } = message;
  if (!['A', 'B', 'C', 'D'].includes(column)) {
    sendToWs(ws, { type: 'error', message: 'Invalid column' });
    return;
  }

  if (!isBattleSurface(room)) {
    sendToWs(ws, { type: 'error', message: 'Columns can only be failed on the Battle surface' });
    return;
  }

  // Same lock as resolveColumn in applyCommand: a WON/LOST match is final and
  // must not collect further WOMF charge or column outcomes.
  if (room.sessionState.matchResult) {
    sendToWs(ws, { type: 'error', message: `GAME ${room.sessionState.matchResult.outcome} // gameplay controls locked` });
    return;
  }

  if (!room.womf) room.womf = { charge: 0, failedColumns: {} };

  if (isColumnSolvedGreen(room, column)) {
    sendToWs(ws, { type: 'error', message: `Column ${column} has already been solved` });
    return;
  }

  // FAIL [X] is re-appliable: a GM manually hiding/re-revealing this
  // column's solution slot afterward (e.g. to double-check something)
  // clears its 'failed' tag (see the revealCell/hideColumn cases above),
  // but the WOMF charge already earned for this board should NOT be
  // grantable twice just by clicking FAIL [X] again -- so only the FIRST
  // declaration for a given board charges WOMF; every declaration always
  // re-applies the red tag + force-reveal, so the GM can always re-assert
  // it regardless of what happened to the cell in between.
  const alreadyFailedThisBoard = !!room.womf.failedColumns[column];
  if (!alreadyFailedThisBoard) {
    room.womf.failedColumns[column] = true;
    addWomfCharge(room, 1);
  }
  // MATCH LEDGER: a declared failure resolves the field (idempotent on
  // re-declaration), which may complete the match.
  matchLedger.markFailed(ensureMatchLedger(room), column, Date.now());
  refreshGameComplete(room);

  const solutionKey = `${column}5`;
  room.sessionState.cells[solutionKey] = true;
  if (!room.sessionState.cellOutcomes) room.sessionState.cellOutcomes = {};
  room.sessionState.cellOutcomes[solutionKey] = 'failed';

  room.revision++;

  persistActiveRooms();
  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });

  console.log(`[ROOM ${room.code}] GM ${alreadyFailedThisBoard ? 're-declared' : 'declared'} column ${column} FAILED (WOMF charge: ${room.womf.charge}/10)`);
}

// Manual GM correction tools -- e.g. undoing an accidental FAIL click, or
// clearing the meter for a fresh session. These only ever touch the
// numeric charge; they never touch a column/Final's reveal state or its
// 'failed' outcome tag (see handleFailColumn/handleFailFinal for those).
function handleWomfSubtract(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can adjust WOMF' });
    return;
  }

  if (!room.womf) room.womf = { charge: 0, failedColumns: {} };
  room.womf.charge = Math.max(0, room.womf.charge - 1);
  room.revision++;

  persistActiveRooms();
  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });
  console.log(`[ROOM ${room.code}] GM subtracted a WOMF charge (now ${room.womf.charge}/10)`);
}

function handleWomfReset(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can adjust WOMF' });
    return;
  }

  if (!room.womf) room.womf = { charge: 0, failedColumns: {} };
  room.womf.charge = 0;
  room.revision++;

  persistActiveRooms();
  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });
  console.log(`[ROOM ${room.code}] GM reset WOMF charge to 0/10`);
}

// GM has finished showing the story/reveal sequence and is ready to reveal
// the point/penalty consequences to the whole room at once.
//
// LOCKED PACING RULE: the Final's score/penalty was already committed to
// room.scoring.players AND players.json the instant the Final was resolved
// (see awardFinalSolve/finalizeBoard, called from applyVerdict/failFinal
// above) -- COMMIT SCORE NOW. What was deliberately withheld until this
// exact moment is the *visible* leaderboard movement -- DISPLAY SCORE
// LATER. This is the single place that broadcasts players:update for a
// Final outcome; reading room.scoring.players here (rather than caching
// anything earlier) also means if the GM corrected the verdict at any
// point before clicking SHOW RESULTS, this broadcast reflects whatever the
// current authoritative state actually is, not a stale snapshot.
function handleRevealResults(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return;
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can reveal results' });
    return;
  }
  const results = releasePendingResults(room); // nothing pending -- ignored silently, not an error
  if (results) {
    persistActiveRooms();
    broadcastToRoom(room, { type: 'score:finalResults', ...results });
    broadcastPlayersUpdate(room);
    // finalResultsPending just flipped; the timer may be stopped, so do not
    // wait for a tick to retire the GM's END GAME control.
    broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  }
}

// The withheld Final points/penalty, released by EITHER the story banner's
// SHOW RESULTS or the RECOUNT's SHOW RESULTS, whichever the host presses first.
// Pure mutation: returns the pending payload (or null); the CALLER persists
// first and then broadcasts, so released results can never be rolled back by
// a crash that happened after clients already saw them.
function releasePendingResults(room) {
  if (!room.scoring.pendingResults) return null;
  const results = room.scoring.pendingResults;
  room.scoring.pendingResults = null;
  return results;
}

// RECOUNT -- the post-game results screen. It is NEVER shown automatically:
// the match completes (all five fields opened, or a timer loss), the recount is
// computed and archived at that moment, and it stays hidden until the host
// presses SHOW RESULTS. This handler then stores the SAME payload with the
// match (so reconnects/late joins receive it, never a regenerated one),
function handleGmFinishGame(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can finish the game' });
    return;
  }
  if (!isBattleSurface(room)) {
    sendToWs(ws, { type: 'error', message: 'FINISH GAME is only available on the Battle surface' });
    return;
  }
  if (!room.match?.completedAt) {
    sendToWs(ws, { type: 'error', message: 'The match is not finished yet' });
    return;
  }
  if (room.match.resultsShownAt) {
    sendToWs(ws, { type: 'error', message: 'RECOUNT already started' });
    return;
  }
  if (room.match.aftermathStartedAt) return;

  room.match.aftermathStartedAt = Date.now();
  const aftermathResult = publicMatchResult(room) || {
    outcome: 'COMPLETE',
    occurredAt: room.match.completedAt,
    message: 'Match complete. Narrative sequence authorized.',
    story: room.gameData?.story || '',
    finalSolution: room.gameData?.finalSolution || '',
    columnSolutions: {
      A: room.gameData?.columns?.A?.solution || '',
      B: room.gameData?.columns?.B?.solution || '',
      C: room.gameData?.columns?.C?.solution || '',
      D: room.gameData?.columns?.D?.solution || ''
    },
    columnResults: {
      A: isColumnSolvedGreen(room, 'A'),
      B: isColumnSolvedGreen(room, 'B'),
      C: isColumnSolvedGreen(room, 'C'),
      D: isColumnSolvedGreen(room, 'D')
    }
  };
  // Persist the narrative on the ledger so a reconnect/refresh/restart while
  // in the AFTERMATH phase can re-render it already-complete (never re-type).
  room.match.aftermathResult = aftermathResult;
  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastToRoom(room, { type: 'match:aftermath', result: aftermathResult, live: true });
}

// releases any withheld Final points, and broadcasts it live exactly once.
function handleGmShowRecount(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can show the RECOUNT' });
    return;
  }
  const ledger = room.match;
  if (!ledger || !ledger.completedAt) {
    sendToWs(ws, { type: 'error', message: 'The game is not over yet -- the whole field must be opened first' });
    return;
  }
  if (!ledger.aftermathStartedAt) {
    sendToWs(ws, { type: 'error', message: 'FINISH GAME first // AFTERMATH must run before RECOUNT' });
    return;
  }
  if (ledger.resultsShownAt) {
    // AFTERMATH can legitimately finish after RECOUNT was already opened by
    // another host control. Re-broadcast the persisted result without replay
    // animation so every client receives the same authoritative "advance"
    // signal and can dismiss its epilogue overlay.
    if (ledger.recount) broadcastRecount(room, ledger.recount, false);
    return;
  }

  // Build the RECOUNT NOW, from the live ledger -- not from the snapshot taken
  // when the match completed. The host decides when results are shown, and
  // anything judged between completion and this button (the last guesses after
  // the final field opened) belongs in the recount. archiveCompletedMatch is an
  // idempotent upsert, so this simply refreshes the stored record.
  let record = null;
  try { record = archiveCompletedMatch(room, currentMatchFields(room)); } catch (error) {
    console.error('[match] RECOUNT build failed:', error.message);
  }
  if (!record || !record.recount) {
    sendToWs(ws, { type: 'error', message: 'RECOUNT unavailable: the match archive could not be written' });
    return;
  }

  ledger.recount = record.recount;
  ledger.resultsShownAt = Date.now();
  record.resultsShownAt = ledger.resultsShownAt;
  try { matchStore.upsertMatch(record); } catch (error) { console.error('[match] Archive update failed:', error.message); }

  room.roomMode = ROOM_MODES.RECOUNT;
  room.armed = true;
  room.revision++;

  // Mutate -> persist -> broadcast: shown results and any released Final
  // points must be durable before clients see them.
  const results = releasePendingResults(room);
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  if (results) {
    broadcastToRoom(room, { type: 'score:finalResults', ...results });
    broadcastPlayersUpdate(room);
  }
  broadcastRecount(room, ledger.recount, true);
  console.log(`[ROOM ${room.code}] RECOUNT shown`);
}

function handleSetRoomMode(ws, message) {
  const room = rooms.get(MASTER_ROOM_CODE);
  if (!room) return;

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only Shadow Broker can switch room mode' });
    return;
  }

  const requested = String(message.mode || '').toUpperCase();
  if (requested !== 'CASUAL' && requested !== 'BATTLE') {
    sendToWs(ws, { type: 'error', message: 'Invalid room mode' });
    return;
  }

  // Presentation-only switch. CASUAL does NOT reset the battle: timer, board,
  // WOMF, scoring, clue state and chat all remain exactly where they are.
  // BATTLE restores the surface where it left off: READY means pre-start;
  // running/borrowed/finished means an already-started battle.
  let next = ROOM_MODES.CASUAL;
  if (requested === 'BATTLE') {
    if (room.match?.resultsShownAt) next = ROOM_MODES.RECOUNT;
    else next = room.timer?.phase === 'ready' ? ROOM_MODES.BATTLE_ARMED : ROOM_MODES.BATTLE;
  }
  if (next === room.roomMode) {
    // Repeated/stale toggle: nothing changes. Resync only the requester so a
    // client that guessed wrong about the mode converges without a broadcast.
    sendToWs(ws, { type: 'state:public', ...getPublicState(room) });
    return;
  }
  room.roomMode = next;
  if (next !== ROOM_MODES.CASUAL) room.armed = true;
  // This toggle is presentation-only and must never reset an in-progress
  // battle -- but it can ALSO be the very first CASUAL->BATTLE_ARMED arm in
  // normal day-to-day use (not just hostRoom()'s legacy path), so a ritual
  // that isn't already active still needs to start here. A toggle away and
  // back (still BATTLE_ARMED, ritual already active) is left untouched.
  const ritualJustStarted = next === ROOM_MODES.BATTLE_ARMED && !room.ritual?.active;
  if (ritualJustStarted) startRitual(room);

  room.revision++;
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  // Every client drops its RECOUNT on entering CASUAL; returning to a shown
  // RECOUNT must hand it back (non-live, never a replay).
  if (next === ROOM_MODES.RECOUNT && room.match?.recount) broadcastRecount(room, room.match.recount, false);
  broadcastChatUpdate(room);
  broadcastPlayersUpdate(room);
  if (ritualJustStarted) broadcastRitualState(room);
  console.log(`[MASTER ROOM] Display mode -> ${next}`);
}

function handleCloseRoom(ws) {
  const room = rooms.get(MASTER_ROOM_CODE);
  if (!room) return;

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can disarm the active game session' });
    return;
  }

  if (room.hostReconnectTimer) {
    clearTimeout(room.hostReconnectTimer);
    room.hostReconnectTimer = null;
  }

  resetMasterGameSession(room, room.gameData);
  room.roomMode = ROOM_MODES.CASUAL;
  room.armed = false;
  endRitual(room);

  // CASUAL is still the same hosted Master Room. Keep the Shadow Broker
  // attached so chat and moderation continue without a reconnect.
  persistActiveRooms();
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  broadcastRecount(room, null, false);
  broadcastChatUpdate(room);
  broadcastPlayersUpdate(room);
  broadcastRitualState(room);
  sendToWs(ws, { type: 'room:casual', roomCode: MASTER_ROOM_CODE, message: 'CASUAL MODE // Master Room remains online.' });
  console.log('[MASTER ROOM] Returned to CASUAL; identities and chat remain online');
}

function handleClose(ws) {
  if (ws.isHost) {
    const room = rooms.get(MASTER_ROOM_CODE);
    if (room && room.hostConnection === ws) {
      room.hostConnection = null;
      if (room.hostReconnectTimer) clearTimeout(room.hostReconnectTimer);
      room.hostReconnectTimer = null;
      console.log(`[MASTER ROOM] Shadow Broker disconnected; room remains ${room.armed ? 'armed' : 'unarmed'} for reconnect`);
    }
  } else {
    const room = rooms.get(ws.roomCode);
    if (room) {
      // Keep the disconnected player's identity record in the room so a
      // reconnecting client can reclaim its previous playerId and therefore
      // its existing session score. handlePlayerJoin() already scans these
      // records by requested playerId, removes the stale socket entry, and
      // reattaches the identity to the new WebSocket.
      const player = room.players.get(ws);
      if (player) {
        player.connected = false;
        matchLedger.presenceClose(ensureMatchLedger(room), player.id, Date.now());
        // A disconnect before Battle starts always removes that player's
        // vote from the factual count (even mid Blood-Tribute-fulfillment --
        // per spec §11's own example, 2/5 + accepted tribute + one
        // disconnect reads as 1/5, not frozen at 2/5). recomputeRitualFulfillment()
        // is what actually preserves fulfilled=true/fulfilledBy=BLOOD_TRIBUTE
        // regardless of vote count once a tribute is accepted -- the count
        // and the fulfillment flag are independent here.
        if (room.ritual?.active) {
          const id = String(player.id);
          const index = room.ritual.joinedPlayerIds.indexOf(id);
          if (index !== -1) {
            room.ritual.joinedPlayerIds.splice(index, 1);
            recomputeRitualFulfillment(room);
            broadcastRitualState(room);
          }
        }
      }
      persistActiveRooms();
      broadcastPlayersUpdate(room);
      console.log(`[ROOM ${ws.roomCode}] Player left: ${ws.playerName}`);
    }
  }
}

function publicBaseUrl(req) {
  const configured = String(process.env.ASOC_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT)).split(',')[0].trim();
  return proto + '://' + host;
}

function issuePlayerAuthToken(player) {
  const token = 'player-' + crypto.randomBytes(24).toString('base64url');
  playerAuthTokens.set(playerTokenKey(token), { playerId: player.id, email: player.email, createdAt: Date.now() });
  savePlayerAuthSessions();
  return token;
}

function redirectPlayerVerification(res, state) {
  res.writeHead(302, {
    Location: '/join.html?' + state,
    'Cache-Control': 'no-store',
    Pragma: 'no-cache'
  });
  res.end();
}

function handleApiRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;

  if (method === 'GET' && (url.pathname === '/api/gif/search' || url.pathname === '/api/gif/trending')) {
    handleGifApiRequest(req, res, url).catch(error => {
      console.error('[gif-api] Unhandled GIF route error:', error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'GIF_INTERNAL_ERROR', message: 'GIF NETWORK // INTERNAL ERROR' });
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/chat/image-url') {
    const room = rooms.get(MASTER_ROOM_CODE);
    if (!room) return sendJson(res, 409, { error: 'Master Room is unavailable' });
    const actor = getChatImageActor(req, room);
    if (!actor) return sendJson(res, 401, { error: 'Chat upload authentication required' });

    return readJsonBody(req, async (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid image address request' });
      const captionLimit = actor.role === 'gm' ? 500 : MAX_CHAT_LENGTH;
      const caption = sanitizeText(body?.caption || '').slice(0, captionLimit);
      try {
        const remote = await fetchRemoteChatImage(body?.url || '');
        const stored = persistChatImage(room, actor, remote.buffer, remote.contentType, caption);
        return sendJson(res, 201, { ok: true, ...stored });
      } catch (error) {
        console.error('[chat-image-url] import failed:', error.message);
        const status = /5 MB/.test(error.message) ? 413 : /not a supported image|signature/.test(error.message) ? 415 : 400;
        return sendJson(res, status, { error: error.message || 'Image address import failed' });
      }
    });
  }

  if (method === 'POST' && url.pathname === '/api/chat/image') {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extByType = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    const ext = extByType[contentType];
    if (!ext) return sendJson(res, 415, { error: 'Only PNG, JPEG, WEBP and GIF images are allowed' });

    const room = rooms.get(MASTER_ROOM_CODE);
    if (!room) return sendJson(res, 409, { error: 'Master Room is unavailable' });

    const actor = getChatImageActor(req, room);
    if (!actor) return sendJson(res, 401, { error: 'Chat upload authentication required' });

    const captionLimit = actor.role === 'gm' ? 500 : MAX_CHAT_LENGTH;
    const caption = sanitizeText(url.searchParams.get('caption') || '').slice(0, captionLimit);

    return readChatImageBody(req, (err, body) => {
      if (err) return sendJson(res, err.code === 'TOO_LARGE' ? 413 : 400, { error: err.code === 'TOO_LARGE' ? 'Image exceeds 5 MB limit' : 'Image upload failed' });
      if (!body || body.length === 0) return sendJson(res, 400, { error: 'Empty image upload' });
      if (!validChatImageBytes(body, contentType)) return sendJson(res, 415, { error: 'Image file signature does not match its declared type' });

      try {
        const stored = persistChatImage(room, actor, body, contentType, caption);
        return sendJson(res, 201, { ok: true, ...stored });
      } catch (writeError) {
        console.error('[chat-image] upload failed', writeError);
        return sendJson(res, 500, { error: 'Image could not be stored' });
      }
    });
  }


  // TWEAKS // player-facing field reports. Kept on HTTP instead of the live
  // battle socket so feedback failures can never interfere with gameplay.
  if (method === 'POST' && url.pathname === '/api/tweaks/evidence') {
    const playerToken = String(req.headers['x-player-token'] || '');
    const auth = getPlayerAuth(playerToken);
    if (!auth?.playerId) return sendJson(res, 401, { error: 'Little Hero authentication required' });
    const account = playerAccountForAuth(auth);
    if (!account) return sendJson(res, 401, { error: 'Player account not found' });

    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extByType = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    const ext = extByType[contentType];
    if (!ext) return sendJson(res, 415, { error: 'Evidence must be PNG, JPEG, WEBP or GIF' });

    return readChatImageBody(req, (err, body) => {
      if (err) return sendJson(res, err.code === 'TOO_LARGE' ? 413 : 400, { error: err.code === 'TOO_LARGE' ? 'Evidence exceeds 5 MB limit' : 'Evidence upload failed' });
      if (!body || body.length === 0) return sendJson(res, 400, { error: 'Empty evidence upload' });
      if (!validChatImageBytes(body, contentType)) return sendJson(res, 415, { error: 'Evidence signature does not match its declared type' });
      const filename = 'tweak-' + crypto.randomBytes(16).toString('hex') + '.' + ext;
      try {
        fs.writeFileSync(path.join(CHAT_UPLOAD_DIR, filename), body, { flag: 'wx', mode: 0o600 });
        return sendJson(res, 201, { ok: true, evidenceUrl: '/uploads/chat/' + filename });
      } catch (error) {
        console.error('[tweaks] Evidence upload failed:', error.message);
        return sendJson(res, 500, { error: 'Evidence could not be stored' });
      }
    });
  }

  if (url.pathname === '/api/tweaks/player' && method === 'GET') {
    const playerToken = String(req.headers['x-player-token'] || '');
    const auth = getPlayerAuth(playerToken);
    if (!auth?.playerId) return sendJson(res, 401, { error: 'Little Hero authentication required' });
    const account = playerAccountForAuth(auth);
    if (!account) return sendJson(res, 401, { error: 'Player account not found' });
    if (!tweakStore.storageHealthy()) return sendJson(res, 503, { error: 'TWEAKS storage unavailable' });
    return sendJson(res, 200, {
      tweaks: tweakStore.listForPlayer(auth.playerId),
      maxOpen: tweakStore.MAX_OPEN_PER_PLAYER
    });
  }

  if (url.pathname === '/api/tweaks/player' && method === 'POST') {
    const playerToken = String(req.headers['x-player-token'] || '');
    const auth = getPlayerAuth(playerToken);
    if (!auth?.playerId) return sendJson(res, 401, { error: 'Little Hero authentication required' });
    const account = playerAccountForAuth(auth);
    if (!account) return sendJson(res, 401, { error: 'Player account not found' });
    if (!tweakStore.storageHealthy()) return sendJson(res, 503, { error: 'TWEAKS storage unavailable' });

    return readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid TWEAK payload' });
      try {
        const tweak = tweakStore.submit({ id: account.id, name: account.name }, body);
        console.log('[tweaks] ' + tweak.id + ' submitted by ' + tweak.playerName + ' // ' + tweak.type);
        return sendJson(res, 201, { ok: true, tweak });
      } catch (error) {
        const status = /Maximum 5 open/i.test(error.message) ? 429 : /storage unavailable/i.test(error.message) ? 503 : 400;
        return sendJson(res, status, { error: error.message || 'TWEAK could not be submitted' });
      }
    });
  }

  if (method === 'POST' && url.pathname === '/api/auth/gm/mirror-player') {
    const gmToken = String(req.headers['x-gm-token'] || '');
    if (!isValidGmToken(gmToken)) {
      return sendJson(res, 401, { error: 'Master authentication required' });
    }
    const mirror = issueMasterMirrorToken();
    return sendJson(res, 200, { ok: true, token: mirror.token, player: mirror.player, isMasterTest: true });
  }

  if (method === 'POST' && url.pathname === '/api/auth/player/register') {
    return readJsonBody(req, async (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON body' });
      if (EMAIL_VERIFICATION_REQUIRED && !emailService.isConfigured()) {
        return sendJson(res, 503, { error: 'Email verification service is not configured', code: 'EMAIL_SERVICE_UNAVAILABLE' });
      }
      try {
        const created = authStore.register(body.email, body.password, body.name, { requireVerification: EMAIL_VERIFICATION_REQUIRED });
        if (!EMAIL_VERIFICATION_REQUIRED) {
          const token = issuePlayerAuthToken(created.player);
          return sendJson(res, 201, { token, player: created.player });
        }
        const verifyUrl = publicBaseUrl(req) + '/api/auth/player/verify?token=' + encodeURIComponent(created.verificationToken);
        try {
          await emailService.sendVerificationEmail({
            to: created.player.email,
            name: created.player.name,
            verifyUrl,
            idempotencyKey: 'verify-' + created.player.id + '-' + Date.now()
          });
        } catch (mailError) {
          console.error('[auth] Verification email delivery failed:', mailError.message);
          return sendJson(res, 502, {
            error: 'Account created, but the verification email could not be sent. Use RESEND VERIFICATION shortly.',
            code: 'EMAIL_DELIVERY_FAILED',
            verificationRequired: true,
            player: created.player
          });
        }
        return sendJson(res, 201, {
          verificationRequired: true,
          player: created.player,
          message: 'Verification email sent. Confirm the address before signing in.'
        });
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    });
  }

  if (method === 'GET' && url.pathname === '/api/auth/player/verify') {
    const token = String(url.searchParams.get('token') || '');
    if (!token) return redirectPlayerVerification(res, 'verify=invalid');
    const result = authStore.verifyEmail(token);
    if (result.ok) return redirectPlayerVerification(res, 'verified=1');
    return redirectPlayerVerification(res, result.reason === 'expired' ? 'verify=expired' : 'verify=invalid');
  }

  if (method === 'POST' && url.pathname === '/api/auth/player/resend-verification') {
    return readJsonBody(req, async (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON body' });
      if (!emailService.isConfigured()) {
        return sendJson(res, 503, { error: 'Email verification service is not configured', code: 'EMAIL_SERVICE_UNAVAILABLE' });
      }
      const issued = authStore.issueVerificationToken(body.email);
      const generic = { ok: true, message: 'If this identity is awaiting verification, a new verification email has been sent.' };
      if (!issued.ok) return sendJson(res, 200, generic);
      try {
        const verifyUrl = publicBaseUrl(req) + '/api/auth/player/verify?token=' + encodeURIComponent(issued.verificationToken);
        await emailService.sendVerificationEmail({
          to: issued.player.email,
          name: issued.player.name,
          verifyUrl,
          idempotencyKey: 'verify-resend-' + issued.player.id + '-' + Date.now()
        });
      } catch (mailError) {
        console.error('[auth] Verification resend failed:', mailError.message);
        return sendJson(res, 502, { error: 'Verification email could not be sent. Try again shortly.', code: 'EMAIL_DELIVERY_FAILED' });
      }
      return sendJson(res, 200, generic);
    });
  }

  if (method === 'POST' && url.pathname === '/api/auth/player/login') {
    return readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON body' });
      const player = authStore.login(body.email, body.password);
      if (!player) return sendJson(res, 401, { error: 'Invalid identity ID or password' });
      if (EMAIL_VERIFICATION_REQUIRED && !player.emailVerified) {
        return sendJson(res, 403, {
          error: 'Email verification required before entering MASTER.',
          code: 'EMAIL_NOT_VERIFIED',
          verificationRequired: true
        });
      }
      const token = issuePlayerAuthToken(player);
      return sendJson(res, 200, { token, player });
    });
  }

  if (method === 'GET' && url.pathname === '/api/auth/player/session') {
    const token = String(req.headers['x-player-token'] || '');
    const auth = getPlayerAuth(token);
    if (!auth) return sendJson(res, 401, { error: 'Player session invalid' });
    const player = playerAccountForAuth(auth);
    if (!player) {
      playerAuthTokens.delete(playerTokenKey(token));
      savePlayerAuthSessions();
      return sendJson(res, 401, { error: 'Player account not found' });
    }
    if (EMAIL_VERIFICATION_REQUIRED && !player.emailVerified) {
      playerAuthTokens.delete(playerTokenKey(token));
      savePlayerAuthSessions();
      return sendJson(res, 403, { error: 'Email verification required', code: 'EMAIL_NOT_VERIFIED' });
    }
    return sendJson(res, 200, { ok: true, player });
  }

  if (method === 'PATCH' && url.pathname === '/api/auth/player/profile') {
    return readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON body' });
      const token = String(req.headers['x-player-token'] || '');
      const auth = getPlayerAuth(token);
      if (!auth) return sendJson(res, 401, { error: 'Player session invalid' });

      let account;
      try {
        account = playerAccountForAuth(auth);
      } catch {
        return sendJson(res, 503, { error: 'Authentication temporarily unavailable' });
      }
      if (!account) return sendJson(res, 401, { error: 'Player account not found' });
      if (EMAIL_VERIFICATION_REQUIRED && !account.emailVerified) {
        return sendJson(res, 403, { error: 'Email verification required', code: 'EMAIL_NOT_VERIFIED' });
      }

      const cleanName = sanitizeText(body.name).slice(0, 20);
      if (!cleanName) return sendJson(res, 400, { error: 'Name cannot be empty' });
      if (auth.isMasterTest) {
        return sendJson(res, 200, { ok: true, player: masterTestAccount(auth) });
      }

      try {
        const player = authStore.updateName(auth.playerId, cleanName);
        playerStore.updateProfileAppearance({ id: auth.playerId, name: player.name });

        let liveIdentityChanged = false;
        for (const room of rooms.values()) {
          let roomChanged = false;
          room.players.forEach((info, socket) => {
            if (info.id !== auth.playerId) return;
            info.name = player.name;
            socket.playerName = player.name;
            roomChanged = true;
            liveIdentityChanged = true;
          });
          if (roomChanged) broadcastPlayersUpdate(room);
        }
        if (liveIdentityChanged) persistActiveRooms();

        return sendJson(res, 200, { ok: true, player });
      } catch (e) {
        return sendJson(res, /not found/i.test(e.message || '') ? 404 : 400, { error: e.message || 'Could not update player profile' });
      }
    });
  }

  if (method === 'POST' && url.pathname === '/api/auth/player/logout') {
    const token = String(req.headers['x-player-token'] || '');
    const key = playerTokenKey(token);
    const removedMirror = token ? masterMirrorTokens.delete(key) : false;
    const removedPlayer = token ? playerAuthTokens.delete(key) : false;
    if (removedPlayer) savePlayerAuthSessions();
    return sendJson(res, 200, { ok: true, mirror: removedMirror });
  }

  if (method === 'POST' && url.pathname === '/api/auth/gm/logout') {
    // SIGN OUT MASTER ACCOUNT signs the Shadow Broker out everywhere,
    // including the saved sessions on disk. Only the Shadow Broker may do
    // that: without this check any visitor could sign the GM out, and with
    // persisted sessions the sign-out would outlive restarts.
    if (!isGmAuthorized(req)) return sendJson(res, 401, { error: 'Gamemaster authorization required' });
    gmTokens.clear();
    saveGmSessions();
    masterMirrorTokens.clear();
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && url.pathname === '/api/auth/gm/login') {
    return readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON body' });
      const clientKey = gmClientKey(req);
      const record = gmLockouts[clientKey] || { attempts: 0, locked: false };
      if (record.locked) return sendJson(res, 423, { error: 'GM access permanently locked', locked: true });
      const supplied = Buffer.from(String(body.password || ''));
      const expected = Buffer.from(GM_PASSWORD);
      const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
      if (!valid) {
        record.attempts = Number(record.attempts || 0) + 1;
        if (record.attempts >= 3) {
          record.locked = true;
          record.lockedAt = new Date().toISOString();
        }
        gmLockouts[clientKey] = record;
        saveGmLockouts();
        return sendJson(res, record.locked ? 423 : 401, { error: 'Access denied', locked: record.locked, attempts: record.attempts });
      }
      if (gmLockouts[clientKey]) { delete gmLockouts[clientKey]; saveGmLockouts(); }
      return sendJson(res, 200, { token: refreshGMToken() });
    });
  }

  if (method === 'GET' && parts[0] === 'api' && parts[1] === 'gm' && parts[2] === 'token') {
    return sendJson(res, 403, { error: 'GM password authentication required' });
  }

  if (!isGmAuthorized(req)) {
    return sendJson(res, 401, { error: 'Gamemaster authorization required' });
  }


  if (url.pathname === '/api/tweaks' && method === 'GET') {
    if (!tweakStore.storageHealthy()) return sendJson(res, 503, { error: 'TWEAKS storage unavailable' });
    return sendJson(res, 200, { tweaks: tweakStore.listAll() });
  }

  if (parts[0] === 'api' && parts[1] === 'tweaks' && parts[2] && method === 'PATCH') {
    if (!tweakStore.storageHealthy()) return sendJson(res, 503, { error: 'TWEAKS storage unavailable' });
    const id = decodeURIComponent(parts[2]);
    if (!/^TWK-\d{4,}$/.test(id)) return sendJson(res, 404, { error: 'TWEAK not found' });
    return readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid TWEAK update' });
      try {
        const tweak = tweakStore.update(id, body);
        if (!tweak) return sendJson(res, 404, { error: 'TWEAK not found' });
        return sendJson(res, 200, { ok: true, tweak });
      } catch (error) {
        return sendJson(res, 400, { error: error.message || 'TWEAK could not be updated' });
      }
    });
  }

  if (url.pathname === '/api/games' && method === 'GET') {
    return sendJson(res, 200, { games: gameStore.listGameFiles() });
  }

  if (url.pathname === '/api/games' && method === 'POST') {
    readJsonBody(req, (err, body) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON body' });
      const result = gameStore.saveGame(body);
      if (result.errors && result.errors.length) {
        return sendJson(res, 422, { errors: result.errors });
      }
      return sendJson(res, 200, { success: true, game: result.game, filename: result.filename });
    });
    return;
  }

  if (parts[0] === 'api' && parts[1] === 'games' && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (method === 'GET') {
      const game = gameStore.readGame(id);
      if (!game) return sendJson(res, 404, { error: 'Game not found' });
      return sendJson(res, 200, { game });
    }

    if (method === 'POST' && parts[3] === 'duplicate') {
      const result = gameStore.duplicateGame(id);
      if (result.error) return sendJson(res, 404, { error: result.error });
      return sendJson(res, 200, { success: true, game: result.game });
    }

    if (method === 'DELETE') {
      const result = gameStore.deleteGame(id);
      if (result.error) return sendJson(res, 400, { error: result.error });
      return sendJson(res, 200, { success: true });
    }
  }

  if (url.pathname === '/api/backgrounds' && method === 'GET') {
    return sendJson(res, 200, { backgrounds: gameStore.listBackgrounds() });
  }

  if (url.pathname === '/api/backgrounds/upload' && method === 'POST') {
    const filename = (url.searchParams.get('filename') || 'background.png').replace(/\\/g, '/').split('/').pop();
    readRawBody(req, (err, buffer) => {
      if (err) return sendJson(res, 400, { error: 'Upload failed' });
      const result = gameStore.saveBackgroundUpload(filename, buffer);
      if (result.error) return sendJson(res, 400, { error: result.error });
      return sendJson(res, 200, { success: true, ...result });
    });
    return;
  }

  if (url.pathname === '/api/games/import-xlsx' && method === 'POST') {
    const filename = (url.searchParams.get('filename') || 'game.xlsx').replace(/\\/g, '/').split('/').pop();
    readRawBody(req, (err, buffer) => {
      if (err) return sendJson(res, 400, { error: 'Upload failed' });
      if (!buffer || buffer.length === 0) return sendJson(res, 400, { error: 'Empty file received.' });
      gameStore.importXlsx(buffer, filename)
        .then(result => {
          if (result.errors && result.errors.length) {
            return sendJson(res, 422, { errors: result.errors });
          }
          return sendJson(res, 200, { success: true, game: result.game, warnings: result.warnings || [] });
        })
        .catch(e => {
          console.error('XLSX import error:', e);
          return sendJson(res, 400, { error: 'Could not read the uploaded file: ' + e.message });
        });
    });
    return;
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// PUBLIC STATIC FILE ALLOWLIST
// Only these are ever served off disk:
//   /            -> /index.html
//   /index.html, /join.html
//   any file beneath /css/, /js/, /assets/
// Everything else (HANDOFF.md, server.js, .git/*, games/, game-store.js,
// player-store.js, scoring-constants.js, node_modules/, visual-test.html,
// XLSX/PNG/TIF project files, etc.) is never served -- it 404s regardless
// of how the path is obfuscated.
//
// The old implementation trusted the __dirname prefix check AFTER
// path.join() had already normalized traversal (so `/../HANDOFF.md`,
// `/js/../../server.js`, `/.git/config`, `/..\..\...` all resolved to a
// path inside the project and were served). It is replaced by a strict
// allowlist that rejects every obfuscation vector up front.
function serveStaticFile(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const fullPath = resolveAllowedStaticPath(req.url);
  if (!fullPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      // DURABLE BACKGROUND OVERLAY: an uploaded background lives in
      // ASOC_DATA_DIR/assets/backgrounds (see game-store.js). Bundled assets
      // are served from __dirname first; only a missing bundled file falls
      // through to the durable copy, and only beneath the same allowlisted
      // assets/backgrounds root.
      if (err.code === 'ENOENT' && fullPath.startsWith(path.join(__dirname, 'assets', 'backgrounds')) && ASOC_DATA_DIR !== __dirname) {
        const overlayPath = path.resolve(ASOC_DATA_DIR, path.relative(__dirname, fullPath));
        if (overlayPath.startsWith(path.join(ASOC_DATA_DIR, 'assets', 'backgrounds'))) {
          fs.readFile(overlayPath, (overlayErr, overlayContent) => {
            if (overlayErr) return respondMissing();
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(overlayContent);
          });
          return;
        }
      }
      respondMissing();
      return;
    }
    const headers = { 'Content-Type': contentType };
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      headers['Cache-Control'] = 'no-store, max-age=0';
      headers.Pragma = 'no-cache';
      headers.Expires = '0';
    }
    res.writeHead(200, headers);
    res.end(content);

    function respondMissing() {
      if (err && err.code !== 'ENOENT' && err.code !== 'EISDIR') {
        res.writeHead(500);
        res.end('Server Error');
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    }
  });
}

// Returns an absolute allowed file path for a request URL, or null when the
// request must NOT be served. Handles querystrings, URL decoding, and every
// traversal form (dot-dot segments, encoded dot-dot, backslashes, null
// bytes). Because the decoded segments are validated against the explicit
// allowlist BEFORE any path is built, no normalization can smuggle a path
// out of the allowed roots.
function resolveAllowedStaticPath(requestUrl) {
  // Strip the querystring (and tolerate absolute-form URLs from proxies).
  let rawPath = requestUrl;
  const schemeEnd = rawPath.indexOf('://');
  if (schemeEnd !== -1) {
    try {
      rawPath = new URL(rawPath).pathname;
    } catch (e) {
      return null;
    }
  } else {
    rawPath = rawPath.split('?')[0];
  }

  // Decode ONCE. Anything still encoded after decode is a literal file name,
  // not a traversal vector, but a malformed encoding must not be served.
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch (e) {
    return null;
  }

  // Null bytes crash fs.readFile and encode no legitimate filename.
  if (pathname.indexOf('\0') !== -1) return null;
  // Backslashes are a Windows path separator only -- they are the one form
  // path.join() would treat as traversal here, so refuse them entirely.
  if (pathname.indexOf('\\') !== -1) return null;

  const segments = pathname.split('/').filter(seg => seg.length > 0);
  if (segments.length === 0) {
    // '/' serves the entry page, same as before.
    segments.push('index.html');
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return null;
  }

  const root = segments[0];
  let rootPrefix;
  if (root === 'index.html' || root === 'join.html') {
    if (segments.length !== 1) return null;
    rootPrefix = __dirname;
  } else if (root === 'css' || root === 'js' || root === 'assets') {
    rootPrefix = path.join(__dirname, root);
  } else {
    return null;
  }

  // Segments are pre-validated (no '.', '..', backslash, or empty parts),
  // so this path can only ever resolve beneath the allowed root. The
  // prefix re-check is a belt-and-suspenders guarantee.
  const absolutePath = path.resolve(__dirname, path.join(...segments));
  if (!absolutePath.startsWith(rootPrefix)) return null;

  return absolutePath;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if ((req.method === 'GET' || req.method === 'HEAD') && urlPath.startsWith('/uploads/chat/')) {
    if (serveChatUpload(req, res, urlPath)) return;
  }
  if (req.method === 'GET' && urlPath === '/health') {
    const ready = !shuttingDown && !persistenceFailed && !recoveryStoreLocked && durableIO.healthy() && authStore.isHealthy() && playerStore.isHealthy() && matchStore.isHealthy() && playerSessionStore.isHealthy();
    return sendJson(res, ready ? 200 : 503, {
      ok: ready,
      service: 'asoc-engine',
      status: shuttingDown ? 'shutting-down' : ready ? 'ready' : 'storage-unavailable'
    });
  }
  if (urlPath.startsWith('/api/')) {
    handleApiRequest(req, res);
  } else {
    serveStaticFile(req, res);
  }
});

const wss = new WebSocketServer({ server, maxPayload: MAX_WS_PAYLOAD_BYTES });
let shuttingDown = false;

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  });
}, WS_HEARTBEAT_MS);

server.on('close', () => clearInterval(heartbeatInterval));

wss.on('connection', (ws) => {
  if (shuttingDown) {
    ws.close(1012, 'Server shutting down');
    return;
  }
  ws.durableSend = ws.send.bind(ws);
  ws.send = data => {
    if (persistenceFailed) return;
    if (outbound) outbound.push([ws, data]);
    else ws.durableSend(data);
  };
  const handshakeTimer = setTimeout(() => {
    if (!ws.protocolVerified) ws.terminate();
  }, WS_HANDSHAKE_TIMEOUT_MS);
  handshakeTimer.unref();
  ws.on('close', () => clearTimeout(handshakeTimer));
  let trafficTokens = 80, trafficAt = Date.now();
  ws.isAlive = true;
  ws.protocolVerified = false;
  ws.on('pong', () => { ws.isAlive = true; });

  // First packet establishes the wire contract before either side is allowed
  // to create/join/reconnect a room. This turns stale-browser/stale-server
  // combinations into an explicit refresh screen instead of mystery
  // "Unknown message type" failures.
  sendToWs(ws, { type: 'protocol:hello', protocolVersion: PROTOCOL_VERSION });

  ws.on('message', (data) => {
    try {
      const trafficNow = Date.now();
      trafficTokens = Math.min(80, trafficTokens + (trafficNow - trafficAt) * 0.02);
      trafficAt = trafficNow;
      if (trafficTokens < 1) { ws.close(1008, 'Message rate exceeded'); return; }
      trafficTokens--;
      if (persistenceFailed || recoveryStoreLocked) { ws.close(1013, 'Storage unavailable'); return; }
      if (shuttingDown) {
        sendToWs(ws, { type: 'error', message: 'SERVER SHUTDOWN IN PROGRESS // RECONNECT REQUIRED' });
        return;
      }
      const message = JSON.parse(data.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;

      if (!ws.protocolVerified) {
        if (message.type !== 'protocol:hello' || message.protocolVersion !== PROTOCOL_VERSION) {
          sendToWs(ws, {
            type: 'protocol:mismatch',
            serverVersion: PROTOCOL_VERSION,
            clientVersion: message.protocolVersion ?? null,
            message: 'SYSTEM VERSION MISMATCH // REFRESH REQUIRED'
          });
          ws.close(1008, 'Protocol version mismatch');
          return;
        }
        ws.protocolVerified = true;
        clearTimeout(handshakeTimer);
        sendToWs(ws, { type: 'protocol:ready', protocolVersion: PROTOCOL_VERSION });
        return;
      }

      runtimeAction(() => {
      switch (message.type) {
        case 'room:create': {
          if (!isValidGmToken(message.gmToken)) {
            sendToWs(ws, { type: 'auth:required', role: 'gm', message: 'Game Master authentication required' });
            break;
          }
          ws.gmAuthenticated = true;
          const result = createRoom(message.gameId || 'sample-game', ws);
          if (result.error) {
            sendToWs(ws, { type: 'error', code: result.code, message: result.error });
          } else {
            sendToWs(ws, { type: 'room:created', roomCode: result.roomCode, hostToken: result.hostToken });
            // Send the host its own initial state:public immediately -- without
            // this, trackers with a non-zero 'ready' default (the Timer's
            // difficulty duration, e.g. "20:00") sit at their pre-room static
            // default (App.timer's own "00:00") until some other action or
            // client happens to trigger the first broadcast. WOMF/Wheel never
            // exposed this gap since their own defaults are already correct
            // (0/10, closed).
            const newRoom = rooms.get(result.roomCode);
            if (newRoom) {
              sendToWs(ws, { type: 'state:public', ...getPublicState(newRoom) });
              // Same reasoning as the state:public send just above, for
              // chat this time: without this, the host's client-side chat
              // state stays completely uninitialized until SOME chat event
              // eventually happens (a player's first guess, or the GM's
              // own first Shadow Broker broadcast) -- and a client that
              // treats "my very first chat:update ever" as the signal to
              // skip replaying history as fresh (see PlayerApp/App's
              // _chatEverInitialized) would then wrongly swallow that very
              // first real event instead of correctly treating it as new.
              // Sending an (empty, for a brand new room) baseline here,
              // mirroring what handlePlayerJoin already does for players,
              // closes that gap.
              sendToWs(ws, { type: 'chat:update', ...getChatState(newRoom) });
              sendTributeVaultToHost(newRoom);
              sendRitualDetailToHost(newRoom);
              // The Master Room already contains players before a game is armed.
              // Wake their existing clients in place instead of making them rejoin.
              broadcastToRoom(newRoom, { type: 'state:public', ...getPublicState(newRoom) });
              broadcastChatUpdate(newRoom);
              broadcastPlayersUpdate(newRoom);
              broadcastRitualState(newRoom);
            }
          }
          break;
        }
        case 'room:join': {
          handlePlayerJoin(ws, message);
          break;
        }
        case 'host:reconnect': {
          if (!isValidGmToken(message.gmToken)) {
            sendToWs(ws, { type: 'auth:required', role: 'gm', message: 'Game Master authentication required' });
            break;
          }
          ws.gmAuthenticated = true;
          handleHostReconnect(ws, message);
          break;
        }
        case 'host:recover': {
          if (!isValidGmToken(message.gmToken)) {
            sendToWs(ws, { type: 'auth:required', role: 'gm', message: 'Game Master authentication required' });
            break;
          }
          ws.gmAuthenticated = true;
          handleHostRecover(ws);
          break;
        }
        case 'gm:command': {
          handleHostCommand(ws, message);
          break;
        }
        case 'player:hintRequest': {
          handleHintRequest(ws, message);
          break;
        }
        case 'chat:guess': {
          handleChatGuess(ws, message);
          break;
        }
        case 'chat:edit': {
          handleChatEdit(ws, message);
          break;
        }
        case 'chat:delete': {
          handleChatDelete(ws, message);
          break;
        }
        case 'chat:seen': {
          handleChatSeen(ws, message);
          break;
        }
        case 'chat:react': {
          handleChatReaction(ws, message);
          break;
        }
        case 'chat:gif': {
          handleChatRemoteGif(ws, message);
          break;
        }
        case 'chat:image-url': {
          handleChatImageUrl(ws, message);
          break;
        }
        case 'chat:poll:create': {
          handleChatPollCreate(ws, message);
          break;
        }
        case 'chat:poll:vote': {
          handleChatPollVote(ws, message);
          break;
        }
        case 'chat:poll:close': {
          handleChatPollClose(ws, message);
          break;
        }
        case 'threefold:challenge': {
          handleThreefoldChallenge(ws, message);
          break;
        }
        case 'threefold:accept': {
          handleThreefoldAccept(ws, message);
          break;
        }
        case 'threefold:decline': {
          handleThreefoldDecline(ws, message);
          break;
        }
        case 'threefold:move': {
          handleThreefoldMove(ws, message);
          break;
        }
        case 'unstableConcoction:spin': {
          handleUnstableConcoctionSpin(ws);
          break;
        }
        case 'tribute:submit': {
          handleBloodTributeSubmit(ws, message);
          break;
        }
        case 'ritual:join': {
          handleRitualJoin(ws);
          break;
        }
        case 'ritual:tributeSubmit': {
          handleRitualTributeSubmit(ws, message);
          break;
        }
        case 'ritual:tributeAccept': {
          handleRitualTributeAccept(ws);
          break;
        }
        case 'ritual:tributeReject': {
          handleRitualTributeReject(ws);
          break;
        }
        case 'ritual:reset': {
          handleRitualReset(ws);
          break;
        }
        case 'ritual:cancel': {
          handleRitualCancel(ws);
          break;
        }
        case 'gm:tributeVaultClear': {
          handleBloodTributeVaultClear(ws);
          break;
        }
        case 'gm:bloodTributeMark': {
          handleMarkChatBloodTribute(ws, message);
          break;
        }
        case 'gm:bloodTributeCancel': {
          handleCancelChatBloodTribute(ws, message);
          break;
        }
        case 'gm:tributeVaultUpdate': {
          handleTributeVaultUpdate(ws, message);
          break;
        }
        case 'gm:reliquaryAccess': {
          handleReliquaryAccess(ws, message);
          break;
        }
        case 'gm:tributeForgive': {
          handleTributeForgive(ws);
          break;
        }
        case 'gm:judgeGuess': {
          handleJudgeGuess(ws, message);
          break;
        }
        case 'gm:denyAll': {
          handleDenyAll(ws);
          break;
        }
        case 'gm:broadcast': {
          handleGmBroadcast(ws, message);
          break;
        }
        case 'gm:clearBroadcast': {
          handleGmClearBroadcast(ws);
          break;
        }
        case 'gm:nemaAsoc': {
          handleGmNemaAsoc(ws);
          break;
        }
        case 'gm:biceAsoc': {
          handleGmBiceAsoc(ws);
          break;
        }
        case 'gm:omen': {
          handleGmOmen(ws);
          break;
        }
        case 'gm:gameWon': {
          handleGmGameWon(ws);
          break;
        }
        case 'gm:switchGame': {
          handleSwitchGame(ws, message);
          break;
        }
        case 'gm:solutionCountdown': {
          handleSolutionCountdown(ws, message);
          break;
        }
        case 'gm:failFinal': {
          handleFailFinal(ws, message);
          break;
        }
        case 'gm:failColumn': {
          handleFailColumn(ws, message);
          break;
        }
        case 'gm:womfSubtract': {
          handleWomfSubtract(ws);
          break;
        }
        case 'gm:womfReset': {
          handleWomfReset(ws);
          break;
        }
        case 'gm:wheelOpen': {
          handleWheelOpen(ws, message);
          break;
        }
        case 'gm:wheelRoll': {
          handleWheelRoll(ws);
          break;
        }
        case 'gm:wheelClose': {
          handleWheelClose(ws);
          break;
        }
        case 'gm:timerLaunchCountdown': {
          handleTimerLaunchCountdown(ws);
          break;
        }
        case 'gm:timerStart': {
          handleTimerStart(ws);
          break;
        }
        case 'gm:timerPause': {
          handleTimerPause(ws);
          break;
        }
        case 'gm:timerResume': {
          handleTimerResume(ws);
          break;
        }
        case 'gm:timerAdjust': {
          handleTimerAdjust(ws, message);
          break;
        }
        case 'gm:revealResults': {
          handleRevealResults(ws);
          break;
        }
        case 'gm:finishGame': {
          handleGmFinishGame(ws);
          break;
        }
        case 'gm:showRecount': {
          handleGmShowRecount(ws);
          break;
        }
        case 'gm:kickPlayer': {
          handleModeratePlayer(ws, message, false);
          break;
        }
        case 'gm:banPlayer': {
          handleModeratePlayer(ws, message, true);
          break;
        }
        case 'players:list': {
          handlePlayersList(ws);
          break;
        }
        case 'leaderboard:getAllTime': {
          sendToWs(ws, { type: 'leaderboard:allTime', players: playerStore.getAllTimeLeaderboard(50) });
          break;
        }
        case 'gm:setRoomMode': {
          handleSetRoomMode(ws, message);
          break;
        }
        case 'room:close': {
          handleCloseRoom(ws);
          break;
        }
        default:
          sendToWs(ws, { type: 'error', message: 'Unknown message type' });
      }
      });
    } catch (e) {
      console.error('WebSocket message error:', e);
      sendToWs(ws, { type: 'error', message: 'Malformed message' });
    }
  });

  ws.on('close', () => runtimeAction(() => handleClose(ws)));
  ws.on('error', (err) => console.error('WebSocket error:', err));
});

const restoredRoomCount = restoreActiveRooms();
ensureMasterRoom();
for (const room of rooms.values()) {
  if (room.wheel?.phase === 'spinning') armWheelSettlement(room);
  for (const action of Object.values(room.pendingReveals || {})) armColumnReveal(room, action);
}

server.listen(PORT, '0.0.0.0', () => {
  pruneAuthTokens();
  console.log(`ASOC Engine server running on http://0.0.0.0:${PORT}`);
  console.log(`Gamemaster: http://localhost:${PORT}`);
  console.log(`Player join: http://<LAN-IP>:${PORT}/join.html`);
  console.log(`[persistence] Durable data directory: ${ASOC_DATA_DIR}`);
  if (restoredRoomCount > 0) console.log(`[recovery] ${restoredRoomCount} room(s) available for reconnect`);
});

const SHUTDOWN_GRACE_MS = Math.max(1000, Number(process.env.ASOC_SHUTDOWN_GRACE_MS) || 10000);
function gracefulShutdown(signal) {
  if (shuttingDown) {
    console.warn(`[shutdown] ${signal} received while shutdown is already in progress`);
    return;
  }
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received; persisting MASTER and closing connections`);

  const forceTimer = setTimeout(() => {
    console.error(`[shutdown] Grace period of ${SHUTDOWN_GRACE_MS}ms expired; forcing exit`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceTimer.unref();

  try {
    persistActiveRooms();
    savePlayerAuthSessions();
    saveGmLockouts();
  } catch (error) {
    console.error('[shutdown] Persistence flush failed:', error);
  }

  clearInterval(heartbeatInterval);
  for (const ws of wss.clients) {
    try { ws.close(1012, 'Server restarting'); } catch {}
  }
  wss.close(() => console.log('[shutdown] WebSocket server closed'));
  server.close((error) => {
    clearTimeout(forceTimer);
    if (error) {
      console.error('[shutdown] HTTP server close failed:', error);
      process.exit(1);
      return;
    }
    console.log('[shutdown] Persistence complete; HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
if (process.env.NODE_ENV === 'test') {
  process.on('message', message => {
    if (message && message.type === 'asoc:test-shutdown') gracefulShutdown('TEST');
  });
}
