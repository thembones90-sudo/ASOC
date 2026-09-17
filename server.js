const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const gameStore = require('./game-store');

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
    sessionState: {
      cells: {},
      finalSolution: false
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
    ? { revealed: true, value: game.finalSolution }
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
    timestamp: new Date().toISOString()
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
        changed = true;
      }
      break;
    }
    case 'revealFinal': {
      if (room.sessionState.finalSolution !== true) {
        room.sessionState.finalSolution = true;
        changed = true;
      }
      break;
    }
    case 'hideFinal': {
      if (room.sessionState.finalSolution === true) {
        room.sessionState.finalSolution = false;
        changed = true;
      }
      break;
    }
    case 'resetBoard': {
      const hadChanges = Object.values(room.sessionState.cells).some(v => v === true) ||
                         room.sessionState.finalSolution === true;
      if (hadChanges) {
        room.sessionState = { cells: {}, finalSolution: false };
        changed = true;
      }
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

  message.verdict = verdict;
  message.target = target;

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
    }

    if (reveal) {
      if (target === 'FINAL') {
        if (room.sessionState.finalSolution !== true) {
          room.sessionState.finalSolution = true;
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

  if (verdict === 'wrong' && oldVerdict === 'correct' && oldTarget) {
    const solvedKey = oldTarget === 'FINAL' ? 'FINAL' : oldTarget;
    delete room.chat.solvedTargets[solvedKey];
  }

  if (changed) {
    room.revision++;
  }

  return { success: true, changed, revision: room.revision, message };
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
      connected: ws.readyState === 1
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
  room.sessionState = { cells: {}, finalSolution: false };
  room.currentBackground = game.background || gameStore.DEFAULT_BACKGROUND;
  room.chat = { messages: [], solvedTargets: {} };

  const publicState = getPublicState(room);
  broadcastToRoom(room, { type: 'state:public', ...publicState });
  broadcastChatUpdate(room);
  sendToWs(ws, { type: 'game:loaded', game });
  sendToWs(ws, { type: 'gm:switchGame:ack', gameId: game.id });

  console.log(`[ROOM ${room.code}] Game switched: ${game.title} (${game.id})`);
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