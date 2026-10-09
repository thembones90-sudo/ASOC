(() => {
  const TRIGGER_SELECTOR = '.chat-image-link, .chat-gif-link, .gm-chat-gif-link, .avatar-preview-trigger';

  const OVERLAY_CLASS = 'chat-media-lightbox';
  const MEDIA_CLASS = 'chat-media-lightbox-media';

  // Right-clicking the opened preview image must reach the browser's own menu
  // ("Save image as…"), and that is only true while nothing cancels the event.
  //
  // Event order matters, and it is the opposite of what the old fix assumed.
  // Propagation runs window -> document -> ... -> target, so a listener added
  // ON the <img> is the LAST thing that runs: by then the document-level
  // capture handlers in player.js/app.js have already called preventDefault()
  // and the native menu is already gone. The window capture phase is the only
  // place ASOC can still get in front of them.
  //
  // stopPropagation() (never preventDefault) is deliberate: it keeps ASOC's
  // chat menu from seeing the event while leaving the event uncancelled so the
  // browser still renders its native image menu.
  function isOpenedMediaTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest(`.${OVERLAY_CLASS} .${MEDIA_CLASS}`)
      || target.classList?.contains(MEDIA_CLASS) === true;
  }

  window.addEventListener('contextmenu', (event) => {
    if (!isOpenedMediaTarget(event.target)) return;
    event.stopPropagation();
  }, true);
  let overlay = null;
  let stage = null;
  let caption = null;
  let closeButton = null;
  let returnFocus = null;

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;

    overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Chat media preview');
    overlay.innerHTML = `
      <div class="chat-media-lightbox-shell">
        <button type="button" class="chat-media-lightbox-close" aria-label="Close media preview">×</button>
        <div class="chat-media-lightbox-stage"></div>
        <div class="chat-media-lightbox-caption" hidden></div>
        <div class="chat-media-lightbox-hint">CLICK OUTSIDE OR PRESS ESC TO CLOSE</div>
      </div>
    `;

    document.body.appendChild(overlay);
    stage = overlay.querySelector('.chat-media-lightbox-stage');
    caption = overlay.querySelector('.chat-media-lightbox-caption');
    closeButton = overlay.querySelector('.chat-media-lightbox-close');

    closeButton?.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    return overlay;
  }

  function mediaFromTrigger(trigger) {
    const video = trigger.querySelector('video');
    if (video) {
      const source = video.currentSrc || video.querySelector('source')?.src || '';
      if (!source) return null;

      const preview = document.createElement('video');
      preview.className = MEDIA_CLASS;
      preview.autoplay = true;
      preview.loop = true;
      preview.muted = true;
      preview.playsInline = true;
      preview.preload = 'metadata';
      if (video.poster) preview.poster = video.poster;

      const sourceEl = document.createElement('source');
      sourceEl.src = source;
      sourceEl.type = video.querySelector('source')?.type || 'video/mp4';
      preview.appendChild(sourceEl);
      // Same rule as images: an opened GIF keeps the browser's own menu.
      preview.addEventListener('contextmenu', event => event.stopPropagation());
      return preview;
    }

    const image = trigger.querySelector('img');
    if (image) {
      const source = image.currentSrc || image.src || '';
      if (!source) return null;
      const preview = document.createElement('img');
      preview.className = MEDIA_CLASS;
      preview.src = source;
      preview.alt = image.alt || 'Chat media';
      // Preserve the browser's native image context menu in the lightbox so
      // every user can right-click the opened image and use "Save image as…".
      // Belt and braces: the window capture handler above is what actually
      // gets ahead of the chat menus, but leaving the target clean as well
      // means the event also survives handlers bound below the document.
      preview.addEventListener('contextmenu', (event) => {
        event.stopPropagation();
      });
      return preview;
    }

    return null;
  }

  // ZOOM // examine an opened image. Wheel or pinch zooms toward the pointer,
  // drag pans, double-click toggles, and the bar offers + / - / FIT / 1:1.
  // The picture is pinned to the stage (absolute, contain-style fit) so a tall
  // photo can never overflow and get clipped the way it used to.
  const ZOOM_STYLE_ID = 'chat-media-zoom-style';
  const HINT_DEFAULT = 'CLICK OUTSIDE OR PRESS ESC TO CLOSE';
  const HINT_IMAGE = 'SCROLL OR PINCH TO ZOOM // DRAG TO PAN // DOUBLE-CLICK TO TOGGLE // ESC TO CLOSE';
  const ZOOM_STEP = 1.4;
  let zoomState = null;

  function ensureZoomStyles() {
    if (document.getElementById(ZOOM_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = ZOOM_STYLE_ID;
    style.textContent = `
      .${OVERLAY_CLASS}:not(.is-avatar-preview) .chat-media-lightbox-stage { position: relative; }
      .${OVERLAY_CLASS}:not(.is-avatar-preview) .chat-media-lightbox-stage img.${MEDIA_CLASS} {
        position: absolute; inset: 0;
        width: 100% !important; height: 100% !important;
        max-width: none !important; max-height: none !important;
        object-fit: scale-down !important; border-radius: 0;
        touch-action: none; user-select: none; -webkit-user-select: none;
        transform-origin: 50% 50%; will-change: transform; cursor: zoom-in;
      }
      .${OVERLAY_CLASS} img.${MEDIA_CLASS}.is-zoomed { cursor: grab; }
      .${OVERLAY_CLASS} img.${MEDIA_CLASS}.is-zoomed:active { cursor: grabbing; }
      .chat-media-zoom-bar {
        position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 3;
        display: flex; align-items: center; gap: 4px; padding: 5px;
        border: 1px solid rgba(159, 171, 184, .45); border-radius: 999px;
        background: rgba(8, 11, 15, .84); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      }
      .chat-media-zoom-bar button {
        min-width: 34px; height: 30px; padding: 0 10px;
        border: 1px solid rgba(159, 171, 184, .4); border-radius: 999px;
        background: linear-gradient(180deg, #252b32, #0d1116); color: #e7edf3;
        font: 800 11px/1 var(--font-machine, monospace); letter-spacing: .08em; cursor: pointer;
      }
      .chat-media-zoom-bar button:hover, .chat-media-zoom-bar button:focus-visible { outline: none; border-color: #d6e0ea; color: #fff; }
      .chat-media-zoom-level { min-width: 50px; text-align: center; color: #c9d2db; font: 800 11px/1 var(--font-machine, monospace); }
      /* Blood Tribute pictures are evidence: show the whole photo, never a crop. */
      body .blood-tribute-public-image,
      body:is(.room-mode-battle, .room-mode-battle-armed, .room-mode-recount) .blood-tribute-public-image {
        object-fit: contain !important; max-height: min(46vh, 300px) !important; cursor: zoom-in;
      }
      .blood-vault-image { height: 220px; }
      .blood-vault-image img { object-fit: contain !important; background: #050608; }
    `;
    document.head.appendChild(style);
  }

  function detachZoom() {
    if (!zoomState) return;
    window.removeEventListener('resize', zoomState.onResize);
    zoomState.bar?.remove();
    zoomState = null;
    const hint = overlay?.querySelector('.chat-media-lightbox-hint');
    if (hint) hint.textContent = HINT_DEFAULT;
  }

  function attachZoom(img) {
    detachZoom();
    ensureZoomStyles();
    const hint = overlay.querySelector('.chat-media-lightbox-hint');
    if (hint) hint.textContent = HINT_IMAGE;

    const bar = document.createElement('div');
    bar.className = 'chat-media-zoom-bar';
    bar.innerHTML = '<button type="button" data-zoom="out" aria-label="Zoom out">−</button>'
      + '<output class="chat-media-zoom-level">100%</output>'
      + '<button type="button" data-zoom="in" aria-label="Zoom in">+</button>'
      + '<button type="button" data-zoom="fit" aria-label="Fit to screen">FIT</button>'
      + '<button type="button" data-zoom="actual" aria-label="Actual size">1:1</button>';
    stage.appendChild(bar);
    const level = bar.querySelector('.chat-media-zoom-level');

    const st = { img, bar, scale: 1, x: 0, y: 0, onResize: null };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    img.draggable = false;

    const metrics = () => {
      const r = stage.getBoundingClientRect();
      const nw = img.naturalWidth || r.width || 1;
      const nh = img.naturalHeight || r.height || 1;
      const fit = Math.min(1, r.width / nw, r.height / nh) || 1;
      return { r, sw: r.width, sh: r.height, dw: nw * fit, dh: nh * fit, fit };
    };
    const maxScale = m => Math.max(8, 4 / m.fit);

    const apply = () => {
      const m = metrics();
      st.scale = clamp(st.scale, 1, maxScale(m));
      const lx = Math.max(0, (m.dw * st.scale - m.sw) / 2);
      const ly = Math.max(0, (m.dh * st.scale - m.sh) / 2);
      st.x = clamp(st.x, -lx, lx);
      st.y = clamp(st.y, -ly, ly);
      const idle = st.scale <= 1.0001 && !st.x && !st.y;
      img.style.transform = idle ? '' : `translate(${st.x.toFixed(2)}px, ${st.y.toFixed(2)}px) scale(${st.scale.toFixed(4)})`;
      img.classList.toggle('is-zoomed', st.scale > 1.001);
      level.textContent = `${Math.round(st.scale * m.fit * 100)}%`;
    };

    // cx/cy are measured from the stage centre; that point stays put.
    const zoomTo = (next, cx = 0, cy = 0) => {
      const m = metrics();
      next = clamp(next, 1, maxScale(m));
      const k = next / st.scale;
      st.x = cx - (cx - st.x) * k;
      st.y = cy - (cy - st.y) * k;
      st.scale = next;
      apply();
    };
    const fromCentre = (clientX, clientY) => {
      const r = stage.getBoundingClientRect();
      return [clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2)];
    };

    stage.addEventListener('wheel', (event) => {
      if (!st.img.isConnected) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 33 : 1;
      const factor = Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.0018));
      const [cx, cy] = fromCentre(event.clientX, event.clientY);
      zoomTo(st.scale * factor, cx, cy);
    }, { passive: false });

    const pointers = new Map();
    let pinch = null;
    img.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;
      try { img.setPointerCapture(event.pointerId); } catch (_) {}
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: st.scale };
      }
    });
    img.addEventListener('pointermove', (event) => {
      const prev = pointers.get(event.pointerId);
      if (!prev) return;
      const now = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, now);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const [cx, cy] = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomTo(pinch.scale * (dist / pinch.dist), cx, cy);
      } else if (pointers.size === 1 && st.scale > 1.001) {
        st.x += now.x - prev.x;
        st.y += now.y - prev.y;
        apply();
      }
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    img.addEventListener('pointerup', release);
    img.addEventListener('pointercancel', release);

    img.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (st.scale > 1.05) {
        st.scale = 1; st.x = 0; st.y = 0; apply();
        return;
      }
      const [cx, cy] = fromCentre(event.clientX, event.clientY);
      zoomTo(Math.max(2, 1 / metrics().fit), cx, cy);
    });

    bar.addEventListener('pointerdown', event => event.stopPropagation());
    bar.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-zoom]');
      if (!button) return;
      event.stopPropagation();
      const action = button.dataset.zoom;
      if (action === 'in') zoomTo(st.scale * ZOOM_STEP);
      else if (action === 'out') zoomTo(st.scale / ZOOM_STEP);
      else if (action === 'fit') { st.scale = 1; st.x = 0; st.y = 0; apply(); }
      else if (action === 'actual') zoomTo(1 / metrics().fit);
    });

    st.onResize = () => apply();
    window.addEventListener('resize', st.onResize);
    img.addEventListener('load', apply);
    zoomState = st;
    st.api = { zoomTo, apply, pan(dx, dy) { st.x += dx; st.y += dy; apply(); }, reset() { st.scale = 1; st.x = 0; st.y = 0; apply(); }, step: ZOOM_STEP };
    apply();
  }

  document.addEventListener('keydown', (event) => {
    if (!zoomState || !overlay || overlay.hidden || event.ctrlKey || event.metaKey || event.altKey) return;
    const api = zoomState.api;
    let handled = true;
    if (event.key === '+' || event.key === '=') api.zoomTo(zoomState.scale * api.step);
    else if (event.key === '-' || event.key === '_') api.zoomTo(zoomState.scale / api.step);
    else if (event.key === '0') api.reset();
    else if (zoomState.scale > 1.001 && event.key === 'ArrowLeft') api.pan(60, 0);
    else if (zoomState.scale > 1.001 && event.key === 'ArrowRight') api.pan(-60, 0);
    else if (zoomState.scale > 1.001 && event.key === 'ArrowUp') api.pan(0, 60);
    else if (zoomState.scale > 1.001 && event.key === 'ArrowDown') api.pan(0, -60);
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  function open(trigger) {
    const media = mediaFromTrigger(trigger);
    if (!media) return;

    ensureOverlay();
    returnFocus = trigger;
    const isAvatar = trigger.matches('.avatar-preview-trigger');
    const previewLabel = String(trigger.dataset.previewLabel || '').trim();
    overlay.classList.toggle('is-avatar-preview', isAvatar);
    overlay.setAttribute('aria-label', previewLabel ? `${previewLabel} preview` : 'Chat media preview');
    if (caption) {
      caption.textContent = previewLabel;
      caption.hidden = !previewLabel;
    }
    detachZoom();
    stage.replaceChildren(media);
    overlay.hidden = false;
    document.body.classList.add('chat-media-preview-open');
    if (!isAvatar && media instanceof HTMLImageElement) attachZoom(media);

    if (media instanceof HTMLVideoElement) {
      media.play().catch(() => {});
    }

    requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    stage?.querySelector('video')?.pause();
    detachZoom();
    stage?.replaceChildren();
    overlay.classList.remove('is-avatar-preview');
    if (caption) {
      caption.textContent = '';
      caption.hidden = true;
    }
    overlay.hidden = true;
    document.body.classList.remove('chat-media-preview-open');

    if (returnFocus?.isConnected) {
      try { returnFocus.focus({ preventScroll: true }); } catch (_) {}
    }
    returnFocus = null;
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.(TRIGGER_SELECTOR);
    if (!trigger) return;

    event.preventDefault();
    event.stopPropagation();
    open(trigger);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay && !overlay.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = event.target.closest?.(TRIGGER_SELECTOR);
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    open(trigger);
  }, true);

  ensureZoomStyles();

  window.ChatMediaPreview = { open, close, isOpenedMediaTarget };
})();


