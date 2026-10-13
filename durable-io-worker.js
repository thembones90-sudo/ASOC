'use strict';
// Dedicated durability worker. Blocking filesystem primitives are intentional
// here: they preserve the existing crash guarantees without freezing the
// Node.js thread that owns HTTP and WebSocket traffic.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(workerData.root);
const journal = path.resolve(workerData.journal);
const testFailureTrigger = String(workerData.testFailureTrigger || '');
const testAtomicDelayMs = Math.max(0, Number(workerData.testAtomicDelayMs) || 0);
const transient = new Set(['EAGAIN', 'EBUSY', 'EINTR', 'ESTALE']);
const unsupportedDirsync = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM']);

function sleep(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function syncDirectory(dir) {
  if (process.platform === 'win32') return;
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); }
  catch (error) { if (!unsupportedDirsync.has(error?.code)) throw error; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
function injectedFailure() {
  if (!testFailureTrigger || !fs.existsSync(testFailureTrigger)) return;
  const error = new Error('Injected durable storage failure'); error.code = 'EIO'; throw error;
}
function atomic(file, value) {
  if (testAtomicDelayMs) sleep(testAtomicDelayMs);
  const target = path.resolve(file), dir = path.dirname(target);
  const delays = [0, 20, 60, 140];
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) sleep(delays[attempt]);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
    let fd;
    try {
      injectedFailure();
      fd = fs.openSync(tmp, 'wx', 0o600);
      fs.writeFileSync(fd, value, 'utf8');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(tmp, target); syncDirectory(dir); return;
    } catch (error) {
      lastError = error;
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
      if (!transient.has(error?.code) || attempt === delays.length - 1) throw error;
    }
  }
  throw lastError || new Error('Atomic write failed');
}
function commit(writes, forceWal) {
  if (writes.length === 1 && !forceWal) return atomic(writes[0][0], writes[0][1]);
  atomic(journal, JSON.stringify({ version: 1, writes }));
  if (workerData.testCrashAfterWal === true) process.exit(86);
  for (let i = 0; i < writes.length; i++) {
    const [file, value] = writes[i];
    atomic(file, value);
    if (i === 0 && workerData.testCrashAfterFirstTarget === true) process.exit(87);
  }
  fs.unlinkSync(journal); syncDirectory(root);
}
function errorView(error) {
  return { message: error?.message || String(error), code: error?.code || '', name: error?.name || 'Error', stack: error?.stack || '' };
}
parentPort.on('message', message => {
  if (!message || message.type !== 'commit') return;
  try { commit(message.writes, message.forceWal === true); parentPort.postMessage({ id: message.id, ok: true }); }
  catch (error) { parentPort.postMessage({ id: message.id, ok: false, error: errorView(error) }); }
});
