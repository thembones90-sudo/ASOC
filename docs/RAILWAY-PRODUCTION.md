# ASOC Railway Production Runbook

## Locked production topology

| Setting | Required value |
| --- | --- |
| Railway project | `ASOC Engine` |
| Railway service | `asoc-live` |
| Runtime | Node.js, `node server.js` |
| Replicas | **Exactly one** |
| Persistent volume mount | `/data` |
| Required variable | `ASOC_DATA_DIR=/data` |
| Existing secret | `ASOC_GM_PASSWORD` |
| Health check | `GET /health` |

MASTER is authoritative inside one Node process. Do not enable replicas,
multi-region deployment, Node cluster mode, or PM2 cluster mode. Railway does
not permit replicas on a volume-backed service; that limitation is a safety
property for ASOC because it prevents two writers from owning MASTER.

## Persistent data

Everything mutable must live under `/data`, including the MASTER recovery
snapshot, player/authentication data, player sessions, match archives, GM
lockouts, durable games, uploaded backgrounds, and other application state.
The repository and container filesystem outside `/data` are disposable.

At startup ASOC creates the configured data directory, performs a temporary
create/write/delete probe, and terminates with an explicit error if the data
root is not writable. A successful startup logs the resolved durable root but
does not list its contents or reveal secrets.

## 1. First volume attachment

Perform this only during planned maintenance and with MASTER unarmed.

1. Confirm the current service is `ASOC Engine / asoc-live`.
2. Take an off-platform copy of every existing mutable production file.
3. Create one Railway persistent volume and mount it at `/data`.
4. Do **not** create a second replica.
5. Add `ASOC_DATA_DIR=/data` to the production service variables.
6. Confirm `ASOC_GM_PASSWORD` remains configured as a Railway secret.
7. Review the staged changes before applying them. Attaching a volume causes a
   restart and a short outage.
8. Deploy only after the initial data migration below is ready.

## 2. Initial data migration

An empty `/data` causes ASOC to create a new unarmed MASTER. Therefore legacy
state must be copied before production is opened to players if it must survive.

1. Stop gameplay and leave MASTER unarmed.
2. Make a timestamped local backup of the legacy mutable files.
3. Copy the files into `/data`, preserving names and directory structure.
4. Include hidden files such as player-auth sessions and the GM password file
   only when they are intentionally being migrated. Never paste their contents
   into logs, issues, or chat.
5. Copy durable `assets/backgrounds` and game overlays beneath `/data`.
6. Start the service and inspect logs for recovery, migration, corruption, or
   write-lock warnings.
7. Verify `/health` returns HTTP 200 and `status: "ready"`.
8. Verify MASTER, identities, games, backgrounds, and archives before ARM.

Do not copy a live, actively changing `active-rooms.json` without first ending
the game or stopping the old writer. Only one process may write the data root.

## 3. Normal deployment

Deploy between games only.

1. KILL SESSION and leave MASTER unarmed.
2. Confirm clients show the unarmed state.
3. Take a Railway volume backup and an off-platform backup when the change is
   material.
4. Push the approved commit or manually promote the approved deployment.
5. Wait for Railway's `/health` gate to succeed.
6. Review startup logs for the resolved `/data` root and MASTER recovery.
7. Reconnect Shadow Broker and verify players, chat, WOMF, timers, and state.
8. ARM only after verification.

With a volume attached Railway cannot overlap old and new instances. A short
outage and WebSocket reconnection are expected during deployment.

## 4. Backup

Railway volume backups are necessary but are not the only backup.

1. Enable automatic Railway volume backups (daily is recommended).
2. Before a risky deploy, schema migration, or manual data operation, create an
   on-demand volume backup.
3. At least weekly, export `/data` to encrypted off-platform storage.
4. Keep more than one off-platform generation and record its timestamp and
   deployed Git commit.
