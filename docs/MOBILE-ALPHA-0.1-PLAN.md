# ASOC Mobile Web Alpha 0.1 — Frontend Audit and Implementation Plan

**Status (2026-09-29):** steps 0, 0b, 1, 2, 3 and 4 are implemented and shipped; steps 5 (PEOPLE + PROFILE) and 6 (real-device pass) remain. See §12 for what shipped and what to review on a real phone.
**Baseline:** `main` at `13c19f5` (hardening deployed and verified live).
**Scope:** the Little Hero client (`join.html`, `js/player.js` and its modules) in AMUSEMENT PARK (CASUAL). The GM client (`index.html`, `js/app.js`) is out of scope and must not change.

---

## 1. Summary

ASOC is closer to a mobile-ready client than its size suggests, but the path there is not "more media queries". The main points:

1. **A phone adaptation already exists** (`fc784c8`, 2026-09-20, merged into `main`). It is a *stacked page*: board first, chat below, natural page scroll. That is the "desktop squeezed into a narrow viewport" model this project replaces. Its rules are spread over about 12 different breakpoints in two stylesheets. It must be **quarantined, not extended**.
2. **The CSS is in a specificity war.** There are 3,468 `!important` declarations (1,959 in `css/asoc.css`, 1,509 inline in `join.html`) and 53 `:not(#casual-scale-guard)` selectors that exist only to raise specificity. New mobile CSS cannot "win" by overriding. It needs a hard boundary (§4).
3. **Session survival is the biggest functional gap.** `js/player.js` has no `visibilitychange`, `pageshow` or `online` handling. After iOS suspends a tab, the dead socket can still report `OPEN`, and `connectWebSocket()` refuses to open a new one while it does. Reconnect gives up after 10 attempts (about a minute) with a blocking `alert()` and a return to the join screen.
4. **The data needed for CHAT, PEOPLE and PROFILE already reaches the client.** That covers the chat history, the `players:update` roster (now with avatar hashes) and the profile PATCH API. Alpha 0.1 needs **no new game logic**. It needs one small protocol addition for liveness (§6.2) and, recommended, one for chat idempotency (§6.3).
5. **The payload is the biggest performance problem, and mostly cheap to fix.** First load is 1.72 MB of HTML/CSS/JS (421 KB gzipped, and the server doesn't compress), plus about **5 MB of PNGs**. One 1.9 MB logo is downloaded **twice** under two URLs.
6. **The PWA manifest launches the wrong page.** `site.webmanifest` has `start_url: "/"`, which is the **GM panel**. A Little Hero adding ASOC to the Home Screen would open the Shadow Broker's page.

Proposed architecture: **one client, one socket, one state; a mobile *shell* that re-hosts the existing chat DOM, plus new PEOPLE and PROFILE views, activated by a single root class and styled by one dedicated stylesheet.** No framework, no second chat implementation.

---

## 2. Current frontend map (Little Hero)

### 2.1 Files

| Piece | Where | Size | Notes |
|---|---|---|---|
| Page shell + **inline CSS** | `join.html` lines 18–8851 | ~356 KB CSS | Player-only styles, incl. the 2026-09-20 phone block |
| Page markup | `join.html` ~8853–9312 | — | `#access-gate`, `#join-screen`, `#game-screen` |
| Inline script | `join.html` ~9316–9818 | ~500 lines | Access gate, player/GM login, mirror, reset password, verification, session fetch |
| Shared stylesheet | `css/asoc.css` | 648 KB | **Shared with the GM panel.** Contains casual/phone rules too |
| Main client | `js/player.js` | 224 KB | Socket, state, chat, HUD, roster, appearance |
| Keyed DOM patcher | `js/dom-patch.js` | — | Used by `renderChat()`: unchanged messages are kept |
| Other modules | 30 script tags | — | Media preview, DMs, shadow market, quests, Kaladont, IKS, ritual, timer, … |

### 2.2 DOM regions (`join.html`)

- `#access-gate` → Little Hero / Master access choice.
- `#join-screen` → login/register **and the profile editor**: `#little-hero-profile-preview`, `#little-hero-avatar-file`, `#theme-select`. It is hidden once joined.
- `#game-screen` (gets `room-mode-casual|battle-armed|battle|recount` via `applyRoomMode()`, `player.js:2346`)
  - `#player-battle-layout` → `#casual-minigames-dock`, `#board-layer`, ritual/wheel/tribute overlays
  - `#player-layout-splitter` (desktop drag-resize, `setupPlayerLayoutSplitter()`, `player.js:2409`)
  - `#player-leaderboard-strip`, `#player-alltime-panel`
  - `#little-hero-hud` → identity, logout, master access, stat chips (score, rank, streak, DM, coins, link)
  - `#chat-panel` → header (`#battle-comms-online`, `#connection-status`), `#chat-search`, `#battle-event-feed`, `#chat-priority-lane`, `#chat-messages`, pickers/menus/popovers, `#chat-form` (reply preview, attachment menu, GIF, poll composer, input, send)
- `#score-announcement-layer`

### 2.3 Behaviour relevant to Alpha 0.1

| Concern | Where | State today |
|---|---|---|
| Login / session | `join.html` inline script → `/api/auth/player/session`, `saved-login.js` | Token in `localStorage`; works on mobile |
| Socket connect | `connectWebSocket()` `player.js:1193` | Single-socket guard; **blocks reconnect while a zombie socket reports OPEN** |
| Disconnect | `handleDisconnect()` `:2694`, `attemptReconnect()` `:2705` | Backoff capped at 10 s, **10 attempts then `alert()` and the join screen** |
| Resume after suspend | — | **Missing** (no `visibilitychange` / `pageshow` / `online`) |
| Liveness | server `WS_HEARTBEAT_MS` 30 s protocol pings | Invisible to page JS; the client can't detect a dead link |
| Send | `send()` `:1277` | Drops silently if not OPEN; returns false |
| Chat submit | `submitGuess()` `:4127` | Queues up to 10 while disconnected (good). No message id, so **a send into a zombie socket is lost** |
| Chat render | `renderChat()` `:4432` via `DomPatch` | Keyed patch, only new or changed entries rebuilt (good) |
| Touch actions | long-press in `bindChatForm()` `:3685` | Opens the existing Reply/React context menu (good, reusable) |
| Roster | `hydrateRosterAvatars()` `:2751`, `updatePlayerLeaderboard()` `:2761` | Data present; **no player-facing online list**, only a count |
| Profile | `processAvatarFile()` `:1070`, `PATCH /api/auth/player/profile` | Editor lives only on the pre-join screen |
| Connection indicator | `setConnectionStatus()`, `#reconnecting-overlay` | Exists; the overlay is full-screen and heavy for brief mobile blips |

---

## 3. Desktop assumptions that break on touch / narrow screens

1. **Layout model.** A fixed side-by-side battlefield plus chat with a drag splitter. The phone block stacks it into a long scrolling page. There's no app shell, no persistent navigation, and the chat isn't the main surface.
2. **Breakpoints are width-only.** The phone rules use `max-width: 760px`. An iPhone 14 Pro Max in **landscape is 932×430**, so it gets the *desktop* layout. Phones must be detected by capability (`pointer: coarse`) plus size, including short heights.
3. **Hover dependence.** There are 240 `:hover` rules and **no** `(hover: none)` or `(pointer: coarse)` queries. Anything revealed only on hover (reaction add, message tools, seen popovers, tooltips) is unreachable by touch unless the long-press menu covers it.
4. **Viewport units and the keyboard.** 16 `100vh` uses (wrong on iOS Safari; the toolbar and keyboard are ignored) and no `visualViewport` handling. With the iOS keyboard open, the composer can be covered or the page can scroll under the fixed chrome. Popover and picker positioning uses `window.innerHeight` (`player.js:848, 3438, 3792, 3921, 3930`), which on iOS doesn't shrink for the keyboard.
5. **Input zoom.** iOS zooms the page when focusing an input under 16 px. The chat input is forced to 16 px only in some casual contexts (`asoc.css:19569` via the `:not(#casual-scale-guard)` hack); the search, poll and DM inputs aren't.
6. **Blocking dialogs.** There are 7 `alert()` calls in `player.js`, including the reconnect give-up. On iOS they freeze the page and are hostile in standalone mode.
7. **Fixed-position chrome without safe areas.** `viewport-fit=cover` is set on `join.html` and some rules use `env(safe-area-inset-*)`, but not systematically. The composer, HUD and logout button can collide with the Home indicator or the Dynamic Island.
8. **Heavy decorative assets.** 1.9 MB PNG logos (×2) and a 1254×1254 PNG used as a small icon.
9. **Specificity.** Any mobile rule targeting `#chat-input`, `#chat-panel` and similar competes with ID selectors plus `!important` plus `:not(#id)` boosters. Overriding piecemeal is how the existing 3,468 `!important`s accumulated.

---

## 4. Proposed architecture (smallest maintainable)

### 4.1 One switch, one boundary

- **Mobile mode is a single root class, `html.asoc-mobile`.** Per decision 1 (§10) it is set from the player's stored **MOBILE VERSION** choice. The media query below is used only to decide where to offer the button prominently:
  ```
  (pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 500px)
  ```
  This covers portrait phones, landscape phones and small tablets; it excludes desktops and laptops, including narrow desktop windows. An `?asoc-mobile=1|0` override exists for testing.
- **All new mobile styling lives in one new stylesheet, `css/mobile.css`,** loaded **last** on `join.html` only. Every selector starts with `html.asoc-mobile`. Desktop never matches it, so desktop is unchanged by construction.
- **Tokens:** `css/mobile.css` opens with a `:root` block of mobile variables for spacing, touch-target minimum (44 px), type scale, nav height, and composer height derived from safe areas (`--m-safe-top: env(safe-area-inset-top)` and so on).
- **Breakpoints:** only two, both inside the mobile boundary: compact (≤ 390 px wide) and landscape (height ≤ 500 px). No other width queries in `mobile.css`.

### 4.2 Shell, not a second client

```
#game-screen (unchanged, same socket, same PlayerApp state)
└── #mobile-shell            (new, only rendered/visible under html.asoc-mobile)
    ├── .m-topbar            connection pill · room title · coins
    ├── .m-view[data-view=chat]     ← the EXISTING #chat-panel node is moved here
    ├── .m-view[data-view=people]   new list rendered from PlayerApp.currentPlayers
    ├── .m-view[data-view=profile]  existing profile card/theme/avatar controls, re-hosted
    └── .m-nav               CHAT | PEOPLE | PROFILE   (CASUAL)
                             CHAT | BOARD  | PEOPLE    (BATTLE, from Alpha 0.2)
```

- **Re-hosting, not duplicating.** `mobile-shell.js` moves the existing `#chat-panel` element into the CHAT view when mobile activates, and back to its original parent when it deactivates (for example on rotation to a large tablet or a desktop override). Moving a node keeps its listeners, its `DomPatch` bookkeeping and its state. There is one chat DOM and one chat state.
- **Tabs are CSS visibility,** not navigation. No reload, no reconnect, no re-render of hidden views. PEOPLE renders only while visible, and on `players:update` only when visible or when it becomes visible.
- **The profile editor is shared, not copied.** The `#little-hero-profile-preview`, `#theme-select` and avatar input group is moved (again, a node move) into PROFILE after join and back to `#join-screen` on logout. Saving uses the existing `PATCH /api/auth/player/profile` plus the existing appearance flow (`processAvatarFile`, `updateAppearancePreview`).
- **The desktop-only chrome is hidden under `html.asoc-mobile`,** in one rule group at the top of `mobile.css`: the splitter, the desktop HUD strip, the leaderboard strip, and in CASUAL the board layer.
- **Room mode:** `applyRoomMode()` already toggles `room-mode-*` on `#game-screen`. The shell reads it to choose nav items. In Alpha 0.1, BATTLE modes show a **"Battle view comes in 0.2 — chat stays live"** CHAT-only shell rather than the squeezed board.

### 4.3 The quarantine step (prerequisite)

Before `mobile.css` exists, the existing phone rules must stop fighting it:

1. **Inventory** every rule from `fc784c8` and the later phone blocks (the `max-width: 760/720/700/560/430/420px` groups in `join.html` and `asoc.css`).
2. **Re-scope them to `html:not(.asoc-mobile)`**, a mechanical prefix with no visual change. They then keep serving narrow desktop windows, and anything unforeseen, exactly as today, and never apply once the mobile shell is active.
3. **Do not delete them in Alpha 0.1.** Delete them only after 0.4, when the shell covers all modes.

This is the key maintainability decision. The mobile shell starts from a clean slate instead of out-specifying 3,468 `!important`s.

### 4.4 What is explicitly NOT duplicated

Scoring, timer, WOMF, Ritual, quests, Shadow Coins, polls, battle state, chat state, identity and room mode stay exactly where they are: server-authoritative, delivered over the one socket, held in `PlayerApp`. The mobile shell adds presentation (layout, tabs, the people list, touch affordances) and connection-liveness handling. Nothing else.

---

## 5. Exact changes for Alpha 0.1

### New files
- `js/mobile-shell.js`: capability detection, the root class, shell DOM creation, node re-hosting, tab state, a `visualViewport` keyboard inset (`--m-keyboard`), and the PEOPLE renderer.
- `css/mobile.css`: all mobile styling under `html.asoc-mobile`.
- `tests/mobile-*.js`: see §8.

### Existing files (small, targeted)
| File | Change |
|---|---|
| `join.html` | Add `<link css/mobile.css>` (last) and the `<script js/mobile-shell.js>` tag; re-scope the phone blocks to `html:not(.asoc-mobile)` (§4.3); `apple-mobile-web-app-*` meta (0.4); de-duplicate the logo image |
| `css/asoc.css` | Re-scope the phone blocks only (§4.3). **No other edits.** |
| `js/player.js` | Session survival (§6): resume/online/liveness hooks, a non-blocking give-up path replacing the `alert()`, message ids on chat submit. Call `MobileShell.onRoster(players)` / `onRoomMode(mode)` from the existing handlers (one line each). Popover positioning uses `visualViewport` when present. |
| `server.js` | `client:ping` → `server:pong` (§6.2). Optional `clientMsgId` dedupe on `chat:guess` (§6.3). Gzip for text responses (§7). |
| `site.webmanifest` | Player `start_url` `/join.html`, `scope`, `id` (details in 0.4; the `start_url` fix ships in 0.1 because it is actively wrong) |
| Assets | WebP/resized versions of `asoc-logo`, `unstable-concoction-toxic-drop` |

### Touch equivalents (don't remove desktop interactions)
| Desktop interaction | Mobile equivalent |
|---|---|
| Right-click message → Reply/React | Existing long-press (`player.js:3685`) plus a visible "⋯" on the active message |
| Hover reaction "+" | Shown on the active (tapped) message |
| Hover "seen" popover | Tap the seen indicator |
| Hover tooltips on stat chips | Values shown inline in PROFILE |
| Media lightbox context menu | Existing lightbox; images fit the viewport; native long-press Save on iOS |

---

## 6. Session survival and network (critical)

### 6.1 Resume handling (`player.js`)
- On `visibilitychange` → visible, `pageshow` (including bfcache `persisted`) and `online`, run **`verifyLink()`**:
  - If the socket isn't OPEN, reset the backoff and reconnect immediately.
  - If it is OPEN, send `client:ping`. With no `server:pong` within 4 s, treat the socket as a zombie: detach its handlers, close it, and reconnect. This is the fix for the OPEN-zombie guard in `connectWebSocket()`.
- **Never give up while the page is visible.** After the fast attempts, keep retrying every 15–30 s with a subtle "RECONNECTING" pill instead of `alert()` and the join screen. Return to login only when the server says the session is invalid (`auth:required`).
- A brief blip (under 3 s) shows **only** the pill, not the full `#reconnecting-overlay`.

### 6.2 Liveness message (server, tiny)
- `client:ping` → `server:pong {now}`. It's stateless, allowed after `protocol:ready`, rate-limited by the existing per-socket token bucket, and changes no game state. The client also sends it every 25 s while visible, so a silent network change (Wi-Fi → cellular) is detected within about 30 s instead of about 60 s.

### 6.3 No lost and no duplicated chat (recommended)
- `submitGuess()` attaches `clientMsgId` (random, per message). The server keeps the last ~50 ids per player and ignores repeats.
- The client keeps unacknowledged messages (sent, but no echo with that id) and re-sends them after reconnect. A message sent into a zombie socket is then **delivered once**, never lost and never doubled.
- Without this, 6.1 still works, but a message typed during the zombie window can vanish.

### 6.4 Rehydration (already server-driven)
On `room:join` the server already sends `state:public`, `chat:update` (full history), `players:update`, quests, dailies and the ritual state, and supersedes the old socket for the same account (no duplicate identity). The client must just **discard local timers and interpolation on resume** and adopt the fresh `state:public`. The timer already reconciles on every broadcast; add an explicit reset on resume.

---

## 7. Performance (incremental, no framework)

| Item | Win | Risk |
|---|---|---|
| **Gzip/Brotli for text responses** (HTML/CSS/JS/JSON), respecting `Accept-Encoding` | 1.72 MB → ~0.42 MB first load | Low. Keep `no-store` semantics as is |
| **Serve one logo, sized for its use** (WebP, about 2× display width) | ~3.8 MB → < 150 KB on the access/join screens | Low. Visual check only |
| Resize the `toxic-drop` icon | 1.1 MB → < 20 KB | Low |
| `loading="lazy"` / `decoding="async"` on chat media and below-the-fold images | Faster first paint | Low |
| Avatar transfer | Already done: roster avatars are sent once per connection | — |
| Avoid overlay rebuilds | Already done for quest/daily overlays; apply the same rule to any mobile view | — |
| Defer non-CASUAL modules (Kaladont, IKS, shadow market, ritual) on mobile | Less parse time | **Deferred to 0.2+.** Needs care with the stale-page guard |

Recommended separately, before or with Alpha 0.1: moving avatars out of `players.json` (proposed earlier). It's not a mobile-client change, but mobile increases avatar churn.

---

## 8. Test plan

**Automated (runs in CI; Chromium is available and Playwright can be added as a dev dependency):**
1. `tests/mobile-shell.js`, Playwright at 430×932 with `hasTouch`/`isMobile`:
   - The shell activates.
   - The CHAT, PEOPLE and PROFILE tabs switch without a new socket (socket count assertion).
   - Sending and receiving chat work.
   - Long-press opens Reply/React.
   - An image renders within the viewport width.
   - The PEOPLE list matches the online roster.
2. `tests/mobile-resume.js`:
   - **Simulated suspension.** Set the context offline, fire `visibilitychange`, wait, then go back online and visible. The client reconnects, rejoins MASTER with the same identity, catches up on chat and adopts the server timer.
   - **Zombie socket.** Block `server:pong`, verify the forced reconnect, and check that a message typed during the zombie window arrives exactly once.
3. `tests/desktop-unchanged.js`: screenshots of `join.html` (joined, CASUAL and BATTLE) at 1920×1080 and 1366×768 before and after, **pixel-compared against baselines committed from `main` before the first mobile commit**. Plus a check that `index.html` doesn't load `mobile.css` or `mobile-shell.js`.
4. The existing suite (60 files) stays green.

**Manual (real devices, before calling 0.1 done):**
- iPhone 14 Pro Max, Safari, portrait and landscape: the 15 Alpha 0.1 criteria.
- Background, lock, 5 min, return. Wi-Fi → cellular. Airplane mode for 2 min. Keyboard open while messages arrive.
- One Android Chrome device.
- Mixed room: GM desktop + Little Hero desktop + iPhone + Android in MASTER together.

---

## 9. Phased implementation (Alpha 0.1 as small PRs)

| Step | PR | Contents | Gate |
|---|---|---|---|
| 0 | **Baselines** | Playwright dev dependency; desktop layout-fingerprint baseline from `main` (`tests/desktop-layout-baseline.js`); mobile isolation guard (`tests/mobile-isolation.js`); browser harness (`tests/lib/`) | CI green, baselines committed |
| 0b | **Avatar storage** | Avatars out of `players.json` into per-avatar files, served cacheably; automatic migration (decision 5) | Existing suite + new migration tests green |
| 1 | **Quarantine** | Re-scope the existing phone rules to `html:not(.asoc-mobile)`; no visual change | Desktop pixel-identical; existing phone layout unchanged |
| 2 | **Session survival** | §6.1 + §6.2 (+ §6.3); applies to desktop too and is invisible there | `mobile-resume` green; existing suite green |
| 3 | **Weight** | Gzip, logo and icon fixes, lazy media, manifest `start_url` | Desktop pixel-identical; payload measured |
| 4 | **Shell + CHAT** | `mobile-shell.js`, `mobile.css`, re-hosted chat, keyboard/safe areas, touch actions | `mobile-shell` green; desktop pixel-identical |
| 5 | **PEOPLE + PROFILE** | Roster view; re-hosted profile editor | Tests green; manual iPhone pass |
| 6 | **Device pass** | Real iPhone and Android checklist; fixes only | The 15 Alpha 0.1 criteria met |

Each PR is independently deployable and reversible. Steps 1–3 already improve desktop reliability and speed without any visible change.

---

## 10. Decisions (confirmed 2026-09-28)

1. **Mobile mode is engaged manually** with a visible **MOBILE VERSION** button, not by automatic detection. The choice is remembered per device (`localStorage`), and the same control switches back to desktop. The button appears on the access/join screen and in the in-game menu. Capability detection (`pointer: coarse`) is used only to decide where the button is offered prominently, never to switch on its own. This supersedes the automatic switch in §4.1: `html.asoc-mobile` is set from the stored choice, not from a media query.
2. **Battle requires landscape.** In BATTLE_ARMED/BATTLE the mobile shell shows the game only when the phone is horizontal: **board on top, chat below**. A phone held upright during a battle shows chat plus a **"Turn your phone sideways to play"** prompt, and chat stays live either way. AMUSEMENT PARK (CASUAL) remains portrait-first.
   - *Open detail, to be shown on a real layout:* at 932×430 (iPhone 14 Pro Max, landscape) a full-width board is about 620 px tall, taller than the screen, so "chat below" means scrolling to reach chat. The alternative is fitting the board to the screen height with chat beside it. The first implementation follows the stated preference (board on top, chat below) and is reviewed on device.
   - Rendering in 0.1 reuses the existing authoritative board view scaled to the landscape width; the dedicated column-by-column mobile board remains Alpha 0.2.
3. **Chat message IDs (§6.3) are in Alpha 0.1.**
4. **Playwright is a dev dependency** (pinned `1.56.1`) for browser-level tests: the desktop layout baseline and the mobile shell and resume tests.
5. **Avatar storage moves out of `players.json` before the mobile shell** (before step 4 in §9).

## 11. Risks

- **iOS WebKit specifics** (keyboard, `visualViewport`, bfcache) can't be fully automated here. CI uses Chromium, so real-device passes are mandatory.
- **Node re-hosting of `#chat-panel`:** any code that caches layout measurements of the chat container (virtual scroll anchors, picker positioning) must recompute after the move. This is audited in step 4.
- **The inline CSS in `join.html`** is large and partly player-only. Moving it into a file is desirable (cacheable, reviewable) but is **not** part of Alpha 0.1, to keep diffs reviewable.
- **Stale-page guard:** every client release still bumps the `player.js` build; with no service worker (by design until 0.4), there is no stale-cache risk.

## 12. Progress log

| Step | Shipped | What it does | Guarded by |
|---|---|---|---|
| 0 | PR #36 | Playwright harness, desktop layout fingerprint | `desktop-layout-baseline`, `mobile-isolation` |
| 0b | PR #36 | Avatars as content-addressed files | `avatar-storage` |
| 1 | PR #40 | Legacy phone CSS re-scoped behind a zero-specificity `:where(html:not(.asoc-mobile))` guard by `scripts/quarantine-phone-css.js`; phone-width and desktop fingerprints identical before/after | `mobile-isolation` fails on any new unquarantined phone rule |
| 2 | PR #42 | `client:ping`/`server:pong` liveness; zombie socket replaced on resume; never gives up while visible (no `alert`); `clientMsgId` exactly-once chat | `mobile-resume` |
| 3 | this batch | gzip text, WebP copies of large PNGs (hash-verified via `assets/.webp/manifest.json`), immutable caching of versioned assets, manifest `start_url` `/join.html` — first load 17.7 MB → 3.6 MB | `page-weight` |
| 4 | this batch | MOBILE VERSION shell: opt-in button (phones get a dismissible offer, even on the access gate); CASUAL chat-first layout; battle upright = "turn sideways" banner + live chat; battle sideways = board on top, chat below; DESKTOP VERSION switches back | `mobile-shell` |

### To review on a real phone (step 6)

1. **Landscape board height.** At 844×390 the timer + WOMF bars take ~250 px before the board starts, and the board itself is taller than the screen, so reaching chat means scrolling. Options if it feels too long: compact the timer/WOMF bars in landscape, or fit the board to the screen height with chat beside it (the alternative noted in decision 2).
2. **Keyboard.** The shell sizes itself to `visualViewport` so the composer should stay above the keyboard on iOS and Android — verify on both.
3. **Mini-games, leaderboard strip, private-message rail** are hidden in the shell for 0.1 (DMs still open full screen from the MESSAGES chip). Step 5 adds PEOPLE/PROFILE tabs.
4. **Desktop app microphone** (voice messages) needs a new desktop build to take effect.

### Re-running the tooling

- New artwork: `node scripts/optimize-images.js` (rebuilds only changed PNGs; the server ignores any copy whose PNG hash changed, so forgetting this only costs weight, never shows stale art).
- New phone CSS in `join.html` or player stylesheets: `node scripts/quarantine-phone-css.js <files>` (the isolation test names the file).
