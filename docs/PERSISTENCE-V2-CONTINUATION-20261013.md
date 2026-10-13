# Persistence V2 continuation — 2026-10-13

## State
Working branch: `fix/chat-lag-timer-transport` at `A:\ASOC-RAID-SAFE`.
Production remains on the deployed GitHub baseline; **do not deploy this unreviewed worker architecture during a match**.
The interrupted Codex changes were preserved, inspected and extended rather than reverted.

## Architecture
- `durable-io-worker.js` performs blocking atomic temp-write, fsync, rename, directory sync, and multi-file WAL off the main Node event loop.
- `durable-io.js` exposes ordered `commitAsync()`; startup recovery and controlled shutdown retain the established synchronous path.
- `server.js` serializes authoritative runtime actions, batches bounded bursts, waits for durable worker ACK before sending game frames.
- In-flight WebSocket actions are queued rather than treated as nested actions.
- The transaction-specific outbound buffer is detached **before** awaiting the worker, allowing independent liveness/protocol replies while authoritative frames remain held.
- Worker termination with pending commits now rejects outstanding requests and marks storage failed; never silently hang indefinitely.

## Reproduced and verified
- `node tests/durable-worker.js`: pass. Includes ordered commits, simulated 120 ms disk, event-loop gap <80 ms, write failure, partial WAL recovery, and termination during an unacknowledged commit.
- `node tests/worker-live-ping.js`: pass. With 600 ms injected atomic delay, pong 0 ms in latest local run, committed chat delivery 618 ms.
- `node tests/raid-chat-load.js`: pass. Six messages to six clients 273 ms in latest normal local run; 489 ms with 120 ms simulated write delay.
- `node tests/scoring-audit.js`: pass under normal simulated local environment; an injected slow-write warning in stderr causes its test harness to fail its 'no server errors' assertion and is not evidence of bad adjudication.
- `node tests/chat-deltas.js`: pass.
- `node tests/raid-live-chat.js`, `node tests/scoreboard-reset.js`, `node tests/casual-battle-pause.js`, `node tests/all-columns-borrowed.js`: pass.
- `node tests/durable-single-write.js`, `node tests/persistence-bloat.js`, `node tests/match-ledger.js`, `node tests/recount-engine.js`: pass.
- `node tests/battle-flow.js`: RECOUNT timeout reproduced on untouched baseline `fbf4fd7` in separate worktree; not attributable to this worker patch.
- The benchmark from `tests/durable-chat-benchmark.js` reports existing single-file optimization p95 40.7 ms vs 62.4 ms old WAL simulation; this is **not** a production benchmark of Persistence V2.

## Not yet proven
- Sustained multi-user p50/p95/p99 message and verdict delivery on production hardware.
- Full broad-suite green state; some tests have baseline drift (including RECOUNT).
- Complete audit of remaining persistence calls executed outside `runtimeAction`; those can still synchronously block, or overlap worker writes.
- Worker crash after a durable WAL commit but before ACK with real server process restart, and exactly-once adjudication end to end under injection.
- Memory/queue bounds and load shedding under pathological backlog, without ever reintroducing unconditional GM reconnect disconnections.

## Non-negotiable release gates
1. Check the remaining direct store writes and prevent main-thread synchronous blocking/races.
2. Test worker crash at every multi-file WAL boundary, replay/idempotency of chat and CORRECT, forced termination and reconnect.
3. Run representative simultaneous GM+player chat/verdict load; record end-to-end latency percentiles and event-loop delay; compare against production `fbf4fd7`.
4. Maintain GM-only Reliquary isolation, persistent message durability, and graceful shutdown/recovery.
5. Review and deploy separately, only with an explicit release window and rollback plan. Never claim zero lag without production measurements.