5. Do not store backup archives inside the same `/data` volume as the only copy.
6. Periodically restore into an isolated service/data directory and verify that
   MASTER and identities load. An untested backup is not a recovery plan.

Critical files include `active-rooms.json`, player/auth data, match archives,
game content, uploaded backgrounds, GM lockouts, session files, and any private
tribute data retained by the application.

## 5. Restore

1. Keep the production service stopped or unarmed so no writer is active.
2. Preserve the damaged/current `/data` as a forensic copy when possible.
3. Restore a Railway volume backup, or create a replacement volume and copy the
   selected off-platform generation into it.
4. Ensure the restored structure is rooted directly at `/data` rather than an
   accidental nested `/data/data` directory.
5. Start exactly one replica.
6. Confirm `/health` is 200.
7. Inspect startup logs for recovery counts and corruption/write-lock errors.
8. Verify MASTER, players, authentication, match history, games, backgrounds,
   WOMF, and pending state before allowing gameplay.

## 6. Rollback

A code rollback does not automatically roll back `/data`.

1. Leave MASTER unarmed.
2. Record the failed deployment ID and current data backup timestamp.
3. Roll back to the last known-good Railway deployment.
4. Restore data only if the failed version changed it incompatibly. Never
   blindly pair old code with newer data.
5. Wait for `/health`, inspect recovery logs, and validate MASTER before ARM.

## 7. Check disk usage

Monitor Railway volume usage and configure an alert before the disk is nearly
full. Investigate growth in uploaded backgrounds, avatars, tribute images,
archives, quarantine files, temporary files, and old manual exports. Never
delete production data merely to silence an alert; back it up and identify its
owner first.

## 8. Verify MASTER recovery

After any restart or restore:

1. Confirm startup logs report the durable data directory as `/data`.
2. Confirm recovery reports MASTER when a snapshot existed.
3. Open the player view and confirm persistent identity/login.
4. Reconnect Shadow Broker.
5. Confirm MASTER armed/unarmed status, selected game, board state, permanent
   chat, WOMF, Wheel/Blood Tribute state, timer, scores, and match history.
6. Do not ARM until the recovered state is understood.

## 9. Planned maintenance

1. Announce maintenance and stop accepting new gameplay.
2. KILL SESSION / leave MASTER unarmed.
3. Confirm persistence and take both platform and off-platform backups.
4. Apply one reviewed change at a time.
5. Wait for `/health` and inspect logs.
6. Complete the MASTER recovery checklist.
7. Reopen gameplay.

## 10. Emergency recovery

1. Do not repeatedly restart a crash-looping service; preserve logs first.
2. Stop the writer if corruption or incompatible data is suspected.
3. Preserve `/data` before attempting repair.
4. Roll back code when the failure is code-only.
5. Restore the newest known-good data generation when the volume is damaged.
6. If Railway volume recovery is unavailable, create a new volume at `/data`,
   restore the off-platform export, and attach it to one service instance.
7. Validate health and every durable subsystem before ARM.

## Graceful shutdown behavior

On `SIGTERM` or `SIGINT`, ASOC enters shutdown mode once, rejects new socket
mutations, persists active rooms and synchronous auth/lockout stores, closes
WebSockets with restart code 1012, closes HTTP, and exits cleanly. A bounded
grace timer forces termination if shutdown hangs. During shutdown `/health`
returns HTTP 503 with `status: "shutting-down"`.

The current stores use synchronous writes, so there is no asynchronous database
flush queue. Their normal save functions complete before shutdown continues.

## Single-instance protection

Do not use a persistent lock file as a substitute for Railway topology: a crash
can leave a stale lock that prevents recovery, while container PIDs and
hostnames are not durable ownership proofs. The safe simple guard is operational:

- one volume attached to one service;
- exactly one replica;
- no overlapping volume-backed deployment;
- no second service pointed at the same data;
- no cluster-mode process manager.

