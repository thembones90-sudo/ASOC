/*
 * ASOC ENGINE - Game Store
 *
 * Server-side filesystem module for the ASOC Game Library (THE FORGE).
 * All game/background file operations live here, never in client JS.
 */

const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, 'games');
const BACKGROUNDS_DIR = path.join(__dirname, 'assets', 'backgrounds');

const DEFAULT_BACKGROUND = 'assets/backgrounds/_default.svg';
const DIFFICULTY_VALUES = ['GREEN', 'YELLOW', 'RED', 'PURPLE', 'BLACK'];
const ALLOWED_BACKGROUND_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;

function ensureDirs() {
  if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
  if (!fs.existsSync(BACKGROUNDS_DIR)) fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
}

function generateGameId() {
  return 'asoc-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
}

function shortIdFrom(id) {
  return String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase() || 'game';
}

function safeName(input, fallback = 'game') {
  const fn = String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return fn || fallback;
}

function safeResolve(baseDir, filename) {
  const clean = String(filename || '').replace(/\\/g, '/').split('/').pop().split('?')[0];
  if (!clean || clean === '.' || clean === '..' || clean.indexOf('..') !== -1) return null;
  const resolved = path.resolve(baseDir, clean);
  if (!resolved.startsWith(path.resolve(baseDir))) return null;
  return resolved;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function nowISO() {
  return new Date().toISOString();
}

function listGameFiles() {
  ensureDirs();
  const names = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  const games = [];
  for (const filename of names) {
    try {
      const full = path.join(GAMES_DIR, filename);
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      const stat = fs.statSync(full);
      const id = raw.id || (safeName(raw.title) + '-' + shortIdFrom(filename));
      games.push(metadataFrom(raw, id, filename, stat));
    } catch (e) {
      // Skip corrupt/unreadable files
    }
  }
  return games;
}

function metadataFrom(raw, id, filename, stat) {
  return {
    id,
    filename,
    title: raw.title || 'Untitled Game',
    theme: raw.theme || '',
    difficulty: DIFFICULTY_VALUES.includes(raw.difficulty) ? raw.difficulty : 'GREEN',
    background: raw.background || DEFAULT_BACKGROUND,
    finalSolution: raw.finalSolution || raw.final_solution || '',
    story: raw.story || '',
    gmNotes: raw.gmNotes || raw.gm_notes || '',
    hints: Array.isArray(raw.hints) ? raw.hints : [],
    created: raw.created || (stat ? stat.birthtime.toISOString().split('T')[0] : '') || today(),
    modified: raw.modified || (stat ? stat.mtime.toISOString() : '') || nowISO(),
    isSample: id === 'sample-001'
  };
}

function findGameFile(gameId) {
  ensureDirs();
  if (!gameId) return null;

  if (gameId.endsWith('.json')) {
    const p = safeResolve(GAMES_DIR, gameId);
    if (p && fs.existsSync(p)) return p;
  }

  const direct = path.join(GAMES_DIR, safeName(gameId) + '.json');
  if (fs.existsSync(direct)) return direct;

  const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'));
      const id = raw.id || (safeName(raw.title) + '-' + shortIdFrom(f));
      if (id === gameId) return path.join(GAMES_DIR, f);
    } catch (e) {}
  }
  return null;
}

function readGame(gameId) {
  const file = findGameFile(gameId);
  if (!file) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const stat = fs.statSync(file);
    const id = raw.id || (safeName(raw.title) + '-' + shortIdFrom(path.basename(file)));
    return { ...metadataFrom(raw, id, path.basename(file), stat), ...normalizeGame(raw, id) };
  } catch (e) {
    return null;
  }
}

function normalizeGame(raw, id) {
  const normalized = {
    id: id || raw.id || generateGameId(),
    title: raw.title || 'Untitled Game',
    theme: raw.theme || '',
    background: raw.background || DEFAULT_BACKGROUND,
    difficulty: DIFFICULTY_VALUES.includes(raw.difficulty) ? raw.difficulty : 'GREEN',
    columns: {},
    finalSolution: raw.finalSolution || raw.final_solution || '',
    story: raw.story || '',
    gmNotes: raw.gmNotes || raw.gm_notes || '',
    hints: Array.isArray(raw.hints) ? raw.hints.map(String).filter(Boolean) : [],
    created: raw.created || today(),
    modified: raw.modified || nowISO()
  };

  const colKeys = ['A', 'B', 'C', 'D'];
  colKeys.forEach(key => {
    const colData = raw.columns?.[key] || raw[key] || {};
    const clues = Array.isArray(colData.clues)
      ? colData.clues.slice(0, 4).map(c => String(c || ''))
      : ['', '', '', ''];
    if (clues.length < 4) {
      while (clues.length < 4) clues.push('');
    }
    normalized.columns[key] = {
      clues,
      solution: String(colData.solution || '')
    };
  });

  return normalized;
}

