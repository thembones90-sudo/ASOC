const PlayerApp = {
  ws: null,
  roomCode: '',
  playerId: '',
  playerName: '',
  reconnectTimer: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  lastPublicState: null,
  chatMessages: [],
  solvedTargets: {},
  userScrolledUp: false,
  // FINAL SOLUTION REVEAL FLOURISH -- same one-shot guard as App's copy in
  // js/app.js (see its comment): renderBoard() fully rebuilds the board on
  // every broadcast, so this flag is what keeps the animation from
  // replaying on every incidental re-render while the Final stays revealed.
  _finalFlourishPlayed: false,

  // SHADOW BROKER glitch-in guard -- renderChat() rebuilds the entire chat
  // list from scratch on every chat:update (a new guess from ANY player,
  // not just Broker activity), so a naive "is this a Broker message" check
  // would replay the glitch on every already-displayed transmission every
  // single time. Instead we remember which transmissions have already
  // played their one-shot arrival glitch, keyed so a genuinely NEW event
  // (a fresh broadcast, or a verdict actually changing) gets a fresh key
  // and therefore still glitches in, while re-rendering the same
  // already-seen state never does. Standalone broadcasts key on the
  // message id (which never changes); verdict responses key on
  // `${message id}:${verdict}` so a correction (wrong -> correct) is
  // treated as a new transmission, matching "the Broker updates its
  // judgment," while an unrelated rerender of an unchanged verdict is not.
  _seenShadowBrokerKeys: new Set(),

  // SHADOW BROKER BOARD LINE -- the transient HUD line above the avatar's
  // head on the board itself (separate from the chat-feed transmissions
  // above). _chatEverInitialized guards the very first chat:update after
  // connecting: without it, a player joining mid-game would see every
  // Broker message in the room's whole history replay as a "new" arrival
  // the instant they connect -- the same seed-time trap the Borrowed Time
  // banner and Final flourish already had to guard against elsewhere in
  // this codebase. _brokerLineText/_brokerLineStartedAt feed
  // Skeleton.shadowBrokerLineState(), which recomputes the visible
  // substring/opacity fresh from wall-clock time on every board rebuild
  // (see renderShadowBrokerLineHTML) rather than an imperative DOM-mutating
  // interval, so it survives any number of incidental rebuilds mid-reveal.
  // _brokerLineTicker just re-invokes renderBoard() on a fast interval for
  // the duration of one transmission so the reveal is actually visible
  // frame-by-frame; it's cleared the moment the state function returns null.
  _chatEverInitialized: false,
  _brokerLineText: null,
  _brokerLineStartedAt: 0,
  _brokerLineTicker: null,
  _brokerLineInterruptedUntil: 0,
  _brokerLineQueue: [],

  init() {
    this.bindJoinForm();
    this.loadStoredCredentials();
    Womf.init('womf-tracker-player');
    Wheel.init('wheel-overlay');
    Timer.init('timer-tracker-player');
  },

  bindJoinForm() {
    const form = document.getElementById('join-form');
    const roomInput = document.getElementById('room-code');
    const nameInput = document.getElementById('player-name');

    roomInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.joinGame();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.joinGame();
      }
    });
  },

  loadStoredCredentials() {
    const storedRoom = sessionStorage.getItem('asoc_room_code');
    const storedName = sessionStorage.getItem('asoc_player_name');
    const storedId = sessionStorage.getItem('asoc_player_id');

    if (storedRoom) document.getElementById('room-code').value = storedRoom;
    if (storedName) document.getElementById('player-name').value = storedName;
    if (storedId) this.playerId = storedId;
  },

  async joinGame() {
    const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
    const playerName = document.getElementById('player-name').value.trim();

    if (!roomCode || roomCode.length !== 4) {
      this.showError('Room code must be 4 characters');
      return;
    }

    if (!playerName) {
      this.showError('Please enter your name');
      return;
    }

    this.roomCode = roomCode;
    this.playerName = playerName;
    // Fresh join attempt — any previous room-closed state no longer applies.
    this._roomClosedByServer = false;

    sessionStorage.setItem('asoc_room_code', roomCode);
    sessionStorage.setItem('asoc_player_name', playerName);
    if (this.playerId) sessionStorage.setItem('asoc_player_id', this.playerId);

    this.connectWebSocket();
  },

  connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[PLAYER] WebSocket connected');
      // Send our previously-issued playerId (if we have one, from
      // sessionStorage or a prior join:success in this tab) so the server
      // can reclaim our old identity instead of minting a new one and
      // leaving a stale "ghost" entry behind for the same person.
      this.send({ type: 'room:join', roomCode: this.roomCode, name: this.playerName, playerId: this.playerId || undefined });
      this.setConnectionStatus('connecting');
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error('[PLAYER] Message parse error:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('[PLAYER] WebSocket closed');
      this.handleDisconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[PLAYER] WebSocket error:', err);
    };
  },

  send(message) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message));
    }
  },

  handleMessage(message) {
    switch (message.type) {
      case 'state:public':
        this.lastPublicState = message;
        this.renderBoard(message);
        // Read-only: no controls are ever exposed here, only the same
        // charge/state the GM sees, sourced from the same broadcast.
        Womf.update('womf-tracker-player', message.womf || { charge: 0, armed: false });
        Wheel.update('wheel-overlay', message.wheel, false);
        Timer.update('timer-tracker-player', message.timer || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 }, false);
        this.showGameScreen();
        this.setConnectionStatus('connected');
        this.reconnectAttempts = 0;
        break;

      case 'join:success':
        this.playerId = message.playerId;
        sessionStorage.setItem('asoc_player_id', this.playerId);
        break;

      case 'chat:update': {
        const incoming = message.messages || [];
        // Only look for a "new" standalone Broker broadcast to trigger the
        // board-line reveal AFTER the first hydration -- otherwise a
        // player joining mid-game would see the room's entire chat history
        // replay as a fresh transmission the moment they connect.
        if (this._chatEverInitialized) {
          const previousIds = new Set(this.chatMessages.map(m => m.id));
          const newBrokerMsg = incoming.find(m => m.source === 'shadowBroker' && !previousIds.has(m.id));
          if (newBrokerMsg) this.playShadowBrokerBoardLine(newBrokerMsg.text);
        }
        this._chatEverInitialized = true;
        this.chatMessages = incoming;
        this.solvedTargets = message.solvedTargets || {};
        this.renderChat();
        break;
      }

      case 'shadowBroker:clear':
        this.clearShadowBrokerBoardLine();
        break;

      case 'players:update':
        this.updatePlayerLeaderboard(message.players);
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

      case 'leaderboard:allTime':
        this.renderAllTimeLeaderboard(message.players || []);
        break;

      case 'error':
        this.showError(message.message);
        if (message.message.includes('Room not found') || message.message.includes('already connected')) {
          this.showJoinScreen();
        }
        break;

      case 'room:closed':
        // The server closes our socket right after this message, which
        // would otherwise also fire the ws.onclose -> handleDisconnect ->
        // attemptReconnect path and race it against the flow below (a
        // flash of "RECONNECTING" followed by a doomed reconnect attempt
        // to a room that's already gone). This flag tells handleDisconnect
        // to stand down.
        this._roomClosedByServer = true;
        this.showReconnecting(true);
        setTimeout(() => {
          alert(message.message || 'Room closed by host');
          this.showJoinScreen();
        }, 1000);
        break;

      default:
        console.log('[PLAYER] Unknown message type:', message.type);
    }
  },

  renderBoard(state) {
    const publicBoard = document.getElementById('public-board');
    if (!publicBoard) return;

    const gameData = {
      id: state.gameId,
      title: state.title,
      theme: state.theme,
      difficulty: state.difficulty,
      background: state.background,
      columns: {},
      finalSolution: state.finalSolution?.value || ''
    };

    const columns = ['A', 'B', 'C', 'D'];
    columns.forEach(col => {
      gameData.columns[col] = { clues: ['', '', '', ''], solution: '' };
    });

    Object.entries(state.cells).forEach(([key, cell]) => {
      if (cell.revealed && cell.value) {
        const col = key[0];
        const row = parseInt(key.slice(1), 10);
        if (row >= 1 && row <= 4) {
          gameData.columns[col].clues[row - 1] = cell.value;
        } else if (row === 5) {
          gameData.columns[col].solution = cell.value;
        }
      }
    });

    window.GameData.currentGame = gameData;

    // Title/theme/difficulty badge render into a SEPARATE element that
    // lives OUTSIDE .public-board-frame (see join.html) -- the frame must
    // contain ONLY the board so its aspect-ratio box is exactly the
    // 1900x1267 board and nothing else. See .public-board-frame's comment
    // in join.html's inline <style> for the full writeup of the
    // distortion bug this fixes.
    const headerBar = document.getElementById('public-header-bar');
    if (headerBar) {
      headerBar.innerHTML = `
        <div class="public-title">${this.escapeHtml(state.title)}</div>
        <div class="public-theme">${this.escapeHtml(state.theme)}</div>
        ${state.difficulty ? `<span class="difficulty-badge public-difficulty diff-${state.difficulty.toLowerCase()}">${this.escapeHtml(state.difficulty)}</span>` : ''}
      `;
    }

    let html = `
      <div class="asoc-board">
        ${Skeleton.skeletonHTML(state.difficulty)}
        ${this.renderShadowBrokerLineHTML()}
    `;

    for (let row = 1; row <= 4; row++) {
      columns.forEach(col => {
        const key = `${col}${row}`;
        const cell = state.cells[key];
        const revealed = cell?.revealed === true;
        const content = revealed ? (cell.value || '—') : '■■■';
        html += this.createPublicCellHTML(key, content, false, revealed, `${col}${row}`);
      });
    }

    columns.forEach(col => {
      const key = `${col}5`;
      const cell = state.cells[key];
      const revealed = cell?.revealed === true;
      const content = revealed ? (cell.value || '—') : '■■■';
      const outcome = cell?.outcome || null;
      html += this.createPublicCellHTML(key, content, true, revealed, `${col}5`, false, outcome);
    });

    const finalRevealed = state.finalSolution?.revealed === true;
    const finalContent = finalRevealed ? (state.finalSolution.value || '—') : '???';
    const finalOutcome = state.finalSolution?.outcome || null;
    // See App's copy of this same guard in js/app.js -- plays the flourish
    // exactly once per reveal, never on a later incidental re-render.
    const playFinalFlourish = finalRevealed && !this._finalFlourishPlayed;
    this._finalFlourishPlayed = finalRevealed;
    html += this.createPublicCellHTML('FINAL', finalContent, true, finalRevealed, 'FINAL', true, finalOutcome, playFinalFlourish);

    html += '</div>';
    publicBoard.innerHTML = html;
    Skeleton.attach(publicBoard.querySelector('.asoc-board'));

    this.applyBackground(state.background);
  },

  // Recomputes the Shadow Broker board line's visible substring/opacity
  // fresh from wall-clock time (Skeleton.shadowBrokerLineState) every time
  // the board is rebuilt -- called from inside renderBoard() itself, so it
  // is never stale relative to whatever else just changed on the board.
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

  // Starts a new Shadow Broker board-line transmission. Re-invokes
  // renderBoard() on a fast interval purely so the reveal is visible
  // frame-by-frame -- the actual displayed text/opacity always comes from
  // renderShadowBrokerLineHTML()'s fresh time-based computation, never
  // from anything this interval accumulates itself, so it's safe even if
  // OTHER events (a cell reveal, a Timer tick) also call renderBoard() in
  // the middle of it.
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
      if (this.lastPublicState) this.renderBoard(this.lastPublicState);
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
    if (this.lastPublicState) this.renderBoard(this.lastPublicState);
  },

  createPublicCellHTML(key, content, isSolution, revealed, label, isFinal = false, outcome = null, flourish = false) {
    const classes = ['board-cell'];
    if (isSolution) classes.push('solution-cell');
    if (isFinal) classes.push('final-solution');
    if (!revealed) classes.push('hidden');
    else classes.push('revealed');
    if (outcome === 'failed') classes.push('outcome-failed');
    if (flourish) classes.push('final-flourish');

    return `
      <div class="${classes.join(' ')}" data-label="${label}" style="${Skeleton.cellStyle(label)}">
        <div class="cell-content">${this.escapeHtml(content)}</div>
      </div>
    `;
  },

  applyBackground(path) {
    const bgLayer = document.getElementById('background-layer');
    if (!path) {
      bgLayer.src = '';
      return;
    }
    bgLayer.src = path;
  },

  showGameScreen() {
    document.getElementById('join-screen').style.display = 'none';
    document.getElementById('game-screen').classList.add('active');
    document.getElementById('reconnecting-overlay').classList.remove('active');
    this.bindChatForm();
    this.bindLeaderboardToggle();
  },

  showJoinScreen() {
    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('join-screen').style.display = 'flex';
    this.setConnectionStatus('disconnected');
  },

  showReconnecting(isPermanent = false) {
    document.getElementById('reconnecting-overlay').classList.add('active');
    this.setConnectionStatus('disconnected');
  },

  setConnectionStatus(status) {
    const el = document.getElementById('connection-status');
    el.className = 'connection-status ' + status;
    const textMap = {
      connecting: 'CONNECTING',
      connected: 'CONNECTED',
      disconnected: 'DISCONNECTED'
    };
    el.querySelector('.status-text').textContent = textMap[status] || status.toUpperCase();
  },

  handleDisconnect() {
    // If the server deliberately closed this room (room:closed already
    // showed the join screen and flagged us), the close event that follows
    // is expected, not a dropped connection — don't race it into a
    // reconnect attempt against a room that no longer exists.
    if (this._roomClosedByServer) return;
    this.setConnectionStatus('disconnected');
    this.showReconnecting();
    this.attemptReconnect();
  },

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      alert('Unable to reconnect. Please refresh the page.');
      this.showJoinScreen();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);

    this.reconnectTimer = setTimeout(() => {
      console.log(`[PLAYER] Reconnect attempt ${this.reconnectAttempts}`);
      this.connectWebSocket();
    }, delay);
  },

  showError(message) {
    const el = document.getElementById('error-message');
    el.textContent = message;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 5000);
  },

  // ---------------------------------------------------------------------
  // SCORING (compact, subordinate to the board/chat experience)
  // ---------------------------------------------------------------------

  _lastAnnouncedStreak: {},

  bindLeaderboardToggle() {
    const btn = document.getElementById('player-alltime-toggle-btn');
    if (!btn || btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => this.toggleAllTimeView());
  },

  updatePlayerLeaderboard(players) {
    const strip = document.getElementById('player-leaderboard-strip');
    const list = document.getElementById('player-leaderboard-list');
    if (!strip || !list) return;
    if (!players || players.length === 0) {
      strip.style.display = 'none';
      return;
    }
    strip.style.display = 'flex';
    const ranked = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    list.innerHTML = ranked.map(p => `
      <span class="pl-entry ${p.id === this.playerId ? 'pl-entry-me' : ''}">${this.escapeHtml(p.name)} <b>${p.score || 0}</b></span>
    `).join('');
  },

  toggleAllTimeView() {
    const panel = document.getElementById('player-alltime-panel');
    const showing = panel.style.display !== 'none';
    if (showing) {
      panel.style.display = 'none';
    } else {
      this.send({ type: 'leaderboard:getAllTime' });
      panel.style.display = 'block';
      panel.innerHTML = '<div class="leaderboard-empty">Loading…</div>';
    }
  },

  renderAllTimeLeaderboard(players) {
    const panel = document.getElementById('player-alltime-panel');
    if (!panel || panel.style.display === 'none') return;
    panel.innerHTML = (players || []).map((p, i) => `
      <div class="leaderboard-row">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${this.escapeHtml(p.name)}</span>
        <span class="lb-score">${p.lifetimeScore}</span>
      </div>
    `).join('') || '<div class="leaderboard-empty">No recorded players yet</div>';
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
    toast.className = 'score-toast score-toast-compact';
    const detail = award.awardType === 'final'
      ? `FINAL SOLVED AFTER ${award.columnsKnownAtSolve} COLUMN${award.columnsKnownAtSolve === 1 ? '' : 'S'}`
      : `COLUMN ${award.target}`;
    toast.innerHTML = `
      <div class="score-toast-name">${this.escapeHtml(award.playerName)}</div>
      <div class="score-toast-detail">${detail}</div>
      <div class="score-toast-points">+${award.points}</div>
    `;
    layer.appendChild(toast);
    setTimeout(() => toast.classList.add('score-toast-out'), 2800);
    setTimeout(() => toast.remove(), 3300);
  },

  showStreakBanner(activeStreak) {
    if (!activeStreak) { this._lastAnnouncedStreak = {}; return; }
    const { playerId, playerName, columnCount } = activeStreak;
    if (![2, 3, 4].includes(columnCount)) return;
    if (this._lastAnnouncedStreak[playerId] === columnCount) return;
    this._lastAnnouncedStreak[playerId] = columnCount;

    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;
    const banner = document.createElement('div');
    banner.className = 'streak-banner streak-banner-compact';
    banner.innerHTML = `
      <div class="streak-banner-name">${this.escapeHtml(playerName)}</div>
      <div class="streak-banner-label">${columnCount} COLUMN STREAK</div>
    `;
    layer.appendChild(banner);
    setTimeout(() => banner.classList.add('streak-banner-out'), 2400);
    setTimeout(() => banner.remove(), 2900);
  },

  // Phase 1: reveal + story, no numbers yet -- the GM controls when the
  // room sees the score consequences (they click SHOW RESULTS on their
  // console, which is what triggers score:finalResults below).
  showFinalReveal(outcome) {
    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;
    const isSuccess = outcome.outcome === 'success';
    const banner = document.createElement('div');
    banner.className = `final-outcome-banner ${isSuccess ? 'final-outcome-success' : 'final-outcome-failed'}`;
    banner.innerHTML = `
      <div class="fo-headline">${isSuccess ? 'SOLUTION CONFIRMED' : 'FINAL FAILED'}</div>
      ${!isSuccess && outcome.correctSolution ? `<div class="fo-columns-known">${this.escapeHtml(outcome.correctSolution)}</div>` : ''}
      <div class="fo-results" style="display: none;"></div>
    `;
    layer.appendChild(banner);
    this._activeFinalBanner = banner;
  },

  // Phase 2: the GM revealed the results -- fill in the numbers.
  revealFinalResults(results) {
    const banner = this._activeFinalBanner;
    if (!banner) return;
    const isSuccess = results.outcome === 'success';
    const resultsEl = banner.querySelector('.fo-results');
    resultsEl.innerHTML = isSuccess
      ? `<div class="fo-columns-known">FINAL SOLVED AFTER ${results.columnsKnownAtSolve} COLUMN${results.columnsKnownAtSolve === 1 ? '' : 'S'}</div>
         <div class="fo-points fo-points-positive">+${results.points} — ${this.escapeHtml(results.playerName)}</div>`
      : `<div class="fo-points fo-points-negative">-${results.penalty} PER PLAYER</div>`;
    resultsEl.style.display = 'block';

    setTimeout(() => banner.classList.add('final-outcome-out'), 4500);
    setTimeout(() => banner.remove(), 5100);
    this._activeFinalBanner = null;
  },

  bindChatForm() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');

    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitGuess();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitGuess();
      }
    });

    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
      chatContainer.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = chatContainer;
        this.userScrolledUp = (scrollTop + clientHeight) < (scrollHeight - 50);
      });
    }
  },

  submitGuess() {
    const input = document.getElementById('chat-input');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    this.send({ type: 'chat:guess', text });
  },

  renderChat() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const wasAtBottom = !this.userScrolledUp;

    let html = '';
    this.chatMessages.forEach(msg => {
      html += this.createChatMessageHTML(msg);
    });

    container.innerHTML = html;

    if (wasAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  },

  createChatMessageHTML(msg) {
    // SHADOW BROKER standalone broadcast -- a freestanding transmission,
    // not tied to any player's guess. Entirely separate markup from the
    // guess-bubble path below; no verdict, no target, no "own" styling.
    if (msg.source === 'shadowBroker') {
      const isNew = !this._seenShadowBrokerKeys.has(msg.id);
      if (isNew) this._seenShadowBrokerKeys.add(msg.id);
      return Skeleton.shadowBrokerTransmissionHTML(msg.text, { glitchIn: isNew });
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isOwn = msg.playerId === this.playerId;

    // The Shadow Broker's verdict response is an ADDITIONAL identity layer
    // rendered alongside the verdict, not a replacement for it -- the
    // guess bubble above keeps its existing correct/wrong classes and
    // .chat-message-text color/strikethrough treatment exactly as before.
    // msg.verdict remains the sole source of truth; nothing here alters it.
    let verdictResponseHtml = '';
    if (msg.verdict === 'wrong' || msg.verdict === 'correct') {
      const verdictKey = `${msg.id}:${msg.verdict}`;
      const isNew = !this._seenShadowBrokerKeys.has(verdictKey);
      if (isNew) this._seenShadowBrokerKeys.add(verdictKey);
      const verdictText = msg.verdict === 'correct' ? 'Correct.' : 'Incorrect.';
      verdictResponseHtml = Skeleton.shadowBrokerTransmissionHTML(verdictText, {
        glitchIn: isNew,
        variant: 'verdict-response',
        verdict: msg.verdict
      });
    }

    return `
      <div class="chat-message ${isOwn ? 'own' : ''} ${msg.verdict || ''}" data-message-id="${msg.id}">
        <div class="chat-message-header">
          <span class="chat-player-name">${this.escapeHtml(msg.playerName)}</span>
          <span class="chat-time">${time}</span>
        </div>
        <div class="chat-message-text">${this.escapeHtml(msg.text)}</div>
        ${msg.target ? `<div class="chat-target">→ ${this.getTargetLabel(msg.target)}</div>` : ''}
        ${verdictResponseHtml}
      </div>
    `;
  },

  // NOTE: the Shadow Broker transmission markup itself now lives in
  // Skeleton.shadowBrokerTransmissionHTML (js/skeleton.js) so the GM
  // console (app.js) and this player screen render the exact same
  // avatar/name/text bubble instead of two separate implementations.

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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => PlayerApp.init());
window.PlayerApp = PlayerApp;