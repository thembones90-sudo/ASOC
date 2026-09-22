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

const TRANSIENT_FS_CODES = new Set(['EAGAIN', 'EBUSY', 'EINTR', 'ESTALE']);
const UNSUPPORTED_DIRSYNC_CODES = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM']);
let directorySyncWarningShown = false;

function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {}
  }
}

function syncDirectory(dir) {
  if (process.platform === 'win32') return;
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    if (UNSUPPORTED_DIRSYNC_CODES.has(error?.code)) {
      if (!directorySyncWarningShown) {
        directorySyncWarningShown = true;
        console.warn(`[durable-io] Directory fsync unsupported on this volume (${error.code}); continuing with file fsync + atomic rename.`);
      }
      return;
    }
    throw error;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function injectedFailure() {
  if (!testFailureTrigger || !fs.existsSync(testFailureTrigger)) return;
  const error = new Error('Injected durable storage failure');
  error.code = 'EIO';
  throw error;
}

function atomic(file, value) {
  const target = path.resolve(file);
  const dir = path.dirname(target);
  const retryDelays = [0, 20, 60, 140];
  let lastError;

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (retryDelays[attempt]) sleepSync(retryDelays[attempt]);
    fs.mkdirSync(dir, { recursive: true });
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
      syncDirectory(dir);
      return;
    } catch (error) {
      lastError = error;
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
      if (!TRANSIENT_FS_CODES.has(error?.code) || attempt === retryDelays.length - 1) throw error;
      console.warn(`[durable-io] Transient ${error.code} writing ${path.basename(target)}; retry ${attempt + 1}/${retryDelays.length - 1}`);
    }
  }

  throw lastError || new Error('Atomic write failed');
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
