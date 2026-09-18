const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const gameStore = require('./game-store');
const playerStore = require('./player-store');
const scoring = require('./scoring-constants');

const PORT = Number(process.env.PORT) || 8080;
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;
const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;
const HOST_RECONNECT_GRACE_MS = 60000;
const MAX_CHAT_LENGTH = 100;
const CHAT_HISTORY_LIMIT = 200;

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
  '.ico': 'image/x-icon'
};

const rooms = new Map();

const ACTIVE_ROOMS_FILE = process.env.ASOC_SESSION_FILE
  ? path.resolve(process.env.ASOC_SESSION_FILE)
  : path.join(__dirname, 'active-rooms.json');

function makeOfflinePlayerSocket() {
  return {
    readyState: 0,
    close() {}
  };
}

function serializeRoomForRecovery(room) {
  const players = [];
  room.players.forEach(player => {
    players.push({
      id: player.id,
      name: player.name,
      joinedAt: player.joinedAt || Date.now()
    });
  });

  return {
    code: room.code,
    gameId: room.gameId,
    gameData: room.gameData,
    revision: room.revision,
    boardId: room.boardId,
    sessionState: room.sessionState,
    currentBackground: room.currentBackground,
    hostToken: room.hostToken,
    createdAt: room.createdAt,
    chat: room.chat,
    scoring: room.scoring,
    womf: room.womf,
    wheel: room.wheel,
    timer: room.timer,
    players
  };
}

