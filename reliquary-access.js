'use strict';
// A missing or malformed unlock timestamp must never grant vault access.
// Only a finite future timestamp issued after a valid GM code is accepted.
function hasReliquaryAccess(ws, now = Date.now()) {
  const until = Number(ws?.reliquaryUnlockedUntil);
  return Number.isFinite(until) && until > now;
}
module.exports = { hasReliquaryAccess };
