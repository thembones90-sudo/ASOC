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
      const txt = cell.querySelector('.cell-text') || cell.querySelector('.cell-content');
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
      // Board text uses the high-legibility gameplay font from CSS. Keep a
      // tight deterministic line box so the visible ink stays centered.
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
          <span class="shadow-broker-text">${window.CommanderEmojis?.renderText?.(text, 'commander-inline-emoji') || escapeHtmlText(text)}</span>
        </div>
      </div>
    `;
  }

  const resizeHandler = new WeakMap();

  function scheduleFit(container) {
    if (!container || !supported || !window.requestAnimationFrame) return;
    if (resizeHandler.has(container)) return;

    // The board can change size without the browser window changing size
    // (notably the GM's draggable chat/board splitter). Listening only for
    // window.resize leaves the font-fit calculation stale while the slots,
    // which use cqw/cqh, immediately move with the board. That mismatch is
    // what makes text appear to drift. Observe the BOARD ITSELF and refit on
    // every real element-size change.
    let rafId = 0;
    const handler = () => {
      if (rafId && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        fit(container);
      });
    };

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handler);
      observer.observe(container);
    }

    // Keep the window listener as a fallback for older browsers and for
    // viewport changes that may precede the element observer notification.
    window.addEventListener('resize', handler, { passive: true });
    resizeHandler.set(container, { handler, observer });
    handler();
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

  let mentionAllTimer = null;

  function playMentionAllShake() {
    if (!document?.body) return;
    if (mentionAllTimer) clearTimeout(mentionAllTimer);
    document.body.classList.remove('asoc-mention-all-active');
    // Restart the one-shot animation even when @all is fired twice quickly.
    void document.body.offsetWidth;
    document.body.classList.add('asoc-mention-all-active');
    mentionAllTimer = setTimeout(() => {
      document.body.classList.remove('asoc-mention-all-active');
      mentionAllTimer = null;
    }, 720);
  }

  let nemaAsocTimers = [];

  function playNemaAsoc() {
    const old = document.querySelector('.nema-asoc-overlay');
    if (old) old.remove();
    nemaAsocTimers.forEach(clearTimeout);
    nemaAsocTimers = [];

    document.body.classList.remove('nema-asoc-active');
    // Force a clean animation restart if the GM threatens them twice in a row.
    void document.body.offsetWidth;

    const overlay = document.createElement('div');
    overlay.className = 'nema-asoc-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.dataset.phase = 'interrupt';
    overlay.innerHTML = `
      <div class="nema-asoc-corruption"></div>
      <div class="nema-asoc-lock" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="nema-asoc-terminal">
        <div class="nema-asoc-kicker">ASOC DISPLAY OVERRIDE // HOST AUTHORITY</div>
        <div class="nema-asoc-text" data-text="NEMA ASOC">NEMA ASOC</div>
        <div class="nema-asoc-phase">SIGNAL INTERRUPTION</div>
      </div>
      <div class="nema-asoc-progress"><span></span></div>
      <div class="nema-asoc-counter">05 SEC // THE END OF ASOC</div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('nema-asoc-active');

    const setPhase = (delay, phase, label) => {
      nemaAsocTimers.push(setTimeout(() => {
        if (!overlay.isConnected) return;
        overlay.dataset.phase = phase;
        const phaseLabel = overlay.querySelector('.nema-asoc-phase');
        if (phaseLabel) phaseLabel.textContent = label;
      }, delay));
    };
    setPhase(620, 'seized', 'DISPLAY SEIZED');
    setPhase(1450, 'active', 'SYSTEM FAILURE // TERMINATION IMMINENT');
    setPhase(4200, 'release', 'RELEASING DISPLAY');

    nemaAsocTimers.push(setTimeout(() => {
      document.body.classList.remove('nema-asoc-active');
      overlay.remove();
      nemaAsocTimers = [];
    }, 5000));
  }


  let omenTimer = null;

  function playOmen() {
    const boards = Array.from(document.querySelectorAll('.asoc-board'))
      .map(node => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return { node, rect, area: rect.width * rect.height, visible: style.display !== 'none' && style.visibility !== 'hidden' };
      })
      .filter(item => item.visible && item.rect.width > 120 && item.rect.height > 80)
      .sort((a, b) => b.area - a.area);
    const target = boards[0];
    if (!target) return;

    document.querySelector('.asoc-omen-layer')?.remove();
    if (omenTimer) clearTimeout(omenTimer);

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const rect = target.rect;
    const layer = document.createElement('div');
    layer.className = 'asoc-omen-layer' + (reduced ? ' is-reduced' : '');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
    layer.innerHTML = `
      <div class="asoc-omen-wash"></div>
      <div class="asoc-omen-field">
        <i class="asoc-omen-ghost"></i>
        <i class="asoc-omen-ring omen-ring-a"></i>
        <i class="asoc-omen-ring omen-ring-b"></i>
        <i class="asoc-omen-ring omen-ring-c"></i>
        <i class="asoc-omen-rift"></i>
        <i class="asoc-omen-smoke smoke-a"></i>
        <i class="asoc-omen-smoke smoke-b"></i>
        <i class="asoc-omen-smoke smoke-c"></i>
      </div>
      <div class="asoc-omen-tear tear-a"></div>
      <div class="asoc-omen-tear tear-b"></div>
      <div class="asoc-omen-tear tear-c"></div>`;
    document.body.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add('is-active'));

    omenTimer = setTimeout(() => {
      layer.remove();
      omenTimer = null;
    }, reduced ? 1300 : 4600);
  }

  let gameWonTimers = [];

  // GAME WON -- the live victory sequence. Cold and clinical: the system
  // processes its own defeat. Played ONCE, at the moment the server flips
  // sessionState.gameWon (see App/PlayerApp applyServerState); the completed
  // state that persists afterwards is the body.game-won class, never this.
  // Shared by the GM and every player surface -- do not fork it.
  //
  // options.onStage (GM only) drives the GAME WON button through
  // 'verifying' -> 'accepted' -> 'won', then 'done' when the overlay is gone.
  function playGameWon(result = {}, options = {}) {
    const onStage = typeof options.onStage === 'function' ? options.onStage : () => {};
    const live = options.live !== false;
    if (live) window.AsocAudio?.gameWon?.();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    document.querySelector('.victory-link-overlay')?.remove();
    document.querySelector('.victory-overlay')?.remove();
    gameWonTimers.forEach(clearTimeout);
    gameWonTimers = [];

    const columns = result.columnSolutions || {};
    const columnResults = result.columnResults || {};
    const winner = result.matchWinner || (Array.isArray(result.winners) ? result.winners[0] : null);

    const overlay = document.createElement('div');
    overlay.className = `victory-overlay${live && !reducedMotion ? ' is-live is-neural-prelude' : ' is-static'}`;
    overlay.innerHTML = `
      <div class="victory-dim"></div>
      <div class="victory-grid"></div>
      <div class="victory-scan"></div>
      <div class="victory-frame"></div>
      <div class="victory-fx"></div>
      <section class="victory-ceremony">
        <p class="victory-message">${escapeLoss(result.message || 'Victory state confirmed.')}</p>
        <h1 class="victory-title">GAME WON</h1>
        <p class="victory-subline">Well done, little heroes.</p>
        <div class="victory-solution">
          <span>FINAL SOLUTION</span><strong>${escapeLoss(result.finalSolution || '')}</strong>
          <div class="victory-columns">${['A','B','C','D'].map(col =>
            `<span class="column-result ${columnResults[col] === true ? 'is-hit' : 'is-miss'}"><b>${col}5</b>${escapeLoss(columns[col] || '')}</span>`).join('')}</div>
        </div>
        <div class="victory-recount">
          <span>RECOUNT // MATCH OUTCOME: WON</span>
          ${winner ? `<h2>MATCH WINNER</h2><strong>${escapeLoss(winner.name)}</strong><b>${Number(winner.points) || 0} POINTS</b>` : '<h2>MATCH WINNER</h2><strong>AWAITING SCORE DATA</strong>'}
        </div>
      </section>`;
    document.body.appendChild(overlay);

    if (!live || reducedMotion) {
      onStage('won');
      if (live) overlay.addEventListener('click', () => {
        overlay.remove();
        onStage('done');
      }, { once: true });
      return overlay;
    }

    onStage('verifying');
    const fx = overlay.querySelector('.victory-fx');

    // Board-first convergence: target the rendered WORDS, not the poster
    // slots. The painted pill extends beyond logical slot geometry, so crisp
    // slot rectangles looked visibly off-target.
    const targetRect = (label) => {
      const candidates = Array.from(document.querySelectorAll(`.board-cell[data-label="${label}"]`))
        .map(cell => {
          const text = cell.querySelector('.cell-text') || cell.querySelector('.cell-content');
          const rect = text?.getBoundingClientRect() || cell.getBoundingClientRect();
          return { rect, area: rect.width * rect.height };
        })
        .filter(item => item.rect.width > 0 && item.rect.height > 0);
      candidates.sort((a, b) => b.area - a.area);
      return candidates[0]?.rect || null;
    };
    const addHit = (rect, delayMs, isFinal) => {
      if (!fx || !rect) return;
      const padX = isFinal ? 26 : 18;
      const padY = isFinal ? 13 : 10;
      const hit = document.createElement('div');
      hit.className = 'victory-word-hit' + (isFinal ? ' is-final' : '');
      hit.style.cssText =
        `left:${rect.left - padX}px;top:${rect.top - padY}px;width:${rect.width + padX * 2}px;height:${rect.height + padY * 2}px;--d:${delayMs}ms`;
      fx.appendChild(hit);
    };
    const addLink = (from, to, delayMs) => {
      if (!fx || !from || !to) return;
      const x1 = from.left + from.width / 2;
      const y1 = from.top + from.height / 2;
      const x2 = to.left + to.width / 2;
      const y2 = to.top + to.height / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;

      const link = document.createElement('div');
      link.className = 'victory-neural-link';
      link.style.cssText =
        `left:${x1}px;top:${y1}px;width:${length}px;transform:rotate(${angle}deg);--d:${delayMs}ms`;
      fx.appendChild(link);

      const spark = document.createElement('div');
      spark.className = 'victory-spark';
      fx.appendChild(spark);
      if (typeof spark.animate !== 'function') {
        spark.remove();
        return;
      }
      spark.animate([
        { transform: `translate(${x1}px, ${y1}px) scale(.65)`, opacity: 0 },
        { transform: `translate(${x1}px, ${y1}px) scale(1)`, opacity: 1, offset: .12 },
        { transform: `translate(${x2}px, ${y2}px) scale(.9)`, opacity: 1, offset: .88 },
        { transform: `translate(${x2}px, ${y2}px) scale(.45)`, opacity: 0 }
      ], {
        duration: 760,
        delay: delayMs + 90,
        easing: 'cubic-bezier(.35,0,.18,1)',
        fill: 'both'
      });
    };

    const finalRect = targetRect('FINAL');
    ['A','B','C','D'].forEach((col, i) => {
      const rect = targetRect(`${col}5`);
      if (!rect) return;
      addHit(rect, i * 260, false);
      if (finalRect) addLink(rect, finalRect, 180 + i * 260);
    });
    if (finalRect) addHit(finalRect, 1450, true);


    gameWonTimers.push(setTimeout(() => onStage('accepted'), 900));
    gameWonTimers.push(setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.remove('is-neural-prelude');
      overlay.classList.add('is-ceremony');
      onStage('won');

      overlay.addEventListener('click', () => {
        gameWonTimers.forEach(clearTimeout);
        gameWonTimers = [];
        overlay.remove();
        onStage('done');
      }, { once: true });
    }, 2200));

    gameWonTimers.push(setTimeout(() => {
      if (overlay.isConnected) overlay.classList.add('is-settled');
    }, 16700));

    return overlay;
  }

  let gameLostTimer = null;
  let gameLostPreludeTimer = null;
  const escapeLoss = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);

  // GAME LOST mirrors the victory ceremony structurally, but receives every
  // word and result from the server-authored persisted matchResult.
  function playGameLost(result, options = {}) {
    const live = options.live !== false;
    if (live) window.AsocAudio?.gameLost?.();
    document.querySelector('.defeat-overlay')?.remove();
    if (gameLostTimer) clearTimeout(gameLostTimer);
    if (gameLostPreludeTimer) clearTimeout(gameLostPreludeTimer);
    gameLostTimer = null;
    gameLostPreludeTimer = null;

    const columns = result.columnSolutions || {};
    const columnResults = result.columnResults || {};
    const top = result.topPerformer;
    const awards = Array.isArray(result.awards) ? result.awards : [];
    const overlay = document.createElement('div');
    overlay.className = `defeat-overlay${live ? ' is-live is-virus-prelude' : ' is-static'}`;
    overlay.innerHTML = `
      <div class="defeat-noise"></div>
      <div class="defeat-frame"></div>
      <div class="defeat-virus-shroud"></div>
      <div class="defeat-virus-fx"></div>
      <section class="defeat-ceremony">
        <p class="defeat-message">${escapeLoss(result.message)}</p>
        <h1>GAME LOST</h1>
        <p class="defeat-subline">Expected outcome, little heroes.</p>
        <div class="defeat-solution">
          <span>FINAL SOLUTION</span><strong>${escapeLoss(result.finalSolution)}</strong>
          <div class="defeat-columns">${['A','B','C','D'].map(col =>
            `<span class="column-result ${columnResults[col] === true ? 'is-hit' : 'is-miss'}"><b>${col}5</b>${escapeLoss(columns[col])}</span>`).join('')}</div>
        </div>
        <div class="defeat-recount">
          <span>RECOUNT // MATCH OUTCOME: LOST</span>
          ${top ? `<h2>TOP PERFORMER</h2><strong>${escapeLoss(top.name)}</strong><b>${Number(top.points) || 0} POINTS</b>` : '<h2>TOP PERFORMER</h2><strong>NO QUALIFYING DATA</strong>'}
          <div class="defeat-awards">${awards.map(award => `<p><b>${escapeLoss(award.type)}</b>${award.playerName ? ` // ${escapeLoss(award.playerName)}` : ''}<small>${escapeLoss(award.comment)}</small></p>`).join('')}</div>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    if (!live) return overlay;

    const fx = overlay.querySelector('.defeat-virus-fx');
    const rectFor = label => {
      const cell = Array.from(document.querySelectorAll(`.board-cell[data-label="${label}"]`))
        .find(node => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const seeds = ['A5','B5','C5','D5','FINAL'].map(rectFor).filter(Boolean);
    if (!seeds.length) seeds.push({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    const targets = Array.from(document.querySelectorAll('.board-cell[data-label]'))
      .map(node => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      })
      .filter(Boolean);

    const w = window.innerWidth;
    const h = window.innerHeight;
    [
      [.03,.08],[.18,.03],[.39,.06],[.62,.04],[.83,.07],[.97,.16],
      [.05,.38],[.95,.34],[.02,.68],[.98,.72],[.15,.94],[.36,.97],
      [.63,.95],[.84,.92],[.50,.12],[.50,.90]
    ].forEach(([x,y]) => targets.push({ x: w * x, y: h * y }));

    const addNode = (point, delay, size, core = false) => {
      if (!fx) return;
      const node = document.createElement('div');
      node.className = 'defeat-virus-node' + (core ? ' is-core' : '');
      node.style.cssText = `left:${point.x}px;top:${point.y}px;--d:${delay}ms;--s:${size}px`;
      fx.appendChild(node);
    };

    const addLink = (from, to, delay, thickness = 2) => {
      if (!fx) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const link = document.createElement('div');
      link.className = 'defeat-virus-link';
      link.style.cssText =
        `left:${from.x}px;top:${from.y}px;width:${length}px;height:${thickness}px;transform:rotate(${angle}deg);--d:${delay}ms`;
      fx.appendChild(link);

      const packet = document.createElement('div');
      packet.className = 'defeat-virus-packet';
      fx.appendChild(packet);
      if (typeof packet.animate === 'function') {
        packet.animate([
          { transform: `translate(${from.x}px,${from.y}px) scale(.6)`, opacity: 0 },
          { transform: `translate(${from.x}px,${from.y}px) scale(1)`, opacity: 1, offset: .12 },
          { transform: `translate(${to.x}px,${to.y}px) scale(1.35)`, opacity: .95, offset: .86 },
          { transform: `translate(${to.x}px,${to.y}px) scale(.4)`, opacity: 0 }
        ], {
          duration: 640 + (delay % 220),
          delay: delay + 70,
          easing: 'cubic-bezier(.4,0,.18,1)',
          fill: 'both'
        });
      }
    };

    seeds.forEach((seed, i) => addNode(seed, i * 80, 18 + i * 2, true));

    targets.forEach((target, i) => {
      const seed = seeds[i % seeds.length];
      const delay = 120 + (i * 73) % 1220;
      addLink(seed, target, delay, 1 + (i % 3));
      addNode(target, delay + 340, 8 + (i % 5) * 2, false);

      if (i > 2 && i % 3 === 0) {
        const branchFrom = targets[(i * 5 + 3) % targets.length];
        addLink(branchFrom, target, delay + 260, 1);
      }
    });

    gameLostPreludeTimer = setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.remove('is-virus-prelude');
      overlay.classList.add('is-ceremony');
      gameLostPreludeTimer = null;
    }, 2450);

    gameLostTimer = setTimeout(() => {
      if (!overlay.isConnected) return;
      overlay.classList.add('is-settled');
      gameLostTimer = null;
    }, 16950);

    return overlay;
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
    playMentionAllShake,
    playNemaAsoc,
    playOmen,
    playGameWon,
    playGameLost
  };
})();

window.Skeleton = Skeleton;