function persistActiveRooms() {
  const payload = {
    version: 1,
    savedAt: Date.now(),
    rooms: Array.from(rooms.values(), serializeRoomForRecovery)
  };
  const tmpFile = ACTIVE_ROOMS_FILE + '.tmp-' + process.pid + '-' + Date.now();

  try {
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpFile, ACTIVE_ROOMS_FILE);
  } catch (error) {
    console.error('[recovery] Failed to save active rooms:', error.message);
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function restoreActiveRooms() {
  if (!fs.existsSync(ACTIVE_ROOMS_FILE)) return 0;

  try {
    const payload = JSON.parse(fs.readFileSync(ACTIVE_ROOMS_FILE, 'utf8'));
    if (!payload || payload.version !== 1 || !Array.isArray(payload.rooms)) {
      throw new Error('Unsupported or malformed recovery file');
    }

    let restored = 0;
    for (const saved of payload.rooms) {
      if (!saved || typeof saved.code !== 'string' || typeof saved.hostToken !== 'string') continue;

      const gameData = saved.gameData || loadGameData(saved.gameId);
      if (!gameData) {
        console.warn(`[recovery] Skipping room ${saved.code}: game data unavailable`);
        continue;
      }

      const room = {
        code: saved.code.toUpperCase(),
        gameId: saved.gameId || gameData.id || 'sample-game',
        gameData,
        revision: Number.isFinite(saved.revision) ? saved.revision : 0,
        boardId: saved.boardId || generateBoardId(),
        sessionState: saved.sessionState || {
          cells: {},
          finalSolution: false,
          finalOutcome: null,
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
        timer: saved.timer || null
      };

      if (!room.timer) resetTimer(room);

      for (const player of Array.isArray(saved.players) ? saved.players : []) {
        if (!player || typeof player.id !== 'string' || typeof player.name !== 'string') continue;
        room.players.set(makeOfflinePlayerSocket(), {
          id: player.id,
          name: player.name,
          connected: false,
          joinedAt: player.joinedAt || Date.now()
        });
      }

      rooms.set(room.code, room);
      restored++;
      console.log(`[recovery] Restored room ${room.code} (game: ${room.gameId})`);
    }

    return restored;
  } catch (error) {
    console.error('[recovery] Failed to restore active rooms:', error.message);
    return 0;
  }
}

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function generateHostToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function generatePlayerId() {
  return Math.random().toString(36).substring(2, 10);
}

function generateMessageId() {
  return 'msg-' + Math.random().toString(36).substring(2, 12);
}

function generateBoardId() {
  return 'board-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

function generateEventId() {
  return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);
}

const gmTokens = new Set();
let currentGMToken = '';

function refreshGMToken() {
  const token = 'gm-' + Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
  gmTokens.clear();
  gmTokens.add(token);
  currentGMToken = token;
  return token;
}

function isLocalhostRequest(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isGmAuthorized(req) {
  if (isLocalhostRequest(req)) return true;
  const token = req.headers['x-gm-token'] || req.headers['x-gm-token'];
  return typeof token === 'string' && gmTokens.has(token);
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

function loadGameData(gameIdOrFilename) {
  return gameStore.readGame(gameIdOrFilename);
}

function createRoom(gameId, hostWs) {
  const gameData = loadGameData(gameId);
  if (!gameData) return { error: 'Game not found' };

  const roomCode = generateRoomCode();
  const hostToken = generateHostToken();

  const room = {
    code: roomCode,
    gameId,
    gameData,
    revision: 0,
    boardId: generateBoardId(),
    sessionState: {
      cells: {},
      finalSolution: false,
      finalOutcome: null, // null | 'success' | 'failed' -- drives GREEN vs BLACK/RED client treatment
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
    hostConnection: hostWs,
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
    // and XLSX imports; it is only ever cleared by future Wheel-roll logic
    // (not yet built -- see addWomfCharge()/handleFailColumn()). It is
    // capped at 10 and never decreases on its own. `failedColumns` is the
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
    // module ONLY opens the wheel, lets the GM roll it, and reports who it
    // landed on -- it does not reset the WOMF charge and does not invent
    // any punishment/consequence logic. That stays entirely up to the GM.
    wheel: {
      open: false,
      segments: [],
      phase: 'idle',
      winnerIndex: null,
      spinToken: null
    },
    // TIMER + BORROWED TIME -- server-authoritative, per-board (unlike WOMF's
    // persistent charge, a fresh board gets a fresh, un-started timer -- see
    // resetTimer(), called here and again from resetBoard/switchGame). Never
    // auto-starts: phase stays 'ready' until the GM explicitly sends
    // gm:timerStart. See resetTimer() just below for the full field list and
    // the phase state machine.
    timer: null
  };
  resetTimer(room);

  rooms.set(roomCode, room);
  persistActiveRooms();
  hostWs.roomCode = roomCode;
  hostWs.isHost = true;
  hostWs.hostToken = hostToken;

  console.log(`[ROOM] Created: ${roomCode} (game: ${gameId})`);
  return { roomCode, hostToken };
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
        // Only ever set when the GM declared this column FAILED (see
        // handleFailColumn) -- drives the same red "failed" treatment the
        // Final's outcome already gets. Absent for an ordinary reveal.
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
    gameId: game.id,
    title: game.title,
    theme: game.theme,
    difficulty: game.difficulty,
    revision: room.revision,
    background: room.currentBackground,
    cells: publicCells,
    finalSolution: finalCell,
    // Row-order only (e.g. { A: [3,1,4,2] }) -- never clue text -- so
    // clients can resolve which physical slot shows which difficulty tier.
    // Safe to send to every client, GM and players alike.
    clueOrder: room.sessionState.clueOrder || { A: [], B: [], C: [], D: [] },
    womf: getWomfPublicState(room),
    wheel: getWheelPublicState(room),
    timer: getTimerPublicState(room),
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

const WHEEL_SPIN_DURATION_MS = 4200;
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
  if (!room.womf || room.womf.charge < 10) {
    sendToWs(ws, { type: 'error', message: 'WOMF is not armed yet (10/10 required)' });
    return;
  }

  let segments = Array.isArray(message.segments) ? message.segments : [];
  segments = segments.map(s => String(s || '').trim()).filter(Boolean);
  // De-dupe while preserving order.
  segments = segments.filter((name, i) => segments.indexOf(name) === i);

  if (segments.length === 0) {
    const connected = [];
    room.players.forEach(player => { if (player.connected) connected.push(player.name); });
    segments = connected;
  }

  if (segments.length > WHEEL_MAX_SEGMENTS) segments = segments.slice(0, WHEEL_MAX_SEGMENTS);

  if (segments.length < WHEEL_MIN_SEGMENTS) {
    sendToWs(ws, { type: 'error', message: `The Wheel needs at least ${WHEEL_MIN_SEGMENTS} names (got ${segments.length})` });
    return;
  }

  room.wheel = { open: true, segments, phase: 'idle', winnerIndex: null, spinToken: null };
  room.revision++;

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
  if (!room.wheel || !room.wheel.open) {
    sendToWs(ws, { type: 'error', message: 'The Wheel is not open' });
    return;
  }
  if (room.wheel.phase === 'spinning') {
    sendToWs(ws, { type: 'error', message: 'The Wheel is already spinning' });
    return;
  }
  if (!room.wheel.segments || room.wheel.segments.length < WHEEL_MIN_SEGMENTS) {
    sendToWs(ws, { type: 'error', message: 'Not enough names on the Wheel to roll' });
    return;
  }

  const winnerIndex = Math.floor(Math.random() * room.wheel.segments.length);
  const spinToken = 'spin-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8);

  room.wheel.phase = 'spinning';
  room.wheel.winnerIndex = winnerIndex;
  room.wheel.spinToken = spinToken;
  room.revision++;

  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM rolled the Wheel -- landed on "${room.wheel.segments[winnerIndex]}"`);

  setTimeout(() => {
    const stillRoom = rooms.get(room.code);
    // Bail if the room is gone, or a newer spin/close superseded this one.
    if (!stillRoom || !stillRoom.wheel || stillRoom.wheel.spinToken !== spinToken) return;
    stillRoom.wheel.phase = 'result';
    stillRoom.revision++;
    broadcastToRoom(stillRoom, { type: 'state:public', ...getPublicState(stillRoom) });
  }, WHEEL_SPIN_DURATION_MS);
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

  // Closing just hides the wheel -- it does NOT touch the WOMF charge (no
  // invented reset-after-roll logic; that stays a manual GM decision via
  // the existing WOMF -1 / RESET WOMF controls).
  resetWheel(room);
  room.revision++;

  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM closed the Wheel`);
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
  if (room.timer.phase !== 'ready') {
    sendToWs(ws, { type: 'error', message: 'The Timer has already been started' });
    return;
  }

  room.timer.phase = 'running';
  room.revision++;
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM started the Timer (${Math.round(room.timer.duration / 1000)}s)`);
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
  if (!room.timer || (room.timer.phase !== 'running' && room.timer.phase !== 'borrowed')) {
    sendToWs(ws, { type: 'error', message: 'The Timer is not currently running' });
    return;
  }

  room.timer.phase = room.timer.phase === 'borrowed' ? 'borrowed_paused' : 'paused';
  room.revision++;
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
  if (!room.timer || (room.timer.phase !== 'paused' && room.timer.phase !== 'borrowed_paused')) {
    sendToWs(ws, { type: 'error', message: 'The Timer is not currently paused' });
    return;
  }

  room.timer.phase = room.timer.phase === 'borrowed_paused' ? 'borrowed' : 'running';
  room.revision++;
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
  broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  console.log(`[ROOM ${room.code}] GM adjusted the Timer by ${deltaMs > 0 ? '+' : ''}${Math.round(deltaMs / 1000)}s (${inBorrowed ? 'Borrowed Time' : 'normal'})`);
}

// Single global tick, once per second, covering every room. Only rooms with
// an actively-running phase ('running' or 'borrowed') are touched -- ready/
// paused/borrowed_paused/expired/stopped never move on their own. This is
// the ONLY place normal time crosses into Borrowed Time, and the ONLY place
// Borrowed Time crosses into 'expired' -- both are pure phase/number
// changes with no side effects on scoring, WOMF, or the Final's own reveal
// state (per the locked spec's explicit "do not auto-fail / do not
// auto-charge WOMF" requirement).
setInterval(() => {
  let recoveryDirty = false;
  rooms.forEach((room) => {
    if (!room.timer) return;
    const t = room.timer;

    if (t.phase === 'running') {
      t.remaining = Math.max(0, t.remaining - TIMER_TICK_MS);
      if (t.remaining <= 0) {
        t.phase = 'borrowed';
        t.borrowedRemaining = t.borrowedDuration;
        console.log(`[ROOM ${room.code}] Timer hit 0:00 -- entering BORROWED TIME`);
      }
    } else if (t.phase === 'borrowed') {
      t.borrowedRemaining = Math.max(0, t.borrowedRemaining - TIMER_TICK_MS);
      if (t.borrowedRemaining <= 0) {
        t.phase = 'expired';
        console.log(`[ROOM ${room.code}] Borrowed Time hit 0:00 -- TIME EXPIRED (GM decision required)`);
      }
    } else {
      return;
    }

    room.revision++;
    broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
    recoveryDirty = true;
  });
  if (recoveryDirty) persistActiveRooms();
}, TIMER_TICK_MS);

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

function countRevealedCluesInColumn(room, col) {
  let count = 0;
  for (let row = 1; row <= 4; row++) {
    if (room.sessionState.cells[`${col}${row}`] === true) count++;
  }
  return count;
}

function countKnownColumns(room) {
  return SCORABLE_COLUMNS.filter(col => !!room.chat.solvedTargets[col]).length;
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

function getActiveParticipants(room) {
  const participants = [];
  room.players.forEach((player, ws) => {
    if (player.connected !== false) {
      participants.push({ playerId: player.id, playerName: player.name });
    }
  });
  return participants;
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
  playerStore.adjustProfile(playerName, { pointsDelta: points });
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
    difficulty: fields.difficulty ?? null
  };
  room.scoring.events.push(event);
  return event;
}

// Result shape from award/reverse helpers: { rejected, reason } on failure,
// { event } on success -- callers broadcast `score:event` only on success.
function awardColumnSolve(room, target, message) {
  const cluesRevealed = countRevealedCluesInColumn(room, target);
  if (cluesRevealed < 1) {
    return { rejected: true, reason: `Column ${target} has no revealed clues -- cannot award a column score.` };
  }

  const points = scoring.COLUMN_SCORE_BY_CLUES[Math.min(cluesRevealed, 4)];
  const difficulty = getAuthoritativeColumnDifficulty(room, target);

  const event = recordEvent(room, {
    type: 'column',
    target,
    sourceMessageId: message.id,
    playerId: message.playerId,
    playerName: message.playerName,
    points,
    cluesRevealed,
    difficulty
  });

  adjustPlayerScore(room, message.playerId, message.playerName, points);

  const statDeltas = { columnSolutions: 1 };
  if (cluesRevealed === 1) statDeltas.oneClueColumnSolutions = 1;
  if (difficulty === 'PURPLE') statDeltas.purpleSolves = 1;
  if (difficulty === 'BLACK') statDeltas.blackSolves = 1;
  playerStore.adjustProfile(message.playerName, { statDeltas });

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
  playerStore.adjustProfile(event.playerName, { statDeltas });

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
  playerStore.adjustProfile(message.playerName, { statDeltas });
  playerStore.maybeRecordEarliestFinal(message.playerName, columnsKnownAtSolve);

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
  playerStore.adjustProfile(event.playerName, { statDeltas });
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
      playerStore.maybeRecordBestStreak(streakPlayerName, streakLength);
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
  if (room.timer && !['ready', 'expired', 'stopped'].includes(room.timer.phase)) {
    room.timer.phase = 'stopped';
  }

  const participants = getActiveParticipants(room);
  const penaltyEvents = [];

  participants.forEach(({ playerId, playerName }) => {
    if (outcome === 'success') {
      playerStore.recordBoardFinalization(playerName, { won: true });
    } else {
      const event = recordEvent(room, {
        type: 'failedFinal',
        target: 'FINAL',
        playerId,
        playerName,
        points: -scoring.FAILED_FINAL_PENALTY
      });
      adjustPlayerScore(room, playerId, playerName, -scoring.FAILED_FINAL_PENALTY);
      playerStore.recordBoardFinalization(playerName, { won: false });
      penaltyEvents.push(event);
    }
  });

  return { participants, penaltyEvents };
}

function applyCommand(room, command, payload) {
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
      break;
    }
    case 'revealFinal': {
      if (room.sessionState.finalSolution !== true) {
        room.sessionState.finalSolution = true;
        room.sessionState.finalOutcome = room.sessionState.finalOutcome || 'success';
        changed = true;
      }
      break;
    }
    case 'hideFinal': {
      if (room.sessionState.finalSolution === true) {
        room.sessionState.finalSolution = false;
        room.sessionState.finalOutcome = null;
        changed = true;
      }
      break;
    }
    case 'resetBoard': {
      // RESET BOARD is an authoritative fresh attempt even if every cell is
      // currently hidden. Rebuild sessionState unconditionally so hidden
      // clue-queue assignments/outcome tags cannot survive a reset, and mark
      // the command changed so clients always receive the reset Timer/Wheel/
      // scoring/chat state that is rebuilt below.
      room.sessionState = { cells: {}, finalSolution: false, finalOutcome: null, cellOutcomes: {}, clueOrder: { A: [], B: [], C: [], D: [] } };
      changed = true;
      // A reset re-attempts the SAME board from scratch: mint a fresh
      // boardId (so a future streak rebuild only ever looks at solves that
      // happened after this reset) and clear per-board scoring state.
      // Session score and all-time profiles are untouched.
      room.boardId = generateBoardId();
      room.scoring.activeStreak = null;
      room.scoring.boardFinalized = false;
      room.scoring.pendingResults = null;
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

  if (changed) {
    room.revision++;
  }

  return { success: true, changed, revision: room.revision };
}

function isValidCell(cell) {
  if (!cell || cell.length < 2) return false;
  const col = cell[0];
  const row = parseInt(cell.slice(1), 10);
  if (!['A', 'B', 'C', 'D'].includes(col)) return false;
  if (isNaN(row) || row < 1 || row > 5) return false;
  return true;
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
  const oldVerdict = message.verdict;
  const oldTarget = message.target;
  let changed = false;
  let scoreWarning = null;
  let newAward = null;
  let finalOutcome = null;
  let streakChanged = false;

  message.verdict = verdict;
  message.target = target;

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
          // The reveal (headline + story) goes out to everyone immediately;
          // the point/penalty numbers are held back until the GM explicitly
          // advances past the story (gm:revealResults) -- see spec's
          // "delayed score damage is intentional pacing", which applies to
          // every client in the room, not just the GM's own screen.
          room.scoring.pendingResults = {
            outcome: 'success',
            columnsKnownAtSolve: result.event ? result.event.columnsKnownAtSolve : countKnownColumns(room),
            points: result.event ? result.event.points : 0,
            playerName: message.playerName
          };
          finalOutcome = { outcome: 'success' };
        }
      } else {
        const result = awardColumnSolve(room, target, message);
        if (result.rejected) {
          scoreWarning = result.reason;
        } else {
          newAward = { awardType: 'column', target, points: result.event.points, cluesRevealed: result.event.cluesRevealed, playerName: message.playerName };
        }
        streakChanged = true;
      }
    }

    if (reveal) {
      if (target === 'FINAL') {
        if (room.sessionState.finalSolution !== true) {
          room.sessionState.finalSolution = true;
          room.sessionState.finalOutcome = 'success';
          changed = true;
        }
      } else {
        const key = `${target}5`;
        if (room.sessionState.cells[key] !== true) {
          room.sessionState.cells[key] = true;
          changed = true;
        }
      }
    }
  }

  if (changed) {
    room.revision++;
  }

  return { success: true, changed, revision: room.revision, message, scoreWarning, newAward, finalOutcome, streakChanged };
}

function addChatMessage(room, playerId, playerName, text) {
  const sanitized = sanitizeText(text);
  if (!sanitized) return { success: false, error: 'Empty message' };
  if (sanitized.length > MAX_CHAT_LENGTH) {
    return { success: false, error: `Message too long (max ${MAX_CHAT_LENGTH} chars)` };
  }

  const message = {
    id: generateMessageId(),
    playerId,
    playerName,
    text: sanitized,
    timestamp: Date.now(),
    verdict: null,
    target: null
  };

  room.chat.messages.push(message);
  if (room.chat.messages.length > CHAT_HISTORY_LIMIT) {
    room.chat.messages = room.chat.messages.slice(-CHAT_HISTORY_LIMIT);
  }

  return { success: true, message };
}

// SHADOW BROKER -- presentation-layer identity feature. This is the ONLY
// genuinely new chat-message type: a host-authored, freestanding broadcast
// that isn't tied to judging any player's guess. It deliberately reuses
// addChatMessage's exact validation (sanitizeText, MAX_CHAT_LENGTH) and
// history-trim behavior so it behaves identically to a normal message on
// the wire -- the only difference is playerId is null, playerName is the
// fixed display label, and `source: 'shadowBroker'` marks it so clients
// can render it as a Broker transmission instead of a player guess.
// `source` is set here, server-side, only -- addChatMessage (the player
// guess path) never reads a client-supplied source field, so a player has
// no way to spoof this tag on their own message.
function addShadowBrokerMessage(room, text) {
  const sanitized = sanitizeText(text);
  if (!sanitized) return { success: false, error: 'Empty message' };
  if (sanitized.length > MAX_CHAT_LENGTH) {
    return { success: false, error: `Message too long (max ${MAX_CHAT_LENGTH} chars)` };
  }

  const message = {
    id: generateMessageId(),
    playerId: null,
    playerName: 'SHADOW BROKER',
    text: sanitized,
    timestamp: Date.now(),
    verdict: null,
    target: null,
    source: 'shadowBroker'
  };

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
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function getChatState(room) {
  return {
    messages: room.chat.messages.map(m => ({
      id: m.id,
      playerId: m.playerId,
      playerName: m.playerName,
      text: m.text,
      timestamp: m.timestamp,
      verdict: m.verdict,
      target: m.target,
      // Only ever set server-side by addShadowBrokerMessage -- absent
      // (undefined -> serializes as omitted) on every ordinary player
      // guess. See addShadowBrokerMessage for why a player can't spoof it.
      source: m.source || null
    })),
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

  const result = applyCommand(room, message.command, message.payload || {});

  if (result.success && result.changed) {
    const publicState = getPublicState(room);
    broadcastToRoom(room, { type: 'state:public', ...publicState });
    if (message.command === 'resetBoard') {
      // resetBoard also clears chat.solvedTargets (see applyCommand) so a
      // replayed board can be scored again -- clients' cached solved-target
      // state must be told about that too, same as any other chat change.
      broadcastChatUpdate(room);
      broadcastPlayersUpdate(room);
    }
    sendToWs(ws, { type: 'command:ack', revision: room.revision });
  } else if (result.success) {
    sendToWs(ws, { type: 'command:ack', revision: room.revision, unchanged: true });
  } else {
    sendToWs(ws, { type: 'error', message: result.error });
  }
}

function handlePlayerJoin(ws, message) {
  const { roomCode, name, playerId: requestedId } = message;
  const room = rooms.get(roomCode?.toUpperCase());

  if (!room) {
    sendToWs(ws, { type: 'error', message: 'Room not found' });
    return;
  }

  const cleanName = sanitizeText(name).slice(0, 20);
  if (!cleanName) {
    sendToWs(ws, { type: 'error', message: 'Name cannot be empty' });
    return;
  }

  // Reuse a stable id across reconnects (a dropped WebSocket, or a page
  // refresh restoring it from sessionStorage) so the SAME player doesn't
  // show up as a second "ghost" entry next to a stale one. No accounts and
  // nothing persists beyond this room/session: this only reclaims an id
  // that already belongs to a player currently tracked in THIS room.
  let playerId = null;
  if (requestedId && typeof requestedId === 'string') {
    for (const [existingWs, info] of room.players) {
      if (info.id === requestedId) {
        if (existingWs !== ws && existingWs.readyState === 1) {
          // A live duplicate connection under the same id (e.g. the old
          // socket hasn't noticed it's dead yet) -- this new one supersedes it.
          try { existingWs.close(); } catch (e) {}
        }
        room.players.delete(existingWs);
        playerId = requestedId;
        break;
      }
    }
  }
  if (!playerId) playerId = generatePlayerId();

  ws.roomCode = roomCode.toUpperCase();
  ws.playerId = playerId;
  ws.playerName = cleanName;
  ws.isHost = false;

  room.players.set(ws, { id: playerId, name: cleanName, connected: true, joinedAt: Date.now() });

  const publicState = getPublicState(room);
  sendToWs(ws, { type: 'state:public', ...publicState });
  sendToWs(ws, { type: 'join:success', playerId, roomCode: room.code });

  const chatState = getChatState(room);
  sendToWs(ws, { type: 'chat:update', ...chatState });

  broadcastPlayersUpdate(room);
  console.log(`[ROOM ${room.code}] Player joined: ${cleanName} (${playerId})`);
}

function broadcastPlayersUpdate(room) {
  const players = [];
  room.players.forEach((player, ws) => {
    players.push({
      id: player.id,
      name: player.name,
      connected: ws.readyState === 1,
      score: room.scoring.players[player.id]?.sessionScore || 0
    });
  });

  const message = { type: 'players:update', players };
  room.players.forEach((player, ws) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  });
  if (room.hostConnection?.readyState === 1) {
    room.hostConnection.send(JSON.stringify(message));
  }
}

function handleHostReconnect(ws, message) {
  const { roomCode, hostToken } = message;
  const room = rooms.get(roomCode?.toUpperCase());

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
  ws.roomCode = roomCode.toUpperCase();
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

  broadcastPlayersUpdate(room);
  console.log(`[ROOM ${room.code}] Host reconnected`);
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

  const result = addChatMessage(room, ws.playerId, ws.playerName, text);
  if (result.success) {
    broadcastChatUpdate(room);
  } else {
    sendToWs(ws, { type: 'error', message: result.error });
  }
}

// SHADOW BROKER free-form broadcast -- host-only, presentation layer only.
// Reuses the existing chat pipeline end to end (addShadowBrokerMessage's
// validation mirrors addChatMessage exactly; broadcastChatUpdate is the
// same function every other chat mutation already uses), so this adds
// exactly one new code path rather than a parallel message system. No
// scoring, verdict, timer, clue, or reveal state is touched.
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

  const result = addShadowBrokerMessage(room, text);
  if (result.success) {
    broadcastChatUpdate(room);
  } else {
    sendToWs(ws, { type: 'error', message: result.error });
  }
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

  const { messageId, verdict, target, reveal } = message;
  if (!messageId || !verdict || !['wrong', 'correct'].includes(verdict)) {
    sendToWs(ws, { type: 'error', message: 'Invalid verdict data' });
    return;
  }

  if (verdict === 'correct' && !target) {
    sendToWs(ws, { type: 'error', message: 'Target required for correct verdict' });
    return;
  }

  const result = applyVerdict(room, messageId, verdict, target, reveal);
  if (result.success) {
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
  room.sessionState = { cells: {}, finalSolution: false, finalOutcome: null, cellOutcomes: {}, clueOrder: { A: [], B: [], C: [], D: [] } };
  room.currentBackground = game.background || gameStore.DEFAULT_BACKGROUND;
  room.chat = { messages: [], solvedTargets: {} };
  // NEXT GAME starts a new board within the SAME session: current-session
  // scores (room.scoring.players) and the persisted all-time profiles are
  // untouched. Only per-board state resets, exactly like ending a streak
  // when the board changes.
  room.boardId = generateBoardId();
  room.scoring.activeStreak = null;
  room.scoring.boardFinalized = false;
  room.scoring.pendingResults = null;
  // WOMF charge is global ASOC state, not per-board -- do NOT reset it here.
  // Only the per-board "already declared failed this board" guard resets.
  if (!room.womf) room.womf = { charge: 0, failedColumns: {} };
  room.womf.failedColumns = {};
  // A wheel opened for the previous game no longer makes sense -- close it.
  resetWheel(room);
  // NEXT GAME is a new board -- same treatment as resetBoard: a fresh,
  // un-started Timer at the new game's difficulty default.
  resetTimer(room);

  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });
  broadcastChatUpdate(room);
  broadcastPlayersUpdate(room);
  sendToWs(ws, { type: 'game:loaded', game });
  sendToWs(ws, { type: 'gm:switchGame:ack', gameId: game.id });

  console.log(`[ROOM ${room.code}] Game switched: ${game.title} (${game.id})`);
}

// Explicit GM action -- the Failed Final is NEVER inferred from a timer,
// guess count, or inactivity (locked decision). The GM alone decides the
// room has lost.
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

  if (room.scoring.boardFinalized) {
    sendToWs(ws, { type: 'error', message: 'This board has already been finalized' });
    return;
  }

  if (room.sessionState.finalSolution === true) {
    sendToWs(ws, { type: 'error', message: 'The Final has already been revealed for this board' });
    return;
  }

  // finalizeBoard() is the single, guarded place gamesPlayed/gamesWon and
  // the penalty are applied -- boardFinalized flips true inside it, so a
  // duplicate gm:failFinal (double-click) can never double-apply the loss.
  const finalizeResult = finalizeBoard(room, 'failed');

  // WOMF: a failed FINAL SOLUTION charges +3 (capped at 10). This sits
  // behind the same boardFinalized guard above, so a double-click can
  // never double-charge it.
  addWomfCharge(room, 3);

  room.sessionState.finalSolution = true;
  room.sessionState.finalOutcome = 'failed';
  room.revision++;

  // Same pacing rule as a successful Final: everyone sees the reveal +
  // story immediately, the penalty amount waits for gm:revealResults.
  room.scoring.pendingResults = {
    outcome: 'failed',
    penalty: scoring.FAILED_FINAL_PENALTY,
    participants: finalizeResult.participants ? finalizeResult.participants.map(p => p.playerName) : []
  };

  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });
  // players:update is deliberately NOT broadcast here. The -200 penalty was
  // just committed to room.scoring.players and players.json above (inside
  // finalizeBoard) -- COMMIT SCORE NOW -- but per the locked pacing spec
  // the visible leaderboard movement stays held back until the GM clicks
  // SHOW RESULTS -- DISPLAY SCORE LATER. handleRevealResults() is the one
  // place that broadcasts players:update for this outcome, exactly
  // mirroring the Successful Final path below.
  broadcastToRoom(room, {
    type: 'score:finalReveal',
    outcome: 'failed',
    correctSolution: room.gameData.finalSolution
  });

  console.log(`[ROOM ${room.code}] GM declared Final FAILED`);
}

// Explicit GM action -- mirrors handleFailFinal exactly, one guarded,
// host-only, multiplayer-only control per column. This is the ONLY source
// of a "failed column" event; it is never inferred from guess judging
// (a GM revealing a column for pacing is not the same thing as a failure).
// Declaring a column failed charges WOMF +1 and force-reveals that
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

  if (!room.womf) room.womf = { charge: 0, failedColumns: {} };

  if (room.chat.solvedTargets[column]) {
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

  const solutionKey = `${column}5`;
  room.sessionState.cells[solutionKey] = true;
  if (!room.sessionState.cellOutcomes) room.sessionState.cellOutcomes = {};
  room.sessionState.cellOutcomes[solutionKey] = 'failed';

  room.revision++;

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
  if (!room.scoring.pendingResults) return; // nothing pending -- ignore silently, not an error

  broadcastToRoom(room, { type: 'score:finalResults', ...room.scoring.pendingResults });
  broadcastPlayersUpdate(room);
  room.scoring.pendingResults = null;
}

function handleCloseRoom(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can close the room' });
    return;
  }

  if (room.hostReconnectTimer) {
    clearTimeout(room.hostReconnectTimer);
    room.hostReconnectTimer = null;
  }

  room.players.forEach((player, playerWs) => {
    sendToWs(playerWs, { type: 'room:closed', message: 'Host closed the room' });
    playerWs.close();
  });

  rooms.delete(room.code);
  console.log(`[ROOM ${room.code}] Closed by host`);
}

function handleClose(ws) {
  if (ws.isHost) {
    const room = rooms.get(ws.roomCode);
    if (room) {
      room.hostConnection = null;
      room.hostReconnectTimer = setTimeout(() => {
        console.log(`[ROOM ${room.code}] Host grace period expired, closing room`);
        room.players.forEach((player, playerWs) => {
          sendToWs(playerWs, { type: 'room:closed', message: 'Host disconnected' });
          playerWs.close();
        });
        rooms.delete(ws.roomCode);
        persistActiveRooms();
      }, HOST_RECONNECT_GRACE_MS);
      console.log(`[ROOM ${ws.roomCode}] Host disconnected, grace period started`);
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
      if (player) player.connected = false;
      broadcastPlayersUpdate(room);
      console.log(`[ROOM ${ws.roomCode}] Player left: ${ws.playerName}`);
    }
  }
  persistActiveRooms();
}

function handleApiRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;

  if (method === 'GET' && parts[0] === 'api' && parts[1] === 'gm' && parts[2] === 'token') {
    if (!isLocalhostRequest(req)) {
      return sendJson(res, 403, { error: 'GM token is only available from localhost' });
    }
    return sendJson(res, 200, { token: currentGMToken });
  }

  if (!isGmAuthorized(req)) {
    return sendJson(res, 401, { error: 'Gamemaster authorization required' });
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
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
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
  if (urlPath.startsWith('/api/')) {
    handleApiRequest(req, res);
  } else {
    serveStaticFile(req, res);
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'room:create': {
          const result = createRoom(message.gameId || 'sample-game', ws);
          if (result.error) {
            sendToWs(ws, { type: 'error', message: result.error });
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
            }
          }
          break;
        }
        case 'room:join': {
          handlePlayerJoin(ws, message);
          break;
        }
        case 'host:reconnect': {
          handleHostReconnect(ws, message);
          break;
        }
        case 'gm:command': {
          handleHostCommand(ws, message);
          break;
        }
        case 'chat:guess': {
          handleChatGuess(ws, message);
          break;
        }
        case 'gm:judgeGuess': {
          handleJudgeGuess(ws, message);
          break;
        }
        case 'gm:broadcast': {
          handleGmBroadcast(ws, message);
          break;
        }
        case 'gm:switchGame': {
          handleSwitchGame(ws, message);
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
        case 'leaderboard:getAllTime': {
          sendToWs(ws, { type: 'leaderboard:allTime', players: playerStore.getAllTimeLeaderboard(50) });
          break;
        }
        case 'room:close': {
          handleCloseRoom(ws);
          break;
        }
        default:
          sendToWs(ws, { type: 'error', message: 'Unknown message type' });
      }
      persistActiveRooms();
    } catch (e) {
      console.error('WebSocket message error:', e);
      sendToWs(ws, { type: 'error', message: 'Malformed message' });
    }
  });

  ws.on('close', () => handleClose(ws));
  ws.on('error', (err) => console.error('WebSocket error:', err));
});

const restoredRoomCount = restoreActiveRooms();

server.listen(PORT, '0.0.0.0', () => {
  const token = refreshGMToken();
  console.log(`ASOC Engine server running on http://0.0.0.0:${PORT}`);
  console.log(`Gamemaster: http://localhost:${PORT}`);
  console.log(`Player join: http://<LAN-IP>:${PORT}/join.html`);
  console.log(`GM token: ${token}`);
  if (restoredRoomCount > 0) console.log(`[recovery] ${restoredRoomCount} room(s) available for reconnect`);
});