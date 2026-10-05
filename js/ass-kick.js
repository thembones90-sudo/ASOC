(function () {
  'use strict';

  const played = new Set();
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function avatarFor(playerId, playerName) {
    if (String(playerId || '') === '__SHADOW_BROKER__') return '<img src="assets/ui/shadow-broker.png" alt="">';
    const entry = Array.from(document.querySelectorAll('[data-player-id]'))
      .find(node => String(node.dataset.playerId || '') === String(playerId || ''));
    const image = entry?.querySelector('img');
    const source = image?.currentSrc || image?.src || '';
    if (source) return `<img src="${esc(source)}" alt="">`;
    return `<span>${esc(String(playerName || '?').trim().slice(0, 2).toUpperCase())}</span>`;
  }

  function play(message) {
    if (message?.messageType !== 'emote' || message.emote?.act !== 'ass') return;
    const sentAt = Number(message.timestamp) || 0;
    if (!sentAt || Math.abs(Date.now() - sentAt) > 8000) return;
    const key = String(message.id || `ass:${sentAt}:${message.emote?.targetId || ''}`);
    if (played.has(key)) return;
    played.add(key);
    if (played.size > 100) played.delete(played.values().next().value);

    document.getElementById('ass-kick-effect-layer')?.remove();
    const targetName = String(message.emote?.targetName || 'TARGET');
    const layer = document.createElement('div');
    layer.id = 'ass-kick-effect-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `
      <div class="ass-kick-vignette"></div>
      <div class="ass-kick-stage">
        <div class="ass-kick-target">
          <div class="ass-kick-avatar">${avatarFor(message.emote?.targetId, targetName)}</div>
          <b>${esc(targetName)}</b>
        </div>
        <div class="ass-kick-leg">
          <div class="ass-kick-trouser"><i>★</i></div>
          <div class="ass-kick-boot"><span></span></div>
        </div>
        <div class="ass-kick-impact"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <strong>DISCIPLINARY FOOTWORK</strong>
      </div>`;
    document.body.appendChild(layer);
    window.setTimeout(() => layer.remove(), 3000);
  }

  window.AssKick = { play };
})();