/* CHAT MEDIA COMPOSER // paste, drop and staged image attachments
   Shared by Shadow Broker and Little Hero composers. Humans discovered Ctrl+V
   decades ago; the terminal may as well acknowledge it. */
(() => {
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const MAX_BYTES = 5 * 1024 * 1024;

  function imageFileFromTransfer(transfer) {
    if (!transfer) return null;
    const files = Array.from(transfer.files || []);
    const direct = files.find(file => IMAGE_TYPES.has(String(file.type || '').toLowerCase()));
    if (direct) return direct;
    const items = Array.from(transfer.items || []);
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile?.();
      if (file && IMAGE_TYPES.has(String(file.type || '').toLowerCase())) return file;
    }
    return null;
  }

  function imageUrlFromTransfer(transfer) {
    if (!transfer) return '';
    const html = String(transfer.getData?.('text/html') || '');
    if (html) {
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const src = doc.querySelector('img[src]')?.getAttribute('src') || '';
        if (/^https?:\/\//i.test(src)) return src.trim();
      } catch (_) {}
    }

    const looksLikeImageUrl = value => {
      try {
        const url = new URL(String(value || '').trim());
        return /^https?:$/.test(url.protocol) && /\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname);
      } catch (_) {
        return false;
      }
    };

    const uriList = String(transfer.getData?.('text/uri-list') || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line && !line.startsWith('#'));
    if (looksLikeImageUrl(uriList)) return uriList;

    const plain = String(transfer.getData?.('text/plain') || '').trim();
    if (!plain || /\s/.test(plain)) return '';
    return looksLikeImageUrl(plain) ? plain : '';
  }

  function create(options = {}) {
    const form = options.form;
    if (!form) return null;

    let pending = null;
    let objectUrl = '';
    let submitting = false;

    const tray = document.createElement('div');
    tray.className = 'chat-pending-media';
    tray.hidden = true;
    tray.setAttribute('aria-live', 'polite');
    tray.innerHTML = `
      <div class="chat-pending-media-thumb"><img alt="Pending chat image"></div>
      <div class="chat-pending-media-copy">
        <b>IMAGE ATTACHED</b>
        <span>PRESS ENTER TO TRANSMIT</span>
      </div>
      <button type="button" class="chat-pending-media-remove" aria-label="Remove pending image">×</button>
    `;
    const shell = form.querySelector(options.shellSelector || '.chat-composer-shell, .gm-composer-shell');
    form.insertBefore(tray, shell || form.firstChild);

    const image = tray.querySelector('img');
    const title = tray.querySelector('.chat-pending-media-copy b');
    const detail = tray.querySelector('.chat-pending-media-copy span');
    const remove = tray.querySelector('.chat-pending-media-remove');

    const revoke = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    };

    const clear = () => {
      revoke();
      pending = null;
      tray.hidden = true;
      image.removeAttribute('src');
      form.classList.remove('has-pending-media');
      options.onStateChange?.(false);
    };

    const stageFile = (file) => {
      if (!file) return false;
      const type = String(file.type || '').toLowerCase();
      if (!IMAGE_TYPES.has(type)) {
        alert('PNG, JPG, WEBP or GIF images only.');
        return false;
      }
      if (file.size > MAX_BYTES) {
        alert('Image must be 5 MB or smaller.');
        return false;
      }
      revoke();
      objectUrl = URL.createObjectURL(file);
      pending = { kind: 'file', file };
      image.src = objectUrl;
      title.textContent = type === 'image/gif' ? 'GIF ATTACHED' : 'IMAGE ATTACHED';
      detail.textContent = 'PRESS ENTER TO TRANSMIT';
      tray.hidden = false;
      form.classList.add('has-pending-media');
      options.onStateChange?.(true);
      return true;
    };

    const stageUrl = (url) => {
      const clean = String(url || '').trim();
      // Only direct image URLs belong in the media pipeline. Ordinary links
      // must remain normal chat text so players can paste and send them.
      let isImageUrl = false;
      try {
        const parsed = new URL(clean);
        isImageUrl = /^https?:$/.test(parsed.protocol) && /\.(?:png|jpe?g|webp|gif)$/i.test(parsed.pathname);
      } catch (_) {}
      if (!isImageUrl) return false;
      revoke();
      pending = { kind: 'url', url: clean };
      image.src = clean;
      title.textContent = 'IMAGE LINK ATTACHED';
      detail.textContent = 'ASOC WILL VERIFY + IMPORT ON SEND';
      tray.hidden = false;
      form.classList.add('has-pending-media');
      options.onStateChange?.(true);
      return true;
    };

    const handlePaste = (event) => {
      if (event.__asocMediaHandled) return true;
      const transfer = event.clipboardData;
      const file = imageFileFromTransfer(transfer);
      if (file) {
        event.preventDefault();
        event.__asocMediaHandled = true;
        stageFile(file);
        return true;
      }
      const url = imageUrlFromTransfer(transfer);
      if (url) {
        event.preventDefault();
        event.__asocMediaHandled = true;
        stageUrl(url);
        return true;
      }
      return false;
    };

    const handleDrop = (event) => {
      if (event.__asocMediaHandled) return true;
      const transfer = event.dataTransfer;
      const file = imageFileFromTransfer(transfer);
      const url = file ? '' : imageUrlFromTransfer(transfer);
      if (!file && !url) return false;
      event.preventDefault();
      event.__asocMediaHandled = true;
      if (file) stageFile(file);
      else stageUrl(url);
      return true;
    };

    const submit = async () => {
      if (!pending || submitting) return false;
      submitting = true;
      form.classList.add('media-submitting');
      remove.disabled = true;
      try {
        const caption = String(options.getCaption?.() || '').trim();
        if (pending.kind === 'file') await options.uploadFile?.(pending.file, caption);
        else await options.uploadUrl?.(pending.url, caption);
        clear();
        options.clearCaption?.();
        options.focus?.();
        return true;
      } catch (error) {
        alert(error?.message || 'Image transmission failed');
        return false;
      } finally {
        submitting = false;
        form.classList.remove('media-submitting');
        remove.disabled = false;
      }
    };

    remove.addEventListener('click', () => {
      clear();
      options.focus?.();
    });

    // Capture paste at the form boundary as well as the concrete input.
    // Some browsers/mobile paths do not reliably reach the input listener
    // with image-address clipboard metadata, but they do bubble through form.
    form.addEventListener('paste', (event) => {
      handlePaste(event);
    }, true);

    form.addEventListener('dragover', (event) => {
      const file = imageFileFromTransfer(event.dataTransfer);
      const url = file ? '' : imageUrlFromTransfer(event.dataTransfer);
      if (!file && !url) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      form.classList.add('media-dragover');
    });
    form.addEventListener('dragleave', () => form.classList.remove('media-dragover'));
    form.addEventListener('drop', (event) => {
      form.classList.remove('media-dragover');
      handleDrop(event);
    });

    return {
      clear,
      stageFile,
      stageUrl,
      handlePaste,
      handleDrop,
      submit,
      hasPending: () => !!pending,
      isSubmitting: () => submitting
    };
  }

  window.ChatMediaComposer = {
    create,
    imageFileFromTransfer,
    imageUrlFromTransfer
  };
})();
