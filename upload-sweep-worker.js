'use strict';
const { parentPort, workerData } = require('worker_threads');
const { createChatUploadGuard } = require('./chat-upload-guard');
try {
  const guard = createChatUploadGuard({ dir: workerData.dir, ...workerData.limits });
  parentPort.postMessage(guard.sweep(workerData.input));
} catch (error) { parentPort.postMessage({ ok: false, error: error.message, removed: [] }); }
