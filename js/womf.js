// WOMF (WHEEL OF MISFORTUNE) TRACKER
//
// Purely a rendering module: it draws/updates the horizontal charge-meter
// strip that lives ABOVE the board (never inside .asoc-board), on the GM's
// main view, the GM's Public View preview, and the player's join.html. The
// authoritative charge value itself always comes from the server via
// state:public -- this module never invents or holds its own count, it
// only reflects whatever { charge, armed } it is given.
//
// Segment DOM is built ONCE per container (init) and only ever has classes
// toggled afterward (update) -- never rebuilt -- so an in-flight CSS
// animation (the light-up flash, the arming sequence) is never cut short
// by a re-render landing mid-animation.
const Womf = {
  _lastCharge: {},

  classify(charge) {
    if (charge >= 10) return 'ready';
    if (charge === 9) return 'critical';
    if (charge === 8) return 'unstable';
    if (charge >= 4) return 'charging';
    return 'dormant';
  },

  statusLabel(state) {
    switch (state) {
      case 'ready': return 'WHEEL READY';
      case 'critical': return 'CRITICAL';
      case 'unstable': return 'UNSTABLE';
      case 'charging': return 'CHARGING';
      default: return 'DORMANT';
    }
  },

  shellHTML() {
    let segments = '';
    for (let i = 0; i < 10; i++) {
      segments += `<span class="womf-segment" data-index="${i}"></span>`;
    }
    return `
      <div class="womf-label">WOMF</div>
      <div class="womf-segments">${segments}</div>
      <div class="womf-count"><span class="womf-count-value">0</span>/10</div>
      <div class="womf-status">DORMANT</div>
    `;
  },

  // Builds the static shell into an already-present container element.
  // Safe to call more than once (e.g. on init) -- it just rebuilds the
  // shell at charge 0, which update() immediately corrects on the next
  // state broadcast.
  init(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = this.shellHTML();
    el.dataset.state = 'dormant';
    el.classList.remove('womf-arming', 'womf-arm-flash');
    el.style.setProperty('--womf-intensity', '0');
    this._lastCharge[containerId] = 0;
  },

  // Updates one tracker element in place from a { charge, armed } object.
  update(containerId, womfState) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const charge = Math.max(0, Math.min(10, (womfState && womfState.charge) || 0));
    const prevCharge = this._lastCharge[containerId] || 0;
    const wasReady = el.dataset.state === 'ready';
    const state = this.classify(charge);

    const segments = el.querySelectorAll('.womf-segment');
    segments.forEach((seg, i) => {
      const filled = i < charge;
      seg.classList.toggle('filled', filled);
      // Only a segment newly earned in THIS update gets the light-up
      // animation -- never replay it on a segment that was already lit,
      // and never fire it on a decrease (WOMF charge never decreases
      // today, but this guards the animation either way).
      if (filled && i >= prevCharge && charge > prevCharge) {
        seg.classList.remove('womf-newly-filled');
        void seg.offsetWidth; // restart the animation if it's mid-flight
        seg.classList.add('womf-newly-filled');
      }
    });

    const countEl = el.querySelector('.womf-count-value');
    if (countEl) countEl.textContent = String(charge);

    const statusEl = el.querySelector('.womf-status');

    // Charging intensity ramps 0 -> 1 across the 4-7 range only; dormant
    // and the shake states don't use it for the glow (they have their own
    // fixed treatments), and ready holds it at full.
    const intensity = state === 'charging' ? Math.min(1, Math.max(0, (charge - 3) / 4)) : (state === 'dormant' ? 0 : 1);
    el.style.setProperty('--womf-intensity', String(intensity));

    if (charge >= 10 && !wasReady) {
      // Reaching 10 for the first time: brief escalation (reuse whatever
      // shake state we were just in), then sudden stillness, then one
      // strong pulse into the stable armed state. This is a locked
      // one-shot sequence -- it must never replay just because the tracker
      // re-renders while already armed (the wasReady guard above).
      if (statusEl) statusEl.textContent = this.statusLabel(prevCharge >= 9 ? 'critical' : (prevCharge >= 8 ? 'unstable' : state));
      el.classList.add('womf-arming');
      setTimeout(() => {
        el.classList.remove('womf-arming');
        el.dataset.state = 'ready';
        if (statusEl) statusEl.textContent = this.statusLabel('ready');
        el.classList.add('womf-arm-flash');
        setTimeout(() => el.classList.remove('womf-arm-flash'), 650);
      }, 1100);
    } else {
      el.dataset.state = state;
      if (statusEl) statusEl.textContent = this.statusLabel(state);
    }

    this._lastCharge[containerId] = charge;
  }
};

window.Womf = Womf;
