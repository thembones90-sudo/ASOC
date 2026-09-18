/*
 * ASOC ENGINE - Skeleton Layout
 *
 * Shared positioning module for the ASOC poster skeleton (canonical
 * 1900 x 1267 canvas). The poster itself is difficulty-reactive -- see
 * SKELETON_MAP / skeletonPath() below -- but every variant shares this
 * exact same pill/panel layout, so the slot map is identical regardless
 * of which difficulty poster is loaded.
 *
 * CANONICAL SLOT MAP (measured from the master TIFF, Sep 2026):
 *
 *   The silver/chrome pill slots ARE the text containers. Every game uses
 *   this exact map, so alignment is identical everywhere:
 *
 *   A1-A4  left  upper arm plates      (x,y,w,h)
 *   B1-B4  right upper arm plates
 *   A5/B5  the inner plates above the central gate
 *   C5/D5  the wide tube bands below the central gate
 *   C1-C4  left  lower arm plates
 *   D1-D4  right lower arm plates
 *   FINAL  the red+purple rectangle pill in the middle of the picture
 *
 * Cells are absolutely positioned with CSS container-size units
 * (cqw / cqh) so every slot scales with the board stage, matching
 * the wrapped skeleton image 1:1 at any window size.
 *
 * Auto-fit: after the poster image loads (and on window resize) every
 * slot's text is measured against its pill box and uniformly scaled
 * down (scale <= 1) whenever a long word would overflow the pill.
 *
 * When CSS container queries are unsupported the module degrades:
 * cellStyle() returns '' (the classic CSS grid is kept) and the
 * poster is shown as a cover background behind the grid.
 */

