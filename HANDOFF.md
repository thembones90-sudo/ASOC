# HANDOFF — Shadow Broker Identity Layer

**Date:** 2026-09-18
**Session summary for:** whoever (or whichever AI assistant) picks this project up next.
**Supersedes:** the previous handoff (Scoring & Player Profiles layer, 2026-09-17). That work is unaffected and untouched this session — its locked rules now live permanently in `README.md`'s "Scoring & Player Profiles" section, so nothing is lost by this file being replaced.

This document describes the Shadow Broker GM-identity layer added to ASOC ENGINE, and — more importantly for anyone working on this repo via the desktop device bridge — a deployment reliability issue discovered this session that will bite you if you don't read the next section first.

---

## READ THIS FIRST — deploy writes to this device are not guaranteed to persist

Twice this session, a file write to `A:\ASOC ENGINE` (via the remote-devices `device_commit_files` tool) reported success — `written`, no `rejected` entries — and then silently did **not** persist. `index.html` and `js/app.js` each independently reverted to their previous content after a "successful" write, discovered only because the user reported the change wasn't actually live and I re-read the file directly off the device to confirm. The cause wasn't isolated to one call or one batch size; two separate commit calls, on two different single-file-mixed-with-others batches, each lost exactly one file.

**Practice going forward, no exceptions:** after every `device_commit_files` call, immediately re-stage every file you just wrote (`device_stage_files`) and byte-compare (or hash-compare) it against the source you meant to deploy, before telling the user anything is live. Do not trust the `written` array alone. A one-line shell loop for the compare:

```bash
for f in <relative paths under the project root>; do
  cmp -s "/mnt/user-data/outputs/ASOC ENGINE/$f" "/mnt/user-data/uploads/ASOC ENGINE/$f" \
    && echo "MATCH: $f" || echo "MISMATCH: $f"
done
```

