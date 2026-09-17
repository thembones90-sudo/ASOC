const App = {
  currentView: 'gm',
  backgrounds: [],
  mode: 'local',
  ws: null,
  roomCode: '',
  hostToken: '',
  reconnectTimer: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  pendingCommands: new Map(),
  commandId: 0,
  chatMessages: [],
  solvedTargets: {},
  userScrolledUp: false,
  pendingVerdict: null,
  _reconnectPending: false,
  _hostingInFlight: false,
  finalRevealed: false,
  _lastAnnouncedStreak: {},

  async init() {
    this.showLoading(true);

    try {
      // Restore a previous hosting session (if any) BEFORE connecting, so
      // the WebSocket's onopen handler has roomCode/hostToken available to
      // attempt a host:reconnect. Without this, a page refresh always
      // starts with empty roomCode/hostToken and can never rejoin the room
      // it was hosting, even though the credentials are sitting in
      // sessionStorage. mode stays 'local' until the server actually
      // confirms the reconnect (host:reconnected) or we create a new room.
      const storedRoom = sessionStorage.getItem('asoc_host_room');
      const storedToken = sessionStorage.getItem('asoc_host_token');
      if (storedRoom && storedToken) {
        this.roomCode = storedRoom;
        this.hostToken = storedToken;
      }

      await GameData.fetchGMToken();
      await GameData.loadGameList();
      await GameData.loadBackgroundList();
      await this.loadFirstAvailableGame();
      this.setupEventListeners();
      Forge.init();
      this.populateBackgroundSelector();
      Board.init('#asoc-board');
      this.applyBackground(GameData.currentGame?.background);
      this.updatePublicView();
      this.connectWebSocket();
    } catch (e) {
      console.error('Initialization error:', e);
      alert('Failed to initialize ASOC Engine. Check console for details.');
    } finally {
      this.showLoading(false);
    }
  },

  async loadFirstAvailableGame() {
    const list = GameData.availableGames || [];
    const sample = list.find(g => g.isSample === true || g.filename === 'sample-game.json') || list[0];
    if (sample) {
      await this.loadGameById(sample.id);
    } else {
      alert('No games found in the library.');
    }
  },

  async loadGameById(id) {
    await GameData.loadGameById(id);
    Board.resetSessionState();
    Board.render();
    this.buildGMControls();
    this.updatePublicView();
    this.updateGameInfo();
    this.populateBackgroundSelector();
    if (GameData.currentGame?.background) {
      this.applyBackground(GameData.currentGame.background);
    }
    document.title = `ASOC Engine - ${GameData.currentGame.title}`;
  },

  updateGameInfo() {
    const info = document.getElementById('current-game-info');
    if (!info) return;
    const game = GameData.currentGame;
    if (!game) {
      info.innerHTML = '<div class="cg-title">—</div>';
      return;
    }
    info.innerHTML = `
      <div class="cg-title">${this.escapeHtml(game.title)}</div>
      <div class="cg-meta">
        <span class="difficulty-badge diff-${game.difficulty.toLowerCase()}">${this.escapeHtml(game.difficulty)}</span>
        <span class="cg-theme">${this.escapeHtml(game.theme || '')}</span>
      </div>
      <div class="difficulty-picker" id="difficulty-picker">
        ${GameData.DIFFICULTY_VALUES.map(d => `
          <button class="diff-swatch diff-swatch-${d.toLowerCase()} ${d === game.difficulty ? 'active' : ''}"
                  data-difficulty="${d}" title="${d}" aria-label="Set difficulty ${d}"></button>
        `).join('')}
      </div>
    `;
  },

  // Live, decorative-only difficulty change: updates the GM's own view
  // immediately (like applyBackground) and, in multiplayer, broadcasts it
  // to players via the setDifficulty command. Not saved back to the game
  // file -- a session-level override, same as a live background swap.
  setDifficulty(difficulty) {
    if (!GameData.currentGame || GameData.currentGame.difficulty === difficulty) return;
    GameData.currentGame.difficulty = difficulty;
    this.updateGameInfo();
    this.updatePublicView();
    Board.updateLogo(difficulty);

    if (this.mode === 'multiplayer' && this.roomCode) {
      this.sendCommand('setDifficulty', { difficulty });
    }
  },

  setupEventListeners() {
    document.getElementById('public-view-btn').addEventListener('click', () => this.togglePublicView());
    document.getElementById('back-to-gm-btn').addEventListener('click', () => this.togglePublicView(false));
    document.getElementById('bg-select').addEventListener('change', (e) => this.applyBackground(e.target.value));
    document.getElementById('gm-bg-upload-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) this.uploadLiveBackground(file);
      e.target.value = '';
    });
    document.getElementById('reset-board-btn').addEventListener('click', () => this.confirmReset());
    document.getElementById('undo-btn').addEventListener('click', () => this.handleUndo());

    document.getElementById('library-btn').addEventListener('click', () => Forge.open());
    document.getElementById('library-btn-footer').addEventListener('click', () => Forge.open());
    document.getElementById('new-game-btn').addEventListener('click', () => Forge.open().then(() => Forge.openCreator(null, true)));
    document.getElementById('next-game-btn').addEventListener('click', () => Forge.open());

    document.getElementById('host-room-btn').addEventListener('click', () => this.hostRoom());
    document.getElementById('close-room-btn').addEventListener('click', () => this.closeRoom());

    document.getElementById('declare-final-failed-btn').addEventListener('click', () => this.declareFinalFailed());
    document.getElementById('alltime-toggle-btn').addEventListener('click', () => this.toggleAllTimeView());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.currentView === 'public') {
        this.togglePublicView(false);
      }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        this.handleUndo();
      }
    });

    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.gm-cell-btn');
      if (btn) {
        if (btn.dataset.final === 'true') {
          this.sendCommand('revealFinal', { reveal: !Board.isFinalRevealed() });
        } else {
          const col = btn.dataset.column;
          const row = parseInt(btn.dataset.row, 10);
          this.sendCommand('revealCell', { cell: `${col}${row}`, reveal: !Board.isRevealed(col, row) });
        }
        this.updatePublicView();
      }

      const colBtn = e.target.closest('.gm-col-btn');
      if (colBtn) {
        const col = colBtn.dataset.column;
        const action = colBtn.dataset.action;
        if (action === 'reveal') this.sendCommand('revealColumn', { column: col });
        else if (action === 'hide') this.sendCommand('hideColumn', { column: col });
        this.updatePublicView();
      }

      const diffBtn = e.target.closest('.diff-swatch');
      if (diffBtn) {
        this.setDifficulty(diffBtn.dataset.difficulty);
      }

      if (e.target.closest('.gm-verdict-btn')) {
        const btn = e.target.closest('.gm-verdict-btn');
        const messageId = btn.dataset.messageId;
        const verdict = btn.dataset.verdict;
        if (verdict === 'correct') {
          this.showTargetSelector(messageId);
        } else {
          this.judgeGuess(messageId, verdict);
        }
      }

      if (e.target.closest('.gm-target-btn')) {
        const btn = e.target.closest('.gm-target-btn');
        const target = btn.dataset.target;
        this.confirmCorrectVerdict(this.pendingVerdict, target);
      }

      if (e.target.closest('.gm-verdict-clear')) {
        this.clearVerdictSelector();
      }
    });

    document.getElementById('reveal-hide-all-btn').addEventListener('click', () => {
      if (Board.isAllRevealed()) {
        this.sendCommand('hideAll', {});
      } else {
        this.sendCommand('revealAll', {});
      }
    });
  },

  connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[GM] WebSocket connected');
      if (this.roomCode && this.hostToken) {
        this._reconnectPending = true;
        this.send({ type: 'host:reconnect', roomCode: this.roomCode, hostToken: this.hostToken });
      }
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleServerMessage(message);
      } catch (e) {
        console.error('[GM] Message parse error:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('[GM] WebSocket closed');
      this.handleDisconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[GM] WebSocket error:', err);
    };
  },

  send(message) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    }
  },

  sendCommand(command, payload) {
    if (this.mode === 'local') {
      this.executeLocalCommand(command, payload);
      return;
    }

    if (!this.roomCode) return;

    const cmdId = ++this.commandId;
    this.pendingCommands.set(cmdId, { command, payload, timestamp: Date.now() });

    this.send({
      type: 'gm:command',
      command,
      payload,
      cmdId
    });

    this.executeLocalCommand(command, payload);
  },

  executeLocalCommand(command, payload) {
    let changed = false;

    switch (command) {
      case 'revealCell': {
        const { cell, reveal } = payload;
        if (Board.setRevealed(cell[0], parseInt(cell.slice(1), 10), reveal)) changed = true;
        break;
      }
      case 'revealFinal': {
        const { reveal } = payload;
        if (Board.setFinalRevealed(reveal)) changed = true;
        break;
      }
      case 'revealColumn': {
        if (Board.revealColumn(payload.column)) changed = true;
        break;
      }
      case 'hideColumn': {
        if (Board.hideColumn(payload.column)) changed = true;
        break;
      }
      case 'revealAll': {
        if (Board.revealAll()) changed = true;
        break;
      }
      case 'hideAll': {
        if (Board.hideAll()) changed = true;
        break;
      }
      case 'resetBoard': {
        Board.resetBoard();
        changed = true;
        break;
      }
    }

    if (changed) {
      this.updatePublicView();
      this.buildGMControls();
    }
  },

  handleServerMessage(message) {
    switch (message.type) {
      case 'room:created':
        this._hostingInFlight = false;
        this.roomCode = message.roomCode;
        this.hostToken = message.hostToken;
        this.mode = 'multiplayer';
        this.updateMultiplayerUI();
        sessionStorage.setItem('asoc_host_room', this.roomCode);
        sessionStorage.setItem('asoc_host_token', this.hostToken);
        break;

      case 'host:reconnected':
        this._reconnectPending = false;
        this.roomCode = message.roomCode;
        this.mode = 'multiplayer';
        this.updateMultiplayerUI();
        break;

      case 'state:public':
        this.applyServerState(message);
        break;

      case 'game:loaded':
        if (message.game) {
          GameData.currentGame = GameData.normalizeGameData(message.game);
          Board.setSessionState({ cells: {}, finalSolution: false });
          // A new board -- clear per-board announcement/streak dedupe state
          // and re-arm the Failed Final action (session score itself is
          // untouched; that lives server-side in room.scoring.players).
          this.finalRevealed = false;
          this._lastAnnouncedStreak = {};
          this.updateFailFinalButtonVisibility();
          this.buildGMControls();
          this.updateGameInfo();
          this.populateBackgroundSelector();
          if (GameData.currentGame.background) {
            this.applyBackground(GameData.currentGame.background);
            const bgSelect = document.getElementById('bg-select');
            const option = Array.from(bgSelect.options).find(o => o.value === GameData.currentGame.background);
            if (option) option.selected = true;
          }
          document.title = `ASOC Engine - ${GameData.currentGame.title}`;
        }
        break;

      case 'gm:switchGame:ack':
        console.log('[GM] Game switched:', message.gameId);
        break;

      case 'players:update':
        this.updatePlayerList(message.players);
        break;

      case 'score:event':
        this.showScoreToast(message);
        break;

      case 'score:streak':
        this.showStreakBanner(message.activeStreak);
        break;

      case 'score:finalReveal':
        this.showFinalReveal(message);
        break;

      case 'score:finalResults':
        this.revealFinalResults(message);
        break;

      case 'score:warning':
        this.showScoreWarning(message.message);
        break;

      case 'leaderboard:allTime':
        this.renderAllTimeLeaderboard(message.players || []);
        break;

      case 'chat:update':
        this.chatMessages = message.messages || [];
        this.solvedTargets = message.solvedTargets || {};
        this.renderGMChat();
        break;

      case 'command:ack':
        this.pendingCommands.delete(message.cmdId);
        break;

      case 'gm:judge:ack':
        console.log('[GM] Verdict acknowledged:', message);
        break;

      case 'error':
        console.error('[GM] Server error:', message.message);
        // Clear unconditionally: whatever failed, we're not waiting on a
        // room:create response anymore, so don't leave HOST ROOM
        // permanently blocked by a stuck flag.
        this._hostingInFlight = false;
        if (this._reconnectPending) {
          this._reconnectPending = false;
          if (message.code !== 'reconnect_host_already_connected') {
            // The room/token this tab remembered is no longer valid (room
            // closed, host grace period expired, etc). Stop claiming to
            // still be hosting it and clear the stale credentials so a
            // future reconnect attempt doesn't loop forever alerting on a
            // room that no longer exists.
            this.cleanupRoom();
          }
          // else: some other connection is already hosting this room right
          // now (duplicate tab / reconnect race). Keep the saved
          // credentials — they may still be valid if that connection drops.
        }
        alert(message.message);
        break;

      case 'room:closed':
        this.handleRoomClosed(message.message);
        break;

      default:
        console.log('[GM] Unknown message type:', message.type);
    }
  },

  applyServerState(state) {
    this.finalRevealed = state.finalSolution?.revealed === true;
    this.updateFailFinalButtonVisibility();

    const newSessionState = {
      cells: {},
      finalSolution: state.finalSolution?.revealed === true
    };

    Object.entries(state.cells).forEach(([key, cell]) => {
      if (cell.revealed === true) {
        newSessionState.cells[key] = true;
      }
    });

    Board.setSessionState(newSessionState);
    Board.render();
    this.updatePublicView();
    this.buildGMControls();

    if (state.background && state.background !== GameData.currentGame.background) {
      this.applyBackground(state.background);
      const bgSelect = document.getElementById('bg-select');
      const option = Array.from(bgSelect.options).find(o => o.value === state.background);
      if (option) option.selected = true;
    }

    this.updateMultiplayerStatus(state.revision);
  },

  updateMultiplayerStatus(revision) {
    document.getElementById('mp-status').textContent = `LIVE (rev ${revision})`;
  },

  updateMultiplayerUI() {
    const isMultiplayer = this.mode === 'multiplayer';

    document.getElementById('mp-mode').textContent = isMultiplayer ? 'MULTIPLAYER' : 'LOCAL';
    document.getElementById('mp-room-row').style.display = isMultiplayer ? 'flex' : 'none';
    document.getElementById('mp-status-row').style.display = isMultiplayer ? 'flex' : 'none';
    document.getElementById('mp-players-row').style.display = isMultiplayer ? 'flex' : 'none';
    document.getElementById('host-room-btn').style.display = isMultiplayer ? 'none' : 'block';
    document.getElementById('close-room-btn').style.display = isMultiplayer ? 'block' : 'none';
    document.getElementById('next-game-btn').style.display = isMultiplayer ? 'block' : 'none';
    document.getElementById('scoring-section').style.display = isMultiplayer ? 'block' : 'none';
    this.updateFailFinalButtonVisibility();

    if (isMultiplayer) {
      document.getElementById('mp-room-code').textContent = this.roomCode;
      document.getElementById('mp-status').textContent = 'LIVE';
    }
  },

  updatePlayerList(players) {
    const countEl = document.getElementById('mp-players-count');
    const listEl = document.getElementById('mp-player-list');

    countEl.textContent = players.length;
    listEl.style.display = players.length > 0 ? 'block' : 'none';

    listEl.innerHTML = players.map(p => `
      <div class="mp-player">
        <span class="mp-player-name">${this.escapeHtml(p.name)}</span>
        <span class="mp-player-status">
          <span class="mp-status-dot ${p.connected ? 'connected' : 'disconnected'}"></span>
          <span class="mp-status-text">${p.connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
        </span>
      </div>
    `).join('');

    this.renderSessionLeaderboard(players);
    document.getElementById('scoring-section').style.display = this.mode === 'multiplayer' ? 'block' : 'none';
  },

  // ---------------------------------------------------------------------
  // SCORING / PLAYER PROFILES (session leaderboard, all-time records,
  // streak announcements, Final success/failure sequence)
  // ---------------------------------------------------------------------

  renderSessionLeaderboard(players) {
    const el = document.getElementById('session-leaderboard');
    if (!el) return;
    const ranked = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    el.innerHTML = ranked.map((p, i) => `
      <div class="leaderboard-row ${i === 0 && (p.score || 0) > 0 ? 'leaderboard-lead' : ''}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${this.escapeHtml(p.name)}</span>
        <span class="lb-score">${p.score || 0}</span>
      </div>
    `).join('') || '<div class="leaderboard-empty">No players yet</div>';
  },

  requestAllTimeLeaderboard() {
    this.send({ type: 'leaderboard:getAllTime' });
  },

  toggleAllTimeView() {
    const panel = document.getElementById('alltime-leaderboard');
    const showing = panel.style.display !== 'none';
    if (showing) {
      panel.style.display = 'none';
    } else {
      this.requestAllTimeLeaderboard();
      panel.style.display = 'block';
      panel.innerHTML = '<div class="leaderboard-empty">Loading…</div>';
    }
  },

  renderAllTimeLeaderboard(players) {
    const panel = document.getElementById('alltime-leaderboard');
    if (!panel || panel.style.display === 'none') return;
    panel.innerHTML = players.map((p, i) => `
      <div class="leaderboard-row">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${this.escapeHtml(p.name)}</span>
        <span class="lb-score">${p.lifetimeScore}</span>
      </div>
    `).join('') || '<div class="leaderboard-empty">No recorded players yet</div>';
  },

  declareFinalFailed() {
    if (this.mode !== 'multiplayer' || this.finalRevealed) return;
    if (!confirm('Declare the Final SOLUTION failed? This reveals the answer and applies the loss penalty to every connected player.')) return;
    this.send({ type: 'gm:failFinal' });
  },

  updateFailFinalButtonVisibility() {
    const btn = document.getElementById('declare-final-failed-btn');
    if (!btn) return;
    btn.style.display = (this.mode === 'multiplayer' && !this.finalRevealed) ? 'block' : 'none';
  },

  showScoreToast(award) {
    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;
    const toast = document.createElement('div');
    toast.className = 'score-toast';
    const detail = award.awardType === 'final'
      ? `FINAL SOLVED AFTER ${award.columnsKnownAtSolve} COLUMN${award.columnsKnownAtSolve === 1 ? '' : 'S'}`
      : `COLUMN ${award.target} — ${award.cluesRevealed} CLUE${award.cluesRevealed === 1 ? '' : 'S'} REVEALED`;
    toast.innerHTML = `
      <div class="score-toast-name">${this.escapeHtml(award.playerName)}</div>
      <div class="score-toast-detail">${detail}</div>
      <div class="score-toast-points">+${award.points}</div>
    `;
    layer.appendChild(toast);
    setTimeout(() => toast.classList.add('score-toast-out'), 3200);
    setTimeout(() => toast.remove(), 3700);
  },

  showScoreWarning(msg) {
    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;
    const toast = document.createElement('div');
    toast.className = 'score-toast score-toast-warning';
    toast.innerHTML = `<div class="score-toast-detail">${this.escapeHtml(msg)}</div>`;
    layer.appendChild(toast);
    setTimeout(() => toast.classList.add('score-toast-out'), 4200);
    setTimeout(() => toast.remove(), 4700);
  },

  showStreakBanner(activeStreak) {
    if (!activeStreak) { this._lastAnnouncedStreak = {}; return; }
    const { playerId, playerName, columnCount } = activeStreak;
    if (![2, 3, 4].includes(columnCount)) return;
    if (this._lastAnnouncedStreak[playerId] === columnCount) return; // already shown this milestone
    this._lastAnnouncedStreak[playerId] = columnCount;

    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;
    const banner = document.createElement('div');
    banner.className = 'streak-banner';
    banner.innerHTML = `
      <div class="streak-banner-name">${this.escapeHtml(playerName)}</div>
      <div class="streak-banner-label">${columnCount} COLUMN STREAK</div>
    `;
    layer.appendChild(banner);
    setTimeout(() => banner.classList.add('streak-banner-out'), 2800);
    setTimeout(() => banner.remove(), 3300);
  },

  // Phase 1: the reveal + story go out to the whole room immediately.
  // Numbers are deliberately withheld here -- see showFinalOutcome's
  // sibling on the server (room.scoring.pendingResults) -- so the GM
  // controls exactly when the room sees the score consequences, via the
  // SHOW RESULTS button below (spec: "delayed score damage is intentional
  // pacing", and it must apply to every client, not just the GM's own).
  showFinalReveal(outcome) {
    this.finalRevealed = true;
    this.updateFailFinalButtonVisibility();

    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;
    const isSuccess = outcome.outcome === 'success';
    const story = GameData.currentGame?.story || '';

    const banner = document.createElement('div');
    banner.className = `final-outcome-banner ${isSuccess ? 'final-outcome-success' : 'final-outcome-failed'}`;
    banner.innerHTML = `
      <div class="fo-headline">${isSuccess ? 'SOLUTION CONFIRMED' : 'FINAL FAILED'}</div>
      ${story ? `<div class="fo-story">${this.escapeHtml(story)}</div>` : ''}
      <button class="gm-global-btn primary fo-continue-btn">SHOW RESULTS</button>
      <div class="fo-results" style="display: none;"></div>
    `;
    layer.appendChild(banner);
    this._activeFinalBanner = banner;

    banner.querySelector('.fo-continue-btn').addEventListener('click', () => {
      this.send({ type: 'gm:revealResults' });
    });
  },

  // Phase 2: the GM clicked SHOW RESULTS -- the server has broadcast the
  // actual point/penalty numbers to everyone, including us. Fill them into
  // whichever banner is still open (should always be `_activeFinalBanner`).
  revealFinalResults(results) {
    const banner = this._activeFinalBanner;
    if (!banner) return;

    const isSuccess = results.outcome === 'success';
    const continueBtn = banner.querySelector('.fo-continue-btn');
    if (continueBtn) continueBtn.style.display = 'none';

    const resultsEl = banner.querySelector('.fo-results');
    resultsEl.innerHTML = isSuccess
      ? `<div class="fo-columns-known">FINAL SOLVED AFTER ${results.columnsKnownAtSolve} COLUMN${results.columnsKnownAtSolve === 1 ? '' : 'S'}</div>
         <div class="fo-points fo-points-positive">+${results.points} — ${this.escapeHtml(results.playerName)}</div>`
      : `<div class="fo-points fo-points-negative">-${results.penalty} PER PLAYER</div>`;
    resultsEl.style.display = 'block';

    setTimeout(() => {
      banner.classList.add('final-outcome-out');
      setTimeout(() => banner.remove(), 600);
    }, 4500);
    this._activeFinalBanner = null;
  },

  hostRoom() {
    // Guard against a double-click (or double-tap) sending room:create
    // twice before the first room:created response comes back — the
    // server has no such guard itself and would happily spin up two rooms.
    if (this.mode === 'multiplayer' || this._hostingInFlight) return;

    this._hostingInFlight = true;
    const gameId = GameData.currentGame?.id || 'sample-game';
    this.send({ type: 'room:create', gameId });
  },

  switchRoomGame(gameId) {
    if (this.mode !== 'multiplayer' || !this.roomCode) return false;
    this.send({ type: 'gm:switchGame', gameId });
    return true;
  },

  closeRoom() {
    if (this.mode !== 'multiplayer') return;

    this.send({ type: 'room:close' });
    this.cleanupRoom();
  },

  cleanupRoom() {
    this.roomCode = '';
    this.hostToken = '';
    this.mode = 'local';
    sessionStorage.removeItem('asoc_host_room');
    sessionStorage.removeItem('asoc_host_token');
    this.updateMultiplayerUI();
    this.updatePlayerList([]);
  },

  handleRoomClosed(message) {
    alert(message || 'Room closed');
    this.cleanupRoom();
  },

  handleDisconnect() {
    this.reconnectAttempts = 0;
    this.attemptReconnect();
  },

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[GM] Max reconnect attempts reached');
      if (this.mode === 'multiplayer') {
        this.cleanupRoom();
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);

    this.reconnectTimer = setTimeout(() => {
      console.log(`[GM] Reconnect attempt ${this.reconnectAttempts}`);
      this.connectWebSocket();
    }, delay);
  },

  handleUndo() {
    if (this.mode === 'multiplayer') {
      alert('Undo in multiplayer: perform the inverse action manually (e.g., HIDE to undo REVEAL).');
      return;
    }
    Board.undo();
    this.updatePublicView();
    this.buildGMControls();
  },

  confirmReset() {
    if (confirm('Reset the board? All revealed clues will be hidden.')) {
      if (this.mode === 'multiplayer') {
        this.sendCommand('resetBoard', {});
      } else {
        Board.resetBoard();
        this.updatePublicView();
        this.buildGMControls();
      }
    }
  },

  applyBackground(path) {
    const bgLayer = document.getElementById('background-layer');
    if (!path) {
      bgLayer.src = '';
      bgLayer.classList.remove('loaded');
      return;
    }

    bgLayer.classList.remove('loaded');
    const img = new Image();
    img.onload = () => {
      bgLayer.src = path;
      bgLayer.classList.add('loaded');
    };
    img.onerror = () => {
      console.warn('Failed to load background:', path);
      bgLayer.src = '';
    };
    img.src = path;

    if (this.mode === 'multiplayer' && this.roomCode) {
      this.sendCommand('changeBackground', { background: path });
    }
  },

  populateBackgroundSelector() {
    const select = document.getElementById('bg-select');
    this.backgrounds = GameData.availableBackgrounds || [];

    select.innerHTML = '<option value="">-- Default / Game Background --</option>';
    this.backgrounds.forEach(bg => {
      const opt = document.createElement('option');
      opt.value = bg.path;
      opt.textContent = bg.filename;
      select.appendChild(opt);
    });

    if (GameData.currentGame?.background) {
      const gameBgOption = Array.from(select.options).find(o => o.value === GameData.currentGame.background);
      if (gameBgOption) gameBgOption.selected = true;
    }
  },

  // Upload a background image directly from the live GM panel, without
  // going through the Forge creator. Behaves like picking an existing
  // option from #bg-select: it's a live-session visual override (and
  // broadcasts to players via applyBackground's changeBackground command
  // in multiplayer), not a save to the underlying game file.
  // populateBackgroundSelector() below only replaces #bg-select's own
  // innerHTML, never this status span, so a single reference to it is
  // safe to reuse across the whole upload (no re-render-wipes-it risk).
  async uploadLiveBackground(file) {
    const status = document.getElementById('gm-bg-upload-status');
    if (status) status.textContent = 'Uploading...';
    try {
      const res = await GameData.uploadBackground(file);
      await GameData.loadBackgroundList();
      this.populateBackgroundSelector();
      const select = document.getElementById('bg-select');
      if (select) select.value = res.path;
      this.applyBackground(res.path);
      if (status) status.textContent = `Added: ${res.filename}`;
    } catch (e) {
      if (status) status.textContent = 'Upload failed: ' + e.message;
      alert('Background upload failed: ' + e.message);
    }
  },

  togglePublicView(force = null) {
    const publicView = document.getElementById('public-view');
    const gmPanel = document.getElementById('gm-panel');
    // NOTE: there is no ".toolbar" element in the current markup (it was
    // removed from index.html at some point; PUBLIC VIEW/GAME LIBRARY now
    // live in .gm-footer instead). #public-view.active is already a
    // position:fixed, full-viewport overlay at a higher z-index than the
    // old .toolbar ever was, so hiding a toolbar was always redundant even
    // when the element existed. Do not reintroduce a querySelector('.toolbar')
    // here -- that null reference was crashing this function on every call.

    const show = force !== null ? force : this.currentView !== 'public';

    if (show) {
      this.currentView = 'public';
      publicView.classList.add('active');
      gmPanel.style.display = 'none';
      this.updatePublicView();
    } else {
      this.currentView = 'gm';
      publicView.classList.remove('active');
      gmPanel.style.display = 'flex';
    }
  },

  updatePublicView() {
    const publicBoard = document.getElementById('public-board');
    if (!publicBoard || !GameData.currentGame) return;

    const game = GameData.currentGame;
    const columns = ['A', 'B', 'C', 'D'];

    let html = `
      <div class="public-header">
        <div class="public-title">${this.escapeHtml(game.title)}</div>
        <div class="public-theme">${this.escapeHtml(game.theme)}</div>
        ${game.difficulty ? `<span class="difficulty-badge public-difficulty diff-${game.difficulty.toLowerCase()}">${this.escapeHtml(game.difficulty)}</span>` : ''}
      </div>
      <div class="asoc-board">
        ${Skeleton.skeletonHTML(game.difficulty)}
    `;

    for (let row = 1; row <= 4; row++) {
      columns.forEach(col => {
        const key = `${col}${row}`;
        const content = GameData.getCellData(col, row);
        const revealed = Board.isRevealed(col, row);

        html += this.createPublicCellHTML(key, content, false, revealed, `${col}${row}`);
      });
    }

    columns.forEach(col => {
      const key = `${col}5`;
      const content = GameData.getCellData(col, 5);
      const revealed = Board.isRevealed(col, 5);

      html += this.createPublicCellHTML(key, content, true, revealed, `${col}5`);
    });

    const finalContent = GameData.getFinalSolution();
    const finalRevealed = Board.isFinalRevealed();
    html += this.createPublicCellHTML('FINAL', finalContent, true, finalRevealed, 'FINAL', true);

    html += '</div>';
    publicBoard.innerHTML = html;
    Skeleton.attach(publicBoard.querySelector('.asoc-board'));
  },

  createPublicCellHTML(key, content, isSolution, revealed, label, isFinal = false) {
    const classes = ['board-cell'];
    if (isSolution) classes.push('solution-cell');
    if (isFinal) classes.push('final-solution');
    if (!revealed) classes.push('hidden');
    else classes.push('revealed');

    const displayContent = revealed ? (content || '—') : (isFinal ? '???' : '■■■');

    return `
      <div class="${classes.join(' ')}" data-label="${label}" style="${Skeleton.cellStyle(label)}">
        <div class="cell-content">${this.escapeHtml(displayContent)}</div>
      </div>
    `;
  },

  showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  escapeHtmlAttr(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '"');
  },

  buildGMControls() {
    const gmClueGrid = document.getElementById('gm-clue-grid');
    const gmColumnControls = document.getElementById('gm-column-controls');
    const columns = ['A', 'B', 'C', 'D'];

    if (!window.GameData.currentGame) return;

    let clueHtml = '';
    for (let row = 1; row <= 4; row++) {
      columns.forEach(col => {
        const key = `${col}${row}`;
        const content = GameData.getCellData(col, row);
        const revealed = Board.isRevealed(col, row);
        clueHtml += `
          <button class="gm-cell-btn ${revealed ? 'revealed' : ''}" 
                  data-column="${col}" data-row="${row}"
                  title="${this.escapeHtmlAttr(content)}">
            <span style="font-size:0.55rem; color:var(--text-dim);">${col}${row}</span>
            <span>${revealed ? 'HIDE' : 'REVEAL'}</span>
          </button>
        `;
      });
    }

    columns.forEach(col => {
      const solutionContent = GameData.getCellData(col, 5);
      const revealed = Board.isRevealed(col, 5);
      clueHtml += `
        <button class="gm-cell-btn solution-btn ${revealed ? 'revealed' : ''}" 
                data-column="${col}" data-row="5"
                title="${this.escapeHtmlAttr(solutionContent)}">
          <span style="font-size:0.55rem; color:var(--accent-gold);">${col}5</span>
          <span>${revealed ? 'HIDE' : 'REVEAL'}</span>
        </button>
      `;
    });

    const finalRevealed = Board.isFinalRevealed();
    const finalContent = GameData.getFinalSolution();
    clueHtml += `
      <button class="gm-cell-btn final-btn ${finalRevealed ? 'revealed' : ''}" 
              data-final="true"
              title="${this.escapeHtmlAttr(finalContent)}">
        <span style="font-size:0.55rem; color:var(--accent-gold);">FINAL</span>
        <span>${finalRevealed ? 'HIDE FINAL' : 'REVEAL FINAL'}</span>
      </button>
    `;

    gmClueGrid.innerHTML = clueHtml;

    let colHtml = '';
    columns.forEach(col => {
      const colRevealed = Board.isColumnRevealed(col);
      const action = colRevealed ? 'hide' : 'reveal';
      const label = colRevealed ? `HIDE ${col}` : `REVEAL ${col}`;
      colHtml += `
        <button class="gm-col-btn ${colRevealed ? 'revealed' : ''}" data-column="${col}" data-action="${action}">${label}</button>
      `;
    });
    gmColumnControls.innerHTML = colHtml;

    const revealHideAllBtn = document.getElementById('reveal-hide-all-btn');
    if (revealHideAllBtn) {
      const allRevealed = Board.isAllRevealed();
      revealHideAllBtn.textContent = allRevealed ? 'HIDE ALL' : 'REVEAL ALL';
      revealHideAllBtn.classList.toggle('revealed', allRevealed);
    }
  },

  renderGMChat() {
    const container = document.getElementById('gm-chat-messages');
    if (!container) return;

    const wasAtBottom = !this.userScrolledUp;

    let html = '';
    this.chatMessages.forEach(msg => {
      html += this.createGMChatMessageHTML(msg);
    });

    container.innerHTML = html;

    if (wasAtBottom) {
      container.scrollTop = container.scrollHeight;
    }

    this.updateSolvedCount();
  },

  createGMChatMessageHTML(msg) {
    const verdictIcon = this.getVerdictIcon(msg.verdict);
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const hasVerdict = msg.verdict !== null;
    const showControls = !hasVerdict;

    return `
      <div class="gm-chat-message ${hasVerdict ? 'has-verdict' : ''} ${msg.verdict || ''}" data-message-id="${msg.id}">
        <div class="gm-chat-message-header">
          <span class="gm-chat-player-name">${this.escapeHtml(msg.playerName)}</span>
          <span class="gm-chat-time">${time}</span>
        </div>
        <div class="gm-chat-message-text">${this.escapeHtml(msg.text)}</div>
        ${verdictIcon ? `<div class="gm-chat-verdict ${msg.verdict}">${verdictIcon}${msg.target ? ` (${this.getTargetLabel(msg.target)})` : ''}</div>` : ''}
        <div class="gm-chat-controls" style="display: ${showControls ? 'flex' : 'none'};">
          <button class="gm-verdict-btn wrong" data-message-id="${msg.id}" data-verdict="wrong" title="Mark as wrong">❌</button>
          <button class="gm-verdict-btn correct" data-message-id="${msg.id}" data-verdict="correct" title="Mark as correct">🖤</button>
        </div>
      </div>
    `;
  },

  getVerdictIcon(verdict) {
    switch (verdict) {
      case 'wrong': return '❌';
      case 'correct': return '🖤';
      default: return null;
    }
  },

  getTargetLabel(target) {
    const labels = {
      'A': 'COLUMN A',
      'B': 'COLUMN B',
      'C': 'COLUMN C',
      'D': 'COLUMN D',
      'FINAL': 'FINAL SOLUTION'
    };
    return labels[target] || target;
  },

  updateSolvedCount() {
    const countEl = document.getElementById('gm-chat-solved-count');
    if (!countEl) return;
    const solved = Object.keys(this.solvedTargets).length;
    countEl.textContent = `SOLVED: ${solved}/5`;
  },

  judgeGuess(messageId, verdict) {
    if (this.mode !== 'multiplayer') return;

    if (verdict === 'correct') {
      this.showTargetSelector(messageId);
      return;
    }

    this.send({
      type: 'gm:judgeGuess',
      messageId,
      verdict
    });
  },

  showTargetSelector(messageId) {
    this.pendingVerdict = messageId;
    const container = document.getElementById('gm-chat-messages');
    if (!container) return;

    const msgEl = container.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;

    const controlsEl = msgEl.querySelector('.gm-chat-controls');
    if (!controlsEl) return;

    controlsEl.innerHTML = `
      <div class="gm-target-selector">
        <span class="gm-target-label">MARK CORRECT AS:</span>
        <div class="gm-target-buttons">
          <button class="gm-target-btn" data-target="A" title="Column A Solution">A</button>
          <button class="gm-target-btn" data-target="B" title="Column B Solution">B</button>
          <button class="gm-target-btn" data-target="C" title="Column C Solution">C</button>
          <button class="gm-target-btn" data-target="D" title="Column D Solution">D</button>
          <button class="gm-target-btn final" data-target="FINAL" title="Final Solution">FINAL</button>
        </div>
        <button class="gm-verdict-clear" title="Cancel">✕</button>
      </div>
    `;
  },

  confirmCorrectVerdict(messageId, target) {
    this.send({
      type: 'gm:judgeGuess',
      messageId,
      verdict: 'correct',
      target,
      reveal: true
    });
    this.pendingVerdict = null;
  },

  clearVerdictSelector() {
    this.pendingVerdict = null;
    this.renderGMChat();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;