// LURK // GM-only room-wide dread. The screen dims, two red eyes open in the dark,
// hold, then sink back into shadow and smoke. The server event is ephemeral:
// reconnecting clients never replay it and no chat history entry is created.
(function () {
  'use strict';
  const DURATION_MS = 9400;
  let timer = 0;

  // One crescent slit: a thin red blade with a hot white-pink edge, a soft haze
  // on the inner side and a wide bloom. The right eye is the same drawing mirrored in CSS.
  const EYE = `
    <svg viewBox="0 0 100 120" focusable="false">
      <defs>
        <linearGradient id="lurk-body" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="112">
          <stop offset="0" stop-color="#8a0008" stop-opacity=".25"/>
          <stop offset=".3" stop-color="#ff1a12" stop-opacity=".85"/>
          <stop offset=".68" stop-color="#ff5a48"/>
          <stop offset="1" stop-color="#ff9a8c"/>
        </linearGradient>
        <radialGradient id="lurk-haze" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#ff1408" stop-opacity=".38"/>
          <stop offset="1" stop-color="#ff1408" stop-opacity="0"/>
        </radialGradient>
        <filter id="lurk-b1" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4.5"/></filter>
        <filter id="lurk-b3" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="13"/></filter>
        <filter id="lurk-b2" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation=".7"/></filter>
      </defs>
      <ellipse class="lurk-haze" cx="56" cy="74" rx="46" ry="40" fill="url(#lurk-haze)" transform="rotate(35 56 74)"/>
      <path class="lurk-bloom" d="M10 2C3 32 24 88 96 110C58 88 36 62 24 36C18 24 14 12 10 2Z" fill="#ff1208" opacity=".75" filter="url(#lurk-b3)"/>
      <path class="lurk-glow" d="M10 2C3 32 24 88 96 110C58 88 36 62 24 36C18 24 14 12 10 2Z" fill="#ff1a10" filter="url(#lurk-b1)"/>
      <path d="M10 2C3 32 24 88 96 110C58 88 36 62 24 36C18 24 14 12 10 2Z" fill="url(#lurk-body)" filter="url(#lurk-b2)"/>
      <path d="M17 44C28 74 56 98 92 108" fill="none" stroke="#ffe4de" stroke-width="1.5" stroke-linecap="round" filter="url(#lurk-b2)" opacity=".9"/>
    </svg>`;

  function clear() {
    window.clearTimeout(timer);
    timer = 0;
    document.getElementById('lurk-layer')?.remove();
  }

  function play(coordinated = false) {
    if (!coordinated && window.AsocRuntime?.effects) {
      window.AsocRuntime.effects.enqueue('lurk', DURATION_MS, () => play(true));
      return;
    }
    clear();
    const layer = document.createElement('div');
    layer.id = 'lurk-layer';
    layer.dataset.asocEffectLayer = 'lurk';
    layer.className = 'lurk-layer';
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-live', 'polite');
    layer.innerHTML = `
      <span class="lurk-sr">Something in the dark is watching.</span>
      <div class="lurk-dark" aria-hidden="true"></div>
      <div class="lurk-eyes" aria-hidden="true">
        <div class="lurk-eye lurk-eye-l">${EYE}</div>
        <div class="lurk-eye lurk-eye-r">${EYE}</div>
      </div>
      <div class="lurk-smoke" aria-hidden="true">
        <i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i><i class="s5"></i>
      </div>
      <div class="lurk-fog" aria-hidden="true"></div>`;
    document.body.appendChild(layer);
    timer = window.setTimeout(clear, DURATION_MS);
  }

  function onMessage(message) {
    if (message?.type === 'lurk:gaze') play();
  }

  window.LurkEffect = { onMessage, play, clear };
})();
