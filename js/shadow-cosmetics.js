// SHADOW COSMETICS -- client rendering of equipped Shadow Market cosmetics.
// Shared by the GM console (app.js) and the player screen (player.js).
// Everything here is visual: avatar classes, name styles, sigils and titles,
// correct-answer celebrations, premium /command screen effects, and the
// read-only player DOSSIER. The server sends only sanitized ids.
(function () {
  const SAFE_ID = /^[a-z0-9-]{1,48}$/;
  const FX = new Set(['smite', 'freeze', 'glitch', 'omen', 'rupture', 'vanish', 'love']);
  const LOVE_COLORS = ['#ff5fa2', '#ff3b6b', '#ff8fc8', '#c77dff', '#ffd166', '#5ee6ff', '#7dff9b', '#ff9f5a'];
  const SIGILS = { 'sigil-eye': '◉', 'sigil-skull': '☠', 'sigil-crown': '♛', 'sigil-dagger': '†', 'sigil-coin': '' };
  const BOOT_AT = Date.now();
  const played = new Set();
  const celebrated = new Set();

  function cosmeticsOf(entity, players) {
    if (entity && entity.cosmetics) return entity.cosmetics;
    const id = String(entity?.id || entity?.playerId || '');
    if (!id || !Array.isArray(players)) return null;
    return players.find(p => String(p.id) === id)?.cosmetics || null;
  }

  function escape(text) {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ---------------------------------------------------------------- avatar
  // Space-prefixed class list for .little-hero-avatar.
  function avatarClass(entity, players) {
    const c = cosmeticsOf(entity, players);
    if (!c) return '';
    let out = '';
    if (SAFE_ID.test(c.appearance || '')) out += ' cos-' + c.appearance;
    if (SAFE_ID.test(c.frame || '')) out += ' cos-' + c.frame;
    if (SAFE_ID.test(c.effect || '')) {
      const tier = Math.max(1, Math.min(5, Number(c.effectTier) || 1));
      out += ' cos-fx cos-' + c.effect + ' cos-tier-' + tier;
    }
    return out;
  }

  // Inner overlay (smoke, frost, particles, cracks). The avatar clips its
  // overflow, so outer glows ride on the avatar's own box-shadow instead.
  function avatarLayer(entity, players) {
    const c = cosmeticsOf(entity, players);
    return c && (SAFE_ID.test(c.effect || '') || SAFE_ID.test(c.appearance || ''))
      ? '<i class="cos-layer" aria-hidden="true"><i></i></i>'
      : '';
  }

  // ---------------------------------------------------------------- names
  // Space-prefixed class list for a chat name span.
  function nameClass(entity, players) {
    const c = cosmeticsOf(entity, players);
    return c && SAFE_ID.test(c.name || '') ? ' cos-name cos-' + c.name : '';
  }

  function sigilHTML(c) {
    if (!c || !Object.prototype.hasOwnProperty.call(SIGILS, c.sigil)) return '';
    if (c.sigil === 'sigil-coin') return '<span class="cos-sigil cos-sigil-coin" aria-hidden="true"><img src="assets/ui/shadow-coin.webp" alt=""></span>';
    return '<span class="cos-sigil cos-' + c.sigil + '" aria-hidden="true">' + SIGILS[c.sigil] + '</span>';
  }

  // Sigil + title badge, rendered right after a player's name.
  function titleHTML(entity, players) {
    const c = cosmeticsOf(entity, players);
    if (!c) return '';
    const title = typeof c.title === 'string' && c.title ? '<span class="cos-title">' + escape(c.title.slice(0, 40)) + '</span>' : '';
    return sigilHTML(c) + title;
  }

  // ---------------------------------------------------------- celebrations
  // A correct answer's celebration plays ONCE: the first time this client
  // renders the accepted message after page load. History stays static.
  function celebrationId(msg, entity, players) {
    if (msg?.verdict !== 'correct') return '';
    const cel = cosmeticsOf(entity, players)?.celebration;
    if (!SAFE_ID.test(cel || '')) return '';
    if (cel === 'cel-final-witness' && msg.target !== 'FINAL') return '';
    return cel;
  }

  function shouldPlay(msg) {
    const key = String(msg.id) + ':' + String(msg.target || '');
    if (celebrated.has(key)) return false;
    celebrated.add(key);
    if (Date.now() - BOOT_AT < 4000) return false; // initial history load
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  function celebrationClass(msg, entity, players) {
    const cel = celebrationId(msg, entity, players);
    if (!cel) return '';
    const play = shouldPlay(msg);
    if (play && cel === 'cel-final-witness') {
      setTimeout(() => screenLayer('cel-witness-layer', 'WITNESSED'), 0);
    }
    return ' cel cel-' + cel.slice(4) + (play ? ' cel-play' : '');
  }

  function celebrationHTML(msg, entity, players) {
    const cel = celebrationId(msg, entity, players);
    if (cel === 'cel-broker-nod') return '<span class="cel-stamp" aria-hidden="true">ACCEPTED</span>';
    if (cel === 'cel-shatter') return '<span class="cel-cracks" aria-hidden="true"><i></i><i></i><i></i></span>';
    if (cel === 'cel-final-witness') return '<span class="cel-witness-tag" aria-hidden="true">FINAL WITNESS</span>';
    return '';
  }

  // ------------------------------------------------------ screen effects
  function screenLayer(className, label) {
    const layer = document.createElement('div');
    layer.className = 'shadow-fx-layer ' + className;
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = '<i></i><b>' + escape(label) + '</b>';
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 1900);
  }

  // Full-screen one-shot effect for a premium /command, once per message and
  // only while the message is fresh (history replays stay quiet).
  function maybePlayFx(msg) {
    const fx = msg?.emote?.fx;
    if (!FX.has(fx) || !msg.id || played.has(msg.id)) return;
    played.add(msg.id);
    if (Date.now() - Number(msg.timestamp || 0) > 8000) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (fx === 'love') { setTimeout(loveBurst, 0); return; }
    setTimeout(() => screenLayer('shadow-fx-' + fx, String(msg.emote.label || fx).toUpperCase()), 0);
  }

  // /love -- colourful hearts drift up over the chat log (or the whole
  // screen if no chat log is on this page). Non-interactive, ~3.5s.
  function loveBurst() {
    const host = document.getElementById('chat-messages') || document.getElementById('gm-chat-messages');
    const rect = host?.getBoundingClientRect?.();
    const box = rect && rect.width > 80 && rect.height > 80
      ? rect
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const layer = document.createElement('div');
    layer.className = 'love-burst';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' });
    layer.style.setProperty('--rise', (box.height + 60) + 'px');
    const count = Math.round(Math.min(34, Math.max(16, box.width / 22)));
    let html = '';
    for (let i = 0; i < count; i++) {
      const size = 14 + Math.random() * 22;
      html += '<i style="left:' + (Math.random() * 94 + 3).toFixed(1) + '%;' +
        'font-size:' + size.toFixed(0) + 'px;' +
        'color:' + LOVE_COLORS[i % LOVE_COLORS.length] + ';' +
        '--sway:' + ((Math.random() - .5) * 90).toFixed(0) + 'px;' +
        '--spin:' + ((Math.random() - .5) * 50).toFixed(0) + 'deg;' +
        'animation-duration:' + (2.2 + Math.random() * 1.4).toFixed(2) + 's;' +
        'animation-delay:' + (Math.random() * .9).toFixed(2) + 's">♥</i>';
    }
    layer.innerHTML = html;
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 4000);
  }

  function cardClass(msg) {
    const fx = msg?.emote?.fx;
    return FX.has(fx) ? ' shadow-fx-card shadow-fx-card-' + fx : '';
  }

  // ---------------------------------------------------------------- dossier
  const host = () => window.PlayerApp || window.App;
  let pendingDossier = null;

  function dossierRoot() {
    let root = document.getElementById('shadow-dossier');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'shadow-dossier';
    root.className = 'dsr-overlay';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Little Hero dossier');
    root.addEventListener('click', event => {
      if (event.target === root || event.target.closest('[data-dossier-close]')) closeDossier();
    });
    document.body.appendChild(root);
    return root;
  }

  function closeDossier() {
    pendingDossier = null;
    const root = document.getElementById('shadow-dossier');
    if (root) root.hidden = true;
  }

  function openDossier(playerId) {
    const id = String(playerId || '');
    if (!id || !host()?.send) return;
    pendingDossier = id;
    const root = dossierRoot();
    root.innerHTML = '<div class="dsr-card"><div class="dsr-loading">RETRIEVING DOSSIER…</div></div>';
    root.hidden = false;
    host().send({ type: 'shadow:dossier', playerId: id });
  }

  function stat(label, value) {
    return '<div class="dsr-stat"><b>' + escape(value) + '</b><span>' + escape(label) + '</span></div>';
  }

  function showDossier(message) {
    if (!pendingDossier || String(message.playerId) !== pendingDossier) return;
    const d = message.dossier || {};
    const c = d.cosmetics || {};
    const app = host();
    const avatar = app?.littleHeroAvatarHTML
      ? app.littleHeroAvatarHTML({ ...(d.avatar || {}), id: '', cosmetics: c }, false)
      : '';
    const s = d.stats || {};
    const since = d.since ? new Date(d.since) : null;
    const relics = (d.showcase || []).length
      ? d.showcase.map(r => '<li class="dsr-relic">' +
          (r.asset ? '<i class="dsr-relic-art" aria-hidden="true" style="--dsr-art:url(\'' + escape(r.asset) + '\')"></i>' : '') +
          '<div><b>' + escape(r.name) + '</b><span>' + escape(r.desc) + '</span></div></li>').join('')
      : '<li class="dsr-relic dsr-relic-empty"><span>NO RELICS ON DISPLAY</span></li>';
    const card = SAFE_ID.test(d.card || '') ? ' dsr-' + d.card : '';
    dossierRoot().innerHTML = `
      <article class="dsr-card${card}">
        <header class="dsr-head">
          <span class="dsr-stamp">CONFIDENTIAL</span>
          <span class="dsr-actions">${window.DirectMessages && d.avatar?.id && String(d.avatar.id) !== String(window.PlayerApp?.playerId || '')
            ? `<button type="button" class="dsr-close dsr-dm" data-dm-open="${escape(d.avatar.id)}">SEND MESSAGE</button>` : ''}
          <button type="button" class="dsr-close" data-dossier-close aria-label="Close dossier">CLOSE</button></span>
        </header>
        <div class="dsr-ident">
          <div class="dsr-avatar">${avatar}</div>
          <div>
            <small>LITTLE HERO DOSSIER${d.online ? ' // ONLINE' : ''}</small>
            <h2><span class="dsr-name${SAFE_ID.test(c.name || '') ? ' cos-name cos-' + c.name : ''}">${escape(d.name || 'LITTLE HERO')}</span>${sigilHTML(c)}</h2>
            ${c.title ? '<span class="cos-title">' + escape(c.title) + '</span>' : ''}
            ${since && !isNaN(since) ? '<p class="dsr-since">ON FILE SINCE ' + escape(since.toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase()) + '</p>' : ''}
          </div>
        </div>
        <section class="dsr-section">
          <h3>RELICS <em>${escape(d.relicCount || 0)} / ${escape(d.relicTotal || 0)} UNEARTHED</em></h3>
          <ul class="dsr-relics">${relics}</ul>
        </section>
        <section class="dsr-section">
          <h3>RECORD</h3>
          <div class="dsr-stats">
            ${stat('LIFETIME SCORE', s.lifetimeScore || 0)}
            ${stat('MATCHES', s.gamesPlayed || 0)}
            ${stat('WON', s.gamesWon || 0)}
            ${stat('COLUMNS', s.columnSolutions || 0)}
            ${stat('FINALS', s.finalSolutions || 0)}
            ${stat('BEST STREAK', s.bestColumnStreak || 0)}
            ${stat('IKS OKS WINS', s.threefoldWins || 0)}
          </div>
        </section>
      </article>`;
  }

  function onMessage(message) {
    if (message.type === 'shadow:dossierResult') return showDossier(message);
    if (message.type === 'shadow:error' && pendingDossier) {
      const root = document.getElementById('shadow-dossier');
      const loading = root?.querySelector('.dsr-loading');
      if (loading) loading.textContent = String(message.message || 'NO DOSSIER ON FILE').toUpperCase();
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-dossier]');
    if (!target || !target.dataset.dossier) return;
    event.preventDefault();
    openDossier(target.dataset.dossier);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('shadow-dossier')?.hidden) closeDossier();
  });

  window.ShadowCosmetics = {
    avatarClass, avatarLayer, nameClass, titleHTML,
    celebrationClass, celebrationHTML,
    maybePlayFx, cardClass,
    openDossier, closeDossier, onMessage
  };
})();