function validateGame(game) {
  const errors = [];
  const title = String(game?.title || '').trim();
  const difficulty = String(game?.difficulty || '').toUpperCase();
  const finalSolution = String(game?.finalSolution || game?.final_solution || '').trim();

  if (!title) errors.push('Title is empty.');
  else if (title.length > 80) errors.push('Title is too long (max 80 characters).');

  if (!DIFFICULTY_VALUES.includes(difficulty)) {
    errors.push('Difficulty must be one of: ' + DIFFICULTY_VALUES.join(', ') + '.');
  }

  const colKeys = ['A', 'B', 'C', 'D'];
  colKeys.forEach(col => {
    const colData = game?.columns?.[col] || game?.[col] || {};
    for (let r = 1; r <= 4; r++) {
      const v = Array.isArray(colData.clues) ? colData.clues[r - 1] : colData[`clue${r}`];
      if (!v || !String(v).trim()) errors.push(`${col}${r} is empty.`);
    }
    const sol = colData.solution;
    if (!sol || !String(sol).trim()) errors.push(`Column ${col} solution is empty.`);
  });

  if (!finalSolution) errors.push('Final Solution is empty.');

  return errors;
}

function saveGame(game) {
  ensureDirs();

  const errors = validateGame(game);
  if (errors.length) return { errors };

  const prevFile = findGameFile(game.id);

  const now = nowISO();
  const created = String(game.created || today()).slice(0, 10);
  const normalized = normalizeGame({ ...game, created, modified: now }, game.id || generateGameId());

  const base = safeName(normalized.title, 'game');
  let filename = base + '.json';
  let counter = 2;
  while (fs.existsSync(path.join(GAMES_DIR, filename))) {
    if (prevFile && path.basename(prevFile) === filename) break;
    filename = `${base}-${counter}.json`;
    counter++;
  }

  const targetPath = path.join(GAMES_DIR, filename);
  fs.writeFileSync(targetPath, JSON.stringify(normalized, null, 2), 'utf8');

  if (prevFile && prevFile !== targetPath) {
    try { fs.unlinkSync(prevFile); } catch (e) {}
  }

  const stat = fs.statSync(targetPath);
  return {
    game: metadataFrom(normalized, normalized.id, filename, stat),
    filename
  };
}

function duplicateGame(gameId) {
  const src = readGame(gameId);
  if (!src) return { error: 'Game not found' };

  const copy = { ...src };
  copy.id = generateGameId();
  copy.title = src.title + ' COPY';
  copy.created = today();
  copy.modified = nowISO();

  const result = saveGame(copy);
  if (result.errors) return { error: result.errors.join(' ') };
  return { game: result.game };
}

function deleteGame(gameId) {
  const file = findGameFile(gameId);
  if (!file) return { error: 'Game not found' };

  if (gameId === 'sample-001' || path.basename(file) === 'sample-game.json') {
    return { error: 'The sample game cannot be deleted.' };
  }

  fs.unlinkSync(file);
  return { success: true };
}

function listBackgrounds() {
  ensureDirs();
  const names = fs.readdirSync(BACKGROUNDS_DIR)
    .filter(f => ALLOWED_BACKGROUND_EXTS.includes(path.extname(f).toLowerCase()))
    .sort();
  return names.map(filename => ({
    filename,
    path: `assets/backgrounds/${filename}`
  }));
}

function saveBackgroundUpload(filename, buffer) {
  ensureDirs();
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!ALLOWED_BACKGROUND_EXTS.includes(ext)) {
    return { error: 'Unsupported file type. Allowed: PNG, JPG, JPEG, WEBP, SVG.' };
  }
  if (!buffer || buffer.length === 0) return { error: 'Empty file received.' };
  if (buffer.length > MAX_BACKGROUND_BYTES) {
    return { error: 'File too large (max 10 MB).' };
  }

  const base = safeName(path.basename(String(filename || ''), ext), 'background');
  let name = base + ext;
  let counter = 2;
  while (fs.existsSync(path.join(BACKGROUNDS_DIR, name))) {
    name = `${base}-${counter}${ext}`;
    counter++;
  }

  const target = safeResolve(BACKGROUNDS_DIR, name);
  if (!target) return { error: 'Invalid filename.' };

  fs.writeFileSync(target, buffer);
  return { filename: name, path: `assets/backgrounds/${name}` };
}

module.exports = {
  GAMES_DIR,
  BACKGROUNDS_DIR,
  DEFAULT_BACKGROUND,
  DIFFICULTY_VALUES,
  generateGameId,
  readGame,
  listGameFiles,
  saveGame,
  duplicateGame,
  deleteGame,
  listBackgrounds,
  saveBackgroundUpload,
  validateGame,
  findGameFile,
  safeName,
  safeResolve,
  MAX_BACKGROUND_BYTES
};