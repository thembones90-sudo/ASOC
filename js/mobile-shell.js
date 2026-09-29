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
    if (enabled) { mountRotatePrompt(); mountTabs(); }
    else { closeGames(); if (doc.getElementById('m-tabs')) setTab('chat'); }
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

  // ------------------------------------------------ tabs (step 5)
  // CHAT | PEOPLE | PROFILE under the hero bar. Tabs are CSS visibility
  // (html[data-m-tab]); the chat panel is never moved or re-rendered.
  // Everything here only reads PlayerApp state and reuses existing actions
  // (DirectMessages.open, the HUD chips, the rename flow, the mini-games
  // menu), so there is still one client, one socket, one state.
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AVATAR_OK = /^(\/avatars\/[a-f0-9]{32}\.(png|jpg|webp)|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/;
  let tab = 'chat';
  let seenChatCount = 0;
  let peopleSig = '';
  let profileSig = '';

  function app() { return root.PlayerApp || null; }

  function setTab(next) {
    tab = next;
    html.dataset.mTab = next;
    doc.querySelectorAll('#m-tabs [data-m-tab]').forEach(btn => {
      const on = btn.dataset.mTab === next;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    if (next === 'chat') {
      seenChatCount = (app()?.chatMessages || []).length;
      requestAnimationFrame(() => app()?.jumpToLatestChat?.());
    }
    refreshTabs(true);
  }

  function mountTabs() {
    const lobby = doc.getElementById('battle-comms-lobby');
    const chat = doc.getElementById('chat-panel');
    if (!lobby || !chat || doc.getElementById('m-tabs')) return;
    const tabs = doc.createElement('nav');
    tabs.id = 'm-tabs';
    tabs.className = 'm-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = [['chat', 'CHAT'], ['people', 'PEOPLE'], ['profile', 'PROFILE']]
      .map(([key, label]) => `<button type="button" role="tab" data-m-tab="${key}"><span>${label}</span><i class="m-tab-badge" hidden></i></button>`).join('');
    tabs.addEventListener('click', event => {
      const btn = event.target.closest('[data-m-tab]');
      if (btn) setTab(btn.dataset.mTab);
    });
    lobby.insertBefore(tabs, chat);

    const people = doc.createElement('section');
    people.id = 'm-view-people';
    people.className = 'm-view m-view-people';
    people.setAttribute('aria-label', 'People in the room');
    people.addEventListener('click', event => {
      const row = event.target.closest('[data-m-dm]');
      if (row && root.DirectMessages?.open) root.DirectMessages.open(row.dataset.mDm);
    });
    const profile = doc.createElement('section');
    profile.id = 'm-view-profile';
    profile.className = 'm-view m-view-profile';
    profile.setAttribute('aria-label', 'Your Little Hero');
    profile.addEventListener('click', onProfileAction);
    chat.after(people, profile);
    seenChatCount = (app()?.chatMessages || []).length;
    setTab('chat');
  }

  function avatarHTML(player) {
    const frame = /^#[0-9a-f]{6}$/i.test(player?.frameColor || '') ? player.frameColor : '#6f7885';
    const src = typeof player?.avatarData === 'string' && AVATAR_OK.test(player.avatarData) ? player.avatarData : '';
    return `<span class="m-avatar" style="--m-frame:${frame}">${src ? `<img src="${esc(src)}" alt="">` : '<b>LH</b>'}</span>`;
  }

  function renderPeople(force) {
    const view = doc.getElementById('m-view-people');
    const a = app();
    if (!view || !a) return;
    const selfId = a.playerId;
    const players = (a.currentPlayers || []).filter(p => p && p.id && !p.isTestPersona);
    const sorted = [...players].sort((x, y) => (y.connected === true) - (x.connected === true) || (y.score || 0) - (x.score || 0) || String(x.name).localeCompare(String(y.name)));
    const sig = sorted.map(p => [p.id, p.name, p.connected, p.score, p.avatarHash || p.avatarData?.length, p.frameColor].join(':')).join('|') + '#' + selfId;
    if (!force && sig === peopleSig) return;
    peopleSig = sig;
    const online = sorted.filter(p => p.connected === true).length;
    view.innerHTML = `<header class="m-view-head"><b>PEOPLE</b><small>${online} ONLINE · ${sorted.length} IN THE ROOM</small></header>`
      + (sorted.length ? '<ul class="m-people">' + sorted.map(p => {
        const self = p.id === selfId;
        const status = p.connected === true ? '<i class="m-dot is-online"></i>ONLINE' : '<i class="m-dot"></i>AWAY';
        return `<li class="m-person${self ? ' is-self' : ''}${p.connected === true ? ' is-online' : ''}">`
          + avatarHTML(p)
          + `<span class="m-person-copy"><b>${esc(p.name)}${self ? ' <em>YOU</em>' : ''}</b><small>${status} · ${Number(p.score) || 0} PTS</small></span>`
          + (self ? '' : `<button type="button" class="m-person-dm" data-m-dm="${esc(p.id)}" aria-label="Message ${esc(p.name)}">MESSAGE</button>`)
          + '</li>';
      }).join('') + '</ul>' : '<p class="m-empty">Nobody here yet.</p>');
    const badge = doc.querySelector('#m-tabs [data-m-tab="people"] .m-tab-badge');
    if (badge) { badge.hidden = !online; badge.textContent = String(online); }
  }

  function text(id) { return doc.getElementById(id)?.textContent?.trim() || ''; }

  function renderProfile(force) {
    const view = doc.getElementById('m-view-profile');
    const a = app();
    if (!view || !a) return;
    const me = (a.currentPlayers || []).find(p => p.id === a.playerId) || { name: a.playerName, frameColor: a.frameColor, avatarData: a.avatarData };
    const stats = [['SCORE', text('hero-hud-score') || '0'], ['RANK', text('hero-hud-rank') || '#-'], ['STREAK', text('hero-hud-streak') || 'x0'], ['SHADOW COINS', text('hero-hud-coins') || '0']];
    const sig = JSON.stringify([me.name, me.frameColor, me.avatarHash || me.avatarData?.length, stats]);
    if (!force && sig === profileSig) return;
    profileSig = sig;
    view.innerHTML = '<header class="m-view-head"><b>PROFILE</b><small>YOUR LITTLE HERO</small></header>'
      + `<div class="m-profile-card">${avatarHTML(me)}<span class="m-profile-name"><b>${esc(me.name || a.playerName || 'LITTLE HERO')}</b><small>LITTLE HERO</small></span>`
      + '<button type="button" class="m-action m-action-small" data-m-action="rename">RENAME</button></div>'
      + '<dl class="m-stats">' + stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('') + '</dl>'
      + '<div class="m-actions">'
      + '<button type="button" class="m-action" data-m-action="messages">MESSAGES</button>'
      + '<button type="button" class="m-action" data-m-action="market">SHADOW MARKET</button>'
      + '<button type="button" class="m-action" data-m-action="games">MINI GAMES</button>'
      + (doc.getElementById('daily-contract-hud') ? '<button type="button" class="m-action" data-m-action="ledger">DAILY LEDGER</button>' : '')
      + '<button type="button" class="m-action" data-m-action="desktop">DESKTOP VERSION</button>'
      + '<button type="button" class="m-action m-action-danger" data-m-action="disconnect">DISCONNECT</button>'
      + '</div>'
      + '<p class="m-note">Avatar, frame and theme are chosen on the sign-in screen: DISCONNECT, change them, and enter again.</p>';
  }

  function onProfileAction(event) {
    const action = event.target.closest('[data-m-action]')?.dataset.mAction;
    if (!action) return;
    event.preventDefault();
    const click = id => doc.getElementById(id)?.click();
    if (action === 'messages') click('hero-hud-dm-chip');
    else if (action === 'market') click('hero-hud-coins-chip');
    else if (action === 'games') openGames();
    else if (action === 'ledger') doc.getElementById('daily-contract-hud')?.click();
    else if (action === 'desktop') set(false);
    else if (action === 'disconnect') click('player-logout-control');
    else if (action === 'rename') renameHero();
  }

  async function renameHero() {
    const a = app();
    if (!a?.updateDesignation || !root.AsocDialog?.prompt) return;
    const requested = await root.AsocDialog.prompt({ title: 'NEW LITTLE HERO DESIGNATION', value: a.playerName || '', maxLength: 20, required: true, confirmLabel: 'RENAME' });
    if (requested === null) return;
    try { await a.updateDesignation(requested); } catch (error) { a.showError?.(error.message || 'Could not update Little Hero designation'); }
    refreshTabs(true);
  }

  // The desktop mini-games dock, opened as a full-screen sheet.
  function openGames() {
    const dock = doc.getElementById('casual-minigames-dock');
    const menu = doc.getElementById('casual-minigames-menu');
    if (!dock || !menu) return;
    if (!doc.getElementById('m-games-close')) {
      const close = doc.createElement('button');
      close.type = 'button';
      close.id = 'm-games-close';
      close.className = 'm-games-close';
      close.setAttribute('aria-label', 'Close mini games');
      close.textContent = '×';
      close.addEventListener('click', closeGames);
      menu.prepend(close);
      // Choosing a game hands over to that game's own screen.
      menu.addEventListener('click', event => { if (event.target.closest('.casual-minigame-card')) setTimeout(closeGames, 0); });
    }
    menu.hidden = false;
    html.classList.add('m-games-open');
  }

  function closeGames() {
    html.classList.remove('m-games-open');
    const menu = doc.getElementById('casual-minigames-menu');
    if (menu) menu.hidden = true;
  }

  function refreshTabs(force) {
    if (!enabled) return;
    const a = app();
    const count = (a?.chatMessages || []).length;
    if (tab === 'chat') seenChatCount = count;
    const chatBadge = doc.querySelector('#m-tabs [data-m-tab="chat"] .m-tab-badge');
    if (chatBadge) {
      const unread = Math.max(0, count - seenChatCount);
      chatBadge.hidden = !unread;
      chatBadge.textContent = unread > 99 ? '99+' : String(unread);
    }
    if (tab === 'people' || force) renderPeople(force);
    if (tab === 'profile' || force) renderProfile(force);
  }

  function start() {
    mountButtons();
    if (enabled) { mountRotatePrompt(); mountTabs(); }
    setInterval(() => refreshTabs(false), 1200);
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
