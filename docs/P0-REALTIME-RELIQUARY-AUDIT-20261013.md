# P0 real-time and Reliquary audit — 2026-10-13

## Baseline and scope

Worktree: `A:\ASOC-RAID-SAFE`, branch `fix/chat-lag-timer-transport`, baseline
`92c5922`. No production data, deployment, push, scoring rule, or UI was changed.

## Verified root causes

1. A normal chat mutation queued one recovery file but `durable-io` still wrote
   an fsynced transaction journal, then the fsynced target, then removed and
   synced the journal directory. This redundant WAL round trip was on the
   persistence-before-delivery path.
2. Multi-file authoritative actions remain synchronous. Production's measured
   549–631 ms recovery writes can therefore still block the event loop; this
   release candidate improves the dominant one-file chat path but does not
   claim to complete an asynchronous persistence redesign.
3. Black Market binary tributes were stored under `/uploads/chat/<random>` and
   the HTTP route had no authentication. Random names reduced discoverability
   but did not enforce the required authorization boundary.
4. The timestamp fix in `92c5922` correctly rejects missing, malformed,
   infinite, current, and expired Reliquary unlock values.

## Changes

- `durable-io.js`: one-target transactions now call the existing atomic,
  fsynced write directly. Multi-target transactions retain the write-ahead
  journal. Test-only deterministic storage latency and legacy-path switches
  support repeatable comparison.
- `server.js`: Black Market tribute files receive a `.private` sidecar and the
  HTTP route returns indistinguishable 404 responses. GM projections and vault
  payloads receive data bytes through authenticated WebSocket messages, not
  reusable URLs. Vault reads, mutations, clears, locks, and GM Black Market
  projections require an authenticated host; vault hydration additionally
  requires an unexpired Reliquary unlock.
- `realtime-metrics.js`: bounded, aggregate-only p50/p95/p99/worst server
  timings for chat, GM broadcast and verdict actions, split into mutation,
  persistence and total server stages. No message, room, identity or token is
  recorded.
- Tests add live forged-player Reliquary attacks, the single-write durability
  invariant, deterministic before/after timing, and telemetry privacy/math.

## Performance evidence

Thirty one-file commits with 25 ms deterministic latency per atomic write:

| Path | p50 | p95 | worst |
|---|---:|---:|---:|
| Previous WAL path | 61.8 ms | 63.7 ms | 86.5 ms |
| Single atomic target | 30.9 ms | 41.8 ms | 42.7 ms |

This is a 34% p95 reduction in the latest run (earlier run: 47%). The six-client
browser raid test delivered all six messages to three raiders and three
spectators in 831 ms total. These are local/simulated results, not production
SLO proof. Production p50/p95/p99 must be collected from the new aggregate log.

## Security evidence

The live adversarial test creates an ordinary authenticated player, a real
private Black Market tribute, and a populated Reliquary. The player sends
forged access, update, clear, lock, and host-recovery commands and requests the
known exact private image URL. No vault frame is received, no mutation occurs,
and HTTP returns 404. The authenticated GM unlocks with the server-side code and
receives the image bytes through the vault socket payload.

## Tests passed

- syntax: `server.js`, `durable-io.js`
- `tests/reliquary-access.js`
- `tests/reliquary-adversarial.js`
- `tests/player-auth-hardening.js`
- `tests/chat-upload-guard.js`
- `tests/direct-messages.js`
- `tests/durable-single-write.js`
- `tests/durable-chat-benchmark.js`
- `tests/realtime-metrics.js`
- `tests/raid-chat-load.js`
- `tests/chat-deltas.js`
- `tests/scoring-audit.js`
- `tests/persistence-bloat.js`
- `tests/battle-timer-tick.js`

`tests/black-market-tribute-wire.js` still times out because its old request
omits the now-required written GM verdict comment. This is a pre-existing test
contract mismatch at baseline `92c5922`, not caused by this patch.

`tests/gm-control-pass.js` stops waiting for player `/stats` while its room is
in Battle Mode, where the baseline server forbids player slash commands. The
monolithic `tests/run.js` likewise reaches the documented pre-existing timeout
waiting for `/roll 1 1` in Battle Mode. Both contradictions reproduce the
baseline contract and occur outside the changed persistence/security paths.

Additional passes from the broad run: all-columns Borrowed Time, scoreboard
reset, real raid chat, production readiness, adaptive timing, permanent Master
Room, authentication enforcement, static-file lockdown, and stable reconnect
identity.

## Crash/recovery and consistency

The fast path does not acknowledge before durability: `atomic()` writes and
fsyncs a temporary file, atomically renames it, and syncs the directory before
queued frames flush. Multi-file scoring/verdict transactions still use the WAL.
Accepted chat and authoritative verdict ordering is unchanged.

Private sidecars survive restart. Vault media is still present for GM recovery,
but has no public HTTP representation. Public chat media behavior is unchanged.

## Remaining risk and verification

- Multi-file GM verdict commits may still exceed the 500 ms target on slow
  production storage. A worker/WAL write-behind design remains a separate,
  higher-risk project and is not represented as solved here.
- Large unlocked GM vault hydration can still produce a large WebSocket frame;
  it is private and on-demand, but should be measured and eventually paged.
- Deployment region/network latency has not been measured from Belgrade in this
  offline worktree.

After an authorized deployment, collect `[realtime-performance]` aggregates,
reconnect counts, static response latency and socket buffered bytes. Roll back
to tag `asoc-prod-before-latency-20261013` if latency, reconnects, timer behavior,
or recovery worsens. No automatic disconnect threshold was reintroduced.

## Verified vs hypothesized

Verified: redundant single-file WAL cost, HTTP exposure of private Black Market
tribute URLs, server-side access gates, local durability, adversarial denial,
and focused regression results.

Not yet verified: production SLO compliance, European network contribution,
browser render cost with the longest real history, and whether storage accounts
for every historical 37–40 second stall.