const Skeleton = (() => {
  const W = 1900;
  const H = 1267;

  // ---------------------------------------------------------------------
  // DIFFICULTY-REACTIVE SKELETON (Sep 2026)
  //
  // Each difficulty has its own complete, hand-authored skeleton poster
  // (same 1900x1267 canvas, same pill/panel/decoration layout -- verified
  // pixel-identical outside the ASOC logo's own eye/core, which is the
  // only part of the art that changes per difficulty). Swapping the whole
  // poster image per difficulty means the machine's silhouette, pill
  // positions, and every other decorative element are guaranteed to be
  // the exact same source art everywhere -- there is no separate overlay
  // layer to keep aligned.
  //
  // Canonical difficulty scale is GameData.DIFFICULTY_VALUES: GREEN,
  // YELLOW, AMBER, RED, PURPLE, BLACK. This is the ONLY place that scale
  // maps to a skeleton asset -- nowhere else in the app should branch on
  // difficulty to pick an image.
  const SKELETON_MAP = {
    GREEN:  'assets/ui/skeleton/asoc-skeleton-green.png',
    YELLOW: 'assets/ui/skeleton/asoc-skeleton-yellow.png',
    AMBER:  'assets/ui/skeleton/asoc-skeleton-amber.png',
    RED:    'assets/ui/skeleton/asoc-skeleton-red.png',
    PURPLE: 'assets/ui/skeleton/asoc-skeleton-purple.png',
    BLACK:  'assets/ui/skeleton/asoc-skeleton-black.png'
  };
  const SKELETON_FALLBACK = SKELETON_MAP.RED;

  // Missing, unknown, or malformed difficulty -> canonical red (locked
  // fallback; never silently falls back to green/default).
  function skeletonPath(difficulty) {
    return SKELETON_MAP[difficulty] || SKELETON_FALLBACK;
  }

  const slots = {
    A1: { x: 65,  y: 140, w: 427, h: 60 },
    A2: { x: 148, y: 231, w: 439, h: 61 },
    A3: { x: 234, y: 327, w: 451, h: 54 },
    A4: { x: 326, y: 417, w: 462, h: 55 },
    A5: { x: 413, y: 508, w: 493, h: 57 },

    B1: { x: 1388, y: 146, w: 426, h: 54 },
    B2: { x: 1291, y: 237, w: 440, h: 55 },
    B3: { x: 1191, y: 326, w: 452, h: 55 },
    B4: { x: 1090, y: 411, w: 461, h: 61 },
    B5: { x: 971,  y: 508, w: 493, h: 57 },

    C1: { x: 325, y: 808, w: 467, h: 57 },
    C2: { x: 234, y: 900, w: 452, h: 53 },
    C3: { x: 147, y: 986, w: 440, h: 60 },
    C4: { x: 64,  y: 1076, w: 428, h: 59 },
    C5: { x: 419, y: 716, w: 487, h: 55 },

    D1: { x: 1087, y: 803, w: 468, h: 62 },
    D2: { x: 1190, y: 900, w: 454, h: 53 },
    D3: { x: 1291, y: 991, w: 440, h: 56 },
    D4: { x: 1387, y: 1081, w: 426, h: 55 },
    D5: { x: 972,  y: 718, w: 487, h: 53 },

    FINAL: { x: 534, y: 612, w: 814, h: 55 }
  };

  // Font targets expressed as a fraction of the pill's RENDERED HEIGHT.
  // Deterministic slot-height-based sizing (see Skeleton.fit) so a word
  // occupies most of the pill no matter the board size. Bumped up from the
  // original 0.62/0.68/0.62 per direct GM feedback that words needed to be
  // "bigger" and more "visible" -- this is the ONLY place that controls
  // rendered size on a container-query-capable browser: fit() sets
  // txt.style.fontSize directly from these, overriding any CSS font-size
  // on .cell-content, so bumping the CSS alone (as a prior pass did) has
  // no visible effect here.
  const RATIO_CLUE = 0.74;       // A1-D4
  const RATIO_SOLUTION = 0.82;   // A5/B5/C5/D5: column solutions
  const RATIO_FINAL = 0.98;      // FINAL: deliberately dominant, the king reveal
  const HORIZONTAL_STRETCH = 1.20;

  // Bolder across the board for visibility -- solutions and FINAL carry
  // the most weight since they're the "big reveal" moments.
  const WEIGHT_CLUE = 700;
  const WEIGHT_SOLUTION = 800;
  const WEIGHT_FINAL = 900;

  function kindOf(label) {
    if (label === 'FINAL') return 'final';
    if (label && /5$/.test(label)) return 'solution';
    return 'clue';
  }

  function ratioFor(label) {
    const kind = kindOf(label);
    if (kind === 'solution') return RATIO_SOLUTION;
    if (kind === 'final') return RATIO_FINAL;
    return RATIO_CLUE;
  }

  function weightFor(label) {
    const kind = kindOf(label);
    if (kind === 'solution') return WEIGHT_SOLUTION;
    if (kind === 'final') return WEIGHT_FINAL;
    return WEIGHT_CLUE;
  }

  const supported = (() => {
    try {
      return typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        (CSS.supports('container-type: size') || CSS.supports('container: size'));
    } catch (e) {
      return false;
    }
  })();

  function cellStyle(label) {
    if (!supported) return '';
    const slot = slots[label];
    if (!slot) return '';
    const left = (slot.x / W) * 100;
    const top = (slot.y / H) * 100;
    const width = (slot.w / W) * 100;
    const height = (slot.h / H) * 100;
    const fontCqh = (ratioFor(label) * slot.h / H) * 100;
    return [
      'left:' + left.toFixed(3) + 'cqw',
      'top:' + top.toFixed(3) + 'cqh',
      'width:' + width.toFixed(3) + 'cqw',
      'height:' + height.toFixed(3) + 'cqh',
      '--asoc-font:' + fontCqh.toFixed(3) + 'cqh'
    ].join(';') + ';';
  }

  function skeletonHTML(difficulty) {
    return `<img class="skeleton-img" src="${skeletonPath(difficulty)}" alt="">`;
  }

  function fit(container) {
    if (!container || !supported) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const scaleW = rect.width / W;
    const scaleH = rect.height / H;

    const cells = container.querySelectorAll('.asoc-board .board-cell');
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const txt = cell.querySelector('.cell-content');
      if (!txt) continue;

      // Reset any previously applied autofit scale BEFORE measuring, so
      // resize/load cycles never compound transforms.
      txt.style.transform = '';

      const label = cell.getAttribute('data-cell') || cell.getAttribute('data-label') || '';
      const slot = slots[label];
      if (!slot) continue;

      const cs = window.getComputedStyle(cell);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;

      const pillW = slot.w * scaleW;
      const pillH = slot.h * scaleH;
      if (pillW <= 4 || pillH <= 4) continue;

      // 1) Start at the full, deterministic base size derived from the
      //    pill's rendered height: the word fills ~62-68% of the pill
      //    height and reads from across the room.
      const baseFont = Math.max(4, pillH * ratioFor(label));
      txt.style.fontSize = baseFont + 'px';
      // Barlow Condensed is self-hosted and deterministic now, so the
      // tighter line box keeps the visible uppercase ink centered cleanly.
      txt.style.lineHeight = '1';
      txt.style.fontWeight = String(weightFor(label));

      // 2) Shrink ONLY when the rendered text exceeds the usable pill
      //    width (94% of the inner width -- nudged up from 90% so longer
      //    clue phrases keep more of the bigger base size before autofit
      //    has to compensate). Short words stay untouched at scale 1.
      const maxW = Math.max(4, (pillW - padL - padR) * 0.94);
      let scale = 1;
      // CSS stretches every word 20% horizontally. scrollWidth reports the
      // unscaled layout width, so include that stretch in overflow fitting.
      const tw = txt.scrollWidth * HORIZONTAL_STRETCH;
      if (tw > maxW) scale = maxW / tw;
      const th = txt.scrollHeight;
      const heightBudget = kindOf(label) === 'final' ? 1.05 : 0.9;
      if (th > pillH * heightBudget) {
        scale = Math.min(scale, (pillH * heightBudget) / th);
      }

      if (scale < 1) {
        txt.style.transformOrigin = 'center center';
        txt.style.transform = 'scale(' + scale.toFixed(4) + ')';
      }
    }
  }

  // ---------------------------------------------------------------------
  // SHADOW BROKER BOARD LINE
  //
  // A transient HUD readout positioned directly above the Shadow Broker
  // avatar's fixed position in the skeleton art (avatar center (950,239),
  // radius 150 after the Sep 18 theatrical-spacing pass). This is NOT a chat
  // bubble: a single plain line of text in a tactical/military font,
  // appearing "above his head" wherever the board itself is rendered
  // (Public View, the player's own board) whenever the GM sends a
  // standalone Shadow Broker broadcast. Centered on the same x=950
  // vertical axis as the avatar, sitting in the clear space between the
  // canvas top edge and the avatar's own top edge (220-150=70).
  const SHADOW_BROKER_LINE_SLOT = { x: 550, y: 27, w: 800, h: 55 };

  function shadowBrokerLineStyle() {
    if (!supported) return '';
    const slot = SHADOW_BROKER_LINE_SLOT;
    const left = (slot.x / W) * 100;
    const top = (slot.y / H) * 100;
    const width = (slot.w / W) * 100;
    const height = (slot.h / H) * 100;
    const fontCqh = (0.62 * slot.h / H) * 100;
    return [
      'left:' + left.toFixed(3) + 'cqw',
      'top:' + top.toFixed(3) + 'cqh',
      'width:' + width.toFixed(3) + 'cqw',
      'height:' + height.toFixed(3) + 'cqh',
      '--asoc-font:' + fontCqh.toFixed(3) + 'cqh'
    ].join(';') + ';';
  }

  // Pure timing function shared by every board renderer (Public View in
  // js/app.js, the player's own board in js/player.js) so the reveal
  // speed/hold/fade behavior is defined in exactly ONE place. Renderers
  // call this fresh on every rebuild -- never an imperative DOM-mutating
  // interval -- the same time-window pattern already proven for the Final
  // Solution flourish (see js/app.js's _finalFlourishUntil comment): any
  // number of incidental rebuilds mid-transmission (a cell reveal, a
  // Timer tick broadcasting once a second) can never desync, truncate, or
  // restart it, because the visible state is always recomputed from
  // (text, startedAt, now) rather than accumulated imperatively. Returns
  // null once the transmission has fully revealed, held, and faded out.
  const BROKER_LINE_CHAR_MS = 30;
  const BROKER_LINE_HOLD_MIN_MS = 3000;
  const BROKER_LINE_HOLD_MAX_MS = 8000;
  const BROKER_LINE_HOLD_PER_CHAR_MS = 50;
  const BROKER_LINE_FADE_MS = 500;

  function shadowBrokerLineState(text, startedAt, now) {
    if (!text) return null;
    const elapsed = now - startedAt;
    const revealMs = text.length * BROKER_LINE_CHAR_MS;
    const holdMs = Math.min(
      BROKER_LINE_HOLD_MAX_MS,
      Math.max(BROKER_LINE_HOLD_MIN_MS, BROKER_LINE_HOLD_MIN_MS + text.length * BROKER_LINE_HOLD_PER_CHAR_MS)
    );
    const fadeStart = revealMs + holdMs;
    const fadeEnd = fadeStart + BROKER_LINE_FADE_MS;
    if (elapsed >= fadeEnd) return null;

    const charsShown = Math.max(0, Math.min(text.length, Math.floor(elapsed / BROKER_LINE_CHAR_MS)));
    const visibleText = text.slice(0, charsShown);
    let opacity = 1;
    if (elapsed > fadeStart) {
      opacity = Math.max(0, 1 - (elapsed - fadeStart) / BROKER_LINE_FADE_MS);
    }
    return { visibleText, opacity };
  }

  // Shared Shadow Broker identity markup -- the ONE place both the GM
  // console (app.js) and the player screen (player.js) build a Broker
  // "transmission" bubble (a standalone broadcast, or a verdict response
  // attached under a judged guess), so the two views never drift into
  // two different-looking implementations. Purely markup/escaping; no
  // DOM-state or app-specific dependency, which is why it lives here
  // alongside the other board-agnostic Skeleton helpers rather than in
  // either app.js or player.js. Styling for the classes used below lives
  // in css/asoc.css (.shadow-broker-transmission and friends), loaded by
  // both index.html and join.html.
  function escapeHtmlText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function shadowBrokerTransmissionHTML(text, { glitchIn = false, variant = 'broadcast', verdict = null } = {}) {
    const variantClass = variant === 'verdict-response' ? 'shadow-broker-verdict-response' : 'shadow-broker-broadcast';
    const verdictClass = verdict ? ` sb-${verdict}` : '';
    return `
      <div class="shadow-broker-transmission ${variantClass}${verdictClass} ${glitchIn ? 'sb-glitch-in' : ''}">
        <img src="assets/ui/shadow-broker.png" class="shadow-broker-avatar" alt="Shadow Broker">
        <div class="shadow-broker-body">
          <span class="shadow-broker-name">SHADOW BROKER</span>
          <span class="shadow-broker-text">${escapeHtmlText(text)}</span>
        </div>
      </div>
    `;
  }

  const resizeHandler = new WeakMap();

  function scheduleFit(container) {
    if (!container || !supported || !window.requestAnimationFrame) return;
    if (resizeHandler.has(container)) return;
    const handler = () => {
      const run = () => fit(container);
      window.requestAnimationFrame(run);
    };
    resizeHandler.set(container, handler);
    window.addEventListener('resize', handler);
  }

  function attach(container) {
    if (!container) return;
    container.classList.add('skeleton-ready');
    scheduleFit(container);
    const img = container.querySelector('.skeleton-img');
    if (!img) {
      fit(container);
      return;
    }

    img.classList.add('loading');
    const autoFit = () => {
      if (!img.classList.contains('loaded')) img.classList.add('loaded');
      fit(container);
    };
    if (img.complete && img.naturalWidth > 0) {
      img.classList.remove('loading');
      autoFit();
      return;
    }
    img.onload = () => { img.classList.remove('loading'); autoFit(); };
    img.onerror = () => {
      container.classList.add('skeleton-fallback');
      if (img.parentNode) img.parentNode.removeChild(img);
      fit(container);
    };
  }

  let nemaAsocTimer = null;

  function playNemaAsoc() {
    const old = document.querySelector('.nema-asoc-overlay');
    if (old) old.remove();
    if (nemaAsocTimer) {
      clearTimeout(nemaAsocTimer);
      nemaAsocTimer = null;
    }

    document.body.classList.remove('nema-asoc-active');
    // Force a clean animation restart if the GM threatens them twice in a row.
    void document.body.offsetWidth;

    const overlay = document.createElement('div');
    overlay.className = 'nema-asoc-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<div class="nema-asoc-text" data-text="NEMA ASOC">NEMA ASOC</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('nema-asoc-active');

    nemaAsocTimer = setTimeout(() => {
      document.body.classList.remove('nema-asoc-active');
      overlay.remove();
      nemaAsocTimer = null;
    }, 5000);
  }

  return {
    W,
    H,
    slots,
    supported,
    cellStyle,
    skeletonHTML,
    attach,
    fit,
    SKELETON_MAP,
    skeletonPath,
    shadowBrokerLineStyle,
    shadowBrokerLineState,
    BROKER_LINE_CHAR_MS,
    BROKER_LINE_HOLD_MIN_MS,
    BROKER_LINE_HOLD_MAX_MS,
    BROKER_LINE_HOLD_PER_CHAR_MS,
    BROKER_LINE_FADE_MS,
    shadowBrokerTransmissionHTML,
    playNemaAsoc
  };
})();

window.Skeleton = Skeleton;