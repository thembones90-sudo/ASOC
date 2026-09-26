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

  function flicker(name) {
    // A 3-second smoke storm: a gray flicker, then billowing smoke rolls in
    // from every edge until it fills the screen, a faint SHADOW REALM glyph
    // glows through, and it all clears. Puffs get random spots and timing so
    // no two banishments look the same.
    const layer = document.createElement('div');
    layer.className = 'srealm-flicker' + (reduced() ? ' still' : '');
    layer.setAttribute('aria-hidden', 'true');
    let puffs = '';
    const PUFFS = 22;
    for (let i = 0; i < PUFFS; i++) {
      // Spread starting points around the edges and across the bottom.
      const edge = i % 4;
      const along = Math.random() * 100;
      const x = edge === 0 ? along : edge === 1 ? 100 + Math.random() * 10 : edge === 2 ? along : -10 - Math.random() * 10;
      const y = edge === 0 ? 105 + Math.random() * 10 : edge === 1 ? along : edge === 2 ? -10 - Math.random() * 10 : along;
      const size = 45 + Math.random() * 45;            // vmax
      const dx = (50 - x) * (0.5 + Math.random() * 0.5); // drift toward the centre
      const dy = (50 - y) * (0.5 + Math.random() * 0.5);
      const shade = 150 + Math.round(Math.random() * 60);
      puffs += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${size.toFixed(0)}vmax;--dx:${dx.toFixed(0)}vw;--dy:${dy.toFixed(0)}vh;--c:${shade};--d:${(Math.random() * 0.5).toFixed(2)}s;--r:${(Math.random() * 60 - 30).toFixed(0)}deg"></i>`;
    }
    layer.innerHTML = `<div class="srealm-cloud">${puffs}</div><b class="srealm-glyph">SHADOW REALM</b>`;
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3100);
    const toast = document.createElement('div');
    toast.className = 'srealm-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<b>${esc(name)}</b> has been banished to the Shadow Realm`;
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

  function banishSelf(until) {
    clearInterval(timer);
    if (!veil || !veil.isConnected) {
      veil = document.createElement('div');
      veil.className = 'srealm-veil' + (reduced() ? ' still' : '');
      veil.setAttribute('role', 'status');
      veil.innerHTML = '<i class="srealm-smoke"></i><i class="srealm-smoke two"></i><div class="srealm-banner"><strong>BANISHED TO THE SHADOW REALM</strong><span>YOUR VOICE RETURNS IN <b class="srealm-count">20</b>s</span></div>';
      document.body.appendChild(veil);
    }
    const count = veil.querySelector('.srealm-count');
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (count) count.textContent = String(left);
      lockInputs(left > 0);
      if (left <= 0) release();
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

  function onMessage(message, selfId) {
    if (message.type !== 'shadowRealm:banish') return;
    // Count down the server's remaining time on this device's own clock, so a
    // skewed device clock cannot shorten or stretch the punishment.
    const until = Date.now() + Math.max(0, Number(message.remainingMs) || 0);
    if (!message.resumed) flicker(message.playerName || 'A LITTLE HERO');
    if (selfId && String(selfId) === String(message.playerId)) banishSelf(until);
  }

  // Persistent memento on the punished message.
  function messageClass(msg) { return msg?.shadowRealm ? ' shadow-realmed' : ''; }
  function markHTML(msg) {
    return msg?.shadowRealm ? '<span class="srealm-mark" aria-label="Sent to the Shadow Realm"><i></i>SENT TO THE SHADOW REALM</span>' : '';
  }

  window.ShadowRealm = { onMessage, messageClass, markHTML, _release: release };
})();
