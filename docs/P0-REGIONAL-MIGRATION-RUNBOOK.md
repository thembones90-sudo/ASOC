# ASOC P0 — Data-safe Europe migration and cutover

**State:** Prepared, NOT executed. Never perform while an ASOC game is active. Do not remove or overwrite the existing San Francisco volume.

## Verified prerequisites
- Current live production project: `e27dfd2c-6908-4a60-b0d8-0bd3e268270b`, service: `29e504d6-cb3c-4677-973a-343ad154f0d3`, environment: `1e96b3ba-690d-41a8-9ce7-5b600cffa586`.
- Current live commit at audit: `542b185`; live service has one replica in `sfo`.
- Candidate `264c82f` is running in isolated EU staging; synthetic-only volume. Never copy real production data into this synthetic staging project.
- Latest isolated EU 55-request `/api/build` test: p50 42.56ms / p95 67.36ms; SFO baseline p50 181.64ms / p95 189.04ms.
- EU 35-request WebSocket ping p50 39.58ms / p95 47.55ms; SFO p50 178.43ms / p95 181.93ms.
- EU staging 15 synthetic GM chat messages p95 70.23ms, no error.
- Latest candidate runs: 3 consecutive scoring audit passes; 12-client browser load with 200ms injected disk delivered all messages in 490ms; both WAL crash-replay windows and Reliquary adversarial tests pass.

## BLOCKER
The Railway connector supports volume management, but not volume file access. Railway CLI v5.67.1 is installed on SKYNET A drive. One-time user login approval is required before CLI can download volume contents. The CLI provides:
- `railway volume list --json`
- `railway volume files list / --json`
- `railway volume files download / <LOCAL_PATH> --concurrency 4`
- `railway volume files upload <LOCAL_PATH> /<PATH>`

## Migration sequence (must be executed in order)
1. Confirm no match is in progress; announce short maintenance window and temporarily stop mutating operations before final snapshot. No two live writable instances sharing the same authoritative room data.
2. Obtain CLI login from the owner. Link the CLI explicitly to production project/service/environment. Inspect volume mount and contents read-only.
3. Create a full production volume copy to a private directory **on A:**, never on C:. Preserve binary/private artifacts, permissions where supported, both room and player/match stores, private Reliquary marker/image files, and system JSON. Reject files missing or unreadable. Compute and save SHA256 manifest, file count, aggregate size, and restore test. Do not expose actual data in logs/chat/reports.
4. Prepare separate production-replacement Railway service/volume in EU, with matching trusted server configuration, production-only secrets transferred through secure variable settings without displaying them to the assistant. DO NOT use the existing synthetic staging volume.
5. During stopped-write window perform final full copy or incremental synchronization, validate hashes and WAL recovery in a sealed EU environment with no public traffic.
6. Perform controlled service/domain routing cutover, ensuring at most one authoritative writer. Start validated commit, check /health, GM and player WebSocket join and reconnect, existing account/ledger and private Reliquary records, and real chat/CORRECT p50/p95/p99.
7. Keep old SFO volume intact, immutable, for rollback. Roll back routing and source if health, latency, privacy, or scoring checks fail. Reconcile any post-cutover writes before rollback; never silently overwrite newer EU records with an older snapshot.
8. Remove temporary staging resources only after successful stabilization and explicit owner approval.

## Alternative early improvement
A same-region code-only cutover of Persistence V2 may reduce event-loop stalls before a region migration. It preserves the mounted production volume and needs a controlled maintenance window with verified rollback, but it will NOT remove the ~180ms transatlantic network RTT. Do not treat code-only rollout as a complete zero-lag fix.

## Non-negotiable
GM-only Reliquary. Do not place its data in player payloads or public uploads. No artificial ACK before WAL fsync, no lost/duplicated verdicts, no unconditional 8MB GM disconnects. Backup first, then migrate. No blind region switch with attached data.
