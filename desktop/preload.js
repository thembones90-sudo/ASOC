// ASOC Engine desktop bridge.
//
// Exposes a deliberately tiny API to the ASOC site as window.asocDesktop.
// js/asoc-alerts.js on the site decides WHAT deserves attention; this only
// forwards "flash + badge N" and "show this notification" to main.js, which
// re-validates everything. No Node or Electron objects reach the page.
const { contextBridge, ipcRenderer } = require('electron');

const BADGE_SIZE = 32;

// Taskbar overlay badge: red disc with the unread count, like Discord and
// WhatsApp. Drawn here because main-process nativeImage cannot render text.
function drawBadge(count) {
  const canvas = document.createElement('canvas');
  canvas.width = BADGE_SIZE;
  canvas.height = BADGE_SIZE;
  const ctx = canvas.getContext('2d');
  const r = BADGE_SIZE / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = '#E0303A';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0A0C10';
  ctx.stroke();
  const label = count > 9 ? '9+' : String(count);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${label.length > 1 ? 17 : 21}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, r, r + 1);
  return canvas.toDataURL('image/png');
}

contextBridge.exposeInMainWorld('asocDesktop', Object.freeze({
  platform: 'windows',
  attention(count) {
    const n = Math.max(0, Math.min(999, Math.floor(Number(count) || 0)));
    let badge = '';
    try { if (n > 0) badge = drawBadge(n); } catch {}
    ipcRenderer.send('asoc:attention', { count: n, badge });
  },
  notify(payload) {
    const { title, body, tag, silent } = payload || {};
    ipcRenderer.send('asoc:notify', {
      title: String(title || 'ASOC Engine').slice(0, 64),
      body: String(body || '').slice(0, 200),
      tag: String(tag || '').slice(0, 32),
      silent: silent === true
    });
  },
  // Saved logins ("Remember me"), kept encrypted by the app with Windows'
  // per-user protection. kind: 'gm' | 'player'. See js/saved-login.js.
  credentials: Object.freeze({
    get: kind => ipcRenderer.invoke('asoc:credentials:get', String(kind)),
    save: (kind, login) => ipcRenderer.invoke('asoc:credentials:save', String(kind), {
      username: String(login?.username || ''),
      password: String(login?.password || '')
    }),
    forget: kind => ipcRenderer.invoke('asoc:credentials:forget', String(kind))
  })
}));
