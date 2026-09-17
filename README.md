# ASOC Engine

A local web application for running ASOC (A Strange Odd Connection) games.

## Quick Start

### Prerequisites
- **Node.js 18+** (required for Phase 2 multiplayer server)

### Installation
```bash
cd "A:\ASOC ENGINE"
npm install
```

### Running
```bash
npm start
```

Opens on **http://localhost:8080**

For LAN multiplayer, other devices use:
**http://<GM-PC-LAN-IP>:8080/join.html**

---

## Controls

### Gamemaster Panel (index.html)
- **Clue Grid**: Individual REVEAL/HIDE buttons for each cell (A1-D5, FINAL)
- **Column Controls**: REVEAL/HIDE entire columns at once
- **Global Actions**: 
  - REVEAL ALL / HIDE ALL
  - RESET BOARD (clears all reveals)
  - UNDO LAST (Ctrl+Z) — *local mode only*
- **Background**: Dropdown to swap background images
- **Game**: Current game title/difficulty, GAME LIBRARY + NEW GAME buttons
- **Multiplayer**: HOST ROOM / CLOSE ROOM, room code display, player list, NEXT GAME button

### Public View
- Clean player-facing board showing only revealed information
- No controls, no hidden answers, no GM notes

### Player Join (join.html)
- Enter room code and name
- Instantly see current board state
- Auto-reconnect on connection loss
- Submit guesses in chat panel beneath board

### Gamemaster Chat (index.html)
- GUESSES panel shows all player submissions
- Each message shows ❌ WRONG / 🖤 CORRECT buttons
- CORRECT opens target selector: [A] [B] [C] [D] [FINAL]
- Automatic solution reveal on correct verdict
- Solved count: SOLVED: X/5

---

## File Structure

```
ASOC ENGINE/
├── index.html          # Gamemaster interface
├── join.html           # Player join page
├── server.js           # Node.js HTTP + WebSocket + API server
├── game-store.js       # Server-side game/background filesystem module
├── scoring-constants.js # Centralized, tunable scoring point values
├── player-store.js     # Persistent player profile storage (players.json)
├── players.json        # All-time player profiles (generated, gitignored)
├── package.json        # Dependencies & scripts
├── css/
│   └── asoc.css        # All styles (ASOC variables, board, forge, scoring)
├── js/
│   ├── skeleton.js     # Canonical board skeleton (word anchor positions)
│   ├── game-data.js    # Game data, API client, GM token, Excel import
│   ├── board.js        # Board rendering, session state, preview
│   ├── app.js          # Gamemaster app coordination + WebSocket + scoring UI
│   ├── forge.js        # The Forge: Game Library + Game Creator
│   └── player.js       # Player join page logic + scoring UI
├── games/
│   └── *.json          # Game files (API-managed, not served statically)
├── assets/
│   ├── backgrounds/    # Background images (png/jpg/webp/svg)
│   ├── ui/             # Reserved for UI assets
│   └── sounds/         # Reserved for future audio
└── README.md
```

---

## Canonical Difficulty Scale

ASOC uses exactly five difficulty tiers:

| Tier | Visual Identity |
|------|-----------------|
| **GREEN** | Green |
| **YELLOW** | Yellow |
| **RED** | Red |
| **PURPLE** | Purple |
| **BLACK** | Black/Dark |

Valid JSON value:
```json
"difficulty": "GREEN"
```

---

## Game JSON Format

```json
{
  "id": "unique-game-id",
  "title": "Display Title",
  "theme": "Theme Name",
  "background": "assets/backgrounds/image.jpg",
  "difficulty": "GREEN|YELLOW|RED|PURPLE|BLACK",
  "columns": {
    "A": { "clues": ["A1","A2","A3","A4"], "solution": "A5" },
    "B": { "clues": ["B1","B2","B3","B4"], "solution": "B5" },
    "C": { "clues": ["C1","C2","C3","C4"], "solution": "C5" },
    "D": { "clues": ["D1","D2","D3","D4"], "solution": "D5" }
  },
  "finalSolution": "FINAL ANSWER",
  "story": "Optional flavor text",
  "gmNotes": "Private GM notes",
  "hints": ["Hint 1", "Hint 2"],
  "created": "YYYY-MM-DD"
}
```

