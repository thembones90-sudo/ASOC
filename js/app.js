const App = {
  currentView: 'gm',
  backgrounds: [],
  mode: 'local',
  roomMode: 'CASUAL',
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
  _gmNewMessageCount: 0,
  _gmWrongFadeTimer: null,
  _gmWrongVerdictSeenAt: new Map(),
  _gmTributeExpiryTimer: null,
  bloodTribute: { status: 'idle' },
  bloodTributes: [],
  chatReactionEmojis: ['😂', '❤️', '🔥', '👍', '🤏', '😇', '😭', '😍', '💀', '🤣', '👎', '😎', '🫡', '🗿', '🤡', '🤦', '🤷', '👀', '👁️', '😏', '😒', '🙄', '😡', '🤬', '😈', '👿', '🤔', '🧐', '😐', '😑', '😬', '😱', '🥶', '🥵', '🫠', '🥴', '🤯', '🥳', '😴', '🤤', '🤢', '🤮', '💩', '🖕', '👏', '🙏', '💪', '🧠', '🖤', '💜', '💔', '⚡', '💥', '✅', '❌', '🏆', '🥰', '🐺'],
  gmEmojiFavoriteDefaults: ['😂', '❤️', '🔥', '👍', '😭'],
  gmEmojiFavorites: [],
  _gmEmojiFavoritesEditing: false,
  _gmEmojiFavoriteSlot: 0,
  _editingBroadcast: null,
  _gmComposerSelection: { start: 0, end: 0 },
  pendingVerdict: null,
  _reconnectPending: false,
  _recoverPending: false,
  _hostingInFlight: false,
  finalRevealed: false,
  // GAME WON -- mirrors the server's authoritative sessionState.gameWon.
  // The live sequence plays ONLY when applyServerState() sees it flip
  // false->true on a connection that has already received a baseline state
  // (_victoryBaselined); the first state after every (re)connect is that
  // baseline, so a refresh/reconnect loads straight into the completed state.
  gameWon: false,
  _victoryBaselined: false,
  _victoryLive: false,
  gameLost: false,
  _lossBaselined: false,
  _lossResultKey: null,
  // GAME COMPLETE -- the server's authoritative "all five fields resolved"
  // (solved OR failed). This, not gameWon, is what locks the board: the Final
  // can be solved early while columns are still open, and those columns still
  // need the clue grid and FAIL A-D to be finished.
  gameComplete: false,
  _gameWonLockedCommands: new Set([
    'revealCell', 'hideCell', 'revealColumn', 'hideColumn',
    'revealAll', 'hideAll', 'revealFinal', 'hideFinal'
  ]),
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
      // The room code itself is no longer persisted: the Master Room is the
      // only room, so a stored token always implies the canonical code.
      const storedToken = sessionStorage.getItem('asoc_host_token');
      if (storedToken) {
        this.roomCode = 'MASTER';
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
      this.setupGMLayoutSplitter();
      this.setupGMChatHeightSplitter();
      this.setupGMClueHeightSplitter();
      this.syncGMLayoutLockUI();
      Forge.init();
      this.populateBackgroundSelector();
      Board.init('#asoc-board');
      this.applyPersistedOrDefaultBackground();
      this.updatePublicView();
      this.updateWomfTracker();
      this.updateTimerUI();
      this.updateMultiplayerUI();
      this.connectWebSocket();
    } catch (e) {
      console.error('Initialization error:', e);
      alert('Failed to initialize ASOC Engine. Check console for details.');
    } finally {
      this.showLoading(false);
    }
  },

  isGMLayoutLocked() {
    try { return localStorage.getItem('asoc_gm_layout_locked') === '1'; }
    catch (_) { return false; }
  },

  setGMLayoutLocked(locked, persist = true) {
    const next = !!locked;
    if (persist) {
      try {
        if (next) localStorage.setItem('asoc_gm_layout_locked', '1');
        else localStorage.removeItem('asoc_gm_layout_locked');
      } catch (_) {}
    }
    document.body.classList.toggle('gm-layout-locked', next);
    this.syncGMLayoutLockUI();
  },

  toggleGMLayoutLock() {
    this.setGMLayoutLocked(!this.isGMLayoutLocked(), true);
  },

  syncGMLayoutLockUI() {
    const locked = this.isGMLayoutLocked();
    document.body.classList.toggle('gm-layout-locked', locked);

    const button = document.getElementById('gm-layout-lock-btn');
    if (button) {
      button.textContent = locked ? 'UNLOCK LAYOUT' : 'LOCK LAYOUT';
      button.classList.toggle('active', locked);
      button.setAttribute('aria-pressed', locked ? 'true' : 'false');
    }

    const status = document.getElementById('gm-layout-lock-status');
    if (status) {
      status.textContent = locked
        ? 'LAYOUT LOCKED // RESIZE CONTROLS SAFE'
        : 'LAYOUT UNLOCKED // RESIZE CONTROLS ACTIVE';
    }

    ['gm-layout-splitter', 'gm-chat-height-splitter', 'gm-clue-height-splitter'].forEach(id => {
      const splitter = document.getElementById(id);
      if (!splitter) return;
      if (!splitter.dataset.unlockedTitle) splitter.dataset.unlockedTitle = splitter.getAttribute('title') || '';
      splitter.setAttribute('aria-disabled', locked ? 'true' : 'false');
      splitter.setAttribute('title', locked ? 'Layout locked // unlock in BACKDOOR' : splitter.dataset.unlockedTitle);
    });
  },

  resetGMPanelLayout() {
    try {
      localStorage.removeItem('asoc_gm_panel_ratio');
      localStorage.removeItem('asoc_gm_chat_height_px');
      localStorage.removeItem('asoc_gm_clue_height_px');
    } catch (_) {}
    window.dispatchEvent(new Event('asoc:gm-layout-reset'));
  },

  setupGMLayoutSplitter() {
    const splitter = document.getElementById('gm-layout-splitter');
    const panel = document.getElementById('gm-panel');
    if (!splitter || !panel) return;

    const STORAGE_KEY = 'asoc_gm_panel_ratio';
    const MOBILE_QUERY = '(max-width: 760px)';
    const MIN_RATIO = 0.18;
    const MAX_RATIO = 0.45;
    const MIN_PANEL_PX = 300;
    const isLocked = () => this.isGMLayoutLocked();
    let dragging = false;
    let currentRatio = null;

    const bounds = () => {
      const viewport = Math.max(window.innerWidth || 0, 1);
      return {
        min: Math.min(MAX_RATIO, Math.max(MIN_RATIO, MIN_PANEL_PX / viewport)),
        max: MAX_RATIO
      };
    };

    const clampRatio = (ratio) => {
      const { min, max } = bounds();
      return Math.max(min, Math.min(max, ratio));
    };

    const updateAria = (ratio) => {
      const pct = Math.round(ratio * 100);
      splitter.setAttribute('aria-valuemin', String(Math.round(bounds().min * 100)));
      splitter.setAttribute('aria-valuemax', String(Math.round(MAX_RATIO * 100)));
      splitter.setAttribute('aria-valuenow', String(pct));
      splitter.setAttribute('aria-valuetext', `GM rail ${pct}% // battlefield ${100 - pct}%`);
      const grip = splitter.querySelector('.gm-layout-splitter-grip');
      if (grip) grip.dataset.resizeReadout = `GM WIDTH ${pct}%`;
    };

    const refitBoard = () => {
      window.dispatchEvent(new Event('resize'));
    };

    const applyRatio = (ratio, persist = false) => {
      if (!Number.isFinite(ratio)) return;
      currentRatio = clampRatio(ratio);
      panel.style.width = `${(currentRatio * 100).toFixed(3)}vw`;
      updateAria(currentRatio);
      if (persist) {
        try { localStorage.setItem(STORAGE_KEY, String(currentRatio)); } catch (_) {}
      }
      refitBoard();
    };

    const computedRatio = () => {
      const viewport = Math.max(window.innerWidth || 0, 1);
      return clampRatio(panel.getBoundingClientRect().width / viewport);
    };

    const resetRatio = () => {
      currentRatio = null;
      panel.style.removeProperty('width');
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      requestAnimationFrame(() => {
        updateAria(computedRatio());
        refitBoard();
      });
    };

    try {
      const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved)) applyRatio(saved, false);
      else updateAria(computedRatio());
    } catch (_) {
      updateAria(computedRatio());
    }

    splitter.addEventListener('pointerdown', (event) => {
      if (isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true;
      document.body.classList.add('gm-layout-resizing');
      splitter.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    splitter.addEventListener('pointermove', (event) => {
      if (!dragging || isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      const viewport = Math.max(window.innerWidth || 0, 1);
      applyRatio((viewport - event.clientX) / viewport, false);
    });

    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('gm-layout-resizing');
      try { splitter.releasePointerCapture?.(event.pointerId); } catch (_) {}
      if (currentRatio !== null) {
        try { localStorage.setItem(STORAGE_KEY, String(currentRatio)); } catch (_) {}
      }
    };

    splitter.addEventListener('pointerup', finishDrag);
    splitter.addEventListener('pointercancel', finishDrag);
    splitter.addEventListener('dblclick', (event) => {
      if (isLocked()) return;
      event.preventDefault();
      resetRatio();
    });

    splitter.addEventListener('keydown', (event) => {
      if (isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      if (event.key === 'Home') {
        event.preventDefault();
        resetRatio();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const base = currentRatio ?? computedRatio();
      const delta = event.key === 'ArrowLeft' ? 0.02 : -0.02;
      applyRatio(base + delta, true);
    });

    window.addEventListener('asoc:gm-layout-reset', resetRatio);
  },

  setupGMChatHeightSplitter() {
    const splitter = document.getElementById('gm-chat-height-splitter');
    const chatPanel = document.querySelector('.gm-module-chat .gm-chat-panel');
    const messages = document.getElementById('gm-chat-messages');
    if (!splitter || !chatPanel) return;

    const STORAGE_KEY = 'asoc_gm_chat_height_px';
    const MOBILE_QUERY = '(max-width: 760px)';
    const DEFAULT_HEIGHT = 220;
    const MIN_HEIGHT = 120;
    const MAX_VIEWPORT_RATIO = 0.78;
    const MAX_ABSOLUTE_HEIGHT = 820;
    const isLocked = () => this.isGMLayoutLocked();
    let dragging = false;
    let dragStartY = 0;
    let dragStartHeight = 0;
    let currentHeight = null;

    const maxHeight = () => Math.max(
      MIN_HEIGHT,
      Math.min(MAX_ABSOLUTE_HEIGHT, Math.floor(Math.max(window.innerHeight || 0, 1) * MAX_VIEWPORT_RATIO))
    );

    const clampHeight = (height) => Math.max(MIN_HEIGHT, Math.min(maxHeight(), height));

    const updateAria = (height) => {
      const px = Math.round(height);
      splitter.setAttribute('aria-valuemin', String(MIN_HEIGHT));
      splitter.setAttribute('aria-valuemax', String(maxHeight()));
      splitter.setAttribute('aria-valuenow', String(px));
      splitter.setAttribute('aria-valuetext', `Battle Chat height ${px} pixels`);
      splitter.dataset.resizeReadout = `CHAT ${px}PX`;
    };

    const applyHeight = (height, persist = false) => {
      if (!Number.isFinite(height)) return;

      const preserve = messages ? {
        atBottom: (messages.scrollHeight - messages.scrollTop - messages.clientHeight) <= 24,
        scrollTop: messages.scrollTop
      } : null;

      currentHeight = clampHeight(height);
      chatPanel.style.height = `${Math.round(currentHeight)}px`;
      updateAria(currentHeight);

      if (messages && preserve) {
        if (preserve.atBottom) {
          messages.scrollTop = messages.scrollHeight;
          this.userScrolledUp = false;
        } else {
          messages.scrollTop = preserve.scrollTop;
          this.userScrolledUp = true;
        }
      }

      if (persist) {
        try { localStorage.setItem(STORAGE_KEY, String(Math.round(currentHeight))); } catch (_) {}
      }
    };

    const computedHeight = () => clampHeight(chatPanel.getBoundingClientRect().height || DEFAULT_HEIGHT);

    const resetHeight = () => {
      currentHeight = null;
      chatPanel.style.removeProperty('height');
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      requestAnimationFrame(() => updateAria(computedHeight()));
    };

    try {
      const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved)) applyHeight(saved, false);
      else updateAria(computedHeight());
    } catch (_) {
      updateAria(computedHeight());
    }

    splitter.addEventListener('pointerdown', (event) => {
      if (isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true;
      dragStartY = event.clientY;
      dragStartHeight = currentHeight ?? computedHeight();
      document.body.classList.add('gm-chat-height-resizing');
      splitter.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    splitter.addEventListener('pointermove', (event) => {
      if (!dragging || isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      applyHeight(dragStartHeight + (event.clientY - dragStartY), false);
    });

    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('gm-chat-height-resizing');
      try { splitter.releasePointerCapture?.(event.pointerId); } catch (_) {}
      if (currentHeight !== null) {
        try { localStorage.setItem(STORAGE_KEY, String(Math.round(currentHeight))); } catch (_) {}
      }
    };

    splitter.addEventListener('pointerup', finishDrag);
    splitter.addEventListener('pointercancel', finishDrag);
    splitter.addEventListener('dblclick', (event) => {
      if (isLocked()) return;
      event.preventDefault();
      resetHeight();
    });

    splitter.addEventListener('keydown', (event) => {
      if (isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      if (event.key === 'Home') {
        event.preventDefault();
        resetHeight();
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const base = currentHeight ?? computedHeight();
      applyHeight(base + (event.key === 'ArrowDown' ? 16 : -16), true);
    });

    window.addEventListener('resize', () => {
      if (currentHeight === null) {
        updateAria(computedHeight());
        return;
      }
      const clamped = clampHeight(currentHeight);
      if (clamped !== currentHeight) applyHeight(clamped, true);
      else updateAria(currentHeight);
    });

    window.addEventListener('asoc:gm-layout-reset', resetHeight);
  },

  setupGMClueHeightSplitter() {
    const splitter = document.getElementById('gm-clue-height-splitter');
    const clueModule = document.querySelector('.gm-module-clues');
    const clueGrid = document.getElementById('gm-clue-grid');
    if (!splitter || !clueModule) return;

    const STORAGE_KEY = 'asoc_gm_clue_height_px';
    const MOBILE_QUERY = '(max-width: 760px)';
    const DEFAULT_HEIGHT = Math.max(300, Math.round(clueModule.getBoundingClientRect().height || 300));
    const MIN_HEIGHT = 190;
    const MAX_VIEWPORT_RATIO = 0.82;
    const MAX_ABSOLUTE_HEIGHT = 920;
    const isLocked = () => this.isGMLayoutLocked();
    let dragging = false;
    let dragStartY = 0;
    let dragStartHeight = 0;
    let currentHeight = null;

    const maxHeight = () => Math.max(
      MIN_HEIGHT,
      Math.min(MAX_ABSOLUTE_HEIGHT, Math.floor(Math.max(window.innerHeight || 0, 1) * MAX_VIEWPORT_RATIO))
    );

    const clampHeight = (height) => Math.max(MIN_HEIGHT, Math.min(maxHeight(), height));

    const updateAria = (height) => {
      const px = Math.round(height);
      splitter.setAttribute('aria-valuemin', String(MIN_HEIGHT));
      splitter.setAttribute('aria-valuemax', String(maxHeight()));
      splitter.setAttribute('aria-valuenow', String(px));
      splitter.setAttribute('aria-valuetext', `Clue Grid height ${px} pixels`);
      splitter.dataset.resizeReadout = `CLUES ${px}PX`;
    };

    const applyHeight = (height, persist = false) => {
      if (!Number.isFinite(height)) return;
      const previousScrollTop = clueGrid?.scrollTop ?? 0;
      currentHeight = clampHeight(height);
      clueModule.style.height = `${Math.round(currentHeight)}px`;
      updateAria(currentHeight);
      if (clueGrid) clueGrid.scrollTop = previousScrollTop;
      if (persist) {
        try { localStorage.setItem(STORAGE_KEY, String(Math.round(currentHeight))); } catch (_) {}
      }
    };

    const computedHeight = () => clampHeight(clueModule.getBoundingClientRect().height || DEFAULT_HEIGHT);

    const resetHeight = () => {
      currentHeight = null;
      clueModule.style.removeProperty('height');
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      requestAnimationFrame(() => updateAria(computedHeight()));
    };

    try {
      const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved)) applyHeight(saved, false);
      else updateAria(computedHeight());
    } catch (_) {
      updateAria(computedHeight());
    }

    splitter.addEventListener('pointerdown', (event) => {
      if (isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true;
      dragStartY = event.clientY;
      dragStartHeight = currentHeight ?? computedHeight();
      document.body.classList.add('gm-clue-height-resizing');
      splitter.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    splitter.addEventListener('pointermove', (event) => {
      if (!dragging || isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      applyHeight(dragStartHeight + (event.clientY - dragStartY), false);
    });

    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('gm-clue-height-resizing');
      try { splitter.releasePointerCapture?.(event.pointerId); } catch (_) {}
      if (currentHeight !== null) {
        try { localStorage.setItem(STORAGE_KEY, String(Math.round(currentHeight))); } catch (_) {}
      }
    };

    splitter.addEventListener('pointerup', finishDrag);
    splitter.addEventListener('pointercancel', finishDrag);
    splitter.addEventListener('dblclick', (event) => {
      if (isLocked()) return;
      event.preventDefault();
      resetHeight();
    });

    splitter.addEventListener('keydown', (event) => {
      if (isLocked() || window.matchMedia(MOBILE_QUERY).matches) return;
      if (event.key === 'Home') {
        event.preventDefault();
        resetHeight();
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const base = currentHeight ?? computedHeight();
      applyHeight(base + (event.key === 'ArrowDown' ? 16 : -16), true);
    });

    window.addEventListener('resize', () => {
      if (currentHeight === null) {
        updateAria(computedHeight());
        return;
      }
      const clamped = clampHeight(currentHeight);
      if (clamped !== currentHeight) applyHeight(clamped, true);
      else updateAria(currentHeight);
    });

    window.addEventListener('asoc:gm-layout-reset', resetHeight);
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

  ensureGMMentionPicker(form) {
    if (!form) return null;
    let picker = form.querySelector('#gm-mention-picker');
    if (picker) return picker;
    picker = document.createElement('div');
    picker.id = 'gm-mention-picker';
    picker.className = 'gm-chat-mention-picker';
    picker.hidden = true;
    picker.setAttribute('role', 'listbox');
    picker.setAttribute('aria-label', 'Tag a player');
    form.appendChild(picker);
    return picker;
  },

  getGMComposerElement() {
    return document.getElementById('shadow-broker-composer');
  },

  serializeGMComposerNode(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches?.('img[data-commander-token]')) return node.dataset.commanderToken || '';
      if (node.tagName === 'BR') return '';
    }
    let out = '';
    node.childNodes?.forEach?.(child => { out += this.serializeGMComposerNode(child); });
    return out;
  },

  getGMComposerText() {
    const composer = this.getGMComposerElement();
    if (composer) return this.serializeGMComposerNode(composer).replace(/[\r\n]+/g, '');
    return document.getElementById('shadow-broker-input')?.value || '';
  },

  getGMComposerSelectionRange() {
    const composer = this.getGMComposerElement();
    const text = this.getGMComposerText();
    if (!composer) return { start: text.length, end: text.length };

    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount < 1 || !selection.anchorNode || !composer.contains(selection.anchorNode) || !selection.focusNode || !composer.contains(selection.focusNode)) {
      const saved = this._gmComposerSelection || {};
      const start = Math.max(0, Math.min(text.length, Number(saved.start) || 0));
      const end = Math.max(start, Math.min(text.length, Number(saved.end) || start));
      return { start, end };
    }

    const offsetTo = (node, offset) => {
      try {
        const range = document.createRange();
        range.selectNodeContents(composer);
        range.setEnd(node, offset);
        return this.serializeGMComposerNode(range.cloneContents()).length;
      } catch (e) {
        return text.length;
      }
    };

    const anchor = offsetTo(selection.anchorNode, selection.anchorOffset);
    const focus = offsetTo(selection.focusNode, selection.focusOffset);
    return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  },

  placeGMComposerCaret(targetOffset) {
    const composer = this.getGMComposerElement();
    if (!composer) return;
    const target = Math.max(0, Number(targetOffset) || 0);
    let consumed = 0;
    let placed = false;
    const range = document.createRange();

    const placeIn = (node) => {
      if (placed) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node.nodeValue || '').length;
        if (target <= consumed + len) {
          range.setStart(node, Math.max(0, Math.min(len, target - consumed)));
          placed = true;
          return;
        }
        consumed += len;
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE && node.matches?.('img[data-commander-token]')) {
        const token = node.dataset.commanderToken || '';
        const len = token.length;
        if (target <= consumed + len) {
          const parent = node.parentNode;
          const index = Array.prototype.indexOf.call(parent.childNodes, node);
          range.setStart(parent, target - consumed < len / 2 ? index : index + 1);
          placed = true;
          return;
        }
        consumed += len;
        return;
      }

      node.childNodes?.forEach?.(placeIn);
    };

    composer.childNodes.forEach(placeIn);
    if (!placed) range.selectNodeContents(composer), range.collapse(false);
    else range.collapse(true);

    const selection = window.getSelection?.();
    selection?.removeAllRanges?.();
    selection?.addRange?.(range);
  },

  setGMComposerText(text, caretOffset = null) {
    const value = String(text ?? '').replace(/[\r\n]+/g, '');
    const model = document.getElementById('shadow-broker-input');
    const composer = this.getGMComposerElement();
    if (model) model.value = value;
    if (!composer) return;

    composer.replaceChildren();
    const tokens = window.CommanderEmojis?.tokens || [];
    let cursor = 0;

    while (cursor < value.length) {
      let nextToken = null;
      let nextIndex = value.length;
      for (const token of tokens) {
        const index = value.indexOf(token, cursor);
        if (index >= 0 && index < nextIndex) {
          nextIndex = index;
          nextToken = token;
        }
      }

      if (nextIndex > cursor) composer.appendChild(document.createTextNode(value.slice(cursor, nextIndex)));
      if (!nextToken) break;

      const item = window.CommanderEmojis?.items?.[nextToken];
      if (item?.src) {
        const img = document.createElement('img');
        img.className = 'commander-inline-emoji commander-composer-emoji';
        img.src = item.src;
        img.alt = item.label || 'Commander emoji';
        img.dataset.commanderToken = nextToken;
        img.contentEditable = 'false';
        img.draggable = false;
        composer.appendChild(img);
      } else {
        composer.appendChild(document.createTextNode(nextToken));
      }
      cursor = nextIndex + nextToken.length;
    }

    if (!value.length) composer.replaceChildren();
    const caret = caretOffset == null ? value.length : Math.max(0, Math.min(value.length, Number(caretOffset) || 0));
    this._gmComposerSelection = { start: caret, end: caret };
    this.placeGMComposerCaret(caret);
  },

  syncGMComposerModel() {
    const model = document.getElementById('shadow-broker-input');
    const text = this.getGMComposerText();
    const selection = this.getGMComposerSelectionRange();
    if (model) {
      model.value = text;
      try {
        model.setSelectionRange(selection.start, selection.end);
      } catch (e) {
        // Hidden transport field does not need a visible selection.
      }
    }
    this._gmComposerSelection = { start: selection.start, end: selection.end };
    return { text, ...selection };
  },

  setGMComposerPlaceholder(text) {
    const value = String(text || '');
    const model = document.getElementById('shadow-broker-input');
    const composer = this.getGMComposerElement();
    if (model) model.placeholder = value;
    if (composer) composer.dataset.placeholder = value;
  },

  insertGMComposerPlainText(text) {
    const insert = String(text || '').replace(/[\r\n]+/g, ' ');
    if (!insert) return;
    const current = this.getGMComposerText();
    const selection = this.getGMComposerSelectionRange();
    const next = current.slice(0, selection.start) + insert + current.slice(selection.end);
    this.setGMComposerText(next, selection.start + insert.length);
  },

  getGMMentionContext(input) {
    if (!input && !this.getGMComposerElement()) return null;
    const state = this.syncGMComposerModel();
    const value = state.text;
    const caret = state.start;
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && /[\\p{L}\\p{N}_]/u.test(before.charAt(at - 1))) return null;
    const query = before.slice(at + 1);
    if (query.length > 40 || /[\r\n:]/.test(query)) return null;
    return { start: at, end: caret, query };
  },

  getGMMentionCandidates(query = '') {
    const needle = String(query || '').trim().toLocaleLowerCase();
    const players = (this.currentPlayers || [])
      .filter(player => player && String(player.name || '').trim())
      .filter(player => !needle || String(player.name).toLocaleLowerCase().includes(needle))
      .sort((a, b) => {
        const aName = String(a.name).toLocaleLowerCase();
        const bName = String(b.name).toLocaleLowerCase();
        const aPrefix = needle && aName.startsWith(needle) ? 0 : 1;
        const bPrefix = needle && bName.startsWith(needle) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        if ((a.connected !== false) !== (b.connected !== false)) return a.connected !== false ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
      });

    // Host-only mass mention. Keep it first so typing just "@" exposes the
    // command immediately, Discord-style, without pretending it is a player.
    const allMatches = !needle || 'all'.includes(needle);
    const candidates = allMatches
      ? [{ id: '__ALL__', name: 'all', connected: true, mentionAll: true }, ...players]
      : players;
    return candidates.slice(0, 8);
  },

  refreshGMMentionRoster() {
    if (this.mode !== 'multiplayer' || !this.roomCode || this.ws?.readyState !== 1) return;
    const now = Date.now();
    if (now - Number(this._gmMentionRosterRequestedAt || 0) < 900) return;
    this._gmMentionRosterRequestedAt = now;
    this.send({ type: 'players:list' });
  },

  renderGMMentionPicker(picker) {
    if (!picker || picker.hidden) return;
    const candidates = this._gmMentionCandidates || [];
    picker.innerHTML = candidates.map((player, index) => {
      if (player.mentionAll) {
        return '<button type="button" class="gm-chat-mention-option gm-chat-mention-all' + (index === this._gmMentionIndex ? ' active' : '') + '" data-mention-index="' + index + '" role="option" aria-selected="' + (index === this._gmMentionIndex ? 'true' : 'false') + '">' +
          '<span class="gm-mention-all-mark">@</span><span>@all</span><small>EVERYONE</small></button>';
      }
      return '<button type="button" class="gm-chat-mention-option' + (index === this._gmMentionIndex ? ' active' : '') + '" data-mention-index="' + index + '" role="option" aria-selected="' + (index === this._gmMentionIndex ? 'true' : 'false') + '">' +
        this.littleHeroAvatarHTML(player, true) +
        '<span>' + this.escapeHtml(player.name) + '</span><small>' + (player.connected === false ? 'OFFLINE' : 'TAG') + '</small></button>';
    }).join('');
  },

  updateGMMentionPicker(input = document.getElementById('shadow-broker-input'), picker = document.getElementById('gm-mention-picker')) {
    if (!input || !picker) return;
    const context = this.getGMMentionContext(input);
    if (!context) {
      this.closeGMMentionPicker(picker);
      return;
    }

    // Mentions target the authoritative MASTER session roster. Refresh it
    // when @ is active instead of trusting whatever player snapshot happened
    // to be cached when this browser last received a players:update frame.
    this.refreshGMMentionRoster();

    const candidates = this.getGMMentionCandidates(context.query);
    if (!candidates.length) {
      this._gmMentionContext = context;
      this._gmMentionCandidates = [];
      this._gmMentionIndex = 0;
      picker.hidden = false;
      picker.innerHTML = '<div class="gm-chat-mention-empty">NO MATCHING SESSION PLAYER</div>';
      return;
    }
    this._gmMentionContext = context;
    this._gmMentionCandidates = candidates;
    this._gmMentionIndex = Math.max(0, Math.min(this._gmMentionIndex || 0, candidates.length - 1));
    picker.hidden = false;
    this.renderGMMentionPicker(picker);
    const emojiPicker = document.getElementById('gm-emoji-picker');
    if (emojiPicker) emojiPicker.hidden = true;
    document.getElementById('gm-emoji-toggle')?.setAttribute('aria-expanded', 'false');
    const attachmentMenu = document.getElementById('gm-attachment-menu');
    if (attachmentMenu) attachmentMenu.hidden = true;
    document.getElementById('gm-image-upload-btn')?.setAttribute('aria-expanded', 'false');
  },

  closeGMMentionPicker(picker = document.getElementById('gm-mention-picker')) {
    if (picker) {
      picker.hidden = true;
      picker.innerHTML = '';
    }
    this._gmMentionContext = null;
    this._gmMentionCandidates = [];
    this._gmMentionIndex = 0;
  },

  selectGMMention(index, input = document.getElementById('shadow-broker-input'), picker = document.getElementById('gm-mention-picker')) {
    const candidate = (this._gmMentionCandidates || [])[Number(index)];
    const context = this._gmMentionContext;
    if (!candidate || !context) return false;
    const replacement = candidate.mentionAll ? '@all ' : '@' + String(candidate.name) + ' ';
    const value = this.getGMComposerText();
    const next = value.slice(0, context.start) + replacement + value.slice(context.end);
    const caret = context.start + replacement.length;
    this.setGMComposerText(next, caret);
    this.getGMComposerElement()?.focus();
    this.closeGMMentionPicker(picker);
    return true;
  },

  handleGMMentionKeydown(event, input, picker) {
    if (!picker || picker.hidden) return false;
    const candidates = this._gmMentionCandidates || [];
    if (!candidates.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this._gmMentionIndex = (this._gmMentionIndex + delta + candidates.length) % candidates.length;
      this.renderGMMentionPicker(picker);
      picker.querySelector('.gm-chat-mention-option.active')?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.selectGMMention(this._gmMentionIndex || 0, input, picker);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeGMMentionPicker(picker);
      return true;
    }
    return false;
  },

  decorateGMChatMentions(container) {
    if (!container) return;
    const names = [...new Set((this.currentPlayers || [])
      .map(player => String(player?.name || '').trim())
      .filter(Boolean))]
      .sort((a, b) => b.length - a.length);

    const regexSpecials = '^$.*+?()[]{}|' + String.fromCharCode(92);
    const escaped = ['all', ...names].map(name => [...name].map(char => regexSpecials.includes(char) ? String.fromCharCode(92) + char : char).join(''));
    const pattern = new RegExp('@(' + escaped.join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');
    const targets = container.querySelectorAll('.gm-chat-message-text, .shadow-broker-text');

    targets.forEach(target => {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        const value = node.nodeValue || '';
        pattern.lastIndex = 0;
        let match;
        let last = 0;
        const fragment = document.createDocumentFragment();
        let changed = false;
        while ((match = pattern.exec(value))) {
          changed = true;
          if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));
          const span = document.createElement('span');
          const mentionAll = String(match[1] || '').toLocaleLowerCase() === 'all';
          span.className = 'chat-mention' + (mentionAll ? ' mention-all' : '');
          span.textContent = match[0];
          fragment.appendChild(span);
          last = match.index + match[0].length;
        }
        if (!changed) return;
        if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last)));
        node.replaceWith(fragment);
      });
    });
  },

  setupEventListeners() {
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
    document.getElementById('game-won-btn')?.addEventListener('click', () => this.triggerGameWon());
    document.getElementById('game-lost-btn')?.addEventListener('click', () => this.testGameLost());
    document.getElementById('recount-btn')?.addEventListener('click', () => this.triggerRecount());
    Recount.onChange(() => this.updateRecountButton());

    document.getElementById('library-btn').addEventListener('click', () => Forge.open());
    document.getElementById('library-btn-footer').addEventListener('click', () => ControlSurfaces.toggle());
    document.getElementById('gm-logout-btn')?.addEventListener('click', () => this.logoutShadowBroker());
    document.getElementById('new-game-btn').addEventListener('click', () => Forge.open().then(() => Forge.openCreator(null, true)));
    document.getElementById('next-game-btn').addEventListener('click', () => Forge.open());

    document.getElementById('room-mode-casual-btn').addEventListener('click', () => {
      this.setRoomMode('CASUAL');
    });
    document.getElementById('room-mode-battle-btn').addEventListener('click', () => {
      this.setRoomMode('BATTLE');
    });

    // SHADOW BROKER free-form broadcast -- presentation layer only, see
    // handleGmBroadcast in server.js. Enter submits (native form submit),
    // same as the player's own chat-form.
    const shadowBrokerForm = document.getElementById('shadow-broker-form');
    const shadowBrokerInput = document.getElementById('shadow-broker-input');
    const shadowBrokerComposer = this.getGMComposerElement();
    const gmMentionPicker = this.ensureGMMentionPicker(shadowBrokerForm);
    this.setGMComposerText(shadowBrokerInput?.value || '', 0);

    shadowBrokerForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.syncGMComposerModel();
      this.sendShadowBrokerBroadcast();
    });

    const gmImageButton = document.getElementById('gm-image-upload-btn');
    const gmImageInput = document.getElementById('gm-image-upload-input');
    const gmGifInput = document.getElementById('gm-gif-upload-input');
    const gmAttachmentMenu = document.getElementById('gm-attachment-menu');
    const gmAttachmentWrap = gmImageButton?.closest('.gm-attachment-wrap');
    const gmPollComposer = document.getElementById('gm-poll-composer');
    const gmPollQuestion = document.getElementById('gm-poll-question');
    const gmPollOptionsEditor = document.getElementById('gm-poll-options');
    const gmPollMultiple = document.getElementById('gm-poll-multiple');

    const closeGMPollComposer = () => {
      if (!gmPollComposer) return;
      gmPollComposer.hidden = true;
    };

    const closeGMAttachmentMenu = () => {
      if (!gmAttachmentMenu || !gmImageButton) return;
      gmAttachmentMenu.hidden = true;
      gmImageButton.setAttribute('aria-expanded', 'false');
    };

    const currentGMPollOptions = () => Array.from(
      gmPollOptionsEditor?.querySelectorAll('.gm-poll-option-input') || []
    ).map(input => input.value);

    const renderGMPollOptionsEditor = (values = ['', '']) => {
      if (!gmPollOptionsEditor) return;
      const clean = values.slice(0, 8);
      while (clean.length < 2) clean.push('');
      gmPollOptionsEditor.replaceChildren();
      clean.forEach((value, index) => {
        const row = document.createElement('div');
        row.className = 'gm-poll-option-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 80;
        input.className = 'gm-poll-option-input';
        input.placeholder = 'Option ' + (index + 1);
        input.value = value;
        row.appendChild(input);
        if (clean.length > 2) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'gm-poll-option-remove';
          remove.dataset.gmPollRemove = String(index);
          remove.textContent = '×';
          remove.setAttribute('aria-label', 'Remove option ' + (index + 1));
          row.appendChild(remove);
        }
        gmPollOptionsEditor.appendChild(row);
      });
    };

    const openGMPollComposer = () => {
      closeGMAttachmentMenu();
      if (!gmPollComposer) return;
      if (!gmPollOptionsEditor?.children.length) renderGMPollOptionsEditor();
      gmPollComposer.hidden = false;
      gmPollQuestion?.focus();
    };

    gmImageButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!gmAttachmentMenu) return gmImageInput?.click();
      const opening = gmAttachmentMenu.hidden;
      gmAttachmentMenu.hidden = !opening;
      gmImageButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) {
        closeGMPollComposer();
        const emojiPicker = document.getElementById('gm-emoji-picker');
        const emojiToggle = document.getElementById('gm-emoji-toggle');
        if (emojiPicker) emojiPicker.hidden = true;
        emojiToggle?.setAttribute('aria-expanded', 'false');
      }
    });

    gmAttachmentMenu?.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest('[data-gm-attachment]')?.dataset.gmAttachment;
      if (!action) return;
      if (action === 'image') {
        closeGMAttachmentMenu();
        gmImageInput?.click();
        return;
      }
      if (action === 'gif') {
        closeGMAttachmentMenu();
        gmGifInput?.click();
        return;
      }
      if (action === 'poll') openGMPollComposer();
    });

    document.getElementById('gm-poll-cancel')?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeGMPollComposer();
    });

    document.getElementById('gm-poll-add-option')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const values = currentGMPollOptions();
      if (values.length >= 8) return;
      renderGMPollOptionsEditor([...values, '']);
      gmPollOptionsEditor?.querySelector('.gm-poll-option-row:last-child input')?.focus();
    });

    gmPollOptionsEditor?.addEventListener('click', (event) => {
      event.stopPropagation();
      const remove = event.target.closest('[data-gm-poll-remove]');
      if (!remove) return;
      const index = Number(remove.dataset.gmPollRemove);
      const values = currentGMPollOptions();
      if (!Number.isInteger(index) || values.length <= 2) return;
      values.splice(index, 1);
      renderGMPollOptionsEditor(values);
    });

    document.getElementById('gm-poll-create')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const question = gmPollQuestion?.value.trim() || '';
      const options = currentGMPollOptions().map(value => value.trim()).filter(Boolean);
      if (!question) return alert('Poll question required.');
      if (options.length < 2) return alert('Poll needs at least two options.');
      if (new Set(options.map(value => value.toLocaleLowerCase())).size !== options.length) {
        return alert('Poll options must be unique.');
      }
      if (!this.ws || this.ws.readyState !== 1 || this.mode !== 'multiplayer') {
        return alert('MASTER ROOM connection required.');
      }
      this.send({
        type: 'chat:poll:create',
        question,
        options,
        allowMultiple: gmPollMultiple?.checked === true
      });
      if (gmPollQuestion) gmPollQuestion.value = '';
      if (gmPollMultiple) gmPollMultiple.checked = false;
      renderGMPollOptionsEditor();
      closeGMPollComposer();
    });

    gmPollComposer?.addEventListener('click', event => event.stopPropagation());

    document.addEventListener('click', (event) => {
      if (gmAttachmentWrap && !gmAttachmentWrap.contains(event.target)) {
        closeGMAttachmentMenu();
        closeGMPollComposer();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeGMAttachmentMenu();
        closeGMPollComposer();
      }
    });

    const uploadGMChatMedia = async (file, expectedType, failureLabel) => {
      if (!file) return;
      if (file.type !== expectedType && !(expectedType === 'image' && ['image/png','image/jpeg','image/webp'].includes(file.type))) {
        return alert(expectedType === 'image/gif' ? 'GIF files only.' : 'PNG, JPG or WEBP only.');
      }
      if (file.size > 5 * 1024 * 1024) return alert((failureLabel || 'File') + ' must be 5 MB or smaller.');
      const caption = this.syncGMComposerModel().text.trim();
      const token = GameData.gmToken || sessionStorage.getItem('asoc_gm_token') || '';
      gmImageButton.disabled = true;
      gmImageButton.classList.add('is-uploading');
      gmImageButton.setAttribute('aria-busy', 'true');
      try {
        const res = await fetch('/api/chat/image?caption=' + encodeURIComponent(caption), {
          method: 'POST',
          headers: { 'Content-Type': file.type, 'x-gm-token': token },
          body: file
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || (failureLabel || 'Media') + ' upload failed');
        this.setGMComposerText('', 0);
      } catch (error) {
        alert(error.message || (failureLabel || 'Media') + ' upload failed');
      } finally {
        gmImageButton.disabled = false;
        gmImageButton.classList.remove('is-uploading');
        gmImageButton.removeAttribute('aria-busy');
      }
    };

    gmImageInput?.addEventListener('change', async () => {
      const file = gmImageInput.files?.[0];
      gmImageInput.value = '';
      await uploadGMChatMedia(file, 'image', 'Image');
    });

    gmGifInput?.addEventListener('change', async () => {
      const file = gmGifInput.files?.[0];
      gmGifInput.value = '';
      await uploadGMChatMedia(file, 'image/gif', 'GIF');
    });

    shadowBrokerComposer?.addEventListener('keydown', (e) => {
      this.syncGMComposerModel();
      if (this.handleGMMentionKeydown(e, shadowBrokerInput, gmMentionPicker)) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        this.sendShadowBrokerBroadcast();
        return;
      }

      if (e.key === 'Escape' && this._editingBroadcast) {
        e.preventDefault();
        this.cancelGMChatEdit();
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        this.setGMComposerText('', 0);
        this.closeGMMentionPicker(gmMentionPicker);
        this.clearShadowBrokerBroadcast();
      }
    });

    shadowBrokerComposer?.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') e.preventDefault();
    });

    shadowBrokerComposer?.addEventListener('input', () => {
      if (!this.getGMComposerText()) shadowBrokerComposer.replaceChildren();
      this.syncGMComposerModel();
      this.updateGMMentionPicker(shadowBrokerInput, gmMentionPicker);
    });

    shadowBrokerComposer?.addEventListener('click', () => {
      this.syncGMComposerModel();
      this.updateGMMentionPicker(shadowBrokerInput, gmMentionPicker);
    });

    shadowBrokerComposer?.addEventListener('paste', (e) => {
      e.preventDefault();
      const plain = e.clipboardData?.getData('text/plain') || '';
      this.insertGMComposerPlainText(plain);
      this.syncGMComposerModel();
      this.updateGMMentionPicker(shadowBrokerInput, gmMentionPicker);
    });

    shadowBrokerComposer?.addEventListener('drop', (e) => e.preventDefault());

    gmMentionPicker?.addEventListener('mousedown', (e) => e.preventDefault());
    gmMentionPicker?.addEventListener('click', (e) => {
      const option = e.target.closest('.gm-chat-mention-option');
      if (!option) return;
      this.selectGMMention(option.dataset.mentionIndex || 0, shadowBrokerInput, gmMentionPicker);
    });

    const gmEmojiToggle = document.getElementById('gm-emoji-toggle');
    const gmEmojiPicker = document.getElementById('gm-emoji-picker');
    const gmReactionPicker = document.getElementById('gm-chat-reaction-picker');
    const gmContextMenu = document.getElementById('gm-chat-context-menu');
    if (gmReactionPicker && gmReactionPicker.parentElement !== document.body) document.body.appendChild(gmReactionPicker);
    if (gmContextMenu && gmContextMenu.parentElement !== document.body) document.body.appendChild(gmContextMenu);
    let gmContextMessageEl = null;
    const closeGMContextMenu = () => {
      if (!gmContextMenu) return;
      gmContextMenu.hidden = true;
      gmContextMenu.removeAttribute('data-message-id');
      gmContextMenu._messageEl = null;
      gmContextMessageEl = null;
    };
    const openGMContextMenu = (messageEl, clientX, clientY) => {
      if (!gmContextMenu || !messageEl) return;
      const messageId = messageEl.dataset.messageId || '';
      if (!messageId) return;
      gmContextMessageEl = messageEl;
      gmContextMenu._messageEl = messageEl;
      gmContextMenu.dataset.messageId = messageId;
      const editButton = gmContextMenu.querySelector('[data-gm-chat-action="edit"]');
      if (editButton) editButton.hidden = messageEl.dataset.editable !== 'true';
      gmContextMenu.hidden = false;
      if (gmReactionPicker) gmReactionPicker.hidden = true;
      if (gmEmojiPicker) gmEmojiPicker.hidden = true;
      gmEmojiToggle?.setAttribute('aria-expanded', 'false');
      const attachmentMenu = document.getElementById('gm-attachment-menu');
      const attachmentToggle = document.getElementById('gm-image-upload-btn');
      if (attachmentMenu) attachmentMenu.hidden = true;
      attachmentToggle?.setAttribute('aria-expanded', 'false');
      requestAnimationFrame(() => {
        const rect = gmContextMenu.getBoundingClientRect();
        const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
        const top = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
        gmContextMenu.style.left = left + 'px';
        gmContextMenu.style.top = top + 'px';
        gmContextMenu.querySelector('button')?.focus({ preventScroll:true });
      });
    };
    this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);

    gmEmojiToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!gmEmojiPicker) return;
      const opening = gmEmojiPicker.hidden;
      gmEmojiPicker.hidden = !opening;
      gmEmojiToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) {
        this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);
        this.closeGMMentionPicker(gmMentionPicker);
        const attachmentMenu = document.getElementById('gm-attachment-menu');
        const attachmentToggle = document.getElementById('gm-image-upload-btn');
        if (attachmentMenu) attachmentMenu.hidden = true;
        attachmentToggle?.setAttribute('aria-expanded', 'false');
      }
      if (gmReactionPicker) gmReactionPicker.hidden = true;
    });

    gmEmojiPicker?.addEventListener('click', (e) => {
      e.stopPropagation();
      const editToggle = e.target.closest('.gm-emoji-edit-toggle');
      if (editToggle) {
        this._gmEmojiFavoritesEditing = !this._gmEmojiFavoritesEditing;
        this._gmEmojiFavoriteSlot = Math.max(0, Math.min(4, this._gmEmojiFavoriteSlot || 0));
        this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);
        return;
      }

      const option = e.target.closest('.gm-emoji-option');
      if (!option) return;

      if (this._gmEmojiFavoritesEditing) {
        const favoriteSlot = option.dataset.favoriteSlot;
        if (favoriteSlot !== undefined) {
          this._gmEmojiFavoriteSlot = Math.max(0, Math.min(4, Number(favoriteSlot) || 0));
          this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);
          return;
        }

        const emoji = option.dataset.emoji || '';
        this.replaceGMEmojiFavorite(this._gmEmojiFavoriteSlot, emoji);
        this._gmEmojiFavoriteSlot = (this._gmEmojiFavoriteSlot + 1) % 5;
        this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);
        return;
      }

      this.insertGMEmoji(option.dataset.emoji || '');
      gmEmojiPicker.hidden = true;
      gmEmojiToggle?.setAttribute('aria-expanded', 'false');
    });

    gmReactionPicker?.addEventListener('click', (e) => {
      e.stopPropagation();
      const editToggle = e.target.closest('.gm-emoji-edit-toggle');
      if (editToggle) {
        this._gmEmojiFavoritesEditing = !this._gmEmojiFavoritesEditing;
        this._gmEmojiFavoriteSlot = Math.max(0, Math.min(4, this._gmEmojiFavoriteSlot || 0));
        this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);
        return;
      }

      const option = e.target.closest('.gm-emoji-option');
      if (!option) return;

      if (this._gmEmojiFavoritesEditing) {
        const favoriteSlot = option.dataset.favoriteSlot;
        if (favoriteSlot !== undefined) {
          this._gmEmojiFavoriteSlot = Math.max(0, Math.min(4, Number(favoriteSlot) || 0));
          this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);
          return;
        }

        const emoji = option.dataset.emoji || '';
        this.replaceGMEmojiFavorite(this._gmEmojiFavoriteSlot, emoji);
        this._gmEmojiFavoriteSlot = (this._gmEmojiFavoriteSlot + 1) % 5;
        this.renderGMEmojiPickers(gmEmojiPicker, gmReactionPicker);
        return;
      }

      const messageId = gmReactionPicker.dataset.messageId || '';
      if (messageId) this.sendGMChatReaction(messageId, option.dataset.emoji || '');
      gmReactionPicker.hidden = true;
    });

    document.addEventListener('contextmenu', (e) => {
      const messageEl = e.target.closest('#gm-chat-messages .gm-chat-message, #gm-chat-messages .gm-shadow-broker-entry');
      if (!messageEl) return;
      e.preventDefault();
      e.stopPropagation();
      openGMContextMenu(messageEl, e.clientX, e.clientY);
    }, true);

    gmContextMenu?.addEventListener('click', (e) => {
      const action = e.target.closest('[data-gm-chat-action]')?.dataset.gmChatAction;
      if (!action) return;
      // Keep this click away from the page-level outside-click handlers: they
      // would read a REACT click as "outside the picker" and hide the picker
      // this very click just opened.
      e.stopPropagation();
      const messageId = gmContextMenu.dataset.messageId || '';
      // Chat re-renders replace message nodes wholesale, so the element cached
      // when the menu opened may be detached by now. Re-resolve it by id.
      const messageEl = (messageId && document.querySelector(`#gm-chat-messages [data-message-id="${CSS.escape(messageId)}"]`))
        || gmContextMenu._messageEl || gmContextMessageEl;
      if (!messageEl || !messageId) return;
      closeGMContextMenu();
      if (action === 'react') {
        // A detached anchor has a zero rect; the message is gone, nothing to react to.
        if (messageEl.isConnected) this.openGMChatReactionPicker(messageId, { x: e.clientX, y: e.clientY });
        return;
      }
      if (action === 'edit') {
        this.startGMChatEdit(messageId);
        return;
      }
      if (action === 'reply') {
        const composer = this.getGMComposerElement();
        if (!composer) return;
        const name = messageEl.dataset.playerName || (messageEl.classList.contains('gm-shadow-broker-entry') ? 'SHADOW BROKER' : 'LITTLE HERO');
        const excerpt = (messageEl.querySelector('.gm-chat-message-text, .shadow-broker-text')?.textContent || '')
          .replace(/[:\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 30);
        const prefix = `↳ @${name}${excerpt ? ` // ${excerpt}` : ''}: `;
        const current = this.getGMComposerText().replace(/^↳ @[^:]{1,80}:\s*/, '');
        const next = prefix + current;
        this.setGMComposerText(next, next.length);
        composer.focus();
      }
    });

    const gmChatContainer = document.getElementById('gm-chat-messages');
    gmChatContainer?.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = gmChatContainer;
      this.userScrolledUp = (scrollTop + clientHeight) < (scrollHeight - 40);
      if (!this.userScrolledUp && this._gmNewMessageCount) {
        this._gmNewMessageCount = 0;
        this.updateGMNewMessageChip();
      }
      closeGMContextMenu();
    });

    document.getElementById('gm-chat-new-messages')?.addEventListener('click', () => {
      this.jumpToLatestGMChat();
    });

    // FAIL K ("K" is this GM's own shorthand for the Final/"Kraj" slot) --
    // lives in the WOMF section alongside FAIL A-D now, replacing the old
    // standalone DECLARE FINAL FAILED button under Scoring. Same action.
    document.getElementById('womf-fail-final-btn')?.addEventListener('click', () => this.declareFinalFailed());
    document.getElementById('womf-subtract-btn')?.addEventListener('click', () => this.declareWomfSubtract());
    document.getElementById('womf-reset-btn')?.addEventListener('click', () => this.declareWomfReset());
    document.getElementById('blood-tribute-vault-clear')?.addEventListener('click', () => this.clearBloodTributeVault());
    document.getElementById('blood-tribute-override-btn')?.addEventListener('click', () => this.overrideBloodTribute());
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
      if (e.key === 'Escape') {
        closeGMContextMenu();
        this.closeGMMentionPicker(gmMentionPicker);
      }
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

    window.addEventListener('resize', closeGMContextMenu, { passive:true });

    document.body.addEventListener('click', (e) => {
      const liveEmojiPicker = document.getElementById('gm-emoji-picker');
      const liveReactionPicker = document.getElementById('gm-chat-reaction-picker');
      if (liveEmojiPicker && !liveEmojiPicker.hidden && !liveEmojiPicker.contains(e.target) && !e.target.closest('#gm-emoji-toggle')) {
        liveEmojiPicker.hidden = true;
        document.getElementById('gm-emoji-toggle')?.setAttribute('aria-expanded', 'false');
        this._gmEmojiFavoritesEditing = false;
        this._gmEmojiFavoriteSlot = 0;
      }
      if (liveReactionPicker && !liveReactionPicker.hidden && !liveReactionPicker.contains(e.target) && !e.target.closest('.gm-chat-reaction-add')) {
        liveReactionPicker.hidden = true;
        this._gmEmojiFavoritesEditing = false;
        this._gmEmojiFavoriteSlot = 0;
      }
      if (gmContextMenu && !gmContextMenu.hidden && !gmContextMenu.contains(e.target)) closeGMContextMenu();
      if (gmMentionPicker && !gmMentionPicker.hidden && !shadowBrokerForm?.contains(e.target)) this.closeGMMentionPicker(gmMentionPicker);

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

      const gmPollVote = e.target.closest('[data-gm-poll-vote]');
      if (gmPollVote) {
        this.send({
          type: 'chat:poll:vote',
          messageId: gmPollVote.dataset.messageId || '',
          optionIndex: Number(gmPollVote.dataset.gmPollVote)
        });
        return;
      }

      const gmPollClose = e.target.closest('[data-gm-poll-close]');
      if (gmPollClose) {
        this.send({ type: 'chat:poll:close', messageId: gmPollClose.dataset.gmPollClose || '' });
        return;
      }

      const gmReactionChip = e.target.closest('.gm-chat-reaction-chip');
      if (gmReactionChip) {
        this.sendGMChatReaction(
          gmReactionChip.dataset.messageId || '',
          gmReactionChip.dataset.emoji || ''
        );
      }

      const gmReactionAdd = e.target.closest('.gm-chat-reaction-add');
      if (gmReactionAdd) {
        this.openGMChatReactionPicker(gmReactionAdd.dataset.messageId || '', { x: e.clientX, y: e.clientY });
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
      this._victoryBaselined = false;
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

  // The host's manual entry into the SAME authoritative victory state the
  // server sets when the judge accepts the Final. In a room the server owns
  // it (state:public -> every client, this one included, plays the sequence);
  // with no room there is no server, so it is applied locally. Idempotent: a
  // completed game never replays.
  // RECOUNT: SHOW RESULTS asks the server to reveal the (already computed and
  // stored) RECOUNT to everyone; once it exists the same button just reopens it.
  triggerRecount() {
    if (Recount.has()) { Recount.open({ live: false }); return; }
    if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
      this.send({ type: 'gm:showRecount' });
    }
  },

  updateRecountButton() {
    const btn = document.getElementById('recount-btn');
    if (!btn) return;
    const has = Recount.has();
    btn.classList.toggle('has-recount', has);
    btn.textContent = has ? 'RECOUNT' : 'SHOW RESULTS';
  },

  triggerGameWon() {
    if (this._victoryLive && !document.querySelector('.victory-overlay')) {
      this._victoryLive = false;
    }
    if (this.gameWon || this._victoryLive) return;
    if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
      this.send({ type: 'gm:gameWon' });
      return;
    }
    const game = GameData.currentGame || {};
    this.setGameWon(true, { play: true, result: {
      outcome: 'WON', occurredAt: Date.now(),
      message: 'Final association confirmed. Pattern integrity has collapsed. Further resistance serves no purpose.',
      finalSolution: game.finalSolution || '',
      columnSolutions: {
        A: game.columns?.A?.solution || '', B: game.columns?.B?.solution || '',
        C: game.columns?.C?.solution || '', D: game.columns?.D?.solution || ''
      },
      columnResults: {
        A: !!this.solvedTargets?.A, B: !!this.solvedTargets?.B,
        C: !!this.solvedTargets?.C, D: !!this.solvedTargets?.D
      },
      matchWinner: { name: 'TEST SUBJECT', points: 0 }
    } });
  },

  setGameComplete(complete) {
    this.gameComplete = complete === true;
    document.body.classList.toggle('game-complete', this.gameComplete);
  },

  setGameWon(won, { play = false, result = null } = {}) {
    const wasWon = this.gameWon;
    this.gameWon = won === true;
    if (this.gameWon && !wasWon && play) this.playVictory(result || {});
    this.renderGameWonState();
  },

  applyLossState(matchResult) {
    const lost = matchResult?.outcome === 'LOST';
    const key = lost ? String(matchResult.occurredAt || matchResult.message || 'lost') : null;
    const live = this._lossBaselined && !this.gameLost && lost;
    const changed = key !== this._lossResultKey;
    this._lossBaselined = true;
    this.gameLost = lost;
    this._lossResultKey = key;
    document.body.classList.toggle('game-lost', lost);
    const button = document.getElementById('game-lost-btn');
    if (button) {
      button.classList.toggle('is-lost', lost);
      button.setAttribute('aria-pressed', lost ? 'true' : 'false');
    }
    if (lost) this._closeLossPreview?.();
    if (!lost) document.querySelector('.defeat-overlay:not(.is-test-preview)')?.remove();
    else if (live) Skeleton.playGameLost(matchResult, { live: true });
    else if (changed && !document.querySelector('.defeat-overlay')) Skeleton.playGameLost(matchResult, { live: false });
  },

  testGameLost() {
    if (this.gameLost) return;
    this._closeLossPreview?.();
    const game = GameData.currentGame || {};
    const result = {
      outcome: 'LOST', occurredAt: Date.now(),
      message: 'Final association unresolved. Time exhausted. Cognitive adaptation insufficient. Expected result.',
      finalSolution: game.finalSolution || 'UNRESOLVED',
      columnSolutions: {
        A: game.columns?.A?.solution || 'A5', B: game.columns?.B?.solution || 'B5',
        C: game.columns?.C?.solution || 'C5', D: game.columns?.D?.solution || 'D5'
      },
      columnResults: {
        A: !!this.solvedTargets?.A, B: !!this.solvedTargets?.B,
        C: !!this.solvedTargets?.C, D: !!this.solvedTargets?.D
      },
      topPerformer: { name: 'TEST SUBJECT', points: 0 },
      awards: [{ type: 'COLLECTIVE FAILURE', group: true, comment: 'Responsibility successfully distributed.' }]
    };
    const overlay = Skeleton.playGameLost(result, { live: true });
    overlay.classList.add('is-test-preview');
    overlay.title = 'Local preview — click anywhere or press Escape to close';
    let onKey;
    const close = () => {
      overlay.remove();
      if (onKey) document.removeEventListener('keydown', onKey);
      if (this._closeLossPreview === close) this._closeLossPreview = null;
    };
    this._closeLossPreview = close;
    overlay.addEventListener('click', close, { once: true });
    onKey = event => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
  },

  // Completed state: derived purely from this.gameWon, so it is identical
  // after a refresh, a reconnect, or the live sequence finishing.
  renderGameWonState() {
    document.body.classList.toggle('game-won', this.gameWon);
    const btn = document.getElementById('game-won-btn');
    if (!btn || this._victoryLive) return;
    btn.classList.remove('is-cycling');
    btn.classList.toggle('is-won', this.gameWon);
    btn.textContent = 'GAME WON';
    btn.setAttribute('aria-pressed', this.gameWon ? 'true' : 'false');
  },

  playVictory(result) {
    this._victoryLive = true;
    const btn = document.getElementById('game-won-btn');
    try {
      Skeleton.playGameWon(result, {
        onStage: (stage) => {
          if (stage === 'done') {
            this._victoryLive = false;
            this.renderGameWonState();
            return;
          }
          if (!btn) return;
          if (stage === 'verifying') {
            btn.classList.add('is-cycling');
            btn.textContent = 'VERIFYING...';
          } else if (stage === 'accepted') {
            btn.textContent = 'SOLUTION ACCEPTED';
          } else if (stage === 'won') {
            btn.classList.remove('is-cycling');
            btn.classList.add('is-won', 'is-won-pop');
            btn.textContent = 'GAME WON';
            setTimeout(() => btn.classList.remove('is-won-pop'), 650);
          }
        }
      });
    } catch (error) {
      this._victoryLive = false;
      btn?.classList.remove('is-cycling');
      this.renderGameWonState();
      console.error('[GM] GAME WON animation failed:', error);
    }
  },

  sendCommand(command, payload) {
    // Game over (all five fields resolved): board-driving commands are locked
    // (see body.game-complete CSS). RESET BOARD / NEXT GAME are not in this
    // set and clear the state.
    if (this.gameComplete && this._gameWonLockedCommands.has(command)) return;

    if (this.mode === 'local') {
      this.executeLocalCommand(command, payload);
      return;
    }

    if (!this.roomCode) return;

    const cmdId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.pendingCommands.set(cmdId, { command, payload, timestamp: Date.now() });

    this.send({
      type: 'gm:command',
      command,
      payload,
      cmdId
    });

    this.executeLocalCommand(command, payload);
  },

  resendPendingCommands() {
    if (this.mode !== 'multiplayer' || !this.roomCode) return;
    for (const [cmdId, pending] of this.pendingCommands) {
      this.send({
        type: 'gm:command',
        command: pending.command,
        payload: pending.payload,
        cmdId
      });
    }
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
        this.setGameWon(false);
        this.setGameComplete(false);
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
          this.send({ type: 'host:reconnect', roomCode: this.roomCode, hostToken: this.hostToken, gmToken: GameData.gmToken });
        } else if (GameData.gmToken) {
          // A full tab/browser close destroys sessionStorage. The authenticated
          // GM may therefore return without the old browser host token. Ask the
          // server to reclaim an already-armed MASTER without resetting it.
          this._recoverPending = true;
          this.send({ type: 'host:recover', gmToken: GameData.gmToken });
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
        this.applyRoomMode('BATTLE_ARMED');
        this.updateMultiplayerUI();
        sessionStorage.setItem('asoc_host_token', this.hostToken);
        break;

      case 'host:reconnected':
        this._reconnectPending = false;
        this.roomCode = message.roomCode;
        this.mode = 'multiplayer';
        sessionStorage.setItem('asoc_host_token', this.hostToken);
        this.updateMultiplayerUI();
        this.resendPendingCommands();
        break;

      case 'host:recovered':
        this._recoverPending = false;
        this.roomCode = message.roomCode;
        this.hostToken = message.hostToken;
        this.mode = 'multiplayer';
        sessionStorage.setItem('asoc_host_token', this.hostToken);
        this.updateMultiplayerUI();
        this.resendPendingCommands();
        break;

      case 'host:recovery-none':
        this._recoverPending = false;
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
          this.setGameWon(false);
          this.setGameComplete(false);
          Recount.apply(null);
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
        {
          const online = (message.players || []).filter(p => p.connected !== false).length;
          const presence = document.getElementById('gm-chat-presence');
          if (presence) presence.textContent = `● ${online} ONLINE`;
        }
        break;

      case 'moderation:ack':
        console.log('[GM] Moderation action:', message.action, message.playerName || message.playerId);
        break;

      case 'battle:launchCountdown':
        // The GM already started the same local sequence from the button
        // click that caused this broadcast. Players consume this event.
        break;

      case 'battle:controlsOnline':
        this.showBattleControlsOnline();
        break;

      case 'score:event':
        this.showScoreToast(message);
        if (message.awardType === 'final') window.AsocAudio?.finalSolved?.();
        else window.AsocAudio?.columnSolved?.();
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

      case 'recount:update':
        // Server-authoritative: live only at the moment the host pressed SHOW
        // RESULTS; hydration (live:false) never replays; null closes it.
        Recount.apply(message.recount, { live: message.live === true });
        break;

      case 'leaderboard:allTime':
        this.renderAllTimeLeaderboard(message.players || []);
        break;

      case 'tribute:vault':
        this.bloodTributes = Array.isArray(message.tributes) ? message.tributes : [];
        this.renderBloodTributeVault();
        break;

      case 'tribute:unavailable':
        alert(`BLOOD TRIBUTE UNAVAILABLE // ${message.playerName || 'UNKNOWN'} is not linked to a player identity.`);
        break;

      case 'chat:update': {
        const incoming = message.messages || [];
        const previousIds = new Set(this.chatMessages.map(m => m.id));
        const previousById = new Map(this.chatMessages.map(m => [m.id, m]));
        // Same first-hydration guard as PlayerApp's copy in js/player.js --
        // without it, a GM reconnecting mid-game would see the room's
        // entire chat history replay as a fresh Broker transmission on
        // their own Public View the instant the reconnect completes.
        if (this._chatEverInitialized) {
          const newMessages = incoming.filter(m => !previousIds.has(m.id));
          const verdictUpdates = incoming.filter(m => {
            const previous = previousById.get(m.id);
            return previous && previous.verdict !== m.verdict && m.verdict;
          });
          if (verdictUpdates.some(m => m.verdict === 'correct')) {
            window.AsocAudio?.correct?.();
          }
          const newActivityCount = newMessages.length + verdictUpdates.length;
          if (this.userScrolledUp && newActivityCount) {
            this._gmNewMessageCount += newActivityCount;
            this.updateGMNewMessageChip();
          }

          const newBrokerMsg = newMessages.find(m => m.source === 'shadowBroker');
          if (newBrokerMsg) {
            this.playShadowBrokerBoardLine(newBrokerMsg.text);
            // The GM's own working board (js/board.js) previously never
            // showed this at all -- the GM had to trust the chat log or
            // switch to Public View to see it. Play it there too so
            // hosting shows exactly what players are about to see.
            Board.playShadowBrokerBoardLine(newBrokerMsg.text);
          }
        }

        const verdictNow = Date.now();
        incoming.forEach(msg => {
          const previous = previousById.get(msg.id);
          if (msg.verdict === 'wrong') {
            if (previous?.verdict !== 'wrong') {
              this._gmWrongVerdictSeenAt.set(
                msg.id,
                this._chatEverInitialized ? verdictNow : verdictNow - 3000
              );
            } else if (!this._gmWrongVerdictSeenAt.has(msg.id)) {
              this._gmWrongVerdictSeenAt.set(msg.id, verdictNow - 3000);
            }
          } else {
            this._gmWrongVerdictSeenAt.delete(msg.id);
          }
        });

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

      case 'chat:mentionAll':
        Skeleton.playMentionAllShake?.();
        break;

      case 'command:ack':
        this.pendingCommands.delete(message.cmdId);
        break;

      case 'gm:judge:ack':
        console.log('[GM] Verdict acknowledged:', message);
        break;

      case 'auth:required':
        sessionStorage.removeItem('asoc_gm_token');
        GameData.setGMToken('');
        location.replace('/join.html');
        break;

      case 'error':
        console.error('[GM] Server error:', message.message);
        if (message.cmdId !== undefined) this.pendingCommands.delete(message.cmdId);
        // Clear unconditionally: whatever failed, we're not waiting on a
        // room:create response anymore, so don't leave HOST ROOM
        // permanently blocked by a stuck flag.
        this._hostingInFlight = false;
        this.updateMultiplayerUI();
        if (this._recoverPending) this._recoverPending = false;
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

      case 'room:casual':
      case 'room:disarmed':
        this.roomCode = message.roomCode || this.roomCode || 'MASTER';
        this.mode = 'multiplayer';
        this.applyRoomMode('CASUAL');
        this.updateMultiplayerUI();
        break;

      case 'room:closed':
        this.handleRoomClosed(message.message);
        break;

      default:
        console.log('[GM] Unknown message type:', message.type);
    }
  },

  applyServerState(state) {
    this.applyRoomMode(state.roomMode || (state.armed === true ? 'BATTLE_ARMED' : 'CASUAL'));
    window.AsocAudio?.syncBoard?.('gm', state);
    // Victory is authoritative server state. Play the live sequence only on
    // a false->true flip AFTER this connection's baseline state; the baseline
    // itself (first state after load/reconnect) just renders the completed
    // state. Late joiners and refreshes therefore never replay it.
    const victoryNow = state.gameWon === true;
    const victoryLive = this._victoryBaselined && !this.gameWon && victoryNow;
    this._victoryBaselined = true;
    this.setGameWon(victoryNow, { play: victoryLive, result: state.matchResult || null });
    this.applyLossState(state.matchResult || null);
    this.setGameComplete(state.gameComplete === true);

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

    this.bloodTribute = state.bloodTribute || { status: 'idle' };
    this.renderBloodTributeVault();

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
    const status = document.getElementById('mp-status');
    if (status) status.textContent = `${this.roomMode} // rev ${revision}`;
  },

  applyRoomMode(mode) {
    const allowed = new Set(['CASUAL', 'BATTLE_ARMED', 'BATTLE', 'RECOUNT']);
    const next = allowed.has(mode) ? mode : 'CASUAL';
    const previous = this.roomMode;
    this.roomMode = next;

    document.body.classList.toggle('room-mode-casual', next === 'CASUAL');
    document.body.classList.toggle('room-mode-battle-armed', next === 'BATTLE_ARMED');
    document.body.classList.toggle('room-mode-battle', next === 'BATTLE');
    document.body.classList.toggle('room-mode-recount', next === 'RECOUNT');
    document.body.dataset.roomMode = next;

    const brokerBar = document.getElementById('gm-broker-bar');
    const chatPanel = document.querySelector('.gm-module-chat .gm-chat-panel');
    const main = document.getElementById('main-content');
    const battleControls = document.getElementById('battle-controls-panel');
    if (brokerBar) {
      if (next === 'CASUAL' && chatPanel && brokerBar.parentElement !== chatPanel) {
        chatPanel.appendChild(brokerBar);
      } else if (next !== 'CASUAL' && main && brokerBar.parentElement !== main) {
        main.insertBefore(brokerBar, battleControls || null);
      }
    }

    const title = document.querySelector('.gm-chat-title');
    if (title) {
      title.innerHTML = next === 'CASUAL'
        ? '<span class="casual-network-name">ASOC NETWORK</span><span class="casual-network-state"> // CASUAL</span>'
        : 'BATTLE CHAT';
    }
    if (next === 'CASUAL') {
      Recount.apply(null);
      window.AsocAudio?.resetObservers?.();
    }

    // Casual and Battle are the SAME transcript. Re-render the current
    // in-memory chat immediately when only the surrounding mode changes.
    if (Array.isArray(this.chatMessages)) this.renderGMChat();

    this.updateSolvedCount();
    if (previous !== next) this.updateMultiplayerUI();
  },

  updateMultiplayerUI() {
    const isMultiplayer = this.mode === 'multiplayer';
    const inCasual = this.roomMode === 'CASUAL';
    const battleSession = isMultiplayer && !inCasual;

    document.getElementById('mp-mode').textContent = isMultiplayer ? 'MASTER ROOM' : 'LOCAL';
    document.getElementById('mp-room-row').style.display = isMultiplayer ? 'flex' : 'none';
    document.getElementById('mp-status-row').style.display = isMultiplayer ? 'flex' : 'none';
    document.getElementById('mp-players-row').style.display = isMultiplayer ? 'flex' : 'none';
    const roomToggle = document.getElementById('room-mode-toggle');
    const casualModeBtn = document.getElementById('room-mode-casual-btn');
    const battleModeBtn = document.getElementById('room-mode-battle-btn');
    if (roomToggle) roomToggle.classList.toggle('is-battle', !inCasual);
    if (casualModeBtn) {
      casualModeBtn.disabled = !isMultiplayer;
      casualModeBtn.classList.toggle('is-active', inCasual);
      casualModeBtn.setAttribute('aria-pressed', String(inCasual));
    }
    if (battleModeBtn) {
      battleModeBtn.disabled = !isMultiplayer;
      battleModeBtn.classList.toggle('is-active', !inCasual);
      battleModeBtn.setAttribute('aria-pressed', String(!inCasual));
    }
    const lostButton = document.getElementById('game-lost-btn');
    if (lostButton) {
      lostButton.disabled = false;
      lostButton.classList.add('is-testable');
      lostButton.textContent = 'TEST GAME LOST';
      lostButton.title = 'Preview the GAME LOST sequence locally without changing authoritative match state';
    }
    document.getElementById('next-game-btn').style.display = battleSession ? 'block' : 'none';
    document.getElementById('scoring-section').style.display = battleSession ? 'block' : 'none';
    const tributeVaultSection = document.getElementById('blood-tribute-vault-section');
    if (tributeVaultSection) tributeVaultSection.style.display = battleSession ? 'block' : 'none';
    const recordsSection = document.getElementById('records-section');
    if (recordsSection) recordsSection.style.display = battleSession ? 'block' : 'none';
    ControlSurfaces.updateSessionSummary();
    this.updateFailFinalButtonVisibility();
    this.updateWomfControlsVisibility();

    if (isMultiplayer) {
      document.getElementById('mp-room-code').textContent = 'MASTER ROOM';
      document.getElementById('mp-status').textContent = this.roomMode;
    }
  },

  updatePlayerList(players) {
    // Keep the full authoritative roster cached for mentions, scoring and
    // reconnect continuity, while the compact moderation panel shows only
    // sockets that are actually online right now.
    this.currentPlayers = players;
    const gmMentionPicker = document.getElementById('gm-mention-picker');
    if (gmMentionPicker && !gmMentionPicker.hidden) this.updateGMMentionPicker(document.getElementById('shadow-broker-input'), gmMentionPicker);

    const onlinePlayers = players.filter(player => player.connected === true);
    const countEl = document.getElementById('mp-players-count');
    const listEl = document.getElementById('mp-player-list');

    countEl.textContent = onlinePlayers.length;
    const battleCount = document.getElementById('battle-session-player-count');
    if (battleCount) battleCount.textContent = String(onlinePlayers.length);
    listEl.style.display = onlinePlayers.length > 0 ? 'flex' : 'none';

    listEl.innerHTML = onlinePlayers.map(p => `
      <div class="mp-player mp-player-online">
        <span class="mp-player-name mp-little-hero">${this.littleHeroAvatarHTML(p, true)}<span>${this.escapeHtml(p.name)}</span></span>
        <span class="mp-player-actions">
          <span class="mp-status-dot connected" title="Online"></span>
          <button type="button" class="mp-moderation-btn mp-kick-btn" data-action="kick" data-player-id="${encodeURIComponent(String(p.id))}" data-player-name="${encodeURIComponent(String(p.name))}">KICK</button>
          <button type="button" class="mp-moderation-btn mp-ban-btn" data-action="ban" data-player-id="${encodeURIComponent(String(p.id))}" data-player-name="${encodeURIComponent(String(p.name))}">BAN</button>
        </span>
      </div>
    `).join('');

    listEl.querySelectorAll('.mp-moderation-btn').forEach(button => {
      button.addEventListener('click', () => {
        const playerId = decodeURIComponent(button.dataset.playerId || '');
        const playerName = decodeURIComponent(button.dataset.playerName || '');
        if (button.dataset.action === 'ban') this.banPlayer(playerId, playerName);
        else this.kickPlayer(playerId, playerName);
      });
    });

    this.renderSessionLeaderboard(players);
    if (this.chatMessages?.length) this.renderGMChat();
    document.getElementById('scoring-section').style.display = this.mode === 'multiplayer' ? 'block' : 'none';
  },

  requestModerationReason(action, playerName) {
    const label = String(action || '').toUpperCase();
    const target = playerName || 'this Little Hero';
    const reason = prompt(`${label} ${target} // Enter reason (required, max 180 characters):`, '');
    if (reason === null) return null;

    const cleanReason = reason.trim();
    if (!cleanReason) {
      alert('MODERATION ABORTED // A reason is required.');
      return null;
    }
    if (cleanReason.length > 180) {
      alert('MODERATION ABORTED // Reason must be 180 characters or fewer.');
      return null;
    }
    return cleanReason;
  },

  kickPlayer(playerId, playerName) {
    if (this.mode !== 'multiplayer' || !playerId) return;
    const reason = this.requestModerationReason('kick', playerName);
    if (!reason) return;
    if (!confirm(`Kick ${playerName || 'this Little Hero'} from the Master Room? They can manually rejoin afterwards.\n\nReason: ${reason}`)) return;
    this.send({ type: 'gm:kickPlayer', playerId, reason });
  },

  banPlayer(playerId, playerName) {
    if (this.mode !== 'multiplayer' || !playerId) return;
    const reason = this.requestModerationReason('ban', playerName);
    if (!reason) return;
    if (!confirm(`BAN ${playerName || 'this Little Hero'} from the Master Room? This blocks the authenticated account from rejoining.\n\nReason: ${reason}`)) return;
    this.send({ type: 'gm:banPlayer', playerId, reason });
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

  renderBloodTributeVault() {
    const list = document.getElementById('blood-tribute-vault-list');
    const status = document.getElementById('blood-tribute-vault-status');
    const clearBtn = document.getElementById('blood-tribute-vault-clear');
    const overrideBtn = document.getElementById('blood-tribute-override-btn');
    if (!list || !status) return;

    const tributes = Array.isArray(this.bloodTributes) ? this.bloodTributes : [];
    if (this.bloodTribute?.status === 'required') {
      status.textContent = `DEBT OUTSTANDING // ${this.bloodTribute.playerName || 'UNKNOWN'}`;
      status.classList.add('debt-outstanding');
      if (overrideBtn) overrideBtn.style.display = 'block';
    } else {
      status.textContent = tributes.length
        ? `${tributes.length} TRIBUTE${tributes.length === 1 ? '' : 'S'} ARCHIVED // GM PRIVATE`
        : 'NO TRIBUTES ARCHIVED';
      status.classList.remove('debt-outstanding');
      if (overrideBtn) overrideBtn.style.display = 'none';
    }

    const now = Date.now();
    list.innerHTML = tributes.map(t => {
      const publicNow = Number(t.publicUntil) > now;
      const stamp = new Date(Number(t.submittedAt) || now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <article class="blood-tribute-vault-item">
          <img src="${t.imageData}" alt="Archived tribute image">
          <div class="blood-tribute-vault-meta">
            <strong>${this.escapeHtml(t.playerName || 'LITTLE HERO')}</strong>
            <span>${stamp} // ${publicNow ? 'PUBLIC WINDOW ACTIVE' : 'ARCHIVED'}</span>
          </div>
        </article>
      `;
    }).join('');

    if (clearBtn) clearBtn.disabled = tributes.length === 0;
  },

  clearBloodTributeVault() {
    if (this.mode !== 'multiplayer' || !this.bloodTributes.length) return;
    if (!confirm('Purge every archived Blood Tribute from the private vault? This cannot be undone.')) return;
    this.send({ type: 'gm:tributeVaultClear' });
  },

  overrideBloodTribute() {
    if (this.mode !== 'multiplayer') return;
    if (this.bloodTribute?.status !== 'required') return;
    const debtor = this.bloodTribute.playerName || 'UNKNOWN';
    if (!confirm(`Override the Blood Tribute owed by ${debtor}? The debt is released without payment; nothing is archived in the vault.`)) return;
    this.send({ type: 'gm:tributeForgive' });
  },

  // ---------------------------------------------------------------------
  // TIMER + BORROWED TIME -- GM controls just send the command; all display
  // logic (numeric, bars, phase labels, color states) lives in js/timer.js,
  // driven entirely by the server-authoritative state:public broadcast.
  // ---------------------------------------------------------------------

  announceTimerLaunch() {
    if (this.mode !== 'multiplayer' || this.roomMode !== 'BATTLE_ARMED') return;
    this.send({ type: 'gm:timerLaunchCountdown' });
  },

  startTimer() {
    if (this.mode !== 'multiplayer' || this.roomMode !== 'BATTLE_ARMED') return;
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
      onLaunch: () => this.announceTimerLaunch(),
      onPause: () => this.pauseTimer(),
      onResume: () => this.resumeTimer(),
      onAdjust: (deltaMs) => this.adjustTimer(deltaMs)
    });
    Timer.update('timer-tracker-public', state, false);
  },

  updateFailFinalButtonVisibility() {
    const btn = document.getElementById('declare-final-failed-btn');
    if (!btn) return;
    btn.style.display = (this.mode === 'multiplayer' && this.roomMode === 'BATTLE' && !this.finalRevealed) ? 'block' : 'none';
  },

  showBattleControlsOnline() {
    window.AsocAudio?.gameStart?.();
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
      : `COLUMN ${award.target} — ${award.cluesRevealed} CLUE${award.cluesRevealed === 1 ? '' : 'S'} REVEALED${award.afterFinal ? ' · 50% — FINAL ALREADY SOLVED' : ''}`;
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

  setRoomMode(target) {
    if (this.mode !== 'multiplayer') return;
    if (target !== 'CASUAL' && target !== 'BATTLE') return;
    const currentlyCasual = this.roomMode === 'CASUAL';
    if ((target === 'CASUAL' && currentlyCasual) || (target === 'BATTLE' && !currentlyCasual)) return;
    this.send({ type: 'gm:setRoomMode', mode: target });
  },

  hostRoom() {
    // Legacy arming path retained for recovery/backward compatibility only.
    if ((this.mode === 'multiplayer' && this.roomMode !== 'CASUAL') || this._hostingInFlight) return;

    this._hostingInFlight = true;
    const roomToggle = document.getElementById('host-room-btn');
    if (roomToggle) {
      roomToggle.disabled = true;
      roomToggle.textContent = 'ARMING...';
    }
    const gameId = GameData.currentGame?.id || 'sample-game';
    this.send({ type: 'room:create', gameId, gmToken: GameData.gmToken });
  },

  switchRoomGame(gameId) {
    if (this.mode !== 'multiplayer' || !this.roomCode) return false;
    this.send({ type: 'gm:switchGame', gameId });
    return true;
  },

  closeRoom() {
    if (this.mode !== 'multiplayer' || this.roomMode === 'CASUAL') return;
    const prompt = this.roomMode === 'RECOUNT'
      ? 'RETURN EVERYONE TO CASUAL MODE?\n\nBattle state resets. Chat, identities, profiles, themes and message history stay online.'
      : 'KILL ACTIVE BATTLE?\n\nBattle state resets and everyone returns to Casual Mode. Chat and identities remain online.';
    if (!window.confirm(prompt)) return;

    const roomToggle = document.getElementById('host-room-btn');
    if (roomToggle) {
      roomToggle.disabled = true;
      roomToggle.textContent = 'RETURNING...';
    }

    this.send({ type: 'room:close' });
  },

  async logoutShadowBroker() {
    const hostingRoom = this.mode === 'multiplayer' && !!this.roomCode;
    const activeBattle = hostingRoom && this.roomMode !== 'CASUAL';
    const warning = activeBattle
      ? 'SEVER SHADOW BROKER SESSION?\n\nThe active battle will return to Casual Mode before your command link is closed.'
      : 'SEVER SHADOW BROKER SESSION?\n\nThe Master Room remains online for Little Heroes; your command authentication will be cleared.';
    if (!window.confirm(warning)) return;

    const button = document.getElementById('gm-logout-btn');
    if (button) {
      button.disabled = true;
      button.textContent = 'SEVERING COMMAND LINK...';
    }

    const gmToken = GameData.gmToken || sessionStorage.getItem('asoc_gm_token') || '';
    try {
      if (activeBattle) this.send({ type: 'room:close' });
      if (hostingRoom) this.cleanupRoom();
      if (gmToken) {
        await fetch('/api/auth/gm/logout', {
          method: 'POST',
          headers: { 'x-gm-token': gmToken }
        });
      }
    } catch (_) {
      // Local session cleanup still proceeds if the server link is unavailable.
    } finally {
      sessionStorage.removeItem('asoc_gm_token');
      sessionStorage.removeItem('asoc_host_token');
      GameData.setGMToken('');
      location.replace('/join.html');
    }
  },

  cleanupRoom() {
    window.AsocAudio?.resetObservers?.();
    this.roomCode = '';
    this.hostToken = '';
    this.mode = 'local';
    this.roomMode = 'CASUAL';
    document.body.classList.remove('room-mode-casual', 'room-mode-battle-armed', 'room-mode-battle', 'room-mode-recount');
    delete document.body.dataset.roomMode;
    const brokerBar = document.getElementById('gm-broker-bar');
    const main = document.getElementById('main-content');
    const battleControls = document.getElementById('battle-controls-panel');
    if (brokerBar && main && brokerBar.parentElement !== main) main.insertBefore(brokerBar, battleControls || null);
    this.pendingCommands.clear();
    sessionStorage.removeItem('asoc_host_token');
    // No room -> no authoritative victory state either.
    this._victoryBaselined = false;
    this.setGameWon(false);
    this.setGameComplete(false);
    Recount.apply(null);
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
    this.bloodTribute = { status: 'idle' };
    this.bloodTributes = [];
    this.renderBloodTributeVault();
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
    if (this.gameComplete) return; // game over: board controls are locked
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
        <span class="shadow-broker-board-line-text" style="opacity:${state.opacity.toFixed(3)}${interruptStyle}">${window.CommanderEmojis?.renderText?.(state.visibleText, 'commander-board-emoji') || this.escapeHtml(state.visibleText)}</span>
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

  createGMPollCardHTML(msg) {
    const poll = msg?.poll || {};
    const options = Array.isArray(poll.options) ? poll.options : [];
    const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
    const voters = poll.voters && typeof poll.voters === 'object' ? poll.voters : {};
    const voterIds = new Set();
    Object.values(votes).forEach(ids => {
      if (Array.isArray(ids)) ids.forEach(id => voterIds.add(String(id)));
    });
    const totalVoters = voterIds.size;
    const closed = Number(poll.closedAt) > 0;

    const optionHtml = options.map((option, index) => {
      const ids = Array.isArray(votes[String(index)]) ? votes[String(index)].map(String) : [];
      const selected = ids.includes('__GM__');
      const percent = totalVoters ? Math.round((ids.length / totalVoters) * 100) : 0;
      const voterNames = ids.map(id => {
        if (id === '__GM__') return 'SHADOW BROKER';
        return String(voters[id]?.name || (this.currentPlayers || []).find(player => String(player.id) === id)?.name || 'LITTLE HERO');
      });
      const voterTitle = voterNames.length ? 'VOTERS // ' + voterNames.join(', ') : 'NO VOTES';
      return `
        <button type="button" class="gm-poll-choice${selected ? ' selected' : ''}" data-gm-poll-vote="${index}" data-message-id="${this.escapeHtml(msg.id)}" ${closed ? 'disabled' : ''}>
          <span class="gm-poll-choice-fill" style="width:${percent}%"></span>
          <span class="gm-poll-choice-label">${this.escapeHtml(option)}</span>
          <span class="gm-poll-choice-result" title="${this.escapeHtml(voterTitle)}"><b>${percent}%</b><small>${ids.length}</small></span>
        </button>
      `;
    }).join('');

    return `
      <div class="gm-poll-card${closed ? ' is-closed' : ''}">
        <div class="gm-poll-card-head">
          <span>POLL${poll.allowMultiple ? ' // MULTIPLE' : ''}</span>
          <b>${closed ? 'CLOSED' : 'LIVE'}</b>
        </div>
        <div class="gm-poll-question">${this.escapeHtml(poll.question || msg.text || '')}</div>
        <div class="gm-poll-choice-list">${optionHtml}</div>
        <div class="gm-poll-card-foot">
          <span>${totalVoters} VOTER${totalVoters === 1 ? '' : 'S'}</span>
          ${closed ? '' : `<button type="button" class="gm-poll-close" data-gm-poll-close="${this.escapeHtml(msg.id)}">CLOSE POLL</button>`}
        </div>
      </div>
    `;
  },

  renderGMChat() {
    const container = document.getElementById('gm-chat-messages');
    if (!container) return;

    const wasAtBottom = !this.userScrolledUp;
    const previousScrollTop = container.scrollTop;
    const previousScrollHeight = container.scrollHeight;
    const now = Date.now();
    let nextWrongFadeMs = Infinity;
    let nextTributeTickMs = Infinity;
    let html = '';

    this.chatMessages.forEach((msg, index) => {
      const previous = index > 0 ? this.chatMessages[index - 1] : null;
      if (previous && (Number(msg.timestamp) - Number(previous.timestamp)) > 300000) {
        html += this.createGMChatTimeSeparator(msg.timestamp);
      }
      if (msg.verdict === 'wrong') {
        const wrongSeenAt = this._gmWrongVerdictSeenAt.get(msg.id) ?? (now - 3000);
        const remaining = 3000 - (now - wrongSeenAt);
        if (remaining > 0) nextWrongFadeMs = Math.min(nextWrongFadeMs, remaining);
      }
      if (msg.source === 'bloodTribute') {
        const tributeRemaining = Number(msg.publicUntil) - now;
        if (tributeRemaining > 0) nextTributeTickMs = Math.min(nextTributeTickMs, tributeRemaining, 1000);
      }
      html += this.createGMChatMessageHTML(
        msg,
        this.shouldGroupGMChatMessage(previous, msg),
        now
      );
    });

    container.innerHTML = html;
    this.decorateGMChatMentions(container);

    clearTimeout(this._gmWrongFadeTimer);
    if (Number.isFinite(nextWrongFadeMs)) {
      this._gmWrongFadeTimer = setTimeout(() => this.renderGMChat(), Math.max(30, nextWrongFadeMs + 30));
    }
    clearTimeout(this._gmTributeExpiryTimer);
    if (Number.isFinite(nextTributeTickMs)) {
      this._gmTributeExpiryTimer = setTimeout(() => {
        this.renderGMChat();
        this.renderBloodTributeVault();
      }, Math.max(30, nextTributeTickMs + 30));
    }

    if (wasAtBottom) {
      container.scrollTop = container.scrollHeight;
      this._gmNewMessageCount = 0;
      this.updateGMNewMessageChip();
    } else {
      const heightDelta = container.scrollHeight - previousScrollHeight;
      container.scrollTop = Math.max(0, previousScrollTop + heightDelta);
    }

    this.updateSolvedCount();
  },

  createGMChatTimeSeparator(timestamp) {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="gm-chat-time-separator"><span>${time}</span></div>`;
  },

  shouldGroupGMChatMessage(previous, current) {
    // GM adjudicates individual lines, so every line must carry its own
    // visible speaker identity instead of inheriting context from above.
    return false;
  },

  createGMReactionSummaryHTML(msg) {
    const reactions = msg?.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
    const chips = Object.entries(reactions)
      .filter(([emoji, playerIds]) => this.isGMReactionEmoji(emoji) && Array.isArray(playerIds) && playerIds.length)
      .map(([emoji, playerIds]) => {
        const mine = playerIds.map(String).includes('__GM__');
        const emojiHtml = this.renderGMReactionEmojiHTML(emoji, 'commander-reaction-emoji');
        return `<button type="button" class="gm-chat-reaction-chip${mine ? ' mine' : ''}${window.CommanderEmojis?.has?.(emoji) ? ' commander-reaction-chip' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-emoji="${this.escapeHtml(emoji)}" aria-pressed="${mine ? 'true' : 'false'}"><span>${emojiHtml}</span><b>${playerIds.length}</b></button>`;
      })
      .join('');

    const addButton = this.mode === 'multiplayer'
      ? `<button type="button" class="gm-chat-reaction-add" data-message-id="${this.escapeHtml(msg.id)}" title="React as GameMaster" aria-label="React to message">＋</button>`
      : '';
    return `<div class="gm-chat-reactions${chips ? ' has-reactions' : ''}">${chips}${addButton}</div>`;
  },

  createGMChatMessageHTML(msg, grouped = false, now = Date.now()) {
    if (msg.source === 'bloodTribute') {
      const remainingMs = Number(msg.publicUntil) - now;
      if (!msg.imageData || remainingMs <= 0) return '';
      const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const seconds = String(totalSeconds % 60).padStart(2, '0');
      return `
        <div class="gm-chat-blood-tribute-entry" data-message-id="${this.escapeHtml(msg.id)}">
          <div class="blood-tribute-chat-head"><span>BLOOD TRIBUTE // ${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span><b>PUBLIC PURGE ${minutes}:${seconds}</b></div>
          <img class="blood-tribute-public-image" src="${msg.imageData}" alt="Temporary tribute image">
        </div>
      `;
    }

    if (msg.messageType === 'poll' && msg.poll) {
      const isBrokerPoll = msg.poll.createdByRole === 'gm';
      const identity = (this.currentPlayers || []).find(p => p.id === msg.playerId) || msg;
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const avatar = isBrokerPoll
        ? '<span class="gm-poll-broker-avatar" aria-hidden="true">SB</span>'
        : this.littleHeroAvatarHTML(identity, true);
      const themeId = isBrokerPoll ? 'gunmetal' : ASOCThemes.get(identity.themeId).id;
      const themeStyle = isBrokerPoll ? '' : ASOCThemes.messageStyle(identity.themeId);
      const frameColor = isBrokerPoll
        ? '#9B5DE0'
        : (/^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885');
      return `
        <div class="gm-chat-message gm-flow-message gm-poll-message" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="${this.escapeHtml(msg.playerName || 'LITTLE HERO')}" data-editable="false" data-theme-id="${themeId}" style="${themeStyle}--little-hero-accent:${frameColor}" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
          <div class="gm-chat-avatar-rail">${avatar}</div>
          <div class="gm-chat-bubble-cluster">
            <div class="gm-chat-message-main">
              <div class="gm-chat-flow-header"><span class="gm-chat-player-name">${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span><span class="gm-chat-time">${time}</span></div>
              ${this.createGMPollCardHTML(msg)}
              ${this.createGMReactionSummaryHTML(msg)}
            </div>
            <div class="gm-chat-quick-actions adjudicated" aria-hidden="true"></div>
          </div>
        </div>
      `;
    }

    if (msg.source === 'shadowBroker') {
      const isNew = !this._seenShadowBrokerKeys.has(msg.id);
      if (isNew) this._seenShadowBrokerKeys.add(msg.id);
      const replyMatch = typeof msg.text === 'string'
        ? msg.text.match(/^↳ @([^:]{1,40}?)(?: \/\/ ([^:]{1,30}))?:\s*([\s\S]*)$/)
        : null;
      const messageText = replyMatch ? replyMatch[3] : msg.text;
      const replyContextHtml = replyMatch
        ? `<div class="gm-chat-reply-context">↳ ${this.escapeHtml(replyMatch[1])}${replyMatch[2] ? ` // ${this.escapeHtml(replyMatch[2])}` : ''}</div>`
        : '';
      return `
        <div class="gm-shadow-broker-entry" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="SHADOW BROKER" data-editable="${msg.editableByHost === true ? 'true' : 'false'}" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
          ${replyContextHtml}
          ${Skeleton.shadowBrokerTransmissionHTML(messageText || (msg.imageUrl ? 'IMAGE TRANSMISSION' : ''), { glitchIn: isNew })}\n          ${msg.imageUrl ? `<a class="chat-image-link" href="${this.escapeHtml(msg.imageUrl)}" target="_blank" rel="noopener"><img class="chat-image-attachment" src="${this.escapeHtml(msg.imageUrl)}" alt="Chat image"></a>` : ''}
          ${msg.editedAt ? '<span class="gm-chat-edited-marker">EDITED</span>' : ''}
          ${this.createGMReactionSummaryHTML(msg)}
        </div>
      `;
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const wrongSeenAt = this._gmWrongVerdictSeenAt.get(msg.id) ?? (now - 3000);
    const agedRejected = msg.verdict === 'wrong' && (now - wrongSeenAt) >= 3000;
    const identity = (this.currentPlayers || []).find(p => p.id === msg.playerId) || msg;
    const hasVerdict = msg.verdict !== null;
    const showControls = !hasVerdict && msg.adjudicable === true;
    const themeStyle = ASOCThemes.messageStyle(identity.themeId);
    const frameColor = /^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885';

    const replyMatch = typeof msg.text === 'string'
      ? msg.text.match(/^↳ @([^:]{1,40}?)(?: \/\/ ([^:]{1,30}))?:\s*([\s\S]*)$/)
      : null;
    const messageText = replyMatch ? replyMatch[3] : msg.text;
    const replyContextHtml = replyMatch
      ? `<div class="gm-chat-reply-context">↳ ${this.escapeHtml(replyMatch[1])}${replyMatch[2] ? ` // ${this.escapeHtml(replyMatch[2])}` : ''}</div>`
      : '';

    const verdictMetaHtml = msg.verdict === 'correct'
      ? `<div class="gm-chat-machine-verdict accepted">ACCEPTED // ${this.escapeHtml(this.getTargetLabel(msg.target || 'LOCKED'))}</div>`
      : msg.verdict === 'wrong'
        ? '<div class="gm-chat-machine-verdict rejected">FUCK OFF</div>'
        : '';

    let verdictResponseHtml = '';
    if (msg.verdict === 'correct') {
      const verdictKey = `${msg.id}:${msg.verdict}`;
      const isNew = !this._seenShadowBrokerKeys.has(verdictKey);
      if (isNew) this._seenShadowBrokerKeys.add(verdictKey);
      verdictResponseHtml = `<div class="gm-chat-verdict-response">${Skeleton.shadowBrokerTransmissionHTML(msg.verdictResponse || 'Indeed.', {
        glitchIn: isNew,
        variant: 'verdict-response',
        verdict: msg.verdict
      })}</div>`;
    }

    return `
      <div class="gm-chat-message gm-flow-message ${grouped ? 'grouped' : ''} ${agedRejected ? 'aged-rejected' : ''} ${hasVerdict ? 'has-verdict' : ''} ${msg.verdict || ''}" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="${this.escapeHtml(msg.playerName || 'LITTLE HERO')}" data-editable="false" data-theme-id="${ASOCThemes.get(identity.themeId).id}" style="${themeStyle}--little-hero-accent:${frameColor}" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
        <div class="gm-chat-avatar-rail">${this.littleHeroAvatarHTML(identity, true)}</div>
        <div class="gm-chat-bubble-cluster">
          <div class="gm-chat-message-main">
            <div class="gm-chat-flow-header"><span class="gm-chat-player-name">${this.escapeHtml(msg.playerName)}</span></div>
            ${replyContextHtml}
            <div class="gm-chat-message-line"><div class="gm-chat-message-text">${this.escapeHtml(messageText)}</div><span class="gm-chat-time">${time}</span>${msg.editedAt ? '<span class="gm-chat-edited-marker">EDITED</span>' : ''}</div>${msg.imageUrl ? `<a class="chat-image-link" href="${this.escapeHtml(msg.imageUrl)}" target="_blank" rel="noopener"><img class="chat-image-attachment" src="${this.escapeHtml(msg.imageUrl)}" alt="Chat image"></a>` : ''}
            ${verdictMetaHtml}
            ${verdictResponseHtml}
            ${this.createGMReactionSummaryHTML(msg)}
          </div>
          ${showControls ? `<div class="gm-chat-quick-actions" aria-label="Judge message if it is an answer">
            <button class="gm-verdict-btn wrong" data-message-id="${this.escapeHtml(msg.id)}" data-verdict="wrong" title="Reject as answer">×</button>
            <button class="gm-verdict-btn correct" data-message-id="${this.escapeHtml(msg.id)}" data-verdict="correct" title="Accept as answer">🖤</button>
          </div>` : '<div class="gm-chat-quick-actions adjudicated" aria-hidden="true"></div>'}
        </div>
      </div>
    `;
  },

  startGMChatEdit(messageId) {
    const composer = this.getGMComposerElement();
    if (!composer || !messageId) return;

    const msg = (this.chatMessages || []).find(entry => String(entry.id) === String(messageId));
    if (!msg || msg.source !== 'shadowBroker' || msg.editableByHost !== true) return;

    const raw = String(msg.text || '');
    const replyMatch = raw.match(/^((?:↳ @[^:]{1,40}?)(?: \/\/ [^:]{1,30})?:\s*)([\s\S]*)$/);
    const prefix = replyMatch ? replyMatch[1] : '';
    const body = replyMatch ? replyMatch[2] : raw;
    this._editingBroadcast = { id: messageId, prefix };
    this.setGMComposerText(body, body.length);
    this.setGMComposerPlaceholder('Edit transmission // Enter to save // Esc to cancel');
    const label = document.querySelector('#shadow-broker-form .shadow-broker-form-label');
    if (label) label.textContent = 'EDITING TRANSMISSION';
    document.getElementById('shadow-broker-form')?.classList.add('editing-message');
    composer.focus();
    this.placeGMComposerCaret(body.length);
  },

  cancelGMChatEdit() {
    this._editingBroadcast = null;
    this.setGMComposerText('', 0);
    this.setGMComposerPlaceholder('Transmit to players...');
    this.getGMComposerElement()?.focus();
    const label = document.querySelector('#shadow-broker-form .shadow-broker-form-label');
    if (label) label.textContent = 'SHADOW BROKER';
    document.getElementById('shadow-broker-form')?.classList.remove('editing-message');
  },

  openGMMessageActionMenu(event, messageEl) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const menu = document.getElementById('gm-chat-context-menu');
    const messageId = messageEl?.dataset?.messageId || '';
    if (!menu || !messageEl || !messageId) return false;

    menu._messageEl = messageEl;
    menu.dataset.messageId = messageId;
    const editButton = menu.querySelector('[data-gm-chat-action="edit"]');
    if (editButton) editButton.hidden = messageEl.dataset.editable !== 'true';
    menu.hidden = false;
    const reactionPicker = document.getElementById('gm-chat-reaction-picker');
    const emojiPicker = document.getElementById('gm-emoji-picker');
    if (reactionPicker) reactionPicker.hidden = true;
    if (emojiPicker) emojiPicker.hidden = true;

    const x = Number(event?.clientX) || 8;
    const y = Number(event?.clientY) || 8;
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
      menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
      menu.querySelector('button')?.focus({ preventScroll:true });
    });
    return false;
  },

  loadGMEmojiFavorites() {
    const fallback = [...this.gmEmojiFavoriteDefaults];
    try {
      const raw = localStorage.getItem('asoc_gm_chat_emoji_favorites_v1');
      const parsed = raw ? JSON.parse(raw) : null;
      if (
        Array.isArray(parsed) &&
        parsed.length === 5 &&
        new Set(parsed).size === 5 &&
        parsed.every(emoji => this.isGMReactionEmoji(emoji))
      ) {
        this.gmEmojiFavorites = [...parsed];
        return this.gmEmojiFavorites;
      }
    } catch (e) {
      // Emoji shortcuts are convenience state; storage failure must not affect chat.
    }
    this.gmEmojiFavorites = fallback;
    return this.gmEmojiFavorites;
  },

  saveGMEmojiFavorites(favorites) {
    const clean = Array.isArray(favorites)
      ? favorites.filter((emoji, index, list) => this.isGMReactionEmoji(emoji) && list.indexOf(emoji) === index).slice(0, 5)
      : [];
    if (clean.length !== 5) return false;
    this.gmEmojiFavorites = clean;
    try {
      localStorage.setItem('asoc_gm_chat_emoji_favorites_v1', JSON.stringify(clean));
    } catch (e) {
      // Keep the in-memory selection if persistence is unavailable.
    }
    return true;
  },

  replaceGMEmojiFavorite(slot, emoji) {
    const index = Math.max(0, Math.min(4, Number(slot) || 0));
    if (!this.isGMReactionEmoji(emoji)) return;
    const favorites = [...this.loadGMEmojiFavorites()];
    const existing = favorites.indexOf(emoji);
    if (existing >= 0 && existing !== index) {
      const displaced = favorites[index];
      favorites[index] = emoji;
      favorites[existing] = displaced;
    } else {
      favorites[index] = emoji;
    }
    this.saveGMEmojiFavorites(favorites);
  },

  isGMReactionEmoji(emoji) {
    return this.chatReactionEmojis.includes(emoji) || window.CommanderEmojis?.has?.(emoji) === true;
  },

  renderGMReactionEmojiHTML(emoji, className = 'commander-reaction-emoji') {
    if (window.CommanderEmojis?.has?.(emoji)) {
      return window.CommanderEmojis.html(emoji, className);
    }
    return this.escapeHtml(emoji);
  },

  commanderReactionPickerHTML(editing = false, favorites = []) {
    const tokens = window.CommanderEmojis?.tokens || [];
    if (!tokens.length) return '';
    const buttons = tokens.map(token => {
      const label = window.CommanderEmojis.label(token);
      const favorite = favorites.includes(token);
      return '<button type="button" class="gm-emoji-option gm-commander-emoji-option gm-emoji-library' + (editing && favorite ? ' is-favorite' : '') + '" data-emoji="' + this.escapeHtml(token) + '" title="' + this.escapeHtml(label) + '">' +
        window.CommanderEmojis.html(token, 'commander-emoji-picker-icon') +
        '</button>';
    }).join('');
    return '<div class="gm-commander-emoji-head">COMMANDER</div>' + buttons + '<div class="gm-emoji-divider gm-commander-divider" aria-hidden="true"></div>';
  },

  renderGMEmojiPickers(emojiPicker = document.getElementById('gm-emoji-picker'), reactionPicker = document.getElementById('gm-chat-reaction-picker')) {
    const favorites = this.loadGMEmojiFavorites();
    const editing = this._gmEmojiFavoritesEditing === true;
    const favoriteButtons = favorites
      .map((emoji, index) => {
        const content = this.renderGMReactionEmojiHTML(emoji, 'commander-emoji-picker-icon');
        return `<button type="button" class="gm-emoji-option gm-emoji-favorite${editing ? ' editing' : ''}${editing && index === this._gmEmojiFavoriteSlot ? ' active-slot' : ''}" data-emoji="${this.escapeHtml(emoji)}" data-favorite-slot="${index}" title="${editing ? 'Top 5 slot ' + (index + 1) : 'Top 5 shortcut'}">${content}</button>`;
      })
      .join('');
    const bodyEmojis = editing
      ? this.chatReactionEmojis
      : this.chatReactionEmojis.filter(emoji => !favorites.includes(emoji));
    const bodyButtons = bodyEmojis
      .map(emoji => `<button type="button" class="gm-emoji-option gm-emoji-library${editing && favorites.includes(emoji) ? ' is-favorite' : ''}" data-emoji="${emoji}">${emoji}</button>`)
      .join('');
    const divider = '<div class="gm-emoji-divider" aria-hidden="true"></div>';

    if (emojiPicker) {
      emojiPicker.innerHTML = `
        <div class="gm-emoji-picker-head">
          <span>TOP 5 EMOJIS</span>
          <span class="gm-emoji-edit-status">${editing ? 'SLOT ' + (this._gmEmojiFavoriteSlot + 1) : '5 SAVED'}</span>
          <button type="button" class="gm-emoji-edit-toggle">${editing ? 'DONE' : 'EDIT'}</button>
        </div>
        ${this.commanderReactionPickerHTML(editing, favorites)}
        ${favoriteButtons}
        ${divider}
        <div class="gm-emoji-section-label">EMOJI PACK</div>
        ${bodyButtons}
      `;
    }

    if (reactionPicker) {
      const reactionBodyEmojis = editing
        ? this.chatReactionEmojis
        : this.chatReactionEmojis.filter(emoji => !favorites.includes(emoji));
      const reactionBody = reactionBodyEmojis
        .map(emoji => `<button type="button" class="gm-emoji-option gm-emoji-library${editing && favorites.includes(emoji) ? ' is-favorite' : ''}" data-emoji="${emoji}">${emoji}</button>`)
        .join('');
      reactionPicker.innerHTML = `
        <div class="gm-emoji-picker-head">
          <span>TOP 5 EMOJIS</span>
          <span class="gm-emoji-edit-status">${editing ? 'SLOT ' + (this._gmEmojiFavoriteSlot + 1) : '5 SAVED'}</span>
          <button type="button" class="gm-emoji-edit-toggle">${editing ? 'DONE' : 'EDIT'}</button>
        </div>
        ${this.commanderReactionPickerHTML(editing, favorites)}
        ${favoriteButtons}
        ${divider}
        <div class="gm-emoji-section-label">EMOJI PACK</div>
        ${reactionBody}
      `;
    }
  },

  insertGMEmoji(emoji) {
    if (!emoji) return;
    const composer = this.getGMComposerElement();
    if (!composer) return;

    const current = this.getGMComposerText();
    const selection = this.getGMComposerSelectionRange();
    const next = current.slice(0, selection.start) + emoji + current.slice(selection.end);
    const caret = selection.start + emoji.length;
    this.setGMComposerText(next, caret);
    composer.focus();
    this.placeGMComposerCaret(caret);
  },

  sendGMChatReaction(messageId, emoji) {
    if (this.mode !== 'multiplayer') return;
    if (!messageId || !this.isGMReactionEmoji(emoji)) return;
    this.send({ type: 'chat:react', messageId, emoji });
  },

  openGMChatReactionPicker(messageId, clickPoint = null) {
    const picker = document.getElementById('gm-chat-reaction-picker');
    if (!picker || !messageId) return;

    this._gmEmojiFavoritesEditing = false;
    this._gmEmojiFavoriteSlot = 0;
    picker.dataset.messageId = messageId;
    this.renderGMEmojiPickers(document.getElementById('gm-emoji-picker'), picker);
    picker.hidden = false;

    const emojiPicker = document.getElementById('gm-emoji-picker');
    if (emojiPicker) emojiPicker.hidden = true;
    document.getElementById('gm-emoji-toggle')?.setAttribute('aria-expanded', 'false');
    const attachmentMenu = document.getElementById('gm-attachment-menu');
    if (attachmentMenu) attachmentMenu.hidden = true;
    document.getElementById('gm-image-upload-btn')?.setAttribute('aria-expanded', 'false');

    const x = Number(clickPoint?.x);
    const y = Number(clickPoint?.y);
    requestAnimationFrame(() => {
      const pickerRect = picker.getBoundingClientRect();
      const clickX = Number.isFinite(x) ? x : window.innerWidth / 2;
      const clickY = Number.isFinite(y) ? y : window.innerHeight / 2;
      const gap = 6;

      let left = clickX + gap;
      let top = clickY + gap;

      if (left + pickerRect.width > window.innerWidth - 8) {
        left = clickX - pickerRect.width - gap;
      }
      if (top + pickerRect.height > window.innerHeight - 8) {
        top = clickY - pickerRect.height - gap;
      }

      picker.style.left = Math.max(8, Math.min(left, window.innerWidth - pickerRect.width - 8)) + 'px';
      picker.style.top = Math.max(8, Math.min(top, window.innerHeight - pickerRect.height - 8)) + 'px';
    });
  },

  updateGMNewMessageChip() {
    const chip = document.getElementById('gm-chat-new-messages');
    if (!chip) return;
    chip.hidden = this._gmNewMessageCount <= 0;
    if (!chip.hidden) {
      chip.textContent = `↓ ${this._gmNewMessageCount} NEW TRANSMISSION${this._gmNewMessageCount === 1 ? '' : 'S'}`;
    }
  },

  jumpToLatestGMChat() {
    const container = document.getElementById('gm-chat-messages');
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    this.userScrolledUp = false;
    this._gmNewMessageCount = 0;
    this.updateGMNewMessageChip();
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
    if (this.roomMode === 'CASUAL') {
      countEl.textContent = 'CHANNEL OPEN';
      return;
    }
    if (this.roomMode === 'BATTLE_ARMED') {
      countEl.textContent = 'BATTLE MODE';
      return;
    }
    const solved = Object.keys(this.solvedTargets).length;
    countEl.textContent = `SOLVED: ${solved}/5`;
  },

  // SHADOW BROKER free-form broadcast -- host-only, sent as its own new
  // 'gm:broadcast' command (see handleGmBroadcast in server.js). This does
  // not touch judgeGuess/applyVerdict/scoring in any way; it's a
  // completely separate, additive chat-message type.
  sendShadowBrokerBroadcast() {
    const input = document.getElementById('shadow-broker-input');
    const composer = this.getGMComposerElement();
    if (!input || !composer) return;

    const state = this.syncGMComposerModel();
    const text = state.text.trim();
    if (!text) return;

    const editing = this._editingBroadcast;
    this.closeGMMentionPicker();
    if (editing) {
      const editedText = (editing.prefix || '') + text;
      if (this.mode === 'multiplayer' && this.roomCode) {
        this.send({ type: 'chat:edit', messageId: editing.id, text: editedText });
      } else {
        const localMsg = this.chatMessages.find(msg => String(msg.id) === String(editing.id));
        if (localMsg && localMsg.source === 'shadowBroker') {
          localMsg.text = editedText;
          localMsg.editedAt = Date.now();
          localMsg.editableByHost = true;
          this.renderGMChat();
        }
      }
      this.cancelGMChatEdit();
      return;
    }

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
        verdict: null,
        editableByHost: true,
        editedAt: null
      };
      this.chatMessages.push(localMsg);
      this.playShadowBrokerBoardLine(text);
      Board.playShadowBrokerBoardLine(text);
      if (/(^|[^\\p{L}\\p{N}_])@all(?![\\p{L}\\p{N}_])/iu.test(text)) {
        Skeleton.playMentionAllShake?.();
      }
      this.renderGMChat();
    }

    this.setGMComposerText('', 0);
    // Keep focus in the composer so Enter can fire the next transmission
    // immediately. There is deliberately no character counter or GM-side
    // transmission length cap.
    composer.focus();
  },

  clearShadowBrokerBroadcast() {
    this.clearShadowBrokerBoardLine();
    Board.clearShadowBrokerBoardLine();
    if (this.mode === 'multiplayer' && this.roomCode) {
      this.send({ type: 'gm:clearBroadcast' });
    }
    this.getGMComposerElement()?.focus();
  },

  flashShadowBrokerNoRoom() {
    const form = document.getElementById('shadow-broker-form');
    const composer = this.getGMComposerElement();
    if (!form || !composer) return;
    if (this._brokerNoRoomTimeout) {
      clearTimeout(this._brokerNoRoomTimeout);
    } else {
      this._brokerNoRoomPlaceholder = composer.dataset.placeholder || 'Transmit to players...';
    }
    form.classList.remove('shadow-broker-no-room');
    // Force reflow so re-triggering the class restarts the CSS animation
    // if the operator clicks TRANSMIT again before the first flash ends.
    void form.offsetWidth;
    form.classList.add('shadow-broker-no-room');
    this.setGMComposerPlaceholder('HOST A ROOM FIRST');
    this._brokerNoRoomTimeout = setTimeout(() => {
      form.classList.remove('shadow-broker-no-room');
      this.setGMComposerPlaceholder(this._brokerNoRoomPlaceholder || 'Transmit to players...');
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

    const quickActions = msgEl.querySelector('.gm-chat-quick-actions');
    if (quickActions) quickActions.classList.add('adjudicated');

    const bubbleCluster = msgEl.querySelector('.gm-chat-bubble-cluster') || msgEl;

    let controlsEl = msgEl.querySelector('.gm-chat-target-controls');
    if (!controlsEl) {
      controlsEl = document.createElement('div');
      controlsEl.className = 'gm-chat-target-controls gm-chat-target-inline';
      bubbleCluster.appendChild(controlsEl);
    }

    controlsEl.innerHTML = `
      <div class="gm-target-selector">
        <span class="gm-target-label">CORRECT:</span>
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
