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
      const toggle = document.getElementById('casual-minigames-toggle');
      const menu = document.getElementById('casual-minigames-menu');
      const iksOks = document.getElementById('minigames-iks-oks');
      if (!toggle || !menu || !iksOks || toggle.dataset.bound === '1') return;
      toggle.dataset.bound = '1';

      const closeMenu = () => {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      };

      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (PlayerApp.roomMode !== 'CASUAL') return;
        const opening = menu.hidden;
        menu.hidden = !opening;
        toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      });

      iksOks.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        this.openChooser();
      });

      menu.addEventListener('click', event => event.stopPropagation());
      document.addEventListener('click', closeMenu);
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
            <div><b>IKS OKS</b><small>CASUAL DUEL // 3×3</small></div>
            <button type="button" data-threefold="close" aria-label="Close">×</button>
          </div>
          <div id="threefold-content" class="threefold-content"></div>
        </div>`;
      document.getElementById('chat-panel')?.appendChild(panel);
    },

    openChooser() {
      if (PlayerApp.roomMode !== 'CASUAL') return;
      this._chooserOpen = true;
      const players = (PlayerApp.currentPlayers || []).filter(p => p.connected !== false && p.id !== PlayerApp.playerId);
      const content = document.getElementById('threefold-content');
      if (!content) return;
      const me = (PlayerApp.currentPlayers || []).find(p => p.id === PlayerApp.playerId) || {};
      content.innerHTML = this.gauntletBar(me) + (me.iksEliminated
        ? '<div class="threefold-status"><b>ELIMINATED</b><span>0 health. You sit out until the Shadow Broker resets IKS OKS health.</span></div>'
        : players.length
          ? '<div class="threefold-kicker">SELECT OPPONENT</div><div class="threefold-opponents">' +
            this.brokerOption() +
            players.map(p => `<button type="button" class="threefold-opponent${p.iksEliminated ? ' is-eliminated' : ''}" data-threefold-opponent="${this.escape(p.id)}" ${p.iksEliminated ? 'disabled' : ''}>${this.avatar(p)}<span><b>${this.escape(p.name)}</b><small>${Number(p.threefoldWins)||0}W · ${Number(p.threefoldLosses)||0}L · ${Number(p.threefoldDraws)||0}D · ${Number(p.iksHealth ?? 10)}/${Number(p.iksMaxHealth ?? 10)} HP</small></span><i>${p.iksEliminated ? 'FALLEN' : 'CHALLENGE'}</i></button>`).join('') +
            '</div>'
          : '<div class="threefold-kicker">SELECT OPPONENT</div><div class="threefold-opponents">' + this.brokerOption() + '</div>');
      this.show();
    },

    // The Shadow Broker is always offered; offline, it is shown but locked.
    brokerOption() {
      const online = PlayerApp.brokerOnline === true;
      return `<button type="button" class="threefold-opponent threefold-opponent-broker${online ? '' : ' is-offline'}" data-threefold-opponent="__GM__" data-threefold-name="SHADOW BROKER" ${online ? '' : 'disabled'}><img src="assets/ui/shadow-broker.png" alt=""><span><b>SHADOW BROKER</b><small>${online ? 'THE HOUSE ALWAYS PLAYS' : 'NOT CONNECTED'}</small></span><i>${online ? 'CHALLENGE' : 'OFFLINE'}</i></button>`;
    },

    // A refused challenge (busy, eliminated, offline) must not leave the
    // panel stuck on "waiting".
    onError(message) {
      const text = String(message?.message || '');
      if (!this._awaitingChallenge) return;
      if (!/DUEL|ELIMINATED|OPPONENT|IKS OKS|UNAVAILABLE/i.test(text)) return;
      this._awaitingChallenge = false;
      const content = document.getElementById('threefold-content');
      if (content) content.innerHTML = `<div class="threefold-status"><b>CHALLENGE REFUSED</b><span>${this.escape(text)}</span></div>`;
    },

    // IKS OKS GAUNTLET strip: status, game count, and JOIN while it is open.
    gauntletBar(me) {
      const arena = PlayerApp.iksArena;
      if (!arena || arena.status === 'idle') return '';
      const joined = me?.iksFighter === true;
      const victors = (arena.victors || []).map(v => this.escape(v.name)).join(' & ');
      const line = arena.status === 'open'
        ? (joined ? `YOU ARE IN // ${arena.fighters} JOINED // WAITING FOR THE FIRST DUEL` : `${arena.fighters} JOINED // JOINING CLOSES AT THE FIRST DUEL`)
        : arena.status === 'running'
          ? `GAME ${arena.gamesPlayed}/${arena.gamesTotal} // ${arena.standing} OF ${arena.fighters} STANDING${joined ? ` // YOU: ${me.iksHealth}/${me.iksMaxHealth ?? 10}` : ''}`
          : `ENDED // VICTOR: ${victors || 'NONE'}`;
      return `<div class="threefold-gauntlet is-${this.escape(arena.status)}"><b>IKS OKS GAUNTLET</b><span>${line}</span>${arena.status === 'open' && !joined ? '<button type="button" data-threefold-action="join-gauntlet">JOIN GAUNTLET</button>' : ''}</div>`;
    },

    // players:update: repaint the chooser so health and gauntlet state stay live.
    onArena() {
      const panel = document.getElementById('threefold-panel');
      if (this._chooserOpen && panel && !panel.hidden && !this.game && !this.challenge) this.openChooser();
      else if (this.game && panel && !panel.hidden) this.renderGame();
    },

    show() {
      const panel = document.getElementById('threefold-panel');
      if (panel) panel.hidden = false;
    },

    close() {
      this._chooserOpen = false;
      // Closing while our own challenge is pending withdraws it on the server.
      if (this.challenge && this.challenge.challengerId === PlayerApp.playerId && !this.game) {
        PlayerApp.send({ type: 'threefold:cancel', challengeId: this.challenge.id });
        this.challenge = null;
      }
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
        if (opponent.disabled) return;
        this._chooserOpen = false;
        this._awaitingChallenge = true;
        PlayerApp.send({ type: 'threefold:challenge', opponentId: opponent.dataset.threefoldOpponent });
        this.renderWaiting(opponent.querySelector('b')?.textContent || 'LITTLE HERO');
        return;
      }
      const action = event.target.closest('[data-threefold-action]');
      if (action) {
        const kind = action.dataset.threefoldAction;
        if (kind === 'accept' && this.challenge) { PlayerApp.send({ type: 'threefold:accept', challengeId: this.challenge.id }); this.hideBanner(); this.stopTitleFlash(); }
        if (kind === 'decline' && this.challenge) { PlayerApp.send({ type: 'threefold:decline', challengeId: this.challenge.id }); this.hideBanner(); this.stopTitleFlash(); }
        if (kind === 'rematch' && this.lastOpponentId) PlayerApp.send({ type: 'threefold:challenge', opponentId: this.lastOpponentId });
        if (kind === 'join-gauntlet') PlayerApp.send({ type: 'iks:join' });
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
    // Challenges used to appear only inside the IKS OKS panel in the chat
    // column, so a player looking at the board (or another tab) never saw them.
    // A top-of-screen banner and a flashing tab title make them unmissable.
    showBanner(challenge) {
      this.hideBanner();
      const banner = document.createElement('div');
      banner.id = 'threefold-challenge-banner';
      banner.className = 'threefold-challenge-banner';
      banner.setAttribute('role', 'alertdialog');
      banner.setAttribute('aria-label', 'IKS OKS challenge');
      banner.innerHTML = `
        <span class="threefold-banner-mark" aria-hidden="true">⚔</span>
        <div><b>${this.escape(challenge.challengerName)}</b><small>CHALLENGES YOU TO IKS OKS</small></div>
        <button type="button" data-threefold-action="accept">ACCEPT</button>
        <button type="button" data-threefold-action="decline" class="is-decline">DECLINE</button>`;
      document.body.appendChild(banner);
      window.Skeleton?.playMentionAllShake?.();
      this.flashTitle(`⚔ ${challenge.challengerName} challenges you`);
    },

    hideBanner() {
      document.getElementById('threefold-challenge-banner')?.remove();
    },

    flashTitle(text) {
      this.stopTitleFlash();
      if (document.visibilityState === 'visible' && document.hasFocus?.()) return;
      const original = document.title;
      let on = false;
      this._titleFlash = { original, timer: setInterval(() => { on = !on; document.title = on ? text : original; }, 1000) };
      const stop = () => this.stopTitleFlash();
      window.addEventListener('focus', stop, { once: true });
    },

    stopTitleFlash() {
      if (!this._titleFlash) return;
      clearInterval(this._titleFlash.timer);
      document.title = this._titleFlash.original;
      this._titleFlash = null;
    },

    onChallenge(message) {
      this._awaitingChallenge = false;
      if (PlayerApp.roomMode !== 'CASUAL') return;
      this.challenge = message.challenge || null;
      if (!this.challenge) return;
      if (this.challenge.challengerId === PlayerApp.playerId) {
        this.lastOpponentId = this.challenge.opponentId;
        this.renderWaiting(this.challenge.opponentName);
        return;
      }
      this.showBanner(this.challenge);
      this.lastOpponentId = this.challenge.challengerId;
      const content = document.getElementById('threefold-content');
      if (!content) return;
      content.innerHTML = `
        <div class="threefold-kicker">DUEL REQUEST</div>
        <div class="threefold-challenge-name">${this.escape(this.challenge.challengerName)}</div>
        <div class="threefold-challenge-copy">challenges you to IKS OKS.</div>
        <div class="threefold-actions">
          <button type="button" data-threefold-action="accept">ACCEPT</button>
          <button type="button" data-threefold-action="decline">DECLINE</button>
        </div>`;
      this.show();
    },

    onDeclined(message) {
      this.hideBanner();
      this.stopTitleFlash();
      this.challenge = null;
      const content = document.getElementById('threefold-content');
      if (!content) return;
      content.innerHTML = `<div class="threefold-status"><b>CHALLENGE DECLINED</b><span>${this.escape(message.byName || 'Little Hero')} escaped basic geometry.</span></div>`;
      this.show();
    },

    onState(message) {
      if (PlayerApp.roomMode !== 'CASUAL') return;
      this.hideBanner();
      this.challenge = null;
      this.game = message.game || null;
      if (!this.game) return;
      if (!this.game.complete && this.game.turnId === PlayerApp.playerId) this.flashTitle('⚔ Your move in IKS OKS');
      else this.stopTitleFlash();
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
      const fighter = id => (PlayerApp.currentPlayers || []).find(p => String(p.id) === String(id)) || null;
      const face = id => fighter(id) ? this.avatar(fighter(id)) : (String(id) === '__GM__' ? '<img class="threefold-broker-face" src="assets/ui/shadow-broker.png" alt="Shadow Broker">' : '');
      content.innerHTML = `
        <div class="threefold-versus">
          <span class="${g.xId === PlayerApp.playerId ? 'is-me' : ''}">${face(g.xId)}<b>X</b>${this.escape(g.xName)}</span>
          <i>VS</i>
          <span class="${g.oId === PlayerApp.playerId ? 'is-me' : ''}">${face(g.oId)}<b>O</b>${this.escape(g.oName)}</span>
        </div>
        <div class="threefold-turn ${g.complete ? 'complete' : ''}">${status}</div>
        ${window.IksBoard
          ? IksBoard.html(g, { cellAttr: 'data-threefold-cell', canPlay: myTurn, me: mySymbol })
          : `<div class="threefold-board" aria-label="Threefold board">${g.board.map((mark, i) => `<button type="button" data-threefold-cell="${i}" class="threefold-cell ${mark ? 'occupied' : ''}" ${mark || g.complete || !myTurn ? 'disabled' : ''}>${mark || ''}</button>`).join('')}${Array.isArray(g.winningLine) && g.winningLine.length === 3 ? `<i class="threefold-win-line" data-line="${g.winningLine.join('-')}" aria-hidden="true"></i>` : ''}</div>`}
        <div class="threefold-foot"><span>YOU ARE ${mySymbol}</span>${g.complete ? '<button type="button" data-threefold-action="rematch">REMATCH</button>' : ''}</div>`;
    },

    onClosed(message) {
      // A stale challenge closing must never tear down a live game.
      if (message?.challengeId && this.challenge?.id !== message.challengeId) return;
      this.hideBanner();
      this.stopTitleFlash();
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
      const face = player?.avatarData
        ? `<img src="${this.escape(player.avatarData)}" alt="">`
        : '<span class="threefold-avatar-fallback">◆</span>';
      return window.IksRing ? IksRing.wrap(player, face) : face;
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
