# AGENTS.md — ASOC ENGINE

This file is the mandatory orientation for any coding agent working in this repository.

## Read order before changing anything

1. Read this file completely.
2. Read `.codex/PROJECT_HANDOFF.md`.
3. Read the relevant sections of `README.md`.
4. Read `HANDOFF.md` for reliability/history context.
5. Only then read the task-specific brief, if one exists.

Do not begin by editing code. First understand the product, architecture, invariants, and visual rules.

---

## What ASOC is

ASOC ENGINE is a local/LAN multiplayer association-puzzle game run by a gamemaster.

The canonical board has four columns, A-D. Each column has four clues and one column solution. The four column solutions combine into one final answer.

Canonical logical structure:

- A1-A4 = clues, A5 = column solution
- B1-B4 = clues, B5 = column solution
- C1-C4 = clues, C5 = column solution
- D1-D4 = clues, D5 = column solution
- A5 + B5 + C5 + D5 => FINAL

The board geometry is fixed and is not a general-purpose configurable grid.

Current difficulty tiers are:
GREEN, YELLOW, AMBER, RED, PURPLE, BLACK.

---

## Core product surfaces

- `index.html` = gamemaster console
- `join.html` = player-facing join/game screen
- Public View = sanitized player-facing board surface driven from shared board rendering
- `server.js` = authoritative Node.js HTTP/WebSocket server
- `js/skeleton.js` = canonical board skeleton/shared rendering helpers
- `js/board.js` = board state/rendering
- `js/app.js` = GM app coordination, WebSocket handling, GM chat/scoring UI
- `js/player.js` = player client, player chat, Little Hero HUD
- `js/themes.js` = Little Hero theme registry
- `css/asoc.css` = shared/global styles
- `player-store.js` = persistent Little Hero/player profiles
- `game-store.js` = game/background filesystem layer
- `scoring-constants.js` = scoring values
- `tests/` = regression suite

The server is the multiplayer source of truth. Clients do not get to invent authoritative game/scoring state.

## Three data layers

Keep these separate:

### Game data
Permanent puzzle definition: title, theme, background, difficulty, clues, column solutions, final solution, story, GM notes, hints.

### Session state
Current match state: reveals, clue queue, timer, WOMF, scoring, chat, etc.

### Public state
Sanitized state sent to players. Hidden answers must be omitted, not merely flagged.

Do not leak unrevealed clue/solution content into player/public payloads.

---

## Progressive Clue Queue

This is implemented and must not be casually rewritten.

Within each column, clue content has a fixed hardest-to-easiest logical order. A player/GM may reveal any unopened physical slot, but the content assigned is the next clue in the column queue.

Physical slot choice controls WHERE the clue appears.
Queue order controls WHICH clue appears.

Manual hide does not unassign a clue. Re-reveal restores the same assigned clue. Reset/new game clears the queue. Row-5 solutions and FINAL remain fixed-coordinate reveals.

---

## Multiplayer / authority rules

- `server.js` is authoritative.
- Every meaningful multiplayer state change increments revision.
- Clients ignore stale revisions.
- Host-only actions must stay host-only.
- Player identity reconnect behavior is intentionally stable within a room.
- Active rooms are crash-recoverable from runtime persistence.
- Do not weaken static-file lockdown or expose server/private files.
- Do not trust client-supplied identity discriminators that are meant to be server-set.

If a UI-only task does not require server changes, do not touch server behavior.

---

## Shadow Broker rules

Shadow Broker is an identity/presentation layer, not a second game-state system.

- Shared markup builder lives in `Skeleton.shadowBrokerTransmissionHTML(...)`.
- Do not duplicate Broker markup separately in GM/player code.
- Verdict responses are additive to the original guess/verdict styling.
- Free-form GM transmissions work with or without a hosted multiplayer room.
- First chat hydration must not replay old Broker messages as new.
- GM board, Public View, and player screen Broker board-line behavior must stay synchronized.

Read the Shadow Broker section in `README.md` before changing anything in that feature.

---

## Little Hero theme system — VERY IMPORTANT

The player theme registry lives in `js/themes.js`.

Locked lineup:

1. SKYNET — internal id `gunmetal`
2. SUGARCOAT — `pink-protocol`
3. VERDANTIS — `verdantis`
4. MY SINDRAGOSA — `my-sindragosa`
5. DISCO INFERNO — `disco-inferno`
6. OUR THEME — `our-theme`
7. THE UNDERCITY — internal id `undead`
8. REVAN — `revan`

