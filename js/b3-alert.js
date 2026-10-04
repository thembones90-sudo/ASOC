// B3 FIELD // live-battle tribute to Baki B3. Ephemeral and never replayed.
(function () {
  'use strict';
  const DURATION_MS = 3000;
  let timer = 0;

  function clear() {
    window.clearTimeout(timer);
    timer = 0;
    document.getElementById('b3-alert-layer')?.remove();
    document.documentElement.classList.remove('b3-alert-active');
  }

  function play(coordinated = false) {
    if (!coordinated && window.AsocRuntime?.effects) {
      window.AsocRuntime.effects.enqueue('b3', DURATION_MS, () => play(true));
      return;
    }
    clear();
    const layer = document.createElement('div');
    layer.id = 'b3-alert-layer';
    layer.dataset.asocEffectLayer = 'b3';
    layer.className = 'b3-alert-layer';
    layer.setAttribute('role', 'img');
    layer.setAttribute('aria-label', 'Baki B3 battle alert');
    layer.innerHTML = `
      <div class="b3-void" aria-hidden="true"></div>
      <div class="b3-photo" aria-hidden="true">
        <img class="b3-half b3-half-left" src="assets/ui/baki-b3-gimmick.png?v=20260930-b3-1" alt="">
        <img class="b3-half b3-half-right" src="assets/ui/baki-b3-gimmick.png?v=20260930-b3-1" alt="">
      </div>`;
    document.body.appendChild(layer);
    document.documentElement.classList.add('b3-alert-active');
    requestAnimationFrame(() => layer.classList.add('is-live'));
    timer = window.setTimeout(clear, DURATION_MS);
  }

  function onMessage(message) {
    if (message?.type === 'b3:alert') play();
  }

  window.B3Alert = { onMessage, play, clear };
})();
