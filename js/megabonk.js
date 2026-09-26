// MEGABONK -- the Shadow Broker's persistent attention call.
//   Player page (PlayerApp): a full-screen alert that stays until the player
//     presses ACKNOWLEDGE. Only the server's megabonk:cleared removes it --
//     no timeout, focus, chat, navigation, reconnect or state refresh.
//   GM page (App): live acknowledgement tracker, "MEGABONK // 4 / 6".
(function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ PLAYER
  let pendingId = null;
  let overlay = null;
  let guard = null;

  const HAMMER = `<svg class="mbk-hammer" viewBox="0 0 120 120" aria-hidden="true">
    <rect x="54" y="44" width="12" height="70" rx="3" fill="#3a3f47" stroke="#101216" stroke-width="3"/>
    <rect x="54" y="98" width="12" height="16" rx="2" fill="#7a2a2a"/>
    <path d="M18 18h84l8 12v18l-8 12H18l-8-12V30z" fill="#6b7480" stroke="#101216" stroke-width="4"/>
    <path d="M22 24h76l5 8v12l-5 8H22l-5-8V32z" fill="#9aa4b1"/>
    <g fill="#101216"><circle cx="30" cy="39" r="3"/><circle cx="90" cy="39" r="3"/><circle cx="60" cy="39" r="4"/></g>
    <path d="M10 30l-8-6v30l8-6z M110 30l8-6v30l-8-6z" fill="#c0202c" stroke="#101216" stroke-width="2"/>
  </svg>`;

  function showAlert(id) {
    pendingId = id;
    if (!overlay || !overlay.isConnected) {
      overlay = document.createElement('div');
      overlay.id = 'megabonk-alert';
      overlay.className = 'mbk-overlay';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'mbk-title');
      overlay.setAttribute('aria-describedby', 'mbk-sub');
      overlay.innerHTML = `
        <div class="mbk-card">
          ${HAMMER}
          <h1 id="mbk-title" class="mbk-title">MEGABONK</h1>
          <p id="mbk-sub" class="mbk-sub">SHADOW BROKER REQUIRES YOUR ATTENTION</p>
          <button type="button" class="mbk-ack">ACKNOWLEDGE</button>
        </div>`;
      overlay.querySelector('.mbk-ack').addEventListener('click', acknowledge);
      // Nothing but ACKNOWLEDGE dismisses it.
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } }, true);
      document.body.appendChild(overlay);
      if (!reduced()) {
        overlay.classList.add('mbk-slam');
        document.body.classList.add('mbk-shake');
        setTimeout(() => document.body.classList.remove('mbk-shake'), 900);
      }
      window.AsocAlerts?.signal?.({ popup: { title: 'MEGABONK', body: 'The Shadow Broker requires your attention.', tag: 'megabonk' } });
    }
    const button = overlay.querySelector('.mbk-ack');
    button.disabled = false;
    button.textContent = 'ACKNOWLEDGE';
    setTimeout(() => button.focus({ preventScroll: true }), 50);
    // If anything else on the page removes the alert while it is pending,
    // put it straight back.
    if (!guard) {
      guard = new MutationObserver(() => {
        if (pendingId && overlay && !overlay.isConnected) document.body.appendChild(overlay);
      });
      guard.observe(document.body, { childList: true });
    }
  }

  function acknowledge() {
    if (!pendingId) return;
    const button = overlay?.querySelector('.mbk-ack');
    const sent = window.PlayerApp?.send({ type: 'megabonk:ack', id: pendingId });
    if (button) {
      button.disabled = true;
      button.textContent = sent ? 'ACKNOWLEDGING…' : 'RECONNECTING…';
      // Not confirmed by the server yet: allow another press shortly.
      setTimeout(() => { if (pendingId && button.isConnected) { button.disabled = false; button.textContent = 'ACKNOWLEDGE'; } }, 4000);
    }
  }

  function clearAlert(id) {
    if (!pendingId || (id && id !== pendingId)) return;
    pendingId = null;
    guard?.disconnect();
    guard = null;
    overlay?.remove();
    overlay = null;
  }

  // ---------------------------------------------------------------- GM
  let widget = null;
  let collapsed = false;
  let lastEvent = null;

  function renderProgress(event) {
    lastEvent = event;
    if (!event) { widget?.remove(); widget = null; return; }
    if (!widget || !widget.isConnected) {
      widget = document.createElement('aside');
      widget.id = 'megabonk-progress';
      widget.className = 'mbk-gm';
      widget.setAttribute('aria-live', 'polite');
      widget.addEventListener('click', e => {
        if (e.target.closest('[data-mbk-toggle]')) { collapsed = !collapsed; renderProgress(lastEvent); }
        if (e.target.closest('[data-mbk-end]')) {
          const button = e.target.closest('[data-mbk-end]');
          if (!button.classList.contains('armed')) {
            button.classList.add('armed');
            button.textContent = 'CONFIRM END';
            setTimeout(() => { if (button.isConnected) { button.classList.remove('armed'); button.textContent = 'END'; } }, 3500);
            return;
          }
          window.App?.send({ type: 'gm:megabonkEnd' });
        }
      });
      document.body.appendChild(widget);
    }
    const done = event.acknowledged >= event.total;
    const pct = event.total ? Math.round(100 * event.acknowledged / event.total) : 0;
    widget.classList.toggle('done', done);
    widget.classList.toggle('collapsed', collapsed);
    widget.innerHTML = `
      <header class="mbk-gm-head">
        <strong>MEGABONK // ${event.acknowledged} / ${event.total} ACKNOWLEDGED</strong>
        <button type="button" class="mbk-gm-btn" data-mbk-toggle aria-label="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▴' : '▾'}</button>
      </header>
      <div class="mbk-gm-bar"><i style="width:${pct}%"></i></div>
      ${collapsed ? '' : `
        <ul class="mbk-gm-list">${event.players.map(p => `
          <li class="${p.ackAt ? 'ack' : 'pending'}">
            <i class="mbk-dot${p.connected ? ' on' : ''}" title="${p.connected ? 'Online' : 'Offline'}"></i>
            <span>${esc(p.name)}</span>
            <b>${p.ackAt ? 'ACKNOWLEDGED' : 'PENDING'}</b>
          </li>`).join('')}
        </ul>
        <footer class="mbk-gm-foot">
          <span>${done ? 'ALL LITTLE HEROES HAVE SEEN IT' : 'WAITING FOR ACKNOWLEDGEMENTS'}</span>
          <button type="button" class="mbk-gm-btn" data-mbk-end>END</button>
        </footer>`}`;
  }

  function onMessage(message) {
    if (message.type === 'megabonk:alert') return showAlert(message.id);
    if (message.type === 'megabonk:cleared') return clearAlert(message.id);
    if (message.type === 'megabonk:progress') return renderProgress(message.event);
  }

  window.Megabonk = { onMessage, _pending: () => pendingId };
})();