**Structure is fixed:** 4 columns (A-D), 4 clues per column, 5th position = column solution. A5+B5+C5+D5 → FINAL SOLUTION. Do not create configurable row counts or alternative board layouts.

---

## Three Data Layers

### GAME DATA (Permanent Puzzle Definition)
- title, theme, background, difficulty
- clues, column solutions, final solution
- story, GM notes, hints
- **Never modified by normal gameplay**

### SESSION STATE (Current Running Session)
- which cells are revealed (`cells: { "A1": true, ... }`)
- whether final solution is revealed (`finalSolution: false`)
- action history / undo information
- **Serializable, separate from Game Data**

### PUBLIC STATE (What Remote Players May Know)
- Sanitized representation containing ONLY currently visible information
- Hidden values **completely omitted**, not just marked as hidden
- Produced by `Board.exportPublicState()` and sent via WebSocket

Example `exportPublicState()` / WebSocket `state:public`:
```json
{
  "roomCode": "K7RX",
  "gameId": "sample-001",
  "title": "Sample ASOC Game",
  "theme": "Mystery",
  "difficulty": "GREEN",
  "revision": 12,
  "background": "assets/backgrounds/sample-bg.svg",
  "cells": {
    "A1": { "revealed": true, "value": "First clue for column A" },
    "A2": { "revealed": false },
    "A5": { "revealed": true, "value": "Column A Solution" }
  },
  "finalSolution": { "revealed": false },
  "timestamp": "2026-09-17T..."
}
```

---

## Multiplayer Architecture (Phase 2)

### Server Authority
The Node.js server (`server.js`) is the **single source of truth** for multiplayer sessions.

```
┌─────────────┐     WebSocket      ┌─────────────┐
│  GM Client  │ ◄────────────────► │   Server    │ ◄────────────────► │ Player Clients │
│  (host)     │   Commands + State │  (authority)│   State (sanitized)  │ (join.html)    │
└─────────────┘                    └─────────────┘                    └────────────────┘
```

### Room Structure
```js
Room {
  code: "K7RX",              // 4-char uppercase code
  gameId: "sample-001",      // References games/sample-game.json
  gameData: {...},           // Full game definition (GM only)
  revision: 17,              // Monotonically increasing
  sessionState: {
    cells: { "A1": true, ... },
    finalSolution: false
  },
  currentBackground: "assets/backgrounds/sample-bg.svg",
  players: Map<WebSocket, { id, name, connected }>,
  hostConnection: WebSocket, // GM's socket
  hostToken: "abc123...",    // For host reconnection
  hostReconnectTimer: Timer  // 60s grace period
}
```

### WebSocket Message Protocol

#### Client → Server
```json
{ "type": "room:create", "gameId": "sample-game" }
```
```json
{ "type": "room:join", "roomCode": "K7RX", "name": "Nina" }
```
```json
{ "type": "host:reconnect", "roomCode": "K7RX", "hostToken": "abc123..." }
```
```json
{ "type": "gm:command", "command": "revealCell", "payload": { "cell": "A1" }, "cmdId": 5 }
```
```json
{ "type": "chat:guess", "text": "circus" }
```
```json
{ "type": "gm:judgeGuess", "messageId": "msg-123", "verdict": "wrong" }
```
```json
{ "type": "gm:judgeGuess", "messageId": "msg-123", "verdict": "correct", "target": "FINAL", "reveal": true }
```
```json
{ "type": "gm:failFinal" }
```
```json
{ "type": "gm:revealResults" }
```
```json
{ "type": "leaderboard:getAllTime" }
```

**Valid GM Commands:**
| Command | Payload |
|---------|---------|
| `revealCell` | `{ "cell": "A1" }` |
| `hideCell` | `{ "cell": "A1" }` |
| `revealColumn` | `{ "column": "A" }` |
| `hideColumn` | `{ "column": "A" }` |
| `revealAll` | `{}` |
| `hideAll` | `{}` |
| `revealFinal` | `{}` |
| `hideFinal` | `{}` |
| `resetBoard` | `{}` |
| `changeBackground` | `{ "background": "assets/backgrounds/bg.svg" }` |

