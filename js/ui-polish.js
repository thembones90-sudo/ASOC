/* One lightweight action surface, reusing each chat's existing permissions and handlers. */
(() => {
  'use strict';
  const messageSelector = '#gm-chat-messages .gm-chat-message[data-message-id],#gm-chat-messages .gm-shadow-broker-entry[data-message-id],#chat-messages .chat-message[data-message-id],#chat-messages .chat-broker-entry[data-message-id],.gm-dm-msg,.dmx-msg';
  const paths = {
    reply: '<path d="m9 5-6 6 6 6M3 11h10a6 6 0 0 1 6 6v2"/>',
    react: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 3 4 3 4-3 4-3M8 9h.01M16 9h.01"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
    delete: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };
  let root, active, actions = [], hideTimer;
  function hide() { clearTimeout(hideTimer); if (root) root.hidden = true; active = null; }
  function prepare(message) {
    const native = message.querySelector('.gm-dm-actions,.dmx-message-actions');
    if (native) return [...native.querySelectorAll('button')].filter(b => !b.hidden).map(button => {
      const attrs = button.getAttributeNames().join(' ');
      const action = attrs.includes('reaction') ? 'react' : attrs.includes('reply') ? 'reply' : attrs.includes('edit') ? 'edit' : attrs.includes('delete') ? 'delete' : 'more';
      return { action, label: button.getAttribute('aria-label') || button.title || ({reply:'Reply',react:'React',edit:'Edit',delete:'Delete',more:'More options'}[action]), original: button };
    });
    const gm = !!message.closest('#gm-chat-messages');
    const owner = gm ? window.App : window.PlayerApp, id = message.dataset.messageId;
    if (!owner || !id) return [];
    const list = [{ action: 'reply', label: 'Reply' }, { action: 'react', label: 'React' }];
    if (message.dataset.editable === 'true') list.push({ action: 'edit', label: 'Edit' });
    if (gm ? owner.gmMessageDeletable?.(id) : owner.canDeleteChatMessage?.(id)) list.push({ action: 'delete', label: 'Delete' });
    list.push({ action: 'more', label: 'More options' });
    return list.map(item => ({ ...item, gm, owner }));
  }
  function place() {
    if (!active?.isConnected || active.getClientRects().length === 0) return hide();
    const bubble = active.querySelector('.gm-chat-message-main,.gm-shadow-broker-body,.chat-message-body') || active;
    const box = bubble.getBoundingClientRect();
    const scale = root.getBoundingClientRect().width / root.offsetWidth || 1;
    const width = root.getBoundingClientRect().width, height = root.getBoundingClientRect().height;
    root.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, box.right - width)) / scale}px`;
    root.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, box.top - height - 3)) / scale}px`;
  }
  function show(message) {
    clearTimeout(hideTimer);
    if (!message) return;
    if (active === message && !root.hidden) return place();
    const next = prepare(message); if (!next.length) return hide();
    active = message; actions = next;
    root.replaceChildren(...actions.map((item, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.index = index; button.dataset.action = item.action;
      button.title = item.label; button.setAttribute('aria-label', item.label);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[item.action]}</svg>`; return button;
    }));
    root.hidden = false; place();
  }
  function start() {
    if (!document.body || document.getElementById('asoc-message-toolbar')) return;
    root = document.createElement('div'); root.id = 'asoc-message-toolbar'; root.hidden = true;
    root.setAttribute('role', 'toolbar'); root.setAttribute('aria-label', 'Message actions'); document.body.append(root);
    document.documentElement.classList.add('asoc-ui-polish');
    root.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    root.addEventListener('pointerleave', () => { hideTimer = setTimeout(hide, 160); });
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-index]'); if (!button || !active?.isConnected) return;
      event.preventDefault(); event.stopPropagation();
      const item = actions[Number(button.dataset.index)], message = active; hide();
      if (item.original?.isConnected) { item.original.click(); return; }
      const fn = item.gm ? 'openGMMessageActionMenu' : 'openMessageActionMenu';
      item.owner[fn]?.(event, message);
      if (item.action === 'more') return;
      const menu = document.getElementById(item.gm ? 'gm-chat-context-menu' : 'chat-message-context-menu');
      const native = menu?.querySelector(`[data-${item.gm ? 'gm-chat' : 'chat'}-action="${item.action}"]`);
      if (native && !native.hidden && !native.disabled) native.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }));
    });
    document.addEventListener('pointerover', event => {
      if (root.contains(event.target)) return;
      const message = event.target.closest?.(messageSelector);
      if (message) show(message);
    });
    document.addEventListener('pointerout', event => {
      if (!active || root.contains(event.relatedTarget) || active.contains(event.relatedTarget)) return;
      hideTimer = setTimeout(hide, 160);
    });
    document.addEventListener('focusin', event => {
      if (!root.contains(event.target)) show(event.target.closest?.(messageSelector));
    });
    document.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch' && !event.target.closest('button,a,input,textarea,select')) show(event.target.closest?.(messageSelector));
    });
    document.addEventListener('click', event => { if (!root.contains(event.target) && !active?.contains(event.target)) hide(); });
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
})();
