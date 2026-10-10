// THE BLOOD SCOPE -- cinematic targeting ritual. Replaces the WOMF wheel
// presentation; the server stays authoritative.
//
// The server picks the victim BEFORE any animation exists (crypto.randomInt)
// and publishes { eventId, seed, startedAt, durationMs, segments, segmentIds,
// winnerIndex }. This module only renders: every client derives the same hunt
// from (seed, winnerIndex) and the same phase from (serverNow - startedAt), so
// a late or reconnecting client resumes mid-ritual instead of restarting it.
// Nothing here ever decides who is selected.
//
// Public API is unchanged from the old wheel so existing call sites keep
// working: Wheel.init(id), Wheel.update(id, state, isGM, handlers, serverTs),
// plus Wheel.isPresenting() for the player's tribute prompt to wait on.
const Wheel = (() => {
  const CONFIG = {
    // Phase boundaries as fractions of durationMs (default 9 s):
    // I initiation 0-1.5 s, II hunt 1.5-5.5 s, III lock 5.5-7.5 s, IV strike 7.5-9 s.
    INIT_END: 1.5 / 9,
    HUNT_END: 5.5 / 9,
    LOCK_END: 7.5 / 9,
    RESULT_AUTOCLOSE_MS: 15000, // result panel dismisses itself locally
    EASTER_EGG_CHANCE: 0.18,    // visual-only "ENTITY PROTECTED" cameo
    BROKER_AVATAR: 'assets/ui/shadow-broker.png'
  };

  const contexts = {};

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const smooth = x => x * x * (3 - 2 * x);

  // Deterministic, purely theatrical hunt: which candidate the reticle visits
  // and when. The LAST step is always the server's winner; the winner is kept
  // out of the closing run-up so the result is not given away early.
  function buildPlan(n, winner, seed) {
    const rnd = mulberry32(seed || 1);
    const K = Math.max(9, Math.min(14, 7 + n));
    const seq = [];
    let prev = -1;
    for (let i = 0; i < K - 2; i++) {
      let c = 0;
      for (let g = 0; g < 24; g++) {
        c = Math.floor(rnd() * n);
        if (c !== prev && !(i >= K - 6 && c === winner)) break;
      }
      seq.push(c);
      prev = c;
    }
    let over = (winner + (rnd() < 0.5 ? 1 : n - 1)) % n;
    if (over === winner) over = (winner + 1) % n;
    seq.push(over, winner);
    const steps = seq.map((idx, i) => ({ t: smooth(i / (K - 1)), idx }));
    const egg = rnd() < CONFIG.EASTER_EGG_CHANCE ? { from: 0.28 + rnd() * 0.08, len: 0.22 } : null;
    return { steps, egg };
  }

  function roster() {
    if (typeof App !== 'undefined' && App && Array.isArray(App.currentPlayers)) return App.currentPlayers;
    if (window.PlayerApp && Array.isArray(window.PlayerApp.currentPlayers)) return window.PlayerApp.currentPlayers;
    return [];
  }

  function identityFor(state, i) {
    const id = state.segmentIds[i];
    const entry = id ? roster().find(p => String(p.id) === String(id)) : null;
    return {
      name: String(state.segments[i] || 'UNKNOWN'),
      avatar: entry && typeof entry.avatarData === 'string' ? entry.avatarData : '',
      frame: entry && /^#[0-9A-Fa-f]{6}$/.test(entry.frameColor || '') ? entry.frameColor : '#6f7885'
    };
  }

  function avatarNode(identity) {
    const wrap = document.createElement('span');
    wrap.className = 'bs-av';
    wrap.style.setProperty('--frame', identity.frame);
    const ok = identity.avatar && /^(data:image\/|assets\/|\/uploads\/|https?:\/\/)/i.test(identity.avatar);
    if (ok) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = identity.avatar;
      wrap.appendChild(img);
    } else {
      const letter = document.createElement('b');
      letter.textContent = (identity.name.trim()[0] || '?').toUpperCase();
      wrap.appendChild(letter);
    }
    return wrap;
  }

  const SVG = [
    '<svg class="bs-optics" viewBox="0 0 200 200" aria-hidden="true">',
      '<circle cx="100" cy="100" r="97" class="o-dim" />',
      '<g class="bs-spin">',
        '<circle cx="100" cy="100" r="90" class="o-ring" stroke-dasharray="140 40 60 22" />',
        '<circle cx="100" cy="100" r="93.5" class="o-arc" stroke-dasharray="46 250" />',
      '</g>',
      '<circle cx="100" cy="100" r="76" class="o-fine" />',
      '<path class="o-cross" d="M100 8 V44 M100 156 V192 M8 100 H44 M156 100 H192" />',
      '<path class="o-dash" d="M100 44 V156 M44 100 H156" />',
      '<circle cx="100" cy="100" r="13" class="o-ring o-center" />',
      '<path class="o-brk" d="M62 62 h10 M62 62 v10 M138 62 h-10 M138 62 v10 M62 138 h10 M62 138 v-10 M138 138 h-10 M138 138 v-10" />',
      '<path class="o-tick" d="M44 44 l6 6 M156 44 l-6 6 M44 156 l6 -6 M156 156 l-6 -6" />',
      '<path class="o-range" d="M82 140 h10 M108 140 h10 M82 149 h10 M108 149 h10 M82 158 h10 M108 158 h10" />',
    '</svg>'
  ].join('');

  // The overlay must sit above every column of the app (player chat/HUD live
  // in their own stacking contexts), so it is hosted directly on <body>.
  function adopt(el) {
    if (el.parentElement !== document.body) document.body.appendChild(el);
  }

  function ctxFor(id) {
    if (!contexts[id]) {
      contexts[id] = {
        id, offset: 0, state: null, handlers: {}, isGM: false,
        key: null, raf: 0, shell: null, plan: null, dismissed: null,
        autoCloseTimer: 0, stage: null, flags: {}, cands: [], reticle: null, struck: false,
        sawSpinning: false
      };
    }
    return contexts[id];
  }

  function normalize(raw) {
    const s = raw || {};
    const segments = Array.isArray(s.segments) ? s.segments : [];
    return {
      open: !!s.open,
      segments,
      segmentIds: Array.isArray(s.segmentIds) ? s.segmentIds : [],
      phase: s.phase || 'idle',
      winnerIndex: Number.isInteger(s.winnerIndex) ? s.winnerIndex : null,
      eventId: s.eventId || s.spinToken || null,
      seed: s.seed || 1,
      startedAt: Number(s.startedAt) || 0,
      durationMs: Math.max(900, Number(s.durationMs) || 9000),
      committedAt: s.committedAt || null
    };
  }

  function buildKey(st) {
    return [st.eventId || 'standby', st.segments.join('|'), st.segmentIds.join('|'), st.winnerIndex, st.startedAt].join('#');
  }

  function candPosition(i, n) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n);
    const r = n > 8 ? 0.355 : 0.335;
    return { ox: Math.cos(angle) * r, oy: Math.sin(angle) * r };
  }

  function placeCand(el, ox, oy) {
    el.style.setProperty('--ox', 'calc(var(--s) * ' + ox.toFixed(4) + ')');
    el.style.setProperty('--oy', 'calc(var(--s) * ' + oy.toFixed(4) + ')');
  }

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function setFlag(ctx, key, value) {
    if (ctx.flags[key] === value) return false;
    ctx.flags[key] = value;
    return true;
  }

  function stopLoop(ctx) {
    if (ctx.raf) { cancelAnimationFrame(ctx.raf); ctx.raf = 0; }
  }

  function clearAutoClose(ctx) {
    if (ctx.autoCloseTimer) { clearTimeout(ctx.autoCloseTimer); ctx.autoCloseTimer = 0; }
  }

  function notifyEnd(ctx) {
    try { ctx.handlers.onPresentationEnd && ctx.handlers.onPresentationEnd(); } catch (_) { /* presentation hook must never break the UI */ }
  }

  function teardown(ctx, el) {
    stopLoop(ctx);
    clearAutoClose(ctx);
    const was = ctx.key !== null || ctx.dismissed !== null;
    if (el) {
      el.classList.remove('active');
      el.innerHTML = '';
    }
    ctx.key = null; ctx.shell = null; ctx.plan = null; ctx.cands = []; ctx.reticle = null;
    ctx.stage = null; ctx.flags = {}; ctx.struck = false; ctx.sawSpinning = false;
    ctx.dismissed = null;
    if (was) notifyEnd(ctx);
  }

  function dismissLocal(ctx) {
    const st = ctx.state;
    if (!st) return;
    ctx.dismissed = st.eventId || 'standby';
    stopLoop(ctx);
    clearAutoClose(ctx);
    const el = document.getElementById(ctx.id);
    if (el) {
      el.classList.remove('active');
      el.innerHTML = '';
    }
    ctx.key = null; ctx.shell = null; ctx.flags = {}; ctx.stage = null; ctx.struck = false;
    notifyEnd(ctx);
  }

  function build(ctx, el, st) {
    stopLoop(ctx);
    clearAutoClose(ctx);
    const n = st.segments.length;
    el.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'bs-shell';
    shell.dataset.stage = 'standby';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) shell.classList.add('bs-reduced');
    shell.innerHTML = [
      '<div class="bs-hud-top"><span class="bs-brand">THE BLOOD SCOPE</span><span class="bs-brand-sub">SHADOW BROKER // TARGETING SYSTEM</span></div>',
      '<div class="bs-stage"><div class="bs-lens">',
        SVG,
        '<div class="bs-ring"></div>',
        '<div class="bs-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>',
        '<div class="bs-broker" hidden></div>',
        '<div class="bs-fracture" aria-hidden="true"></div>',
        '<div class="bs-denied" hidden><b>ACCESS DENIED</b><span>ENTITY PROTECTED</span></div>',
      '</div></div>',
      '<div class="bs-readout" role="status" aria-live="polite">',
        '<div class="bs-status"></div><div class="bs-name"></div><div class="bs-subline"></div>',
      '</div>',
      '<div class="bs-flash" aria-hidden="true"></div>',
      '<div class="bs-result" hidden></div>',
      '<div class="bs-controls"></div>',
      '<button type="button" class="bs-close" aria-label="Close" hidden>✕</button>'
    ].join('');
    el.appendChild(shell);

    const ring = shell.querySelector('.bs-ring');
    ctx.cands = [];
    for (let i = 0; i < n; i++) {
      const ident = identityFor(st, i);
      const cand = document.createElement('div');
      cand.className = 'bs-cand';
      cand.appendChild(avatarNode(ident));
      const label = document.createElement('em');
      label.textContent = ident.name;
      cand.appendChild(label);
      const pos = candPosition(i, n);
      cand.dataset.ox = pos.ox; cand.dataset.oy = pos.oy;
      placeCand(cand, pos.ox, pos.oy);
      ring.appendChild(cand);
      ctx.cands.push(cand);
    }
    const brokerBox = shell.querySelector('.bs-broker');
    const brokerImg = document.createElement('img');
    brokerImg.alt = '';
    brokerImg.src = CONFIG.BROKER_AVATAR;
    brokerBox.appendChild(brokerImg);
    placeCand(brokerBox, 0, -0.43);

    ctx.reticle = shell.querySelector('.bs-reticle');
    placeCand(ctx.reticle, 0, 0);
    ctx.shell = shell;
    ctx.key = buildKey(st);
    ctx.flags = {};
    ctx.stage = null;
    ctx.struck = false;
    ctx.plan = st.winnerIndex != null && n > 0 ? buildPlan(n, st.winnerIndex, st.seed) : null;
    ctx.sawSpinning = st.phase === 'spinning';

    shell.querySelector('.bs-close').addEventListener('click', () => dismissLocal(ctx));
  }

  function buildResult(ctx, st) {
    const box = ctx.shell.querySelector('.bs-result');
    if (box.dataset.built === (st.eventId || '')) return;
    box.dataset.built = st.eventId || '';
    const ident = identityFor(st, st.winnerIndex);
    box.innerHTML = '';
    const kicker = document.createElement('div');
    kicker.className = 'bs-res-kicker';
    kicker.textContent = '☠ TARGET ELIMINATED';
    const portrait = document.createElement('div');
    portrait.className = 'bs-res-portrait';
    portrait.appendChild(avatarNode(ident));
    const name = document.createElement('div');
    name.className = 'bs-res-name';
    name.textContent = ident.name;
    const sentence = document.createElement('div');
    sentence.className = 'bs-res-sentence';
    sentence.textContent = 'BLOOD TRIBUTE REQUIRED';
    const quote = document.createElement('div');
    quote.className = 'bs-res-quote';
    quote.textContent = '“Fate has selected its offering. The Shadow Broker awaits payment.”';
    const src = document.createElement('div');
    src.className = 'bs-res-src';
    src.textContent = 'SOURCE: BLOOD SCOPE';
    box.append(kicker, portrait, name, sentence, quote, src);
  }

  function hot(ctx, idx) {
    if (!setFlag(ctx, 'hot', idx)) return;
    ctx.cands.forEach((c, i) => c.classList.toggle('is-hot', i === idx));
  }

  // Idempotent: derives the whole picture from (state, clock). Returns true
  // while the animation still has frames to draw.
  function paint(ctx) {
    const st = ctx.state;
    const shell = ctx.shell;
    if (!st || !shell) return false;
    const status = shell.querySelector('.bs-status');
    const nameEl = shell.querySelector('.bs-name');
    const sub = shell.querySelector('.bs-subline');
    const denied = shell.querySelector('.bs-denied');
    const broker = shell.querySelector('.bs-broker');
    const winnerName = st.winnerIndex != null ? String(st.segments[st.winnerIndex] || '').toUpperCase() : '';
    let stage = 'standby';
    let f = 0;

    if (st.phase !== 'idle' && st.winnerIndex != null) {
      const elapsed = Date.now() + ctx.offset - (st.startedAt || Date.now());
      f = elapsed / st.durationMs;
      if (st.phase === 'spinning') ctx.sawSpinning = true;
      if (st.phase === 'result' && (!ctx.sawSpinning || f >= 1)) stage = 'result';
      else if (f < CONFIG.INIT_END) stage = 'init';
      else if (f < CONFIG.HUNT_END) stage = 'hunt';
      else if (f < CONFIG.LOCK_END) stage = 'lock';
      else stage = 'strike';
    }

    if (setFlag(ctx, 'stage', stage)) {
      shell.dataset.stage = stage;
      if (stage === 'init' || stage === 'hunt') {
        shell.classList.remove('is-glitch'); void shell.offsetWidth; shell.classList.add('is-glitch');
      }
    }

    if (stage === 'standby') {
      setText(status, 'BLOOD SCOPE ARMED');
      setText(nameEl, '');
      setText(sub, ctx.isGM ? 'AWAITING YOUR ORDER' : 'AWAITING THE SHADOW BROKER');
      hot(ctx, -1);
      return false;
    }

    if (stage === 'init') {
      setText(status, 'TARGET ACQUISITION');
      setText(nameEl, '');
      setText(sub, 'SCANNING...');
      hot(ctx, -1);
      return true;
    }

    if (stage === 'hunt') {
      const u = (f - CONFIG.INIT_END) / (CONFIG.HUNT_END - CONFIG.INIT_END);
      const egg = ctx.plan && ctx.plan.egg;
      const inEgg = !!egg && u >= egg.from && u < egg.from + egg.len;
      if (setFlag(ctx, 'egg', inEgg)) {
        denied.hidden = !inEgg;
        broker.hidden = !inEgg;
        shell.classList.toggle('is-denied', inEgg);
        if (inEgg) placeCand(ctx.reticle, 0, -0.43);
        else ctx.flags.cur = undefined; // force the reticle back onto a candidate
      }
      if (inEgg) {
        setText(status, 'ENTITY DETECTED');
        setText(nameEl, 'SHADOW BROKER');
        setText(sub, 'ACCESS DENIED');
        hot(ctx, -1);
        return true;
      }
      let cur = ctx.plan.steps[0].idx;
      for (const s of ctx.plan.steps) { if (u >= s.t) cur = s.idx; else break; }
      if (setFlag(ctx, 'cur', cur)) {
        const c = ctx.cands[cur];
        placeCand(ctx.reticle, Number(c.dataset.ox), Number(c.dataset.oy));
      }
      hot(ctx, cur);
      setText(status, 'SIGNAL DETECTED');
      setText(nameEl, String(st.segments[cur] || '').toUpperCase());
      setText(sub, 'SCANNING...');
      return true;
    }

    // lock / strike / result all converge on the server's winner
    if (setFlag(ctx, 'locked', true)) {
      denied.hidden = true; broker.hidden = true; shell.classList.remove('is-denied');
      placeCand(ctx.reticle, 0, 0);
      ctx.cands.forEach((c, i) => {
        c.classList.toggle('is-locked', i === st.winnerIndex);
        c.classList.toggle('is-dimmed', i !== st.winnerIndex);
        c.classList.remove('is-hot');
        if (i === st.winnerIndex) placeCand(c, 0, 0);
      });
    }
    setText(nameEl, winnerName);

    if (stage === 'lock') {
      const g = (f - CONFIG.HUNT_END) / (CONFIG.LOCK_END - CONFIG.HUNT_END);
      setText(status, g < 0.18 ? 'IDENTITY VERIFIED' : g < 0.42 ? 'LOCKING TARGET...' : g < 0.6 ? 'TARGET CONFIRMED' : 'TARGET ACQUIRED');
      setText(sub, g < 0.6 ? '' : 'ESCAPE PROBABILITY: 0%');
      shell.classList.toggle('is-confirmed', g >= 0.42);
      return true;
    }

    setText(status, 'TARGET ACQUIRED');
    setText(sub, 'ESCAPE PROBABILITY: 0%');
    shell.classList.add('is-confirmed');

    if (stage === 'strike') {
      const s = (f - CONFIG.LOCK_END) / (1 - CONFIG.LOCK_END);
      if (!ctx.struck) { ctx.struck = true; shell.classList.add('is-struck'); }
      if (s >= 0.18) shell.classList.add('is-fractured');
      if (s >= 0.62) shell.classList.add('is-signal-loss');
      return true;
    }

    // result
    shell.classList.add('is-struck', 'is-fractured', 'is-signal-loss');
    buildResult(ctx, st);
    if (setFlag(ctx, 'resultShown', true)) {
      shell.querySelector('.bs-result').hidden = false;
      shell.querySelector('.bs-close').hidden = false;
      clearAutoClose(ctx);
      ctx.autoCloseTimer = setTimeout(() => dismissLocal(ctx), CONFIG.RESULT_AUTOCLOSE_MS);
    }
    return false;
  }

  function loop(ctx) {
    ctx.raf = 0;
    if (!ctx.shell) return;
    if (paint(ctx)) ctx.raf = requestAnimationFrame(() => loop(ctx));
  }

  function renderControls(ctx, st) {
    const controls = ctx.shell && ctx.shell.querySelector('.bs-controls');
    if (!controls) return;
    const id = ctx.id;
    const sig = ctx.isGM ? st.phase : 'player';
    if (controls.dataset.sig === sig) return;
    controls.dataset.sig = sig;
    controls.innerHTML = '';
    if (!ctx.isGM) return;
    const mk = (cls, domId, text, handler, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bs-btn ' + cls;
      b.id = domId;
      b.textContent = text;
      if (disabled) b.disabled = true;
      if (handler) b.addEventListener('click', () => handler());
      controls.appendChild(b);
    };
    const h = ctx.handlers || {};
    if (st.phase === 'idle') {
      mk('bs-btn-primary', id + '-roll-btn', 'ACTIVATE BLOOD SCOPE', h.onRoll);
      mk('bs-btn-ghost', id + '-close-btn', 'CANCEL', h.onClose);
    } else if (st.phase === 'spinning') {
      mk('bs-btn-primary', id + '-roll-btn', 'TARGET ACQUISITION', null, true);
      mk('bs-btn-danger', id + '-close-btn', 'ABORT ACQUISITION', h.onClose);
    } else {
      mk('bs-btn-primary', id + '-view-btn', 'VIEW TRIBUTE', h.onViewTribute);
      mk('bs-btn-ghost', id + '-close-btn', 'CLOSE FOR ALL', h.onClose);
    }
  }

  return {
    CONFIG,

    init(containerId) {
      const el = document.getElementById(containerId);
      if (!el) return;
      adopt(el);
      const ctx = ctxFor(containerId);
      teardown(ctx, el);
    },

    // isGM: draw controls. handlers: { onRoll, onClose, onViewTribute, onPresentationEnd }.
    // serverTs: ISO timestamp of the state packet, used to align local clocks.
    update(containerId, wheelState, isGM, handlers, serverTs) {
      const el = document.getElementById(containerId);
      if (!el) return;
      adopt(el);
      const ctx = ctxFor(containerId);
      const st = normalize(wheelState);
      const ts = serverTs ? Date.parse(serverTs) : NaN;
      if (Number.isFinite(ts)) ctx.offset = ts - Date.now();
      ctx.handlers = handlers || {};
      ctx.isGM = !!isGM;
      ctx.state = st;

      if (!st.open || st.segments.length === 0) {
        if (ctx.key !== null || ctx.dismissed !== null || el.classList.contains('active')) teardown(ctx, el);
        return;
      }
      if (ctx.dismissed && ctx.dismissed === (st.eventId || 'standby')) {
        el.classList.remove('active');
        return;
      }
      // A different event than the locally dismissed one re-opens the scope.
      ctx.dismissed = null;

      el.classList.add('active');
      if (ctx.key !== buildKey(st)) build(ctx, el, st);
      renderControls(ctx, st);
      stopLoop(ctx);
      loop(ctx);
    },

    // True while this client is still showing a live (non-standby) ritual or
    // its result. The selected player's own tribute prompt waits for this.
    isPresenting(containerId) {
      const ctx = contexts[containerId || 'wheel-overlay'];
      if (!ctx || !ctx.state || !ctx.state.open) return false;
      if (ctx.state.phase === 'idle') return false;
      return ctx.dismissed !== (ctx.state.eventId || 'standby');
    },

    // Test/diagnostic hook: the deterministic hunt plan for given inputs.
    _plan: buildPlan
  };
})();

