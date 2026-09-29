// MOBILE SHELL (Mobile Alpha 0.1, step 4) -- the same Little Hero app, same
// socket and state, presented for a phone.
//
// Engaged ONLY by the player: the MOBILE VERSION button (decision 1). The
// choice is remembered per device; the same control switches back. On a
// touch phone the button is offered prominently, never switched on by itself.
// Testing override: ?asoc-mobile=1 / ?asoc-mobile=0 (remembered).
//
// Everything visual lives in css/mobile.css under html.asoc-mobile, so the
// desktop page is untouched while this is off. This file only:
//   - sets/clears html.asoc-mobile (early, before first paint),
//   - adds the MOBILE VERSION / DESKTOP VERSION toggles,
//   - mirrors the room mode + orientation onto <html> for CSS,
//   - keeps --m-vvh in step with the visual viewport (on-screen keyboard),
//   - shows the "turn your phone sideways" prompt for battles in portrait.
(function (root) {
  const KEY = 'asoc_mobile_view';
  const doc = root.document;
  const html = doc.documentElement;
  const PHONE_QUERY = '(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 500px)';

  function read() {
    try {
      const param = new URLSearchParams(root.location.search).get('asoc-mobile');
      if (param === '1' || param === '0') localStorage.setItem(KEY, param);
      return localStorage.getItem(KEY) === '1';
    } catch { return false; }
  }

  let enabled = read();
  html.classList.toggle('asoc-mobile', enabled);

  function looksLikePhone() {
    try { return root.matchMedia(PHONE_QUERY).matches; } catch { return false; }
  }

  function set(next) {
    enabled = !!next;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch {}
    html.classList.toggle('asoc-mobile', enabled);
    if (enabled) mountRotatePrompt();
    syncButtons();
    syncViewport();
    syncMode();
    // Board, chat and popovers measure themselves on resize.
    root.dispatchEvent(new Event('resize'));
    if (enabled) requestAnimationFrame(() => root.PlayerApp?.jumpToLatestChat?.());
  }

  // --------------------------------------------------------------- buttons
  function makeToggle(id, className) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = className;
    btn.addEventListener('click', event => { event.preventDefault(); set(!enabled); });
    return btn;
  }

  function syncButtons() {
    doc.querySelectorAll('.asoc-view-toggle').forEach(btn => {
      btn.textContent = enabled ? 'DESKTOP VERSION' : 'MOBILE VERSION';
      btn.setAttribute('aria-pressed', String(enabled));
      btn.title = enabled ? 'Switch back to the full desktop layout' : 'Switch to the phone layout';
    });
    const offer = doc.getElementById('asoc-phone-offer');
    if (offer) offer.hidden = enabled || !looksLikePhone() || sessionStorage.getItem('asoc_mobile_offer_dismissed') === '1';
  }

  function mountButtons() {
    // Join / access screen.
    const join = doc.getElementById('join-screen');
    if (join && !doc.getElementById('asoc-view-toggle-join')) {
      const btn = makeToggle('asoc-view-toggle-join', 'asoc-view-toggle asoc-view-toggle-join');
      join.appendChild(btn);
    }
    // In game: beside DISCONNECT in the hero HUD.
    const identity = doc.querySelector('#little-hero-hud .hero-hud-identity-block');
    if (identity && !doc.getElementById('asoc-view-toggle-game')) {
      const btn = makeToggle('asoc-view-toggle-game', 'asoc-view-toggle hero-utility-btn asoc-view-toggle-game');
      identity.appendChild(btn);
    }
    // Phones get a prominent, dismissible offer (never an automatic switch).
    // Built only on a touch phone, so the desktop page carries none of it.
    if (looksLikePhone() && !doc.getElementById('asoc-phone-offer')) {
      const offer = doc.createElement('div');
      offer.id = 'asoc-phone-offer';
      offer.className = 'asoc-phone-offer';
      offer.hidden = true;
      offer.innerHTML = '<span>ON A PHONE?</span>';
      const go = makeToggle('asoc-view-toggle-offer', 'asoc-view-toggle asoc-view-toggle-offer');
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'asoc-phone-offer-close';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '×';
      close.addEventListener('click', () => {
        try { sessionStorage.setItem('asoc_mobile_offer_dismissed', '1'); } catch {}
        offer.hidden = true;
      });
      offer.append(go, close);
      doc.body.appendChild(offer);
    }
    syncButtons();
  }

  // ------------------------------------------------------- mode + viewport
  const MODES = ['CASUAL', 'BATTLE_ARMED', 'BATTLE', 'RECOUNT'];
  function syncMode() {
    const screen = doc.getElementById('game-screen');
    const mode = screen?.dataset.roomMode || MODES.find(m => screen?.classList.contains('room-mode-' + m.toLowerCase().replace('_', '-'))) || 'CASUAL';
    if (html.dataset.mRoomMode !== mode) html.dataset.mRoomMode = mode;
    const landscape = root.innerWidth > root.innerHeight;
    const orientation = landscape ? 'landscape' : 'portrait';
    if (html.dataset.mOrientation !== orientation) html.dataset.mOrientation = orientation;
  }

  // The visual viewport shrinks when the on-screen keyboard opens; sizing
  // the shell to it keeps the composer above the keyboard on iOS and Android.
  function syncViewport() {
    const vv = root.visualViewport;
    const height = Math.round(vv ? vv.height : root.innerHeight);
    html.style.setProperty('--m-vvh', height + 'px');
    syncMode();
  }

  function mountRotatePrompt() {
    const screen = doc.getElementById('game-screen');
    if (!screen || doc.getElementById('m-rotate-prompt')) return;
    const prompt = doc.createElement('div');
    prompt.id = 'm-rotate-prompt';
    prompt.className = 'm-rotate-prompt';
    prompt.setAttribute('role', 'status');
    prompt.innerHTML = '<span class="m-rotate-icon" aria-hidden="true"></span>'
      + '<span class="m-rotate-copy"><b>BATTLE IS LIVE</b><small>Turn your phone sideways to play. Chat stays live below.</small></span>';
    screen.insertBefore(prompt, screen.firstChild);
  }

  function start() {
    mountButtons();
    if (enabled) mountRotatePrompt();
    syncViewport();
    const screen = doc.getElementById('game-screen');
    if (screen && typeof MutationObserver !== 'undefined') {
      new MutationObserver(syncMode).observe(screen, { attributes: true, attributeFilter: ['class', 'data-room-mode'] });
    }
    root.visualViewport?.addEventListener('resize', syncViewport);
    root.addEventListener('resize', syncViewport);
    root.addEventListener('orientationchange', () => setTimeout(syncViewport, 250));
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();

  root.MobileShell = { isEnabled: () => enabled, set, looksLikePhone };
})(window);
