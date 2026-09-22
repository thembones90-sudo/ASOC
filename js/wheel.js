// WHEEL OF MISFORTUNE -- server-authoritative spin state, client-side theatre.
// The server owns { open, segments, phase, winnerIndex, spinToken }. This module
// only renders that state and makes the deterministic landing position look
// like the hostile machine WOMF deserves instead of a pie chart from accounting.
const Wheel = {
  _lastSpinToken: {},
  _lastResultToken: {},
  _lastSegKey: {},

  SPIN_DURATION_S: 4.2,
  SPIN_TURNS: 6,

  // Restrained machine palette. Alternating values keep wedges readable
  // without turning WOMF into a county-fair raffle.
  PALETTE: [
    '#303743',
    '#4a273f',
    '#453038',
    '#263746',
    '#3a3d47',
    '#2b2935',
    '#553038',
    '#28313c',
    '#412844',
    '#34313b',
    '#293c40',
    '#4a3034'
  ],
  WINNER_COLOR: '#b72a35',

  shellHTML() {
    return [
      '<div class="wheel-shell" data-phase="idle">',
        '<div class="wheel-corner wheel-corner-tl"></div>',
        '<div class="wheel-corner wheel-corner-tr"></div>',
        '<div class="wheel-corner wheel-corner-bl"></div>',
        '<div class="wheel-corner wheel-corner-br"></div>',
        '<div class="wheel-kicker">WOMF // EXECUTION PROTOCOL</div>',
        '<div class="wheel-title">WHEEL OF MISFORTUNE</div>',
        '<div class="wheel-status-line"><span class="wheel-status-dot"></span><span class="wheel-status-text">MISFORTUNE ARMED</span></div>',
        '<div class="wheel-stage">',
          '<div class="wheel-outer-ring"></div>',
          '<div class="wheel-pointer"><span></span></div>',
          '<div class="wheel-dial"></div>',
          '<div class="wheel-hub">',
            '<div class="wheel-hub-eye"></div>',
            '<div class="wheel-hub-label">WOMF</div>',
            '<div class="wheel-hub-count">10 / 10</div>',
            '<div class="wheel-hub-state">ARMED</div>',
          '</div>',
        '</div>',
        '<div class="wheel-result" data-empty="true">',
          '<div class="wheel-result-kicker">MISFORTUNE SELECTED</div>',
          '<div class="wheel-result-name"></div>',
        '</div>',
        '<div class="wheel-controls"></div>',
      '</div>'
    ].join('');
  },

  init(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = this.shellHTML();
    this._lastSpinToken[containerId] = null;
    this._lastResultToken[containerId] = null;
    this._lastSegKey[containerId] = null;
  },

  _escape(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  },

  _sliceGradient(segments, winnerIndex) {
    const n = segments.length;
    if (!n) return 'var(--board-bg, #14161c)';
    const slice = 360 / n;
    return 'conic-gradient(' + segments.map((_, i) => {
      let color = this.PALETTE[i % this.PALETTE.length];
      if (winnerIndex != null) {
        color = i === winnerIndex
          ? this.WINNER_COLOR
          : (i % 2 === 0 ? '#1c2028' : '#231d25');
      }
      return color + ' ' + (i * slice) + 'deg ' + ((i + 1) * slice) + 'deg';
    }).join(', ') + ')';
  },

  _buildDial(dial, segments) {
    const n = segments.length;
    if (n === 0) {
      dial.style.background = 'var(--board-bg, #14161c)';
      dial.innerHTML = '';
      return;
    }

    dial.style.background = this._sliceGradient(segments, null);
    const slice = 360 / n;
    const radiusPct = n >= 10 ? 32 : n >= 7 ? 33 : 34;
    const fontScale = n >= 10 ? 0.78 : n >= 8 ? 0.86 : 1;

    dial.innerHTML = segments.map((name, i) => {
      const mid = i * slice + slice / 2;
      const cssAngle = mid - 90;
      const rad = cssAngle * Math.PI / 180;
      const x = 50 + Math.cos(rad) * radiusPct;
      const y = 50 + Math.sin(rad) * radiusPct;
      let textAngle = cssAngle;

      // Keep radial labels facing a readable direction on the resting wheel.
      // The whole label still rotates with its wedge during the spin.
      const normalized = ((textAngle % 360) + 360) % 360;
      if (normalized > 90 && normalized < 270) textAngle += 180;

      const safeName = this._escape(name);
      return [
        '<div class="wheel-label" data-wheel-index="', i,
        '" style="left:', x.toFixed(3), '%;top:', y.toFixed(3),
        '%;--label-angle:', textAngle.toFixed(3),
        'deg;--label-scale:', fontScale, ';">',
          '<span>', safeName, '</span>',
        '</div>'
      ].join('');
    }).join('');
  },

  _finalAngle(segments, winnerIndex, dramatic) {
    const n = segments.length;
    if (!n || winnerIndex == null) return 0;
    const slice = 360 / n;
    const targetMid = winnerIndex * slice + slice / 2;
    const turns = dramatic ? this.SPIN_TURNS + 1 : 1;
    return turns * 360 - targetMid;
  },

  _setResultTreatment(el, dial, state, segments) {
    const winnerIndex = state.winnerIndex;
    const hasWinner = winnerIndex != null && segments[winnerIndex] != null;
    dial.style.background = this._sliceGradient(segments, hasWinner ? winnerIndex : null);

    dial.querySelectorAll('.wheel-label').forEach(label => {
      const idx = Number(label.dataset.wheelIndex);
      label.classList.toggle('is-winner', hasWinner && idx === winnerIndex);
      label.classList.toggle('is-dimmed', hasWinner && idx !== winnerIndex);
    });

    if (hasWinner) {
      // Result-state hydration must also orient the winning wedge correctly
      // for late joiners and refreshed clients that never saw the spin packet.
      dial.style.transition = 'none';
      dial.style.transform = 'rotate(' + this._finalAngle(segments, winnerIndex, false) + 'deg)';
      void dial.offsetWidth;
    }

    const resultEl = el.querySelector('.wheel-result');
    const resultName = el.querySelector('.wheel-result-name');
    if (resultEl && resultName && hasWinner) {
      resultName.innerHTML = this._escape(segments[winnerIndex]);
      resultEl.dataset.empty = 'false';
    }

    const shell = el.querySelector('.wheel-shell');
    const resultToken = state.spinToken || (segments.join('|') + ':' + winnerIndex);
    if (shell && this._lastResultToken[el.id] !== resultToken) {
      this._lastResultToken[el.id] = resultToken;
      shell.classList.remove('wheel-impact');
      void shell.offsetWidth;
      shell.classList.add('wheel-impact');
      window.setTimeout(() => shell.classList.remove('wheel-impact'), 820);
    }
  },

  // isGM: whether to draw controls (players get the same machine, read-only).
  // handlers: { onRoll, onClose } click callbacks, GM-only.
  update(containerId, wheelState, isGM, handlers) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const state = wheelState || {
      open: false,
      segments: [],
      phase: 'idle',
      winnerIndex: null,
      spinToken: null
    };
    const segments = Array.isArray(state.segments) ? state.segments : [];

    el.classList.toggle('active', !!state.open);
    if (!state.open) {
      this._lastSpinToken[containerId] = null;
      this._lastResultToken[containerId] = null;
      this._lastSegKey[containerId] = null;
      return;
    }

    const shell = el.querySelector('.wheel-shell');
    const dial = el.querySelector('.wheel-dial');
    const resultEl = el.querySelector('.wheel-result');
    const statusText = el.querySelector('.wheel-status-text');
    if (!dial) return;

    if (shell) shell.dataset.phase = state.phase || 'idle';
    if (statusText) {
      statusText.textContent = state.phase === 'spinning'
        ? 'EXECUTION IN PROGRESS'
        : state.phase === 'result'
          ? 'TARGET LOCKED'
          : 'MISFORTUNE ARMED';
    }

    const segKey = segments.join('|');
    if (this._lastSegKey[containerId] !== segKey) {
      this._lastSegKey[containerId] = segKey;
      this._lastResultToken[containerId] = null;
      this._buildDial(dial, segments);
      dial.style.transition = 'none';
      dial.style.transform = 'rotate(0deg)';
      void dial.offsetWidth;
      if (resultEl) resultEl.dataset.empty = 'true';
    }

    const isNewSpin = !!state.spinToken && state.spinToken !== this._lastSpinToken[containerId];

    if (state.phase === 'spinning' && isNewSpin) {
      this._lastSpinToken[containerId] = state.spinToken;
      this._lastResultToken[containerId] = null;
      dial.style.background = this._sliceGradient(segments, null);
      dial.querySelectorAll('.wheel-label').forEach(label => {
        label.classList.remove('is-winner', 'is-dimmed');
      });
      if (resultEl) resultEl.dataset.empty = 'true';

      if (segments.length > 0) {
        const finalAngle = this._finalAngle(segments, state.winnerIndex, true);
        dial.style.transition = 'transform ' + this.SPIN_DURATION_S + 's cubic-bezier(0.12, 0.82, 0.18, 1)';
        dial.style.transform = 'rotate(' + finalAngle + 'deg)';
      }
    } else if (state.phase === 'result') {
      this._lastSpinToken[containerId] = state.spinToken;
      this._setResultTreatment(el, dial, state, segments);
    } else if (state.phase === 'idle') {
      this._lastSpinToken[containerId] = null;
      this._lastResultToken[containerId] = null;
      dial.style.background = this._sliceGradient(segments, null);
      dial.querySelectorAll('.wheel-label').forEach(label => {
        label.classList.remove('is-winner', 'is-dimmed');
      });
      if (resultEl) resultEl.dataset.empty = 'true';
    }

    const controls = el.querySelector('.wheel-controls');
    if (!controls) return;

    if (isGM) {
      const canRoll = state.phase === 'idle';
      const closeText = state.phase === 'result' ? 'DISMISS' : 'ABORT';
      controls.innerHTML = [
        '<button type="button" class="wheel-action wheel-action-primary" id="', containerId,
        '-roll-btn" ', canRoll ? '' : 'disabled', '>',
          state.phase === 'result' ? 'MISFORTUNE SELECTED' : 'INITIATE MISFORTUNE',
        '</button>',
        '<button type="button" class="wheel-action wheel-action-secondary" id="', containerId,
        '-close-btn">', closeText, '</button>'
      ].join('');

      const rollBtn = document.getElementById(containerId + '-roll-btn');
      const closeBtn = document.getElementById(containerId + '-close-btn');
      if (rollBtn && handlers && handlers.onRoll) rollBtn.onclick = handlers.onRoll;
      if (closeBtn && handlers && handlers.onClose) closeBtn.onclick = handlers.onClose;
    } else {
      controls.innerHTML = '';
    }
  }
};

window.Wheel = Wheel;
