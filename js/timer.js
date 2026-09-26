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
//   1. A full-screen T-10 -> T-1 launch countdown before START GAME
//      actually sends gm:timerStart -- see runStartCountdown(). The
//      server's timer stays in 'ready' the whole time, so no game time is
//      consumed until the launch sequence reaches zero.
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
      <div class="timer-identity">
        <span class="timer-kicker">CHRONO CONTROL</span>
        <div class="timer-label">TIMER</div>
      </div>
      <div class="timer-core">
        <div class="timer-readout">
          <div class="timer-count">00:00</div>
          <div class="timer-status">READY</div>
        </div>
        <div class="timer-fuse-wrap">
          <div class="timer-fuse" aria-hidden="true">
            <div class="timer-fuse-cord"></div>
            <div class="timer-fuse-burned"></div>
            <div class="timer-fuse-live"></div>
            <div class="timer-fuse-tip">
              <span class="timer-fuse-core"></span>
              <span class="timer-fuse-spark spark-a"></span>
              <span class="timer-fuse-spark spark-b"></span>
              <span class="timer-fuse-spark spark-c"></span>
            </div>
          </div>
          <div class="timer-scale"><span data-timer-stage="ignition">IGNITION</span><span data-timer-stage="fuse-burn">FUSE BURN</span><span data-timer-stage="detonation">DETONATION</span></div>
        </div>
      </div>
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
    el.style.setProperty('--fuse-progress', '0');
    // Deliberately NOT seeding _lastPhase here -- see the borrowed-banner
    // check below for why the FIRST real update() must be able to tell
    // "just joined/loaded, already in some phase" apart from "just
    // transitioned into it".
  },

  // isGM: whether to draw START GAME/PAUSE/RESUME/-30s/+30s (players never
  // get them). handlers: { onStart, onLaunch, onPause, onResume, onAdjust }
  // callbacks, GM-only. onLaunch announces the theatrical T-10 sequence to
  // connected players; onStart is still sent only when the local countdown
  // completes. onAdjust receives a signed ms delta.
  update(containerId, timerState, isGM, handlers) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const state = timerState || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 };
    const phase = state.phase || 'ready';
    window.AsocAudio?.syncTimerPhase?.(phase);
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
    const activeRatio = inBorrowed ? borrowedRatio : normalRatio;
    const fuseProgress = phase === 'expired' ? 1 : Math.max(0, Math.min(1, 1 - activeRatio));
    const timerStage = phase === 'ready' || fuseProgress < 0.32
      ? 'ignition'
      : (fuseProgress < 0.72 ? 'fuse-burn' : 'detonation');

    el.style.setProperty('--fuse-progress', String(fuseProgress));
    el.style.setProperty('--fuse-progress-pct', `${fuseProgress * 100}%`);
    el.dataset.stage = timerStage;
    const stageOrder = ['ignition', 'fuse-burn', 'detonation'];
    const activeStageIndex = stageOrder.indexOf(timerStage);
    el.querySelectorAll('[data-timer-stage]').forEach((marker) => {
      const markerIndex = stageOrder.indexOf(marker.dataset.timerStage);
      marker.classList.toggle('active', markerIndex === activeStageIndex);
      marker.classList.toggle('passed', markerIndex < activeStageIndex);
    });

    const level = this.classify(normalRatio);
    el.dataset.level = level;
    el.classList.toggle('timer-critical', phase === 'running' && state.remaining > 0 && state.remaining <= 60000);
    el.classList.toggle('timer-borrowed-critical', phase === 'borrowed' && state.borrowedRemaining > 0 && state.borrowedRemaining <= 30000);
    el.classList.toggle('timer-paused', phase === 'paused' || phase === 'borrowed_paused');

    const countEl = el.querySelector('.timer-count');
    if (countEl) {
      const text = inBorrowed
        ? this.formatTime(state.borrowedRemaining)
        : this.formatTime(phase === 'ready' ? state.duration : state.remaining);
      if (countEl.textContent !== text) countEl.textContent = text;
    }

    const statusEl = el.querySelector('.timer-status');
    const statusText = this.statusLabel(phase);
    if (statusEl && statusEl.textContent !== statusText) statusEl.textContent = statusText;

    const controls = el.querySelector('.timer-controls');
    if (controls && isGM) {
      const adjustable = phase === 'running' || phase === 'paused' || phase === 'borrowed' || phase === 'borrowed_paused';
      const launching = !!this._countdownActive[containerId];
      // SUMMON RITUAL gate: cosmetic lock only -- see ritual.js's
      // isBlockingStart() and the authoritative server-side check inside
      // handleTimerStart/handleTimerLaunchCountdown, which is what actually
      // rejects the request even if this button were somehow bypassed.
      const ritualLocked = !!window.Ritual?.isBlockingStart?.();
      // Built ONCE, then only the bits that changed are touched. This runs on
      // every state:public (at least once a second); rebuilding the buttons
      // each time replaced PAUSE / RESUME / +-30s under the GM's cursor, so a
      // click could be lost and hover states flickered.
      el._timerHandlers = handlers || {};
      if (controls.dataset.built !== '1') {
        controls.innerHTML = `
          <button type="button" class="toolbar-btn primary timer-start-btn">START GAME</button>
          <button type="button" class="toolbar-btn timer-pause-btn">PAUSE</button>
          <button type="button" class="toolbar-btn timer-resume-btn">RESUME</button>
          <span class="timer-adjust-group">
            <button type="button" class="toolbar-btn timer-adjust-btn timer-adjust-minus" title="Subtract 30 seconds">-30s</button>
            <button type="button" class="toolbar-btn timer-adjust-btn timer-adjust-plus" title="Add 30 seconds">+30s</button>
          </span>
        `;
        controls.dataset.built = '1';
        const current = () => el._timerHandlers || {};
        // START GAME never calls onStart directly -- it always goes through
        // the local T-10 launch sequence first, which itself calls onStart
        // only once the countdown completes. See runStartCountdown().
        controls.querySelector('.timer-start-btn').onclick = () => {
          const h = current();
          if (!h.onStart) return;
          if (h.onLaunch) h.onLaunch();
          this.runStartCountdown(containerId, h.onStart);
        };
        controls.querySelector('.timer-pause-btn').onclick = () => current().onPause?.();
        controls.querySelector('.timer-resume-btn').onclick = () => current().onResume?.();
        controls.querySelector('.timer-adjust-minus').onclick = () => current().onAdjust?.(-30000);
        controls.querySelector('.timer-adjust-plus').onclick = () => current().onAdjust?.(30000);
      }
      const show = (node, visible) => {
        const want = visible ? '' : 'none';
        if (node && node.style.display !== want) node.style.display = want;
      };
      const startBtn = controls.querySelector('.timer-start-btn');
      show(startBtn, phase === 'ready' && !launching);
      if (startBtn.disabled !== ritualLocked) startBtn.disabled = ritualLocked;
      const startLabel = ritualLocked ? 'START GAME // RITUAL LOCKED' : 'START GAME';
      if (startBtn.textContent !== startLabel) startBtn.textContent = startLabel;
      show(controls.querySelector('.timer-pause-btn'), phase === 'running' || phase === 'borrowed');
      show(controls.querySelector('.timer-resume-btn'), phase === 'paused' || phase === 'borrowed_paused');
      show(controls.querySelector('.timer-adjust-group'), adjustable);
    } else if (controls && controls.innerHTML !== '') {
      controls.innerHTML = '';
      delete controls.dataset.built;
    }
  },

  // Local-only launch sequence: shows a full-screen T-10 -> T-1
  // countdown before the real gm:timerStart is sent. The server's timer
  // remains in 'ready' for the entire ten-second arming sequence, so no
  // authoritative game time is consumed before BATTLE CONTROLS ONLINE.
  // Re-entrant clicks are ignored so START GAME can never queue multiple
  // countdowns or duplicate timer-start commands.
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

    const steps = Array.from({ length: 10 }, (_, i) => 10 - i);
    const STEP_MS = 1000;
    let i = 0;

    const showStep = () => {
      if (i < steps.length) {
        window.AsocAudio?.countdown?.(steps[i]);
        this._flashCountdownDigit(el, steps[i]);
        i++;
        setTimeout(showStep, STEP_MS);
      } else {
        this._clearCountdownOverlay(el);
        el.classList.remove('timer-launching');
        delete this._countdownActive[containerId];
        if (typeof onComplete === 'function') onComplete();
      }
    };
    showStep();
  },

  _flashCountdownDigit(el, text) {
    let overlay = document.getElementById('battle-launch-countdown');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'battle-launch-countdown';
      overlay.className = 'battle-launch-countdown';
      overlay.innerHTML = `
        <div class="battle-launch-scan"></div>
        <div class="battle-launch-copy">
          <div class="battle-launch-kicker">[ ASOC BATTLE LINK INITIALIZATION ]</div>
          <div class="battle-launch-time"></div>
          <div class="battle-launch-status">WEAPONS FREE ON ZERO</div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const time = overlay.querySelector('.battle-launch-time');
    if (time) time.textContent = `T-${text}`;

    overlay.classList.remove('battle-launch-pulse');
    void overlay.offsetWidth;
    overlay.classList.add('battle-launch-pulse');
  },

  _clearCountdownOverlay() {
    const overlay = document.getElementById('battle-launch-countdown');
    if (!overlay) return;
    overlay.classList.add('battle-launch-out');
    setTimeout(() => overlay.remove(), 220);
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
