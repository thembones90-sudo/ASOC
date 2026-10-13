# ASOC P0 Persistence + Chat Transport Integration Gate

Date: 2026-10-13
Branch: perf/asoc-p0-integration
Production baseline at start of this review: 542b185

## What was integrated
- Persistence V2 worker-backed ordered durable commits and crash-replay tests from 7f89e66.
- Independent authoritative queue depth warning from 435178b, included as adf6487.
- Big Pickle's smaller chat deltas for GIF, sticker, poll, voice, image, slash/GM chat where changed IDs are known, plus private aggregate frame-size diagnostics, included as cc388fd.

## Validated locally in the combined branch
- PASS: node tests/persistence-v2-integration.js. Injected 200ms disk delay, ordered batch delivery 447ms, HTTP worst 1ms in latest run.
- PASS: node tests/worker-wal-crash.js. Recovery from crash after durable journal.
- PASS: node tests/worker-partial-crash.js. Recovery from crash after first target materialization.
- PASS: node tests/chat-payload-budget.js.
- PASS: node tests/chat-deltas.js. Legacy compatibility, deltas, resync and paging.
- PASS: node tests/reliquary-adversarial.js. Players denied forged access and direct private URL, unlocked GM only.
- PASS: node tests/scoring-audit.js. Scoring, CORRECT reversal and Final adjudication completed in 50.09s on merged revision.
- Source syntax check passed before integration; no cherry-pick conflict.

## Quantified transport issue
Big Pickle measured an ordinary delta at approximately 422 bytes while the same event's legacy full chat snapshot was ~75,228 bytes with a long history. A full /roll snapshot was ~75,248 bytes. This supports payload reduction but does not conclusively attribute the prior ~48.5MB queued WebSocket backlog.

## Deployment blockers / unknowns
1. The worker candidate in an independent audit worktree previously failed tests/scoring-audit.js twice (timer start or GM judge ACK timeout), then passed twice. The deployed production baseline passed in a comparison run. A single merged-branch pass does not establish repeatability. Diagnose queue, command timing and server errors under sustained simultaneous GM/player sessions; avoid hiding failures with longer timeouts.
2. More hot-path synchronous writes outside runtimeAction can still block the Node event loop. Audit direct filesystem and store calls.
3. Measure 10-20 actual clients and adjudications with p50/p95/p99 queue-to-broadcast latency and frame sizes, and evaluate event-loop delay and queue buildup.
4. Production runs in Railway sfo region. Benchmark an isolated EU staging deployment with a separate durable volume before moving production. Migration of existing storage requires backup, rollback and downtime planning.
5. Private Reliquary remains strictly GM-only; every release must rerun the adversarial security regression.
6. Earlier legacy UI tests have known baseline drift and broad suite is not completely green.

## Agent state
Big Pickle's verified payload work was preserved as e6d7a37.
Codex CLI was forced into read-only operation and unable to run commands in its isolated session; it did not complete a fresh audit.
Independent Claude session hit weekly limit and did not perform a source audit. The local queue-depth safeguard and recovery checks were carried out directly in the separate audit worktree.

## Safety
Production was not deployed or restarted. Do not merge this feature branch into main until gates above are cleared and a controlled downtime window is authorized. No player messages should be dropped to mask queue pressure; no 8MB unconditional GM WebSocket disconnect should be restored.

## Repeatability and heavier browser load (continuation)
- PASS: 3 consecutive complete `node tests/scoring-audit.js` runs on the integrated branch, all exit 0 (roughly 50 seconds each). Covers CORRECT, score reversals, Final and Shadow Coins; prior intermittent timeouts in a separate worker tree remain an operational risk to monitor.
- PASS: 12 browser clients using `tests/persistence-v2-load12.js`; with simulated 200ms worker storage delay, all messages delivered in 490ms, unrelated HTTP worst 1ms, no duplicate messages or JS page errors.
- PASS: full targeted group `chat-payload-budget`, `chat-deltas`, `reliquary-adversarial`, `raid-live-chat`, `casual-battle-pause`, `all-columns-borrowed`, `worker-wal-crash`, `worker-partial-crash`.
- Storage and network caveat: The worker keeps the event loop responsive but durable acceptance still waits for actual fsync completion, and production SFO region adds transatlantic RTT. Sub-250ms production ACK is not yet proven.
- EU migration remains a separate safety operation: do not move a live attached volume without verified complete persistent-data backup, recovery rehearsal and controlled downtime.

## Live-region isolated staging validation
- Isolated Railway project `asoc-p0-eu-staging` created with a synthetic-only 300MB volume in `europe-west4-drams3a`, no production data, no production credentials, and a branch-pinned commit `2ff27bf`.
- 55 read-only keep-alive GET /api/build probes from SKYNET: production San Francisco p50 181.64ms / p95 189.04ms; EU staging p50 42.56ms / p95 67.36ms (one EU outlier 604.17ms).
- 35 liveness WebSocket ping probes: US p50 178.43ms / p95 181.93ms; EU p50 39.58ms / p95 47.55ms.
- EU staging 15 synthetic GM broadcasts after authenticated host reconnect: client-visible chat p50 69.96ms / p95 70.23ms, no errors.
- These are single-origin probe samples, not multi-origin production guarantees; regional migration requires verified backup and full attached-volume data copy. DO NOT change region on existing volume blindly.
- Reliquary infostud completion callback now commits its room link through runtimeAction rather than synchronously persisting on Node's event loop. GM-only security regressions pass.
