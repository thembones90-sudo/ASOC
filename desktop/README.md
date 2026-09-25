# ASOC Engine Desktop

A Windows app that opens the live ASOC site (https://asocengine.com) in its own window.
The game, accounts, and scores stay on the server, so **deploying the website updates every desktop install**. You only rebuild the .exe when this folder changes.

This folder has its own `package.json`, so Electron is never installed on Railway.

## Build

```powershell
cd "A:\ASOC ENGINE\desktop"
npm install
npm run dist
```

Output in `desktop/dist/`:
- `ASOC-Engine-Setup-<version>.exe`: installer (Start Menu and desktop shortcuts, uninstaller)
- `ASOC-Engine-Portable-<version>.exe`: single file, no install

## Run / test

| Command | What it does |
|---|---|
| `npm start` | Open the app against the live site |
| `npm run start:local` | Open the app against `http://localhost:8080` |
| `npm run smoke` / `npm run smoke:local` | Load the site without a window, check it booted, exit 0 or 1 |

Any target can be set with `--url=<origin>` or the `ASOC_DESKTOP_URL` environment variable.

## Behavior

- **F5 / Ctrl+R** reloads, **Ctrl+Shift+R** reloads and clears the cache, **F11** goes fullscreen, **Alt+Home** returns home, and **Ctrl+Shift+I** opens DevTools. Press **Alt** to show the menu.
- ASOC pages that open a new window (the Master Mirror) open in a new app window. Links to any other site open in the default browser.
- If the server can't be reached, the app shows a SIGNAL LOST screen and retries every 10 seconds.
- Game audio plays without waiting for a click.
- The window's size and position are remembered.
- Only one copy of the app runs at a time. Launching it again brings the open window back, even from the tray.
- The app adds `ASOCDesktop/<version>` to its user agent so the server can recognize it.

## Notifications

While the window is in the background, minimized, or closed to the tray:

| Event | Who gets it | Alert |
|---|---|---|
| Any chat message | everyone else | taskbar flash + unread badge |
| @mention of you, or a reply to your message | that person | + Windows notification |
| Shadow Broker `@all` | every Little Hero | + Windows notification |
| BATTLE STARTING, GAME WON / GAME LOST | Little Heroes | + Windows notification |
| Wheel of Misfortune lands on you | that Little Hero | + Windows notification |
| Guess waiting for a verdict | Shadow Broker | + Windows notification |
| Little Hero joins | Shadow Broker | + Windows notification |
| @broker / @gm / reply to the Broker | Shadow Broker | + Windows notification |

- Bringing the window to the front clears the flash, badge, and tray dot. A burst of notifications is combined into one.
- **Closing the window (X) keeps the app running in the tray** so alerts keep arriving. The first time, a notification explains this. Quit from the tray icon's right-click menu or from **ASOC → Exit**.
- Tray menu and **ASOC → Notifications** have three switches: pop-up notifications, notification sound, and keep running in tray when closed. They're saved in `%APPDATA%\ASOC Engine\settings.json`.
- Master Mirror tabs never alert, and the GM's own mirror persona doesn't trigger join or chat alerts.
- Use the **installer**. Windows only reliably shows notifications for installed apps; the portable .exe still flashes and shows the badge. Windows Do Not Disturb also hides notifications.

**How it's split:**
- **The site decides what matters.** `js/asoc-alerts.js` holds the rules, and they can change with a normal site deploy.
- **The app displays it.** `preload.js` exposes `window.asocDesktop.attention(count)` and `notify({ title, body })`, and `main.js` handles them for ASOC pages only.
- **Tests:** `tests/desktop-alerts.js`.

## Notes

- `window.prompt()` does not exist in Electron. Use `window.AsocDialog.prompt()` (`js/asoc-dialog.js`) for text input on the site.
- The app is unsigned, so Windows SmartScreen shows "Windows protected your PC" on first launch (More info → Run anyway). A code-signing certificate removes this.
- The icon is `build/icon.png`, a copy of `assets/ui/shadow-broker.png`. Replace it with any square PNG of at least 256×256.
