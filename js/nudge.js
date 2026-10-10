// NUDGE // GM-only ready check. Shakes the player's chat window like an old MSN nudge.
// Ephemeral (no chat entry, no replay on reconnect) and silent.
(function () {
  'use strict';
  const DURATION_MS = 900;
  const TOAST_MS = 2200;
  let shakeTimer = 0;
  let toastTimer = 0;

  function target() {
    return document.getElementById('chat-panel') || document.querySelector('.gm-chat-panel') || document.getElementById('game-screen') || document.body;
  }

  function clear() {
    window.clearTimeout(shakeTimer);
    window.clearTimeout(toastTimer);
    shakeTimer = toastTimer = 0;
    document.querySelectorAll('.asoc-nudge-shake').forEach(el => el.classList.remove('asoc-nudge-shake'));
    document.getElementById('nudge-toast')?.remove();
  }

  function play() {
    clear();
    const el = target();
    void el.offsetWidth; // restart the animation if it was just running
    el.classList.add('asoc-nudge-shake');
    const toast = document.createElement('div');
    toast.id = 'nudge-toast';
    toast.className = 'nudge-toast';
    toast.setAttribute('role', 'status');
    const isGM = !document.getElementById('chat-panel') && !!document.querySelector('.gm-chat-panel');
    toast.innerHTML = isGM
      ? '<b>NUDGE SENT</b><span>EVERY PLAYER CHAT JUST SHOOK</span>'
      : '<b>NUDGE</b><span>THE SHADOW BROKER WANTS YOUR ATTENTION</span>';
    document.body.appendChild(toast);
    shakeTimer = window.setTimeout(() => el.classList.remove('asoc-nudge-shake'), DURATION_MS + 100);
    toastTimer = window.setTimeout(() => toast.remove(), TOAST_MS);
  }

  function onMessage(message) {
    if (message?.type === 'nudge:shake') play();
  }

  window.NudgeEffect = { onMessage, play, clear };
})();