The server also has an allowlist in `server.js`. Preserve ID compatibility.

### Sacred board rule

PLAYER THEMES MUST NEVER RECOLOR OR TINT THE ACTUAL GAME BOARD ARTWORK OR GAMEPLAY ELEMENTS.

This is not a preference. It is a locked design invariant.

Theme art may affect surrounding UI surfaces such as:
- the outer player shell
- Battle Comms/background rail
- Little Hero Status surfaces
- message-card skins
- selector preview/materials

Theme art must NOT affect:
- authored game-board background/artwork
- clue frames
- clue text
- logos embedded in the board
- gameplay icons
- board slots
- board borders/strokes unless the element is explicitly a separate themed background surface

Do not reintroduce a board tint, overlay, wash, pseudo-element, filter, opacity layer, or backdrop effect over the board.

### Bounds rule

Theme ornamentation must NEVER escape the bounds of the component it belongs to.

Use clipping/overflow containment as necessary. No decorative pseudo-element should visibly leak out of:
- Battle Comms
- status module
- message card
- selector
- any other themed component

### Foreground/background separation rule

A themed background surface and the chat/message cards sitting on it must not use the same material treatment.

Example:
- Verdantis background = roots/moss/forest overgrowth.
- Verdantis chat cards = neutral bark-charcoal foreground slabs.

Messages must read as foreground objects, not dissolve into the scenery.

### Live UI rule

Generated theme artwork is a SKIN, not a screenshot replacement.

Keep live:
- names
- avatars
- scores
- timestamps
- verdict labels
- buttons
- reply/edit controls
- counters
- chat text
- input fields
- selection state
- all gameplay behavior

Do not flatten these into raster text baked into artwork.

---

## Current visual philosophy

ASOC themes are material identities, not simple recolors.

SKYNET is the reference example:
- black/gunmetal machine material
- restrained chrome reflection
- sparse machine-cortex/neural detail
- tiny restrained red life signals
- board remains the highest-contrast gameplay object

SUGARCOAT:
- fairy/candy fantasy
- pink resin/gloss
- lollipop/fairy motifs
- deliberately feminine/girly styling

VERDANTIS:
- living forest/reclaimed machinery
- roots, moss, leaves, mushrooms, bioluminescent growth
- decoration stays behind the chat cards
- chat cards remain distinct foreground objects

MY SINDRAGOSA:
- frozen necropolis / undead dragon ice
- literal approved image assets are now staged under `assets/themes/my-sindragosa/`
- the task-specific brief requires using those PNGs themselves, not CSS approximations

---

## Chat / verdict behavior

GM judgment is authoritative.

Current chat behavior includes:
- player guesses
- wrong/correct verdicts
- verdict visuals
- delayed reveal behavior
- Shadow Broker responses
- score/session updates
- player message theming

Do not change scoring/reveal semantics merely to restyle chat.

Correct and wrong verdict colors/visuals are semantic and should remain legible over any theme.

---

## Runtime and testing

Node.js 18+.

Typical local run:
`npm start`

App port:
`8080`

Regression suite:
`npm test`

Expected successful ending:
`ALL ASOC REGRESSION TESTS PASSED`

The player-store corruption test intentionally emits corruption/recovery warnings. Those warnings are expected. The exit code and PASS lines determine success.

Before committing:
- run `node --check` on changed JS/server files
- run `git diff --check`
- run `npm test`

For client-only HTML/CSS changes, no server restart is required. Browser refresh loads them.
For `server.js` runtime changes, restart the Node server before claiming the live process is updated.

---

## Git discipline

- Keep changes surgical.
- Do not commit runtime files such as `players.json`, `players.json.bak`, `active-rooms.json`, logs, or generated deployment runtime state unless explicitly requested.
- Do not silently modify unrelated games/content.
- Do not rewrite working systems while solving a visual task.
- Preserve existing compatibility IDs and selectors unless there is a compelling reason to migrate them.
- Make descriptive commits.
- Push only after validation succeeds.

---

## Current Codex work branch

Current prepared branch:
`codex/my-sindragosa-literal-assets`

This branch contains the six literal MY SINDRAGOSA PNG assets and a task brief at:
`.codex/TASK_MY_SINDRAGOSA_LITERAL_ASSETS.md`

Before executing that task, read:
- this `AGENTS.md`
- `.codex/PROJECT_HANDOFF.md`
- relevant `README.md` sections
- `HANDOFF.md`

Then inspect the current CSS/DOM and implement without breaking the invariants above.

The user expects literal implementation, not an approximation.
