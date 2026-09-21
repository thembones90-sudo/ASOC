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