window.Wheel = Wheel;
window.BloodScope = Wheel;

// BLOOD TRIBUTE PENDING marker -- a small crimson target beside the selected
// player's identity in the roster/leaderboard. It mirrors the authoritative
// pending demand (state:public.bloodTribute), so it survives refresh and
// reconnect and disappears the moment the debt is paid or released.
window.BloodScopeMarks = (() => {
  let target = null;
  let observing = false;

  function apply() {
    document.querySelectorAll('.bs-mark').forEach(mark => {
      const host = mark.closest('[data-player-id]');
      if (!target || !host || host.dataset.playerId !== target) mark.remove();
    });
    if (!target) return;
    document.querySelectorAll('.pl-entry[data-player-id], .mp-player[data-player-id]').forEach(row => {
      if (row.dataset.playerId !== target || row.querySelector('.bs-mark')) return;
      const mark = document.createElement('i');
      mark.className = 'bs-mark';
      mark.title = 'BLOOD TRIBUTE PENDING';
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', 'Blood tribute pending');
      const nameEl = row.querySelector('.pl-entry-name, .mp-player-name');
      if (nameEl && row.classList.contains('pl-entry')) nameEl.after(mark);
      else (nameEl || row).appendChild(mark);
    });
  }

  function observe() {
    if (observing) return;
    const hosts = ['player-leaderboard-list', 'mp-player-list'].map(id => document.getElementById(id)).filter(Boolean);
    if (!hosts.length) return;
    observing = true;
    const mo = new MutationObserver(() => apply());
    hosts.forEach(h => mo.observe(h, { childList: true }));
  }

  return {
    setTarget(demand) {
      const live = demand && demand.status === 'required' && demand.sourceLabel === 'BLOOD SCOPE';
      target = live ? String(demand.playerId) : null;
      observe();
      apply();
    }
  };
})();
