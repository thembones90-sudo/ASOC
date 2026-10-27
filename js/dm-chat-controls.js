// Private transport, public-chat controls. Reuse the real public catalogs,
// favorites and attachment markup instead of maintaining another emoji pack.
(() => {
  'use strict';
  const contexts = new WeakMap();
  let current = null;
  function close() {
    if (!current) return;
    const { popup, anchor } = current;
    popup.remove(); anchor?.setAttribute('aria-expanded', 'false');
    current = null;
  }
  function app(host) { return host ? window.App : window.PlayerApp; }
  function renderPicker() {
    const { popup, host, reaction } = current;
    const owner = app(host);
    if (host) owner.renderGMEmojiPickers(reaction ? null : popup, reaction ? popup : null);
    else owner.renderChatEmojiPickers(reaction ? null : popup, reaction ? popup : null);
    const done = document.createElement('button');
    done.type = 'button'; done.className = 'dm-picker-close'; done.textContent = 'CLOSE';
    done.setAttribute('aria-label', 'Close private emoji picker');
    popup.querySelector('.gm-emoji-picker-head, .chat-emoji-picker-head')?.appendChild(done);
  }
  function place() {
    if (!current) return;
    const { anchor, popup } = current;
    if (!anchor.isConnected) return close();
    const rect = anchor.getBoundingClientRect();
    const inputTop = current.input?.getBoundingClientRect().top;
    const bottom = current.reaction && inputTop > 100 && inputTop < innerHeight ? inputTop - 8 : innerHeight - 8;
    popup.style.setProperty('max-height', `${Math.min(420, bottom - 8)}px`, 'important');
    // Mobile public-chat rules pin their own picker to bottom/left with
    // !important. This portal is anchored to a private message instead.
    popup.style.setProperty('bottom', 'auto', 'important');
    popup.style.setProperty('right', 'auto', 'important');
    const width = popup.offsetWidth, height = popup.offsetHeight;
    popup.style.setProperty('left', `${Math.max(8, Math.min(innerWidth - width - 8, rect.left))}px`, 'important');
    popup.style.setProperty('top', `${Math.max(8, Math.min(bottom - height, rect.top - height - 8))}px`, 'important');
  }
  function inputOf(root, host) { return root.querySelector(host ? '[data-gm-dm-input]' : '#dmx-input'); }
  function selection(input) {
    if (!input) return null;
    if (!input.isContentEditable) return { start: input.selectionStart || 0, end: input.selectionEnd || 0 };
    const sel = getSelection();
    return sel?.rangeCount && input.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  }
  function insert(input, emoji, saved) {
    if (!input?.isConnected || input.disabled) return;
    input.focus();
    if (input.isContentEditable) {
      const range = saved?.cloneRange ? saved : document.createRange();
      if (!saved?.cloneRange) { range.selectNodeContents(input); range.collapse(false); }
      range.deleteContents(); const text = document.createTextNode(emoji); range.insertNode(text);
      range.setStartAfter(text); range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    } else {
      const start = saved?.start ?? input.value.length, end = saved?.end ?? input.value.length;
      if (input.maxLength > 0 && input.value.length - (end - start) + emoji.length > input.maxLength) return;
      input.setRangeText(emoji, start, end, 'end');
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function open(root, anchor, messageId) {
    if (current?.anchor === anchor) return close();
    close();
    const ctx = contexts.get(root);
    if (!ctx || !app(ctx.host)) return;
    const input = inputOf(root, ctx.host), saved = selection(input);
    const popup = document.createElement('div');
    popup.className = `dm-chat-picker ${ctx.host ? 'gm-chat-floating-emoji-picker' : 'chat-floating-emoji-picker'}`;
    popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', messageId ? 'Private message reactions' : 'Private message emojis');
    current = { ...ctx, root, anchor, popup, input, saved, messageId, reaction: !!messageId };
    document.body.appendChild(popup); anchor.setAttribute('aria-expanded', 'true');
    renderPicker(); place();
    popup.querySelector('button')?.focus({ preventScroll: true });
    popup.addEventListener('click', event => {
      event.stopPropagation();
      if (!current || current.popup !== popup) return;
      const owner = app(ctx.host), prefix = ctx.host ? '_gmEmoji' : '_emoji';
      if (event.target.closest('.dm-picker-close')) return close();
      if (event.target.closest('.gm-emoji-edit-toggle, .chat-emoji-edit-toggle')) {
        owner[`${prefix}FavoritesEditing`] = !owner[`${prefix}FavoritesEditing`];
        owner[`${prefix}FavoriteSlot`] ||= 0;
        renderPicker(); place(); return;
      }
      const option = event.target.closest('[data-emoji]');
      if (!option) return;
      if (owner[`${prefix}FavoritesEditing`]) {
        if (option.dataset.favoriteSlot !== undefined) owner[`${prefix}FavoriteSlot`] = Number(option.dataset.favoriteSlot);
        else {
          const replace = ctx.host ? 'replaceGMEmojiFavorite' : 'replaceChatEmojiFavorite';
          owner[replace](owner[`${prefix}FavoriteSlot`] || 0, option.dataset.emoji);
          owner[`${prefix}FavoriteSlot`] = ((owner[`${prefix}FavoriteSlot`] || 0) + 1) % 5;
        }
        renderPicker(); place(); return;
      }
      const active = current;
      close();
      if (active.reaction) active.react(active.messageId, option.dataset.emoji);
      else insert(active.input, option.dataset.emoji, active.saved);
    });
  }
  function sync(root, options) {
    if (!root) return;
    contexts.set(root, options);
    if (current?.root === root) {
      if (root.hidden || current.thread !== options.thread) close();
      else if (!current.anchor.isConnected) {
        const prefix = options.host ? 'gm-dm' : 'dmx';
        const next = current.reaction
          ? root.querySelector(`[data-${prefix}-reaction-open="${CSS.escape(current.messageId)}"]`)
          : root.querySelector(`[data-${prefix}-emoji]`);
        if (!next) close();
        else {
          current.anchor = next; current.input = inputOf(root, options.host);
          if (options.host) current.saved = null;
          next.setAttribute('aria-expanded', 'true'); queueMicrotask(place);
        }
      }
    }
    const host = options.host, prefix = host ? 'gm-dm' : 'dmx';
    // Exact same option labels, artwork and ordering as the general chat.
    const sourceAttr = host ? 'data-gm-attachment' : 'data-chat-attachment';
    const menu = root.querySelector(`.${prefix}-attachment-menu`);
    if (menu) {
      menu.replaceChildren(...[...document.querySelectorAll(`[${sourceAttr}]`)].map(source => {
        const button = source.cloneNode(true), action = source.getAttribute(sourceAttr);
        button.removeAttribute(sourceAttr); button.removeAttribute('id');
        button.setAttribute(`data-${prefix}-${action}`, '');
        return button;
      }));
    }
    const gifPicker = root.querySelector(`.${prefix}-gif-picker`);
    if (gifPicker && !gifPicker.querySelector('.dm-gif-upload')) {
      const upload = document.createElement('button'); upload.type = 'button';
      upload.className = 'dm-gif-upload'; upload.textContent = 'UPLOAD GIF';
      upload.setAttribute(`data-${prefix}-image`, ''); gifPicker.appendChild(upload);
    }
    // Poll configuration uses the same duration choices as general chat.
    const poll = root.querySelector(`[data-${prefix}-poll-maker]`);
    const duration = document.getElementById(host ? 'gm-poll-duration' : 'chat-poll-duration');
    if (poll && duration && !poll.querySelector('[name="duration"]')) {
      const label = document.createElement('label'); label.textContent = 'TIMER ';
      const copy = duration.cloneNode(true); copy.removeAttribute('id'); copy.name = 'duration';
      label.appendChild(copy); poll.insertBefore(label, poll.lastElementChild);
    }
    const input = inputOf(root, host);
    // The player gets the same single capsule and in-bar controls as public
    // chat, rather than separate emoji/voice buttons and an extra SEND pill.
    if (!host && input) {
      const shell = root.querySelector('.dmx-compose');
      const wrap = root.querySelector('.dmx-attachment-wrap');
      const emoji = root.querySelector('[data-dmx-emoji]');
      const voice = root.querySelector('.dmx-mic');
      shell?.classList.add('chat-composer-shell', 'dm-shared-capsule');
      if (wrap) shell?.insertBefore(wrap, input);
      if (emoji) shell?.insertBefore(emoji, input);
      if (voice) {
        const publicVoice = document.getElementById('chat-voice-btn');
        if (publicVoice) voice.innerHTML = publicVoice.innerHTML;
        voice.setAttribute('aria-label', 'Record voice message'); shell?.appendChild(voice);
      }
      root.querySelector('.dmx-send')?.setAttribute('hidden', '');
    }
    if (input && window.EmojiShortcodes) {
      window.EmojiShortcodes.attach({ input, host: input.closest('.gm-composer-shell, .dmx-public-composer') || input.parentElement,
        getState() {
          if (!input.isContentEditable) return { text: input.value, caret: input.selectionStart, collapsed: input.selectionStart === input.selectionEnd };
          const sel = getSelection();
          if (!sel?.rangeCount || !input.contains(sel.anchorNode)) return null;
          const range = sel.getRangeAt(0).cloneRange(); range.selectNodeContents(input); range.setEnd(sel.anchorNode, sel.anchorOffset);
          return { text: input.textContent, caret: range.toString().length, collapsed: sel.isCollapsed };
        },
        apply(start, end, value) {
          if (!input.isContentEditable) return insert(input, value, { start, end });
          const text = input.textContent;
          input.textContent = text.slice(0, start) + value + text.slice(end);
          input.focus(); const range = document.createRange(); range.setStart(input.firstChild, start + value.length); range.collapse(true);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, boost: () => new Set(app(host)?.chatReactionEmojis || []),
        extra: host ? query => {
          const ce = window.CommanderEmojis;
          return (ce?.tokens || []).filter(token => token.slice(1, -1).includes(query) || ce.label(token).toLowerCase().includes(query))
            .map(token => ({ insert: token, name: token.slice(1, -1), html: ce.html(token, 'esc-commander') }));
        } : undefined });
      // Private read/list acknowledgments can rebuild the composer while a
      // draft is being typed. Restore autocomplete after draft/focus hydration.
      queueMicrotask(() => {
        if (input.isConnected && document.activeElement === input) input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }
  document.addEventListener('click', event => {
    const root = event.target.closest?.('#gm-dm-console, #direct-messages');
    if (current && !current.popup.contains(event.target) && event.target !== current.anchor && !current.anchor.contains(event.target)) close();
    for (const node of document.querySelectorAll('#gm-dm-console, #direct-messages')) {
      if (!node.hidden && !node.contains(event.target) && !event.target.closest('.dm-chat-picker') && node.querySelector('.gm-dm-attachment-menu, .dmx-attachment-menu, .gm-dm-gif-picker, .dmx-gif-picker')) contexts.get(node)?.closeMenus?.();
    }
    if (!root || !contexts.has(root)) return;
    const trigger = event.target.closest('[data-gm-dm-reaction-open], [data-dmx-reaction-open], [data-gm-dm-emoji], [data-dmx-emoji]');
    const chip = event.target.closest('[data-gm-dm-react], [data-dmx-react]');
    if (!trigger && !chip) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (trigger) return open(root, trigger, trigger.dataset.gmDmReactionOpen || trigger.dataset.dmxReactionOpen);
    close(); contexts.get(root).react(chip.dataset.messageId, chip.dataset.gmDmReact || chip.dataset.dmxReact);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (current) { const anchor = current.anchor; close(); event.preventDefault(); event.stopImmediatePropagation(); anchor?.focus({ preventScroll: true }); return; }
    const root = event.target.closest?.('#gm-dm-console, #direct-messages');
    if (root?.querySelector('.gm-dm-attachment-menu, .dmx-attachment-menu, .gm-dm-gif-picker, .dmx-gif-picker, .gm-dm-poll-maker, .dmx-poll-maker')) {
      event.preventDefault(); event.stopImmediatePropagation(); contexts.get(root)?.closeMenus?.();
    }
  }, true);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', event => { if (current && !current.popup.contains(event.target)) place(); }, true);
  window.DMChatControls = { sync, close };
})();
