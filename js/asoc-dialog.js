// ASOC in-page text dialog.
//
// window.prompt() is unavailable in the ASOC desktop app (Electron does not
// implement it) and renders as an unstyled OS box in browsers, so every text
// request goes through this instead. Resolves to the trimmed string, or null
// when cancelled (Escape, CANCEL, or clicking the backdrop).
(function () {
  let active = null;

  function prompt(options = {}) {
    if (active) active.cancel();
    const {
      title = 'INPUT REQUIRED',
      message = '',
      value = '',
      placeholder = '',
      maxLength = 0,
      required = false,
      confirmLabel = 'CONFIRM',
      validate = null
    } = options;

    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.className = 'asoc-dialog-overlay';
      overlay.innerHTML = `
        <form class="asoc-dialog" role="dialog" aria-modal="true" aria-labelledby="asoc-dialog-title" novalidate>
          <div class="asoc-dialog-title" id="asoc-dialog-title"></div>
          <div class="asoc-dialog-message"></div>
          <input class="asoc-dialog-input" type="text" autocomplete="off" spellcheck="true">
          <div class="asoc-dialog-meta">
            <span class="asoc-dialog-error" role="alert"></span>
            <span class="asoc-dialog-count"></span>
          </div>
          <div class="asoc-dialog-actions">
            <button type="button" class="toolbar-btn asoc-dialog-cancel">CANCEL</button>
            <button type="submit" class="toolbar-btn asoc-dialog-confirm"></button>
          </div>
        </form>`;

      const form = overlay.querySelector('form');
      const input = overlay.querySelector('.asoc-dialog-input');
      const errorEl = overlay.querySelector('.asoc-dialog-error');
      const countEl = overlay.querySelector('.asoc-dialog-count');
      const messageEl = overlay.querySelector('.asoc-dialog-message');
      overlay.querySelector('.asoc-dialog-title').textContent = title;
      overlay.querySelector('.asoc-dialog-confirm').textContent = confirmLabel;
      messageEl.textContent = message;
      messageEl.hidden = !message;
      input.value = String(value ?? '');
      input.placeholder = placeholder;
      if (maxLength > 0) input.maxLength = maxLength;

      const updateCount = () => {
        countEl.textContent = maxLength > 0 ? `${input.value.length}/${maxLength}` : '';
        errorEl.textContent = '';
      };

      const close = result => {
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
        active = null;
        if (previousFocus && typeof previousFocus.focus === 'function') {
          try { previousFocus.focus(); } catch {}
        }
        resolve(result);
      };

      const onKeydown = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(null);
        }
      };

      form.addEventListener('submit', event => {
        event.preventDefault();
        const clean = input.value.trim();
        let error = '';
        if (required && !clean) error = 'A value is required.';
        else if (maxLength > 0 && clean.length > maxLength) error = `Must be ${maxLength} characters or fewer.`;
        else if (typeof validate === 'function') error = validate(clean) || '';
        if (error) {
          errorEl.textContent = error;
          input.focus();
          return;
        }
        close(clean);
      });
      overlay.querySelector('.asoc-dialog-cancel').addEventListener('click', () => close(null));
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) close(null);
      });
      input.addEventListener('input', updateCount);
      document.addEventListener('keydown', onKeydown, true);

      active = { cancel: () => close(null) };
      document.body.appendChild(overlay);
      updateCount();
      input.focus();
      input.select();
    });
  }

  window.AsocDialog = { prompt };
})();
