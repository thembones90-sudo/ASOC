# Public chat latency improvement — 2026-10-15

Production inspected read-only: `c08545e` on `asoc-live`, Europe West.
No production chat, verdict, accounts, configuration, or saved data were changed.

## Cause and scope

Production `runtimeAction` still called synchronous JSON persistence/fsync on
the Node thread handling chat and WebSocket liveness. Recent ordinary room
recovery warnings measured roughly 240–300 ms; startup writes around 850 ms
are separate observations, not message latency measurements.

The previous worker candidate on `origin/feature/asoc-persistence-v2-validated`
had not reached production. Its worker, transaction queue, transport deltas,
aggregate diagnostics, and regression tests were reviewed and integrated with
current main without reverting FATEBREAKER, Mud Pits, lockdown, or Rage work.

Additional integration safeguards:

- One recovery snapshot serialization per ordered batch instead of per action.
- A synchronous legacy writer cannot race an in-flight worker WAL. Reads see
  the latest serialized store, preventing stale score/profile/coin overwrites.
- HTTP responses generated inside authoritative actions share the durable
  outbox: no successful upload acceptance before commit.
- URL preview completions enter the action queue and no longer perform a
  redundant all-settled save/broadcast. WebSocket remote-image completion is
  queued too.
- Queue, preparation, commit, queue-to-delivery and payload-category metrics
  are bounded and contain no message content, names, tokens or private images.

## Controlled comparison

`tests/hardening-chat-latency-benchmark.js`, same machine, isolated data root,
12 public GM messages, delta-capable receiver, 120 ms injected atomic write
latency. Baseline uses the unmodified production `HEAD:server.js` loaded into
the test subprocess; candidate uses the working tree. No production load test.

| Local measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Send-to-receive p50 | 802 ms | 141 ms |
| Send-to-receive p95/p99/worst | 1,598 ms | 141–278 ms across two runs |
| Concurrent liveness response | 1,567 ms | 0 ms |

Candidate p95 improved approximately 83–91%. A burst may occupy one or two
durable batches depending on socket arrival timing. This is a synthetic result,
not a promise about individual production messages or network connections.

Browser load: 12 real Chromium clients, 144 sender-to-receiver observations,
200 ms injected atomic storage delay. Latest sample: p50 486 ms, p95 535 ms,
p99 542 ms, worst 543 ms; whole burst 547 ms; HTTP worst 1 ms. All messages
appeared exactly once on every client, with no browser page errors.

## Verification

Passed: worker ordering/failure handling; worker death after WAL and first
target with replay; synchronous-write overlap preservation; durable HTTP
outbox; 32-action single-serialization batching; public chat burst; 4/12-client
browser load; immediate pending chat/retry; payload budgets; legacy/delta
compatibility, paging and resync; Reliquary adversarial access; scoring audit
(two full passes); hardening; persistence bloat; real raid chat; CASUAL pause;
Borrowed Time; Rage engine/server; FATEBREAKER engine/socket economy/restart;
Mud Pits rules; link previews; 20 MB poison tribute selection.

`tests/run.js` is NOT green: it times out expecting a player catastrophic roll
on the Battle surface, where current rules forbid player slash commands.
The identical timeout reproduced against unmodified production server source.
This pre-existing mismatch was not hidden by relaxing gameplay permissions.

One Rage test initially consumed an unrelated timer broadcast instead of the
queued forfeit response. Its response matcher now waits for the expected ended
state; winner and exact economy assertions remain unchanged.

## Limits and release

- Legacy HTTP/profile/upload paths with synchronous store APIs still block
  while writing; the safety barrier prevents data loss but is not an async
  replacement for every remaining synchronous operation. Routine public chat
  uses the worker, and normal URL preview completions are now queued.
- Worker commits still wait for actual fsync. Slow volume or network latency
  is not eliminated; production p95/p99 must be checked after an authorized
  release with genuine player traffic.
- Full read-only room projections can reflect in-memory state while a commit
  is pending; accepted chat/verdict frames and queued HTTP acceptance remain
  commit-gated. No authority/security boundary is weakened.
- This report does not authorize deployment. Keep production unchanged until
  the user requests pushing/releasing this persistence change. Preserve the
  durable volume, observe queue/payload metrics, and retain `c08545e` as the
  pre-change application revision for a controlled rollback.
