# ASOC ENGINE — FULL CODEX PROJECT HANDOFF

This document introduces Codex to the project before any task-specific implementation.

## 1. Product summary

ASOC ENGINE is a local/LAN multiplayer association-puzzle game with a GM-controlled board and player clients.

The game is intentionally rigid rather than generic:
- four columns: A, B, C, D
- four clues per column
- row 5 is that column's solution
- the four column solutions combine into one FINAL answer
- the GM controls reveal flow and judges player guesses
- multiplayer state is server-authoritative

The product now includes:
- GM console
- player join/game screen
- Public View
- Progressive Clue Queue
- player guess chat + GM adjudication
- scoring and persistent player profiles
- Timer + Borrowed Time
- WOMF / Wheel of Misfortune
- Shadow Broker identity/transmissions
- Forge game library/creator + Excel import
- active-room crash recovery
- Little Hero identities and themes
- permanent regression tests

## 2. Repository and branch

GitHub:
`thembones90-sudo/ASOC`

Primary branch:
`main`

Prepared Codex work branch:
`codex/my-sindragosa-literal-assets`

The prepared branch contains the six approved MY SINDRAGOSA PNG assets and the task brief.

## 3. Core architecture

### Front end
- `index.html`: GM control surface
- `join.html`: player-facing screen
- `css/asoc.css`: shared styles and GM-specific theme message styling
- `js/skeleton.js`: canonical board skeleton and shared rendering helpers
- `js/board.js`: board state/rendering
- `js/app.js`: GM app orchestration, WebSocket, chat, scoring UI
- `js/player.js`: player app, player chat, Little Hero HUD
- `js/themes.js`: Little Hero theme registry

### Server/back end
- `server.js`: HTTP + WebSocket server and multiplayer authority
- `game-store.js`: game/background filesystem access
- `player-store.js`: persistent player profiles
- `scoring-constants.js`: scoring values
- `games/*.json`: puzzle definitions
- `active-rooms.json`: runtime crash-recovery state, not source
- `players.json`: runtime player data, not source

### Tests
- `tests/player-store-protection.js`
- `tests/run.js`

The server owns authoritative multiplayer state. UI code should not duplicate or bypass server rules.

## 4. State model

The codebase intentionally separates three layers:

### Game data
Permanent puzzle definition. This is not mutated by normal gameplay.

### Session state
Current room/match state: reveals, clue assignments, score, timer, WOMF, chat, etc.

### Public state
Sanitized state sent to players. Hidden clue/solution text must not be present in unrevealed payloads.

Do not leak hidden answers through convenience fields, data attributes, debug objects, or client-only preloading.

## 5. Progressive Clue Queue

This is already implemented and is not speculative.

For A1-A4/B1-B4/C1-C4/D1-D4:
- clue arrays are ordered hardest -> easiest
- the first NEW physical slot revealed in a column receives clue #1
- the next new physical slot receives clue #2, and so on
- physical slot controls position
- queue order controls clue content
- hiding does not unassign
- re-revealing the same slot restores the same clue
- reset/new game clears the queue
- row-5 solutions and FINAL remain fixed-coordinate

Do not simplify this back into slot-number = clue-number behavior.

## 6. Multiplayer and reliability invariants

Important completed reliability work includes:
- static server allowlisting/lockdown
- stable player reconnect identity
- Shadow Broker local TRANSMIT behavior
- reset-board synchronization
- active-room crash recovery
- cryptographic IDs/tokens
- WebSocket heartbeat cleanup
- player-store corruption protection
- permanent regression tests

Do not weaken these while doing product polish.

Key rules:
- host-only messages/actions remain host-only
- revision synchronization stays monotonic
- stale client state must not overwrite newer server state
- disconnected identities are intentionally recoverable
- runtime storage corruption must fail safely rather than overwrite evidence
- private/server files stay outside public static serving

## 7. Shadow Broker

Shadow Broker is a shared presentation/identity system layered over the existing game.

Critical rules:
- shared markup builder: `Skeleton.shadowBrokerTransmissionHTML(...)`
- do not fork duplicate markup into `app.js` and `player.js`
- verdict response bubbles are additive; they do not replace the original guess/verdict
- free-form GM transmissions work in both hosted and local GM modes
- first chat history hydration must not trigger old transmissions as new
- GM board, Public View, and player board-line rendering must stay synchronized
- source identity fields that are meant to be server-set must never be trusted from players

Read the full Shadow Broker section in `README.md` before editing that feature.

## 8. Scoring and chat

The GM judges player guesses. The server handles scoring and authoritative state updates.

Do not restyle a chat surface by changing scoring, target reveal, verdict semantics, or timing behavior.

Current UX includes:
- wrong/correct judgment
- verdict-specific styling
- Shadow Broker responses
- scoring updates
- player/session identity
- message author themes
- delayed reveal flow for correct answers

Semantic verdict colors and readability override decorative theme concerns.

## 9. Little Hero theme system

Theme registry:
`js/themes.js`

Server theme allowlist:
`server.js -> LITTLE_HERO_THEMES`

Locked lineup:
1. SKYNET / `gunmetal`
2. SUGARCOAT / `pink-protocol`
3. VERDANTIS / `verdantis`
4. MY SINDRAGOSA / `my-sindragosa`
5. DISCO INFERNO / `disco-inferno`
6. OUR THEME / `our-theme`
7. THE UNDERCITY / `undead`
8. REVAN / `revan`

Do not rename internal IDs casually; profile persistence and server validation depend on them.

### Sacred board rule

The actual authored board artwork is NEVER themed.

Do not:
- tint it
- recolor it
- apply theme filters
- place theme pseudo-elements over it
- overlay fog/frost/roots/candy/neural effects onto it
- alter clue frames, board logos, or gameplay elements as a side effect of a player theme

