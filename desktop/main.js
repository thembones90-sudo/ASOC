// ASOC Engine desktop shell.
//
// A thin Electron window around the live ASOC site. The game, accounts and
// scores stay on the server, so deploying the site updates every desktop
// install with no new .exe. Override the target for local testing with
//   --url=http://localhost:8080   or   ASOC_DESKTOP_URL=http://localhost:8080
const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://asocengine.com';
const urlArg = process.argv.find(arg => arg.startsWith('--url='));
const START_URL = new URL((urlArg && urlArg.slice(6)) || process.env.ASOC_DESKTOP_URL || DEFAULT_URL);
const ORIGIN = START_URL.origin;
const SMOKE_TEST = process.argv.includes('--smoke');
// A smoke run must not collide with the player's open app: with a shared
// profile it would lose the single-instance lock, quit with exit 0 and
// report a pass without loading anything.
if (SMOKE_TEST) app.setPath('userData', path.join(app.getPath('temp'), 'asoc-desktop-smoke'));
const ICON = path.join(__dirname, 'build', 'icon.png');
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');
const PRELOAD = path.join(__dirname, 'preload.js');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: true,
  preload: PRELOAD,
  // Game audio cues (timer, verdicts, wheel) must not wait for a click.
  autoplayPolicy: 'no-user-gesture-required'
});
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications']);

const DEFAULT_SETTINGS = Object.freeze({
  popups: true,        // Windows notifications for mentions, results, etc.
  sound: true,         // notification sound
  closeToTray: true,   // X hides to the tray so alerts keep arriving
  trayHintShown: false
});

let mainWindow = null;
let tray = null;
let quitting = false;
let settings = loadSettings();
const unreadByContents = new Map();   // webContents.id -> unread count
const liveNotifications = new Set();  // keep toasts alive until dismissed

function isAsocUrl(value) {
  try { return new URL(value).origin === ORIGIN; } catch { return false; }
}

function openExternally(value) {
  try {
    const { protocol } = new URL(value);
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') shell.openExternal(value);
  } catch {}
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
  return { ...DEFAULT_SETTINGS };
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch {}
  buildMenu();
  refreshTray();
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Number(state.width) >= 800 && Number(state.height) >= 600) return state;
  } catch {}
  return { width: 1600, height: 1000, maximized: false };
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {}
}

function showWindow(win = mainWindow) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------------------
// ATTENTION: taskbar flash, unread badge, tray dot, Windows notifications.
// The page (js/asoc-alerts.js via preload.js) decides what matters; main only
// renders it, and only for ASOC pages.

function senderWindow(event) {
  if (!isAsocUrl(event.senderFrame?.url || '')) return null;
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win : null;
}

function totalUnread() {
  let total = 0;
  for (const count of unreadByContents.values()) total += count;
  return total;
}

function setAttention(win, contentsId, count, badgeDataUrl) {
  if (count > 0) unreadByContents.set(contentsId, count);
  else unreadByContents.delete(contentsId);

  if (count > 0 && !win.isFocused()) {
    win.flashFrame(true);
    const badge = typeof badgeDataUrl === 'string' && badgeDataUrl.startsWith('data:image/png;base64,') && badgeDataUrl.length < 50000
      ? nativeImage.createFromDataURL(badgeDataUrl)
      : null;
    if (badge && !badge.isEmpty()) win.setOverlayIcon(badge, `${count} unread`);
  } else {
    win.flashFrame(false);
    win.setOverlayIcon(null, '');
  }
  refreshTray();
}

function showNotification(win, { title, body }) {
  if (!settings.popups || !Notification.isSupported()) return;
  if (win.isVisible() && win.isFocused()) return;
  const toast = new Notification({
    title: String(title || 'ASOC Engine').slice(0, 64),
    body: String(body || '').slice(0, 200),
    icon: ICON,
    silent: !settings.sound
  });
  liveNotifications.add(toast);
  const release = () => liveNotifications.delete(toast);
  toast.on('click', () => { release(); showWindow(win); });
  toast.on('close', release);
  toast.on('failed', release);
  toast.show();
}

