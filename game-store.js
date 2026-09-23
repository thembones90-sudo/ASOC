/*
 * ASOC ENGINE - Game Store
 *
 * Server-side filesystem module for the ASOC Game Library (THE FORGE).
 * All game/background file operations live here, never in client JS.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// BUNDLED directories are shipped with the app and are read-only at runtime.
const GAMES_DIR = path.join(__dirname, 'games');
const BACKGROUNDS_DIR = path.join(__dirname, 'assets', 'backgrounds');

// DURABLE overlay: when ASOC_DATA_DIR is set (Railway volume / ephemeral
// deployments), every WRITE and DELETE lands here and every READ prefers it,
// so a redeploy that replaces the bundled files can never lose games or
// uploaded backgrounds, and the bundled default files always keep working.
// Bundled files are never deleted or overwritten. When ASOC_DATA_DIR is
// unset (local dev) the durable dirs resolve to the same folders, keeping
// the historical single-tree behavior byte-for-byte.
const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const DURABLE_GAMES_DIR = path.join(DATA_DIR, 'games');
const DURABLE_BACKGROUNDS_DIR = path.join(DATA_DIR, 'assets', 'backgrounds');

const DEFAULT_BACKGROUND = 'assets/backgrounds/_default.svg';
const DIFFICULTY_VALUES = ['GREEN', 'YELLOW', 'AMBER', 'RED', 'PURPLE', 'BLACK'];
const ALLOWED_BACKGROUND_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;

function isUnder(root, candidate) {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  return c === r || c.startsWith(r + path.sep);
}

function ensureDirs() {
  if (!fs.existsSync(DURABLE_GAMES_DIR)) fs.mkdirSync(DURABLE_GAMES_DIR, { recursive: true });
  if (!fs.existsSync(DURABLE_BACKGROUNDS_DIR)) fs.mkdirSync(DURABLE_BACKGROUNDS_DIR, { recursive: true });
  if (DATA_DIR !== __dirname) {
    if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
    if (!fs.existsSync(BACKGROUNDS_DIR)) fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
  }
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

function readDirGameFiles(dir) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch (e) {
    return out;
  }
  for (const filename of names) {
    try {
      const full = path.join(dir, filename);
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      const stat = fs.statSync(full);
      const id = raw.id || (safeName(raw.title) + '-' + shortIdFrom(filename));
      out.push(metadataFrom(raw, id, filename, stat));
    } catch (e) {
      // Skip corrupt/unreadable files
    }
  }
  return out;
}

function listGameFiles() {
  ensureDirs();
  // Durable copies first: an overlay file shadows a same-id / same-filename
  // bundled file, so the listing never shows a stale bundled twin.
  const byId = new Map();
  const seenNames = new Set();
  for (const game of readDirGameFiles(DURABLE_GAMES_DIR)) {
    byId.set(game.id, game);
    seenNames.add(game.filename);
  }
  for (const game of readDirGameFiles(GAMES_DIR)) {
    if (byId.has(game.id) || seenNames.has(game.filename)) continue;
    byId.set(game.id, game);
  }
  return Array.from(byId.values());
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

function findGameIn(dir, gameId) {
  if (gameId.endsWith('.json')) {
    const p = safeResolve(dir, gameId);
    if (p && fs.existsSync(p)) return p;
  }

  const direct = path.join(dir, safeName(gameId) + '.json');
  if (fs.existsSync(direct)) return direct;

  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch (e) {
    return null;
  }
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const id = raw.id || (safeName(raw.title) + '-' + shortIdFrom(f));
      if (id === gameId) return path.join(dir, f);
    } catch (e) {}
  }
  return null;
}

function findGameFile(gameId) {
  ensureDirs();
  if (!gameId) return null;
  // Durable overlay shadows the bundled copy, never the other way around.
  return findGameIn(DURABLE_GAMES_DIR, gameId) || findGameIn(GAMES_DIR, gameId);
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
  while (fs.existsSync(path.join(DURABLE_GAMES_DIR, filename))) {
    if (prevFile && path.basename(prevFile) === filename) break;
    filename = `${base}-${counter}.json`;
    counter++;
  }

  const targetPath = path.join(DURABLE_GAMES_DIR, filename);
  fs.writeFileSync(targetPath, JSON.stringify(normalized, null, 2), 'utf8');

  if (prevFile && prevFile !== targetPath && isUnder(DURABLE_GAMES_DIR, prevFile)) {
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

  // The shipped sample is protected, but ONLY in its bundled home: a durable
  // SAMPLE copy (someone saved an edit) is just another overlay artifact and
  // may be deleted -- doing so un-shadows the bundled original.
  const isSampleName = gameId === 'sample-001' || path.basename(file) === 'sample-game.json';
  if (isSampleName && isUnder(GAMES_DIR, file)) {
    return { error: 'The sample game cannot be deleted.' };
  }

  // Deletion only ever touches the durable overlay -- a bundled game file is
  // read-only and can never be removed.
  const durableFile = findGameIn(DURABLE_GAMES_DIR, gameId);
  if (!durableFile) {
    return { error: 'Bundled games are read-only; only a locally-created copy can be deleted.' };
  }

  fs.unlinkSync(durableFile);
  return { success: true };
}

function readDirBackgrounds(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir)
      .filter(f => ALLOWED_BACKGROUND_EXTS.includes(path.extname(f).toLowerCase()))
      .sort();
  } catch (e) {
    return [];
  }
  return names.map(filename => ({ filename, path: `assets/backgrounds/${filename}` }));
}

function listBackgrounds() {
  ensureDirs();
  // Durable uploads shadow bundled files of the same name.
  const byName = new Map();
  for (const bg of readDirBackgrounds(DURABLE_BACKGROUNDS_DIR)) byName.set(bg.filename, bg);
  for (const bg of readDirBackgrounds(BACKGROUNDS_DIR)) if (!byName.has(bg.filename)) byName.set(bg.filename, bg);
  return Array.from(byName.values());
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
  while (fs.existsSync(path.join(DURABLE_BACKGROUNDS_DIR, name))) {
    name = `${base}-${counter}${ext}`;
    counter++;
  }

  const target = safeResolve(DURABLE_BACKGROUNDS_DIR, name);
  if (!target) return { error: 'Invalid filename.' };

  fs.writeFileSync(target, buffer);
  return { filename: name, path: `assets/backgrounds/${name}` };
}

/*
 * Excel import — ASOC FOREVER SHEET format.
 *
 * Historical ASOC convention (confirmed against the real reference workbook):
 *   A1:D4 = four clues per column, in reveal-priority order (row 1 = hardest,
 *           row 4 = easiest) — this is transcribed as-is into `clues[]`,
 *           never reordered, so it stays compatible with both the current
 *           coordinate-based board AND the locked (not yet built) Progressive
 *           Clue Queue, which reads that same array as a reveal queue.
 *   A5:D5 = the four column solutions.
 *   A6:D6 = exactly ONE populated cell anywhere in the row = the final
 *           solution. Which of the four columns it sits under is not
 *           meaningful and is not fixed to any one coordinate.
 *
 * This function only transcribes and validates — it never invents, sorts, or
 * rearranges content the workbook didn't contain.
 */
