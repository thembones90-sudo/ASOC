/*
 * ASOC ENGINE - Skeleton Layout
 *
 * Shared positioning module for the ASOC poster skeleton
 * (`assets/ui/asoc-skeleton.png`, canonical 1900 x 1267 canvas).
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
  const PNG = 'assets/ui/asoc-skeleton.png';

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
  // occupies ~60-70% of the pill no matter the board size.
  const RATIO_CLUE = 0.62;       // A1-D4: fill the pill height 60-65%
  const RATIO_SOLUTION = 0.68;   // A5/B5/C5/D5: column solutions, slightly bigger
  const RATIO_FINAL = 0.62;      // FINAL: inside the inner dark pill

  // Medium-bold clues; solutions and FINAL carry a bit more visual weight.
  const WEIGHT_CLUE = 600;
  const WEIGHT_SOLUTION = 700;
  const WEIGHT_FINAL = 700;

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

  function skeletonHTML() {
    return `<img class="skeleton-img" src="${PNG}" alt="">`;
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
      // 1.15 (not 1) on purpose: at line-height 1, several UI fonts (Segoe UI
      // bold in particular) render glyph ink taller than the nominal em box,
      // so scrollHeight under-reports the true rendered height and the pill's
      // own overflow can end up slicing through ascenders/descenders. 1.15
      // gives that headroom; the 0.85 budget below adds a further margin.
      txt.style.lineHeight = '1.15';
      txt.style.fontWeight = String(weightFor(label));

      // 2) Shrink ONLY when the rendered text exceeds the usable pill
      //    width (86-90% of the inner width so letters never touch the
      //    chrome). Short words stay untouched at scale 1.
      const maxW = Math.max(4, (pillW - padL - padR) * 0.9);
      let scale = 1;
      const tw = txt.scrollWidth;
      if (tw > maxW) scale = maxW / tw;
      const th = txt.scrollHeight;
      if (th > pillH * 0.85) scale = Math.min(scale, (pillH * 0.85) / th);

      if (scale < 1) {
        txt.style.transformOrigin = 'center center';
        txt.style.transform = 'scale(' + scale.toFixed(4) + ')';
      }
    }
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

  return {
    W,
    H,
    PNG,
    slots,
    supported,
    cellStyle,
    skeletonHTML,
    attach,
    fit
  };
})();

window.Skeleton = Skeleton;