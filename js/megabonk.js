// MEGABONK -- the Shadow Broker's persistent attention call.
//   Player page (PlayerApp): a full-screen alert that stays until the player
//     presses ACKNOWLEDGE. Only the server's megabonk:cleared removes it --
//     no timeout, focus, chat, navigation, reconnect or state refresh.
//     Several MEGABONKs can be pending at once; they are shown one after
//     another, oldest first.
//   GM page (App): live acknowledgement tracker, one card per running
//     MEGABONK, "MEGABONK // 4 / 6", each with its own END.
(function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ PLAYER
  let pendingId = null;          // the alert currently on screen
  const queue = [];              // [{ id, message }] oldest first
  let overlay = null;
  let guard = null;
  let shakeTimer = null;

  function shakePlayerScreen() {
    if (reduced()) return;
    const root = document.documentElement;
    // Restart the impact even when another MEGABONK arrives while the modal
    // is already open. Removing + flushing the class makes repeated server
    // deliveries produce a new animation instead of reusing a finished one.
    root.classList.remove('mbk-shake');
    document.body.classList.remove('mbk-shake'); // clear legacy builds
    void root.offsetWidth;
    root.classList.add('mbk-shake');
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => root.classList.remove('mbk-shake'), 1100);
  }

  // Ministry-style surveillance searchlight: an original vector assembly,
  // built from geometric armour, shutters and an illuminated optical core.
  // It stays sharp at every desktop scale and replaces the generic hammer.
  const SEARCHLIGHT = `<div class="mbk-searchlight" aria-hidden="true">
    <div class="mbk-searchlight-beam"></div>
    <svg class="mbk-searchlight-unit" viewBox="0 0 260 170" focusable="false">
      <defs>
        <radialGradient id="mbk-lens" cx="50%" cy="46%" r="54%">
          <stop offset="0" stop-color="#fff6ed"/><stop offset=".12" stop-color="#ffdfcf"/><stop offset=".3" stop-color="#ff3648"/><stop offset=".68" stop-color="#7e0713"/><stop offset="1" stop-color="#170207"/>
        </radialGradient>
        <linearGradient id="mbk-metal" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#5f6268"/><stop offset=".28" stop-color="#171a20"/><stop offset=".65" stop-color="#343840"/><stop offset="1" stop-color="#090b0f"/>
        </linearGradient>
      </defs>
      <path class="mbk-mount" d="M115 112h30l10 45h-50z"/>
      <path class="mbk-yoke" d="M43 62h23v58h128V62h23v78H43z"/>
      <path class="mbk-armour" d="M41 25 74 8h112l33 17 18 48-18 48-33 17H74l-33-17-18-48z"/>
      <path class="mbk-armour-inner" d="M61 35 82 23h96l21 12 14 38-14 38-21 12H82l-21-12-14-38z"/>
      <circle class="mbk-lens-ring-outer" cx="130" cy="73" r="57"/>
      <circle class="mbk-lens-ring" cx="130" cy="73" r="46"/>
      <circle class="mbk-lens" cx="130" cy="73" r="35"/>
      <circle class="mbk-lens-core" cx="130" cy="73" r="8"/>
      <path class="mbk-reticle" d="M130 27v18M130 101v18M84 73h18M158 73h18"/>
      <g class="mbk-shutters"><path d="m72 20 23 9-18 18-31-4z"/><path d="m188 20-23 9 18 18 31-4z"/><path d="m72 126 23-9-18-18-31 4z"/><path d="m188 126-23-9 18-18 31 4z"/></g>
      <g class="mbk-rivets"><circle cx="51" cy="73" r="3"/><circle cx="209" cy="73" r="3"/><circle cx="80" cy="18" r="3"/><circle cx="180" cy="18" r="3"/><circle cx="80" cy="128" r="3"/><circle cx="180" cy="128" r="3"/></g>
    </svg>
    <div class="mbk-searchlight-scan"></div>
  </div>`;

  function enqueue(id, message) {
    if (!id) return;
    const known = queue.find(item => item.id === id);
    if (known) known.message = message;
    else queue.push({ id, message });
    if (!pendingId || pendingId === id) showAlert(queue[0].id, queue[0].message);
    else updateCount();
  }

  function updateCount() {
    const count = overlay?.querySelector('.mbk-count');
    if (!count) return;
    const text = queue.length > 1 ? `1 OF ${queue.length}` : '';
    if (count.textContent !== text) count.textContent = text;
    count.hidden = !text;
  }

  function showAlert(id, message) {
    const fresh = pendingId !== id;
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
        <div class="mbk-surveillance" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="mbk-card">
          <div class="mbk-classification"><span>MINISTRY OVERRIDE</span><b>PRIORITY // RED</b></div>
          ${SEARCHLIGHT}
          <h1 id="mbk-title" class="mbk-title">MEGABONK</h1>
          <p id="mbk-sub" class="mbk-sub">YOU ARE BEING OBSERVED</p>
          <p class="mbk-directive">SHADOW BROKER REQUIRES IMMEDIATE ATTENTION</p>
          <p class="mbk-msg" hidden></p>
          <p class="mbk-count" hidden></p>
          <button type="button" class="mbk-ack">ACKNOWLEDGE</button>
        </div>`;
      overlay.querySelector('.mbk-ack').addEventListener('click', acknowledge);
      // Nothing but ACKNOWLEDGE dismisses it.
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } }, true);
      document.body.appendChild(overlay);
      if (!reduced()) {
        overlay.classList.add('mbk-slam');
      }
      window.AsocAlerts?.signal?.({ popup: { title: 'MEGABONK', body: 'The Shadow Broker requires your attention.', tag: 'megabonk' } });
    }
    const msgEl = overlay.querySelector('.mbk-msg');
    if (msgEl) {
      msgEl.textContent = message || '';
      msgEl.hidden = !message;
    }
    updateCount();
    const button = overlay.querySelector('.mbk-ack');
    if (fresh) {
      button.disabled = false;
      button.textContent = 'ACKNOWLEDGE';
    }
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
    const id = pendingId;
    const button = overlay?.querySelector('.mbk-ack');
    const sent = window.PlayerApp?.send({ type: 'megabonk:ack', id });
    if (button) {
      button.disabled = true;
      button.textContent = sent ? 'ACKNOWLEDGING…' : 'RECONNECTING…';
      // Not confirmed by the server yet: allow another press shortly.
      setTimeout(() => { if (pendingId === id && button.isConnected) { button.disabled = false; button.textContent = 'ACKNOWLEDGE'; } }, 4000);
    }
  }

  function clearAlert(id) {
    const index = queue.findIndex(item => item.id === id);
    if (index >= 0) queue.splice(index, 1);
    if (!pendingId || (id && id !== pendingId)) return updateCount();
    // The next pending MEGABONK (if any) takes over the same overlay.
    if (queue.length) {
      pendingId = null;
      return showAlert(queue[0].id, queue[0].message);
    }
    pendingId = null;
    guard?.disconnect();
    guard = null;
    overlay?.remove();
    overlay = null;
  }

  // ---------------------------------------------------------------- GM
  let widget = null;
  let collapsed = false;
  let lastEvents = [];
  let lastHtml = '';

  function eventHTML(event) {
    const done = event.acknowledged >= event.total;
    const pct = event.total ? Math.round(100 * event.acknowledged / event.total) : 0;
    return `
      <section class="mbk-gm-event${done ? ' done' : ''}" data-mbk-id="${esc(event.id)}">
        <header class="mbk-gm-head">
          <strong>MEGABONK${event.scope === 'one' ? ' ONE' : ''} // ${event.acknowledged} / ${event.total} ACKNOWLEDGED</strong>
        </header>
        <div class="mbk-gm-bar"><i style="width:${pct}%"></i></div>
        ${event.message ? `<p class="mbk-gm-msg">“${esc(event.message)}”</p>` : ''}
        ${collapsed ? '' : `
          <ul class="mbk-gm-list">${event.players.map(p => `
            <li class="${p.ackAt ? 'ack' : 'pending'}">
              <i class="mbk-dot${p.connected ? ' on' : ''}" title="${p.connected ? 'Online' : 'Offline'}"></i>
              <span>${esc(p.name)}</span>
              <b>${p.ackAt ? 'ACKNOWLEDGED' : 'PENDING'}</b>
            </li>`).join('')}
          </ul>
          <footer class="mbk-gm-foot">
            <span>${done ? 'ALL TARGETS HAVE SEEN IT' : 'WAITING FOR ACKNOWLEDGEMENTS'}</span>
            <button type="button" class="mbk-gm-btn" data-mbk-end="${esc(event.id)}">END</button>
          </footer>`}
      </section>`;
  }

  function renderProgress(events) {
    lastEvents = events;
    if (!events.length) { widget?.remove(); widget = null; lastHtml = ''; return; }
    if (!widget || !widget.isConnected) {
      lastHtml = '';
      widget = document.createElement('aside');
      widget.id = 'megabonk-progress';
      widget.className = 'mbk-gm';
      widget.setAttribute('aria-live', 'polite');
      widget.addEventListener('click', e => {
        if (e.target.closest('[data-mbk-toggle]')) { collapsed = !collapsed; renderProgress(lastEvents); }
        if (e.target.closest('[data-mbk-end]')) {
          const button = e.target.closest('[data-mbk-end]');
          if (!button.classList.contains('armed')) {
            button.classList.add('armed');
            button.textContent = 'CONFIRM END';
            setTimeout(() => { if (button.isConnected) { button.classList.remove('armed'); button.textContent = 'END'; } }, 3500);
            return;
          }
          window.App?.send({ type: 'gm:megabonkEnd', id: button.dataset.mbkEnd || undefined });
        }
      });
      document.body.appendChild(widget);
    }
    const done = events.every(event => event.acknowledged >= event.total);
    widget.classList.toggle('done', done);
    widget.classList.toggle('collapsed', collapsed);
    const html = `
      <div class="mbk-gm-top">
        <span>${events.length > 1 ? `${events.length} MEGABONKS RUNNING` : 'MEGABONK'}</span>
        <button type="button" class="mbk-gm-btn" data-mbk-toggle aria-label="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▴' : '▾'}</button>
      </div>
      ${events.slice().reverse().map(eventHTML).join('')}`;
    // Only rewritten when something changed (no flicker under the cursor).
    if (html !== lastHtml) { lastHtml = html; widget.innerHTML = html; }
  }

  function onMessage(message) {
    if (message.type === 'megabonk:alert') {
      shakePlayerScreen();
      return enqueue(message.id, String(message.message || ''));
    }
    if (message.type === 'megabonk:cleared') return clearAlert(message.id);
    if (message.type === 'megabonk:progress') {
      const events = Array.isArray(message.events) ? message.events : (message.event ? [message.event] : []);
      return renderProgress(events);
    }
  }

  window.Megabonk = { onMessage, _pending: () => pendingId, _queue: () => queue.map(item => item.id) };
})();
