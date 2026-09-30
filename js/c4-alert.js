// C4 COLUMN // live-battle chat easter egg. Ephemeral and never replayed.
(function () {
  'use strict';
  const DURATION_MS = 3000;
  let timer = 0;

  function clear() {
    window.clearTimeout(timer);
    timer = 0;
    document.getElementById('c4-alert-layer')?.remove();
    document.documentElement.classList.remove('c4-alert-active');
  }

  function play() {
    clear();
    const layer = document.createElement('div');
    layer.id = 'c4-alert-layer';
    layer.className = 'c4-alert-layer';
    layer.setAttribute('role', 'img');
    layer.setAttribute('aria-label', 'C4 column explosive alert');
    layer.innerHTML = `
      <div class="c4-alert-static" aria-hidden="true"></div>
      <img src="assets/ui/c4-column-gimmick.png?v=20260930-c4-1" alt="C4 column explosive gimmick">`;
    document.body.appendChild(layer);
    document.documentElement.classList.add('c4-alert-active');
    requestAnimationFrame(() => layer.classList.add('is-live'));
    timer = window.setTimeout(clear, DURATION_MS);
  }

  function onMessage(message) {
    if (message?.type === 'c4:alert') play();
  }

  window.C4Alert = { onMessage, play, clear };
})();
