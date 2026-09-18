// WHEEL OF MISFORTUNE -- the actual spin interface OPEN WOMF reveals once
// armed at 10/10. Purely a rendering module, same philosophy as womf.js:
// the authoritative { open, segments, phase, winnerIndex, spinToken }
// always comes from the server via state:public -- this module only ever
// reflects what it's given, it never invents a winner or a countdown of
// its own.
//
// Every client (GM and every player) computes the SAME landing rotation
// from (segments.length, winnerIndex), so the spin animation lands on the
// same name everywhere without needing millisecond-precise sync -- only
// the moment a client RECEIVES the 'spinning' broadcast can differ
// slightly, which is invisible over a multi-second spin.
//
// Per the locked WOMF spec, this module (and the server logic behind it)
// only opens the wheel, lets the GM roll it once, and reports who it
// landed on. It never resets the WOMF charge and never invents any
// punishment/consequence logic -- what happens to the name it lands on is
// entirely up to the GM, off-screen.
const Wheel = {
  _lastSpinToken: {},
  _lastSegKey: {},

  SPIN_DURATION_S: 4.2,
  SPIN_TURNS: 6,

  PALETTE: ['#c8d0e0', '#9a4a8a', '#c86a6a', '#6a7a9a', '#8a8fa0', '#4a4a5a'],

  shellHTML() {
    return `
      <div class="wheel-shell">
        <div class="wheel-title">WHEEL OF MISFORTUNE</div>
        <div class="wheel-stage">
          <div class="wheel-pointer"></div>
          <div class="wheel-dial"></div>
        </div>
        <div class="wheel-result" data-empty="true"></div>
        <div class="wheel-controls"></div>
      </div>
    `;
  },

  init(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = this.shellHTML();
    this._lastSpinToken[containerId] = null;
    this._lastSegKey[containerId] = null;
  },

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  },

  _buildDial(dial, segments) {
    const n = segments.length;
    if (n === 0) {
      dial.style.background = 'var(--board-bg, #14161c)';
      dial.innerHTML = '';
      return;
    }
    const slice = 360 / n;
    const stops = segments.map((_, i) => {
      const color = this.PALETTE[i % this.PALETTE.length];
      return `${color} ${i * slice}deg ${(i + 1) * slice}deg`;
    }).join(', ');
    dial.style.background = `conic-gradient(${stops})`;

    dial.innerHTML = segments.map((name, i) => {
      const mid = i * slice + slice / 2;
      // conic-gradient's 0deg is 12 o'clock, clockwise -- but an
      // unrotated element's local +X axis (where the label sits, at
      // left:16px) naturally points at 3 o'clock, i.e. CSS rotate(0deg)
      // for this wrapper. That's a fixed 90deg offset between the two
      // conventions, so it has to be subtracted here or every label lands
      // a quarter-turn away from the wedge it's supposed to name.
      const cssAngle = mid - 90;
      return `
        <div class="wheel-label" style="transform: rotate(${cssAngle}deg);">
          <span>${this._escape(name)}</span>
        </div>
      `;
    }).join('');
  },

  // isGM: whether to draw ROLL/CLOSE controls (players never get them).
  // handlers: { onRoll, onClose } click callbacks, GM-only.
  update(containerId, wheelState, isGM, handlers) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const state = wheelState || { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
    const segments = Array.isArray(state.segments) ? state.segments : [];

    el.classList.toggle('active', !!state.open);
    if (!state.open) {
      this._lastSpinToken[containerId] = null;
      this._lastSegKey[containerId] = null;
      return;
    }

    const dial = el.querySelector('.wheel-dial');
    const resultEl = el.querySelector('.wheel-result');
    if (!dial) return;

    const segKey = segments.join('|');
    if (this._lastSegKey[containerId] !== segKey) {
      this._lastSegKey[containerId] = segKey;
      this._buildDial(dial, segments);
      // Fresh wheel (new segment list) always starts at rest, no leftover
      // rotation or transition from a previous spin/session.
      dial.style.transition = 'none';
      dial.style.transform = 'rotate(0deg)';
      void dial.offsetWidth; // flush before any later transition is set
      if (resultEl) { resultEl.textContent = ''; resultEl.dataset.empty = 'true'; }
    }

    const isNewSpin = !!state.spinToken && state.spinToken !== this._lastSpinToken[containerId];

    if (state.phase === 'spinning' && isNewSpin) {
      this._lastSpinToken[containerId] = state.spinToken;
      const n = segments.length;
      if (n > 0) {
        const slice = 360 / n;
        const targetMid = state.winnerIndex * slice + slice / 2;
        // Rotating the dial by R puts the point originally at angle
        // targetMid (clockwise from the top, same convention conic-
        // gradient and rotate() both use) at (targetMid + R) mod 360.
        // Solving for that to land at 0 (under the fixed top pointer)
        // gives R = k*360 - targetMid; SPIN_TURNS+1 turns just makes it a
        // dramatic multi-spin rather than a short snap.
        const finalAngle = (this.SPIN_TURNS + 1) * 360 - targetMid;
        if (resultEl) { resultEl.textContent = ''; resultEl.dataset.empty = 'true'; }
        dial.style.transition = `transform ${this.SPIN_DURATION_S}s cubic-bezier(0.15, 0.85, 0.25, 1)`;
        dial.style.transform = `rotate(${finalAngle}deg)`;
      }
    } else if (state.phase === 'result') {
      this._lastSpinToken[containerId] = state.spinToken;
      if (resultEl && state.winnerIndex != null && segments[state.winnerIndex] != null) {
        resultEl.textContent = `THE WHEEL LANDED ON: ${segments[state.winnerIndex]}`;
        resultEl.dataset.empty = 'false';
      }
    } else if (state.phase === 'idle' && !isNewSpin) {
      this._lastSpinToken[containerId] = null;
    }

    const controls = el.querySelector('.wheel-controls');
    if (!controls) return;
    if (isGM) {
      controls.innerHTML = `
        <button type="button" class="toolbar-btn primary" id="${containerId}-roll-btn" ${state.phase === 'spinning' ? 'disabled' : ''}>ROLL</button>
        <button type="button" class="toolbar-btn" id="${containerId}-close-btn">CLOSE WHEEL</button>
      `;
      const rollBtn = document.getElementById(`${containerId}-roll-btn`);
      const closeBtn = document.getElementById(`${containerId}-close-btn`);
      if (rollBtn && handlers && handlers.onRoll) rollBtn.onclick = handlers.onRoll;
      if (closeBtn && handlers && handlers.onClose) closeBtn.onclick = handlers.onClose;
    } else {
      controls.innerHTML = '';
    }
  }
};

window.Wheel = Wheel;
