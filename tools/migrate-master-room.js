#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL_NAME = 'migrate-master-room';
const TOOL_VERSION = '1.0.0';
const STORE_VERSION = 2;
const STORE_FORMAT = 'asoc-recovery-store';
const ARCHIVE_VERSION = 1;
const ARCHIVE_FORMAT = 'asoc-migration-archive';
const MASTER_CODE = 'MASTER';

function printHelp(stream) {
  const out = stream || process.stdout;
  out.write(`Usage: node tools/${TOOL_NAME}.js --input <file> --output <file> [options]

One-time migration from a legacy active-rooms store (version 1) to the
hardened recovery-store schema (version 2). Exactly one legacy room is
promoted to the canonical code "${MASTER_CODE}"; every legacy room is
preserved verbatim in a separate migration archive so no room silently
disappears.

Required:
  --input <path>    Legacy active-rooms JSON (version 1) to read.
  --output <path>   Recovery-store v2 file to write (MASTER only).

Options:
  --archive <path>  Migration archive v1 file with EVERY legacy room
                    verbatim plus a "reason" field. Skipped if omitted.
  --pick <rule>     Which room becomes ${MASTER_CODE}:
                      richest  highest conservation value (default)
                      newest   newest createdAt
                      oldest   oldest createdAt
                      code:XXX exact legacy room code
  --force           Allow overwriting an existing --output / --archive.
  --help            Show this help.

Conservation value: players*10 + chatMessages*3 + scoringPlayers*5 +
solvedTargets*5 + pendingTribute*5 + bloodTributes*2 (ties: newest).

Fail-closed guarantees:
  - Refuses to overwrite --input, or to write when --output exists
    (unless --force).
  - Refuses when a "${MASTER_CODE}" room already exists in --input.
  - Writes via temp file + atomic rename on the same volume.
  - Keeps chat on the promoted room non-adjudicable (boardId stays null,
    migratedAs "archival") so historical transmissions can never be
    judged against a future board.
  - Input must contain at least one room.
`);
}

function parseArgs(argv) {
  const opts = { input: null, output: null, archive: null, pick: 'richest', help: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help': opts.help = true; break;
      case '--force': opts.force = true; break;
      case '--input': opts.input = argv[++i]; break;
      case '--output': opts.output = argv[++i]; break;
      case '--archive': opts.archive = argv[++i]; break;
      case '--pick': opts.pick = argv[++i]; break;
      default:
        console.error(`Unknown option: ${arg}`);
        printHelp(process.stderr);
        process.exit(2);
    }
  }
  return opts;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(path.resolve(filePath));
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(tmp, filePath);
}

function conservationValue(room) {
  const chat = room.chat && Array.isArray(room.chat.messages) ? room.chat.messages.length : 0;
  const players = room.players && Array.isArray(room.players) ? room.players.length : 0;
  const scoringPlayers = room.scoring && room.scoring.players ? Object.keys(room.scoring.players).length : 0;
  const solvedTargets = room.chat && room.chat.solvedTargets ? Object.keys(room.chat.solvedTargets).length : 0;
  const tribute = room.pendingTribute && room.pendingTribute.status === 'required' ? 5 : 0;
  const tributes = room.bloodTributes && Array.isArray(room.bloodTributes) ? Math.min(room.bloodTributes.length, 3) : 0;
  return players * 10 + chat * 3 + scoringPlayers * 5 + solvedTargets * 5 + tribute + tributes * 2;
}

function selectRoom(rooms, rule) {
  let selected;
  if (typeof rule === 'string' && rule.startsWith('code:')) {
    const code = rule.slice(5).toUpperCase();
    selected = rooms.filter(r => r.code && r.code.toUpperCase() === code);
    if (selected.length === 0) {
      throw new Error(`--pick code:${code}: no room with that code in the input store`);
    }
    if (selected.length > 1) {
      throw new Error(`--pick code:${code}: duplicate legacy codes found; cannot disambiguate deterministically`);
    }
    return { room: selected[0], rule: rule, score: conservationValue(selected[0]) };
  }
  const scored = rooms.map(r => ({ room: r, score: conservationValue(r) }));
  scored.sort((a, b) => {
    if (rule === 'oldest') {
      if (a.room.createdAt !== b.room.createdAt) return a.room.createdAt - b.room.createdAt;
    } else if (rule === 'newest') {
      if (a.room.createdAt !== b.room.createdAt) return b.room.createdAt - a.room.createdAt;
    } else {
      if (a.score !== b.score) return b.score - a.score;
      if (a.room.createdAt !== b.room.createdAt) return b.room.createdAt - a.room.createdAt;
    }
    return String(a.room.code).localeCompare(String(b.room.code));
  });
  return { room: scored[0].room, rule: rule, score: scored[0].score };
}

