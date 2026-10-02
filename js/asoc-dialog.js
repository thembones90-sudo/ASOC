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
      validate = null,
      selectEnd = null,   // select only [0, selectEnd) -- e.g. a file name without its extension
      confirmOnly = false // yes/no question, no text field (resolves true / null)
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
      if (confirmOnly) { input.hidden = true; countEl.hidden = true; }
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
        // Enter answers a yes/no question even if a page hotkey would eat it.
        if (confirmOnly && event.key === 'Enter' && !event.target?.classList?.contains('asoc-dialog-cancel')) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(null);
        }
      };

      form.addEventListener('submit', event => {
        event.preventDefault();
        if (confirmOnly) return close(true);
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
      // Desktop GM surfaces install several document-level keyboard handlers.
      // A modal text field owns printable/editing keys completely; letting those
      // keystrokes bubble into board/chat shortcuts can cancel the browser's
      // native edit operation in the Electron shell.
      ['keydown', 'keypress', 'keyup', 'beforeinput'].forEach(type => {
        input.addEventListener(type, event => {
          if (type === 'keydown' && event.key === 'Escape') return;
          event.stopPropagation();
          event.stopImmediatePropagation();
        });
      });
      input.addEventListener('pointerdown', event => event.stopPropagation());
      input.addEventListener('click', event => { event.stopPropagation(); input.focus(); });
      document.addEventListener('keydown', onKeydown, true);

      active = { cancel: () => close(null) };
      document.body.appendChild(overlay);
      updateCount();
      requestAnimationFrame(() => {
        input.disabled = false;
        input.readOnly = false;
        if (confirmOnly) { overlay.querySelector('.asoc-dialog-confirm').focus({ preventScroll: true }); return; }
        input.focus({ preventScroll: true });
        if (Number.isInteger(selectEnd) && selectEnd > 0) input.setSelectionRange(0, selectEnd);
        else input.select();
      });
    });
  }

  // In-page replacement for window.confirm(). A native confirm() in the
  // Electron desktop app leaves text fields unable to take typing until the
  // window is refocused, so GM surfaces use this instead. Resolves true/false.
  function confirm(options = {}) {
    return prompt({ title: 'ARE YOU SURE?', confirmLabel: 'OK', ...options, confirmOnly: true }).then(result => result === true);
  }

  window.AsocDialog = { prompt, confirm };
})();
