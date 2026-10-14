// Private /commands directory. Never persisted or broadcast into room chat.
(() => {
  'use strict';
  let overlay = null;
  let focusReturn = null;
  const clamp = (value, limit) => String(value == null ? '' : value).slice(0, limit);

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    if (focusReturn?.isConnected && typeof focusReturn.focus === 'function') {
      focusReturn.focus({ preventScroll: true });
    }
    focusReturn = null;
  }

  function show(commands, options = {}) {
    // A malicious or stale server response must never create HTML from text.
    const entries = (Array.isArray(commands) ? commands : [])
      .filter(item => item && typeof item.name === 'string' && item.name.startsWith('/'))
      .slice(0, 120)
      .map(item => ({ name: clamp(item.name, 36), help: clamp(item.help, 220) }));
    if (overlay) close();
    focusReturn = document.activeElement;
    overlay = document.createElement('div');
    overlay.className = 'asoc-command-directory-backdrop';
    overlay.dataset.privateDirectory = 'true';
    overlay.setAttribute('role', 'presentation');

    const panel = document.createElement('section');
    panel.className = 'asoc-command-directory';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Private command directory');

    const header = document.createElement('header');
    header.className = 'asoc-command-directory-header';
    const heading = document.createElement('div');
    const kicker = document.createElement('div');
    kicker.className = 'asoc-command-directory-kicker';
    kicker.textContent = options.isHost ? 'SHADOW BROKER // PRIVATE ACCESS' : 'LITTLE HERO // PRIVATE ACCESS';
    const title = document.createElement('h2');
    title.textContent = 'COMMAND DIRECTORY';
    heading.append(kicker, title);
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'asoc-command-directory-close';
    dismiss.textContent = '✕';
    dismiss.setAttribute('aria-label', 'Close command directory');
    dismiss.addEventListener('click', close);
    header.append(heading, dismiss);

    const summary = document.createElement('p');
    summary.className = 'asoc-command-directory-summary';
    summary.textContent = entries.length
      ? entries.length + ' AVAILABLE COMMANDS // ONLY YOU CAN SEE THIS DIRECTORY'
      : 'NO COMMANDS AVAILABLE';
    const list = document.createElement('div');
    list.className = 'asoc-command-directory-list';
    list.setAttribute('role', 'list');
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'asoc-command-directory-row';
      row.setAttribute('role', 'listitem');
      const code = document.createElement('code');
      code.textContent = entry.name;
      const help = document.createElement('span');
      help.textContent = entry.help;
      row.append(code, help);
      list.append(row);
    }
    panel.append(header, summary, list);
    overlay.append(panel);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        // Keep keyboard focus in this otherwise static, private overlay.
        event.preventDefault();
        dismiss.focus();
      }
    });
    document.body.appendChild(overlay);
    dismiss.focus({ preventScroll: true });
  }

  window.ASOCCommandDirectory = { show, close, isOpen: () => Boolean(overlay) };
})();
