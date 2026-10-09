(function () {
  'use strict';

  const played = new Set();
  let fx = null;
  let removeTimer = 0;
  let hitTimer = 0;
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  const BOOT_SVG = `<svg class="ass-kick-boot-svg" viewBox="60 0 540 720" overflow="visible" aria-hidden="true">
  <defs>
    <linearGradient id="ak-leather" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b3935"/><stop offset=".45" stop-color="#151513"/><stop offset="1" stop-color="#070706"/></linearGradient>
    <linearGradient id="ak-cloth" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2b3320"/><stop offset=".4" stop-color="#5c6638"/><stop offset="1" stop-color="#2a301d"/></linearGradient>
    <linearGradient id="ak-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4a3d"/><stop offset="1" stop-color="#a50f14"/></linearGradient>
  </defs>
  <path d="M96 -1100 L326 -1100 L338 336 Q214 372 88 336 Z" fill="url(#ak-cloth)"/>
  <path d="M150 -1100 L156 340 M214 -1100 L214 350 M278 -1100 L270 340" stroke="rgba(0,0,0,.28)" stroke-width="6" fill="none"/>
  <path d="M88 336 Q214 372 338 336 L336 312 Q214 346 92 312 Z" fill="rgba(0,0,0,.34)"/>
  <path d="M112 318 L304 318 L312 468 C362 498 432 518 500 546 C548 566 574 594 560 628 L98 628 C92 580 100 520 106 470 Z" fill="url(#ak-leather)"/>
  <path d="M112 318 L304 318 L306 344 L110 344 Z" fill="#26262a" opacity=".85"/>
  <path d="M136 360 Q130 470 138 600" stroke="rgba(255,255,255,.14)" stroke-width="10" fill="none" stroke-linecap="round"/>
  <path d="M448 538 Q492 560 504 598" stroke="rgba(255,255,255,.2)" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M426 520 Q452 566 440 626" stroke="rgba(0,0,0,.5)" stroke-width="4" fill="none"/>
  <path d="M312 470 Q340 520 332 628" stroke="rgba(0,0,0,.35)" stroke-width="3" fill="none"/>
  <path d="M90 624 L568 624 C578 624 578 652 562 658 L104 658 Q86 658 90 624 Z" fill="#2b1a10"/>
  <path d="M96 640 L560 640" stroke="rgba(255,205,150,.18)" stroke-width="3"/>
  <path d="M98 658 L240 658 L236 702 Q168 712 100 702 Z" fill="#1b110b"/>
  <polygon points="208.0,322.0 224.5,369.3 274.6,370.4 234.6,400.7 249.1,448.6 208.0,420.0 166.9,448.6 181.4,400.7 141.4,370.4 191.5,369.3" fill="#e2b84a"/>
  <polygon points="208.0,334.0 221.5,373.4 263.2,374.1 229.9,399.1 242.1,438.9 208.0,415.0 173.9,438.9 186.1,399.1 152.8,374.1 194.5,373.4" fill="url(#ak-star)"/>
  <polygon points="208.0,322.0 224.5,369.3 274.6,370.4 234.6,400.7 249.1,448.6 208.0,420.0 166.9,448.6 181.4,400.7 141.4,370.4 191.5,369.3" fill="none" stroke="rgba(255,240,170,.55)" stroke-width="3"/>
</svg>`;

  function avatarFor(playerId, playerName) {
    if (String(playerId || '') === '__SHADOW_BROKER__') return '<img src="assets/ui/shadow-broker.png" alt="">';
    const entry = Array.from(document.querySelectorAll('[data-player-id]'))
      .find(node => String(node.dataset.playerId || '') === String(playerId || ''));
    const image = entry?.querySelector('img');
    const source = image?.currentSrc || image?.src || '';
    if (source) return `<img src="${esc(source)}" alt="">`;
    return `<span>${esc(String(playerName || '?').trim().slice(0, 2).toUpperCase())}</span>`;
  }

  function cleanup() {
    window.clearTimeout(removeTimer);
    window.clearTimeout(hitTimer);
    if (fx) { fx.destroy(); fx = null; }
    document.getElementById('ass-kick-effect-layer')?.remove();
  }

  // Canvas extras: sparks and a shockwave where the boot lands, then a fiery streak behind the flying avatar.
  function impactFx(layer) {
    const lib = window.AsocFx;
    const avatar = layer.querySelector('.ass-kick-avatar');
    if (!lib || !avatar || !fx) return;
    const r = avatar.getBoundingClientRect();
    const x = r.left + r.width * 0.06;
    const y = r.top + r.height * 0.62;
    fx.burst(x, y, 46, { ramp: 'ember', angle: -0.5, spread: 1.5, speed: [220, 820], ay: 380, life: [0.4, 1.0], size: [6, 14], size1: 2, drag: 0.7 });
    fx.burst(x, y, 16, { ramp: 'fire', angle: -0.5, spread: 1.7, speed: [80, 360], life: [0.2, 0.45], size: [36, 80], size1: 10, drag: 1.5 });
    fx.ring(x, y, { radius: 280, life: 0.5, width: 9, color: 'rgba(255,205,90,.95)' });
    fx.ring(x, y, { radius: 180, life: 0.38, width: 5, color: 'rgba(230,50,40,.95)' });
    let carry = 0;
    fx.emitter(0.7, (p, dt) => {
      const box = avatar.getBoundingClientRect();
      carry += 150 * dt;
      for (; carry >= 1; carry -= 1) {
        fx.spawn(box.left + box.width / 2 + lib.rand(-18, 18), box.top + box.height / 2 + lib.rand(-18, 18), {
          ramp: Math.random() < 0.3 ? 'ember' : 'fire', vx: lib.rand(-60, 60), vy: lib.rand(-40, 70), life: [0.25, 0.55], size: [18, 44], size1: 5, drag: 1.2, alpha: 0.85
        });
      }
    });
  }

  function play(message) {
    if (message?.messageType !== 'emote' || message.emote?.act !== 'ass') return;
    const sentAt = Number(message.timestamp) || 0;
    if (!sentAt || Math.abs(Date.now() - sentAt) > 8000) return;
    const key = String(message.id || `ass:${sentAt}:${message.emote?.targetId || ''}`);
    if (played.has(key)) return;
    played.add(key);
    if (played.size > 100) played.delete(played.values().next().value);

    cleanup();
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
        <div class="ass-kick-leg">${BOOT_SVG}</div>
        <div class="ass-kick-impact"><i></i><i></i><i></i></div>
        <strong>DISCIPLINARY FOOTWORK</strong>
      </div>`;
    document.body.appendChild(layer);
    fx = window.AsocFx && window.AsocFx.create ? window.AsocFx.create(layer, {}) : null;
    if (fx) hitTimer = window.setTimeout(() => impactFx(layer), 1290);
    removeTimer = window.setTimeout(cleanup, 3300);
  }

  window.AssKick = { play };
})();
