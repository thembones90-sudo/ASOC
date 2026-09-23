(() => {
  'use strict';
  const Threefold = {
    challenge: null,
    game: null,
    lastOpponentId: null,
    initialized: false,

    init() {
      if (this.initialized) return;
      this.initialized = true;
      this.installLauncher();
      this.installPanel();
      document.addEventListener('click', (event) => this.handleClick(event));
    },

    installLauncher() {
      const menu = document.getElementById('chat-attachment-menu');
      if (!menu || document.getElementById('chat-threefold-btn')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'chat-threefold-btn';
      button.className = 'chat-attachment-option threefold-launcher';
      button.innerHTML = '<span class="chat-attachment-option-icon threefold-icon">3×3</span><span class="chat-attachment-option-copy"><b>THREEFOLD</b><small>Challenge a Little Hero</small></span>';
      menu.appendChild(button);
    },

    installPanel() {
      if (document.getElementById('threefold-panel')) return;
      const panel = document.createElement('div');
      panel.id = 'threefold-panel';
      panel.className = 'threefold-panel';
      panel.hidden = true;
      panel.innerHTML = `
        <div class="threefold-shell">
          <div class="threefold-head">
            <div><b>THREEFOLD</b><small>CASUAL DUEL // 3×3</small></div>
            <button type="button" data-threefold="close" aria-label="Close">×</button>
          </div>
          <div id="threefold-content" class="threefold-content"></div>
        </div>`;
      document.getElementById('chat-panel')?.appendChild(panel);
    },

    openChooser() {
      if (PlayerApp.roomMode !== 'CASUAL') return;
      const players = (PlayerApp.currentPlayers || []).filter(p => p.connected !== false && p.id !== PlayerApp.playerId);
      const content = document.getElementById('threefold-content');
      if (!content) return;
      content.innerHTML = players.length
        ? '<div class="threefold-kicker">SELECT OPPONENT</div><div class="threefold-opponents">' +
          players.map(p => `<button type="button" class="threefold-opponent" data-threefold-opponent="${this.escape(p.id)}">${this.avatar(p)}<span><b>${this.escape(p.name)}</b><small>${Number(p.threefoldWins)||0}W · ${Number(p.threefoldLosses)||0}L · ${Number(p.threefoldDraws)||0}D</small></span><i>CHALLENGE</i></button>`).join('') +
          '</div>'
        : '<div class="threefold-empty">NO OTHER LITTLE HEROES ONLINE</div>';
      this.show();
    },

    show() {
      const panel = document.getElementById('threefold-panel');
      if (panel) panel.hidden = false;
    },

    close() {
      const panel = document.getElementById('threefold-panel');
      if (panel) panel.hidden = true;
    },
    handleClick(event) {
      if (event.target.closest('#chat-threefold-btn')) {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('chat-attachment-menu')?.setAttribute('hidden', '');
        document.getElementById('chat-image-upload-btn')?.setAttribute('aria-expanded', 'false');
        this.openChooser();
        return;
      }
      if (event.target.closest('[data-threefold="close"]')) {
        this.close();
        return;
      }
      const opponent = event.target.closest('[data-threefold-opponent]');
      if (opponent) {
        PlayerApp.send({ type: 'threefold:challenge', opponentId: opponent.dataset.threefoldOpponent });
        this.renderWaiting(opponent.querySelector('span')?.textContent || 'LITTLE HERO');
        return;
      }
      const action = event.target.closest('[data-threefold-action]');
      if (action) {
        const kind = action.dataset.threefoldAction;
        if (kind === 'accept' && this.challenge) PlayerApp.send({ type: 'threefold:accept', challengeId: this.challenge.id });
        if (kind === 'decline' && this.challenge) PlayerApp.send({ type: 'threefold:decline', challengeId: this.challenge.id });
        if (kind === 'rematch' && this.lastOpponentId) PlayerApp.send({ type: 'threefold:challenge', opponentId: this.lastOpponentId });
        if (kind === 'close') this.close();
        return;
      }
      const cell = event.target.closest('[data-threefold-cell]');
      if (cell && this.game && !this.game.complete) {
        PlayerApp.send({ type: 'threefold:move', gameId: this.game.id, cell: Number(cell.dataset.threefoldCell) });
      }
    },

    renderWaiting(name) {
      const content = document.getElementById('threefold-content');
      if (!content) return;
      content.innerHTML = `<div class="threefold-status"><b>CHALLENGE SENT</b><span>Waiting for ${this.escape(name)}.</span></div>`;
      this.show();
    },
    onChallenge(message) {
      if (PlayerApp.roomMode !== 'CASUAL') return;
      this.challenge = message.challenge || null;
      if (!this.challenge) return;
      if (this.challenge.challengerId === PlayerApp.playerId) {
        this.lastOpponentId = this.challenge.opponentId;
        this.renderWaiting(this.challenge.opponentName);
        return;
      }
      this.lastOpponentId = this.challenge.challengerId;
      const content = document.getElementById('threefold-content');
      if (!content) return;
      content.innerHTML = `
        <div class="threefold-kicker">DUEL REQUEST</div>
        <div class="threefold-challenge-name">${this.escape(this.challenge.challengerName)}</div>
        <div class="threefold-challenge-copy">challenges you to THREEFOLD.</div>
        <div class="threefold-actions">
          <button type="button" data-threefold-action="accept">ACCEPT</button>
          <button type="button" data-threefold-action="decline">DECLINE</button>
        </div>`;
      this.show();
    },

    onDeclined(message) {
      this.challenge = null;
      const content = document.getElementById('threefold-content');
      if (!content) return;
      content.innerHTML = `<div class="threefold-status"><b>CHALLENGE DECLINED</b><span>${this.escape(message.byName || 'Little Hero')} escaped basic geometry.</span></div>`;
      this.show();
    },

    onState(message) {
      if (PlayerApp.roomMode !== 'CASUAL') return;
      this.challenge = null;
      this.game = message.game || null;
      if (!this.game) return;
      const meX = this.game.xId === PlayerApp.playerId;
      this.lastOpponentId = meX ? this.game.oId : this.game.xId;
      this.renderGame();
      this.show();
    },
    renderGame() {
      const g = this.game;
      const content = document.getElementById('threefold-content');
      if (!g || !content) return;
      const mySymbol = g.xId === PlayerApp.playerId ? 'X' : 'O';
      const myTurn = g.turnId === PlayerApp.playerId && !g.complete;
      const status = g.complete
        ? (g.winnerId ? (g.winnerId === PlayerApp.playerId ? 'YOU WIN' : `${this.escape(g.winnerName)} WINS`) : 'STALEMATE')
        : (myTurn ? 'YOUR MOVE' : `${this.escape(g.turnName)} IS THINKING`);
      content.innerHTML = `
        <div class="threefold-versus">
          <span class="${g.xId === PlayerApp.playerId ? 'is-me' : ''}"><b>X</b>${this.escape(g.xName)}</span>
          <i>VS</i>
          <span class="${g.oId === PlayerApp.playerId ? 'is-me' : ''}"><b>O</b>${this.escape(g.oName)}</span>
        </div>
        <div class="threefold-turn ${g.complete ? 'complete' : ''}">${status}</div>
        <div class="threefold-board" aria-label="Threefold board">
          ${g.board.map((mark, i) => `<button type="button" data-threefold-cell="${i}" class="threefold-cell ${mark ? 'occupied' : ''}" ${mark || g.complete || !myTurn ? 'disabled' : ''}>${mark || ''}</button>`).join('')}
        </div>
        <div class="threefold-foot"><span>YOU ARE ${mySymbol}</span>${g.complete ? '<button type="button" data-threefold-action="rematch">REMATCH</button>' : ''}</div>`;
    },

    onClosed(message) {
      if (message?.reason) {
        const content = document.getElementById('threefold-content');
        if (content) content.innerHTML = `<div class="threefold-status"><b>DUEL CLOSED</b><span>${this.escape(message.reason)}</span></div>`;
        this.show();
      } else {
        this.close();
      }
      this.challenge = null;
      this.game = null;
    },
    avatar(player) {
      if (player?.avatarData) return `<img src="${this.escape(player.avatarData)}" alt="">`;
      return '<span class="threefold-avatar-fallback">◆</span>';
    },

    escape(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
      }[ch]));
    }
  };

  window.Threefold = Threefold;
  const boot = () => Threefold.init();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();