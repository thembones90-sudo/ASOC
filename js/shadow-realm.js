// SHADOW REALM -- client side of the Shadow Broker's gimmick punishment.
//   Everyone (players and GM): a short gray, smoky screen flicker and a
//   toast naming who was banished.
//   The banished Little Hero: a smoke veil with a countdown and a locked
//   composer for the full duration (the server refuses their input anyway).
//   The punished message: gray and smoking forever (markHTML + class).
(function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let veil = null;
  let timer = null;

  function sentenceTitle(offenseCount) {
    const count = Number(offenseCount) || 1;
    if (count >= 3) return 'PERMANENTLY UNIMPRESSIVE';
    if (count === 2) return 'RETURNING OFFENDER';
    return 'BANISHED TO THE SHADOW REALM';
  }

  function flicker(name, announcement) {
    // A restrained gray passage: a soft desaturation and a few slow wisps
    // move in from the edges while the SHADOW REALM glyph fades through.
    const layer = document.createElement('div');
    layer.className = 'srealm-flicker' + (reduced() ? ' still' : '');
    layer.setAttribute('aria-hidden', 'true');
    let puffs = '';
    const PUFFS = 10;
    for (let i = 0; i < PUFFS; i++) {
      // Spread starting points around the edges and across the bottom.
      const edge = i % 4;
      const along = Math.random() * 100;
      const x = edge === 0 ? along : edge === 1 ? 100 + Math.random() * 10 : edge === 2 ? along : -10 - Math.random() * 10;
      const y = edge === 0 ? 105 + Math.random() * 10 : edge === 1 ? along : edge === 2 ? -10 - Math.random() * 10 : along;
      const size = 34 + Math.random() * 28;            // vmax
      const dx = (50 - x) * (0.32 + Math.random() * 0.28); // gentle drift inward
      const dy = (50 - y) * (0.32 + Math.random() * 0.28);
      const shade = 150 + Math.round(Math.random() * 60);
      puffs += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${size.toFixed(0)}vmax;--dx:${dx.toFixed(0)}vw;--dy:${dy.toFixed(0)}vh;--c:${shade};--d:${(Math.random() * 0.5).toFixed(2)}s;--r:${(Math.random() * 60 - 30).toFixed(0)}deg"></i>`;
    }
    layer.innerHTML = `<div class="srealm-cloud">${puffs}</div><b class="srealm-glyph">SHADOW REALM</b>`;
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3500);
    const toast = document.createElement('div');
    toast.className = 'srealm-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<span>${esc(announcement || `${name} has been banished to the Shadow Realm`)}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('out'), 3600);
    setTimeout(() => toast.remove(), 4200);
  }

  function lockInputs(locked) {
    document.body.classList.toggle('shadow-realm-silenced', locked);
    for (const id of ['chat-input', 'dmx-input']) {
      const input = document.getElementById(id);
      if (!input) continue;
      if (locked) {
        if (!input.dataset.srealmPlaceholder) input.dataset.srealmPlaceholder = input.getAttribute('placeholder') || '';
        input.setAttribute('placeholder', 'SILENCED BY THE SHADOW REALM');
        input.disabled = true;
      } else if (input.dataset.srealmPlaceholder !== undefined) {
        input.setAttribute('placeholder', input.dataset.srealmPlaceholder);
        delete input.dataset.srealmPlaceholder;
        input.disabled = false;
      }
    }
  }

  function banishSelf(until, durationMs, offenseCount) {
    clearInterval(timer);
    if (!veil || !veil.isConnected) {
      veil = document.createElement('div');
      veil.className = 'srealm-veil' + (reduced() ? ' still' : '');
      veil.setAttribute('role', 'status');
      veil.innerHTML = `<i class="srealm-smoke"></i><i class="srealm-smoke two"></i><div class="srealm-seal"><div><b class="srealm-count">10</b><small>SECONDS</small></div></div><div class="srealm-banner"><strong>${sentenceTitle(offenseCount)}</strong><span>YOUR VOICE RETURNS WHEN THE SEAL OPENS</span></div>`;
      document.body.appendChild(veil);
    }
    const count = veil.querySelector('.srealm-count');
    const title = veil.querySelector('.srealm-banner strong');
    if (title) title.textContent = sentenceTitle(offenseCount);
    const total = Math.max(1000, Number(durationMs) || (until - Date.now()));
    const tick = () => {
      const leftMs = Math.max(0, until - Date.now());
      const left = Math.ceil(leftMs / 1000);
      if (count) count.textContent = String(left);
      veil?.style.setProperty('--realm-progress', `${Math.max(0, Math.min(360, (leftMs / total) * 360))}deg`);
      lockInputs(leftMs > 0);
      if (leftMs <= 0) release();
    };
    tick();
    timer = setInterval(tick, 250);
  }

  function release() {
    clearInterval(timer);
    timer = null;
    lockInputs(false);
    if (veil) {
      veil.classList.add('out');
      const old = veil;
      setTimeout(() => old.remove(), 700);
      veil = null;
    }
  }

  function releaseEvent(message, selfId) {
    const self = selfId && String(selfId) === String(message.playerId);
    if (self) release();
    const toast = document.createElement('div');
    toast.className = 'srealm-toast srealm-release-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message.announcement || `${message.playerName || 'A Little Hero'} has returned from the Shadow Realm.`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('out'), 3600);
    setTimeout(() => toast.remove(), 4200);
  }

  function onMessage(message, selfId) {
    if (message.type === 'shadowRealm:release') return releaseEvent(message, selfId);
    if (message.type !== 'shadowRealm:banish') return;
    // Count down the server's remaining time on this device's own clock, so a
    // skewed device clock cannot shorten or stretch the punishment.
    const until = Date.now() + Math.max(0, Number(message.remainingMs) || 0);
    if (!message.resumed) {
      flicker(message.playerName || 'A LITTLE HERO', message.announcement);
      window.AsocAudio?.shadowRealm?.();
    }
    if (selfId && String(selfId) === String(message.playerId)) banishSelf(until, message.durationMs, message.offenseCount);
  }

  // Persistent memento on the punished message.
  function messageClass(msg) { return `${msg?.shadowRealm ? ' shadow-realmed' : ''}${msg?.shadowRealmReturn ? ' shadow-returned' : ''}`; }
  function markHTML(msg) {
    if (msg?.shadowRealm) return '<span class="srealm-mark" aria-label="Banished to the Shadow Realm"><i></i>BANISHED TO THE SHADOW REALM</span>';
    if (msg?.shadowRealmReturn) return '<span class="srealm-return-mark"><i></i>RETURNED FROM THE REALM</span>';
    return '';
  }

  window.ShadowRealm = { onMessage, messageClass, markHTML, _release: release };
})();
