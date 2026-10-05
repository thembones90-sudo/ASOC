(() => {
  'use strict';

  const marks = new Map();
  let activeTimer = null;

  function avatarSrc(value) {
    const src = String(value || '').trim();
    return /^(data:image\/|\/|assets\/|https?:\/\/)/i.test(src) ? src : '';
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?';
  }

  function avatarNode(side, name, src) {
    const wrap = document.createElement('div');
    wrap.className = `fistbump-avatar fistbump-${side}`;
    const ring = document.createElement('div');
    ring.className = 'fistbump-avatar-ring';
    const safe = avatarSrc(src);
    if (safe) {
      const img = document.createElement('img');
      img.src = safe;
      img.alt = '';
      ring.appendChild(img);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = initials(name);
      ring.appendChild(fallback);
    }
    const fist = document.createElement('b');
    fist.className = 'fistbump-fist';
    fist.textContent = side === 'left' ? '🤜' : '🤛';
    const label = document.createElement('strong');
    label.textContent = name || 'LITTLE HERO';
    wrap.append(ring, fist, label);
    return wrap;
  }

  function clearLayer() {
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = null;
    document.getElementById('fistbump-effect-layer')?.remove();
  }

  function setMark(id, until) {
    if (!id) return;
    marks.set(String(id), Math.max(Number(until) || 0, Date.now()));
    setTimeout(() => {
      if ((marks.get(String(id)) || 0) <= Date.now()) marks.delete(String(id));
      decorateRoster();
    }, Math.max(0, (Number(until) || 0) - Date.now()) + 80);
  }

  function decorateRoster(root = document) {
    const now = Date.now();
    root.querySelectorAll?.('[data-player-id]').forEach(entry => {
      entry.querySelectorAll('.fistbump-bro-mark').forEach(x => x.remove());
      const id = String(entry.dataset.playerId || '');
      const until = marks.get(id) || 0;
      if (until <= now) {
        if (until) marks.delete(id);
        return;
      }
      const badge = document.createElement('span');
      badge.className = 'fistbump-bro-mark';
      badge.textContent = '🤜🤛';
      badge.title = 'BRO CODE CONFIRMED';
      entry.appendChild(badge);
    });
  }

  function onMessage(message) {
    if (!message || message.type !== 'fistbump:impact') return;
    clearLayer();
    const markUntil = Date.now() + Math.max(1000, Number(message.markMs) || 30000);
    setMark(message.actorId, markUntil);
    setMark(message.targetId, markUntil);
    decorateRoster();

    const layer = document.createElement('div');
    layer.id = 'fistbump-effect-layer';
    layer.className = 'fistbump-layer' + (message.legendary ? ' is-legendary' : '');
    layer.setAttribute('aria-live', 'polite');

    const stage = document.createElement('div');
    stage.className = 'fistbump-stage';
    stage.append(
      avatarNode('left', message.actorName, message.actorAvatarData),
      avatarNode('right', message.targetName, message.targetAvatarData)
    );

    const burst = document.createElement('div');
    burst.className = 'fistbump-burst';
    burst.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';

    const caption = document.createElement('div');
    caption.className = 'fistbump-caption';
    const title = document.createElement('strong');
    title.textContent = message.legendary ? 'LEGENDARY DAP' : 'BRO CODE CONFIRMED';
    const line = document.createElement('span');
    line.textContent = `${message.actorName || 'Someone'}  🤜🤛  ${message.targetName || 'someone'}`;
    caption.append(title, line);

    layer.append(stage, burst, caption);
    document.body.appendChild(layer);

    activeTimer = setTimeout(() => {
      layer.classList.add('is-leaving');
      setTimeout(clearLayer, 350);
    }, Math.max(1500, Number(message.durationMs) || 1900));
  }

  window.FistbumpEffect = Object.freeze({ onMessage, decorateRoster, clear: clearLayer });
})();
