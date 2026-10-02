// SHADOW COSMETICS -- client rendering of equipped Shadow Market cosmetics.
// Shared by the GM console (app.js) and the player screen (player.js).
// Everything here is visual: avatar classes, name styles, sigils and titles,
// correct-answer celebrations, premium /command screen effects, and the
// read-only player DOSSIER. The server sends only sanitized ids.
(function () {
  const SAFE_ID = /^[a-z0-9-]{1,48}$/;
  const FX = new Set(['smite', 'freeze', 'glitch', 'omen', 'rupture', 'vanish', 'love', 'drug', 'hug']);
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
    if (fx === 'drug') { setTimeout(drugHeartbeat, 0); return; }
    if (fx === 'freeze') { setTimeout(flashFreeze, 0); return; }
    if (fx === 'hug') { setTimeout(() => hugBurst(msg.emote), 0); return; }
    setTimeout(() => screenLayer('shadow-fx-' + fx, String(msg.emote.label || fx).toUpperCase()), 0);
  }

  // /drug -- a toxic-green heartbeat: a glowing heart thumps lub-dub three
  // times with a shockwave per beat, the screen edge pulses green and an ECG
  // trace sweeps across. Non-interactive, ~3.4s.
  function drugHeartbeat() {
    const layer = document.createElement('div');
    layer.className = 'drug-heartbeat';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML =
      '<span class="drug-hb-vignette"></span>' +
      '<svg class="drug-hb-ecg" viewBox="0 0 1000 200" preserveAspectRatio="none"><polyline points="0,100 180,100 210,100 230,60 250,140 270,100 300,100 330,100 350,20 370,190 390,100 430,100 600,100 630,100 650,60 670,140 690,100 720,100 750,100 770,20 790,190 810,100 850,100 1000,100"/></svg>' +
      '<span class="drug-hb-heart"><i class="drug-hb-ring"></i><i class="drug-hb-ring"></i><i class="drug-hb-ring"></i>' +
      '<svg viewBox="0 0 24 22"><path d="M12 21.4l-1.5-1.3C5.2 15.3 2 12.4 2 8.6 2 5.5 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.5 22 8.6c0 3.8-3.2 6.7-8.5 11.5L12 21.4z"/></svg></span>' +
      '<b class="drug-hb-title">INJECTED</b>';
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3500);
  }

  // /freeze -- FLASH FREEZE: frost creeps in from every edge, a crack shoots
  // across with a sharp sound, FROZEN sits in the ice with drifting snow, then
  // the ice shatters into falling shards and the screen clears. ~3s.
  function flashFreeze() {
    const layer = document.createElement('div');
    layer.className = 'flash-freeze';
    layer.setAttribute('aria-hidden', 'true');
    let snow = '';
    for (let i = 0; i < 34; i++) {
      snow += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;' +
        'width:' + (3 + Math.random() * 5).toFixed(1) + 'px;' +
        'animation-duration:' + (2.2 + Math.random() * 1.6).toFixed(2) + 's;' +
        'animation-delay:' + (Math.random() * .8).toFixed(2) + 's;' +
        '--drift:' + ((Math.random() - .5) * 80).toFixed(0) + 'px"></i>';
    }
    // Shards: a 4x4 grid whose inner corners are jittered but SHARED by the
    // neighbouring pieces, so the sheet is seamless until it shatters.
    const P = [];
    for (let r = 0; r <= 4; r++) {
      P[r] = [];
      for (let c = 0; c <= 4; c++) {
        const edge = r === 0 || r === 4 || c === 0 || c === 4;
        P[r][c] = [c * 25 + (edge ? 0 : (Math.random() - .5) * 12), r * 25 + (edge ? 0 : (Math.random() - .5) * 12)];
      }
    }
    const pt = ([x, y]) => x.toFixed(1) + '% ' + y.toFixed(1) + '%';
    let shards = '';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      shards += '<i style="clip-path:polygon(' + [P[r][c], P[r][c + 1], P[r + 1][c + 1], P[r + 1][c]].map(pt).join(',') + ');' +
        '--fall:' + (40 + Math.random() * 60).toFixed(0) + 'vh;--spin:' + ((Math.random() - .5) * 70).toFixed(0) + 'deg;--slide:' + ((Math.random() - .5) * 30).toFixed(0) + 'vw;' +
        '--shatter-delay:' + (1.55 + Math.random() * .2).toFixed(2) + 's"></i>';
    }
    layer.innerHTML =
      '<span class="ff-sheet"></span><span class="ff-ice">' + shards + '</span>' +
      '<svg class="ff-crack" viewBox="0 0 1000 600" preserveAspectRatio="none"><polyline points="0,220 140,260 230,200 330,300 420,250 500,330 590,280 700,360 790,300 880,380 1000,340"/><polyline points="420,250 450,140 520,90"/><polyline points="590,280 620,420 560,520"/><polyline points="790,300 850,190"/></svg>' +
      '<span class="ff-snow">' + snow + '</span>' +
      '<b class="ff-title">FROZEN</b>';
    document.body.appendChild(layer);
    setTimeout(iceCrack, 520);
    setTimeout(() => iceCrack(true), 1580);
    setTimeout(() => layer.remove(), 3300);
  }

  // A short synthesized crack (or the bigger shatter), silent under MUTE SOUNDS.
  let fxAudio = null;
  function iceCrack(shatter) {
    try {
      if (localStorage.getItem('asoc_audio_enabled') === '0') return;
      fxAudio ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = fxAudio.currentTime;
      const len = shatter ? .7 : .18;
      const buffer = fxAudio.createBuffer(1, Math.floor(fxAudio.sampleRate * len), fxAudio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, shatter ? 2.5 : 6);
      const src = fxAudio.createBufferSource();
      src.buffer = buffer;
      const hp = fxAudio.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = shatter ? 1800 : 2600;
      const gain = fxAudio.createGain();
      gain.gain.value = shatter ? .32 : .4;
      src.connect(hp).connect(gain).connect(fxAudio.destination);
      src.start(t);
    } catch {}
  }

  // /hug -- two glowing name bubbles drift together and squeeze into a hug,
  // hearts float up over a warm glow. ~3s. A second hug while one plays is
  // folded in (no stacking).
  let hugUntil = 0;
  function hugBurst(emote) {
    if (Date.now() < hugUntil) return;
    hugUntil = Date.now() + 2600;
    const a = String(emote?.actorName || 'Someone');
    const t = String(emote?.targetName || 'everyone');
    const initial = name => escape(name.trim().slice(0, 1).toUpperCase() || '?');
    const layer = document.createElement('div');
    layer.className = 'hug-burst';
    layer.setAttribute('aria-hidden', 'true');
    let hearts = '';
    for (let i = 0; i < 14; i++) {
      hearts += '<i style="left:' + (35 + Math.random() * 30).toFixed(1) + '%;' +
        'font-size:' + (16 + Math.random() * 20).toFixed(0) + 'px;' +
        '--sway:' + ((Math.random() - .5) * 120).toFixed(0) + 'px;' +
        'animation-delay:' + (.75 + Math.random() * .9).toFixed(2) + 's">♥</i>';
    }
    layer.innerHTML =
      '<span class="hug-glow"></span>' +
      '<span class="hug-pair"><span class="hug-blob hug-left"><b>' + initial(a) + '</b></span><span class="hug-blob hug-right"><b>' + initial(t) + '</b></span></span>' +
      '<span class="hug-hearts">' + hearts + '</span>' +
      '<b class="hug-caption">' + escape(a) + ' <span>🤗</span> ' + escape(t) + '</b>';
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3200);
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
