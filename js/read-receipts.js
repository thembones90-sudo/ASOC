// READ RECEIPTS -- the one place clients turn raw seen records into viewers.
// Shared by the GM console (app.js) and the player screen (player.js).
//
// A receipt list is a log of sightings, not a roster: the same person can
// appear through repeated events, reconnects, renames or (for the GM's
// Master Mirror) a fresh test-persona id on every mirror session. Every
// surface that shows SEEN BY / counts / popovers goes through viewers() so
// each unique player appears exactly once:
//   - identity is the stable player id, never the display name;
//   - every Master Mirror persona (__MASTER_TEST__:<session>) is ONE viewer;
//   - the name shown is the CURRENT roster name when the player is known,
//     else the most recent name recorded on their receipts.
(function () {
  const MASTER_TEST_PREFIX = '__MASTER_TEST__:';
  const MASTER_TEST_KEY = '__MASTER_TEST__';

  function identityKey(playerId) {
    const id = String(playerId || '');
    return id.startsWith(MASTER_TEST_PREFIX) ? MASTER_TEST_KEY : id;
  }

  function currentName(key, roster) {
    const member = (Array.isArray(roster) ? roster : []).find(p => identityKey(p?.id) === key);
    const name = String(member?.name || '').trim();
    return name || '';
  }

  // Unique viewers of `msg`, in first-seen order: [{ key, name, seenAt }].
  // `excludeIds` (e.g. the sender, or the viewing player) are compared by
  // identity too, so a mirror persona never "sees" its own message.
  function viewers(msg, { roster = [], excludeIds = [] } = {}) {
    const excluded = new Set([msg?.playerId, ...excludeIds].filter(Boolean).map(identityKey));
    const byKey = new Map();
    for (const receipt of Array.isArray(msg?.seenBy) ? msg.seenBy : []) {
      const key = identityKey(receipt?.playerId);
      if (!key || excluded.has(key)) continue;
      const seenAt = Number(receipt.seenAt) || 0;
      const recorded = String(receipt.playerName || '').trim();
      const entry = byKey.get(key);
      if (!entry) byKey.set(key, { key, recordedName: recorded, recordedAt: seenAt, seenAt });
      else if (recorded && seenAt >= entry.recordedAt) { entry.recordedName = recorded; entry.recordedAt = seenAt; }
    }
    return [...byKey.values()].map(entry => ({
      key: entry.key,
      name: currentName(entry.key, roster) || entry.recordedName || 'Little Hero',
      seenAt: entry.seenAt
    }));
  }

  // Unique intended recipients (send-time snapshot), by identity.
  function recipientKeys(msg) {
    const sender = identityKey(msg?.playerId);
    return [...new Set((Array.isArray(msg?.recipientIds) ? msg.recipientIds : []).map(identityKey))]
      .filter(key => key && key !== sender);
  }

  // Denominator for "seen/total". Never smaller than the unique viewers.
  function recipientTotal(msg, uniqueSeen) {
    const keys = recipientKeys(msg);
    const total = keys.length || Number(msg?.recipientCount) || 0;
    return Math.max(total, uniqueSeen || 0);
  }

  // Recipients who have not seen it yet: [{ key, name }].
  function notSeen(msg, seenList, roster = []) {
    const seen = new Set(seenList.map(v => v.key));
    return recipientKeys(msg)
      .filter(key => !seen.has(key))
      .map(key => ({ key, name: currentName(key, roster) || (key === MASTER_TEST_KEY ? 'TEST SUBJECT' : 'Little Hero') }));
  }

  // Compact footer list: at most `max` names, then "+N".
  function compact(list, max = 4) {
    return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
  }

  window.ReadReceipts = { identityKey, viewers, recipientKeys, recipientTotal, notSeen, compact };
})();
