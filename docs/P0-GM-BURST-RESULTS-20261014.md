# ASOC Persistence V2 — 20-player GM verdict latency validation
Date: 2026-10-14
Branch: perf/asoc-p0-integration
Production has NOT been changed by this work.

## Reproducible test
- `node tests/persistence-v2-gm-burst.js`: 20 authenticated WebSocket Little Heroes, one authenticated GM, BATTLE mode, valid five-person ritual, clock started, A1 revealed; the GM accepts a genuine A-column guess while 19 other players simultaneously submit chat.
- Required invariants: all submitted guesses delivered to GM, GM receives `gm:judge:ack` rather than an error, no verdict overtakes the durable acceptance barrier, chat messages retain order.
- `ASOC_P0_SIMULATED_DISK_MS` configures a synthetic per-atomic-write delay. Do NOT equate it to an actual Railway disk latency measurement.
- The test can emit privacy-safe GM timing buckets with `ASOC_TEST_CAPTURE_REALTIME=1`. The shared browser harness now captures child stdout only under that test flag. Production uses its standard telemetry floor and is unaffected.

## Measured isolated runs (single examples, not p95 guarantees)
- Default same-turn coalescing + 200ms injected delay: GM ACK 1200ms, player batch 1198ms.
- New default 4ms coalescing + 200ms injected delay: GM ACK 875ms, player batch 873ms.
- Configured 10ms coalescing + 200ms injected delay: GM ACK 883ms, player batch 881ms. The wider window provides no demonstrated benefit.
- With 4ms coalescing and 200ms injected delay, a diagnostic run reported queue 17.6ms, scoring mutation 4.9ms, **multi-file persistence 852.1ms**, total queue-to-broadcast 879.4ms; 527 outgoing WebSocket frames across the entire fan-out.
- With 4ms coalescing and 0ms injected delay, GM ACK **37ms**, player burst 35ms, queue 18.2ms, mutation 4.2ms, persistence **7.7ms**, queue-to-broadcast 35.9ms.
- A separate 20-browser-client chat-only test with 200ms injected delay delivered all messages once in 608ms; unrelated HTTP worst 2ms. The test originally hardcoded its label and has been made parameterized.

## Root cause and caution
- Multi-file WAL writes are correct and replayable, but under an artificially slow volume they pay a separate atomic file write/fsync for journal and each target. Event-loop isolation prevents unrelated service stalls, not the server ACK waiting on durability.
- Do NOT acknowledge before WAL durability. An early ACK after the journal is durable but before materialization would require a separate explicitly crash-safe protocol, ordered WAL handling, materialization failure signaling, safe worker shutdown/drain and cache consistency audit. It has NOT been implemented and must not be treated as solved.
- The 4ms coalescing window is a local experiment, not an established production optimization. Avoid unconditional 8MB WebSocket disconnects and keep the Reliquary wholly GM-exclusive.
- Production currently runs `542b185` in SFO. Isolated synthetic-only EU staging (Amsterdam) previously measured much better RTT; the production volume cannot be moved without verified backup, restore test, cutover, and rollback.

## Current release gates
- Repeat the concurrent GM verdict test under realistic staging load and profile p50/p95/p99 on the destination Railway volume, not just synthetic local delays.
- Final integrated scoring, crash/recovery, Reliquary and full chat regressions must remain green.
- Address media/GIF/coin-drop synchronous writes separately without trading away accepted data or security.
- Before production migration: require user-controlled Railway CLI login and complete A:-drive copy with SHA256 manifest and restore rehearsal. Do not touch production while a match is active.
