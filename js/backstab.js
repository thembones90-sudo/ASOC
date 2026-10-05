(() => {
  'use strict';

  let activeTimer = null;
  let cooldownTimer = null;
  let cooldownUntil = 0;
  const betrayalMarks = new Map();

  function clearExisting() {
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = null;
    document.getElementById('backstab-effect-layer')?.remove();
    document.documentElement.classList.remove('backstab-impact');
  }

  function formatCooldown(ms) {
    const mins = Math.max(1, Math.ceil(ms / 60000));
    return `${mins}m`;
  }

  function renderCooldown() {
    const remaining = cooldownUntil - Date.now();
    let badge = document.getElementById('backstab-cooldown-badge');
    if (remaining <= 0) {
      badge?.remove();
      if (cooldownTimer) clearInterval(cooldownTimer);
      cooldownTimer = null;
      cooldownUntil = 0;
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'backstab-cooldown-badge';
      badge.className = 'backstab-cooldown-badge';
      document.body.appendChild(badge);
    }
    badge.innerHTML = `<span class="backstab-cooldown-icon">🗡️</span><span><b>BACKSTAB</b><em>${formatCooldown(remaining)}</em></span>`;
  }

  function startCooldown(ms) {
    cooldownUntil = Date.now() + Math.max(0, Number(ms) || 0);
    renderCooldown();
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(renderCooldown, 15000);
  }

  function decorateRoster(root = document) {
    const now = Date.now();
    for (const [id, until] of betrayalMarks) {
      if (until <= now) betrayalMarks.delete(id);
    }
    root.querySelectorAll?.('[data-player-id]').forEach(entry => {
      const id = String(entry.dataset.playerId || '');
      entry.classList.toggle('backstab-marked', betrayalMarks.has(id));
      let mark = entry.querySelector('.backstab-betrayal-mark');
      if (betrayalMarks.has(id)) {
        if (!mark) {
          mark = document.createElement('span');
          mark.className = 'backstab-betrayal-mark';
          mark.textContent = '🗡️';
          mark.title = 'Recently backstabbed';
          entry.querySelector('.pl-entry-name')?.after(mark);
        }
      } else {
        mark?.remove();
      }
    });
  }

  function markVictim(playerId) {
    if (!playerId) return;
    betrayalMarks.set(String(playerId), Date.now() + 60000);
    decorateRoster(document);
    setTimeout(() => decorateRoster(document), 60500);
  }

  function onMessage(message, viewerId) {
    if (!message || message.type !== 'backstab:strike') return;
    clearExisting();

    const actorId = String(message.actorId || '');
    const victimId = String(message.victimId || '');
    const me = viewerId == null ? '' : String(viewerId);
    const isVictim = me && me === victimId;
    const isActor = me && me === actorId;
    const failed = message.failed === true;

    markVictim(victimId);
    if (isActor) startCooldown(message.cooldownMs);

    const layer = document.createElement('div');
    layer.id = 'backstab-effect-layer';
    layer.className = [
      'backstab-layer',
      failed ? 'is-failure' : 'is-success',
      isVictim ? 'is-victim' : '',
      isActor ? 'is-actor' : ''
    ].filter(Boolean).join(' ');
    layer.setAttribute('aria-live', 'assertive');

    const headline = failed ? 'BACKSTAB FAILED' : 'BACKSTABBED';
    const detail = failed
      ? `${message.actorName || 'Someone'} tried to backstab ${message.intendedTargetName || 'someone'} and stabbed themselves instead.`
      : `${message.actorName || 'Someone'} backstabbed ${message.victimName || 'someone'}.`;

    layer.innerHTML = `
      <div class="backstab-vignette" aria-hidden="true"></div>
      <div class="backstab-stage" aria-hidden="true">
        <div class="backstab-dagger">
          <div class="backstab-blade"></div>
          <div class="backstab-guard"></div>
          <div class="backstab-grip"></div>
          <div class="backstab-pommel"></div>
          <div class="backstab-flag"><span></span><span></span><span></span></div>
        </div>
        <div class="backstab-smoke smoke-a"></div>
        <div class="backstab-smoke smoke-b"></div>
        <div class="backstab-smoke smoke-c"></div>
      </div>
      <div class="backstab-caption">
        <strong>${headline}</strong>
        <span>${detail}</span>
        <em>🇧🇬${Number(message.cost) > 0 ? ` · ${Number(message.cost)} SC` : ' · SHADOW BROKER AUTHORITY'}</em>
      </div>`;

    document.body.appendChild(layer);
    requestAnimationFrame(() => document.documentElement.classList.add('backstab-impact'));

    const duration = Math.max(2200, Number(message.durationMs) || 3000);
    activeTimer = setTimeout(() => {
      layer.classList.add('is-leaving');
      document.documentElement.classList.remove('backstab-impact');
      setTimeout(clearExisting, 450);
    }, duration);
  }

  window.BackstabEffect = Object.freeze({ onMessage, clear: clearExisting, decorateRoster });
})();
