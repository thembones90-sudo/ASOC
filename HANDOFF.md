# HANDOFF — ASOC Reliability Pass

**Date:** 2026-09-18  
**Canonical local path:** `A:\ASOC ENGINE`  
**Canonical GitHub repo:** `thembones90-sudo/ASOC` (`main`)

This handoff supersedes the older Shadow Broker-only handoff. Shadow Broker's permanent design/implementation rules remain documented in `README.md`; this file records the current project state and the reliability work completed afterward.

---

## Current project state

ASOC currently includes:

- fixed canonical 1900 × 1267 board geometry
- six difficulty tiers: GREEN, YELLOW, AMBER, RED, PURPLE, BLACK
- local and multiplayer board control
- server-authoritative public state
- Progressive Clue Queue
- player guess chat + GM adjudication
- session and all-time scoring/profile persistence
- server-authoritative Timer + Borrowed Time
- WOMF charge + Wheel of Misfortune
- Forge game library/creator + Excel import
- Public View
- Shadow Broker verdict identity + free-form transmissions
- active-room crash recovery
- permanent server regression tests

Do not alter the canonical board geometry, skeleton placement, or difficulty-logo placement unless explicitly requested.

---

## Reliability audit completed

The integral audit items were handled one by one:

1. **Safe checkpoint** — `e8844ec`
   - Current live feature set checkpointed before reliability edits.

2. **Static server lockdown** — `b50e2bc`
   - Public static serving is allowlisted to `index.html`, `join.html`, `css/`, `js/`, and `assets/`.
   - `server.js`, `.git/`, `games/`, `node_modules/`, docs, package/config files, traversal attempts, and non-GET/HEAD requests are blocked.
   - Verified allowed routes return 200 and protected routes return 404/405.

3. **Stable player reconnect identity** — `ae365ed`
   - Disconnected player identity records remain in-room instead of being deleted.
   - A reconnecting client can reclaim its previous `playerId`, preserving session score continuity.
   - Regression probe confirmed identical IDs before/after reconnect.

4. **Shadow Broker local TRANSMIT fix** — `ff8946b`
   - TRANSMIT no longer requires a hosted multiplayer room.
   - With a room: broadcasts server-authoritatively to everyone.
   - Without a room: renders locally on the GM board/Public View and enters the GM chat log.

5. **RESET BOARD synchronization** — `c661989`
   - `resetBoard` always rebuilds session state and always counts as a real state change.
   - Hidden Progressive Clue Queue assignments cannot survive RESET.
   - Reset now always broadcasts `state:public`, `chat:update`, and `players:update`.

6. **Permanent regression suite** — `92d08a9`
   - `npm test` is now a real project command.
   - Tests run against an isolated server port and isolated temporary player/session files.
   - Static lockdown, reconnect identity, and reset-broadcast behavior are permanently covered.

7. **Active-room crash recovery** — `702dd0b`
   - Active serializable room state is atomically mirrored to `active-rooms.json`.
   - Restart restores room code, host token, game/board state, clue order, chat, scoring, WOMF, wheel, timer, and player IDs.
   - WebSocket objects are never serialized; restored players return as offline identities and reclaim their IDs normally.
   - `active-rooms.json` is runtime-only and gitignored.
   - Running timers resume from their last persisted tick after restart rather than consuming server downtime.
   - A regression test kills the server, restarts it, reconnects the same host/player, and verifies the session survived.

8. **Cryptographic IDs/tokens** — `4a01339`
   - Room-code selection, host tokens, player IDs, message IDs, board/event IDs, GM token, wheel winner selection, and spin tokens now use Node `crypto`.
   - No server-side `Math.random()` remains.

9. **WebSocket heartbeat cleanup** — `9df25fa`
   - 30-second ping/pong watchdog terminates dead sockets.
   - Normal close/reconnect logic then handles the dead client instead of leaving ghost connections.

10. **Player-store corruption protection** — `a50dbce`
    - `players.json` is schema-validated before use.
    - One-write-behind `players.json.bak` is maintained.
    - Corrupt main files are quarantined as `players.json.corrupt-<timestamp>` and restored from backup.
    - If both main and backup are invalid, further writes are refused instead of overwriting the evidence with an empty database.
    - Dedicated corruption regression test covers both recovery and fail-safe behavior.

---

## Regression suite

Run:

```powershell
cd "A:\ASOC ENGINE"
npm test
```

Expected current result:

```text
PASS player-store corruption protection
PASS static file lockdown
PASS stable player reconnect ID
PASS reset board broadcast
PASS session crash recovery
ALL ASOC REGRESSION TESTS PASSED
```

Tests deliberately use temporary player/session files and do not modify the real `players.json` or `active-rooms.json`.

---

## Progressive Clue Queue

Implemented, not speculative.

For A1-A4/B1-B4/C1-C4/D1-D4:

- clue arrays are hardest → easiest
- the first physical slot revealed gets clue #1, second new slot gets clue #2, etc.
- `sessionState.clueOrder` stores physical row numbers in first-reveal order
- manual hide does not unassign a clue
- re-revealing the same slot shows the same clue
- RESET/new game clears the queue
- row 5 solutions and FINAL remain fixed-coordinate reveals
- public state exposes queue row-order metadata but never hidden clue text

---

## Shadow Broker current behavior

- Canonical avatar: `assets/ui/shadow-broker.png`
- Shared identity/timing markup: `js/skeleton.js`
- GM board, Public View, and player board all show transmissions
- verdict bubbles remain additive to existing correct/wrong styling
- free-form TRANSMIT works both with and without a hosted room
- multiplayer broadcasts still flow through the authoritative `gm:broadcast` server path
- local-only transmissions never invent a fake multiplayer room

Known optional polish still not implemented: message recall/cancel, adaptive hold time, interrupt transition, character counter.

---

## Runtime / deployment notes

The Remote Desktop Commander tunnel on machine **SKYNET** must remain running for remote file/terminal access. If it drops, reconnect locally with:

```powershell
npx @wonderwhy-er/desktop-commander@latest remote
```

The current project OpenCode config still defaults to Nemotron in `opencode.json`. `opencode/big-pickle` is available, but the attempted default-model switch did not land.

Server-side edits require a Node server restart before the live port 8080 process uses them. Client JS/CSS is read from disk on request, so a browser refresh loads those changes.

---

## Git / local-only state

Do not accidentally commit these unrelated local items:

- modified `games/kurac-test.json`
- untracked `Claude outputs/`

At the time this handoff was refreshed, `origin/main` contained static-server lockdown through `b50e2bc`; later reliability commits were still local and needed a push after the documentation commit.

---

## Remaining product work

The major reliability gaps from the audit are now covered. Remaining larger product features are optional/game-design work rather than missing safety infrastructure: teams, buzzer, QR joining, audio cues, and future UI/gameplay polish.