#### Server → Client
```json
{ "type": "room:created", "roomCode": "K7RX", "hostToken": "abc123..." }
```
```json
{ "type": "join:success", "playerId": "x7k9", "roomCode": "K7RX" }
```
```json
{ "type": "state:public", "roomCode": "K7RX", "gameId": "...", "title": "...", "theme": "...", "difficulty": "GREEN", "revision": 12, "background": "...", "cells": {...}, "finalSolution": {...}, "timestamp": "..." }
```
```json
{ "type": "players:update", "players": [{ "id": "...", "name": "Nina", "connected": true, "score": 400 }] }
```
```json
{ "type": "chat:update", "messages": [...], "solvedTargets": {...} }
```
```json
{ "type": "command:ack", "cmdId": 5, "revision": 13 }
```
```json
{ "type": "gm:judge:ack", "messageId": "msg-123", "verdict": "correct", "target": "FINAL" }
```
```json
{ "type": "error", "message": "Room not found" }
```
```json
{ "type": "room:closed", "message": "Host disconnected" }
```
```json
{ "type": "host:reconnected", "roomCode": "K7RX" }
```
```json
{ "type": "score:event", "awardType": "column", "target": "A", "points": 400, "cluesRevealed": 1, "playerName": "Nina" }
```
```json
{ "type": "score:streak", "activeStreak": { "playerId": "...", "playerName": "Nina", "columnCount": 2 } }
```
```json
{ "type": "score:warning", "message": "Column C has no revealed clues -- cannot award a column score." }
```
```json
{ "type": "score:finalReveal", "outcome": "success" }
```
```json
{ "type": "score:finalReveal", "outcome": "failed", "correctSolution": "THE FINAL ANSWER" }
```
```json
{ "type": "score:finalResults", "outcome": "success", "columnsKnownAtSolve": 3, "points": 500, "playerName": "Nina" }
```
```json
{ "type": "score:finalResults", "outcome": "failed", "penalty": 200, "participants": ["Nina", "Marko"] }
```
```json
{ "type": "leaderboard:allTime", "players": [{ "id": "nina", "name": "Nina", "lifetimeScore": 3400, "...": "..." }] }
```

#### Chat Message Model
```json
{
  "id": "msg-uuid",
  "playerId": "player-123",
  "playerName": "Nina",
  "text": "circus",
  "timestamp": 1789640000000,
  "verdict": "wrong" | "correct" | null,
  "target": "A" | "B" | "C" | "D" | "FINAL" | null
}
```

### Revision Synchronization
- Every authoritative state change increments `revision` (starts at 0)
- Clients ignore state messages with `revision <= lastKnownRevision`
- Prevents stale WebSocket messages from overwriting newer state
- GM client receives `command:ack` with new revision for confirmation

### Host Authorization
- Room creation generates a cryptographically random `hostToken`
- Token stored in GM's `sessionStorage` (`asoc_host_token`)
- Only the WebSocket connection presenting the valid `hostToken` can send `gm:command` messages
- Player connections (`room:join`) never receive `hostToken`
- If host disconnects, 60-second grace period allows reconnection with token

### Public-State Security (NON-NEGOTIABLE)
**Remote players MUST NEVER receive hidden information.**

| Hidden Cell | Sent to Player |
|-------------|----------------|
| `A2` (unrevealed) | `{ "A2": { "revealed": false } }` |
| `B5` (unrevealed) | `{ "B5": { "revealed": false } }` |
| `FINAL` (unrevealed) | `{ "finalSolution": { "revealed": false } }` |

**FORBIDDEN:**
```json
{ "A2": { "revealed": false, "value": "SECRET ANSWER" } }
```

The server's `getPublicState()` function explicitly omits `value` for unrevealed cells. This is enforced at the protocol level, not via CSS.

### Background Synchronization
- Background is part of live session state (`room.currentBackground`)
- GM background change → `gm:command` with `changeBackground` → server updates room → revision++ → broadcasts new `state:public` with `background` field
- Players receive new background identifier, load it, board state unchanged
- No reveal reset, no reconnection required

### Reconnection Behavior
**GM (Host):**
- 60-second grace period after disconnect
- Host token in `sessionStorage` enables `host:reconnect`
- If host returns within 60s: room restored, current state resent
- After 60s: room closed, all players notified

