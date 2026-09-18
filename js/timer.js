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
// only displays the countdown and lets the GM start/pause/resume it -- it
// never fails the Final and never touches WOMF. TIME EXPIRED is purely a
// display state; what happens next is entirely up to the GM, off-screen.
const Timer = {
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
  },

  // isGM: whether to draw START GAME/PAUSE/RESUME (players never get them).
  // handlers: { onStart, onPause, onResume } click callbacks, GM-only.
  update(containerId, timerState, isGM, handlers) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const state = timerState || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 };
    const phase = state.phase || 'ready';
    const inBorrowed = phase === 'borrowed' || phase === 'borrowed_paused';

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
      controls.innerHTML = `
        <button type="button" class="toolbar-btn primary timer-start-btn" ${phase === 'ready' ? '' : 'style="display:none;"'}>START GAME</button>
        <button type="button" class="toolbar-btn timer-pause-btn" ${(phase === 'running' || phase === 'borrowed') ? '' : 'style="display:none;"'}>PAUSE</button>
        <button type="button" class="toolbar-btn timer-resume-btn" ${(phase === 'paused' || phase === 'borrowed_paused') ? '' : 'style="display:none;"'}>RESUME</button>
      `;
      const startBtn = controls.querySelector('.timer-start-btn');
      const pauseBtn = controls.querySelector('.timer-pause-btn');
      const resumeBtn = controls.querySelector('.timer-resume-btn');
      if (startBtn && handlers && handlers.onStart) startBtn.onclick = handlers.onStart;
      if (pauseBtn && handlers && handlers.onPause) pauseBtn.onclick = handlers.onPause;
      if (resumeBtn && handlers && handlers.onResume) resumeBtn.onclick = handlers.onResume;
    } else if (controls) {
      controls.innerHTML = '';
    }
  }
};

window.Timer = Timer;
