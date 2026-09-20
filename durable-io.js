// Durable JSON writes + single-process write-ahead transactions.
// A committed journal is replayed before any store opens, so authoritative
// room state and persistent player/match totals recover together after a crash.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const journal = path.join(root, '.runtime-transaction.json');
const testFailureTrigger = process.env.NODE_ENV === 'test'
  ? String(process.env.ASOC_TEST_DURABILITY_FAIL_TRIGGER || '')
  : '';

let pending = null;
let failed = false;
let failureHandler = null;

function syncDirectory(dir) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function injectedFailure() {
  if (!testFailureTrigger || !fs.existsSync(testFailureTrigger)) return;
  const error = new Error('Injected durable storage failure');
  error.code = 'EIO';
  throw error;
}

function atomic(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
  let fd;
  try {
    injectedFailure();
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, value, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, target);
    syncDirectory(path.dirname(target));
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function markFailed(error) {
  if (failed) return;
  failed = true;
  if (failureHandler) {
    try { failureHandler(error); } catch {}
  }
}

function replay() {
  if (!fs.existsSync(journal)) return;
  const data = JSON.parse(fs.readFileSync(journal, 'utf8'));
  if (
    data.version !== 1 ||
    !Array.isArray(data.writes) ||
    !data.writes.length ||
    data.writes.some(entry =>
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !path.isAbsolute(entry[0]) ||
      typeof entry[1] !== 'string'
    )
  ) {
    throw new Error('Runtime transaction journal requires repair');
  }
  for (const [file, value] of data.writes) atomic(file, value);
  fs.unlinkSync(journal);
  syncDirectory(root);
}

replay();

function writeJson(file, value) {
  if (failed) throw new Error('Durable storage unavailable');
  const data = JSON.stringify(value, null, 2);
  if (pending) {
    pending.set(path.resolve(file), data);
    return;
  }
  try {
    atomic(file, data);
  } catch (error) {
    markFailed(error);
    throw error;
  }
}

const storeFs = new Proxy(fs, {
  get(target, key) {
    if (key === 'readFileSync') {
      return (file, options) => {
        const value = pending?.get(path.resolve(file));
        if (value !== undefined) return options ? value : Buffer.from(value);
        return fs.readFileSync(file, options);
      };
    }
    if (key === 'existsSync') {
      return file => pending?.has(path.resolve(file)) || fs.existsSync(file);
    }
    return target[key];
  }
});

module.exports = {
  fs: storeFs,
  atomic,
  writeJson,
  syncDirectory,
  begin() {
    if (failed || pending) throw new Error('Durable transaction unavailable');
    pending = new Map();
  },
  commit() {
    const writes = Array.from(pending || []);
    if (!writes.length) { pending = null; return; }
    try {
      atomic(journal, JSON.stringify({ version: 1, writes }));
      for (const [file, value] of writes) atomic(file, value);
      fs.unlinkSync(journal);
      syncDirectory(root);
      pending = null;
    } catch (error) {
      pending = null;
      markFailed(error);
      throw error;
    }
  },
  abort() {
    pending = null;
  },
  healthy() {
    return !failed;
  },
  onFailure(handler) {
    failureHandler = typeof handler === 'function' ? handler : null;
  }
};
