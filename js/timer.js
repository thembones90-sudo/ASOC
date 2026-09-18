// TIMER + BORROWED TIME -- purely a rendering module, same philosophy as
// womf.js/wheel.js: the authoritative { phase, duration, remaining,
// borrowedDuration, borrowedRemaining } always comes from the server via
// state:public. This module never runs its own countdown or invents a
// number -- every number on screen is read straight from what it's given,
// each time it's given it, so GM and every player are always looking at
// the exact same clock.
//
// Two SEPARATE bars are drawn (.timer-bar-normal / .timer-bar-borrowed) --
// Borrowed Time is a distinct emergency reserve, never a refill of the
// normal bar, so the normal bar empties and stays empty while the
// Borrowed Time bar (its own fill, its own red/purple palette) takes over.
//
// Per the locked Timer spec, this module (and the server logic behind it)
// only displays the countdown and lets the GM start/pause/resume/adjust it
// -- it never fails the Final and never touches WOMF. TIME EXPIRED is
// purely a display state; what happens next is entirely up to the GM,
// off-screen.
//
// Two purely-visual, client-local additions live in this module too (no
// server involvement, no new phase):
//   1. A brief 3-2-1 flash before START GAME actually sends gm:timerStart
//      -- see runStartCountdown(). The server's timer stays in 'ready'
//      the whole time; nothing is broadcast differently, so every client
//      is unaffected until the real start command goes out.
//   2. A brief "BORROWED TIME" banner the instant a container's rendered
//      phase transitions INTO 'borrowed' -- see the phase-transition check
//      inside update(). Because update() is the one shared function GM,
//      GM Public View, and every player already call on every broadcast,
//      detecting the transition here (keyed per containerId) makes the
//      banner appear identically on all three surfaces for free, with no
//      new server state and no per-surface wiring.
const Timer = {
  // Per-containerId bookkeeping for the two visual-only additions above.
  // Neither of these is ever read as authoritative game state -- they only
  // ever decide whether to play a LOCAL one-shot animation.
  _lastPhase: {},
  _countdownActive: {},

  formatTime(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  // Ratio-based bucket for the NORMAL bar's calm -> warning -> danger
  // color progression. Borrowed Time has its own fixed emergency palette
  // (see CSS) and doesn't use this.
  classify(ratio) {
    if (ratio <= 0.10) return 'danger';
    if (ratio <= 0.25) return 'warning';
    return 'calm';
  },

  statusLabel(phase) {
    switch (phase) {
      case 'ready': return 'READY';
      case 'running': return 'TIME REMAINING';
      case 'paused': return 'PAUSED';
      case 'borrowed': return 'BORROWED TIME';
      case 'borrowed_paused': return 'BORROWED TIME — PAUSED';
      case 'expired': return 'TIME EXPIRED';
      case 'stopped': return 'STOPPED';
      default: return '';
    }
  },

  shellHTML() {
    return `
      <div class="timer-label">TIMER</div>
      <div class="timer-bars">
        <div class="timer-bar-track timer-bar-track-normal">
          <div class="timer-bar timer-bar-normal"></div>
        </div>
        <div class="timer-bar-track timer-bar-track-borrowed">
          <div class="timer-bar timer-bar-borrowed"></div>
        </div>
      </div>
      <div class="timer-count">00:00</div>
      <div class="timer-status">READY</div>
      <div class="timer-controls"></div>
    `;
  },

  init(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = this.shellHTML();
    el.dataset.phase = 'ready';
    el.dataset.level = 'calm';
    el.dataset.mode = 'normal';
    const normalBar = el.querySelector('.timer-bar-normal');
    if (normalBar) normalBar.style.width = '100%';
    // Deliberately NOT seeding _lastPhase here -- see the borrowed-banner
    // check below for why the FIRST real update() must be able to tell
    // "just joined/loaded, already in some phase" apart from "just
    // transitioned into it".
  },

  // isGM: whether to draw START GAME/PAUSE/RESUME/-30s/+30s (players never
  // get them). handlers: { onStart, onPause, onResume, onAdjust } click
  // callbacks, GM-only. onAdjust receives a signed ms delta.
  update(containerId, timerState, isGM, handlers) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const state = timerState || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 };
    const phase = state.phase || 'ready';
    const inBorrowed = phase === 'borrowed' || phase === 'borrowed_paused';

    // BORROWED TIME CALLOUT: fire exactly on a fresh transition INTO
    // 'borrowed' -- i.e. the previous phase we rendered here was neither
    // 'borrowed' nor 'borrowed_paused'. A resume from borrowed_paused back
    // to borrowed does NOT refire (prevPhase would already be
    // 'borrowed_paused'), and a client whose very first update() ever
    // already shows 'borrowed' (e.g. a player joining mid-Borrowed-Time)
    // does NOT fire either, since prevPhase is undefined, not a real prior
    // phase. Recorded before any early return so a second update() call
    // during the same broadcast burst can never double-fire.
    const prevPhase = this._lastPhase[containerId];
    if (phase === 'borrowed' && prevPhase && prevPhase !== 'borrowed' && prevPhase !== 'borrowed_paused') {
      this._flashBorrowedBanner(el);
    }
    this._lastPhase[containerId] = phase;

    el.dataset.phase = phase;
    el.dataset.mode = inBorrowed ? 'borrowed' : 'normal';

    const normalRatio = state.duration > 0 ? Math.max(0, Math.min(1, state.remaining / state.duration)) : 1;
    const borrowedRatio = state.borrowedDuration > 0 ? Math.max(0, Math.min(1, state.borrowedRemaining / state.borrowedDuration)) : 1;

    const normalBar = el.querySelector('.timer-bar-normal');
    if (normalBar) normalBar.style.width = `${(phase === 'expired' || phase === 'stopped' ? (inBorrowed ? 0 : normalRatio) : normalRatio) * 100}%`;

    const borrowedBar = el.querySelector('.timer-bar-borrowed');
    if (borrowedBar) borrowedBar.style.width = `${(phase === 'expired' ? 0 : borrowedRatio) * 100}%`;

    const level = this.classify(normalRatio);
    el.dataset.level = level;
    el.classList.toggle('timer-critical', phase === 'running' && state.remaining > 0 && state.remaining <= 60000);
    el.classList.toggle('timer-borrowed-critical', phase === 'borrowed' && state.borrowedRemaining > 0 && state.borrowedRemaining <= 30000);

    const countEl = el.querySelector('.timer-count');
    if (countEl) {
      countEl.textContent = inBorrowed
        ? this.formatTime(state.borrowedRemaining)
        : this.formatTime(phase === 'ready' ? state.duration : state.remaining);
    }

    const statusEl = el.querySelector('.timer-status');
    if (statusEl) statusEl.textContent = this.statusLabel(phase);

    const controls = el.querySelector('.timer-controls');
    if (controls && isGM) {
      const adjustable = phase === 'running' || phase === 'paused' || phase === 'borrowed' || phase === 'borrowed_paused';
      const launching = !!this._countdownActive[containerId];
      controls.innerHTML = `
        <button type="button" class="toolbar-btn primary timer-start-btn" ${(phase === 'ready' && !launching) ? '' : 'style="display:none;"'}>START GAME</button>
        <button type="button" class="toolbar-btn timer-pause-btn" ${(phase === 'running' || phase === 'borrowed') ? '' : 'style="display:none;"'}>PAUSE</button>
        <button type="button" class="toolbar-btn timer-resume-btn" ${(phase === 'paused' || phase === 'borrowed_paused') ? '' : 'style="display:none;"'}>RESUME</button>
        <span class="timer-adjust-group" ${adjustable ? '' : 'style="display:none;"'}>
          <button type="button" class="toolbar-btn timer-adjust-btn timer-adjust-minus" title="Subtract 30 seconds">-30s</button>
          <button type="button" class="toolbar-btn timer-adjust-btn timer-adjust-plus" title="Add 30 seconds">+30s</button>
        </span>
      `;
      const startBtn = controls.querySelector('.timer-start-btn');
      const pauseBtn = controls.querySelector('.timer-pause-btn');
      const resumeBtn = controls.querySelector('.timer-resume-btn');
      const minusBtn = controls.querySelector('.timer-adjust-minus');
      const plusBtn = controls.querySelector('.timer-adjust-plus');
      // START GAME never calls onStart directly -- it always goes through
      // the local 3-2-1 sequence first, which itself calls onStart only
      // once the sequence completes. See runStartCountdown().
      if (startBtn && handlers && handlers.onStart) {
        startBtn.onclick = () => this.runStartCountdown(containerId, handlers.onStart);
      }
      if (pauseBtn && handlers && handlers.onPause) pauseBtn.onclick = handlers.onPause;
      if (resumeBtn && handlers && handlers.onResume) resumeBtn.onclick = handlers.onResume;
      if (minusBtn && handlers && handlers.onAdjust) minusBtn.onclick = () => handlers.onAdjust(-30000);
      if (plusBtn && handlers && handlers.onAdjust) plusBtn.onclick = () => handlers.onAdjust(30000);
    } else if (controls) {
      controls.innerHTML = '';
    }
  },

  // Local-only "launch" flourish: shows 3, 2, 1 (one per ~500ms) directly
  // over the timer HUD, THEN calls onComplete (which is what actually
  // sends gm:timerStart to the server). Nothing about the server's timer
  // state changes during this window -- it's still sitting in 'ready' the
  // whole time. Re-entrant clicks while a sequence is already running for
  // this containerId are ignored outright, which is what prevents a
  // repeatedly-clicked START GAME from ever queuing up more than one
  // countdown (and therefore more than one eventual gm:timerStart).
  runStartCountdown(containerId, onComplete) {
    if (this._countdownActive[containerId]) return;
    const el = document.getElementById(containerId);
    if (!el) return;

    this._countdownActive[containerId] = true;
    el.classList.add('timer-launching');
    // Re-render controls immediately so the START button hides for the
    // duration of the countdown even though `phase` itself hasn't changed.
    const startBtn = el.querySelector('.timer-start-btn');
    if (startBtn) startBtn.style.display = 'none';

    const steps = ['3', '2', '1'];
    const STEP_MS = 500;
    let i = 0;

    const showStep = () => {
      if (i < steps.length) {
        this._flashCountdownDigit(el, steps[i]);
        i++;
        setTimeout(showStep, STEP_MS);
      } else {
        this._clearCountdownOverlay(el);
        el.classList.remove('timer-launching');
        delete this._countdownActive[containerId];
        onComplete();
      }
    };
    showStep();
  },

  _flashCountdownDigit(el, text) {
    let overlay = el.querySelector('.timer-countdown-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'timer-countdown-overlay';
      el.appendChild(overlay);
    }
    overlay.textContent = text;
    // Restart the CSS animation on every digit swap.
    overlay.classList.remove('timer-countdown-pulse');
    void overlay.offsetWidth; // force reflow so the animation replays
    overlay.classList.add('timer-countdown-pulse');
  },

  _clearCountdownOverlay(el) {
    const overlay = el.querySelector('.timer-countdown-overlay');
    if (overlay) overlay.remove();
  },

  // Brief "BORROWED TIME" banner over the timer HUD -- purely decorative,
  // never touches the timer bars/state, and removes itself automatically
  // (matches the CSS animation's own duration below).
  _flashBorrowedBanner(el) {
    const existing = el.querySelector('.timer-borrowed-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.className = 'timer-borrowed-banner';
    banner.textContent = 'BORROWED TIME';
    el.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 2000);
  }
};

window.Timer = Timer;
