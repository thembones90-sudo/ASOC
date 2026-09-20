const io = require('./durable-io');
const fs = io.fs;
const path = require('path');
const crypto = require('crypto');
const file = process.env.ASOC_PLAYER_AUTH_SESSIONS_FILE
  ? path.resolve(process.env.ASOC_PLAYER_AUTH_SESSIONS_FILE)
  : path.join(process.env.ASOC_DATA_DIR || __dirname, '.player-auth-sessions.json');
let healthy = true;
function validate(value) {
  const records = value?.sessions || value;
  if (!records || typeof records !== 'object' || Array.isArray(records)) throw Error('Invalid sessions');
  for (const [key, record] of Object.entries(records)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !record || typeof record.playerId !== 'string' || !record.playerId) throw Error('Invalid session');
  }
  return records;
}
function read(name) { return validate(JSON.parse(fs.readFileSync(name, 'utf8'))); }
function load() {
  try { const records = read(file); healthy = true; return new Map(Object.entries(records)); }
  catch (error) {
    try {
      if (error.code && error.code !== 'ENOENT') throw error;
      let backup;
      try { backup = read(file + '.bak'); }
      catch (backupError) {
        if (error.code === 'ENOENT' && backupError.code === 'ENOENT') { healthy = true; return new Map(); }
        throw backupError;
      }
      if (error.code !== 'ENOENT') fs.renameSync(file, file + '.corrupt-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
      io.writeJson(file, { sessions: backup });
      healthy = true;
      return new Map(Object.entries(backup));
    } catch {
      healthy = false;
      throw Error('Player session storage unavailable');
    }
  }
}
function save(sessions) {
  if (!healthy) throw Error('Player session storage unavailable');
  try {
    const value = { sessions: validate(Object.fromEntries(sessions)) };
    let previous;
    try { previous = { sessions: read(file) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    io.writeJson(file + '.bak', previous || value);
    io.writeJson(file, value);
    return true;
  } catch {
    healthy = false;
    throw Error('Player session storage unavailable');
  }
}
module.exports = { load, save, isHealthy() { try { load(); return healthy; } catch { return false; } } };