(Stage device files into `/mnt/user-data/uploads/ASOC ENGINE/...` first — that's where `device_stage_files` lands them — and keep your own known-good copies under `/mnt/user-data/outputs/ASOC ENGINE/...` so `device_stage_files`, which overwrites the `uploads` copy, never clobbers your only good copy.)

A full 18-file audit was run at the end of this session (every file touched, hashed on both sides) and everything currently on the device matches. That audit is a point-in-time fact, not a standing guarantee — verify again after your own next deploy rather than assuming this reliability issue was a one-off.

---

## What this layer does

Adds a "Shadow Broker" GM identity to player communications, on top of the existing chat-adjudication flow. Full technical detail (server discriminator, shared markup, the three-surface board line, timing pattern, first-hydration guard, locked rules) now lives permanently in **`README.md`'s "Shadow Broker Identity Layer" section** — read that before touching any of this. This handoff covers what README doesn't: what changed, what broke, what was tested, and what's still open.

In one paragraph: the GM can (1) have every judged guess get an additional Broker verdict bubble ("Correct."/"Incorrect.") alongside the existing correct/wrong styling, (2) type a freestanding sentence that appears to all players as a Broker transmission, (3) see that same transmission appear as a HUD-style line above the Broker's avatar on the board itself — on their OWN working board, on Public View, and on every player's screen, all three in sync — and (4) do all of this from an input bar now living directly under the board rather than buried in the sidebar.

## Where things live

- `server.js` — `addShadowBrokerMessage()`, `handleGmBroadcast()`, the `gm:broadcast` WS case, and the `source` field in `getChatState()`. Also: `room:create` now sends the host an initial `chat:update` (see "Bugs found" below).
- `js/skeleton.js` — the ONE shared source for `shadowBrokerTransmissionHTML()` (chat bubble markup), `shadowBrokerLineStyle()`/`shadowBrokerLineState()` (board-line positioning/timing), and the timing constants (`BROKER_LINE_CHAR_MS`, `BROKER_LINE_HOLD_MS`, `BROKER_LINE_FADE_MS`).
- `js/app.js` — GM console: `sendShadowBrokerBroadcast()`, `flashShadowBrokerNoRoom()`, `createGMChatMessageHTML()` (uses the shared markup), `renderShadowBrokerLineHTML()`/`playShadowBrokerBoardLine()` for Public View, and the `chat:update` handler that detects new Broker messages (now also pokes `Board.playShadowBrokerBoardLine()`, see below).
- `js/board.js` — the GM's own working board now carries its own `_brokerLineText`/`_brokerLineStartedAt`/`_brokerLineTicker` triplet and `renderShadowBrokerLineHTML()`/`playShadowBrokerBoardLine()`, added this session so the GM sees the transmission on the board they're actually looking at, not just Public View.
- `js/player.js` — player screen: `createChatMessageHTML()` branches on `msg.source === 'shadowBroker'`, uses the shared markup for both standalone broadcasts and verdict responses, plus its own board-line triplet.
- `index.html` — `#gm-broker-bar` (sibling of `#board-layer`, under the board) holds the TRANSMIT form; `.gm-chat-panel` (GUESSES) is now read-only message log only.
- `join.html` — the `.shadow-broker-transmission` CSS that used to live here (inline `<style>`) moved to `css/asoc.css` so `index.html` could share it; only a pointer comment remains here.
- `css/asoc.css` — `.shadow-broker-transmission` and friends (shared bubble styling), `.gm-broker-bar`/`.shadow-broker-form` (the relocated input bar), `.asoc-board .shadow-broker-board-line-text` (the on-board HUD line, now with a light legibility plate — see below).
- `assets/ui/shadow-broker.png` — the canonical avatar (1254×1254 RGBA, transparent). Never redraw/recolor/crop this asset; only ever resize it uniformly at point of use.

## Design decisions worth knowing before you change any of this

- **The on-board line has a light plate behind the text, not glow-on-transparent.** The original treatment (pale purple text, no background) was illegible over photographic board backgrounds — the user has custom background images in regular use, not just the default black. The plate is on the TEXT SPAN, not the outer positioned container, so it shrink-wraps to the actual message instead of drawing a fixed-width bar. Text color is dark (`#3a1256`) specifically because it sits on a near-white plate — don't revert to a light/glowing color without also removing the plate, or you'll reintroduce the illegibility bug this fixed.
- **The Broker font is `"Bahnschrift SemiCondensed", "Arial Narrow", sans-serif`**, chosen for a condensed command-terminal feel per explicit user spec. Bahnschrift ships with Windows (the user's OS); it will fall back gracefully elsewhere. The message TEXT is never force-uppercased — only the "SHADOW BROKER" name/header is. Don't reintroduce `text-transform: uppercase` on `.shadow-broker-text` or `.shadow-broker-board-line-text`.
- **The input bar's move to under the board was a specific, user-marked placement request** (screenshotted and annotated), not a generic "make it more visible" guess. If asked to relocate it again, get the exact target location rather than assuming — a previous round of this same request was answered with a clarifying question and the user still had to mark a screenshot to be understood precisely.

## Bugs found and fixed along the way

- **GM's own Public View never showed the GM's own broadcasts.** `server.js`'s `room:create` handler sent `state:public` to a newly-hosting GM but never an initial `chat:update` (unlike `handlePlayerJoin`/`handleHostReconnect`). Since the client-side first-hydration guard treats "the very first `chat:update` ever received" as history replay (deliberately suppressing the new-message side effect on it), the GM's genuinely-first-ever `chat:update` — which happened to already contain their own real broadcast — was wrongly swallowed as empty hydration. Fixed by sending an initial `chat:update` from `room:create`, mirroring the other two handlers.
- **Two silent deploy failures** — see "READ THIS FIRST" above. Not a code bug, but cost real user trust and is the single most important thing in this handoff.
- **`TRANSMIT` in local (non-hosted) mode looked broken, not disabled.** `sendShadowBrokerBroadcast()` returned early on `mode !== 'multiplayer'` before clearing the input — text just sat there with zero feedback, indistinguishable from a bug. Fixed with `flashShadowBrokerNoRoom()` (brief red border/shake + placeholder swap), matching the pattern every other GM-only control should probably eventually get, though only Shadow Broker has it today.

## Testing performed

All sandbox-only (Playwright against `/tmp/asoc-test/server-fast.js`, compressed 5s timers), none deployed to the device:
`probe-broker-line.js`, `probe-broker-noroom.js`, `probe-broker-shared.js`, `probe-broker-reversal.js`, `probe-broker-enter.js` / `probe-broker-enter2.js`, `probe-gm-own-board-line.js`. Coverage includes: verdict reskin unchanged pre-judgment; wrong→correct reversal updates the Broker bubble on both GM and player with no duplicate bubbles; standalone broadcasts render identically on GM/player/GM's-own-board; a spoofed `gm:broadcast` from a player is rejected; empty broadcasts rejected; Enter and click each send exactly once with no duplicates and no double-send when combined; the board line survives an unrelated mid-transmission rebuild (a cell reveal) on all three surfaces; a late-joining player does not see chat history replay as a fresh transmission; the no-room flash triggers and self-clears correctly and doesn't false-trigger in multiplayer mode.

If you want any of these on `A:\ASOC ENGINE` as standing regression checks, they need to be copied over separately — they were never deployed.

## Deployment status as of this handoff

Full 18-file audit (source hash vs. device hash, both computed directly, this session):

| File | sha256 (first 12) | Status |
|---|---|---|
| `server.js` | `06eed26b590b` | confirmed match |
| `index.html` | `c5a11582d960` | confirmed match |
| `join.html` | `b1c1b75f4e2a` | confirmed match |
| `css/asoc.css` | `654924f627e2` | confirmed match |
| `js/app.js` | `f1a9d4fa1910` | confirmed match |
| `js/board.js` | `d1c8e7119e54` | confirmed match |
| `js/player.js` | `3beb7267e334` | confirmed match |
| `js/skeleton.js` | `e2d86df29757` | confirmed match |
| `js/game-data.js` | `a01f839bb164` | confirmed match (untouched this session) |
| `js/timer.js` | `7595962dfe2c` | confirmed match (untouched this session) |
| `assets/ui/shadow-broker.png` | `60b740016fbf` | confirmed match |
| `assets/ui/asoc-skeleton.png` | `ca7fb36f1a2a` | confirmed match |
| `assets/ui/skeleton/asoc-skeleton-{amber,black,green,purple,red,yellow}.png` | (6 files, all verified) | confirmed match |

`README.md` and this `HANDOFF.md` were written this session but their device-deploy status depends on whether you're reading this from the device already (if so, obviously yes) — if picking this up fresh, verify these two files landed the same way as everything else before trusting them.

Git commit/push has **not** been confirmed executed — same as the previous handoff, these commands are for the user to run locally, not something either AI assistant has push access to do:

```powershell
git add server.js index.html join.html css/asoc.css js/app.js js/board.js js/player.js js/skeleton.js assets/ui/shadow-broker.png assets/ui/asoc-skeleton.png assets/ui/skeleton/*.png README.md HANDOFF.md
git commit -m "Add Shadow Broker GM identity layer"
git push origin main
```

## Known limitations / suggested next steps

None of these are broken — they're polish the user hasn't asked for yet but I'd flag if picking this up:

- **Board-line hold time is flat (5000ms) regardless of message length.** A 100-character message and a 5-character one get the same hold — worth scaling roughly to reading speed instead of a fixed constant (`BROKER_LINE_HOLD_MS` in `js/skeleton.js`).
- **No recall/cancel for an in-flight transmission.** Once sent, a typo plays out its full ~6-8 second life on every screen with no way to clear it early.
- **A second transmission sent while the first is still holding hard-cuts with no transition.** `playShadowBrokerBoardLine()` just resets state and restarts the ticker — reusing a lighter version of the existing `.sb-glitch-in` chat-bubble animation on interrupt would make that read as intentional rather than as a flicker/bug.
- **No character counter on the Shadow Broker input** against its 100-char `maxlength`.
- **Consider a `DEPLOY_LOG.md`** (file + hash + timestamp per push) so future sessions — mine or another AI's — can verify device sync in seconds instead of re-deriving a manifest from scratch each time, the way this handoff had to.
