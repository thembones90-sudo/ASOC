(() => {
  'use strict';
  let dismissTimer = null;
  let badgeTimer = null;
  let audioContext = null;
  function clink() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContext ||= new AudioContext();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const now = audioContext.currentTime;
      [960, 1460].forEach((frequency, index) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, now);
        osc.frequency.exponentialRampToValueAtTime(frequency * .92, now + .17);
        gain.gain.setValueAtTime(.0001, now + index * .035);
        gain.gain.exponentialRampToValueAtTime(.055, now + index * .035 + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .28);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now + index * .035);
        osc.stop(now + .3);
      });
    } catch (_) { /* Browser autoplay policy may block audio. */ }
  }
  let badgeObserver = null;
  function decorateSelf() {
    const name = document.querySelector('.pl-entry-me .pl-entry-name');
    if (!name) return false;
    if (!name.querySelector('.asoc-coffee-name-badge')) {
      const badge = document.createElement('span');
      badge.className = 'asoc-coffee-name-badge';
      badge.textContent = '\u2615';
      badge.title = 'Taking a coffee break';
      name.append(badge);
    }
    return true;
  }
  function markCup() {
    clearTimeout(badgeTimer);
    decorateSelf();
    if (!badgeObserver) {
      badgeObserver = new MutationObserver(() => {
        if (document.querySelector('.pl-entry-me .pl-entry-name:not(:has(.asoc-coffee-name-badge))')) {
          decorateSelf();
        }
      });
      badgeObserver.observe(document.body, { childList: true, subtree: true });
    }
    badgeTimer = setTimeout(() => {
      badgeObserver?.disconnect();
      badgeObserver = null;
      document.querySelectorAll('.asoc-coffee-name-badge').forEach(badge => badge.remove());
    }, 30000);
  }
  function show(event = {}) {
    document.getElementById('asoc-coffee-layer')?.remove();
    clearTimeout(dismissTimer);
    const layer = document.createElement('div');
    layer.id = 'asoc-coffee-layer';
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-live', 'polite');
    const panel = document.createElement('div');
    panel.className = 'asoc-coffee-panel';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'asoc-coffee-eyebrow';
    eyebrow.textContent = 'HOSTILITIES TEMPORARILY SUSPENDED';
    const cupArea = document.createElement('div');
    cupArea.className = 'asoc-coffee-cup-area';
    const steam = document.createElement('div');
    steam.className = 'asoc-coffee-steam';
    for (let i = 0; i < 3; i++) steam.appendChild(document.createElement('i'));
    const cup = document.createElement('button');
    cup.type = 'button';
    cup.className = 'asoc-coffee-cup';
    cup.textContent = '\u2615';
    cup.title = 'Take a sip: earn a 30-second coffee badge';
    cup.setAttribute('aria-label', 'Take a coffee break');
    cup.addEventListener('click', () => {
      markCup();
      cup.classList.add('asoc-coffee-sipped');
      cup.setAttribute('aria-label', 'Coffee claimed');
    }, { once: true });
    cupArea.append(steam, cup);
    const title = document.createElement('div');
    title.className = 'asoc-coffee-title';
    title.textContent = 'COFFEE BREAK';
    const sub = document.createElement('div');
    sub.className = 'asoc-coffee-sub';
    sub.textContent = String(event.line || 'Even suffering deserves a coffee break.').slice(0, 180);
    const footer = document.createElement('div');
    footer.className = 'asoc-coffee-footer';
    footer.textContent = '\u2615 BREWING PEACE \u2615';
    panel.append(eyebrow, cupArea, title, sub, footer);
    layer.append(panel);
    document.body.append(layer);
    clink();
    dismissTimer = setTimeout(() => {
      layer.classList.add('asoc-coffee-out');
      setTimeout(() => layer.remove(), 350);
    }, Math.min(8000, Math.max(500, Number(event.durationMs) || 8000)));
  }
  window.AsocCoffee = { show };
})();