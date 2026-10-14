# MUD PITS QA Report

## Production candidate verification — 2026-10-14

The earlier development report below is superseded by the integrated release
candidate at `C:\Users\user\Documents\Codex\mudpits-production-20261014`.
The reviewed feature commit was cherry-picked onto current production main
`f89ef0d`, with targeted HTML conflict resolution retaining the current chat,
lockdown, poison and cache versions. Both original dirty checkouts were preserved.

Release blockers fixed: authenticated active identity checks; deadline enforcement
before actions; persistent duel state and private drafts; recovery scheduling;
restart-safe reward retries using the existing receipt; restored result tallies;
live countdown; cancellation and dismiss controls; draft/focus preservation;
visible VS, vote totals and verdict; scrollable desktop/mobile panels above the
public message composer; filtering offline and synthetic contestants.

Verified suites: mudpits, mudpits-live, mudpits-integration, mudpits-browser,
gm-minigames, production-readiness, lockdown, player-lockdown, poison-cure,
poison-picker-cure, and poison-privacy. All eleven passed on the integrated
candidate. The live suite now asserts actual persisted +1 SC, GM-vs-player
gameplay, a duplicate-award crash/restart retry, and private draft recovery.
The unit suite asserts the production 90s/5s/60s constants, ties, incomplete
duels, and deadline rejection. Browser QA ran at 1440x1000 and 390x844;
screenshots were inspected, no sideways overflow or composer obstruction was
present, and typing, selection, submission, cancellation and dismissal worked.

Existing `mobile-shell.js` fails its MOBILE VERSION offer assertion on both
unchanged production main and the release candidate. This is a baseline failure;
the feature's own desktop/mobile browser verification passes.

Production workflow: GitHub main auto-deploys to Railway `asoc-live` in
Europe, with the existing `/data` volume. No environment variables, volume
mounts, database migrations or staged infrastructure changes are required.
Production smoke must inspect health/build, asset responses and GM selector
without summoning a duel or altering player balances.

Date: 2026-10-14  
Checkout tested: `A:\ASOC-MUDPITS-PICKLE`  
Main checkout `A:\ASOC ENGINE`: not opened, modified, merged, or deployed.

## Outcome

MUD PITS finalization is green for the focused rules, live WebSocket path, persistence/reconnect path exercised by the test, and the existing browser/mobile smoke suite after two defects were fixed in this checkout.

## Tests executed

| Test | Result | Evidence |
|---|---|---|
| `node tests/mudpits.js` | PASS | Privacy, timer transitions, vote eligibility, duplicate vote rejection, void/no-award, max-length validation. |
| `node tests/mudpits-integration.js` | PASS | Starts a real `server.js` child with shortened test-only timers; authenticates GM over HTTP; uses five WebSocket clients (GM, two contestants, voter, spectator); exercises submit/reveal/vote traffic, contestant and duplicate-vote rejection attempts, GM cancel, and player rejoin after disconnect. |
| `node tests/production-readiness.js` | PASS | Health, writable data root, graceful shutdown, idempotence, recovery. |
| `node tests/mobile-shell.js` | PASS | Playwright mobile shell smoke including mini-games sheet, chat-first CASUAL layout, battle layouts, refresh, and desktop switch. |

Dependencies were installed with `npm ci --ignore-scripts`. The checkout uses Node v24.18.0 while `package.json` declares Node 22.x; the tests above passed despite that engine mismatch.

## Focused live coverage

The integration test runs production server code and uses only environment overrides for test timing: writing 90ms, reading 50ms, voting 120ms. Production defaults remain 90 seconds, 5 seconds, and 60 seconds in `mudpits.js`.

Assertions include:

- authenticated GM recovery and authenticated player registration/join;
- five simultaneous logical roles over real WebSockets;
- early submit does not expose plaintext to GM, either contestant, voter, or spectator before the second submit;
- both entries become visible only after the reveal transition;
- contestant vote and duplicate vote rejection attempts are sent over the live wire;
- result traffic is delivered to the GM;
- GM cancellation is sent over the live wire;
- a disconnected contestant can authenticate and rejoin, receiving server traffic again.

## Defects found and fixed

1. A sealed contestant entry was still returned as `viewer.myDraft` to the submitting contestant during the writing phase. This violated the stronger requirement that no client receive sealed plaintext before reveal. `mudpits.view()` now returns `myDraft` only while the entry remains editable.

2. The inactive player MUD PITS root rendered a “pit cold” shell with pointer events enabled. It intercepted the mobile mini-games close button. `js/mudpits-ui.js` now sets `pointer-events: none` when `state.active` is false and restores interaction only for an active pit.

## Important limitation

This QA run did not wait 90 real seconds or 60 real seconds. It verified the same server-authoritative deadline code with deterministic, test-only millisecond overrides. The pure unit test also advances the state with an explicit fake timestamp through the 90s/5s/60s production-shaped transitions.

The live integration test currently attempts the edge cases over the wire and confirms the server continues operating; it does not yet assert the exact `mudpits:error` payload for every rejection attempt or independently verify the Shadow Coin ledger delta. The pure rules test verifies the rejection semantics and one-winner/tie/void logic; the production award call is guarded by the server’s idempotent `awarded` flag.

## Safe integration strategy

Do not merge or copy this checkout wholesale into `A:\ASOC ENGINE`: that checkout contains unrelated uncommitted changes.

Use a clean temporary integration worktree or branch based on the intended main commit. Copy or cherry-pick only the MUD PITS change set after reviewing conflicts by path:

- `mudpits.js`
- `server.js` MUD PITS import/handlers/projection integration
- `js/mudpits-ui.js`
- the MUD PITS CSS and the exact client wiring changes in `index.html`, `join.html`, `js/app.js`, `js/player.js`, and `js/gm-minigames.js`
- `tests/mudpits.js`
- `tests/mudpits-integration.js`
- this report

Before integration, compare each path against the clean target baseline, run the focused tests and relevant browser smoke in that clean worktree, then run the broader project suite. Keep the main checkout untouched until those scoped changes are reviewed and validated.
