# ASOC Tombola — implementation and verification

Date: 2026-10-14 (Europe/Belgrade).
Checkout: `C:\Users\user\Documents\Codex\asoc-tombola-20261014`.
Branch: `codex/asoc-tombola`, based on production `c074874`.
Main checkout and existing unrelated changes were preserved.

## Implemented behavior

- Securely shuffled exact inventory: 18 Blessings (+48 SC theoretical),
  17 Curses (-47 SC theoretical), and one Blood Tribute.
- GM opens a lobby; up to 10 players enroll; signup closes when GM starts.
  Each cycle securely shuffles the roster and gives each player exactly one
  move. The next cycle reshuffles. No wagers, fees, skips or turn timers.
- Hidden outcomes never appear in the role-aware network projection. Only
  opened fields reveal their outcome, nominal amount, actual balance change,
  selecting account and timestamp.
- Existing player-store credit/debit APIs enforce the zero floor and use
  receipts containing round, player, field and outcome. Validation, ledger,
  reveal, debt and broadcasts execute inside ASOC's existing synchronous
  durable runtime transaction and outbox; no separate wallet was introduced.
- Blood Tribute records its selecting player but does not stop play. Only
  after all 36 tiles open does that player receive
  one deterministic Black Market pact through `createGmTributeDebt` with title
  `BLOOD TRIBUTE REQUIRED`. No coin transaction occurs for that field and no
  unopened fields are automatically exposed. Dennis announces the named player
  at the end. The upload prompt cannot be dismissed or escaped, survives refresh
  and new rounds, and blocks new Tombola participation until submission. GM
  rejection reinstates the requirement; only the GM judges the offering.
- The existing Black Market demand prompt and image/moderation flow remain
  intact. The game never approves payment itself.
- Room recovery saves the concealed inventory, roster, current turn, reveals,
  obligation link and history. Reconnects receive the same board. Old rounds,
  repeat clicks, invalid fields, wrong-turn users, nonparticipants and forged
  outcome/amount payloads cannot change the wallet.
- GM can cancel and open a fresh lobby after a terminal
  round. History keeps the latest 20 summaries without storing hidden outcomes
  in public payloads. Prior earned/spent coins remain after cancellation.

Conservative defaults for unspecified rules: at least two active human players
are needed; GM watches and controls the round rather than playing. A disconnected
participant retains the turn until reconnect (or GM cancels the round). These are
reversible defaults, not entry fees or forced timers.

## Approved artwork

`assets/tombola/board.png` is a byte-identical copy of the approved board from
`D:\AI MODELS\ASOC_Tombola_Codex_Handoff.zip`. SHA-256:
`99769F12F5C8434D9923F9F3894EFAE6EDED4E31BBB38906F9BFC46DEABCEF2C`.

`assets/tombola/vault-numberless.png` is the single reusable tile. The supplied
reference is untouched in the extracted handoff directory. The built-in image
editing tool removed the baked-in 12 while preserving brass framing, concentric
door geometry, bolts, dark texture and ghosted question marks. HTML renders
the unique numbers 1–36 dynamically; no per-number images were created.

Image edit prompt used:

> Use case: precise-object-edit. Edit target: the supplied approved square
> mechanical occult vault-door tile. Change ONLY one thing: completely remove
> the large raised golden central number '12' and its shadows, replacing that
> exact occupied central region with seamlessly continued dark obsidian gunmetal
> door texture and the existing fine antique brass occult sigil lines. Keep the
> reference composition, geometry, square dimensions, outer antique brass frame,
> bolts, hinges, concentric vault rings, weathered texture, crimson undertones
> and subdued ghosted question marks exactly as close to the input as possible.
> The center must be NUMBERLESS with no numeral, no letter and no replacement
> emblem, leaving room for dynamically rendered HTML field numbers. Do not
> redesign, add a background, crop, rotate, simplify or brighten this approved
> artwork. Preserve all details outside the number-removal area. Production
> reusable game tile, front-facing flat square.

## Verification results

`npm run test:tombola` passes all three suites:

- `tests/tombola.js`: roster sizes 2–10 preserve the exact inventory;
  36 unique numbered fields, no hidden outcomes, valid reveals, wrong turns,
  stale round IDs, duplicate selections, cap/roster lock, randomized cycles,
  exactly one move per player per full cycle, recovery with blood already
  revealed, and completion only on tile 36. The final cycle can be partial
  when the remaining tiles are fewer than the roster size.
- `tests/black-market-tombola.js`: real server, authenticated GM and three
  players, lobby and start, spectator/forged identity refusal, duplicate-click
  race, exact +1/+2 SC credit, -1 debit, -10 curse capped at zero, actual capped
  deduction record, process restart/reconnect, replay after recovery, identical
  hidden inventory and turn, synchronized finale, exactly one existing Black
  Market debt only at completion, blocked subsequent picks, new-round
  reset/history, and mandatory submission before joining another round.
- `tests/tombola-browser.js`: real ASOC pages and server in Chromium, logged-in
  GM, desktop and phone players, actual mini-game menu clicks, enrollment,
  starting and playing through all 36 tiles in randomized turn order, dynamic numbers,
  square 6x6 geometry, numberless artwork use, legibility, debt notice/Black
  Market navigation, unskippable requirement after refresh/Escape, and restored
  real consent/file picker and authenticated binary image upload, and access
  to normal chat after submission.

Screenshots inspected: `.scratch/tombola-visuals/desktop-closed.png`,
`mobile-closed.png`, `desktop-finale.png`, and `mobile-finale.png`.
Desktop viewport 1440x1000, phone 390x844. The board remains square without
horizontal overflow, the desktop composer remains outside the game overlay,
reveals use text as well as green/red color, keyboard focus is visible, and
reduced-motion CSS disables reveal/finale animations.

Existing passing regression suites: black-market-tribute, gm-minigames,
lockdown, player-lockdown, mudpits, mudpits-live, mudpits-browser,
poison-privacy, production-readiness, battle-timer-tick, chat-link-preview,
hardening, reinforcement, roulette-carnage and roulette-carnage-server.
JavaScript syntax and `git diff --check` pass.

Two existing suites fail identically on unchanged production `c074874`:

- `black-market-tribute-wire.js`: times out waiting for the GM acceptance step.
- `ritual-pipeline.js`: expects obsolete CSS cache tag
  `20261005-ritual-override-1`; production already uses a later tag.

These baseline failures were reproduced separately and were not masked or
rewritten. Tombola has no outstanding failure in its focused checks.

## Changed production files

`tombola.js`, `tombola-server.js`, `server.js`, `js/tombola-ui.js`,
`css/tombola.css`, `assets/tombola/board.png`,
`assets/tombola/vault-numberless.png`, `js/gm-minigames.js`, `js/app.js`,
`js/player.js`, `index.html`, `join.html`, `package.json`,
`tests/tombola.js`, `tests/black-market-tombola.js`,
`tests/tombola-browser.js`, and this report.

## Running and release status

Start the checkout with the existing `npm start` workflow. In the GM console,
open MINI GAMES → ASOC TOMBOLA → OPEN A TOMBOLA LOBBY. Players open their
MINI GAMES → ASOC TOMBOLA and join. The GM then presses START ROUND.

This implementation is prepared on its isolated feature branch; no Tombola
production deployment was requested or performed. No production accounts,
balances, active sessions, secrets or infrastructure were changed by testing.
