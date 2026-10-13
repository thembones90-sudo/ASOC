# GM / Chat Latency Incident — 2026-10-13

## Safety and scope

Investigation and changes were performed offline in `A:\ASOC-RAID-SAFE` on branch
`diagnose/chat-delivery-latency`. No remote host, Railway resource, credential,
production data, running service, push, deployment, restart, pull, reset, rebase,
or merge was touched.

Production is serving an active match. **Do not push or deploy during the match.**
Wait for the match to end and obtain separate, explicit authorization before any
push or deployment.

## Evidence and findings

- `persistActiveRooms()` is synchronous and rewrites the complete recovery
  snapshot. `durable-io.js` writes an fsynced transaction journal, each queued
  target file, atomic renames, and directory fsyncs. A plain accepted chat line
  therefore blocks the event loop until its room snapshot commits. A CORRECT
  verdict can queue room, player, and match-store changes and consequently has
  a larger serial fsync set. This ordering is intentional: accepted chat and
  adjudication are not delivered before durability.
- The transaction wrapper queues WebSocket frames and flushes them only after
  `durableIO.commit()`. The chat ACK is constructed before `persistActiveRooms`,
  but is not sent before commit; acceptance durability was not weakened.
- The one-second battle clock broadcast includes `state:public`, not chat
  history. Chat is bounded to a 200-message recovery tail, a 100-message live
  snapshot, and single-message deltas for capable clients. Existing
  `tests/persistence-bloat.js` confirmed the recovery snapshot stayed below its
  200 KiB fixture budget.
- Commit `e14b85d` reduced clock-only room snapshots to approximately once per
  five seconds, but the cadence had two correctness gaps:
  - normal→Borrowed and Borrowed→expired transitions could be broadcast without
    an immediate recovery snapshot when the five-second write was not due;
  - the timer subtracted a fixed 1,000 ms per callback, so a 37–40 second
    synchronous stall could grant almost that much extra battle time.
- A successful non-timer persistence already captures the current timer. The
  previous throttle did not record that fact, so a timer-only fsync could occur
  shortly afterward even though the snapshot was fresh.
- Outbound WebSocket delivery had no `bufferedAmount` guard. A slow or
  non-reading client could accumulate repeated state/chat frames in process
  memory. Low CPU does not exclude event-loop blocking on synchronous fsync or
  kernel/network backpressure.
- The production HTTP evidence (37–40 second concurrent static responses,
  repeated WebSocket reconnects, low CPU) is consistent with event-loop stalls,
  but this offline change does not prove that synchronous storage was the only
  production cause. No production improvement is claimed without post-release
  measurements.

## Changes

- `server.js`
  - measures timer progress using actual elapsed wall time between callbacks;
  - carries a delayed tick's overrun across the normal/Borrowed boundary;
  - forces immediate persistence for timer phase transitions;
  - records every successful room snapshot as the latest timer snapshot,
    avoiding a redundant timer-only write within the next five seconds;
  - clears/restarts the transient elapsed-time baseline on start, pause, resume,
    stopped-clock correction, and Casual/Battle transitions;
  - warns (rate limited, identity-free) when a socket has at least 2 MiB queued;
  - terminates a socket at 8 MiB queued so it can reconnect and resync instead
    of growing an unbounded server-side buffer. Logs contain byte counts only.
- `battle-timer-tick.js`
  - isolates deterministic timer arithmetic for focused testing.
- `tests/battle-timer-tick.js`
  - covers ordinary elapsed ticks, a 40-second stall crossing into Borrowed
    Time, a stall crossing both clock boundaries, Borrowed expiry, and pause
    safety.
- `docs/GM-CHAT-LATENCY-INCIDENT-20261013.md`
  - this investigation and release handoff.

No message text, player name, account identifier, token, or path was added to
performance logs.

## Test results

Passed:

