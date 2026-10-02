// CHAT MENTIONS -- @Name tags work like hashtags on both chat surfaces.
//   * Clicking any @Name tag filters the chat (SEARCH TRANSMISSIONS) to every
//     line that mentions that name; clearing the search box shows all again.
//   * An "@ N" pill beside the search box counts mentions of YOU (or replies
//     to you) that arrived while you were not looking; clicking it shows
//     exactly where you were mentioned.
// Presentation only: it reads the chat the page already rendered.
(() => {
  'use strict';
  const isGM = () => !!window.App && !window.PlayerApp;
  const searchInput = () => document.getElementById(isGM() ? 'gm-chat-search' : 'chat-search');
  const chatBox = () => document.getElementById(isGM() ? 'gm-chat-messages' : 'chat-messages');
  const selfTag = () => (isGM() ? '@SHADOW BROKER' : `@${String(window.PlayerApp?.playerName || '').trim()}`);

  const Mentions = {
    unseen: 0,

    filter(tag) {
      const input = searchInput();
      if (!input || !tag) return;
      input.value = tag;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const box = chatBox();
      if (box) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
      input.classList.add('is-mention-filter');
    },

    // Called with the messages that just arrived (already filtered to new).
    note(newMessages) {
      const alerts = window.AsocAlerts;
      if (!alerts || !Array.isArray(newMessages) || !newMessages.length) return;
      const selfId = String(window.PlayerApp?.playerId || '');
      const selfName = String(window.PlayerApp?.playerName || '');
      const mine = newMessages.filter(m => {
        if (!m || !m.text) return false;
        if (isGM()) return m.source !== 'shadowBroker' && alerts.classifyForGm(m) !== 'chat';
        if (String(m.playerId || '') === selfId) return false;
        return alerts.classifyForName(m, selfName, { allowAll: false }) !== 'chat';
      });
      if (!mine.length) return;
      const box = chatBox();
      const atBottom = !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 80;
      const looking = document.visibilityState === 'visible' && document.hasFocus() && atBottom;
      if (looking) return;
      this.unseen += mine.length;
      this.renderPill();
    },

    renderPill() {
      const input = searchInput();
      const strip = input?.parentElement;
      if (!strip) return;
      let pill = strip.querySelector('.chat-mentions-pill');
      if (!pill) {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'chat-mentions-pill';
        pill.addEventListener('click', () => {
          this.unseen = 0;
          this.renderPill();
          this.filter(selfTag());
        });
        input.insertAdjacentElement('afterend', pill);
      }
      pill.hidden = this.unseen <= 0;
      pill.textContent = `@ ${this.unseen} MENTION${this.unseen === 1 ? '' : 'S'}`;
      pill.title = 'Show where you were mentioned';
    }
  };

  document.addEventListener('click', e => {
    const tag = e.target.closest?.('#chat-messages .chat-mention, #gm-chat-messages .chat-mention');
    if (!tag) return;
    e.preventDefault();
    e.stopPropagation();
    Mentions.filter(tag.textContent.trim());
  }, true);
  // Typing in (or clearing) the search box drops the mention-filter styling;
  // searching for yourself counts as having seen your mentions.
  document.addEventListener('input', e => {
    if (e.target?.id !== 'chat-search' && e.target?.id !== 'gm-chat-search') return;
    if (!e.isTrusted) return;
    e.target.classList.remove('is-mention-filter');
  });

  window.AsocMentions = Mentions;
})();
