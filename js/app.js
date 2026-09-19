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
  // FINAL SOLUTION REVEAL FLOURISH -- an epoch-ms deadline. Set once, in
  // applyServerState(), the moment finalRevealed is detected flipping
  // false->true on an AUTHORITATIVE confirmed broadcast (never from
  // executeLocalCommand()'s optimistic pre-render). While Date.now() is
  // before this deadline, updatePublicView() keeps including the flourish
  // class on every rebuild it does. Two reasons this has to be a WINDOW
  // rather than a one-shot flag consumed by the very next render:
  //   1. sendCommand('revealFinal',...) triggers an instant optimistic
  //      render AND a confirmed one moments later for the very same
  //      reveal -- a one-shot flag consumed by whichever render reads it
  //      first works for that pair specifically.
  //   2. But updatePublicView() also gets rebuilt by anything else that
  //      broadcasts meanwhile -- most commonly the Timer, which ticks
  //      (and broadcasts) once a second for as long as it's still
  //      running, which it usually still is when the GM reveals Final.
  //      A one-shot flag gets cut off by the very next tick's rebuild,
  //      often within a fraction of a second -- long before a human could
  //      register the animation. A short window instead means every
  //      rebuild inside it re-includes the class, so the flourish is
  //      still visibly playing (restarting is imperceptible this early)
  //      across any of those incidental rebuilds, matching the CSS
  //      animation's own ~1.1s duration. A rebuild for a genuinely later,
  //      unrelated reveal is unaffected either way, since finalRevealed
  //      was already true and this deadline is never extended by one.
  _finalFlourishUntil: 0,
  _lastAnnouncedStreak: {},
  // SHADOW BROKER BOARD LINE -- same time-window rendering philosophy as
  // _finalFlourishUntil just above: renderShadowBrokerLineHTML() recomputes
  // the visible substring/opacity fresh from wall-clock time on every
  // updatePublicView() rebuild (never an imperative DOM-mutating interval),
  // so a Timer tick or any other incidental rebuild mid-transmission can
  // never desync or truncate it. _brokerLineTicker just re-invokes
  // updatePublicView() on a fast interval so the reveal is actually
  // visible frame-by-frame; it self-clears once the state function
  // reports the transmission finished (revealed, held, and faded).
  _brokerLineText: null,
  _brokerLineStartedAt: 0,
  _brokerLineTicker: null,
  _brokerLineInterruptedUntil: 0,
  _brokerLineQueue: [],
  _chatEverInitialized: false,
  // "TRANSMIT clicked while not hosting" cosmetic-only feedback state --
  // see flashShadowBrokerNoRoom(). Not synced with anything, not sent
  // over the wire.
  _brokerNoRoomTimeout: null,
  _brokerNoRoomPlaceholder: null,
  // Per-message/per-verdict "have I already played the one-shot glitch-in
  // for this Shadow Broker bubble" guard, same role as player.js's own
  // _seenShadowBrokerKeys -- kept as a separate set since the GM console
  // rebuilds its own chat list independently of the player screen.
  _seenShadowBrokerKeys: new Set(),
  // WOMF is global ASOC state, not per-game -- it is only ever set from the
  // server's authoritative state:public broadcasts (applyServerState) or
  // reset to a static 0/10 when there is no room (cleanupRoom). It is never
  // computed locally.
  womf: { charge: 0, armed: false },
  // TIMER + BORROWED TIME -- same philosophy as womf: purely a reflection
  // of the server's authoritative state:public broadcasts (applyServerState)
  // or the static, un-started 'ready' default when there is no room
  // (cleanupRoom). Never runs its own countdown locally.
  timer: { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 },

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

      Womf.init('womf-tracker-gm');
      Womf.init('womf-tracker-public');
      Wheel.init('wheel-overlay');
      Timer.init('timer-tracker-gm');
      Timer.init('timer-tracker-public');
      // The OPEN WOMF control exists ONLY on the GM's own working view --
      // never on the Public View preview or the player's read-only copy in
      // join.html. It's appended here (rather than baked into womf.js's
      // shared shellHTML) so Womf.init()/update() can stay identical for
      // every tracker instance and never risk wiping a control that only
      // some of them have. This runs BEFORE setupEventListeners() so the
      // button already exists when that binds its click handler.
      const gmTracker = document.getElementById('womf-tracker-gm');
      if (gmTracker && !document.getElementById('womf-open-btn')) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.id = 'womf-open-btn';
        openBtn.className = 'womf-open-btn';
        openBtn.disabled = true;
        openBtn.textContent = 'OPEN WOMF';
        gmTracker.appendChild(openBtn);
      }

      ControlSurfaces.init(this);
      this.setupEventListeners();
      Forge.init();
      this.populateBackgroundSelector();
      Board.init('#asoc-board');
      this.applyPersistedOrDefaultBackground();
      this.updatePublicView();
      this.updateWomfTracker();
      this.updateTimerUI();
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
    this.applyPersistedOrDefaultBackground();
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
    Board.updateSkeleton(difficulty);

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
    document.getElementById('nema-asoc-btn')?.addEventListener('click', () => this.triggerNemaAsoc());

    document.getElementById('library-btn').addEventListener('click', () => Forge.open());
    document.getElementById('library-btn-footer').addEventListener('click', () => ControlSurfaces.toggle());
    document.getElementById('new-game-btn').addEventListener('click', () => Forge.open().then(() => Forge.openCreator(null, true)));
    document.getElementById('next-game-btn').addEventListener('click', () => Forge.open());

    document.getElementById('host-room-btn').addEventListener('click', () => this.hostRoom());
    document.getElementById('close-room-btn').addEventListener('click', () => this.closeRoom());

    // SHADOW BROKER free-form broadcast -- presentation layer only, see
    // handleGmBroadcast in server.js. Enter submits (native form submit),
    // same as the player's own chat-form.
    document.getElementById('shadow-broker-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendShadowBrokerBroadcast();
    });
    document.getElementById('shadow-broker-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Delete') {
        e.preventDefault();
        e.currentTarget.value = '';
        this.clearShadowBrokerBroadcast();
      }
    });

    // FAIL K ("K" is this GM's own shorthand for the Final/"Kraj" slot) --
    // lives in the WOMF section alongside FAIL A-D now, replacing the old
    // standalone DECLARE FINAL FAILED button under Scoring. Same action.
    document.getElementById('womf-fail-final-btn')?.addEventListener('click', () => this.declareFinalFailed());
    document.getElementById('womf-subtract-btn')?.addEventListener('click', () => this.declareWomfSubtract());
    document.getElementById('womf-reset-btn')?.addEventListener('click', () => this.declareWomfReset());
    document.getElementById('alltime-toggle-btn').addEventListener('click', () => this.toggleAllTimeView());
    document.getElementById('womf-open-btn')?.addEventListener('click', () => this.openWomf());

    document.getElementById('wheel-setup-close')?.addEventListener('click', () => this.closeWheelSetup());
    document.getElementById('wheel-setup-add-name')?.addEventListener('click', () => this.addWheelSetupCustomName());
    document.getElementById('wheel-setup-custom-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addWheelSetupCustomName();
      }
    });
    document.getElementById('wheel-setup-confirm')?.addEventListener('click', () => this.confirmWheelSetup());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.currentView === 'public') {
        this.togglePublicView(false);
      }
      if (e.key === 'Escape' && document.getElementById('wheel-setup-overlay')?.classList.contains('active')) {
        this.closeWheelSetup();
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

      const womfFailBtn = e.target.closest('.womf-fail-btn');
      if (womfFailBtn) {
        this.declareColumnFailed(womfFailBtn.dataset.column);
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

    this._protocolReady = false;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[GM] WebSocket connected');
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

  triggerNemaAsoc() {
    if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
      this.send({ type: 'gm:nemaAsoc' });
      return;
    }
    Skeleton.playNemaAsoc();
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
      case 'protocol:hello':
        this.send({ type: 'protocol:hello', protocolVersion: 1 });
        break;

      case 'protocol:ready':
        this._protocolReady = true;
        if (this.roomCode && this.hostToken) {
          this._reconnectPending = true;
          this.send({ type: 'host:reconnect', roomCode: this.roomCode, hostToken: this.hostToken });
        }
        break;

      case 'protocol:mismatch':
        this._protocolReady = false;
        alert(message.message || 'SYSTEM VERSION MISMATCH // REFRESH REQUIRED');
        break;

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
            // Multiplayer, server-driven game switch -- never persists as
            // the GM's local override (see applyBackground's `persist`
            // param).
            this.applyBackground(GameData.currentGame.background, false);
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

      case 'battle:controlsOnline':
        this.showBattleControlsOnline();
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

      case 'chat:update': {
        const incoming = message.messages || [];
        // Same first-hydration guard as PlayerApp's copy in js/player.js --
        // without it, a GM reconnecting mid-game would see the room's
        // entire chat history replay as a fresh Broker transmission on
        // their own Public View the instant the reconnect completes.
        if (this._chatEverInitialized) {
          const previousIds = new Set(this.chatMessages.map(m => m.id));
          const newBrokerMsg = incoming.find(m => m.source === 'shadowBroker' && !previousIds.has(m.id));
          if (newBrokerMsg) {
            this.playShadowBrokerBoardLine(newBrokerMsg.text);
            // The GM's own working board (js/board.js) previously never
            // showed this at all -- the GM had to trust the chat log or
            // switch to Public View to see it. Play it there too so
            // hosting shows exactly what players are about to see.
            Board.playShadowBrokerBoardLine(newBrokerMsg.text);
          }
        }
        this._chatEverInitialized = true;
        this.chatMessages = incoming;
        this.solvedTargets = message.solvedTargets || {};
        this.renderGMChat();
        break;
      }

      case 'shadowBroker:clear':
        this.clearShadowBrokerBoardLine();
        Board.clearShadowBrokerBoardLine();
        break;

      case 'nemaAsoc':
        Skeleton.playNemaAsoc();
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
    const wasFinalRevealed = this.finalRevealed;
    this.finalRevealed = state.finalSolution?.revealed === true;
    // See _finalFlourishUntil's declaration for why this is decided here,
    // once, on the authoritative transition, rather than inside
    // updatePublicView() itself.
    if (!wasFinalRevealed && this.finalRevealed) {
      this._finalFlourishUntil = Date.now() + 1100;
    }
    this.updateFailFinalButtonVisibility();

    this.womf = state.womf || { charge: 0, armed: false };
    this.updateWomfTracker();

    this.wheel = state.wheel || { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
    this.updateWheelUI();

    this.timer = state.timer || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 };
    this.updateTimerUI();

    const newSessionState = {
      cells: {},
      finalSolution: state.finalSolution?.revealed === true,
      cellOutcomes: {},
      finalOutcome: state.finalSolution?.outcome || null,
      // Progressive Clue Queue -- server-authoritative row order per column
      // (see server.js's getPublicState()/assignClueOrder()). This always
      // overwrites whatever the optimistic local update guessed, so a
      // reconnect or any client's rerender can never scramble it.
      clueOrder: state.clueOrder || { A: [], B: [], C: [], D: [] }
    };

    Object.entries(state.cells).forEach(([key, cell]) => {
      if (cell.revealed === true) {
        newSessionState.cells[key] = true;
      }
      // WOMF: only ever present on a solution slot the GM declared failed --
      // drives the red treatment instead of the normal reveal color.
      if (cell.outcome) {
        newSessionState.cellOutcomes[key] = cell.outcome;
      }
    });

    Board.setSessionState(newSessionState);
    Board.render();
    this.updatePublicView();
    this.buildGMControls();

    if (state.background && state.background !== GameData.currentGame.background) {
      // Server-authoritative sync, not a local GM choice -- never persists.
      this.applyBackground(state.background, false);
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
    const recordsSection = document.getElementById('records-section');
    if (recordsSection) recordsSection.style.display = isMultiplayer ? 'block' : 'none';
    ControlSurfaces.updateSessionSummary();
    this.updateFailFinalButtonVisibility();
    this.updateWomfControlsVisibility();

    if (isMultiplayer) {
      document.getElementById('mp-room-code').textContent = this.roomCode;
      document.getElementById('mp-status').textContent = 'LIVE';
    }
  },

  updatePlayerList(players) {
    // Cached for the Wheel's setup step (js/app.js openWheelSetup()), so it
    // can default to "everyone currently connected" without a separate
    // round-trip to the server.
    this.currentPlayers = players;

    const countEl = document.getElementById('mp-players-count');
    const listEl = document.getElementById('mp-player-list');

    countEl.textContent = players.length;
    const battleCount = document.getElementById('battle-session-player-count');
    if (battleCount) battleCount.textContent = String(players.length);
    listEl.style.display = players.length > 0 ? 'block' : 'none';

    listEl.innerHTML = players.map(p => `
      <div class="mp-player">
        <span class="mp-player-name mp-little-hero">${this.littleHeroAvatarHTML(p, true)}<span>${this.escapeHtml(p.name)}</span></span>
        <span class="mp-player-status">
          <span class="mp-status-dot ${p.connected ? 'connected' : 'disconnected'}"></span>
          <span class="mp-status-text">${p.connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
        </span>
      </div>
    `).join('');

    this.renderSessionLeaderboard(players);
    if (this.chatMessages?.length) this.renderGMChat();
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
        <span class="lb-name lb-little-hero">${this.littleHeroAvatarHTML(p, true)}<span>${this.escapeHtml(p.name)}</span></span>
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
        <span class="lb-name lb-little-hero">${this.littleHeroAvatarHTML(p, true)}<span>${this.escapeHtml(p.name)}</span></span>
        <span class="lb-score">${p.lifetimeScore}</span>
      </div>
    `).join('') || '<div class="leaderboard-empty">No recorded players yet</div>';
  },

  declareFinalFailed() {
    if (this.mode !== 'multiplayer' || this.finalRevealed) return;
    if (!confirm('Declare the Final SOLUTION failed? This reveals the answer and applies the loss penalty to every connected player.')) return;
    this.send({ type: 'gm:failFinal' });
  },

  // WOMF -- explicit GM action, mirrors declareFinalFailed() exactly. This
  // is the ONLY way a column-failed event exists; it is never inferred
  // from guess judging. It adds a WOMF charge only -- no scoring, reveal,
  // or other column/board effect.
  declareColumnFailed(column) {
    if (this.mode !== 'multiplayer') return;
    if (!confirm(`Declare column ${column} failed? This adds a WOMF charge and cannot be undone.`)) return;
    this.send({ type: 'gm:failColumn', column });
  },

  // Manual corrections for the WOMF meter itself (e.g. undoing an
  // accidental FAIL click, or clearing it for a fresh session). These only
  // ever touch the numeric charge -- they never touch any column/Final's
  // reveal state or its red "failed" tag.
  declareWomfSubtract() {
    if (this.mode !== 'multiplayer') return;
    this.send({ type: 'gm:womfSubtract' });
  },

  declareWomfReset() {
    if (this.mode !== 'multiplayer') return;
    if (!confirm('Reset WOMF charge to 0/10? This cannot be undone.')) return;
    this.send({ type: 'gm:womfReset' });
  },

  // WOMF state is broadcast (state:public -> applyServerState) rather than
  // computed locally -- this only ever reflects what the server sent, or
  // the static 0/10 dormant default when there is no room (see
  // cleanupRoom()). Renders on the GM's own working view AND the GM's
  // Public View preview; join.html's read-only copy is updated
  // server-side->player.js the same way.
  updateWomfTracker() {
    const state = this.womf || { charge: 0, armed: false };
    Womf.update('womf-tracker-gm', state);
    Womf.update('womf-tracker-public', state);

    const openBtn = document.getElementById('womf-open-btn');
    if (openBtn) {
      const armed = state.charge >= 10;
      openBtn.disabled = !armed;
      openBtn.classList.toggle('armed', armed);
    }

    this.updateWomfControlsVisibility();
  },

  // The DECLARE [X] FAILED controls are multiplayer-only, same gating as
  // the Final-failed button -- WOMF charges only ever come from a live
  // room (there is no local-mode equivalent).
  updateWomfControlsVisibility() {
    const section = document.getElementById('womf-controls-section');
    if (section) section.style.display = this.mode === 'multiplayer' ? 'block' : 'none';
  },

  // OPEN WOMF -- enabled only at charge 10/10. Per the locked spec, this
  // does NOT roll anything and does NOT reset the charge; it only opens
  // the (GM-local, never-broadcast) name-selection step. Confirming that
  // step is what actually sends gm:wheelOpen and makes the real Wheel
  // visible to everyone. Any reset-after-roll logic or punishment/result
  // logic remains explicitly deferred -- do not invent it here.
  openWomf() {
    if (!this.womf || this.womf.charge < 10) return;
    this.openWheelSetup();
  },

  // ---------------------------------------------------------------------
  // WHEEL OF MISFORTUNE -- setup step + roll/close controls. The actual
  // spinning dial (js/wheel.js) is purely a renderer; all of this is just
  // gathering the segment list and sending the three gm:wheel* commands.
  // ---------------------------------------------------------------------

  openWheelSetup() {
    const listEl = document.getElementById('wheel-setup-player-list');
    if (listEl) {
      const players = this.currentPlayers || [];
      listEl.innerHTML = players.length > 0
        ? players.map((p, i) => `
            <label class="wheel-setup-row">
              <input type="checkbox" class="wheel-setup-checkbox" data-player-name="${this.escapeHtmlAttr(p.name)}" checked>
              <span>${this.escapeHtml(p.name)}</span>
            </label>
          `).join('')
        : '<div class="wheel-setup-hint">No players connected yet -- add custom names below.</div>';
    }
    this._wheelSetupCustomNames = [];
    document.getElementById('wheel-setup-overlay')?.classList.add('active');
  },

  closeWheelSetup() {
    document.getElementById('wheel-setup-overlay')?.classList.remove('active');
  },

  addWheelSetupCustomName() {
    const input = document.getElementById('wheel-setup-custom-name');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return;
    if (!this._wheelSetupCustomNames) this._wheelSetupCustomNames = [];
    if (!this._wheelSetupCustomNames.includes(name)) {
      this._wheelSetupCustomNames.push(name);
      const listEl = document.getElementById('wheel-setup-player-list');
      if (listEl) {
        listEl.insertAdjacentHTML('beforeend', `
          <label class="wheel-setup-row">
            <input type="checkbox" class="wheel-setup-checkbox" data-player-name="${this.escapeHtmlAttr(name)}" checked>
            <span>${this.escapeHtml(name)}</span>
          </label>
        `);
      }
    }
    input.value = '';
    input.focus();
  },

  confirmWheelSetup() {
    if (this.mode !== 'multiplayer') return;
    const checked = Array.from(document.querySelectorAll('#wheel-setup-player-list .wheel-setup-checkbox:checked'));
    const segments = checked.map(cb => cb.dataset.playerName).filter(Boolean);
    if (segments.length < 2) {
      alert('Select at least 2 names for the Wheel.');
      return;
    }
    this.send({ type: 'gm:wheelOpen', segments });
    this.closeWheelSetup();
  },

  rollWheel() {
    if (this.mode !== 'multiplayer') return;
    this.send({ type: 'gm:wheelRoll' });
  },

  closeWheel() {
    if (this.mode !== 'multiplayer') return;
    this.send({ type: 'gm:wheelClose' });
  },

  // Server-authoritative, same philosophy as updateWomfTracker(): this only
  // ever reflects the last state:public broadcast (or the closed/empty
  // default when there is no room).
  updateWheelUI() {
    const state = this.wheel || { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
    Wheel.update('wheel-overlay', state, true, {
      onRoll: () => this.rollWheel(),
      onClose: () => this.closeWheel()
    });
  },

  // ---------------------------------------------------------------------
  // TIMER + BORROWED TIME -- GM controls just send the command; all display
  // logic (numeric, bars, phase labels, color states) lives in js/timer.js,
  // driven entirely by the server-authoritative state:public broadcast.
  // ---------------------------------------------------------------------

  startTimer() {
    if (this.mode !== 'multiplayer') return;
    this.send({ type: 'gm:timerStart' });
  },

  pauseTimer() {
    if (this.mode !== 'multiplayer') return;
    this.send({ type: 'gm:timerPause' });
  },

  resumeTimer() {
    if (this.mode !== 'multiplayer') return;
    this.send({ type: 'gm:timerResume' });
  },

  // GM manual correction (+30s/-30s). The server nudges whichever clock
  // is actually active (normal or Borrowed Time) and lets phase recompute
  // naturally on its own next tick -- this never resets anything, see
  // server.js's handleTimerAdjust.
  adjustTimer(deltaMs) {
    if (this.mode !== 'multiplayer') return;
    this.send({ type: 'gm:timerAdjust', deltaMs });
  },

  // Server-authoritative, same philosophy as updateWomfTracker()/
  // updateWheelUI(): only ever reflects the last state:public broadcast, or
  // the static un-started 'ready' default when there is no room (see
  // cleanupRoom()). The GM's own main tracker gets START/PAUSE/RESUME; the
  // GM's Public View preview copy is read-only, exactly like the WOMF
  // tracker split.
  updateTimerUI() {
    const state = this.timer || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 };
    Timer.update('timer-tracker-gm', state, true, {
      onStart: () => this.startTimer(),
      onPause: () => this.pauseTimer(),
      onResume: () => this.resumeTimer(),
      onAdjust: (deltaMs) => this.adjustTimer(deltaMs)
    });
    Timer.update('timer-tracker-public', state, false);
  },

  updateFailFinalButtonVisibility() {
    const btn = document.getElementById('declare-final-failed-btn');
    if (!btn) return;
    btn.style.display = (this.mode === 'multiplayer' && !this.finalRevealed) ? 'block' : 'none';
  },

  showBattleControlsOnline() {
    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;
    const existing = layer.querySelector('.battle-controls-online');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'battle-controls-online';
    banner.innerHTML = `
      <div class="battle-controls-link">[ SYSTEM LINK ESTABLISHED ]</div>
      <div class="battle-controls-title">BATTLE CONTROLS ONLINE</div>
      <div class="battle-controls-channel">[ ALL CHANNELS UNRESTRICTED ]</div>
    `;
    layer.appendChild(banner);
    setTimeout(() => banner.classList.add('battle-controls-online-out'), 2400);
    setTimeout(() => banner.remove(), 3000);
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
    // No room -> no authoritative WOMF value anymore. Local mode has no
    // WOMF equivalent, so the tracker goes back to its static dormant 0/10
    // default rather than holding onto the last room's charge.
    this.womf = { charge: 0, armed: false };
    this.updateWomfTracker();
    // Same for the Wheel -- it's inherently multiplayer-only, so it has no
    // local-mode equivalent either; make sure it's hidden rather than
    // stuck showing the last room's spin.
    this.wheel = { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
    this.updateWheelUI();
    // Same for the Timer -- local mode has no server-authoritative countdown,
    // so it goes back to the static un-started 'ready' default rather than
    // holding onto (or continuing to display) the last room's clock.
    this.timer = { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 };
    this.updateTimerUI();
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

  BG_OVERRIDE_KEY: 'asoc_bg_override',

  // `persist` is true for a genuine GM choice (the dropdown, a live
  // upload) so it survives a page refresh; it's false for anything
  // programmatic (initial load, a game switch, syncing a multiplayer
  // broadcast) so those never overwrite the GM's saved choice.
  applyBackground(path, persist = true) {
    const bgLayer = document.getElementById('background-layer');
    if (!path) {
      bgLayer.src = '';
      bgLayer.classList.remove('loaded');
    } else {
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
    }

    if (this.mode === 'multiplayer' && this.roomCode) {
      this.sendCommand('changeBackground', { background: path });
    }

    if (persist) {
      try {
        if (path) localStorage.setItem(this.BG_OVERRIDE_KEY, path);
        else localStorage.removeItem(this.BG_OVERRIDE_KEY);
      } catch (e) {
        // localStorage unavailable (private mode, etc) -- the choice just
        // won't survive a refresh; not fatal.
      }
    }
  },

  // Applies whatever background the GM last manually picked (persisted
  // across refreshes and game switches via localStorage), falling back to
  // the loaded game's own default background only when no override is
  // saved, or the saved path no longer exists in the background library.
  // Multiplayer sync (applyServerState, the game:loaded broadcast handler)
  // deliberately does NOT go through this -- the room's background there
  // is server-authoritative and shared with players, and must never be
  // silently swapped for the GM's local preference.
  applyPersistedOrDefaultBackground() {
    let override = null;
    try {
      override = localStorage.getItem(this.BG_OVERRIDE_KEY);
    } catch (e) {
      // localStorage unavailable -- just fall through to the game default.
    }
    const validOverride = override && (this.backgrounds || []).some(bg => bg.path === override);
    const path = validOverride ? override : (GameData.currentGame?.background || '');

    this.applyBackground(path, false);

    const bgSelect = document.getElementById('bg-select');
    if (bgSelect) {
      const opt = Array.from(bgSelect.options).find(o => o.value === path);
      if (opt) opt.selected = true;
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

    // Public View only needs the game title here. Theme and difficulty
    // are already encoded elsewhere in the presentation and were redundant.
    // Keep the header outside the ratio-locked board frame.
    const headerBar = document.getElementById('public-header-bar');
    if (headerBar) {
      headerBar.innerHTML = `
        <div class="public-title">${this.escapeHtml(game.title)}</div>
      `;
    }

    let html = `
      <div class="asoc-board">
        ${Skeleton.skeletonHTML(game.difficulty)}
        ${this.renderShadowBrokerLineHTML()}
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
      const outcome = Board.getCellOutcome(col, 5);

      html += this.createPublicCellHTML(key, content, true, revealed, `${col}5`, false, outcome);
    });

    const finalContent = GameData.getFinalSolution();
    const finalRevealed = Board.isFinalRevealed();
    const finalOutcome = Board.getFinalOutcome();
    // See _finalFlourishUntil's declaration -- true for every rebuild
    // that falls inside the short window applyServerState() opened on the
    // authoritative reveal transition, false for anything before or after.
    const playFinalFlourish = finalRevealed && Date.now() < this._finalFlourishUntil;
    html += this.createPublicCellHTML('FINAL', finalContent, true, finalRevealed, 'FINAL', true, finalOutcome, playFinalFlourish);

    html += '</div>';
    publicBoard.innerHTML = html;
    Skeleton.attach(publicBoard.querySelector('.asoc-board'));
  },

  // Recomputes the Shadow Broker board line's visible substring/opacity
  // fresh from wall-clock time (Skeleton.shadowBrokerLineState) every time
  // Public View is rebuilt -- called from inside updatePublicView() itself,
  // so it's never stale relative to whatever else just changed.
  renderShadowBrokerLineHTML() {
    if (!this._brokerLineText) return '';
    const now = Date.now();
    const state = Skeleton.shadowBrokerLineState(this._brokerLineText, this._brokerLineStartedAt, now);
    if (!state) {
      this._brokerLineText = null;
      return '';
    }
    const interrupted = now < this._brokerLineInterruptedUntil ? ' sb-interrupted' : '';
    const interruptElapsed = interrupted ? 220 - (this._brokerLineInterruptedUntil - now) : 0;
    const interruptStyle = interrupted ? `;animation-delay:-${Math.max(0, interruptElapsed)}ms` : '';
    return `
      <div class="shadow-broker-board-line${interrupted}" style="${Skeleton.shadowBrokerLineStyle()}">
        <span class="shadow-broker-board-line-text" style="opacity:${state.opacity.toFixed(3)}${interruptStyle}">${this.escapeHtml(state.visibleText)}</span>
      </div>
    `;
  },

  // Starts a new Shadow Broker board-line transmission on Public View. See
  // PlayerApp's identical copy in js/player.js for the full rationale --
  // this interval only exists to make the reveal visible frame-by-frame;
  // the actual displayed text/opacity always comes fresh from
  // renderShadowBrokerLineHTML()'s time-based computation.
  playShadowBrokerBoardLine(text) {
    if (!text) return;
    const now = Date.now();
    const isActive = !!(
      this._brokerLineText &&
      Skeleton.shadowBrokerLineState(this._brokerLineText, this._brokerLineStartedAt, now)
    );
    if (isActive) {
      this._brokerLineQueue.push(text);
      return;
    }

    this._brokerLineText = text;
    this._brokerLineStartedAt = now;
    this._brokerLineInterruptedUntil = 0;

    if (this._brokerLineTicker) clearInterval(this._brokerLineTicker);
    this._brokerLineTicker = setInterval(() => {
      const tickNow = Date.now();
      const active = this._brokerLineText &&
        Skeleton.shadowBrokerLineState(this._brokerLineText, this._brokerLineStartedAt, tickNow);
      if (!active) {
        const next = this._brokerLineQueue.shift();
        if (next) {
          this._brokerLineText = next;
          this._brokerLineStartedAt = tickNow;
          this._brokerLineInterruptedUntil = tickNow + 220;
        } else {
          this._brokerLineText = null;
          clearInterval(this._brokerLineTicker);
          this._brokerLineTicker = null;
        }
      }
      this.updatePublicView();
    }, 40);
  },

  clearShadowBrokerBoardLine() {
    this._brokerLineText = null;
    this._brokerLineStartedAt = 0;
    this._brokerLineInterruptedUntil = 0;
    this._brokerLineQueue = [];
    if (this._brokerLineTicker) {
      clearInterval(this._brokerLineTicker);
      this._brokerLineTicker = null;
    }
    this.updatePublicView();
  },

  createPublicCellHTML(key, content, isSolution, revealed, label, isFinal = false, outcome = null, flourish = false) {
    const classes = ['board-cell'];
    if (isSolution) classes.push('solution-cell');
    if (isFinal) classes.push('final-solution');
    if (!revealed) classes.push('hidden');
    else classes.push('revealed');
    if (outcome === 'failed') classes.push('outcome-failed');
    if (flourish) classes.push('final-flourish');

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

  littleHeroAvatarHTML(entity = {}, compact = false) {
    const frameColor = /^#[0-9A-Fa-f]{6}$/.test(entity.frameColor || '')
      ? entity.frameColor.toUpperCase()
      : '#9B5DE0';
    const avatarData = typeof entity.avatarData === 'string' &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(entity.avatarData)
      ? entity.avatarData
      : '';
    return `
      <span class="little-hero-avatar${compact ? ' little-hero-avatar-compact' : ''}" style="--lh-frame:${frameColor}">
        ${avatarData ? `<img src="${avatarData}" alt="">` : '<span class="little-hero-avatar-fallback">LH</span>'}
      </span>
    `;
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
    const columns = ['A', 'B', 'C', 'D'];

    if (!window.GameData.currentGame) {
      this.buildEmptyGMControls();
      return;
    }

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
            <span>${this.escapeHtml(content)}</span>
          </button>
        `;
      });
    }

    columns.forEach(col => {
      const solutionContent = GameData.getCellData(col, 5);
      const revealed = Board.isRevealed(col, 5);
      const failed = Board.getCellOutcome(col, 5) === 'failed';
      clueHtml += `
        <button class="gm-cell-btn solution-btn ${revealed ? 'revealed' : ''} ${failed ? 'outcome-failed' : ''}"
                data-column="${col}" data-row="5"
                title="${this.escapeHtmlAttr(solutionContent)}">
          <span style="font-size:0.55rem; color:var(--accent-gold);">${col}5</span>
          <span>${this.escapeHtml(solutionContent)}</span>
        </button>
      `;
    });

    const finalRevealed = Board.isFinalRevealed();
    const finalContent = GameData.getFinalSolution();
    const finalFailed = Board.getFinalOutcome() === 'failed';
    clueHtml += `
      <button class="gm-cell-btn final-btn ${finalRevealed ? 'revealed' : ''} ${finalFailed ? 'outcome-failed' : ''}"
              data-final="true"
              title="${this.escapeHtmlAttr(finalContent)}">
        <span style="font-size:0.55rem; color:var(--accent-gold);">FINAL</span>
        <span>${this.escapeHtml(finalContent)}</span>
      </button>
    `;

    gmClueGrid.innerHTML = clueHtml;

    const revealHideAllBtn = document.getElementById('reveal-hide-all-btn');
    if (revealHideAllBtn) {
      const allRevealed = Board.isAllRevealed();
      revealHideAllBtn.textContent = allRevealed ? 'HIDE ALL' : 'REVEAL ALL';
      revealHideAllBtn.classList.toggle('revealed', allRevealed);
    }
  },

  // No game loaded (or the active game was cleared): render the same grid
  // shape with coordinate labels only -- no REVEAL/HIDE text, no stale
  // words from whatever game was loaded before, no revealed/green state.
  // Buttons are disabled so an empty slot can't send a reveal command.
  buildEmptyGMControls() {
    const gmClueGrid = document.getElementById('gm-clue-grid');
    const columns = ['A', 'B', 'C', 'D'];

    let clueHtml = '';
    for (let row = 1; row <= 4; row++) {
      columns.forEach(col => {
        clueHtml += `
          <button class="gm-cell-btn" data-column="${col}" data-row="${row}" disabled>
            <span style="font-size:0.55rem; color:var(--text-dim);">${col}${row}</span>
            <span></span>
          </button>
        `;
      });
    }

    columns.forEach(col => {
      clueHtml += `
        <button class="gm-cell-btn solution-btn" data-column="${col}" data-row="5" disabled>
          <span style="font-size:0.55rem; color:var(--accent-gold);">${col}5</span>
          <span></span>
        </button>
      `;
    });

    clueHtml += `
      <button class="gm-cell-btn final-btn" data-final="true" disabled>
        <span style="font-size:0.55rem; color:var(--accent-gold);">FINAL</span>
        <span></span>
      </button>
    `;

    if (gmClueGrid) gmClueGrid.innerHTML = clueHtml;

    const revealHideAllBtn = document.getElementById('reveal-hide-all-btn');
    if (revealHideAllBtn) {
      revealHideAllBtn.textContent = 'REVEAL ALL';
      revealHideAllBtn.classList.remove('revealed');
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
    // The GM's own Shadow Broker broadcasts land back in this same list
    // (broadcastChatUpdate reaches the host too) -- it's the GM's own
    // outgoing transmission, not a guess, so it never gets judge controls.
    // It renders as the SAME avatar/name/text bubble the players see
    // (Skeleton.shadowBrokerTransmissionHTML), not a plain tinted row --
    // no separate ".gm-chat-message" wrapper needed since the shared
    // bubble already carries its own border/background/spacing.
    if (msg.source === 'shadowBroker') {
      const isNew = !this._seenShadowBrokerKeys.has(msg.id);
      if (isNew) this._seenShadowBrokerKeys.add(msg.id);
      return Skeleton.shadowBrokerTransmissionHTML(msg.text, { glitchIn: isNew });
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const identity = (this.currentPlayers || []).find(p => p.id === msg.playerId) || msg;
    const hasVerdict = msg.verdict !== null;
    const showControls = !hasVerdict;
    const themeColor = /^#[0-9A-Fa-f]{6}$/.test(identity.themeColor || '') ? identity.themeColor : '#343A42';
    const frameColor = /^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885';

    return `
      <div class="gm-chat-message discord-row ${hasVerdict ? 'has-verdict' : ''} ${msg.verdict || ''}" data-message-id="${msg.id}" style="--little-hero-theme:${themeColor};--little-hero-accent:${frameColor}">
        <span class="gm-chat-leading">${this.littleHeroAvatarHTML(identity, true)}</span>
        <span class="gm-chat-inline-content">
          <span class="gm-chat-player-name">${this.escapeHtml(msg.playerName)}</span>
          <span class="gm-chat-time">${time}</span>
          <span class="gm-chat-message-text">${this.escapeHtml(msg.text)}</span>
          ${msg.verdict ? `<span class="gm-chat-mini-verdict ${msg.verdict}">${msg.verdict === 'correct' ? '🖤 ACCEPTED' : '× REJECTED'}${msg.target ? ` // ${this.getTargetLabel(msg.target)}` : ''}</span>` : ''}
        </span>
        ${showControls ? `<span class="gm-chat-quick-actions" aria-label="Judge message if it is an answer">
          <button class="gm-verdict-btn wrong" data-message-id="${msg.id}" data-verdict="wrong" title="Reject as answer">×</button>
          <button class="gm-verdict-btn correct" data-message-id="${msg.id}" data-verdict="correct" title="Accept as answer">🖤</button>
        </span>` : '<span class="gm-chat-quick-actions adjudicated" aria-hidden="true"></span>'}
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

  // SHADOW BROKER free-form broadcast -- host-only, sent as its own new
  // 'gm:broadcast' command (see handleGmBroadcast in server.js). This does
  // not touch judgeGuess/applyVerdict/scoring in any way; it's a
  // completely separate, additive chat-message type.
  sendShadowBrokerBroadcast() {
    const input = document.getElementById('shadow-broker-input');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    if (this.mode === 'multiplayer' && this.roomCode) {
      // Live room: let the authoritative server broadcast it to every
      // connected surface exactly as before.
      this.send({ type: 'gm:broadcast', text });
    } else {
      // No room: TRANSMIT still means transmit. Play the message locally on
      // both GM board surfaces and keep it in the GM chat log instead of
      // refusing the action just because multiplayer is not active.
      const localMsg = {
        id: `shadow-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: 'shadowBroker',
        text,
        timestamp: Date.now(),
        verdict: null
      };
      this.chatMessages.push(localMsg);
      this.playShadowBrokerBoardLine(text);
      Board.playShadowBrokerBoardLine(text);
      this.renderGMChat();
    }

    input.value = '';
    // Keep focus in the box so Enter can fire the next transmission
    // immediately. There is deliberately no character counter or GM-side
    // transmission length cap.
    input.focus();
  },

  clearShadowBrokerBroadcast() {
    const input = document.getElementById('shadow-broker-input');
    this.clearShadowBrokerBoardLine();
    Board.clearShadowBrokerBoardLine();
    if (this.mode === 'multiplayer' && this.roomCode) {
      this.send({ type: 'gm:clearBroadcast' });
    }
    if (input) input.focus();
  },

  flashShadowBrokerNoRoom() {
    const form = document.getElementById('shadow-broker-form');
    const input = document.getElementById('shadow-broker-input');
    if (!form || !input) return;
    if (this._brokerNoRoomTimeout) {
      clearTimeout(this._brokerNoRoomTimeout);
    } else {
      this._brokerNoRoomPlaceholder = input.placeholder;
    }
    form.classList.remove('shadow-broker-no-room');
    // Force reflow so re-triggering the class restarts the CSS animation
    // if the operator clicks TRANSMIT again before the first flash ends.
    void form.offsetWidth;
    form.classList.add('shadow-broker-no-room');
    input.placeholder = 'HOST A ROOM FIRST';
    this._brokerNoRoomTimeout = setTimeout(() => {
      form.classList.remove('shadow-broker-no-room');
      input.placeholder = this._brokerNoRoomPlaceholder;
      this._brokerNoRoomTimeout = null;
    }, 1400);
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