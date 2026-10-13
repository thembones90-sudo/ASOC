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