Themes belong to surrounding interface/background surfaces only.

### Component-bounds rule

Theme art must never visibly escape the component that owns it.

This is a locked visual rule established after Verdantis decoration leaked beyond Battle Comms. Use `overflow:hidden`, clipping, and sane positioning.

### Background/foreground separation

The container/background skin and chat-card skin must be visually distinct.

Example already fixed:
- Verdantis Battle Comms = forest/reclaimed growth
- Verdantis messages = neutral dark bark-charcoal cards

Never make chat cards disappear into the themed panel behind them.

### Live UI over skins

Theme artwork is visual chrome only.

All real data remains live DOM:
- avatar
- player name
- score/rank/streak/link
- timestamp
- message text
- verdict text
- reply/edit buttons
- counters
- selector state
- input controls

Do not use rasterized text from a concept image as actual UI content.

## 10. Theme visual identities already established

### SKYNET
Reference-quality finished theme.
- black/gunmetal industrial shell
- restrained chrome sheen
- sparse machine-cortex/neural detail
- tiny restrained red activity nodes
- board always visually dominant

Do not gratuitously alter SKYNET.

### SUGARCOAT
- full girly fairy/candy fantasy
- pink resin/gloss
- lollipop and fairy motifs
- deliberately decorative, but still readable

### VERDANTIS
- machinery reclaimed by nature
- roots, moss, leaves, mushrooms, bioluminescent nodes
- all organic scenery stays inside bounds
- message cards intentionally use a separate neutral bark-charcoal foreground material

### MY SINDRAGOSA
The user approved six image concepts and explicitly requires the literal image assets themselves to become the skin system.

The approved files are staged at:
`assets/themes/my-sindragosa/`

Files:
- `main-shell.png`
- `battle-comms.png`
- `little-hero-status.png`
- `player-message.png`
- `gm-message.png`
- `theme-selector.png`

The previous CSS-only Sindragosa attempt was rejected because it merely imitated the art instead of using the actual assets.

This is the immediate Codex task, but only after project orientation is complete.

## 11. Responsive implementation philosophy

The generated PNGs are concept skins, not fixed screenshots of final live DOM.

Use the actual PNG artwork, but fit it responsibly to the existing responsive components.

Important:
- preserve ornamentation as much as possible
- avoid cropping important corners/dragon-bone/ice-frame identity
- do not stretch artwork into obvious distortion when a layered/pseudo-element approach can preserve proportions better
- keep live UI aligned with the intended visual regions
- do not enlarge components just to accommodate the art unless the existing layout explicitly permits it
- never allow art to spill outside the component
- do not cover critical buttons or text with decorative frame areas

When the image contains sample text such as PLAYER MESSAGE, SHADEZ, or example timestamps, that text is reference content inside the artwork. The final live UI must still use the real DOM content. If the baked sample text would visibly conflict with live UI, use cropping/masking/positioning so the art acts as frame/material, not duplicate content.

## 12. Canonical board geometry

The game board skeleton is a core asset. Do not alter:
- board geometry
- slot placement
- difficulty-logo placement
- board aspect relationship

unless the task explicitly asks for it.

Visual theme work should be confined to the player UI surrounding the board.

## 13. Runtime and validation

Node.js 18+.

Run:
`npm start`

Default port:
`8080`

Before committing:
1. `node --check` every changed JS/server file
2. `git diff --check`
3. `npm test`

The regression suite intentionally emits player-store corruption/recovery warnings. Those warnings are expected. Success is determined by PASS lines and exit code 0.

Expected suite includes:
- player-store corruption protection
- Shadow Broker adaptive timing
- static file lockdown
- stable player reconnect ID
- chat payload normalization/flood protection
- reset board broadcast
- Shadow Broker broadcast/clear/boundary regression
- session crash recovery
- final line: `ALL ASOC REGRESSION TESTS PASSED`

Client-only HTML/CSS changes do not require a server restart.
Server runtime changes do.

## 14. Git discipline for Codex

- Work only on `codex/my-sindragosa-literal-assets`.
- Do not merge to `main`.
- Keep the task surgical.
- Do not touch unrelated game JSON or runtime state.
- Do not commit logs, `players.json`, `players.json.bak`, `active-rooms.json`, or other runtime artifacts.
- Preserve existing selectors and theme IDs unless necessary.
- Commit only after validation passes.
- Push the completed implementation back to the Codex branch for review.

## 15. Recent project history relevant to current work

Recent theme/UI evolution includes:
- SKYNET custom material backgrounds
- SKYNET machine-cortex refinement
- SKYNET chrome polish
- SUGARCOAT fairy-candy materials
- VERDANTIS living-forest materials
- VERDANTIS bounds containment fix
- VERDANTIS foreground/background chat separation
- MY SINDRAGOSA CSS approximation, which is now being replaced by literal image assets
- Battle Comms hierarchy/chat-flow polish after the initial theme pass

Do not roll back later Battle Comms/chat-flow improvements just to reproduce an older screenshot.

## 16. First action for Codex

Before editing:
- inspect current `join.html`
- inspect current `css/asoc.css`
- inspect `js/themes.js`
- inspect the six PNGs in `assets/themes/my-sindragosa/`
- read `.codex/TASK_MY_SINDRAGOSA_LITERAL_ASSETS.md`
- understand the current DOM dimensions and where each live control sits

Then implement the task without violating the rules in this handoff.

If a conflict exists between visual concept art and live functionality, preserve live functionality and use the PNG as the frame/skin around it. Do not replace working controls with rasterized concept text.

This handoff is authoritative for current Codex work unless the user explicitly overrides it.
