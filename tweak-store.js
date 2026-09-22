const fs = require('fs');
const path = require('path');
const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const TWEAKS_FILE = process.env.ASOC_TWEAKS_FILE
  ? path.resolve(process.env.ASOC_TWEAKS_FILE)
  : path.join(DATA_DIR, 'tweaks.json');

const TYPES = new Set(['BUG', 'IDEA', 'VISUAL', 'QOL']);
const STATUSES = new Set(['NEW', 'REVIEWED', 'APPROVED', 'IN_PROGRESS', 'FIXED', 'DECLINED', 'DUPLICATE']);
const CLOSED = new Set(['FIXED', 'DECLINED', 'DUPLICATE']);
const FORMAT = 'asoc-tweaks';
const VERSION = 1;
const MAX_OPEN_PER_PLAYER = 5;

let healthy = true;
let state = { format: FORMAT, version: VERSION, nextId: 1, tweaks: [] };

function cleanText(value, limit) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanDescription(value, limit) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\r/g, '').trim().slice(0, limit);
}

function safeContext(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  const limits = {
    mode: 32, location: 64, theme: 48, gameId: 96, gameTitle: 120,
    roomState: 32, timer: 32, viewport: 32, client: 220, build: 80, path: 120
  };
  for (const [key, limit] of Object.entries(limits)) {
    const value = cleanText(src[key], limit);
    if (value) out[key] = value;
  }
  return out;
}

function save() {
  if (!healthy) throw new Error('TWEAKS storage unavailable');
  const dir = path.dirname(TWEAKS_FILE);
  const tmp = TWEAKS_FILE + '.tmp-' + process.pid + '-' + Date.now();
  let fd;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(state, null, 2), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, TWEAKS_FILE);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    healthy = false;
    throw error;
  }
}

function load() {
  if (!fs.existsSync(TWEAKS_FILE)) {
    try { save(); } catch (error) { healthy = false; console.error('[tweaks] Could not initialize store:', error.message); }
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(TWEAKS_FILE, 'utf8'));
    if (!parsed || parsed.format !== FORMAT || parsed.version !== VERSION || !Array.isArray(parsed.tweaks)) {
      throw new Error('unsupported or malformed TWEAKS store');
    }
    state = {
      format: FORMAT,
      version: VERSION,
      nextId: Math.max(1, Number(parsed.nextId) || 1),
      tweaks: parsed.tweaks.filter(item => item && typeof item === 'object')
    };
  } catch (error) {
    healthy = false;
    console.error('[tweaks] Store requires repair; preserving file untouched:', error.message);
  }
}
load();

function makeId() {
  const n = state.nextId++;
  return 'TWK-' + String(n).padStart(4, '0');
}

function openCount(playerId) {
  return state.tweaks.filter(t => t.playerId === playerId && !CLOSED.has(t.status)).length;
}

function submit(player, payload = {}) {
  if (!healthy) throw new Error('TWEAKS storage unavailable');
  const playerId = cleanText(player?.id, 120);
  const playerName = cleanText(player?.name, 40);
  if (!playerId || !playerName) throw new Error('Player identity required');
  if (openCount(playerId) >= MAX_OPEN_PER_PLAYER) throw new Error('Maximum 5 open TWEAKS reached');

  const type = cleanText(payload.type, 16).toUpperCase();
  if (!TYPES.has(type)) throw new Error('Invalid TWEAK type');
  const title = cleanText(payload.title, 80);
  const description = cleanDescription(payload.description, 2400);
  if (!title) throw new Error('Title is required');
  if (!description) throw new Error('Description is required');

  const now = Date.now();
  const reproducibilityRaw = cleanText(payload.reproducibility, 16).toUpperCase();
  const reproducibility = ['YES', 'NO', 'SOMETIMES'].includes(reproducibilityRaw) ? reproducibilityRaw : '';
  const evidenceUrl = cleanText(payload.evidenceUrl, 260);
  if (evidenceUrl && !/^\/uploads\/chat\/tweak-[a-f0-9]{32}\.(?:png|jpg|webp|gif)$/i.test(evidenceUrl)) {
    throw new Error('Invalid evidence attachment');
  }

  const tweak = {
    id: makeId(),
    playerId,
    playerName,
    type,
    title,
    description,
    expected: cleanDescription(payload.expected, 1400),
    reproducibility,
    evidenceUrl,
    context: safeContext(payload.context),
    status: 'NEW',
    gmReply: '',
    duplicateOf: '',
    createdAt: now,
    updatedAt: now,
    history: [{ status: 'NEW', at: now }]
  };
  state.tweaks.push(tweak);
  save();
  return { ...tweak };
}

function listForPlayer(playerId) {
  const id = cleanText(playerId, 120);
  return state.tweaks
    .filter(t => t.playerId === id)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .slice(0, 50)
    .map(t => ({ ...t, history: undefined }));
}

function listAll() {
  return state.tweaks
    .slice()
    .sort((a, b) => {
      const aClosed = CLOSED.has(a.status) ? 1 : 0;
      const bClosed = CLOSED.has(b.status) ? 1 : 0;
      return aClosed - bClosed || Number(b.updatedAt) - Number(a.updatedAt);
    })
    .map(t => ({ ...t }));
}

function update(idValue, patch = {}) {
  if (!healthy) throw new Error('TWEAKS storage unavailable');
  const id = cleanText(idValue, 32).toUpperCase();
  const tweak = state.tweaks.find(item => item.id === id);
  if (!tweak) return null;

  if (patch.status != null) {
    const status = cleanText(patch.status, 32).toUpperCase();
    if (!STATUSES.has(status)) throw new Error('Invalid TWEAK status');
    if (status !== tweak.status) {
      tweak.status = status;
      tweak.history ||= [];
      tweak.history.push({ status, at: Date.now() });
      if (tweak.history.length > 30) tweak.history = tweak.history.slice(-30);
    }
  }
  if (patch.gmReply != null) tweak.gmReply = cleanDescription(patch.gmReply, 700);
  if (patch.duplicateOf != null) {
    const duplicateOf = cleanText(patch.duplicateOf, 32).toUpperCase();
    if (duplicateOf && !/^TWK-\d{4,}$/.test(duplicateOf)) throw new Error('Invalid duplicate reference');
    tweak.duplicateOf = duplicateOf;
  }
  tweak.updatedAt = Date.now();
  save();
  return { ...tweak };
}

module.exports = {
  TYPES,
  STATUSES,
  MAX_OPEN_PER_PLAYER,
  storageHealthy: () => healthy,
  submit,
  listForPlayer,
  listAll,
  update
};
