// WARSONG // GM-only room-wide battle banner. The server event is ephemeral;
// reconnecting clients never replay it and no chat history entry is created.
(function () {
  'use strict';
  const DURATION_MS = 9000;
  let timer = 0;

  function clear() {
    window.clearTimeout(timer);
    timer = 0;
    document.getElementById('warsong-alert-layer')?.remove();
    document.documentElement.classList.remove('warsong-alert-active');
  }

  function play() {
    clear();
    const layer = document.createElement('div');
    layer.id = 'warsong-alert-layer';
    layer.className = 'warsong-alert-layer';
    layer.setAttribute('role', 'alert');
    layer.setAttribute('aria-live', 'assertive');
    layer.innerHTML = `
      <div class="warsong-blood-field" aria-hidden="true"></div>
      <div class="warsong-standard">
        <img src="assets/ui/warsong-horde-banner.png?v=20260930-warsong-1" alt="Horde battle banner">
        <strong>PALI WARSONG, JUSUFE</strong>
      </div>`;
    document.body.appendChild(layer);
    document.documentElement.classList.add('warsong-alert-active');
    requestAnimationFrame(() => layer.classList.add('is-live'));
    timer = window.setTimeout(clear, DURATION_MS);
  }

  function onMessage(message) {
    if (message?.type === 'warsong:alert') play();
  }

  window.WarsongAlert = { onMessage, play, clear };
})();
