(() => {
  'use strict';
  const HEART = '\u{1F5A4}';
  let layer = null, timer = null;
  function onMessage(event) {
    if (event?.type !== 'pat:impact' || !document.body) return;
    if (layer) layer.remove();
    if (timer) clearTimeout(timer);
    layer = document.createElement('div');
    layer.className = 'asoc-pat-layer';
    layer.setAttribute('aria-hidden', 'true');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const count = reduced ? 8 : 30;
    for (let i = 0; i < count; i++) {
      const heart = document.createElement('span');
      heart.className = 'asoc-pat-heart';
      heart.textContent = HEART;
      const a = i * Math.PI * 2 / count + (Math.random() - .5) * .4;
      const distance = 75 + Math.random() * 220;
      heart.style.setProperty('--dx', Math.round(Math.cos(a) * distance) + 'px');
      heart.style.setProperty('--dy', Math.round(Math.sin(a) * distance - 95) + 'px');
      heart.style.setProperty('--rot', Math.round((Math.random() - .5) * 100) + 'deg');
      heart.style.setProperty('--delay', (Math.random() * .4).toFixed(2) + 's');
      heart.style.setProperty('--size', Math.round(19 + Math.random() * 23) + 'px');
      layer.appendChild(heart);
    }
    const current = layer;
    document.body.appendChild(current);
    timer = setTimeout(() => { current.remove(); if (layer === current) layer = null; timer = null; }, reduced ? 1200 : 3100);
  }
  window.AsocPat = Object.freeze({ onMessage });
})();