function convertRoomToMaster(legacyRoom) {
  const room = JSON.parse(JSON.stringify(legacyRoom));
  room.code = MASTER_CODE;
  if (typeof room.armed !== 'boolean') {
    room.armed = false;
  }
  if (!room.chat) room.chat = { messages: [], solvedTargets: {} };
  if (!Array.isArray(room.chat.messages)) room.chat.messages = [];
  let archival = 0;
  room.chat.messages.forEach(msg => {
    const safe = msg && msg.boardId === room.boardId && !msg.source && msg.migratedAs !== 'archival';
    if (!safe) {
      msg.boardId = null;
      msg.migratedAs = 'archival';
      archival++;
    }
    if (!msg.reactions || typeof msg.reactions !== 'object') {
      msg.reactions = {};
    }
  });
  if (!room.chat.solvedTargets || typeof room.chat.solvedTargets !== 'object') {
    room.chat.solvedTargets = {};
  }
  return { room, archivalChat: archival };
}

function run(opts) {
  if (!opts.input || !opts.output) {
    console.error('Missing required options: --input and --output are both required.');
    printHelp(process.stderr);
    process.exit(2);
  }

  const inputPath = path.resolve(opts.input);
  const outputPath = path.resolve(opts.output);
  const archivePath = opts.archive ? path.resolve(opts.archive) : null;

  if (inputPath === outputPath || (archivePath && inputPath === archivePath)) {
    console.error('Fail-closed: --input must never be overwritten; point --output/--archive elsewhere.');
    process.exit(3);
  }
  if (fs.existsSync(outputPath) && !opts.force) {
    console.error(`Fail-closed: --output already exists (${outputPath}). Re-run with --force to overwrite.`);
    process.exit(3);
  }
  if (archivePath && fs.existsSync(archivePath) && !opts.force) {
    console.error(`Fail-closed: --archive already exists (${archivePath}). Re-run with --force to overwrite.`);
    process.exit(3);
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`Input store not found: ${inputPath}`);
    process.exit(3);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (error) {
    console.error(`Input store is not valid JSON: ${error.message}`);
    process.exit(3);
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rooms) || payload.rooms.length < 1) {
    console.error('Input store has no valid "rooms" array with at least one room.');
    process.exit(3);
  }

  const hasMaster = payload.rooms.some(r => r.code && r.code.toUpperCase() === MASTER_CODE);
  if (hasMaster) {
    console.error(`Fail-closed: input already contains a ${MASTER_CODE} room; refusing to run twice.`);
    process.exit(3);
  }

  const inputSha256 = sha256File(inputPath);
  const migratedAt = Date.now();
  const selection = selectRoom(payload.rooms, opts.pick);
  const selectedIndex = payload.rooms.indexOf(selection.room);
  const { room, archivalChat } = convertRoomToMaster(selection.room);

  const migrationBlock = {
    tool: `${TOOL_NAME}@${TOOL_VERSION}`,
    rule: selection.rule,
    selectedCode: selection.room.code,
    selectedConservationValue: selection.score,
    selectedIndex,
    totalRooms: payload.rooms.length,
    archivalChatMarked: archivalChat,
    archivedRoomCodes: payload.rooms.map(r => r.code).filter(c => c !== selection.room.code),
    migratedAt,
    inputFile: inputPath,
    inputSha256
  };

  const outputStore = {
    format: STORE_FORMAT,
    version: STORE_VERSION,
    savedAt: migratedAt,
    migration: migrationBlock,
    rooms: [room]
  };
  atomicWriteJson(outputPath, outputStore);
  console.log(`Wrote recovery store v${STORE_VERSION}: ${outputPath}`);
  console.log(`  promoted: legacy ${selection.room.code} -> ${MASTER_CODE}`);
  console.log(`  conservation value: ${selection.score}; archival chat marked: ${archivalChat}`);

  if (archivePath) {
    const archive = {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      savedAt: migratedAt,
      migration: {
        tool: `${TOOL_NAME}@${TOOL_VERSION}`,
        rule: selection.rule,
        selectedCode: selection.room.code,
        migratedAt,
        inputFile: inputPath,
        inputSha256
      },
      legacyRooms: payload.rooms.map((r, i) => ({
        reason: i === selectedIndex ? 'selected' : 'archived',
        room: r
      }))
    };
    atomicWriteJson(archivePath, archive);
    console.log(`Wrote migration archive v${ARCHIVE_VERSION}: ${archivePath}`);
  }

  console.log('Migration complete. Every legacy room is preserved in the archive; the live store was not touched.');
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  printHelp(process.stdout);
  process.exit(0);
}
try {
  run(opts);
} catch (error) {
  console.error(`Migration failed (fail-closed): ${error.message}`);
  process.exit(3);
}