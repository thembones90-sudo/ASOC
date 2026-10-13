# ASOC P0 deep-latency investigation | 2026-10-13

## Production evidence (read-only)
- Railway service `asoc-live` has one replica in `sfo` (San Francisco), verified via service configuration. The app predominantly serves Serbian / European players.
- Latest production `[realtime-performance]` batch for 300 `chat:guess` actions:
  - validation+mutation median 80.8ms, p95 114.5ms, worst 144.3ms
  - persistence/wait median 566ms, p95 710.9ms, p99 1339.2ms, worst 1602.9ms
  - total server median 653.5ms, p95 799ms, p99 1448.7ms, worst 1675ms.
  - 11-13 outgoing frames at p50/p95 is consistent with fanout to roughly that many clients, **not proof of redundant messages**.
- Railway observed periodic blocking room recovery writes >75ms. Recent examples 80-113ms; earlier boot writes >500ms.
- Railway logged a 48,528,352-byte WebSocket send backlog.
- 40 sequential keep-alive GETs to `/api/build` from SKYNET: min 179.2ms, p50 182.65ms, p95 425.21ms, max 428.31ms; all HTTP success.
- CPU and memory are not sustained at peak utilization.

## Interpretation and precise limitations
- Production telemetry before this patch **attributes all time from the end of one mutation through the completed batch commit to "persistence"**. That includes other mutations, batch preparation, disk fsync and wait. It is not a pure disk latency metric.
- Ordinary chat waits on synchronous durability before authoritative delivery in current deployed production. The ongoing Persistence V2 worker candidate removes synchronous write blocking from the main event loop but must retain commit-before-broadcast.
- Remote SFO region contributes unavoidable network RTT; cannot achieve literally 0ms delivery. An EU replica requires coordinated migration of authoritative persistent volume data, not just changing a flag.
- Oversized WebSocket queues are a separate risk; classify payloads before changing backpressure limits. Never reintroduce automatic 8MB GM disconnect, which previously caused a reconnect loop.
- Private Reliquary data must NEVER reach player sockets or public endpoints; performance work must not weaken existing access controls.

## Additional isolated candidate instrumentation
- `server.js` records queue wait, validation/mutation, batch preparation, pure worker commit, total server latency separately.
- `realtime-metrics.js` includes these statistics in aggregate-only reporting.
- `sendDurableFrame` adds a rate-limited >512KiB oversized frame warning that reports a whitelisted frame category and byte count only. No player names, content, tokens or room ids.
- Local syntax and regression tests (scoring audit, chat delta recovery, WebSocket liveness during slow commit, Reliquary privacy and worker durability) passed.
- New WAL crash injection tests passed both after journal persistence and after materializing the first of two files; unacknowledged commits reject, restart replays both stores, subsequent restart is stable.
- Twelve GM broadcasts submitted in one burst with a 600ms artificial worker disk delay were all received in 612ms in one local run, demonstrating batching (not a production SLA).

## Release blockers / path to completion
1. Full worker-crash and process-crash injection at multi-file WAL boundaries, exactly-once chat and verdict replay.
2. Measure heavy 10-20 client messages and GM adjudications, including p50/p95/p99 and queue depth, with representative large room state.
3. Verify writes outside `runtimeAction` cannot overlap worker transactions or stall the main event loop on hot paths.
4. Run an isolated European-region staging deployment with a separate test database/volume and synthetic room; compare network and durable storage RTT. Plan safe data copy and rollback before moving the production volume.
5. Investigate the cause of 48MB outgoing backpressure using category/size telemetry, including full chat snapshot for legacy clients, and GM hydration. Use on-demand pagination/caching where applicable; preserve the privacy boundary.
6. Deploy a reviewed worker candidate only after all critical crash/recovery/scoring tests and an explicit controlled release window. Latest completed production remains separate from this local branch.

## Safety
No production changes made by this investigation. Do not claim chat is now instant. No zero-latency promise is physically meaningful. Prefer near-instant UI optimistic display with authoritative acknowledgment and rollback/status tracking only after confirming reliable idempotency.
