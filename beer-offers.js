'use strict';
const crypto = require('node:crypto');
const VARIANTS = Object.freeze(['bottle', 'can', 'barrel']);
const MODELS = Object.freeze({
  bottle: ['bottle-voidwarden', 'bottle-reliquary', 'bottle-bloodcrown'],
  can: ['can-iron-ration', 'can-void-coil', 'can-royal-stout'],
  barrel: ['barrel-oathwood', 'barrel-iron-keg', 'barrel-plague-cask']
});
const COOLDOWN_MS = 30000;
const DURATION_MS = 5200;

// Ephemeral and room-scoped: no recovery writes, balances, or game mutations.
function createService({ broadcast, now = Date.now, randomInt = crypto.randomInt, randomUUID = crypto.randomUUID }) {
  const cooldowns = new WeakMap();
  return {
    offer(room, author, raw) {
      if (!/^\/beer\s*$/i.test(raw)) return { success: false, error: 'BEER INVALID // USE /beer' };
      if (room.roomMode !== 'CASUAL') return { success: false, error: 'BEER // ONLY AVAILABLE IN AMUSEMENT PARK' };
      const timestamp = now();
      const previous = cooldowns.get(room);
      const remaining = previous === undefined ? 0 : COOLDOWN_MS - (timestamp - previous);
      if (remaining > 0) return { success: false, error: `BEER ON ICE // NEXT ROUND IN ${Math.ceil(remaining / 1000)}s` };
      const variant = VARIANTS[randomInt(VARIANTS.length)];
      const event = {
        type: 'beer:offer', id: randomUUID(), variant,
        model: MODELS[variant][randomInt(MODELS[variant].length)],
        offeredBy: { id: author.id || '__GM__', name: String(author.name || 'SOMEONE').slice(0, 80) },
        timestamp, durationMs: DURATION_MS
      };
      cooldowns.set(room, timestamp);
      broadcast(room, event);
      // The player dispatcher acknowledges the command, then skips the normal
      // persistence/chat-snapshot path. The animation has already been sent.
      return { success: true, broadcast: false, private: true };
    }
  };
}
module.exports = { createService, VARIANTS, MODELS, COOLDOWN_MS, DURATION_MS };
