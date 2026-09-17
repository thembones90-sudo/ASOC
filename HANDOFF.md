# HANDOFF — Scoring & Player Profiles Layer

**Date:** 2026-09-17
**Session summary for:** whoever (or whichever AI assistant) picks this project up next.

This document describes the first major competitive/scoring layer added to ASOC ENGINE. Read this before touching `server.js`'s scoring code, `scoring-constants.js`, or `player-store.js`.

---

## What this layer does

Adds real-time scoring, player profiles, and two leaderboards on top of the existing chat-adjudication flow. It hooks into the GM's existing correct/incorrect verdict flow (`applyVerdict()`) rather than introducing a parallel system — the GM does not do any extra bookkeeping beyond what they already did (mark chat guesses correct/incorrect, pick the target column).

## Where things live

- `scoring-constants.js` — every point value in the game. If a number needs tuning, it's here and nowhere else.
- `player-store.js` — persistent player profiles in `players.json` (gitignored, generated at runtime, per-machine). Atomic write-temp-then-rename so a crash mid-write can't corrupt it.
- `server.js` — `room.scoring` block per room holds session-scoped state: per-player session scores, a full event log, active streak tracker, board-finalized flag, pending Final results. Scoring logic hangs off `applyVerdict()`, `handleSwitchGame`, `resetBoard`, plus two new handlers `handleFailFinal` / `handleRevealResults`.
- `index.html` / `join.html` / `js/app.js` / `js/player.js` / `css/asoc.css` — UI: session leaderboard, all-time leaderboard toggle, score toasts, streak banners, the two-phase Final outcome reveal, DECLARE FINAL FAILED button (GM-only).

## Locked rules (do not silently change these)

1. **Column scoring** — points depend on how many clues were revealed *at the moment of the correct guess*: 1 clue → 400, 2 → 300, 3 → 200, 4 → 100. **Zero revealed clues → scoring is rejected outright** (GM gets a `score:warning`), not silently treated as "1 clue." The guess still marks correct and the column still reveals normally either way.
2. **Final jackpot** — same shape, based on columns known at solve time: 1 → 1200, 2 → 800, 3 → 500, 4 → 300. Zero columns known → rejected the same way (`FINAL_SCORE_BY_COLUMNS` intentionally has no `[0]` key — that's what makes it a hard rejection, not a bug).
3. **Column streaks** — milestone bonuses only, not cumulative: 2 consecutive same-player solves → +50, 3 → +125, 4 → +250 (full 4-column sweep by one player = +425 total on top of the column points). A different player solving breaks the streak. Streaks reset every new board (NEXT GAME or RESET BOARD) but session score never resets on board change.
4. **Deterministic streak rebuild** — after ANY change to solved columns (a GM verdict correction), the streak state is fully rebuilt from `room.chat.solvedTargets` sorted by timestamp. Never patch it incrementally — a correction can invalidate a dependent later milestone bonus, and only a full rebuild catches that.
5. **Failed Final** is a GM-only, explicit action — never triggered by a timer or inactivity. It's two-phase: `gm:failFinal` immediately broadcasts the headline + story reveal to everyone; the -200-per-player penalty stays hidden until the GM explicitly sends `gm:revealResults` ("SHOW RESULTS"). Do not collapse these into one message — that was an early draft bug (see below) and it leaks the penalty number to players before the GM's intended pacing moment.
6. **Session score vs. all-time score are never merged.** Session score is in-memory, room-scoped, resets on server restart, survives NEXT GAME. All-time score lives in `players.json`, persists forever across restarts and rooms.
7. **Player identity v1 is normalized-name matching** — trim + case-fold only, no slugging/Unicode mangling. Two players who join with the same normalized name share one profile. This is an accepted limitation for a small recurring group, not a bug to "fix" without discussion — fixing it means designing real accounts, which is out of scope.
8. **Purple/Black solve counters exist on the profile schema but are permanently inert right now.** `getAuthoritativeColumnDifficulty()` is a stub that always returns `null` because there's no per-column difficulty metadata yet (only per-board). Don't wire these up without first adding that metadata.
9. **`gamesPlayed`/`gamesWon`** are credited per-BOARD to every currently-connected participant at board finalization — different from `finalSolutions`, which only counts the individual who solved it.

## WebSocket protocol additions

Client → Server: `gm:failFinal`, `gm:revealResults`, `leaderboard:getAllTime`
Server → Client: `score:event`, `score:streak`, `score:warning`, `score:finalReveal`, `score:finalResults`, `leaderboard:allTime`
`players:update` was extended with a `score` field.

Full JSON examples are in `README.md` under "WebSocket Message Protocol Additions" and "Scoring & Player Profiles."

## Bugs found and fixed along the way

- **Object-spread field collision**: `{ type: 'score:event', ...newAward }` where `newAward.type` was `'column'`/`'final'` silently overwrote the outer `type`. Fixed by renaming the inner field to `awardType`. If you ever add a new spread-in object to a WS message, check for this collision first.
- **Pre-existing bug in `applyVerdict()`** (unrelated to scoring but touched while adding the reversal path): correcting a chat message's target from column X to column Y never cleared X's `solvedTargets` entry, contradicting the README's documented behavior. Fixed.

## Testing performed

- `test-scoring.js` (raw WebSocket, sandbox-only, not deployed to device) — 38/38 checks passing, covering every scoring path, every rejection case, streak building/rebuilding, and specifically the "reversal claws back a dependent streak bonus" case.
- `probe4.js`, `probe5.js`, `probe-xlsx-import.js` (pre-existing Playwright regression probes) — rerun clean, zero regressions. One pre-existing, unrelated anomaly: `playerIdStableAcrossReconnect: false` — not caused by this work, not yet investigated.
- `probe-scoring-ui.js` (new Playwright UI probe, sandbox-only) — confirms the visual layer end-to-end for GM and player views, including that players only see the Final penalty *after* the GM clicks SHOW RESULTS, never before.

None of the test scripts (`test-scoring.js`, `probe-scoring-ui.js`) were deployed to the device — they're sandbox-only harnesses. If you want them on `A:\ASOC ENGINE` for future regression checks, they'd need to be copied over separately.

## Deployment status as of this handoff

All 10 production files are live on `A:\ASOC ENGINE` (verified via directory listing, fresh mtimes, zero rejected writes): `server.js`, `scoring-constants.js`, `player-store.js`, `index.html`, `join.html`, `css/asoc.css`, `js/app.js`, `js/player.js`, `README.md`, `.gitignore`.

No `npm install` was required for this layer — the new modules use only Node's built-in `fs`/`path`.

Git commit/push has **not** been confirmed executed — the commands were handed to the user to run locally:

```powershell
git add server.js scoring-constants.js player-store.js index.html join.html css/asoc.css js/app.js js/player.js README.md .gitignore
git commit -m "Add scoring/player-profile competitive layer"
git push origin main
```

Check `git log` / `git status` on the device before assuming this is pushed.

## Known limitations going forward

- Purple/Black solve tracking inert until per-column difficulty metadata exists.
- Session scores are memory-only; a server restart mid-session loses them (all-time scores unaffected).
- `playerIdStableAcrossReconnect` anomaly (pre-existing, unrelated) still unresolved.
- No teams, timers, buzzer race, or QR-join yet.
- Player identity is name-based only (see rule 7 above) — no auth, no accounts.