If ASOC later needs multiple replicas, move authoritative durable state to
Postgres, connection coordination/pub-sub to Redis, and binary uploads to object
storage before enabling them.

## Deployment safety checklist

- [ ] MASTER is unarmed; active game has ended.
- [ ] Correct project/service: `ASOC Engine / asoc-live`.
- [ ] Exactly one replica.
- [ ] Volume mounted at `/data`.
- [ ] `ASOC_DATA_DIR=/data`.
- [ ] `ASOC_GM_PASSWORD` still present as a secret.
- [ ] Railway backup completed.
- [ ] Off-platform backup current.
- [ ] Approved commit identified.
- [ ] Deploy initiated between games.
- [ ] `/health` returned 200.
- [ ] Startup logs show `/data` and expected recovery.
- [ ] Shadow Broker reconnected.
- [ ] Players/accounts verified.
- [ ] Chat, WOMF, timer, scoring, and persistent state verified.
- [ ] ARM performed only after all checks passed.

## Hardening controls (2026-09-29)

All have safe defaults; set them only to tune. `npm test` (every `tests/*.js`
file) must be green in GitHub Actions before a deploy.

| Variable | Default | Purpose |
|---|---|---|
| `ASOC_TRUST_PROXY` | unset | `1` behind Railway: client address comes from `X-Forwarded-For`. |
| `ASOC_TRUSTED_PROXY_HOPS` | `1` | Which `X-Forwarded-For` entry is trusted, counted from the right (Railway's edge appends one). Leftmost entries are client-supplied and ignored. |
| `ASOC_GM_LOCKOUT_BASE_MS` | 15 min | GM login lock after 3 wrong passwords; doubles per further failure, max 24 h. No longer permanent. |
| `ASOC_AUTH_ACCOUNT_FAILURES` / `ASOC_AUTH_ACCOUNT_WINDOW_MS` | 5 / 15 min | Failed Little Hero logins per account. |
| `ASOC_AUTH_IP_FAILURES` / `ASOC_AUTH_IP_WINDOW_MS` | 30 / 15 min | Failed Little Hero logins per client address. |
| `ASOC_AUTH_IP_REGISTRATIONS` / `ASOC_AUTH_REGISTER_WINDOW_MS` | 40 / 60 min | New accounts per client address. |
| `ASOC_AUTH_HASH_CONCURRENCY` / `ASOC_AUTH_HASH_QUEUE` | 2 / 32 | Concurrent async password hashes; beyond the queue, auth answers 503 AUTH_BUSY. |
| `ASOC_CHAT_UPLOAD_MIN_GAP_MS` | 3000 | Minimum gap between one Little Hero's chat image uploads. |
| `ASOC_CHAT_UPLOAD_MAX_COUNT` / `ASOC_CHAT_UPLOAD_MAX_WINDOW_BYTES` / `ASOC_CHAT_UPLOAD_WINDOW_MS` | 8 / 25 MB / 5 min | Per-player upload window. |
| `ASOC_CHAT_UPLOAD_BUDGET_BYTES` | 2 GB | Total `chat-uploads/` budget; uploads answer 507 when full. |
| `ASOC_MIN_FREE_DISK_BYTES` | 256 MB | Uploads pause while the volume has less free space. |
| `ASOC_CHAT_UPLOAD_SWEEP_INTERVAL_MS` / `ASOC_CHAT_UPLOAD_SWEEP_GRACE_MS` | 1 h / 24 h | Orphaned-upload sweep. A file is kept while ANY room state or durable JSON store references it, while it has a `.tribute` marker, or while younger than the grace period. |
| `ASOC_OFFLINE_IDENTITY_TTL_MS` | 30 days | Offline Little Heroes leave the live MASTER roster after this; account, profile, coins and session score are kept. |

Administrative Shadow Coin grants never run at startup. Use
`node scripts/grant-shadow-coins.js` (dry run without `--yes`) with the server
stopped and `ASOC_DATA_DIR=/data`.
