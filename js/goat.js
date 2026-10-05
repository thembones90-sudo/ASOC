(() => {
  let timer = null;

  function clear() {
    document.getElementById('goat-event-layer')?.remove();
    document.documentElement.classList.remove('goat-event-active');
    clearTimeout(timer);
    timer = null;
  }

  function makeLayer(message) {
    clear();
    const layer = document.createElement('div');
    layer.id = 'goat-event-layer';
    layer.className = `goat-event-layer goat-event-${message.event || 'unknown'}`;
    layer.innerHTML = `
      <div class="goat-event-card">
        <div class="goat-event-icon">🐐</div>
        <div class="goat-event-title"></div>
        <div class="goat-event-subtitle"></div>
      </div>`;
    document.body.appendChild(layer);
    document.documentElement.classList.add('goat-event-active');
    return layer;
  }

  function textFor(message) {
    switch (message.event) {
      case 'headbutt': return ['HEADBUTT', message.targetName ? `${message.targetName} was selected for structural testing.` : 'No victim found. Furniture survives.'];
      case 'baaaa': return ['BAAAAAAAAAA', 'The Goat has submitted its argument.'];
      case 'ragdoll': return ['RAGDOLL', `${message.actorName || 'THE GOAT'} has temporarily rejected skeletal integrity.`];
      case 'goatify': return ['GOATIFY', message.targetName ? `${message.targetName} is now a Lesser Goat.` : 'No suitable mammal located.'];
      case 'sacrifice': return ['SACRIFICIAL GOAT', message.womfReduced ? 'The Goat absorbs one WOMF charge.' : 'A heroic sacrifice accomplished absolutely nothing.'];
      default: return ['GOAT EVENT', 'Something deeply unnecessary has occurred.'];
    }
  }

  function animateHeadbutt(message) {
    const candidates = Array.from(document.querySelectorAll('.chat-message, .gm-chat-message, [data-message-id]')).filter(el => el.offsetParent !== null);
    if (!candidates.length) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    target.classList.add('goat-headbutted');
    setTimeout(() => target.classList.remove('goat-headbutted'), 1700);
  }

  function animateRagdoll(message) {
    if (!message.actorId || message.actorId === 'null') return;
    document.querySelectorAll(`[data-player-id="${CSS.escape(String(message.actorId))}"]`).forEach(el => {
      el.classList.add('goat-ragdolled-player');
      setTimeout(() => el.classList.remove('goat-ragdolled-player'), 2600);
    });
  }

  function animateGoatify(message) {
    if (!message.targetId) return;
    const selectors = [
      `[data-player-id="${CSS.escape(String(message.targetId))}"]`,
      `[data-playerid="${CSS.escape(String(message.targetId))}"]`
    ];
    document.querySelectorAll(selectors.join(',')).forEach(el => {
      el.classList.add('goatified-player');
      setTimeout(() => el.classList.remove('goatified-player'), 30000);
    });
  }

  function onMessage(message) {
    if (!message) return;
    if (message.type === 'goat:awarded') {
      const layer = makeLayer({ event: 'awarded' });
      layer.querySelector('.goat-event-title').textContent = 'THE GOAT HAS BEEN CHOSEN';
      layer.querySelector('.goat-event-subtitle').textContent = `${message.holderName || 'UNKNOWN'} // ${Number(message.charges) || 3} CHARGES`;
      requestAnimationFrame(() => layer.classList.add('is-live'));
      timer = setTimeout(clear, 3200);
      return;
    }
    if (!message.event) return;
    const layer = makeLayer(message);
    const [title, subtitle] = textFor(message);
    layer.querySelector('.goat-event-title').textContent = title;
    layer.querySelector('.goat-event-subtitle').textContent = subtitle;
    if (message.event === 'headbutt') animateHeadbutt(message);
    if (message.event === 'ragdoll') animateRagdoll(message);
    if (message.event === 'goatify') animateGoatify(message);
    requestAnimationFrame(() => layer.classList.add('is-live'));
    timer = setTimeout(clear, message.event === 'baaaa' ? 2800 : 3500);
  }

  window.GoatEvent = { onMessage, clear };
})();