```text
node --check server.js
node --check battle-timer-tick.js
node tests/battle-timer-tick.js
node tests/automatic-column-countdown.js
node tests/raid-chat-load.js
node tests/chat-deltas.js
node tests/raid-live-chat.js
node tests/spit-delivery.js
node tests/scoring-audit.js
node tests/persistence-bloat.js
node tests/scoreboard-reset.js
git diff --check
```

Notable local measurement: `tests/raid-chat-load.js` delivered all messages to
three raiders and three spectators in 902 ms. This is a local test result, not a
production latency forecast.

Broad-suite issue:

```text
node tests/run.js
```

failed twice at the same early assertion: timeout waiting for the catastrophic
`/roll 1 1` chat event. This is a **preexisting test contradiction**, verified
read-only with `git show e14b85d:server.js` and
`git show e14b85d:tests/run.js`: the baseline server rejects every player slash
command on the Battle surface (`BATTLE COMMANDS FORBIDDEN`), while the test's
`createRoom()` starts Battle by default and then expects a player's `/roll 1 1`
to succeed. The failure occurs before the suite reaches its later
timer/recovery sections. No slash-command behavior or unrelated test was
changed in this incident patch. Dedicated chat, delivery, scoring, persistence,
and countdown tests above passed.

## Durability and recovery semantics

- Chat acceptance and GM adjudication remain transactionally persisted before
  any queued ACK or broadcast is delivered.
- Clock-only recovery snapshots remain bounded to about five seconds. A crash
  between them may restore up to roughly five seconds more time, matching the
  intended `e14b85d` tradeoff.
- Phase transitions now persist immediately, so recovery should not move back
  across a normal/Borrowed/expired boundary already shown to clients.
- Server downtime itself is not charged to the clock: the transient last-tick
  timestamp is deliberately not serialized. The first restored tick uses the
  existing one-second recovery behavior.
- Synchronous stalls while the process is alive are charged to the clock. If a
  stall spans the boundary, excess elapsed time is charged to Borrowed Time.

## Risks and follow-up measurements

- Synchronous durable I/O still blocks the Node.js event loop. Moving fsync work
  to a worker or redesigning the persistence journal is a larger architectural
  change and was intentionally excluded from this live-incident patch.
- A client above the 8 MiB backpressure cutoff will disconnect and must
  reconnect. Durable chat and state resync make this safer than unbounded
  buffering, but the threshold should be observed after release.
- `state:public` still broadcasts once per second. Measure serialized payload
  sizes, event-loop delay, room snapshot duration, socket buffered bytes,
  reconnect rate, and static-response latency after an authorized release.
- The existing slow-write warning is global and rate limited. It establishes
  duration without exposing room or user data, but does not yet attribute time
  among journal/file/directory fsync stages.

## Release plan

1. Wait until the active match has ended.
2. Obtain separate explicit authorization to push and a separate authorization
   to deploy/restart production.
3. Before release, rerun the focused commands above and investigate the
   reproducible `tests/run.js` catastrophic-roll failure (or document an
   accepted waiver).
4. Review the local commit diff against production `e0dae6a`; include prior
   diagnostic commits `fc79925` and `e14b85d` intentionally.
5. Deploy only in an announced maintenance window with no active room.
6. Observe slow room-write duration, event-loop/static response latency,
   WebSocket backpressure warnings/disconnects, and reconnect rate. Compare
   measured before/after values; do not infer success from low CPU alone.
7. Exercise one non-production chat acceptance and one GM verdict, verifying
   ACK/broadcast and reconnect recovery.

## Rollback

The known production baseline is `e0dae6a`. If post-release measurements worsen
latency, reconnect rate, timer behavior, chat delivery, or adjudication, stop new
game starts and roll the application release back to `e0dae6a` using the normal
deployment rollback procedure. Do not rewrite this diagnosis branch or alter
production data. Confirm the rollback health endpoint, reconnect recovery, and
static response latency before reopening play. Any rollback still requires the
same explicit production authorization and must not occur during an active
match unless the incident commander separately authorizes emergency action.
