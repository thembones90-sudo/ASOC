// /avada -- AVADA KEDAVRA. The screen goes dark, the incantation burns in
// green, a jagged bolt tears from the caster's corner into the target, the
// world flashes killing-curse green and a tombstone rises. 5% of the time the
// bolt hits, recoils and kills the caster instead: THE ONE WHO LIVED.
// Afterwards (from the server's public state): the dead are grey ghosts with
// struck-through names for 60 s, the survivor wears a lightning scar for 1 h.
// Shared by the GM console and the player screen; presentation only.
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BROKER = id => id === null || id === undefined || id === '' || ['null', '__SHADOW_BROKER__', '__GM__'].includes(String(id));
  let state = { dead: {}, scarred: {} };
  let castUntil = 0;

  // ------------------------------------------------------------ portraits
  function person(id, name) {
    if (BROKER(id)) {
      const p = window.BrokerTransmog?.getProfile?.() || {};
      return { src: p.avatarData || 'assets/ui/shadow-broker.png', name: name || 'SHADOW BROKER' };
    }
    const roster = (window.PlayerApp || window.App)?.currentPlayers || [];
    const hero = roster.find(entry => String(entry?.id) === String(id)) || {};
    const raw = typeof hero.avatarData === 'string' ? hero.avatarData : '';
    const src = raw.startsWith('data:image/') || raw.startsWith('/avatars/') || raw.startsWith('assets/')
      || raw.startsWith('/assets/profiles/dennis-ai.png') ? raw : '';
    return { src, name: name || hero.name || '?' };
  }
  const portrait = (who, cls) => `<span class="av-portrait ${cls}">${who.src ? `<img src="${esc(who.src)}" alt="">` : `<b>${esc(String(who.name).trim().charAt(0).toUpperCase() || '?')}</b>`}</span>`;

  // Jagged lightning between two points, as an SVG polyline.
  function boltPath(a, b, jitter = 46) {
    const pts = [[a.x, a.y]];
    const steps = 9;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const nx = -(b.y - a.y), ny = b.x - a.x, len = Math.hypot(nx, ny) || 1;
      const off = (Math.random() - 0.5) * 2 * jitter * (1 - Math.abs(t - 0.5));
      pts.push([a.x + (b.x - a.x) * t + (nx / len) * off, a.y + (b.y - a.y) * t + (ny / len) * off]);
    }
    pts.push([b.x, b.y]);
    return pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  }

  // A dull "whoomph" and a rushing hiss, unless ASOC sounds are muted.
  function whoomph(delayS = 0) {
    try {
      if (window.AsocAudio?.isMuted?.()) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = whoomph.ctx || (whoomph.ctx = new Ctx());
      const t = ctx.currentTime + delayS;
      const len = Math.floor(ctx.sampleRate * 0.9);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(180, t + 0.8);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      noise.connect(lp).connect(ng).connect(ctx.destination);
      noise.start(t);
      const boom = ctx.createOscillator();
      const bg = ctx.createGain();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(95, t);
      boom.frequency.exponentialRampToValueAtTime(32, t + 0.7);
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      boom.connect(bg).connect(ctx.destination);
      boom.start(t);
      boom.stop(t + 1);
    } catch {}
  }

  // ------------------------------------------------------------ the curse
  function cast(emote, coordinated = false) {
    const a = emote?.avada;
    if (!a || Date.now() < castUntil) return;
    const rebound = a.rebound === true;
    if (!coordinated && window.AsocRuntime?.effects) {
      window.AsocRuntime.effects.enqueue('avada', rebound ? 5200 : 4200, () => cast(emote, true));
      return;
    }
    castUntil = Date.now() + (rebound ? 5200 : 4200);
    const caster = person(emote.actorId, emote.actorName);
    const target = person(emote.targetId, emote.targetName);
    const dead = rebound ? caster : target;
    const W = innerWidth, H = innerHeight;
    const layer = document.createElement('div');
    layer.className = `avada-cast${rebound ? ' is-rebound' : ''}`;
    layer.dataset.asocEffectLayer = 'avada';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `
      <span class="av-dark"></span>
      <span class="av-caster">${portrait(caster, 'is-caster')}<small>${esc(caster.name)}</small></span>
      <b class="av-words"><em>AVADA</em> <em>KEDAVRA</em></b>
      <span class="av-victim">${portrait(target, 'is-victim')}<small>${esc(target.name)}</small></span>
      <svg class="av-bolts" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><filter id="av-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter></defs>
      </svg>
      <span class="av-ring"></span><span class="av-ring av-ring-2"></span>
      <span class="av-flash"></span>
      ${rebound ? `<b class="av-rebound">IT REBOUNDS!</b>` : ''}
      <div class="av-grave">
        ${portrait(dead, 'is-dead')}
        <div class="av-stone"><small>R.I.P.</small><b>HERE LIES</b><strong>${esc(String(dead.name).toUpperCase())}</strong><em>${rebound ? 'KILLED BY THEIR OWN CURSE' : `STRUCK DOWN BY ${esc(String(caster.name).toUpperCase())}`}</em></div>
      </div>
      ${rebound ? `<div class="av-lived">⚡ ${esc(String(target.name).toUpperCase())} // THE ONE WHO LIVED</div>` : ''}`;
    document.body.appendChild(layer);
    // Bolt endpoints from the real portrait positions (final layout, not the
    // pop-in transform): caster wand -> victim's heart, and back if it rebounds.
    const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const from = centre(layer.querySelector('.av-caster .av-portrait'));
    const to = centre(layer.querySelector('.av-victim .av-portrait'));
    const bolt = (a, b) => `<polyline class="av-bolt-glow" pathLength="1" points="${boltPath(a, b)}"/><polyline class="av-bolt-core" pathLength="1" points="${boltPath(a, b, 30)}"/>`;
    layer.querySelector('.av-bolts').insertAdjacentHTML('beforeend',
      `<g class="av-strike">${bolt(from, to)}</g><g class="av-strike av-strike-2">${bolt(from, to)}</g>` +
      (rebound ? `<g class="av-back">${bolt(to, from)}</g><g class="av-back av-strike-2">${bolt(to, from)}</g>` : ''));
    layer.style.setProperty('--hx', `${to.x}px`);
    layer.style.setProperty('--hy', `${to.y}px`);
    layer.style.setProperty('--cx', `${from.x}px`);
    layer.style.setProperty('--cy', `${from.y}px`);

    document.documentElement.classList.add('avada-shake');
    whoomph(0.9);
    if (rebound) whoomph(1.9);
    setTimeout(() => document.documentElement.classList.remove('avada-shake'), rebound ? 2600 : 1700);
    setTimeout(() => layer.remove(), rebound ? 5200 : 4200);
  }

  // ---------------------------------------------- lingering: ghosts & scars
  function setState(next) {
    if (!next || typeof next !== 'object') return;
    state = { dead: next.dead || {}, scarred: next.scarred || {} };
    sweep();
  }
  // From the emote itself (the public state follows right behind it).
  function fromEmote(a) {
    if (!a) return;
    if (a.deadId && a.deadUntil) state.dead[a.deadId] = { name: a.deadName, until: a.deadUntil };
    if (a.livedId && a.livedUntil) state.scarred[a.livedId] = { name: a.livedName, until: a.livedUntil };
    sweep();
  }
  function sweep() {
    const now = Date.now();
    const alive = bucket => Object.fromEntries(Object.entries(bucket).filter(([, v]) => Number(v?.until) > now));
    state = { dead: alive(state.dead), scarred: alive(state.scarred) };
    document.querySelectorAll('[data-dossier]').forEach(node => {
      const id = node.dataset.dossier;
      const isDead = !!state.dead[id];
      node.classList.toggle('avada-dead-name', isDead);
      node.classList.toggle('avada-scar-name', !!state.scarred[id]);
      node.closest('[data-message-id]')?.classList.toggle('avada-dead-msg', isDead);
    });
  }
  setInterval(sweep, 1000);
  // Chat re-renders replace the nodes; re-apply right after.
  new MutationObserver(() => { clearTimeout(sweep.t); sweep.t = setTimeout(sweep, 30); })
    .observe(document.documentElement, { childList: true, subtree: true });

  window.Avada = { cast, setState, fromEmote };
})();
