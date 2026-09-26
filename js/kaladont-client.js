// KALADONT -- Little Hero client. Presentation + input only: it renders the
// server's projection (js/kaladont-ui.js) and sends intents. The server
// (kaladont.js via server.js) decides everything.
(() => {
  'use strict';
  const Kaladont = {
    state: null,
    open: false,
    invitedLobbies: new Set(),
    lastPhaseKey: '',

    init() {
      if (this.initialized) return;
      this.initialized = true;
      this.installPanel();
      document.getElementById('minigames-kaladont')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('casual-minigames-menu')?.setAttribute('hidden', '');
        document.getElementById('casual-minigames-toggle')?.setAttribute('aria-expanded', 'false');
        this.show();
      });
      document.addEventListener('click', event => this.handleClick(event));
      document.addEventListener('submit', event => this.handleSubmit(event));
      setInterval(() => window.KaladontUI?.tickClocks(document.getElementById('kaladont-panel')), 250);
    },

    installPanel() {
      if (document.getElementById('kaladont-panel')) return;
      const panel = document.createElement('div');
      panel.id = 'kaladont-panel';
      panel.className = 'threefold-panel kaladont-panel';
      panel.hidden = true;
      panel.innerHTML = `
        <div class="threefold-shell kaladont-shell">
          <div class="threefold-head">
            <div><b>KALADONT</b><small>WORD CHAIN // LAST ONE STANDING</small></div>
            <button type="button" data-kaladont-action="close" aria-label="Close">×</button>
          </div>
          <div id="kaladont-content" class="threefold-content kaladont-content"></div>
        </div>`;
      document.getElementById('chat-panel')?.appendChild(panel);
    },

    show() {
      if (PlayerApp.roomMode !== 'CASUAL') return;
      this.open = true;
      const panel = document.getElementById('kaladont-panel');
      if (panel) panel.hidden = false;
      PlayerApp.send({ type: 'kaladont:sync' });
      this.render();
    },

    hide() {
      this.open = false;
      const panel = document.getElementById('kaladont-panel');
      if (panel) panel.hidden = true;
    },

    render() {
      const content = document.getElementById('kaladont-content');
      if (!content || !window.KaladontUI || !this.open) return;
      // Keep a half-typed word through repaints (votes, disconnects).
      const input = content.querySelector('input[name="word"]');
      const typed = input?.value || '';
      const focused = document.activeElement === input;
      content.innerHTML = KaladontUI.render(this.state, { viewerId: String(PlayerApp.playerId || '') });
      const next = content.querySelector('input[name="word"]');
      if (next) {
        next.value = typed;
        if (focused || typed === '') next.focus();
      }
      KaladontUI.tickClocks(content);
    },

    updateCard() {
      const card = document.getElementById('kaladont-status');
      if (!card) return;
      const s = this.state;
      card.textContent = !s ? 'CREATE' : s.phase === 'lobby' ? `LOBBY ${s.members.length}` : s.phase === 'ended' ? 'RESULT' : 'LIVE';
    },

    // Quiet invitation: a small toast, never a forced overlay.
    invite(state) {
      if (!state || state.phase !== 'lobby' || state.you?.member || this.invitedLobbies.has(state.id)) return;
      if (PlayerApp.roomMode !== 'CASUAL') return;
      this.invitedLobbies.add(state.id);
      document.getElementById('kaladont-invite')?.remove();
      const toast = document.createElement('div');
      toast.id = 'kaladont-invite';
      toast.className = 'kaladont-invite';
      toast.setAttribute('role', 'status');
      toast.innerHTML = `<div><b>KALADONT INVITATION</b><small>${KaladontUI.esc(state.ownerName)} opened a lobby. Join the word chain?</small></div><button type="button" data-kaladont-action="invite-join">JOIN</button><button type="button" data-kaladont-action="invite-decline" class="is-dismiss">DECLINE</button>`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 15000);
    },

    onState(state) {
      const previous = this.state;
      this.state = state || null;
      this.updateCard();
      if (!state) document.getElementById('kaladont-invite')?.remove();
      this.invite(state);
      if (state && state.phase !== 'lobby') document.getElementById('kaladont-invite')?.remove();
      // Players in the match are pulled in when it starts; uninvolved heroes
      // are never force-opened.
      const phaseKey = state ? `${state.id}:${state.phase}` : '';
      if (state?.you?.playing && phaseKey !== this.lastPhaseKey && previous?.phase === 'lobby' && state.phase === 'turn') this.show();
      this.lastPhaseKey = phaseKey;
      this.render();
    },

    send(message) {
      PlayerApp.send(message);
    },

    handleClick(event) {
      const button = event.target.closest('[data-kaladont-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.kaladontAction;
      event.preventDefault();
      if (action === 'close') return this.hide();
      if (action === 'create' || action === 'new') return this.send({ type: 'kaladont:create' });
      if (action === 'join') return this.send({ type: 'kaladont:join' });
      if (action === 'leave') return this.send({ type: 'kaladont:leave' });
      if (action === 'start') return this.send({ type: 'kaladont:start' });
      if (action === 'cancel') {
        if (confirm('CANCEL THIS KALADONT LOBBY?')) this.send({ type: 'kaladont:cancel' });
        return;
      }
      if (action === 'vote-accept' || action === 'vote-reject') {
        const seq = Number(button.closest('[data-tribunal-seq]')?.dataset.tribunalSeq);
        button.closest('.kal-vote')?.querySelectorAll('button').forEach(b => { b.disabled = true; });
        return this.send({ type: 'kaladont:vote', choice: action === 'vote-accept' ? 'accept' : 'reject', tribunalSeq: seq });
      }
      if (action === 'invite-join') {
        document.getElementById('kaladont-invite')?.remove();
        this.send({ type: 'kaladont:join' });
        return this.show();
      }
      if (action === 'invite-decline' || action === 'invite-dismiss') {
        document.getElementById('kaladont-invite')?.remove();
        return;
      }
    },

    handleSubmit(event) {
      const form = event.target.closest?.('[data-kaladont-form]');
      if (!form) return;
      event.preventDefault();
      const input = form.querySelector('input[name="word"]');
      const word = String(input?.value || '').trim();
      if (!word || form.dataset.sent === '1') return;
      form.dataset.sent = '1';
      // Immutable once sent.
      form.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
      this.send({ type: 'kaladont:submit', word, turnSeq: Number(form.dataset.turnSeq) });
    }
  };

  window.Kaladont = Kaladont;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Kaladont.init(), { once: true });
  else Kaladont.init();
})();