ipcMain.on('asoc:attention', (event, payload) => {
  const win = senderWindow(event);
  if (!win) return;
  const count = Math.max(0, Math.min(999, Math.floor(Number(payload?.count) || 0)));
  setAttention(win, event.sender.id, count, payload?.badge);
});

ipcMain.on('asoc:notify', (event, payload) => {
  const win = senderWindow(event);
  if (win) showNotification(win, payload || {});
});

// ---------------------------------------------------------------------------
// TRAY

let trayIcons = null;
function makeTrayIcons() {
  const base = nativeImage.createFromPath(ICON);
  const sized = size => base.resize({ width: size, height: size, quality: 'best' });
  // Red "unread" dot in the top-right corner, painted straight into the
  // BGRA bitmap so no extra asset has to ship.
  const withDot = size => {
    const image = sized(size);
    const bitmap = Buffer.from(image.toBitmap());
    const radius = size * 0.26;
    const cx = size - radius - 0.5;
    const cy = radius + 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > radius + 1) continue;
        const i = (y * size + x) * 4;
        if (d > radius) { bitmap[i] = 0x10; bitmap[i + 1] = 0x0C; bitmap[i + 2] = 0x0A; bitmap[i + 3] = 255; continue; }
        bitmap[i] = 0x3A; bitmap[i + 1] = 0x30; bitmap[i + 2] = 0xE0; bitmap[i + 3] = 255;
      }
    }
    return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
  };
  const pack = make => {
    const image = make(16);
    image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: make(32).toPNG() });
    return image;
  };
  return { normal: pack(sized), alert: pack(withDot) };
}

function notificationMenuItems() {
  return [
    { label: 'Pop-up notifications', type: 'checkbox', checked: settings.popups, click: item => updateSettings({ popups: item.checked }) },
    { label: 'Notification sound', type: 'checkbox', checked: settings.sound, enabled: settings.popups, click: item => updateSettings({ sound: item.checked }) },
    { label: 'Keep running in tray when closed', type: 'checkbox', checked: settings.closeToTray, click: item => updateSettings({ closeToTray: item.checked }) }
  ];
}

function refreshTray() {
  if (!tray) return;
  const unread = totalUnread();
  tray.setImage(unread > 0 ? trayIcons.alert : trayIcons.normal);
  tray.setToolTip(unread > 0 ? `ASOC Engine — ${unread} unread` : 'ASOC Engine');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ASOC Engine', click: () => showWindow() },
    { type: 'separator' },
    ...notificationMenuItems(),
    { type: 'separator' },
    { label: 'Quit ASOC Engine', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  trayIcons = makeTrayIcons();
  tray = new Tray(trayIcons.normal);
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
  refreshTray();
}

// ---------------------------------------------------------------------------
// WINDOWS

// Shared wiring for the main window and every same-origin popup
// (e.g. the Master Mirror opened from the GM console).
function wireWindow(win) {
  const contents = win.webContents;
  const contentsId = contents.id;
  win.on('focus', () => win.flashFrame(false));
  contents.on('destroyed', () => { unreadByContents.delete(contentsId); refreshTray(); });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAsocUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 900,
          backgroundColor: '#0a0c10',
          autoHideMenuBar: true,
          icon: ICON,
          webPreferences: WEB_PREFERENCES
        }
      };
    }
    openExternally(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isAsocUrl(url) || url.startsWith('file:')) return;
    event.preventDefault();
    openExternally(url);
  });

  contents.on('did-create-window', child => {
    child.setMenuBarVisibility(false);
    wireWindow(child);
  });
}

function showOffline(win, reason) {
  win.loadFile(OFFLINE_PAGE, { query: { target: START_URL.href, reason: String(reason || '') } });
}

function createMainWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'ASOC Engine',
    backgroundColor: '#0a0c10',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: WEB_PREFERENCES
  });
  if (state.maximized) mainWindow.maximize();

  const contents = mainWindow.webContents;
  contents.setUserAgent(`${contents.getUserAgent()} ASOCDesktop/${app.getVersion()}`);
  wireWindow(mainWindow);

  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    // -3 is ERR_ABORTED: a navigation replaced by another, not a failure.
    if (!isMainFrame || errorCode === -3 || !isAsocUrl(validatedUrl)) return;
    if (SMOKE_TEST) {
      console.error(`[smoke] FAIL load ${validatedUrl}: ${errorDescription} (${errorCode})`);
      app.exit(1);
      return;
    }
    showOffline(mainWindow, errorDescription);
  });

  mainWindow.once('ready-to-show', () => { if (!SMOKE_TEST) mainWindow.show(); });
  mainWindow.on('close', event => {
    saveWindowState(mainWindow);
    // Closing to the tray keeps the page (and its live connection) running,
    // so alerts keep arriving like Discord. Exit/Quit really quits.
    if (quitting || !tray || !settings.closeToTray) return;
    event.preventDefault();
    mainWindow.hide();
    if (!settings.trayHintShown) {
      updateSettings({ trayHintShown: true });
      if (Notification.isSupported()) {
        new Notification({
          title: 'ASOC Engine is still running',
          body: 'You will keep getting alerts. Right-click the tray icon to quit or change notifications.',
          icon: ICON,
          silent: true
        }).show();
      }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  if (SMOKE_TEST) runSmokeTest(contents);
  mainWindow.loadURL(START_URL.href);
}

// `electron . --smoke --url=...` loads the site headlessly, checks the page
// booted with the desktop-critical helpers present, then exits 0/1.
function runSmokeTest(contents) {
  const timeout = setTimeout(() => {
    console.error('[smoke] FAIL timed out waiting for page load');
    app.exit(1);
  }, 30000);
  contents.on('did-finish-load', async () => {
    const url = contents.getURL();
    if (!isAsocUrl(url)) return;
    clearTimeout(timeout);
    const result = await contents.executeJavaScript(`({
      title: document.title,
      dialog: typeof window.AsocDialog?.prompt === 'function',
      bridge: typeof window.asocDesktop?.attention === 'function' && typeof window.asocDesktop?.notify === 'function',
      alerts: typeof window.AsocAlerts?.signal === 'function'
    })`);
    console.log(`[smoke] loaded ${url} title="${result.title}" AsocDialog=${result.dialog} asocDesktop=${result.bridge} AsocAlerts=${result.alerts}`);
    app.exit(result.dialog && result.bridge ? 0 : 1);
  });
}

function buildMenu() {
  const focused = () => BrowserWindow.getFocusedWindow() || mainWindow;
  const template = [
    {
      label: 'ASOC',
      submenu: [
        { label: 'Home', accelerator: 'Alt+Home', click: () => focused()?.loadURL(START_URL.href) },
        { label: 'Reload', accelerator: 'F5', click: () => focused()?.webContents.reload() },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', visible: false, click: () => focused()?.webContents.reload() },
        { label: 'Hard Reload (clear cache)', accelerator: 'CmdOrCtrl+Shift+R', click: () => focused()?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Notifications', submenu: notificationMenuItems() },
        { type: 'separator' },
        { label: 'Exit', click: () => { quitting = true; app.quit(); } }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen', accelerator: 'F11' },
        { type: 'separator' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open in Browser', click: () => openExternally(focused()?.webContents.getURL() || START_URL.href) },
        {
          label: 'About ASOC Engine',
          click: () => dialog.showMessageBox(focused(), {
            type: 'info',
            title: 'ASOC Engine',
            message: `ASOC Engine Desktop ${app.getVersion()}`,
            detail: `Connected to ${ORIGIN}\nPress Alt to show this menu.`
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!SMOKE_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => { quitting = true; });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.asoc.engine');
    app.on('web-contents-created', (_event, contents) => {
      contents.session.setPermissionRequestHandler((wc, permission, callback) => {
        callback(ALLOWED_PERMISSIONS.has(permission) && isAsocUrl(wc.getURL()));
      });
    });
    buildMenu();
    if (!SMOKE_TEST) createTray();
    createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