function importXlsxCellText(sheet, col, row) {
  const coord = `${col}${row}`;
  const cell = sheet.getCell(coord);
  let raw = cell.value;
  let usedFormula = false;
  let formulaError = null;

  if (raw && typeof raw === 'object' && !(raw instanceof Date)) {
    if (Array.isArray(raw.richText)) {
      raw = raw.richText.map(rt => rt.text).join('');
    } else if ('result' in raw || 'formula' in raw || 'sharedFormula' in raw) {
      usedFormula = true;
      if (raw.error) {
        formulaError = raw.error;
        raw = '';
      } else {
        raw = raw.result;
      }
    } else if (raw.text !== undefined) {
      raw = raw.text;
    } else if (raw.hyperlink !== undefined) {
      raw = raw.text || raw.hyperlink;
    } else {
      raw = '';
    }
  }

  const text = (raw === null || raw === undefined) ? '' : String(raw).trim();
  return { text, usedFormula, formulaError, coord };
}

function deriveTitleFromFilename(filename) {
  if (!filename) return '';
  const base = String(filename).replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned;
}

async function importXlsx(buffer, sourceFilename) {
  const errors = [];
  const warnings = [];

  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch (e) {
    return { errors: ['Could not read this file as an Excel workbook (.xlsx). ' + e.message] };
  }

  if (!workbook.worksheets.length) {
    return { errors: ['The workbook contains no worksheets.'] };
  }

  const sheetsWithData = workbook.worksheets.filter(ws => ws.actualRowCount > 0 && ws.actualColumnCount > 0);
  let sheet;

  // Official ASOC workbooks may include a README/instructions tab alongside
  // the actual board. When an explicit "ASOC GAME" sheet exists, it is the
  // authoritative import target and every other sheet is metadata only.
  // This keeps the importer strict for genuinely ambiguous multi-board files
  // while allowing the template we actually hand to humans to import cleanly.
  const namedBoardSheet = workbook.worksheets.find(ws =>
    String(ws.name || '').trim().toUpperCase() === 'ASOC GAME'
  );

  if (namedBoardSheet && namedBoardSheet.actualRowCount > 0 && namedBoardSheet.actualColumnCount > 0) {
    sheet = namedBoardSheet;
    const ignored = workbook.worksheets.filter(ws => ws !== sheet && ws.actualRowCount > 0 && ws.actualColumnCount > 0);
    if (ignored.length) {
      warnings.push(`Using sheet "${sheet.name}"; ignored auxiliary sheet${ignored.length === 1 ? '' : 's'}: ${ignored.map(ws => ws.name).join(', ')}.`);
    }
  } else if (sheetsWithData.length > 1) {
    return { errors: [`Workbook contains multiple sheets with data (${sheetsWithData.map(w => w.name).join(', ')}). Name the board sheet "ASOC GAME" or keep only one data sheet.`] };
  } else if (sheetsWithData.length === 1) {
    sheet = sheetsWithData[0];
    if (workbook.worksheets.length > 1) {
      warnings.push(`Using sheet "${sheet.name}" (${workbook.worksheets.length - 1} other empty sheet(s) were ignored).`);
    }
  } else {
    sheet = workbook.worksheets[0];
  }

  // Stray data outside the expected A1:D6 board.
  const strayCells = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (rowNumber > 6 || colNumber > 4 || colNumber < 1) {
        const { text } = importXlsxCellText(sheet, cell.address.replace(/[0-9]+$/, ''), rowNumber);
        if (text) strayCells.push(cell.address);
      }
    });
  });
  if (strayCells.length) {
    const shown = strayCells.slice(0, 5).join(', ') + (strayCells.length > 5 ? ', …' : '');
    warnings.push(`Data found outside the expected A1:D6 range (${shown}) was ignored.`);
  }

  const colKeys = ['A', 'B', 'C', 'D'];
  const columns = {};
  const formulaCells = [];
  const formulaErrorCells = [];

  colKeys.forEach(col => {
    const clues = [];
    for (let r = 1; r <= 4; r++) {
      const info = importXlsxCellText(sheet, col, r);
      if (info.formulaError) formulaErrorCells.push(`${info.coord} (${info.formulaError})`);
      else if (info.usedFormula) formulaCells.push(info.coord);
      clues.push(info.text);
    }

    const solutionInfo = importXlsxCellText(sheet, col, 5);
    if (solutionInfo.formulaError) formulaErrorCells.push(`${solutionInfo.coord} (${solutionInfo.formulaError})`);
    else if (solutionInfo.usedFormula) formulaCells.push(solutionInfo.coord);

    const filledCount = clues.filter(Boolean).length;
    if (filledCount === 0) {
      errors.push(`Column ${col} has no clues. Expected 4 clues in ${col}1:${col}4.`);
    } else if (filledCount < 4) {
      errors.push(`Column ${col} contains only ${filledCount} clue${filledCount === 1 ? '' : 's'}. Expected 4 clues in ${col}1:${col}4.`);
    }

    if (!solutionInfo.text) {
      errors.push(`Column ${col} solution is empty (${col}5).`);
    }

    columns[col] = { clues, solution: solutionInfo.text };
  });

  const finalCandidates = [];
  colKeys.forEach(col => {
    const info = importXlsxCellText(sheet, col, 6);
    if (info.formulaError) formulaErrorCells.push(`${info.coord} (${info.formulaError})`);
    if (info.text) finalCandidates.push(info);
  });

  let finalSolution = '';
  if (finalCandidates.length === 0) {
    errors.push('No final solution found. Expected exactly one populated cell in A6:D6.');
  } else if (finalCandidates.length > 1) {
    errors.push(`Multiple final solutions found (${finalCandidates.map(c => c.coord).join(' and ')}). Only one cell in row 6 may contain a value.`);
  } else {
    finalSolution = finalCandidates[0].text;
    if (finalCandidates[0].usedFormula) formulaCells.push(finalCandidates[0].coord);
  }

  if (formulaCells.length) {
    warnings.push(`${formulaCells.length === 1 ? 'Cell' : 'Cells'} ${formulaCells.join(', ')} contained a formula; using the last calculated value.`);
  }
  if (formulaErrorCells.length) {
    warnings.push(`${formulaErrorCells.length === 1 ? 'Cell' : 'Cells'} ${formulaErrorCells.join(', ')} contained a formula error and were treated as empty.`);
  }

  // Duplicate words across clues/solutions are legitimate puzzle design —
  // never flagged, never deduped.

  if (errors.length) return { errors };

  const game = {
    id: generateGameId(),
    title: deriveTitleFromFilename(sourceFilename),
    theme: '',
    background: DEFAULT_BACKGROUND,
    difficulty: 'GREEN',
    columns,
    finalSolution,
    story: '',
    gmNotes: '',
    hints: [],
    created: today(),
    modified: nowISO()
  };

  return { game, warnings };
}

module.exports = {
  GAMES_DIR,
  BACKGROUNDS_DIR,
  DATA_DIR,
  DURABLE_GAMES_DIR,
  DURABLE_BACKGROUNDS_DIR,
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
  importXlsx,
  validateGame,
  findGameFile,
  safeName,
  safeResolve,
  MAX_BACKGROUND_BYTES
};