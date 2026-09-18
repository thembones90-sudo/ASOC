const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const gameStore = require('./game-store');
const playerStore = require('./player-store');
const scoring = require('./scoring-constants');

const PORT = 8080;
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
      finalOutcome: null // null | 'success' | 'failed' -- drives GREEN vs BLACK/RED client treatment
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
    }
  };

  rooms.set(roomCode, room);
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
          value: getCellData(game, col, row)
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
        value: getCellData(game, col, 5)
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
    womf: getWomfPublicState(room),
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

function getCellData(game, column, row) {
  if (row >= 1 && row <= 4) {
    return game.columns[column]?.clues[row - 1] || '';
  } else if (row === 5) {
    return game.columns[column]?.solution || '';
  }
  return '';
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
      const { cell } = payload;
      if (!isValidCell(cell)) return { success: false, error: 'Invalid cell' };
      const [col, row] = [cell[0], parseInt(cell.slice(1), 10)];
      const key = `${col}${row}`;
      if (room.sessionState.cells[key] !== true) {
        room.sessionState.cells[key] = true;
        changed = true;
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
      break;
    }
    case 'revealColumn': {
      const { column } = payload;
      if (!['A', 'B', 'C', 'D'].includes(column)) return { success: false, error: 'Invalid column' };
      for (let row = 1; row <= 5; row++) {
        const key = `${column}${row}`;
        if (room.sessionState.cells[key] !== true) {
          room.sessionState.cells[key] = true;
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
      const hadChanges = Object.values(room.sessionState.cells).some(v => v === true) ||
                         room.sessionState.finalSolution === true;
      if (hadChanges) {
        room.sessionState = { cells: {}, finalSolution: false, finalOutcome: null };
        changed = true;
      }
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
      target: m.target
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
    // session scores moved -- refresh every client's player list.
    broadcastPlayersUpdate(room);

    if (result.newAward) {
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
  room.sessionState = { cells: {}, finalSolution: false, finalOutcome: null };
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
  broadcastPlayersUpdate(room);
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
// Declaring a column failed charges WOMF +1 -- it does NOT touch scoring,
// reveal state, or any other column/board mechanic.
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

  if (room.womf.failedColumns[column]) {
    sendToWs(ws, { type: 'error', message: `Column ${column} has already been declared failed for this board` });
    return;
  }

  if (room.chat.solvedTargets[column]) {
    sendToWs(ws, { type: 'error', message: `Column ${column} has already been solved` });
    return;
  }

  room.womf.failedColumns[column] = true;
  addWomfCharge(room, 1);
  room.revision++;

  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });

  console.log(`[ROOM ${room.code}] GM declared column ${column} FAILED (WOMF charge: ${room.womf.charge}/10)`);
}

// GM has finished showing the story/reveal sequence and is ready to reveal
// the point/penalty consequences to the whole room at once.
function handleRevealResults(ws) {
  const room = rooms.get(ws.roomCode?.toUpperCase());
  if (!room) return;
  if (ws !== room.hostConnection) {
    sendToWs(ws, { type: 'error', message: 'Only host can reveal results' });
    return;
  }
  if (!room.scoring.pendingResults) return; // nothing pending -- ignore silently, not an error

  broadcastToRoom(room, { type: 'score:finalResults', ...room.scoring.pendingResults });
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
      }, HOST_RECONNECT_GRACE_MS);
      console.log(`[ROOM ${ws.roomCode}] Host disconnected, grace period started`);
    }
  } else {
    const room = rooms.get(ws.roomCode);
    if (room) {
      room.players.delete(ws);
      broadcastPlayersUpdate(room);
      console.log(`[ROOM ${ws.roomCode}] Player left: ${ws.playerName}`);
    }
  }
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

function serveStaticFile(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = filePath.split('?')[0];

  if (filePath.startsWith('/games/')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden. Game data is served through the Gamemaster API.');
    return;
  }

  const fullPath = path.join(__dirname, filePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
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
    } catch (e) {
      console.error('WebSocket message error:', e);
      sendToWs(ws, { type: 'error', message: 'Malformed message' });
    }
  });

  ws.on('close', () => handleClose(ws));
  ws.on('error', (err) => console.error('WebSocket error:', err));
});

server.listen(PORT, '0.0.0.0', () => {
  const token = refreshGMToken();
  console.log(`ASOC Engine server running on http://0.0.0.0:${PORT}`);
  console.log(`Gamemaster: http://localhost:${PORT}`);
  console.log(`Player join: http://<LAN-IP>:${PORT}/join.html`);
  console.log(`GM token: ${token}`);
});