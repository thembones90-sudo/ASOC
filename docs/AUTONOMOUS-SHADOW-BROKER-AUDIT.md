# Autonomous Shadow Broker — Phase 1 Architecture Audit

Date: 2026-10-08
Scope: ABUSEMENT PARK automation only
Status: audit complete; no autonomous execution enabled

## Executive summary

ASOC already has a mature, server-authoritative game engine. Automation must be an orchestration layer around the existing chat-verdict and GM-command paths, not a second rules engine.

The safest integration point is between an eligible player chat message and the existing `applyVerdict()` transaction. A new adjudication service may classify and propose `ACCEPT`, `REJECT`, or `ESCALATE`; only a server-side automation controller may validate the proposal against current room/board state and invoke the existing authoritative action. The model must never receive a socket, room object, callback, or generic tool capable of mutating state.

Manual mode can remain bit-for-bit compatible. Assisted and autonomous modes require new persisted automation state, strict structured results, idempotent receipts, stale-state checks, an audit journal, and GM recovery controls. No AI provider or model client currently exists in the project.

## 1. Authoritative state and persistence

- `server.js:createRoom()` owns the live room and board state.
- Core per-board identity is `room.boardId`; `room.revision` is the public mutation counter.
- `room.sessionState` owns revealed cells, clue order, Final state, outcomes, victory/loss, and match result.
- `room.chat.messages` and `room.chat.solvedTargets` own submitted guesses and credited solutions.
- `room.scoring` owns session scores, reversible events, active streak, finalization guards, and withheld results.
- `room.womf`, `room.timer`, `room.solutionCountdowns`, `room.pendingReveals`, `room.match`, and related event state are authoritative server fields.
- `serializeRoomForRecovery()` / `restoreActiveRooms()` persist active rooms through `active-rooms.json` under `ASOC_DATA_DIR`.
- `persistActiveRooms()` is called before authoritative broadcasts in the critical gameplay paths.
- Durable stores are JSON-backed and use atomic helpers where applicable: `player-store.js`, `match-store.js`, `auth-store.js`, `dm-store.js`, and `game-store.js`.
- There is no database and no Supabase integration. Production durability is an `ASOC_DATA_DIR` volume overlay.

Reuse decision: add `room.automation` to the existing recovery serialization and normalization path. Do not create a separate match-state store.

## 2. Board import and hidden answers

- `game-store.js` loads bundled and durable games, imports XLSX with ExcelJS, validates all A1–D4 clues, A5–D5 solutions, and the Final, and normalizes story/GM notes/hints.
- Canonical hidden answers live in `room.gameData.columns[A-D].solution` and `room.gameData.finalSolution`.
- `getCellData()` maps progressively revealed physical clue slots through `sessionState.clueOrder`.
- `getPublicState()` sends only revealed values. Hidden clue text and solutions are not exposed to players.

Reuse decision: the adjudicator reads a minimal server-side snapshot built from `gameData`, visible clue context, and one submission. It must never add hidden answers to public state, errors, chat, or client-visible audit entries.

## 3. Clue reveal and column progression

- All board mutations route through `applyCommand()` (`revealCell`, `resolveColumn`, `revealColumn`, `hideColumn`, `revealFinal`, `resetBoard`, and related actions).
- `assignClueOrder()` preserves the progressive clue ordering independently of physical row.
- A correct chat verdict schedules the established delayed column reveal through `scheduleSolvedColumnReveal()` and `armColumnReveal()`.
- `syncAutomaticColumnCountdown()` starts the existing two-minute column danger timer when all four clues are open.
- Column countdown expiry emits `column:dangerExpired`; it does not independently invent a WOMF failure.

Reuse decision: automation must call the same verdict/command functions and never reveal cells directly.

## 4. Chat and answer-submission path

- Player WebSocket messages enter `handleChatGuess()`.
- Client message IDs are deduplicated by `room.clientMsgIds` and acknowledged with `chat:ack`.
- Slash commands, rate limits, moderation restrictions, room mode, and special gimmicks are checked before ordinary chat is accepted.
- `addChatMessage()` creates the canonical message and freezes `scoreContext` at submission time.
- Chat is broadcast using snapshots/deltas through `broadcastChatUpdate()` and serialized by `createChatSerializer()`.
- Only un-sourced, current-board player text is adjudicable. Polls, media, commands, Broker messages, deleted messages, and historical messages are excluded by the current manual verdict rules.
- GM judgments enter `handleJudgeGuess()` and then `applyVerdict()`.

Reuse decision: enqueue an automation candidate only after `addChatMessage()` succeeds and persistence has accepted the message. The candidate key must include `boardId + messageId`. Classification must not delay chat delivery.

