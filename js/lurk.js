// LURK // GM-only room-wide dread. The screen dims, two red eyes open in the dark,
// hold, then sink back into shadow and smoke. The server event is ephemeral:
// reconnecting clients never replay it and no chat history entry is created.
(function () {
  'use strict';
  const DURATION_MS = 9400;
  let timer = 0;

  // One almond eye. The right eye is the same drawing mirrored in CSS.
  const EYE = `
    <svg viewBox="0 0 200 92" focusable="false">
      <defs>
        <radialGradient id="lurk-sclera" cx="50%" cy="52%" r="62%">
          <stop offset="0" stop-color="#ff6a3c"/>
          <stop offset=".42" stop-color="#e01410"/>
          <stop offset=".8" stop-color="#6e0206"/>
          <stop offset="1" stop-color="#220003"/>
        </radialGradient>
        <radialGradient id="lurk-core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/>
          <stop offset=".35" stop-color="#ff5a2a" stop-opacity=".75"/>
          <stop offset="1" stop-color="#ff1a10" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <path d="M3 36 C40 4 124 6 197 63 C140 90 52 86 3 36 Z" fill="url(#lurk-sclera)"/>
      <ellipse cx="102" cy="48" rx="46" ry="30" fill="url(#lurk-core)"/>
      <ellipse cx="104" cy="49" rx="6.5" ry="29" fill="#050001"/>
      <path d="M3 36 C40 4 124 6 197 63" fill="none" stroke="#2a0004" stroke-width="5" stroke-linecap="round"/>
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