**Players:**
- Exponential backoff reconnect (1s, 1.5s, 2.25s... max 10s, 10 attempts)
- `sessionStorage` preserves room code, name, player ID
- On reconnect: `room:join` with stored credentials → immediate `state:public` with current board

### Chat Architecture

#### CHAT IS SESSION STATE
Chat belongs to the live room/session. It is NOT part of game JSON.

```text
GAME DATA
Puzzle definition

SESSION STATE
Reveals
Background
Revision
Chat
Guess verdicts
Solved targets

PUBLIC STATE
Sanitized board state
Public chat
Public verdicts
```

GM-only controls (verdict buttons, target selector) are never exposed to player clients.

#### Chat Security
- Players may submit guesses (`chat:guess`) and receive chat updates (`chat:update`)
- Players may NOT: mark guesses, set targets, reveal answers, edit messages, impersonate
- All adjudication (`gm:judgeGuess`) requires valid Gamemaster authority (hostToken)
- Server sanitizes all player text (HTML entity encoding) before storage/broadcast
- Max guess length: 100 characters, empty messages rejected

#### Automatic Solution Reveal
When GM marks a guess CORRECT with a target:
- Target A → reveals A5 (Column A Solution)
- Target B → reveals B5 (Column B Solution)
- Target C → reveals C5 (Column C Solution)
- Target D → reveals D5 (Column D Solution)
- Target FINAL → reveals Final Solution

Reveal happens through authoritative server state system — all clients update correctly via `state:public` broadcast.

#### Solved Targets Record
Server maintains `room.chat.solvedTargets`:
```json
{
  "A": { "solved": true, "playerId": "123", "playerName": "Nina", "messageId": "msg-88", "timestamp": 1789640000000 },
  "FINAL": { "solved": true, "playerId": "456", "playerName": "Marko", "messageId": "msg-92", "timestamp": 1789640000000 }
}
```
This is the scoring system's source of truth -- see "Scoring & Player Profiles" below.

