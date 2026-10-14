# ASOC P0 — EU migration and recovery-payload investigation (2026-10-14)

Branch: `perf/asoc-eu-p0-20261014`
Status: verification complete for targeted tests; production cutover NOT authorized or performed.

## Railway reality (read-only verified)

- Production `asoc-live`: `main` commit `542b185`, one `sfo` replica with original 500MB volume.
- EU synthetic staging: `feature/asoc-persistence-v2-validated` commit `264c82f`, one `europe-west4-drams3a` replica with separate synthetic-only 300MB volume.
- No staging/production changes were deployed by this work. Never point live data at the synthetic staging volume.

## Fresh regional benchmark from SKYNET

30 successful uncached-ish GET `/api/build` requests each, sequentially interleaved:
- SFO production p50 **192.25ms**, p95 **217.22ms**, max 331.84ms.
- EU staging p50 **51.09ms**, p95 **70.76ms**, max 173.16ms.
- These are HTTP probe timings from one Serbian client host, not full chat/GM real-world latency guarantees.

## Candidate regression tests freshly run on clean worktree

- PASS: durable worker; WAL crash; partial-WAL crash; worker protocol liveness.
- PASS: chat delta compatibility; payload budget; Reliquary adversarial GM-only access.
- PASS: four browser clients: 455ms message delivery with 200ms injected storage, HTTP worst 1ms.
- PASS: twelve browser clients: 492ms delivery with 200ms injected storage, HTTP worst 2ms.
- PASS: real raid chat local server test.
- PASS: scoring audit three consecutive runs (150.76s total); includes CORRECT/reversal, Final, Shadow Coins.
- Caveat: verification machine Node 24 while package engines specify Node 22; run exact-version qualification before production.

## Read-only production data inspection and backup

- Railway owner authorized CLI login; full-volume preflight download from production completed on A:.
- Verified **87 files / 59,867,352 bytes (57.09MiB)** in the read-only download; required core files present and critical JSON parsed.
- SHA-256 manifest saved privately alongside the local backup. Do NOT commit, publish, or upload this backup or its manifest.
- Production remained writable during transfer: this is an **exploratory preflight backup, not the consistent final cutover snapshot**.
- The temporary Railway SSH key was unregistered and deleted afterward.

## Concrete recovery-state bloat finding (aggregate structural sizes only)

- A single active-room recovery snapshot was 26,180,285 bytes.
- The `bloodTributes` JSON subtree accounted for approximately 25,445,558 bytes.
- Of that, 72 `imageData` values accounted for approximately 25,406,779 bytes; no tribute content inspected or emitted.
- Ordinary room chat occupied approximately 139,663 bytes.
- `durable-io.writeJson` still invokes synchronous `JSON.stringify(value, null, 2)` before the worker commit. A local synthetic ~26.7MB serialization benchmark took 18.02ms median (5 samples), but this does not include recovery projection, disk, queue wait, or remote RTT.
- Do **not** delete/strip `imageData` without a verified private, durable, crash-safe media reference and restoration scheme. Preserve the Reliquary security boundary and exact old-state recovery behavior.

## P0 follow-up gates

1. Implement and test a **lossless private tribute-media storage strategy** that avoids serializing ~25MB of image data on routine chat/timer persistence. Audit existing INFOSTUD mirrors and fallback/media availability; never treat their mere ID presence as proof of readable durable content.
2. Re-run security adversarial tests, WAL crash tests, process restart, legacy recovery, and repeated scoring with realistic large room state. Target Node 22.
3. Investigate WebSocket frame backlog independently: previous 48.5MB queue is unproven to originate from tribute payloads. Retain privacy-safe payload category metrics.
4. Before migration: announce downtime, verify no match in progress, halt authoritative writes, take **final consistent** snapshot of SFO volume, verify SHA-256 manifest and complete restoration. No public access or dual writers on a new EU instance.
5. Provision a new EU production replacement volume/service separate from synthetic staging, transfer private data and variables securely, validate health and GM/player reconnect/score/reliquary in isolation, then cut over domain once.
6. Keep original SFO volume untouched for rollback. Reconcile data if EU has accepted writes before any rollback.
7. Obtain explicit maintenance/cutover authorization. No production merge, redeploy, migration, or rollback was executed here.

## Additional GM-only WebSocket payload risk

- `getBloodTributeVaultState()` embeds `imageData` in every entry of the `tribute:vault` response.
- `sendTributeVaultToHost()` transmits the whole vault to an authenticated, Reliquary-unlocked GM, and is invoked from several state-changing paths.
- The 25.4MB retained tribute-image footprint creates a plausible mechanism for huge GM-side WebSocket frames and buffered send queues. This is **not confirmation** that the historical 48.5MB backpressure event came from the vault.
- Qualify with aggregate, privacy-safe per-frame byte telemetry; introduce private, paged/on-demand media retrieval or authenticated delta updates if verified. Avoid public URLs, dropping images, or silent skipped frames.
