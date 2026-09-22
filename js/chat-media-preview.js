(() => {
  const TRIGGER_SELECTOR = '.chat-image-link, .chat-gif-link, .gm-chat-gif-link';
  let overlay = null;
  let stage = null;
  let closeButton = null;
  let returnFocus = null;

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;

    overlay = document.createElement('div');
    overlay.className = 'chat-media-lightbox';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Chat media preview');
    overlay.innerHTML = `
      <div class="chat-media-lightbox-shell">
        <button type="button" class="chat-media-lightbox-close" aria-label="Close media preview">×</button>
        <div class="chat-media-lightbox-stage"></div>
        <div class="chat-media-lightbox-hint">CLICK OUTSIDE OR PRESS ESC TO CLOSE</div>
      </div>
    `;

    document.body.appendChild(overlay);
    stage = overlay.querySelector('.chat-media-lightbox-stage');
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
      preview.className = 'chat-media-lightbox-media';
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
      return preview;
    }

    const image = trigger.querySelector('img');
    if (image) {
      const source = image.currentSrc || image.src || '';
      if (!source) return null;
      const preview = document.createElement('img');
      preview.className = 'chat-media-lightbox-media';
      preview.src = source;
      preview.alt = image.alt || 'Chat media';
      return preview;
    }

    return null;
  }

  function open(trigger) {
    const media = mediaFromTrigger(trigger);
    if (!media) return;

    ensureOverlay();
    returnFocus = trigger;
    stage.replaceChildren(media);
    overlay.hidden = false;
    document.body.classList.add('chat-media-preview-open');

    if (media instanceof HTMLVideoElement) {
      media.play().catch(() => {});
    }

    requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    stage?.querySelector('video')?.pause();
    stage?.replaceChildren();
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
    }
  }, true);

  window.ChatMediaPreview = { open, close };
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

    const uriList = String(transfer.getData?.('text/uri-list') || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line && !line.startsWith('#'));
    if (uriList && /^https?:\/\//i.test(uriList)) return uriList;

    const plain = String(transfer.getData?.('text/plain') || '').trim();
    if (!plain || /\s/.test(plain)) return '';
    return /^https?:\/\//i.test(plain) ? plain : '';
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
      if (!/^https?:\/\//i.test(clean)) return false;
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
      const transfer = event.dataTransfer;
      const file = imageFileFromTransfer(transfer);
      const url = file ? '' : imageUrlFromTransfer(transfer);
      if (!file && !url) return false;
      event.preventDefault();
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