#### GM Override (Reversible)
GM can change verdict at any time:
- WRONG → CORRECT (with target selection)
- CORRECT → WRONG (clears solved target, reverses any score it earned)
- CORRECT target changed (clears the OLD target's solved record and reverses its score before crediting the new target -- a message can only ever hold credit for one target at a time)

### LAN Testing

#### Find Host PC LAN IP (Windows)
```powershell
ipconfig | findstr IPv4
```
Look for `IPv4 Address. . . . . . . . . . . : 192.168.x.x` or `10.x.x.x`

#### Firewall
Windows may prompt "Node.js: JavaScript runtime" to allow network access. **Allow on Private networks.**

#### Test Steps
1. **GM Machine:** `npm start` → open `http://localhost:8080`
2. **GM:** Click **HOST ROOM** → note room code (e.g., `K7RX`)
3. **Player Device:** Open `http://192.168.x.x:8080/join.html`
4. **Player:** Enter room code `K7RX`, name `TEST` → JOIN
5. **GM:** Click **A1 REVEAL** in Clue Grid
6. **Player:** A1 appears instantly (no refresh)

#### Verify Checklist
- [ ] A1 hide syncs
- [ ] Column REVEAL/HIDE syncs
- [ ] REVEAL ALL / HIDE ALL syncs
- [ ] Final Solution syncs
- [ ] RESET BOARD syncs
- [ ] Background change syncs
- [ ] Late-joining player sees current state
- [ ] Hidden answers absent from WebSocket payloads (inspect Network → WS frames)
- [ ] Player refresh/reconnect restores state
- [ ] Multiple player devices receive same updates
- [ ] Player cannot send GM commands (server rejects)

---

## Scoring & Player Profiles

Automatic scoring layered on top of the existing chat-adjudication flow. The gamemaster still only identifies who guessed correctly and which target -- every point, bonus, penalty and profile stat is calculated by the server. Nothing here changes the board, the clue-reveal system, or the Progressive Clue Queue's status (still locked/not implemented -- see below).

### Column scoring
A column's score depends on how many of its four clues were revealed before it was solved (fewer clues revealed = harder = worth more):

| Clues revealed | Points |
|---|---|
| 1 | 400 |
| 2 | 300 |
| 3 | 200 |
| 4 | 100 |

A column with **zero** revealed clues cannot be scored -- the GM can still mark the guess correct (the column still reveals and counts as solved), but the server rejects the *scoring* half and sends the GM a `score:warning`, never a silent zero-as-one substitution.

### Final Solution jackpot
The Final's value depends on how many column solutions were already known when it was solved:

| Columns known | Points |
|---|---|
| 1 | 1200 |
| 2 | 800 |
| 3 | 500 |
| 4 | 300 |

Same rule as columns: solving the Final with **zero** columns known cannot be scored (rejected with a `score:warning`), but the guess can still be marked correct and the board still counts as won.

### Column streaks
Consecutive column solves by the same player earn a one-time bonus at each milestone, on top of the columns' own points:

| Streak length | Bonus |
|---|---|
| 2 | +50 |
| 3 | +125 |
| 4 | +250 |

A different player solving the next column breaks the streak; a full 4-column sweep by one player earns all three milestone bonuses (+425 total, on top of the four columns' own points). **Streaks reset every board** (including on RESET BOARD and NEXT GAME) -- they never carry between boards, even though session score does.

Because a GM correction to an earlier verdict can change who solved what and in which order, streak state is never patched incrementally: any change to a board's solved columns triggers a full rebuild of that board's streak bonuses from the current, authoritative solve history, so a corrected verdict can never leave a stale bonus in place.

### Failed Final
The GM alone decides a board is lost -- there is no timer, guess-count, or inactivity auto-fail. **DECLARE FINAL FAILED** (Scoring panel) reveals the true Final Solution in black lettering with a blood-red glow, plays out the story if the game has one, and -- only once the GM clicks **SHOW RESULTS** -- applies a flat **-200** penalty to every currently-connected player. Negative scores are allowed and never floored at zero. A board can only be finalized (won or failed) once; a second attempt is rejected.

### Session vs. all-time
Two leaderboards, never merged:
- **CURRENT SESSION** -- in-memory, scoped to the room, survives NEXT GAME (a session is one continuous room, potentially many boards), reset only by starting a new room.
- **ALL-TIME** -- persistent, in `players.json`, read by any client via `leaderboard:getAllTime`. A collapsible view in both the GM console (**ALL-TIME RECORDS**) and the player screen (**ALL-TIME**), deliberately kept out of the way of the live board/chat.

### Player identity (v1)
There are no accounts. A profile is matched by display name, trimmed and case-folded (`"Marko"`, `"marko"`, `" MARKO "` all resolve to the same profile); the stored display name reflects whichever capitalization was typed most recently. Two different real people who both type the same name share a profile -- an accepted tradeoff for a small recurring group, not a bug. `players.json` is written with a temp-file-then-rename so an interrupted write can't corrupt it, and every scoring change (award, reversal, or board finalization) is persisted immediately, not just at room close.

### Player profile fields
`name`, `createdAt`, `lastPlayed`, `lifetimeScore`, `gamesPlayed`, `gamesWon`, `columnSolutions`, `oneClueColumnSolutions`, `finalSolutions`, `earlyFinalSolutions` (Final solved before all 4 columns were known), `earliestFinalColumnsKnown` (best-ever record, only moves down), `bestColumnStreak` (best-ever record, only moves up), `purpleSolves`, `blackSolves`. The last two exist structurally but are **never incremented today** -- there is no per-column difficulty metadata yet, only a per-board `difficulty`, and inferring one from the other would be fake precision. They light up once column-level difficulty metadata is added to the game format.

`gamesPlayed`/`gamesWon` count **boards**, for every player connected when that board is finalized: a win increments both, a Failed Final increments only `gamesPlayed`. This is separate from `finalSolutions`, which only credits whoever actually typed the winning guess.

### Scoring constants
Every value above lives in `scoring-constants.js` (`COLUMN_SCORE_BY_CLUES`, `FINAL_SCORE_BY_COLUMNS`, `STREAK_MILESTONE_BONUS`, `FAILED_FINAL_PENALTY`) -- rebalance there, never inline in `server.js`.

---

## The Forge — Game Library & Creator (Phase 3)

GM-only tools for managing games and backgrounds entirely in-app. No manual JSON editing or file copying required.

### Game Library
- Open via **GAME LIBRARY** button (GM sidebar or footer)
- Lists all games in `games/` with title, theme, difficulty badge, final solution, background, modified date
- SAMPLE game is marked and **cannot be deleted**
- Actions per game: **LOAD / EDIT / DUPLICATE / DELETE** (delete requires confirmation)
- **Search** by title / theme / final answer; **sort** by newest/oldest/title/difficulty; **filter** by difficulty

### Game Creator
- Open a NEW GAME blank draft or EDIT an existing game (full data loaded first)
- Fields: TITLE, THEME, DIFFICULTY, 4 columns × (4 clues + 1 solution), FINAL SOLUTION
- Optional: STORY, GM NOTES, HINTS (one per line)
- **LIVE PREVIEW** renders the board with the same renderer as the real board (always hidden state)
- SAVE validates server-side and shows the specific error list if invalid

### Excel Import ("ASOC FOREVER SHEET" format)
- **GAME LIBRARY → IMPORT FROM EXCEL** uploads a `.xlsx` file authored in the historical ASOC FOREVER SHEET layout and turns it directly into a game draft, no manual re-entry required
- Expected layout (first worksheet with data):
  - `A1:D4` — the 4 clues for each of columns A–D, in **reveal-priority order** (row 1 = hardest/first clue shown, row 4 = easiest/last clue shown) — this is logical reveal order, not board position
  - `A5:D5` — each column's solution word
  - `A6:D6` — the puzzle's final solution, in **exactly one** of the four cells (position doesn't matter; leading/trailing whitespace is trimmed automatically)
- The importer opens the result directly in **the Game Creator** with **LIVE PREVIEW**, exactly like a manually-built game — nothing is saved until you press SAVE
- Duplicate words across clues are allowed and are never treated as errors
- Malformed workbooks are rejected with a specific error, e.g.: `INVALID ASOC GAME. Column C contains only 3 clues. Expected 4 clues in C1:C4.`

### Backgrounds
- Dropdown to pick any background in `assets/backgrounds/`
- **ADD BACKGROUND** uploads PNG / JPG / JPEG / WEBP / SVG (max 10 MB) directly from the browser
- Canonical size **1900 × 1267**; non-canonical uploads warn in the creator
- Path traversal and invalid file types are rejected by the server

### Loading & NEXT GAME
- **LOAD** (no room): replaces the local GM board with the new game, board reset hidden
- **LOAD** (with active room): confirmation prompt → server switches the room's game, clears chat/solved targets, resets reveal state, keeps room code + all players
- **NEXT GAME** button (multiplayer toolbar): opens the library restricted to the room context
- Players receive the new board + background instantly; hidden answers never appear in their payloads

### Server API (GM token required)
The GM token is obtained automatically on page load (`api/gm/token`, localhost only) and stored in `sessionStorage` as `asoc_gm_token`. All `/api/*` calls send it as `x-gm-token`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/gm/token` | Issue GM token (localhost only) |
| GET | `/api/games` | List games (metadata, no solutions) |
| POST | `/api/games` | Create/edit game (validated; `id` optional → auto-generated `asoc-<slug>-<000>`) |
| GET | `/api/games/:id` | Full game JSON (GM only) |
| POST | `/api/games/:id/duplicate` | Duplicate as "TITLE COPY" with new id/file |
| DELETE | `/api/games/:id` | Delete game file (sample protected) |
| GET | `/api/backgrounds` | List backgrounds with size info |
| POST | `/api/backgrounds/upload?filename=` | Upload background image (max 10 MB) |
| POST | `/api/games/import-xlsx?filename=` | Parse an "ASOC FOREVER SHEET"-format `.xlsx` into a game draft (validated; not saved until `POST /api/games`) |

Statically serving `/games/*.json` is **blocked (403)** — the browser never reads game files directly.

### Game Switching (WebSocket)
```json
{ "type": "gm:switchGame", "gameId": "asoc-primal-001" }   // host only
```
Server response:
- `state:public` broadcast → players rebuild board (hidden) + new background
- `chat:update` broadcast → chat cleared for everyone
- `game:loaded` → host only (full game, incl. solutions)
- `gm:switchGame:ack` → host only

### Game ID & Filename
- Stable unique id: `asoc-<slug>-<000>` (e.g. `asoc-primal-001`, `asoc-mu5g7k53-am0t`)
- File: `<slug>.json` in `games/`, sanitized to safe characters
- Duplicating `PRIMAL` → `PRIMAL COPY` with its own id + file (`primal-copy.json`)

---

## Current Status

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ Complete | Local foundation: board, data model, reveal logic, undo, backgrounds, public view |
| **Phase 2** | ✅ Complete | **THE ROOM**: Node.js server, WebSocket sync, room hosting, player join, authoritative state, public-state security |
| **Phase 2.5** | ✅ Complete | **GUESS CHAT**: Player guesses, GM adjudication (❌/🖤), target selection, auto-reveal, solved tracking |
| **The Forge** | ✅ Complete | **GAME LIBRARY + CREATOR**: in-app game/background management, live preview, NEXT GAME room switching, Excel import |
| **Scoring & Profiles** | ✅ Complete | Automatic column/Final scoring, column streaks, Failed Final penalty, session + all-time leaderboards, persistent player profiles |
| **Phase 4** | ⏳ Planned | Teams, timers, buzzer, QR codes, room persistence across restarts |

---

## Phase 2 / 2.5 / The Forge Limitations (Known)

- **No persistent room storage** — rooms (and current-session scores) live in server memory only; restart = rooms and session leaderboards lost. Player profiles/all-time stats in `players.json` survive a restart just fine.
- **No host migration** — if GM doesn't reconnect in 60s, room closes
- **No teams, timers, buzzer, or QR codes** — scoring is per-player, reveal pacing is entirely GM-controlled, room joining is manual room-code entry only
- **Purple/Black solve tracking is structural only** — the fields exist on every profile but are never incremented yet; there is no per-column difficulty metadata to key off, only a per-board one
- **Local undo only** — multiplayer undo requires manual inverse action
- **No answer validation** — GM is sole judge, no automatic checking
- **Chat history limit** — 200 messages max per room
- **No background deletion** — background files can be added/selected but not removed via UI
- **No game rename** — game id/file name is fixed after creation (edit only changes content)
- **Sample game protected** — the SAMPLE board cannot be deleted, only duplicated/edited

---

## LOCKED SPEC — Progressive Clue Queue (NOT YET IMPLEMENTED)

**Status: locked design decision, not built. Do not implement until explicitly instructed — this is a gameplay-logic change, not a visual one, and it touches `Board`, `server.js`'s `applyCommand`/`getPublicState`, `game-store.js`'s data shape, `Forge`'s creator, and undo. Recorded here so the rule is fixed before any of that code is touched.**

### The rule

For each of the four playable columns (A, B, C, D), the four clues (rows 1–4) have a fixed, permanent difficulty order that must always be preserved:

1. hardest / most obscure
2. somewhat clearer
3. more directional
4. clearest / easiest

The GM may reveal any unopened physical slot in that column, in any order. **The GM chooses WHERE a clue appears (which slot); the GM does not choose WHICH clue appears** — that is determined solely by how many slots in that column have already been opened. The Nth reveal in a column always shows that column's Nth-hardest clue, regardless of which physical slot receives it.

Example — column A clues stored as `[hardest, harder, clearer, easiest]`. If the GM reveals slots in the order A3, A1, A4, A2, the content placed in each slot is:

- A3 → clue #1 (hardest)
- A1 → clue #2
- A4 → clue #3
- A2 → clue #4 (easiest)

This applies independently and identically to A1–A4, B1–B4, C1–C4, D1–D4. **A5/B5/C5/D5 (column solutions) and FINAL are unaffected** — they stay fixed-coordinate reveals, not part of any queue.

### Data model implication

Do not permanently bind `A1 = clues[0]`, `A2 = clues[1]`, etc. A column's `clues` array is an ordered queue, consumed front-to-back as slots are opened — not a coordinate-to-content map. Session state needs, per column, which physical slots are open and which queue index each received, plus the next index to hand out:

```js
// session state, per column
A: {
  revealedSlots: { A3: 0, A1: 1, A4: 2 },  // slot -> clueIndex it received
  nextClueIndex: 3
}
```

When another unopened A-slot is picked, it receives `nextClueIndex` (3 in the example above), then `nextClueIndex` increments.

**The reveal action means:** "open this physical slot and place the next unused clue from that column's queue into it" — **not** "reveal the clue permanently assigned to this coordinate." This is the core semantic change from how reveals currently work (today, `revealCell` just flips `sessionState.cells[key]` and the content is a fixed lookup by coordinate — that lookup-by-coordinate assumption goes away for A1–D4 under this spec).

### Reset

`resetBoard` must clear all slot assignments in every column AND reset every column's queue back to index 0 (clue #1 / hardest). A reset column starts fully re-queued, not just re-hidden.

### Undo

Undo must roll back three things atomically for a queue-column reveal, not just the visible/hidden flag:
- the physical slot returns to hidden
- that column's `nextClueIndex` decrements back
- the slot-to-clueIndex assignment for that slot is removed

Example: A3 receives clue #1, then A1 receives clue #2, then UNDO → A1 returns to hidden, and the next reveal anywhere in column A must again hand out clue #2 (A3 keeps its already-assigned clue #1; only the most recent assignment unwinds).

### Multiplayer

Server stays authoritative (same principle as today's `getPublicState()`). A player must only ever receive clue text for a slot once that slot has actually been revealed and assigned a queue index — the still-unopened clues in a column's queue (including which clue is "next") must never be present in any `state:public` payload, same non-negotiable rule as hidden cells today.

### Forge / Creator

The Forge preserves clue input order exactly as entered — never auto-sorts or reorders it. The Creator's four clue fields per column should be visually labeled to communicate the fixed order, e.g.:

```
CLUE 1 — HARDEST
CLUE 2
CLUE 3
CLUE 4 — EASIEST
```

### Acceptance test

Column A clues: `1 = OBSIDIAN, 2 = VOLCANIC, 3 = ERUPTION, 4 = LAVA`.

Reveal order A4, A2, A1, A3 → expected: A4=OBSIDIAN, A2=VOLCANIC, A1=ERUPTION, A3=LAVA.

Reset. Reveal order A1, A2, A3, A4 → expected: A1=OBSIDIAN, A2=VOLCANIC, A3=ERUPTION, A4=LAVA.

The clue sequence (OBSIDIAN → VOLCANIC → ERUPTION → LAVA) must be identical in both runs regardless of which physical slots were chosen or in what order.

---

## Visual Notice

The metallic CSS interface is the current ASOC skin: dark cinematic metallic look using `--asoc-*` variables (silver frame, translucent panels, gold column solutions, red→magenta→purple FINAL solution).
Fixed canonical geometry (1900 × 1267) is kept. The Forge creator includes a live same-renderer preview.

---

## Architecture Notes for Future Phases

- `GameData.currentGame` = immutable puzzle definition
- `Board.sessionState` = mutable reveal state (serializable)
- `Board.history` = action log for undo (serializable, local only)
- `Board.exportPublicState()` = sanitized state for remote clients
- Server `rooms` Map = in-memory room registry (replaceable with Redis/DB later)
- Revision-based sync = ready for operational transform / CRDT if needed
- No DOM coupling in core logic — WebSocket sync layer cleanly separated

---

## Adding Games

Use **The Forge** (GAME LIBRARY → NEW GAME) — no manual JSON editing needed.
For advanced users, a game JSON may still be dropped into `games/` following the canonical format; it will appear in the library on the server's next scan (page reload or library open).
Already have the puzzle authored in Excel? Use **GAME LIBRARY → IMPORT FROM EXCEL** instead — see "Excel Import" above for the expected `.xlsx` layout.

## Adding Backgrounds

Use the creator's **ADD BACKGROUND** upload, or place image files directly in `assets/backgrounds/`.
- Supported: PNG, JPG, JPEG, WebP, SVG (server-rejected otherwise)
- Max upload size: 10 MB
- Canonical: **1900 × 1267** (3:2 ratio) — non-canonical images display without distortion (object-fit: contain) and warn in the creator
- Select from Background dropdown in GM panel or in the creator

## WebSocket Message Protocol Additions

#### Client → Server
```json
{ "type": "gm:switchGame", "gameId": "asoc-primal-001" }
```

#### Server → Client
```json
{ "type": "game:loaded", "game": { "id": "asoc-primal-001", "title": "PRIMAL", "columns": {...}, "finalSolution": "..." } }
```
```json
{ "type": "gm:switchGame:ack", "gameId": "asoc-primal-001" }
```

`game:loaded` is sent to the **host only**. Players only ever see the accompanying public `state:public`.