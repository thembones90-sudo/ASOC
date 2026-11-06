'use strict';
// Only failed top-level ASOC navigations may replace a window with recovery.
function attachRecovery(win, { origin, startUrl, offlinePage, onFailure } = {}) {
  let showingOffline = false;
  win.webContents.on('did-fail-load', (_event, code, reason, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || win.isDestroyed()) return;
    let target;
    try { target = new URL(failedUrl); if (target.origin !== origin) return; } catch { return; }
    if (onFailure) return onFailure(target.href, code, reason);
    if (showingOffline) return;
    showingOffline = true;
    // Preserve the failed player/GM route instead of always returning home.
    Promise.resolve(win.loadFile(offlinePage, { query: { target: target.href || startUrl, reason: String(reason || '') } }))
      .catch(error => console.error('[desktop] Recovery page failed:', error.message))
      .finally(() => { showingOffline = false; });
  });
}
module.exports = { attachRecovery };
