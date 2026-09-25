// SHADOW COSMETICS -- client rendering of equipped Shadow Market cosmetics.
// Shared by the GM console (app.js) and the player screen (player.js).
// Everything here is visual: classes on avatars, a title line under a name,
// and one-shot theatrical screen effects for premium /commands. The server
// sends only sanitized ids (players:update -> player.cosmetics).
(function () {
  const SAFE_ID = /^[a-z0-9-]{1,48}$/;
  const FX = new Set(['smite', 'freeze', 'glitch', 'omen', 'rupture', 'vanish']);
  const played = new Set();

  function cosmeticsOf(entity, players) {
    if (entity && entity.cosmetics) return entity.cosmetics;
    const id = String(entity?.id || entity?.playerId || '');
    if (!id || !Array.isArray(players)) return null;
    return players.find(p => String(p.id) === id)?.cosmetics || null;
  }

  // Space-prefixed class list for .little-hero-avatar.
  function avatarClass(entity, players) {
    const c = cosmeticsOf(entity, players);
    if (!c) return '';
    let out = '';
    if (SAFE_ID.test(c.appearance || '')) out += ' cos-' + c.appearance;
    if (SAFE_ID.test(c.frame || '')) out += ' cos-' + c.frame;
    if (SAFE_ID.test(c.effect || '')) {
      const tier = Math.max(1, Math.min(5, Number(c.effectTier) || 1));
      out += ' cos-fx cos-' + c.effect + ' cos-tier-' + tier;
    }
    return out;
  }

  // Inner overlay (smoke, frost, particles, cracks). The avatar clips its
  // overflow, so outer glows ride on the avatar's own box-shadow instead.
  function avatarLayer(entity, players) {
    const c = cosmeticsOf(entity, players);
    return c && (SAFE_ID.test(c.effect || '') || SAFE_ID.test(c.appearance || ''))
      ? '<i class="cos-layer" aria-hidden="true"><i></i></i>'
      : '';
  }

  function escape(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // Inline title badge (empty string when none equipped).
  function titleHTML(entity, players) {
    const title = cosmeticsOf(entity, players)?.title;
    if (!title || typeof title !== 'string') return '';
    return '<span class="cos-title">' + escape(title.slice(0, 40)) + '</span>';
  }

  // Full-screen one-shot effect for a premium /command, once per message and
  // only while the message is fresh (history replays stay quiet).
  function maybePlayFx(msg) {
    const fx = msg?.emote?.fx;
    if (!FX.has(fx) || !msg.id || played.has(msg.id)) return;
    played.add(msg.id);
    if (Date.now() - Number(msg.timestamp || 0) > 8000) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setTimeout(() => {
      const layer = document.createElement('div');
      layer.className = 'shadow-fx-layer shadow-fx-' + fx;
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = '<i></i><b>' + escape(String(msg.emote.label || fx).toUpperCase()) + '</b>';
      document.body.appendChild(layer);
      setTimeout(() => layer.remove(), 1900);
    }, 0);
  }

  function cardClass(msg) {
    const fx = msg?.emote?.fx;
    return FX.has(fx) ? ' shadow-fx-card shadow-fx-card-' + fx : '';
  }

  window.ShadowCosmetics = { avatarClass, avatarLayer, titleHTML, maybePlayFx, cardClass };
})();
