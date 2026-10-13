# ASOC P0 WebSocket / Chat Payload Audit — October 13, 2026

## Scope and constraints
Examined outgoing WebSocket frame sizes, chat delta vs legacy snapshots, GM broadcasts, slash commands, sticker/voice/poll handlers, reconnect behavior and private Reliquary access. All changes were made in an isolated non-production worktree. No Railway deployment, production push, or persistent customer data mutation.

## Direct local evidence
- Frame probe with a populated chat history measured an ordinary delta-capable player's post at about **422 bytes** (chat:delta) versus about **75,228 bytes** sent as a legacy client's chat:update snapshot in the same scenario.
- A /roll command in that probe triggered a roughly 75,248-byte chat:update snapshot. This demonstrates a real higher-cost legacy path; it does **not** prove that legacy snapshots alone caused the 48.5 MB production backlog.
- WebSocket fan-out frame counts scale with recipients. A dozen outbound frames per chat action is not itself evidence of duplicate payloads to an individual player.
- Production previously observed approximately 48.5MB WebSocket bufferedAmount. Source category wasn't logged then, so attribution remains unverified.

## Changes made
- Privacy-safe bounded aggregate frame-size diagnostics by a whitelist of frame categories, with no text, player name, room code, URL, token, or image content in metrics.
- Reuse single-message chat:delta for GIF, sticker, voice, poll create/vote/close, image and GM chat actions when changed message IDs are known.
- Preserve a full chat snapshot for compound or uncertain side effects; include all known affected IDs for combined visible messages. Clients without chat:delta capability keep their legacy snapshot protocol.
- No automatic WebSocket disconnect threshold introduced.
- No Reliquary access or private upload endpoint changes.

## Verification
PASS node tests/chat-payload-budget.js
PASS node tests/ws-payload-diagnostics.js
PASS node tests/chat-deltas.js
PASS node tests/stickers.js
PASS node tests/stickers-gm.js
PASS node tests/voice-messages.js
PASS node tests/reliquary-adversarial.js
PASS node --check server.js

## Limitations and next work
- Production capture of aggregate category-specific payload sizes is required to identify the 48.5 MB culprit; this instrumentation alone does not reduce the already-queued traffic.
- Legacy clients will continue receiving full snapshots for compatibility. Protocol upgrade policy and pagination should be designed separately with no missing messages.
- A complete asynchronous worker and multi-client GM adjudication release test are necessary before shipping this combined P0 patch.
- Under no circumstances expose Reliquary material to ordinary players. Any GM-authorized public Blood Tribute event remains distinct from the private vault.
