// ASOC Engine desktop shell.
//
// A thin Electron window around the live ASOC site. The game, accounts and
// scores stay on the server, so deploying the site updates every desktop
// install with no new .exe. Override the target for local testing with
//   --url=http://localhost:8080   or   ASOC_DESKTOP_URL=http://localhost:8080
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
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
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

const WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: true,
  // Game audio cues (timer, verdicts, wheel) must not wait for a click.
  autoplayPolicy: 'no-user-gesture-required'
});
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'notifications']);

let mainWindow = null;

function isAsocUrl(value) {
  try { return new URL(value).origin === ORIGIN; } catch { return false; }
}

function openExternally(value) {
  try {
    const { protocol } = new URL(value);
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') shell.openExternal(value);
  } catch {}
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

// Shared hardening for the main window and every same-origin popup
// (e.g. the Master Mirror opened from the GM console).
function wireWebContents(contents) {
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
    wireWebContents(child.webContents);
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
  wireWebContents(contents);

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
  mainWindow.on('close', () => saveWindowState(mainWindow));
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
      path: location.pathname,
      dialog: typeof window.AsocDialog?.prompt === 'function'
    })`);
    console.log(`[smoke] loaded ${url} title="${result.title}" AsocDialog=${result.dialog}`);
    app.exit(result.dialog ? 0 : 1);
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
        { role: 'quit', label: 'Exit' }
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
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.asoc.engine');
    app.on('web-contents-created', (_event, contents) => {
      contents.session.setPermissionRequestHandler((wc, permission, callback) => {
        callback(ALLOWED_PERMISSIONS.has(permission) && isAsocUrl(wc.getURL()));
      });
    });
    buildMenu();
    createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
