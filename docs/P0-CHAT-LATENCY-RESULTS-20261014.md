# ASOC P0 Chat Latency, 2026-10-14 (NOT DEPLOYED)

## Live service baseline
- Live `asocengine.com` serves from Railway Amsterdam region but still runs production `main` commit `542b185` (legacy synchronous persistence).
- Local (SKYNET) networking before/after EU move: production US median HTTP ~192ms / WebSocket 178ms; EU median HTTP ~49ms / WS 36ms.
- EU live runtime logs regularly show room recovery write preparation taking ~230-350ms. This is a direct contributor to the user's >=1s perceived send delay, distinct from network RTT.

## Reproducible isolated simulation
All tests use synthetic-only data on localhost, separate files, no live state. Test harness: `A:\ASOC-CHAT-LATENCY-BASELINE-20261014\tests\latency-baseline-probe.js` and matching `A:\ASOC-CHAT-LATENCY-20261014\tests\latency-baseline-probe.js`; heavy test `tests/chat-heavy-recovery-benchmark.js`.

| Code & fixture | Browser clients/messages | Injected storage delay | Delivery P95 | Worst HTTP probe |
| --- | ---: | ---: | ---: | ---: |
| Live-main code on localhost, small synthetic room | 12 / 12 | 200ms | 4513ms | 4052ms |
| Clean Persistence V2, small room | 12 / 12 | 200ms | 503ms | 1.1ms |
| Clean Persistence V2, 72 synthetic media (~25.8MB) | 12 / 12 | 200ms | 1107ms | 91ms |
| Uncommitted V2 + private media extraction, before verification cache | 12 / 12 | 200ms | 820ms | 0.9ms |
| Uncommitted V2 + extraction + verified-file metadata cache | 12 / 12 | 200ms | 545ms first run, **471ms** repeat | 0.95ms |

Independent 25-message / 12-client / 5-round V2 benchmark on small room with correctly enabled NODE_ENV=test: sender render p50 444ms / p95 552ms; receiver render p50 444ms / p95 566ms; ack p50 438ms / p95 546ms. A draft run that lacked NODE_ENV=test disabled the simulated delay and MUST NOT be used as evidence.

## Media extraction and verification
- 72 synthetic images: 25,817,770 byte original recovery JSON became ~61.6 KB on-disk recovery data after real-server persistence, with private verified blobs on disk.
- Restart test: 72/72 synthetic images restored byte-for-byte after complete process exit and re-launch.
- `tribute-media-store.js`: added content-hash verification cache keyed to file metadata (device, inode, size, modified and creation timestamps); rehash on changes; removed/stale/corrupt files fail closed. `server.js` uses it for hot persistence and GM media-availability metadata.
- `server.js`: malformed/missing legacy public tribute expiry is treated as expired rather than leaking archived data to player sockets.
- `tests/tribute-media-benchmark.js`: median JSON stringify time improved from ~16.6ms for 25MB to ~0.01ms for compact JSON, with one-time conversion overhead.

## Tested gates PASS
- media store, media restart, contract, heavy real-server synthetic persistence+restart
- GM vault browser display and viewport lazy-loading
- Reliquary access and adversarial GM-only privacy; old GM receives explicit upgrade requirement instead of leaking
- Backdoor Reliquary visual logic, chat delta compatibility
- worker WAL/partial WAL crash recovery
- scoring and Shadow Coin audit
- Persistence V2 12-browser load; HTTP worst 2ms
- black market tribute upload test

## Release blockers, NO production deploy allowed yet
- `tests/player-nudge.js` fails waiting for tribute acceptance.
- `tests/black-market-tribute-wire.js` fails waiting for GM acceptance.
- Both reproduced IDENTICALLY on clean V2 without new media changes (pre-existing, not caused by verification-cache patch), but remain release gates.
- GM viewport cards currently fetch full original media for lazy thumbnails, with cache capped by 12 entries but not bounded by bytes. Need true bounded thumbnail strategy or strict byte memory cap + pressure tests.
- Chunk transfer needs hard backpressure timeout/byte ceiling; verify revoke mid-transfer and stale/legacy clients under stress.
- Run full suite and repeated 12-20 client staging tests, test on Node 22 (local host runs Node 24), audit privacy for malformed legacy chat timestamps, verify rollback.
- Codex CLI successfully launched but hit ChatGPT usage limit mid-remediation; resume after quota.

## Source/workspaces
- `A:\ASOC-EU-P0-VERIFY-20261014`: UNCOMMITTED private-media + V2 changes. Do not discard.
- `A:\ASOC-CHAT-LATENCY-20261014`: clean V2 and synthetic 25-message timing test. May have untracked test files.
- `A:\ASOC-CHAT-LATENCY-BASELINE-20261014`: clean main baseline and untracked probe.
- The production domain and real data were NOT touched by these performance tests or code edits.

## Release path
1. Finish GM thumbnail byte bounds, legacy security and WS backpressure + tests.
2. Fix or correctly reconcile two pre-existing gameplay regression failures without weakening assertions.
3. Validate full scoring/recovery on V2 and encrypted/private-image integrity, promote on isolated EU staging.
4. Release to production only with backup, explicit cutover plan and verified rollback. Track real `chat:guess` p50/p95 and browser-visible delivery after release.
