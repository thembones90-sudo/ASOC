// Stops a spawned test server and resolves only once the process has exited.
// Teardown must not delete a data directory while the server can still write
// into it: a SIGTERM'd ASOC server shuts down gracefully for up to
// ASOC_SHUTDOWN_GRACE_MS, and its timers (attendance ticks, sweeps, recovery
// snapshots) keep writing meanwhile. Tests need no graceful shutdown here, so
// SIGKILL and wait for 'exit'.
'use strict';

module.exports = function stopProcess(child, timeoutMs = 10000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGKILL'); } catch { clearTimeout(timer); resolve(); }
  });
};