## 5. Existing adjudication transaction

- `applyVerdict(room, messageId, verdict, target, reveal)` is the central reversible transaction.
- It validates current battle state, message provenance, board identity, and target legality.
- It records/removes the match-ledger attempt, awards or reverses solve credit, updates scoring, streaks, coins, Final state, completion, and celebrations.
- `handleJudgeGuess()` persists, broadcasts chat/state/player updates, schedules column reveals, sends score events, and returns a GM acknowledgment.
- Correct-verdict personality lines already come from `CORRECT_VERDICT_RESPONSES` and are stored on the judged message.

Reuse decision: extract a shared server-side `executeVerdict()` wrapper from `handleJudgeGuess()` so manual and automated judgments share the exact same validation, persistence, broadcasts, animations, and scoring. Do not call a forged GM WebSocket and do not duplicate the post-verdict broadcast sequence.

## 6. Scoring and streaks — source-of-truth conflict

The directive's score table is not the current ASOC engine.

The live authoritative constants in `scoring-constants.js` are:

- Column before Final, by clues visible when submitted: `500 / 325 / 200 / 100`.
- Column after Final: `250 / 160 / 100 / 50`.
- Final, by known column solutions when submitted: `0 / 2200 / 1400 / 850 / 450` for 0–4 known columns.
- Streak milestones: `+50 / +100 / +150` for streak lengths 2–4.
- Failed Final penalty: `0`.

`scoreContextNow()` freezes visible clues/known columns at submission, preventing delayed adjudication from changing value. `recordEvent()`, `awardColumnSolve()`, `awardFinalSolve()`, reversal helpers, `reconcileColumnPoints()`, and `rebuildColumnStreaks()` make corrections deterministic.

Decision: preserve the live engine. Automation must never calculate points. Tests in `tests/scoring-audit.js` encode the current contract.

## 7. WOMF and Blood Tribute

- WOMF is server-authoritative, persistent across boards, capped 0–10.
- A declared failed column charges +1 through `resolveColumn` / `handleFailColumn()` with a per-board duplicate guard.
- `declareGameLost()` is the canonical failed-Final/loss transition and charges the established loss consequence.
- A rejected guess is not a failed column and must never affect WOMF.
- Manual correction tools already exist for WOMF subtract/add/reset.
- Blood Tribute has separate pending state, private vault handling, GM acceptance/rejection, ritual state, and public-safe projections.
- Black Market is implemented as a separate deterministic module with GM-authorized decisions.

Reuse decision: automation may propose a failure or tribute reminder, but protected WOMF failure declarations, media judgment, Blood Tribute settlement, Omen activation, and Black Market discretionary decisions remain GM-authorized initially.

## 8. Timers and countdowns

- `room.timer` is server-authoritative and persisted.
- Difficulty defaults are 20 minutes for Green/Yellow, 25 for Amber, and 35 for Red/Purple/Black.
- Borrowed Time is two minutes (`ASOC_TIMER_BORROWED_MS` can shorten tests).
- Timer phases include ready, running, paused, borrowed, borrowed_paused, stopped, and expired.
- Solution countdowns persist deadlines/tokens, freeze with battle pause, and resume without resetting.
- `enterBorrowedIfAllColumnsOpen()` is the only transition into Borrowed Time.
- Timer expiry routes into the same `declareGameLost()` terminal transaction.
- `js/timer.js` is display-only and derives from server state.

Reuse decision: automation may request existing timer actions only. It must not own a second interval, deadline, or client timer.

## 9. Battle mode and GM authorization

- `roomMode` and `armed` distinguish casual, battle-armed, battle, aftermath/recount surfaces.
- Switching to casual pauses active battle time and solution countdowns; returning restores them.
- Privileged handlers verify `ws === room.hostConnection`.
- GM sessions/tokens and lockout files are server-side; player clients cannot impersonate the host.
- WebSocket protocol dispatch in `server.js` is the only public action router.

Reuse decision: automation is an internal server principal, not a client role. Each proposed action must pass an explicit allowlist and the same current-state guards as GM actions.

## 10. Special events, victory, defeat, and narrative

- Omen is currently an explicit `gm:omen` path with visual handling in `js/skeleton.js`.
- `handleGmGameWon()` and `declareGameLost()` own terminal outcomes.
- Accepting the Final is deliberately not the same as GAME WON; remaining columns may still be owed.
- Endgame data carries actual A5–D5 solutions and Final.
- Prepared `gameData.story` is already available and preferred by the aftermath sequence.
- `js/skeleton.js` and `css/aftermath-director.css` render victory/loss and typewriter-style aftermath.
- Recount and match rating are separately gated and archived through the match ledger/store.

