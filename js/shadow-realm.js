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
    const layer = document.createElement('div');
    layer.className = 'srealm-flicker' + (reduced() ? ' still' : '');
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = '<i></i><i></i><i></i>';
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2600);
    const toast = document.createElement('div');
    toast.className = 'srealm-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<b>${esc(name)}</b> WAS SENT TO THE SHADOW REALM`;
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