Reuse decision: use prepared story synchronously. Any later story-generation enhancement must be optional, validated, approximately 100 words, derived only from canonical solutions, and never block terminal state.

## 11. Multiplayer synchronization and idempotency

- Server mutations precede `state:public`, `chat:update`, `players:update`, and animation/event broadcasts.
- `boardId`, `revision`, message IDs, command receipts, pending-reveal tokens, countdown tokens, scoring event IDs, and coin receipts already provide useful identity primitives.
- `clientMsgId` prevents duplicate player posts after reconnect.
- `applyVerdict()` reverses and deterministically rebuilds credit when corrected.

Missing: an automation-specific receipt/journal and a compare-before-execute guard.

Required execution preconditions:

1. Candidate `boardId` still equals `room.boardId`.
2. Candidate message still exists, is undeleted/unmodified, and remains unjudged.
3. Candidate's target remains unresolved and legal.
4. Candidate decision receipt has not already executed.
5. Automation mode/status still authorizes the action.
6. Current room revision is compatible with the decision snapshot or the candidate is revalidated.

## 12. External integrations and environment

- Runtime: Node 22, `ws`, and `exceljs`; Playwright is a development dependency.
- No AI SDK/provider dependency is installed.
- No AI API key or model environment variables exist.
- Existing environment configuration covers ASOC persistence/auth/email/R2/Giphy/timer/test behavior.
- Relevant durable paths are rooted at `ASOC_DATA_DIR`; overrides exist for session, player, match, and auth files.

Required new configuration (names to be finalized during Phase 2): provider/model, API key, request timeout, maximum concurrency, daily/token budget, and explicit enable flag. Production default must remain MANUAL and AI-disabled.

## 13. Missing infrastructure

1. Submission classifier and deterministic normalization module.
2. Strict adjudication result schema and validator.
3. Provider-neutral semantic-judge adapter with timeouts and bounded retries.
4. Minimal anti-spoiler prompt/context builder.
5. Persisted per-room automation state (`MANUAL | SHADOW | ASSISTED | AUTONOMOUS`, paused/error state).
6. Pending-review queue and automation audit journal.
7. Shared verdict executor usable by manual and automated paths.
8. Undo metadata for the last safe automated action.
9. Cost/usage accounting.
10. GM-only control panel and protocol messages.
11. Shadow-mode evaluation fixtures and disagreement metrics.

## 14. Proposed module boundaries

- `automation/answer-normalize.js`: pure deterministic Unicode/spacing/punctuation/diacritic normalization and conservative typo comparison.
- `automation/answer-classifier.js`: pure eligibility/intent/target classification; no hidden answers and no mutations.
- `automation/adjudication-schema.js`: strict parser for `ACCEPT | REJECT | ESCALATE`.
- `automation/semantic-judge.js`: provider adapter; accepts only a minimal immutable context.
- `automation/controller.js`: queues candidates, applies mode/confidence policy, validates state, and calls injected authoritative executors.
- `automation/audit-store.js`: bounded persisted journal and usage accounting.
- `js/shadow-autopilot.js` plus scoped CSS: GM-only compact control panel.

The pure modules should have no dependency on `server.js`, sockets, filesystem, or environment secrets. `server.js` remains the composition root.

## 15. Safe rollout gates

1. **MANUAL** — current behavior; automation does not inspect messages.
2. **SHADOW** — classify/judge and record comparisons; execute nothing.
3. **ASSISTED** — exact unequivocal matches may be proposed for one-click approval; ambiguity always queues.
4. **AUTONOMOUS** — only validated low-risk judgments execute; protected actions continue to require GM authorization.

AUTONOMOUS must not become the production default. Promotion between gates requires test evidence and measured shadow-mode disagreement/false-accept rates.

## 16. Phase 2 acceptance criteria

- Pure deterministic normalization and exact-match tests cover Serbian Latin diacritics, Unicode forms, whitespace, punctuation, singular/plural policy boundaries, and non-equivalent near matches.
- Message classification excludes commands, replies/conversation, media, Broker/system lines, deleted/history lines, and casual-mode chat.
- Exact matching never requires a model request.
- Semantic output is schema-validated; malformed/timeout/provider-error always becomes `ESCALATE`.
- No Phase 2 code mutates board, scores, WOMF, timers, or chat verdicts.
- Shadow mode records decisions without leaking hidden answers or internal reasoning.

## Conclusion

The current engine already provides nearly every authoritative gameplay action and reversal needed. The central engineering task is not recreating ASOC rules; it is building a conservative, observable adjudication boundary around `handleChatGuess()` and `applyVerdict()`, then proving it in shadow mode before allowing controlled execution.
