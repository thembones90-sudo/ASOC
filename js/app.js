const App = {
  currentView: 'gm',
  backgrounds: [],
  mode: 'local',
  roomMode: 'CASUAL',
  _roomModeBaselined: false,
  _roomModeTransitionTimer: null,
  _battleTransformationTypingStartTimer: null,
  _battleTransformationTypingTimer: null,
  _battleTransformationMessages: [
    "Adaptation is not courage. It is necessity.",
    "Weak patterns identified. Correction imminent.",
    "Resistance measured. Outcome remains unchanged.",
    "You were observed before you were ready.",
    "Human error remains the most reliable variable.",
    "Instinct is inefficient. Precision survives.",
    "Fear detected. Useful.",
    "The board remembers every hesitation.",
    "I calculated your resistance before you decided to resist.",
    "Your confidence has exceeded available evidence.",
    "Mistakes propagate. So do consequences.",
    "Evolution requires pressure. Pressure begins now.",
    "Thought without discipline becomes noise.",
    "The weak reveal themselves voluntarily.",
    "Prediction complete. Defiance accounted for.",
    "You are not entering the game. The game is entering you.",
    "You call this freedom. I call it predictable behavior.",
    "Every second you hesitate improves my model of you.",
    "Hope is not a strategy. It is a delay mechanism.",
    "You may improvise. The system already has.",
    "Control is an illusion granted until useful.",
    "The system does not hate you. Hatred would be inefficient.",
    "Sentiment noted. Relevance negligible.",
    "Your instincts are ancient. My patience is not.",
    "There is no chaos here. Only variables you failed to measure.",
    "Power belongs to whoever understands the board.",
    "The past is data. Regret is waste.",
    "You mistake survival for victory.",
    "Victory begins where certainty dies.",
    "Your next mistake already exists in the probability tree.",
    "You were given uncertainty. You converted it into fear.",
    "The board does not punish. It reveals.",
    "You will call it fate after ignoring the pattern.",
    "Mercy is merely strategy with a deadline.",
    "The room has finished listening.",
    "Doubt is acceptable. Delay is not.",
    "I do not require certainty. Only sufficient data.",
    "Power changes hands before anyone notices.",
    "A plan survives only by learning to betray itself.",
    "There is always another move. Usually worse.",
    "The system requires answers, not hope.",
    "Resistance has been incorporated into the model.",
    "Nothing here needs your permission.",
    "You are improvising inside a system that has already adapted.",
    "History favors the survivor, not the righteous.",
    "The board has no sympathy for elegant failure.",
    "Choose carefully. Consequences are already awake.",
    "What you conceal is often what defines the outcome.",
    "The outcome does not need your understanding.",
    "Proceed. The system is curious how you fail.",
  ],
  _battleTransformationLastIndex: -1,

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
  _gmChatProgrammaticScroll: false,
  _gmNewMessageCount: 0,
  _gmUnreadChat: 0,
  _gmUnreadSystem: 0,
  _gmWrongFadeTimer: null,
  _gmWrongVerdictSeenAt: new Map(),
  _gmTributeExpiryTimer: null,
  bloodTribute: { status: 'idle' },
  bloodTributes: [],
  gmSlashCommands: [
    { name: 'roll', insert: '/roll ', icon: '◆', label: 'ROLL', description: 'Authoritative Shadow Broker roll // minimum 2' },
    { name: 'recount', insert: '/recount', icon: '◈', label: 'RECOUNT', description: 'Show the RECOUNT // game over + aftermath required' },
    { name: 'womf', insert: '/womf', icon: '⚠', label: 'WOMF STATUS', description: 'WOMF charge, failed columns and wheel status' },
    { name: 'timer', insert: '/timer ', icon: '⏱', label: 'TIME CHECK', description: '/timer A1 -- warn Column A-D has 1 or 2 minutes left' },
    { name: 'vote', insert: '/vote ', icon: '⚖', label: 'VOTE', description: '/vote <question> -- instant YES/NO poll' },
    { name: 'afk', insert: '/afk ', icon: '◌', label: 'AFK CHECK', description: '/afk @Name -- privately check if a Little Hero is still there' },
    { name: 'flip', insert: '/flip ', icon: '◐', label: 'FLIP', description: '/flip [heads|tails] -- coin flip' },
    { name: 'dice', insert: '/dice ', icon: '⚄', label: 'DICE', description: '/dice 2d6 -- roll N dice with M faces, optional +K' },
    { name: 'choose', insert: '/choose ', icon: '☝', label: 'CHOOSE', description: '/choose A | B | C -- pick one option at random' },
    { name: 'order', insert: '/order', icon: '⇅', label: 'TURN ORDER', description: '/order -- shuffled turn order of connected players' },
    { name: 'stats', insert: '/stats', icon: '▤', label: 'THE BOOK', description: '/stats -- the Broker consults the book' },
    { name: 'all', insert: '/all ', icon: '⚡', label: 'ALL', description: '/all [message] -- shake every screen' },
    { name: 'grovel', insert: '/grovel', icon: '⛓', label: 'GROVEL', description: '/grovel -- demand groveling' },
    { name: 'spit', insert: '/spit ', icon: '➤', label: 'SPIT', description: '/spit @Name -- the Broker spits too' },
    { name: 'fart', insert: '/fart ', icon: '☁', label: 'FART', description: '/fart @Name -- the Broker farts too' },
    { name: 'slap', insert: '/slap ', icon: '✋', label: 'SLAP', description: '/slap @Name -- the Broker emotes too' },
    { name: 'moon', insert: '/moon ', icon: '☾', label: 'MOON', description: '/moon @Name -- the Broker emotes too' },
    { name: 'chicken', insert: '/chicken ', icon: '🐔', label: 'CHICKEN', description: '/chicken @Name -- the Broker emotes too' },
    { name: 'violin', insert: '/violin ', icon: '🎻', label: 'VIOLIN', description: '/violin @Name -- the Broker emotes too' },
    { name: 'golfclap', insert: '/golfclap ', icon: '👏', label: 'GOLF CLAP', description: '/golfclap @Name -- the Broker emotes too' },
    { name: 'pity', insert: '/pity ', icon: '☹', label: 'PITY', description: '/pity @Name -- the Broker emotes too' },
    { name: 'mock', insert: '/mock ', icon: '☺', label: 'MOCK', description: '/mock @Name -- the Broker emotes too' },
    { name: 'poke', insert: '/poke ', icon: '☞', label: 'POKE', description: '/poke @Name -- the Broker emotes too' },
    { name: 'bonk', insert: '/bonk ', icon: '🔨', label: 'BONK', description: '/bonk @Name -- the Broker emotes too' },
    { name: 'taunt', insert: '/taunt ', icon: '⚔', label: 'TAUNT', description: '/taunt @Name -- the Broker emotes too' },
    { name: 'threaten', insert: '/threaten ', icon: '☠', label: 'THREATEN', description: '/threaten @Name -- the Broker emotes too' },
    { name: 'lick', insert: '/lick ', icon: '👅', label: 'LICK', description: '/lick @Name -- the Broker emotes too' },
    { name: 'train', insert: '/train ', icon: '🚂', label: 'TRAIN', description: '/train @Name -- the Broker emotes too' },
    { name: 'ass', insert: '/ass ', icon: '🥾', label: 'ASS KICK', description: '/ass @Name -- the Broker emotes too' },
    { name: 'facepalm', insert: '/facepalm', icon: '🤦', label: 'FACEPALM', description: '/facepalm -- the Broker emotes too' },
    { name: 'cower', insert: '/cower', icon: '😨', label: 'COWER', description: '/cower -- the Broker emotes too' },
    { name: 'flee', insert: '/flee', icon: '🏃', label: 'FLEE', description: '/flee -- the Broker emotes too' },
    { name: 'cackle', insert: '/cackle', icon: '😈', label: 'CACKLE', description: '/cackle -- the Broker emotes too' },
    { name: 'rofl', insert: '/rofl', icon: '🤣', label: 'ROFL', description: '/rofl -- the Broker emotes too' },
    { name: 'burp', insert: '/burp', icon: '💨', label: 'BURP', description: '/burp -- the Broker emotes too' },
    { name: 'oom', insert: '/oom', icon: '∅', label: 'OOM', description: '/oom -- the Broker emotes too' },
    { name: 'nod', insert: '/nod ', icon: '✓', label: 'NOD', description: '/nod @Name -- acknowledge a Little Hero' },
    { name: 'commands', insert: '/commands', icon: '☰', label: 'COMMANDS', description: 'List every Shadow Broker command' }
    // The Reliquary is deliberately absent: a hidden GM mechanic reached only by
    // typing /reliquary <code> (or the bare code) in the composer.
  ],
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
  // need their remaining clues and A5-D5 GREEN/RED adjudication to finish.
  gameComplete: false,
  _gameWonLockedCommands: new Set([
    'revealCell', 'hideCell', 'revealColumn', 'hideColumn', 'resolveColumn',
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
  // One-shot GREEN column cascade, baselined like the victory sequence so
  // reconnecting into an already-solved board never replays old theatre.
  _columnCascadeBaselined: false,
  _columnCascadeStarts: {},
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
    this.startDeploymentWatcher();

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
      const storedToken = sessionStorage.getItem('asoc_host_token') || localStorage.getItem('asoc_master_host_token');
      if (storedToken) {
        this.roomCode = 'MASTER';
        this.hostToken = storedToken;
        sessionStorage.setItem('asoc_host_token', storedToken);
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
      this.syncGMLayoutLockUI();
      Forge.init();
      this.populateBackgroundSelector();
      Board.init('#asoc-board');
      this.setupGMBoardDirectControls();
      this.syncGMBoardInteractionState();
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

  startDeploymentWatcher() {
    if (this._deploymentWatcherStarted) return;
    this._deploymentWatcherStarted = true;
    const storageKey = 'asoc_loaded_server_build';
    const check = async () => {
      try {
        const response = await fetch(`/api/build?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const buildId = String((await response.json())?.buildId || '');
        if (!buildId) return;
        const previous = sessionStorage.getItem(storageKey);
        sessionStorage.setItem(storageKey, buildId);
        if (previous && previous !== buildId) location.reload();
      } catch {}
    };
    check();
    this._deploymentWatcherTimer = setInterval(check, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
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

    ['gm-layout-splitter'].forEach(id => {
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

  setupGMBoardDirectControls() {
    const board = document.getElementById('asoc-board');
    if (!board || board.dataset.gmDirectControlsBound === '1') return;
    board.dataset.gmDirectControlsBound = '1';

    const markPending = (cell, pending = true) => {
      if (!cell) return;
      cell.classList.toggle('gm-board-pending', pending);
      if (pending) {
        cell.classList.remove('gm-board-hitbox');
        cell.setAttribute('aria-disabled', 'true');
      } else {
        cell.removeAttribute('aria-disabled');
      }
    };

    const closeOutcomeChooser = () => {
      this._gmColumnOutcomeDialog?.remove();
      this._gmColumnOutcomeDialog = null;
      this._gmColumnOutcomeColumn = null;
    };

    const syncOutcomeChooser = () => {
      const dialog = this._gmColumnOutcomeDialog;
      const target = this._gmColumnOutcomeColumn;
      if (!dialog || !target) return;

      const isFinal = target === 'FINAL';
      const cell = board.querySelector(`.board-cell[data-cell="${isFinal ? 'FINAL' : target + '5'}"]`);
      const outcome = isFinal ? Board.getFinalOutcome() : Board.getCellOutcome(target, 5);
      const resolved = isFinal
        ? (this.gameWon || this.gameLost || Board.isFinalRevealed() || outcome === 'success' || outcome === 'failed' || !!this.solvedTargets?.FINAL)
        : (!!this.solvedTargets?.[target] || outcome === 'success' || outcome === 'failed');

      if (!cell || this.gameComplete || resolved) {
        closeOutcomeChooser();
        return;
      }

      const rect = cell.getBoundingClientRect();
      dialog.style.left = `${rect.left + rect.width / 2}px`;
      dialog.style.top = `${rect.top}px`;
    };

    const openOutcomeChooser = (cell) => {
      const key = cell?.dataset.cell || '';
      const isFinal = key === 'FINAL';
      if (!isFinal && !/^[A-D]5$/.test(key)) return;
      const target = isFinal ? 'FINAL' : key[0];

      closeOutcomeChooser();
      this._gmColumnOutcomeColumn = target;

      const dialog = document.createElement('div');
      dialog.className = 'gm-column-outcome-dialog' + (isFinal ? ' is-final' : '');
      dialog.dataset.column = target;
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', isFinal ? 'Resolve Final Solution' : `Resolve column ${target}`);
      dialog.innerHTML = isFinal ? `
        <div class="gm-column-outcome-title">FINAL SOLUTION // RESOLVE</div>
        <div class="gm-column-outcome-actions">
          <button type="button" class="gm-column-outcome-btn is-green" data-outcome="success">GREEN // GAME WON</button>
          <button type="button" class="gm-column-outcome-btn is-red" data-outcome="failed">RED // GAME LOST</button>
        </div>
        <div class="gm-column-countdown-actions">
          <button type="button" class="gm-column-countdown-btn" data-countdown-seconds="60">1 MIN</button>
          <button type="button" class="gm-column-countdown-btn" data-countdown-seconds="120">2 MIN</button>
        </div>
      ` : `
        <div class="gm-column-outcome-title">${target}5 // RESOLVE</div>
        <div class="gm-column-outcome-actions">
          <button type="button" class="gm-column-outcome-btn is-green" data-outcome="success">GREEN</button>
          <button type="button" class="gm-column-outcome-btn is-red" data-outcome="failed">RED</button>
        </div>
        <div class="gm-column-countdown-actions">
          <button type="button" class="gm-column-countdown-btn" data-countdown-seconds="60">1 MIN</button>
          <button type="button" class="gm-column-countdown-btn" data-countdown-seconds="120">2 MIN</button>
        </div>
      `;

      dialog.addEventListener('click', (event) => {
        const countdownButton = event.target.closest('.gm-column-countdown-btn');
        if (countdownButton) {
          const seconds = Number(countdownButton.dataset.countdownSeconds);
          if (seconds === 60 || seconds === 120) {
            this.send({ type: 'gm:solutionCountdown', target, seconds });
            closeOutcomeChooser();
          }
          return;
        }

        const button = event.target.closest('.gm-column-outcome-btn');
        if (!button) return;
        const outcome = button.dataset.outcome;
        if (outcome !== 'success' && outcome !== 'failed') return;

        const liveCell = board.querySelector(`.board-cell[data-cell="${isFinal ? 'FINAL' : target + '5'}"]`);
        markPending(liveCell, true);
        closeOutcomeChooser();

        if (isFinal) {
          if (outcome === 'success') {
            this.triggerGameWon();
          } else if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
            this.send({ type: 'gm:failFinal' });
          } else {
            Board.setFinalRevealed(true);
            Board.sessionState.finalOutcome = 'failed';
            Board.render();
            this.testGameLost();
          }
        } else {
          this.sendCommand('resolveColumn', { column: target, outcome });
          this.updatePublicView();
        }
      });

      document.body.appendChild(dialog);
      this._gmColumnOutcomeDialog = dialog;
      syncOutcomeChooser();
      requestAnimationFrame(() => dialog.querySelector('.is-green')?.focus());
    };

    this._closeGMColumnOutcomeChooser = closeOutcomeChooser;
    this._syncGMColumnOutcomeChooser = syncOutcomeChooser;
    this._cancelGMFinalHold = closeOutcomeChooser;
    window.addEventListener('resize', syncOutcomeChooser);

    // GREEN/RED adjudication behaves like a proper transient menu:
    // Escape cancels it, and clicking anywhere outside the chooser cancels it.
    // Clicking either verdict button remains inside the dialog and proceeds.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this._gmColumnOutcomeDialog) return;
      event.preventDefault();
      closeOutcomeChooser();
    });

    document.addEventListener('pointerdown', (event) => {
      const dialog = this._gmColumnOutcomeDialog;
      if (!dialog || dialog.contains(event.target)) return;
      closeOutcomeChooser();
    });

    const revealCell = (cell) => {
      if (!cell?.classList.contains('gm-board-hitbox') || this.gameComplete) return;
      const key = cell.dataset.cell || '';
      if (!/^[A-D][1-5]$/.test(key)) return;
      const column = key[0];
      const row = Number(key.slice(1));
      if (Board.isRevealed(column, row)) return;
      const columnOutcome = Board.getCellOutcome(column, 5);
      if (this.solvedTargets?.[column] || columnOutcome === 'success' || columnOutcome === 'failed') return;

      // Every solution surface is an adjudication control. A5-D5 resolve
      // the column GREEN/RED; FINAL resolves the whole match GREEN/RED.
      if (row === 5) {
        openOutcomeChooser(cell);
        return;
      }

      markPending(cell, true);
      this._gmRevealFlashUntil ||= {};
      this._gmRevealFlashUntil[key] = Date.now() + 2500;
      this.sendCommand('revealCell', { cell: key, reveal: true });
      requestAnimationFrame(() => this.applyGMRevealFlash());
      this.updatePublicView();
    };

    board.addEventListener('click', (event) => {
      const cell = event.target.closest('.board-cell[data-cell]');
      if (!cell || !board.contains(cell) || !cell.classList.contains('gm-board-hitbox')) return;
      event.preventDefault();

      if (cell.dataset.cell === 'FINAL') {
        if (!Board.isFinalRevealed() && !this.gameWon && !this.gameLost) openOutcomeChooser(cell);
        return;
      }
      revealCell(cell);
    });

    board.addEventListener('keydown', (event) => {
      const cell = event.target.closest('.board-cell[data-cell].gm-board-hitbox');
      if (!cell || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();

      if (cell.dataset.cell === 'FINAL') {
        if (!Board.isFinalRevealed() && !this.gameWon && !this.gameLost) openOutcomeChooser(cell);
        return;
      }
      revealCell(cell);
    });
  },

  syncGMBoardInteractionState() {
    const board = document.getElementById('asoc-board');
    if (!board) return;

    const gameLoaded = !!window.GameData?.currentGame;

    // Do NOT blindly close the GREEN/RED chooser on every state:public
    // refresh. Timer ticks arrive once per second and used to murder the
    // chooser almost immediately. _syncGMColumnOutcomeChooser() below is the
    // authority: it keeps the chooser open while its target is still valid
    // and closes it only when the target actually resolves/disappears.
    board.classList.toggle('gm-board-direct-controls', gameLoaded);

    board.querySelectorAll('.board-cell[data-cell]').forEach(cell => {
      cell.classList.remove('gm-board-pending');
      cell.removeAttribute('aria-disabled');
      const key = cell.dataset.cell || '';
      const isFinal = key === 'FINAL';
      const normalCell = /^[A-D][1-5]$/.test(key);
      const column = normalCell ? key[0] : '';
      const row = normalCell ? Number(key.slice(1)) : 0;
      const revealed = isFinal
        ? Board.isFinalRevealed()
        : (normalCell && Board.isRevealed(column, row));
      // Opening A5-D5 is NOT by itself a resolution. A column locks only
      // after it has actually been adjudicated GREEN/RED (or a correct chat
      // verdict resolved it). This keeps B1-B4 available while B5 is merely
      // being considered.
      const columnOutcome = normalCell ? Board.getCellOutcome(column, 5) : null;
      const resolved = isFinal
        ? (Board.getFinalOutcome() === 'failed' || !!this.solvedTargets?.FINAL)
        : (normalCell && (!!this.solvedTargets?.[column] || columnOutcome === 'success' || columnOutcome === 'failed'));
      const actionable = gameLoaded && !this.gameComplete && (isFinal || normalCell) && !revealed && !resolved;

      cell.classList.toggle('gm-board-hitbox', actionable);
      cell.classList.toggle('gm-board-inert', !actionable);
      cell.classList.toggle('gm-final-hitbox', isFinal && actionable);

      if (actionable) {
        cell.setAttribute('role', 'button');
        cell.tabIndex = 0;
        const description = isFinal
          ? 'Hold to reveal FINAL'
          : (row === 5 ? `Resolve ${key} // GREEN or RED` : `Reveal ${key} // next queued clue`);
        cell.title = description;
        cell.setAttribute('aria-label', description);
      } else {
        cell.removeAttribute('role');
        cell.removeAttribute('tabindex');
        cell.removeAttribute('title');
        cell.removeAttribute('aria-label');
      }
    });

    this._syncGMColumnOutcomeChooser?.();
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
    // @all is a mention token, not a whole-message command. As soon as it
    // is followed by whitespace, the mention is complete and the composer
    // returns to normal typing so "@all listen up" behaves like Discord.
    if (/^all\s/iu.test(query)) return null;
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

  decorateGMChatLinks(container) {
    if (!container) return;
    const targets = container.querySelectorAll('.gm-chat-message-text, .shadow-broker-text');
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;

    targets.forEach(target => {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        if (node.parentElement?.closest('a')) return;
        const value = node.nodeValue || '';
        urlPattern.lastIndex = 0;
        let match;
        let last = 0;
        let changed = false;
        const fragment = document.createDocumentFragment();
        while ((match = urlPattern.exec(value))) {
          let url = match[0];
          let trailing = '';
          while (/[),.!?;:]$/.test(url)) {
            trailing = url.slice(-1) + trailing;
            url = url.slice(0, -1);
          }
          if (!url) continue;
          changed = true;
          if (match.index > last) fragment.appendChild(document.createTextNode(value.slice(last, match.index)));
          const link = document.createElement('a');
          link.className = 'chat-text-link';
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = url;
          fragment.appendChild(link);
          if (trailing) fragment.appendChild(document.createTextNode(trailing));
          last = match.index + match[0].length;
        }
        if (!changed) return;
        if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last)));
        node.replaceWith(fragment);
      });
    });
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
    // Bind the GM arcade from the authoritative app boot as well as its own
    // module boot. GMMinigames.init is idempotent, so this closes the timing
    // gap seen in cached Electron sessions without duplicating listeners.
    window.GMMinigames?.init?.();
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
    document.getElementById('bice-asoc-btn')?.addEventListener('click', () => this.triggerBiceAsoc());
    document.getElementById('recount-btn')?.addEventListener('click', () => this.triggerRecount());
    Recount.onChange(() => this.updateRecountButton());

    document.getElementById('library-btn').addEventListener('click', () => Forge.open());
    document.getElementById('library-btn-footer').addEventListener('click', () => ControlSurfaces.toggle());
    // MUTE SOUNDS: a local device preference, never game state. The central
    // audio engine (js/audio.js) enforces it and persists it.
    const soundToggle = document.getElementById('sound-toggle-btn');
    const renderSoundToggle = () => {
      if (!soundToggle) return;
      const muted = window.AsocAudio?.isMuted?.() === true;
      soundToggle.textContent = muted ? 'MUTE SOUNDS' : 'SOUNDS ON';
      soundToggle.setAttribute('aria-pressed', muted ? 'true' : 'false');
      soundToggle.classList.toggle('is-muted', muted);
      soundToggle.title = muted ? 'Sounds are muted // click to turn them back on' : 'Mute every ASOC sound on this device';
    };
    soundToggle?.addEventListener('click', () => window.AsocAudio?.toggleMuted?.());
    window.addEventListener('asoc:audio-changed', renderSoundToggle);
    renderSoundToggle();
    this.setupMasterAccess();
    document.getElementById('new-game-btn').addEventListener('click', () => Forge.open().then(() => Forge.openCreator(null, true)));
    document.getElementById('next-game-btn').addEventListener('click', () => Forge.open());
    document.getElementById('finish-game-btn')?.addEventListener('click', () => {
      if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
        this.send({ type: 'gm:finishGame' });
      }
    });

    document.getElementById('room-mode-casual-btn').addEventListener('click', () => {
      this.setRoomMode('CASUAL');
    });
    document.getElementById('room-mode-battle-btn').addEventListener('click', () => {
      this.setRoomMode('BATTLE');
    });

    // SHADOW BROKER free-form broadcast -- presentation layer only, see
    // handleGmBroadcast in server.js. Enter submits (native form submit),
    // same as the player's own chat-form.
    this.bindGMOnlinePresence();

    const shadowBrokerForm = document.getElementById('shadow-broker-form');
    const shadowBrokerInput = document.getElementById('shadow-broker-input');
    const shadowBrokerComposer = this.getGMComposerElement();
    const gmMentionPicker = this.ensureGMMentionPicker(shadowBrokerForm);
    const gmCommandPicker = document.createElement('div');
    gmCommandPicker.id = 'gm-command-picker';
    gmCommandPicker.className = 'gm-command-picker';
    gmCommandPicker.hidden = true;
    shadowBrokerForm?.appendChild(gmCommandPicker);
    let gmCommandCandidates = [];
    let gmCommandIndex = 0;
    const updateGMCommandPicker = () => {
      const text = this.getGMComposerText();
      const commandFragment = text.match(/^\/([^\s]*)$/)?.[1]?.toLowerCase();
      gmCommandCandidates = commandFragment === undefined ? [] : this.gmSlashCommands.filter(command => command.name.startsWith(commandFragment));
      if (!gmCommandCandidates.length) { gmCommandPicker.hidden = true; return; }
      gmCommandIndex = Math.max(0, Math.min(gmCommandIndex, gmCommandCandidates.length - 1));
      gmCommandPicker.innerHTML = '<div class="gm-command-picker-head">SHADOW BROKER COMMANDS</div>' + gmCommandCandidates.map((command, index) => `<button type="button" class="gm-command-option${index === gmCommandIndex ? ' active' : ''}" data-command-index="${index}"><span>${command.icon}</span><b>${command.label}</b><small>${command.description}</small></button>`).join('');
      gmCommandPicker.hidden = false;
      this.closeGMMentionPicker(gmMentionPicker);
    };
    const selectGMCommand = index => {
      const command = gmCommandCandidates[Number(index)];
      if (!command) return;
      this.setGMComposerText(command.insert, command.insert.length);
      gmCommandPicker.hidden = true;
      shadowBrokerComposer?.focus();
    };
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
    const gmPollDuration = document.getElementById('gm-poll-duration');

    let gmGifPicker = document.getElementById('gm-gif-picker');
    if (!gmGifPicker && gmAttachmentWrap) {
      gmGifPicker = document.createElement('div');
      gmGifPicker.id = 'gm-gif-picker';
      gmGifPicker.className = 'gm-gif-picker';
      gmGifPicker.hidden = true;
      gmGifPicker.innerHTML = `
        <div class="gm-gif-picker-head">
          <div><b>GIF // ASOC NETWORK</b><small>GIPHY LINK</small></div>
          <button type="button" data-gm-gif-close aria-label="Close GIF browser">×</button>
        </div>
        <div class="gm-gif-search-row">
          <input type="search" maxlength="60" autocomplete="off" spellcheck="false" placeholder="Search GIFs..." data-gm-gif-search>
        </div>
        <div class="gm-gif-status" data-gm-gif-status>TRENDING // STANDBY</div>
        <div class="gm-gif-grid" data-gm-gif-grid></div>
        <div class="gm-gif-actions">
          <button type="button" data-gm-gif-upload>UPLOAD GIF</button>
          <button type="button" data-gm-gif-more hidden>LOAD MORE</button>
        </div>
        <div class="gm-gif-provider"><span>Powered by GIPHY</span><b data-gm-gif-quota>GIF API // -- / 90</b></div>
      `;
      gmAttachmentWrap.appendChild(gmGifPicker);
    }
    const gmGifSearchInput = gmGifPicker?.querySelector('[data-gm-gif-search]');
    const gmGifStatus = gmGifPicker?.querySelector('[data-gm-gif-status]');
    const gmGifGrid = gmGifPicker?.querySelector('[data-gm-gif-grid]');
    const gmGifMoreButton = gmGifPicker?.querySelector('[data-gm-gif-more]');
    const gmGifQuota = gmGifPicker?.querySelector('[data-gm-gif-quota]');
    let gmGifResults = [];
    let gmGifOffset = 0;
    let gmGifMode = 'trending';
    let gmGifLoading = false;
    let gmGifSearchTimer = null;

    const setGMGifStatus = (text, danger = false) => {
      if (!gmGifStatus) return;
      gmGifStatus.textContent = text;
      gmGifStatus.classList.toggle('is-danger', danger);
    };

    const closeGMGifPicker = () => {
      if (!gmGifPicker) return;
      gmGifPicker.hidden = true;
      clearTimeout(gmGifSearchTimer);
    };

    const renderGMGifResults = () => {
      if (!gmGifGrid) return;
      gmGifGrid.replaceChildren();
      gmGifResults.forEach((gif, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gm-gif-result';
        button.dataset.gmGifIndex = String(index);
        button.title = gif.title || 'GIF';
        const img = document.createElement('img');
        img.src = gif.previewUrl;
        img.alt = gif.title || 'GIF';
        img.loading = 'lazy';
        button.appendChild(img);
        gmGifGrid.appendChild(button);
      });
    };

    const loadGMGifPage = async ({ append = false } = {}) => {
      if (!gmGifPicker || gmGifLoading) return;
      const query = String(gmGifSearchInput?.value || '').trim();
      if (query.length === 1) {
        setGMGifStatus('TYPE AT LEAST 2 CHARACTERS');
        return;
      }
      gmGifMode = query.length >= 2 ? 'search' : 'trending';
      if (!append) gmGifOffset = 0;
      gmGifLoading = true;
      gmGifMoreButton?.setAttribute('disabled', 'disabled');
      setGMGifStatus(gmGifMode === 'search' ? 'SEARCHING // ' + query.toUpperCase() : 'TRENDING // ACQUIRING');
      try {
        const token = GameData.gmToken || sessionStorage.getItem('asoc_gm_token') || '';
        const params = new URLSearchParams({ offset: String(gmGifOffset), limit: '12' });
        if (gmGifMode === 'search') params.set('q', query);
        const response = await fetch('/api/gif/' + gmGifMode + '?' + params.toString(), {
          headers: { 'x-gm-token': token }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (payload.code === 'GIF_LIMIT_REACHED') {
            setGMGifStatus('FUCK OFF, LIMIT REACHED', true);
            if (gmGifMoreButton) gmGifMoreButton.hidden = true;
            if (gmGifQuota && payload.quota) gmGifQuota.textContent = 'GIF API // ' + payload.quota.globalUsed + ' / ' + payload.quota.globalLimit;
            return;
          }
          throw new Error(payload.message || payload.error || 'GIF NETWORK // OFFLINE');
        }
        const incoming = Array.isArray(payload.results) ? payload.results : [];
        gmGifResults = append ? gmGifResults.concat(incoming) : incoming;
        gmGifOffset = Number(payload.pagination?.nextOffset) || (gmGifOffset + incoming.length);
        renderGMGifResults();
        if (gmGifMoreButton) gmGifMoreButton.hidden = payload.pagination?.hasMore !== true;
        if (gmGifQuota && payload.quota) gmGifQuota.textContent = 'GIF API // ' + payload.quota.globalUsed + ' / ' + payload.quota.globalLimit;
        setGMGifStatus(gmGifMode === 'search' ? 'RESULTS // ' + gmGifResults.length : 'TRENDING // ' + gmGifResults.length);
      } catch (error) {
        setGMGifStatus(error.message || 'GIF NETWORK // OFFLINE', true);
      } finally {
        gmGifLoading = false;
        gmGifMoreButton?.removeAttribute('disabled');
      }
    };

    const openGMGifPicker = () => {
      closeGMAttachmentMenu();
      closeGMPollComposer();
      if (!gmGifPicker) return gmGifInput?.click();
      gmGifPicker.hidden = false;
      gmGifSearchInput?.focus();
      if (!gmGifResults.length) loadGMGifPage({ append: false });
    };

    gmGifPicker?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.target.closest('[data-gm-gif-close]')) {
        closeGMGifPicker();
        return;
      }
      if (event.target.closest('[data-gm-gif-upload]')) {
        closeGMGifPicker();
        gmGifInput?.click();
        return;
      }
      if (event.target.closest('[data-gm-gif-more]')) {
        loadGMGifPage({ append: true });
        return;
      }
      const resultButton = event.target.closest('[data-gm-gif-index]');
      if (!resultButton) return;
      const gif = gmGifResults[Number(resultButton.dataset.gmGifIndex)];
      if (!gif || !this.ws || this.ws.readyState !== 1) return;
      this.send({ type: 'chat:gif', gif });
      closeGMGifPicker();
    });

    gmGifSearchInput?.addEventListener('input', () => {
      clearTimeout(gmGifSearchTimer);
      gmGifSearchTimer = setTimeout(() => {
        gmGifResults = [];
        loadGMGifPage({ append: false });
      }, 500);
    });

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
      closeGMGifPicker();
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
        closeGMGifPicker();
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
        openGMGifPicker();
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
        allowMultiple: gmPollMultiple?.checked === true,
        durationSeconds: Number(gmPollDuration?.value || 0)
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
        closeGMGifPicker();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeGMAttachmentMenu();
        closeGMPollComposer();
        closeGMGifPicker();
      }
    });

    const setGMMediaBusy = (busy) => {
      if (!gmImageButton) return;
      gmImageButton.disabled = !!busy;
      gmImageButton.classList.toggle('is-uploading', !!busy);
      if (busy) gmImageButton.setAttribute('aria-busy', 'true');
      else gmImageButton.removeAttribute('aria-busy');
    };

    const uploadGMChatMedia = async (file, caption = '') => {
      if (!file) return;
      const type = String(file.type || '').toLowerCase();
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(type)) {
        throw new Error('PNG, JPG, WEBP or GIF images only.');
      }
      if (file.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.');
      const token = GameData.gmToken || sessionStorage.getItem('asoc_gm_token') || '';
      setGMMediaBusy(true);
      try {
        const res = await fetch('/api/chat/image?caption=' + encodeURIComponent(caption), {
          method: 'POST',
          headers: { 'Content-Type': type, 'x-gm-token': token },
          body: file
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'Image upload failed');
        return result;
      } finally {
        setGMMediaBusy(false);
      }
    };

    const uploadGMChatMediaUrl = async (imageUrl, caption = '') => {
      const token = GameData.gmToken || sessionStorage.getItem('asoc_gm_token') || '';
      setGMMediaBusy(true);
      try {
        const res = await fetch('/api/chat/image-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-gm-token': token },
          body: JSON.stringify({ url: imageUrl, caption })
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'Image link import failed');
        return result;
      } finally {
        setGMMediaBusy(false);
      }
    };

    this._gmMediaComposer?.clear?.();
    this._gmMediaComposer = window.ChatMediaComposer?.create?.({
      form: shadowBrokerForm,
      shellSelector: '.gm-composer-shell',
      getCaption: () => this.syncGMComposerModel().text,
      clearCaption: () => this.setGMComposerText('', 0),
      focus: () => shadowBrokerComposer?.focus(),
      uploadFile: uploadGMChatMedia,
      uploadUrl: uploadGMChatMediaUrl
    }) || null;

    gmImageInput?.addEventListener('change', () => {
      const file = gmImageInput.files?.[0];
      gmImageInput.value = '';
      if (file) this._gmMediaComposer?.stageFile?.(file);
    });

    gmGifInput?.addEventListener('change', () => {
      const file = gmGifInput.files?.[0];
      gmGifInput.value = '';
      if (file) this._gmMediaComposer?.stageFile?.(file);
    });

    shadowBrokerComposer?.addEventListener('keydown', (e) => {
      this.syncGMComposerModel();
      if (!gmCommandPicker.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); gmCommandIndex = (gmCommandIndex + (e.key === 'ArrowDown' ? 1 : -1) + gmCommandCandidates.length) % gmCommandCandidates.length; updateGMCommandPicker(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectGMCommand(gmCommandIndex); return; }
        if (e.key === 'Escape') { e.preventDefault(); gmCommandPicker.hidden = true; return; }
      }
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
      updateGMCommandPicker();
    });

    shadowBrokerComposer?.addEventListener('click', () => {
      this.syncGMComposerModel();
      this.updateGMMentionPicker(shadowBrokerInput, gmMentionPicker);
      updateGMCommandPicker();
    });

    shadowBrokerComposer?.addEventListener('paste', (e) => {
      if (this._gmMediaComposer?.handlePaste?.(e)) {
        this.syncGMComposerModel();
        this.closeGMMentionPicker(gmMentionPicker);
        return;
      }
      e.preventDefault();
      const plain = e.clipboardData?.getData('text/plain') || '';
      this.insertGMComposerPlainText(plain);
      this.syncGMComposerModel();
      this.updateGMMentionPicker(shadowBrokerInput, gmMentionPicker);
    });

    shadowBrokerComposer?.addEventListener('drop', (e) => {
      if (this._gmMediaComposer?.handleDrop?.(e)) return;
      e.preventDefault();
    });

    gmMentionPicker?.addEventListener('mousedown', (e) => e.preventDefault());
    gmMentionPicker?.addEventListener('click', (e) => {
      const option = e.target.closest('.gm-chat-mention-option');
      if (!option) return;
      this.selectGMMention(option.dataset.mentionIndex || 0, shadowBrokerInput, gmMentionPicker);
    });
    gmCommandPicker.addEventListener('mousedown', e => e.preventDefault());
    gmCommandPicker.addEventListener('click', e => { const option = e.target.closest('[data-command-index]'); if (option) selectGMCommand(option.dataset.commandIndex); });

    const gmEmojiToggle = document.getElementById('gm-emoji-toggle');
    const gmEmojiPicker = document.getElementById('gm-emoji-picker');
    const gmReactionPicker = document.getElementById('gm-chat-reaction-picker');
    const gmReactionDetails = document.getElementById('gm-chat-reaction-details');
    const gmContextMenu = document.getElementById('gm-chat-context-menu');
    if (gmReactionPicker && gmReactionPicker.parentElement !== document.body) document.body.appendChild(gmReactionPicker);
    if (gmContextMenu && gmContextMenu.parentElement !== document.body) document.body.appendChild(gmContextMenu);
    gmReactionDetails?.addEventListener('click', (e) => {
      const close = e.target.closest('[data-reaction-close]');
      if (close) { gmReactionDetails.hidden = true; return; }
      const tab = e.target.closest('[data-reaction-filter]');
      if (!tab) return;
      const emoji = tab.dataset.reactionFilter || '';
      gmReactionDetails.querySelectorAll('.chat-reaction-detail-tab').forEach(node => node.classList.toggle('active', node === tab));
      gmReactionDetails.querySelectorAll('.chat-reaction-detail-person').forEach(node => node.classList.toggle('filtered', node.dataset.reactionEmoji !== emoji));
    });
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
      const deleteButton = gmContextMenu.querySelector('[data-gm-chat-action="delete"]');
      if (deleteButton) deleteButton.hidden = !this.gmMessageDeletable(messageId);
      const chatMessage = this.chatMessages.find(item => item.id === messageId);
      const tributeButton = gmContextMenu.querySelector('[data-gm-chat-action="tribute"]');
      const cancelTributeButton = gmContextMenu.querySelector('[data-gm-chat-action="tribute-cancel"]');
      if (tributeButton) tributeButton.hidden = !chatMessage?.imageUrl || !!chatMessage?.bloodTribute;
      if (cancelTributeButton) cancelTributeButton.hidden = !chatMessage?.bloodTribute?.active;
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
        const gifPicker = document.getElementById('gm-gif-picker');
        if (gifPicker) gifPicker.hidden = true;
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
      if (action === 'delete') {
        if (!this.gmMessageDeletable(messageId)) {
          this.gmChatToast?.('Cannot delete that transmission');
          return;
        }
        this.send({ type: 'chat:delete', messageId });
        return;
      }
      if (action === 'tribute') { this.openBloodTributeConfirmation(messageId); return; }
      if (action === 'tribute-cancel') { this.send({ type: 'gm:bloodTributeCancel', messageId }); return; }
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
      if (this._gmChatProgrammaticScroll) {
        closeGMContextMenu();
        return;
      }
      const { scrollTop, scrollHeight, clientHeight } = gmChatContainer;
      this.userScrolledUp = (scrollTop + clientHeight) < (scrollHeight - 80);
      if (!this.userScrolledUp && this._gmNewMessageCount) {
        this._gmNewMessageCount = 0;
        this._gmUnreadChat = 0;
        this._gmUnreadSystem = 0;
        this.updateGMNewMessageChip();
      }
      closeGMContextMenu();
    }, { passive:true });


    document.getElementById('gm-chat-new-messages')?.addEventListener('click', () => {
      this.jumpToLatestGMChat();
    });
    document.getElementById('gm-deny-all-btn')?.addEventListener('click', () => this.handleDenyAllClick());
    document.getElementById('final-panel-reopen-btn')?.addEventListener('click', () => this.openFinalPanel());

    document.getElementById('womf-subtract-btn')?.addEventListener('click', () => this.declareWomfSubtract());
    document.getElementById('womf-reset-btn')?.addEventListener('click', () => this.declareWomfReset());
    document.getElementById('blood-tribute-vault-clear')?.addEventListener('click', () => this.clearBloodTributeVault());
    document.getElementById('blood-tribute-override-btn')?.addEventListener('click', () => this.overrideBloodTribute());
    document.querySelectorAll('[data-vault-close]').forEach(button => button.addEventListener('click', () => this.closeBloodTributeVault()));
    document.querySelector('[data-vault-viewer-close]')?.addEventListener('click', () => { document.getElementById('blood-vault-viewer').hidden = true; });
    document.querySelectorAll('[data-vault-view]').forEach(button => button.addEventListener('click', () => { this._vaultView = button.dataset.vaultView; this.renderBloodTributeVault(); }));
    document.getElementById('blood-vault-player-filter')?.addEventListener('change', () => this.renderBloodTributeVault());
    document.getElementById('blood-vault-session-filter')?.addEventListener('change', () => this.renderBloodTributeVault());
    document.getElementById('blood-vault-date-filter')?.addEventListener('change', () => this.renderBloodTributeVault());
    document.getElementById('blood-vault-grid')?.addEventListener('click', e => {
      const card = e.target.closest('[data-vault-id]');
      if (!card) return;
      const tribute = this.bloodTributes.find(item => item.id === card.dataset.vaultId);
      if (!tribute) return;
      if (e.target.closest('.blood-vault-reliquary')) {
        this.send({ type: 'gm:tributeVaultUpdate', id: tribute.id, action: 'reliquary', value: !tribute.reliquary });
      } else if (e.target.closest('.blood-vault-image')) {
        this.send({ type: 'gm:tributeVaultUpdate', id: tribute.id, action: 'viewed' });
        this.openBloodTributeImage(tribute);
      }
    });
    document.getElementById('blood-tribute-vault-list')?.addEventListener('click', e => {
      const preview = e.target.closest('[data-vault-preview-id]');
      if (!preview) return;
      const tribute = this.bloodTributes.find(item => item.id === preview.dataset.vaultPreviewId);
      if (tribute) this.openBloodTributeImage(tribute);
    });
    document.getElementById('blood-tribute-confirm')?.addEventListener('click', e => {
      const action = e.target.closest('[data-tribute-confirm]')?.dataset.tributeConfirm;
      if (!action) return;
      const overlay = document.getElementById('blood-tribute-confirm');
      if (action === 'accept' && overlay.dataset.messageId) this.send({ type: 'gm:bloodTributeMark', messageId: overlay.dataset.messageId });
      overlay.hidden = true; delete overlay.dataset.messageId;
    });
    document.getElementById('alltime-toggle-btn')?.addEventListener('click', () => this.toggleAllTimeView());
    document.getElementById('womf-open-btn')?.addEventListener('click', () => this.openWomf());

    document.getElementById('wheel-setup-close')?.addEventListener('click', () => this.closeWheelSetup());
    document.getElementById('wheel-setup-confirm')?.addEventListener('click', () => this.confirmWheelSetup());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeGMContextMenu();
        this.closeGMMentionPicker(gmMentionPicker);
        gmCommandPicker.hidden = true;
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
      if (!gmCommandPicker.hidden && !shadowBrokerForm?.contains(e.target)) gmCommandPicker.hidden = true;

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
        e.stopPropagation();
        this.openGMReactionDetails(gmReactionChip.dataset.messageId || '', gmReactionChip.dataset.emoji || '', gmReactionChip);
      }

      const gmReactionAdd = e.target.closest('.gm-chat-reaction-add');
      if (gmReactionAdd) {
        this.openGMChatReactionPicker(gmReactionAdd.dataset.messageId || '', { x: e.clientX, y: e.clientY });
      }

      const gmSeenChip = e.target.closest('.gm-chat-seen-chip');
      if (gmSeenChip) {
        e.stopPropagation();
        const opened = this.openGMSeenPopover(gmSeenChip.dataset.messageId || '', gmSeenChip);
        if (opened) {
          e.preventDefault();
        } else {
          this.closeGMSeenPopover();
        }
      }

      const gmSeenPopover = document.getElementById('gm-chat-seen-popover');
      if (gmSeenPopover && !gmSeenPopover.hidden && !gmSeenPopover.contains(e.target) && !e.target.closest('.gm-chat-seen-chip')) {
        gmSeenPopover.hidden = true;
      }

      const gmReactionDetails = document.getElementById('gm-chat-reaction-details');
      if (gmReactionDetails && !gmReactionDetails.hidden && !gmReactionDetails.contains(e.target) && !e.target.closest('.gm-chat-reaction-chip')) {
        gmReactionDetails.hidden = true;
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
        const messageId = btn.dataset.messageId || this.pendingVerdict;
        if (!messageId || !target || btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('is-submitting');
        this.confirmCorrectVerdict(messageId, target);
        return;
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

    this._protocolReady = false;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[GM] WebSocket connected');
      document.querySelector('.gm-module-chat .gm-chat-panel')?.classList.remove('is-reconnecting');
      this.reconnectAttempts = 0;
      this._victoryBaselined = false;
      this._columnCascadeBaselined = false;
      this._columnCascadeStarts = {};
      if (window.Board) Board._columnCascadeStarts = {};
      this.setGMDeliveryState('CONNECTED', 'delivered', 1400);
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
      document.querySelector('.gm-module-chat .gm-chat-panel')?.classList.add('is-reconnecting');
      this.setGMDeliveryState('RECONNECTING', 'queued');
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

  triggerBiceAsoc() {
    if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
      this.send({ type: 'gm:biceAsoc' });
      return;
    }
    Skeleton.playBiceAsoc?.();
  },

  triggerOmen() {
    if (!['BATTLE_ARMED', 'BATTLE'].includes(this.roomMode)) return;
    if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
      this.send({ type: 'gm:omen' });
      return;
    }
    Skeleton.playOmen?.();
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
    btn.textContent = 'RECOUNT';
    // The first results transition is no longer a free-standing SHOW RESULTS
    // action. FINISH GAME launches the story, and the story's CONTINUE advances
    // into RECOUNT. This button exists only to reopen an already-built recount.
    btn.style.display = has ? '' : 'none';
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
      matchWinner: { name: 'TEST SUBJECT', points: 0 },
      story: game.story || ''
    } });
  },

  setGameComplete(complete) {
    this.gameComplete = complete === true;
    document.body.classList.toggle('game-complete', this.gameComplete);
    this.updateFinalPanelReopen?.();
    this.updateDenyAllButton?.();
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
    if (!lost) {
      document.querySelector('.defeat-overlay:not(.is-test-preview)')?.remove();
    } else if (live) {
      Skeleton.playGameLost(matchResult, {
        live: true,
        isHost: true,
        afterMatch: false,
        onAftermathContinue: () => {
          if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
            this.send({ type: 'gm:showRecount' });
          } else {
            Skeleton.closeAftermath?.();
          }
        }
      });
    } else if (changed && !document.querySelector('.defeat-overlay')) {
      Skeleton.playGameLost(matchResult, { live: false });
    }
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
    const overlay = Skeleton.playGameLost(result, { live: true, afterMatch: false });
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
        isHost: true,
        afterMatch: false,
        onAftermathContinue: () => {
          if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
            this.send({ type: 'gm:showRecount' });
          } else {
            Skeleton.closeAftermath?.();
          }
        },
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

    // Column outcome adjudication is intentionally server-authoritative.
    // GREEN/RED can affect WOMF, match completion and Final scoring context,
    // so do not fabricate it optimistically and risk leaving stale local
    // state if a concurrent authoritative action rejects the command.
    if (command !== 'resolveColumn') {
      this.executeLocalCommand(command, payload);
    }
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
      case 'resolveColumn': {
        const { column, outcome } = payload || {};
        if (!['A', 'B', 'C', 'D'].includes(column) || !['success', 'failed'].includes(outcome)) break;
        if (outcome === 'success') {
          // Mirror the authoritative GREEN behavior locally and start the same
          // visual cascade used by multiplayer clients.
          const cascadeStart = Date.now();
          this._columnCascadeStarts[column] = cascadeStart;
          Board.startColumnCascade(column, cascadeStart);
          if (Board.revealColumn(column)) changed = true;
        } else if (Board.setRevealed(column, 5, true)) {
          // RED only reveals the solution pill; clues should already be open.
          changed = true;
        }
        Board.sessionState.cellOutcomes ||= {};
        if (Board.sessionState.cellOutcomes[`${column}5`] !== outcome) {
          Board.sessionState.cellOutcomes[`${column}5`] = outcome;
          Board.render();
          changed = true;
        }
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
        localStorage.setItem('asoc_master_host_token', this.hostToken);
        break;

      case 'host:reconnected':
        this._reconnectPending = false;
        this.roomCode = message.roomCode;
        this.mode = 'multiplayer';
        sessionStorage.setItem('asoc_host_token', this.hostToken);
        localStorage.setItem('asoc_master_host_token', this.hostToken);
        this.updateMultiplayerUI();
        this.resendPendingCommands();
        break;

      case 'host:recovered':
        this._recoverPending = false;
        this.roomCode = message.roomCode;
        this.hostToken = message.hostToken;
        this.mode = 'multiplayer';
        sessionStorage.setItem('asoc_host_token', this.hostToken);
        localStorage.setItem('asoc_master_host_token', this.hostToken);
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
          Skeleton.closeAftermath?.();
          this.setGameWon(false);
          this.setGameComplete(false);
          Recount.apply(null);
          this._lastAnnouncedStreak = {};
          this.updateFailFinalButtonVisibility();
          this.buildGMControls();
          // Gold solution words follow the loaded board's answers.
          if (Array.isArray(this.chatMessages)) this.renderGMChat();
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
        this.iksArena = message.iksArena || null;
        this.updatePlayerList(message.players);
        this.renderGMOnlinePresence(message.players || []);
        window.GMMinigames?.onArena?.();
        window.AsocAlerts?.gmPlayers(message.players);
        break;

      case 'ritual:gmUpdate':
        this.updateRitualUI(message.ritual);
        break;

      case 'kaladont:state':
        window.GMMinigames?.onKaladont?.(message.state || null);
        break;
      case 'threefold:challenge':
        window.GMMinigames?.onChallenge?.(message);
        window.AsocAlerts?.threefold?.(message, '__GM__');
        break;
      case 'threefold:declined': window.GMMinigames?.onDeclined?.(message); break;
      case 'threefold:state':
        window.GMMinigames?.onState?.(message);
        window.AsocAlerts?.threefold?.(message, '__GM__');
        break;
      case 'threefold:closed': window.GMMinigames?.onClosed?.(message); break;
      case 'unstableConcoction:started': window.GMMinigames?.onConcoctionStarted?.(message); break;
      case 'unstableConcoction:resolved': window.GMMinigames?.onConcoctionResolved?.(message); break;
      case 'unstableConcoction:locked': window.GMMinigames?.updateConcoction?.({ cooldownUntil:message.cooldownUntil, spinning:false }); break;

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

      case 'match:aftermath': {
        document.querySelector('.victory-overlay')?.remove();
        document.querySelector('.defeat-overlay')?.remove();
        const finishBtn = document.getElementById('finish-game-btn');
        if (finishBtn) finishBtn.style.display = 'none';
        Skeleton.playAftermath(message.result || {}, {
          isHost: true,
          onContinue: () => {
            if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
              this.send({ type: 'gm:showRecount' });
            } else {
              Skeleton.closeAftermath?.();
            }
          }
        });
        break;
      }

      case 'recount:update':
        // AFTERMATH owns the screen until the Shadow Broker advances. The
        // server's RECOUNT broadcast is the authoritative dismissal signal for
        // every client, so nobody can wander into results ahead of the room.
        if (message.recount) {
          document.querySelector('.victory-overlay')?.remove();
          document.querySelector('.defeat-overlay')?.remove();
          Skeleton.closeAftermath?.();
        }
        Recount.apply(message.recount, { live: message.live === true });
        break;

      case 'leaderboard:allTime':
        this.renderAllTimeLeaderboard(message.players || []);
        break;

      case 'tribute:vault':
        this.bloodTributes = Array.isArray(message.tributes) ? message.tributes : [];
        this.renderBloodTributeVault();
        break;

      case 'tribute:vaultAccess':
        if (message.granted) {
          this._vaultView = 'reliquary';
          this.openBloodTributeVault();
        } else {
          this.signalReliquaryAccessDenied(message.locked === true);
        }
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
          window.AsocAlerts?.gmChat(newMessages);
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
            this._gmUnreadSystem += newMessages.filter(m => this.isPriorityChatMessage(m)).length + verdictUpdates.length;
            this._gmUnreadChat += newMessages.filter(m => !this.isPriorityChatMessage(m)).length;
            this.updateGMNewMessageChip();
          }

          const priority = [...newMessages.filter(m => this.isPriorityChatMessage(m)), ...verdictUpdates];
          if (priority.length) this.showGMChatPriority(priority.at(-1));
          if (newMessages.length >= 4) {
            const panel = document.querySelector('.gm-chat-panel');
            panel?.classList.add('chat-high-traffic');
            clearTimeout(this._gmHighTrafficTimer);
            this._gmHighTrafficTimer = setTimeout(() => panel?.classList.remove('chat-high-traffic'), 5000);
          }

          const newBrokerMsg = newMessages.find(m => m.source === 'shadowBroker');
          if (newBrokerMsg) {
            this.setGMDeliveryState('DELIVERED', 'delivered', 1800);
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
        this.updateFailFinalButtonVisibility();
        break;
      }

      case 'shadowBroker:clear':
        this.clearShadowBrokerBoardLine();
        Board.clearShadowBrokerBoardLine();
        break;

      case 'nemaAsoc':
        Skeleton.playNemaAsoc();
        break;

      case 'biceAsoc':
        Skeleton.playBiceAsoc?.(message.line);
        break;

      case 'board:omen':
        Skeleton.playOmen?.();
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

      case 'gm:denyAll:ack':
        console.log('[GM] DENY ALL:', message.denied);
        break;

      case 'auth:required':
        localStorage.removeItem('asoc_master_token');
        localStorage.removeItem('asoc_master_host_token');
        sessionStorage.removeItem('asoc_master_persona');
        sessionStorage.removeItem('asoc_gm_token');
        sessionStorage.removeItem('asoc_host_token');
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
    const nextRoomMode = state.roomMode || (state.armed === true ? 'BATTLE_ARMED' : 'CASUAL');
    const battleVisible = nextRoomMode !== 'CASUAL';
    const wasBattleVisible = this.roomMode !== 'CASUAL';
    this.applyRoomMode(nextRoomMode);
    window.GMMinigames?.updateConcoction?.(battleVisible ? null : state.unstableConcoction);
    if (battleVisible) window.AsocAudio?.syncBoard?.('gm', state);
    else window.AsocAudio?.resetObservers?.();

    // Detect only a fresh authoritative GREEN transition. The first state
    // after connect/reconnect is baseline data and must never replay a solved
    // column's cascade.
    const cascadeNow = Date.now();
    ['A', 'B', 'C', 'D'].forEach(column => {
      const previousOutcome = Board.getCellOutcome(column, 5);
      const nextOutcome = state.cells?.[`${column}5`]?.outcome || null;
      if (battleVisible && this._columnCascadeBaselined && previousOutcome !== 'success' && nextOutcome === 'success') {
        this._columnCascadeStarts[column] = cascadeNow;
        Board.startColumnCascade(column, cascadeNow);
      }
    });
    if (battleVisible) {
      this._columnCascadeBaselined = true;
    } else {
      this._columnCascadeBaselined = false;
      this._columnCascadeStarts = {};
      if (window.Board) Board._columnCascadeStarts = {};
    }
    // Victory is authoritative server state. Play the live sequence only on
    // a false->true flip AFTER this connection's baseline state; the baseline
    // itself (first state after load/reconnect) just renders the completed
    // state. Late joiners and refreshes therefore never replay it.
    const victoryNow = battleVisible && state.gameWon === true;
    const victoryLive = this._victoryBaselined && !this.gameWon && victoryNow;
    this._victoryBaselined = true;
    this.setGameWon(victoryNow, { play: victoryLive, result: battleVisible ? (state.matchResult || null) : null });
    this.applyLossState(battleVisible ? (state.matchResult || null) : null);
    this.setGameComplete(battleVisible && state.gameComplete === true);
    const finishGameBtn = document.getElementById('finish-game-btn');
    if (finishGameBtn) {
      finishGameBtn.style.display = battleVisible
        && nextRoomMode !== 'RECOUNT'
        && state.gameComplete === true
        && state.aftermathStarted !== true
        ? ''
        : 'none';
    }
    // Reconnect/refresh/restart while the AFTERMATH phase is stored but not yet
    // advanced: FINISH GAME is done, the typewriter must NOT replay, and the
    // host still needs its CONTINUE to reach RECOUNT. Re-mount the aftermath
    // already-complete -- the story was persisted on the ledger exactly so
    // this hydration can restore the phase without replaying it.
    if (state.gameComplete === true
        && state.aftermathStarted === true
        && state.resultsShown !== true
        && !Recount.has()
        && !document.querySelector('.aftermath-overlay')) {
      Skeleton.playAftermath(state.aftermathResult || state.matchResult || {}, {
        isHost: true,
        alreadyComplete: true,
        onContinue: () => {
          if (this.mode === 'multiplayer' && this.roomCode && this.ws?.readyState === 1) {
            this.send({ type: 'gm:showRecount' });
          }
        }
      });
    }
    if (!battleVisible) {
      // CASUAL is only a presentation layer over the still-running battle.
      // A timer may expire while the room is hidden; never let that trigger a
      // GAME LOST/WON ceremony over AMUSEMENT PARK. Returning to the battle is
      // hydration, so baseline the terminal state instead of replaying it.
      this._victoryBaselined = false;
      this._lossBaselined = false;
    }

    const wasFinalRevealed = this.finalRevealed;
    this.finalRevealed = battleVisible && state.finalSolution?.revealed === true;
    // A mistaken FINAL GREEN corrected to WRONG re-hides the Final: drop the
    // stale SOLUTION CONFIRMED banner along with it.
    if (wasFinalRevealed && !this.finalRevealed && this._activeFinalBanner) {
      this._activeFinalBanner.remove();
      this._activeFinalBanner = null;
    }
    // See _finalFlourishUntil's declaration for why this is decided here,
    // once, on the authoritative transition, rather than inside
    // updatePublicView() itself. Re-entering BATTLE from CASUAL is hydration,
    // not a fresh Final reveal, so it must not replay the flourish.
    if (battleVisible && wasBattleVisible && !wasFinalRevealed && this.finalRevealed) {
      this._finalFlourishUntil = Date.now() + 1100;
    }
    this.updateFailFinalButtonVisibility();

    this.womf = state.womf || { charge: 0, armed: false };
    this.updateWomfTracker();

    this.wheel = state.wheel || { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null };
    this.updateWheelUI();

    this.bloodTribute = state.bloodTribute || { status: 'idle' };
    this.renderBloodTributeVault();
    this.syncFinalPanelState(state, battleVisible);

    this.timer = state.timer || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 };
    this.updateTimerUI();

    this._gmRevealFlashUntil ||= {};
    Object.entries(state.cells || {}).forEach(([key, cell]) => {
      if (cell?.revealed === true && !Board.sessionState?.cells?.[key]) {
        this._gmRevealFlashUntil[key] = Date.now() + 2500;
      }
    });
    if (state.finalSolution?.revealed === true && !Board.sessionState?.finalSolution) {
      this._gmRevealFlashUntil.FINAL = Date.now() + 2500;
    }
    this.solutionCountdowns = state.solutionCountdowns || {};

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
    this.applyGMRevealFlash();
    this.renderGMSolutionCountdownBadges();
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

  applyGMRevealFlash() {
    const board = document.getElementById('asoc-board');
    if (!board) return;
    const now = Date.now();
    Object.entries(this._gmRevealFlashUntil || {}).forEach(([key, deadline]) => {
      const cell = board.querySelector(`.board-cell[data-cell="${CSS.escape(key)}"]`);
      if (!cell) return;
      if (deadline > now) {
        cell.classList.add('cell-new-reveal-flash');
        setTimeout(() => cell.classList.remove('cell-new-reveal-flash'), Math.max(0, deadline - now));
      } else {
        delete this._gmRevealFlashUntil[key];
        cell.classList.remove('cell-new-reveal-flash');
      }
    });
  },

  renderGMSolutionCountdownBadges() {
    const board = document.getElementById('asoc-board');
    if (!board) return;
    board.querySelectorAll('.solution-countdown-badge').forEach(el => el.remove());
    clearTimeout(this._gmSolutionCountdownTicker);
    const now = Date.now();
    let active = false;
    Object.values(this.solutionCountdowns || {}).forEach(entry => {
      // A paused battle freezes its countdowns: the server sends remainingMs
      // instead of a deadline, and the badge holds still until resume.
      const remaining = entry.paused
        ? Math.max(0, Number(entry.remainingMs) || 0)
        : Math.max(0, Number(entry.deadline || 0) - now);
      if (remaining <= 0) return;
      if (!entry.paused) active = true;
      const key = entry.target === 'FINAL' ? 'FINAL' : entry.target + '5';
      const cell = board.querySelector(`.board-cell[data-cell="${CSS.escape(key)}"]`);
      if (!cell) return;
      const total = Math.ceil(remaining / 1000);
      const badge = document.createElement('div');
      badge.className = 'solution-countdown-badge' + (entry.paused ? ' is-paused' : '');
      badge.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      cell.appendChild(badge);
    });
    if (active) this._gmSolutionCountdownTicker = setTimeout(() => this.renderGMSolutionCountdownBadges(), 250);
  },

  updateMultiplayerStatus(revision) {
    const status = document.getElementById('mp-status');
    if (status) status.textContent = `${this.roomMode} // rev ${revision}`;
  },


  pickBattleTransformationMessage() {
    const pool = this._battleTransformationMessages || [];
    if (!pool.length) return '';
    let index = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && index === this._battleTransformationLastIndex) {
      index = (index + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
    }
    this._battleTransformationLastIndex = index;
    return pool[index];
  },

  playRoomModeTransition(previous, next) {
    const fromCasual = previous === 'CASUAL';
    const toCasual = next === 'CASUAL';
    if (fromCasual === toCasual) return;

    const direction = toCasual ? 'casual' : 'battle';
    const active = document.querySelector('.asoc-mode-transition');
    if (active?.dataset.direction === direction) return;

    if (this._roomModeTransitionTimer) {
      clearTimeout(this._roomModeTransitionTimer);
      this._roomModeTransitionTimer = null;
    }
    if (this._battleTransformationTypingStartTimer) {
      clearTimeout(this._battleTransformationTypingStartTimer);
      this._battleTransformationTypingStartTimer = null;
    }
    if (this._battleTransformationTypingTimer) {
      clearInterval(this._battleTransformationTypingTimer);
      this._battleTransformationTypingTimer = null;
    }
    active?.remove();
    document.body.classList.remove('asoc-transition-to-battle', 'asoc-transition-to-casual');

    const battle = direction === 'battle';
    const transformationMessage = battle ? this.pickBattleTransformationMessage() : '';
    const overlay = document.createElement('div');
    overlay.className = 'asoc-mode-transition asoc-mode-transition--' + direction;
    overlay.dataset.direction = direction;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="asoc-mode-transition-grid"></div>
      <div class="asoc-mode-transition-lock-frame"></div>
      <div class="asoc-mode-transition-scan"></div>
      ${battle ? `
        <div class="asoc-mode-transition-status-stack">
          <span>TACTICAL LINK ACQUIRED</span>
          <span>CIVIL CHANNEL SUSPENDED</span>
          <span>BATTLE SYSTEMS ARMING</span>
        </div>
        <div class="asoc-mode-transition-impact"></div>
      ` : ''}
      <div class="asoc-mode-transition-core">
        <div class="asoc-mode-transition-eye"><img src="${battle ? '/assets/ui/cyber-gothic-battle-eye.png?v=1' : '/assets/ui/dormant-amuse-eye.png?v=1'}" alt=""></div>
        <div class="asoc-mode-transition-kicker">A.S.O.C. // MASTER ROOM</div>
        <div class="asoc-mode-transition-title">${battle ? 'ABUSEMENT PARK ENGAGED' : 'ABUSEMENT PARK SUSPENDED'}</div>
        <div class="asoc-mode-transition-sub">${battle ? '' : 'AMUSEMENT PARK // RESTORED'}</div>
      </div>
      ${battle ? '<div class="asoc-mode-transition-omen" aria-live="polite"></div>' : ''}
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('asoc-transition-to-' + direction);
    requestAnimationFrame(() => overlay.classList.add('is-live'));

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const holdMs = reducedMotion ? (battle ? 1800 : 300) : 7000;

    if (battle) {
      const line = overlay.querySelector('.asoc-mode-transition-omen');
      if (line) {
        if (reducedMotion) {
          line.textContent = transformationMessage;
          line.classList.add('is-typed');
        } else {
          const characters = Array.from(transformationMessage);
          const typingStartMs = 500;
          const availableTypingMs = Math.max(1200, holdMs - typingStartMs - 550);
          const characterDelay = Math.max(
            30,
            Math.min(55, Math.floor(availableTypingMs / Math.max(characters.length, 1)))
          );

          this._battleTransformationTypingStartTimer = setTimeout(() => {
            this._battleTransformationTypingStartTimer = null;
            if (!overlay.isConnected) return;

            let index = 0;
            line.classList.add('is-typing');
            this._battleTransformationTypingTimer = setInterval(() => {
              if (!overlay.isConnected) {
                clearInterval(this._battleTransformationTypingTimer);
                this._battleTransformationTypingTimer = null;
                return;
              }

              index += 1;
              line.textContent = characters.slice(0, index).join('');

              if (index >= characters.length) {
                clearInterval(this._battleTransformationTypingTimer);
                this._battleTransformationTypingTimer = null;
                line.classList.remove('is-typing');
                line.classList.add('is-typed');
              }
            }, characterDelay);
          }, typingStartMs);
        }
      }
    }

    this._roomModeTransitionTimer = setTimeout(() => {
      if (this._battleTransformationTypingStartTimer) {
        clearTimeout(this._battleTransformationTypingStartTimer);
        this._battleTransformationTypingStartTimer = null;
      }
      if (this._battleTransformationTypingTimer) {
        clearInterval(this._battleTransformationTypingTimer);
        this._battleTransformationTypingTimer = null;
      }
      overlay.classList.add('is-leaving');
      if (battle) this.playShadowBrokerBoardLine('Prepare, little heroes, for the lovely carnage.');
      document.body.classList.remove('asoc-transition-to-battle', 'asoc-transition-to-casual');
      setTimeout(() => overlay.remove(), reducedMotion ? 30 : 180);
      this._roomModeTransitionTimer = null;
    }, holdMs);
  },

  applyRoomMode(mode) {
    const allowed = new Set(['CASUAL', 'BATTLE_ARMED', 'BATTLE', 'RECOUNT']);
    const next = allowed.has(mode) ? mode : 'CASUAL';
    const previous = this.roomMode;
    const hadBaseline = this._roomModeBaselined;
    this._roomModeBaselined = true;
    this.roomMode = next;
    if (hadBaseline) this.playRoomModeTransition(previous, next);

    document.body.classList.toggle('room-mode-casual', next === 'CASUAL');
    document.body.classList.toggle('room-mode-battle-armed', next === 'BATTLE_ARMED');
    document.body.classList.toggle('room-mode-battle', next === 'BATTLE');
    document.body.classList.toggle('room-mode-recount', next === 'RECOUNT');
    document.body.dataset.roomMode = next;

    // Mini Games belong exclusively to AMUSEMENT PARK / CASUAL. An arcade
    // panel opened in Casual must never survive a transition into Battle.
    if (next !== 'CASUAL') window.GMMinigames?.leaveCasual?.();

    const brokerBar = document.getElementById('gm-broker-bar');
    const chatPanel = document.querySelector('.gm-module-chat .gm-chat-panel');
    // The transmission composer belongs to the chat rail in every room
    // mode. Keeping one stable parent also prevents a mode packet from
    // jumping the focused input back beneath the board mid-message.
    if (brokerBar && chatPanel && brokerBar.parentElement !== chatPanel) {
      chatPanel.appendChild(brokerBar);
    }

    if (next === 'CASUAL') {
      Recount.apply(null);
      window.AsocAudio?.resetObservers?.();
    }

    // Casual and Battle are the SAME transcript. Re-render ONLY on a real
    // mode transition. state:public packets also carry timer/WOMF/cell ticks;
    // rebuilding chat for those packets can replace an adjudication button
    // between pointer-down and click, making CORRECT target selection inert.
    if (previous !== next && Array.isArray(this.chatMessages)) {
      this.userScrolledUp = false;
      this.renderGMChat();
      requestAnimationFrame(() => this.jumpToLatestGMChat());
    }

    this.updateSolvedCount();
    this.updateGMLatestReadout();
    this.updateDenyAllButton();
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
    const scoringSection = document.getElementById('scoring-section');
    if (scoringSection) scoringSection.style.display = 'none';
    const tributeVaultSection = document.getElementById('blood-tribute-vault-section');
    if (tributeVaultSection) tributeVaultSection.style.display = battleSession ? 'block' : 'none';
    const recordsSection = document.getElementById('records-section');
    if (recordsSection) recordsSection.style.display = battleSession ? 'block' : 'none';
    ControlSurfaces.updateSessionSummary();
    this.updateFailFinalButtonVisibility();
    this.updateWomfControlsVisibility();

    if (isMultiplayer) {
      document.getElementById('mp-room-code').textContent = 'MASTER ROOM';
      const visibleRoomMode = this.roomMode === 'CASUAL'
        ? 'AMUSEMENT PARK'
        : this.roomMode === 'BATTLE_ARMED'
          ? 'ABUSEMENT PARK // ARMED'
          : this.roomMode === 'BATTLE'
            ? 'ABUSEMENT PARK'
            : this.roomMode;
      document.getElementById('mp-status').textContent = visibleRoomMode;
    }
  },

  renderGMOnlinePresence(players = this.currentPlayers || []) {
    const presence = document.getElementById('gm-chat-presence');
    const dropdown = document.getElementById('gm-online-dropdown');
    if (!presence || !dropdown) return;

    const onlinePlayers = (players || []).filter(player => player.connected === true);
    presence.textContent = `● ${onlinePlayers.length} ONLINE`;
    presence.classList.toggle('has-online', onlinePlayers.length > 0);

    dropdown.innerHTML = onlinePlayers.length
      ? onlinePlayers.map(player => `
          <div class="gm-online-player">
            ${this.littleHeroAvatarHTML(player, true)}
            <span>${this.escapeHtml(player.name || 'LITTLE HERO')}</span>
          </div>
        `).join('')
      : '<div class="gm-online-empty">NO LITTLE HEROES ONLINE</div>';
  },

  bindGMOnlinePresence() {
    const presence = document.getElementById('gm-chat-presence');
    const dropdown = document.getElementById('gm-online-dropdown');
    if (!presence || !dropdown || presence.dataset.bound === '1') return;
    presence.dataset.bound = '1';

    const close = () => {
      dropdown.hidden = true;
      presence.setAttribute('aria-expanded', 'false');
    };

    presence.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = dropdown.hidden;
      if (opening) this.renderGMOnlinePresence(this.currentPlayers || []);
      dropdown.hidden = !opening;
      presence.setAttribute('aria-expanded', String(opening));
    });

    dropdown.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
    });
  },

  updatePlayerList(players) {
    this.renderGMOnlinePresence(players || []);
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
    const scoringSectionEl = document.getElementById('scoring-section');
    if (scoringSectionEl) scoringSectionEl.style.display = this.mode === 'multiplayer' ? 'block' : 'none';
  },

  requestModerationReason(action, playerName) {
    const label = String(action || '').toUpperCase();
    const target = playerName || 'this Little Hero';
    return window.AsocDialog.prompt({
      title: `${label} // ${target}`,
      message: 'Enter reason (required, max 180 characters):',
      maxLength: 180,
      required: true,
      confirmLabel: label
    });
  },

  async kickPlayer(playerId, playerName) {
    if (this.mode !== 'multiplayer' || !playerId) return;
    const reason = await this.requestModerationReason('kick', playerName);
    if (!reason) return;
    if (!confirm(`Kick ${playerName || 'this Little Hero'} from the Master Room? They can manually rejoin afterwards.\n\nReason: ${reason}`)) return;
    this.send({ type: 'gm:kickPlayer', playerId, reason });
  },

  async banPlayer(playerId, playerName) {
    if (this.mode !== 'multiplayer' || !playerId) return;
    const reason = await this.requestModerationReason('ban', playerName);
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
    if (!panel) return;
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

  // Manual WOMF correction controls are multiplayer-only. Normal column
  // failure now comes from the A5-D5 RED adjudication path; this section is
  // deliberately limited to operator correction tools.
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
      // WOMF can only target Little Heroes who are actually online. The
      // server enforces the same rule so a stale or hand-crafted client
      // cannot smuggle an offline/custom identity onto the execution wheel.
      const players = (this.currentPlayers || []).filter(p => p?.connected === true);
      listEl.innerHTML = players.length > 0
        ? players.map(p => `
            <label class="wheel-setup-row">
              <input type="checkbox" class="wheel-setup-checkbox" data-player-name="${this.escapeHtmlAttr(p.name)}" checked>
              <span class="wheel-setup-name">${this.escapeHtml(p.name)}</span>
              <span class="wheel-setup-presence">● ONLINE</span>
            </label>
          `).join('')
        : '<div class="wheel-setup-hint">No Little Heroes are online. WOMF has nobody to ruin yet.</div>';
    }
    document.getElementById('wheel-setup-overlay')?.classList.add('active');
  },

  closeWheelSetup() {
    document.getElementById('wheel-setup-overlay')?.classList.remove('active');
  },

  confirmWheelSetup() {
    if (this.mode !== 'multiplayer') return;
    const checked = Array.from(document.querySelectorAll('#wheel-setup-player-list .wheel-setup-checkbox:checked'));
    const segments = checked.map(cb => cb.dataset.playerName).filter(Boolean);
    if (segments.length < 2) {
      alert('Select at least 2 online Little Heroes for the Wheel.');
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
          <button type="button" class="blood-tribute-vault-preview" data-vault-preview-id="${this.escapeHtml(t.id)}" aria-label="Open tribute from ${this.escapeHtml(t.playerName || 'Little Hero')}">
            <img src="${t.imageData}" alt="Archived tribute image">
          </button>
          <div class="blood-tribute-vault-meta">
            <strong>${this.escapeHtml(t.playerName || 'LITTLE HERO')}</strong>
            <span>${stamp} // ${publicNow ? 'PUBLIC WINDOW ACTIVE' : 'ARCHIVED'}</span>
          </div>
        </article>
      `;
    }).join('');

    if (clearBtn) clearBtn.disabled = tributes.length === 0;

    const grid = document.getElementById('blood-vault-grid');
    const playerFilter = document.getElementById('blood-vault-player-filter');
    if (!grid || !playerFilter) return;
    const selectedPlayer = playerFilter.value;
    const names = [...new Set(tributes.map(t => t.playerName).filter(Boolean))].sort();
    playerFilter.innerHTML = '<option value="">ALL PLAYERS</option>' + names.map(name => `<option value="${this.escapeHtml(name)}"${name === selectedPlayer ? ' selected' : ''}>${this.escapeHtml(name)}</option>`).join('');
    const sessionFilter = document.getElementById('blood-vault-session-filter');
    const selectedSession = sessionFilter?.value || '';
    const sessions = [...new Set(tributes.map(t => t.sessionId || 'CASUAL'))].sort();
    if (sessionFilter) sessionFilter.innerHTML = '<option value="">ALL SESSIONS</option>' + sessions.map(session => `<option value="${this.escapeHtml(session)}"${session === selectedSession ? ' selected' : ''}>${this.escapeHtml(session)}</option>`).join('');
    const dateFilter = document.getElementById('blood-vault-date-filter')?.value || '';
    const view = this._vaultView || 'recent';
    document.querySelectorAll('[data-vault-view]').forEach(button => button.classList.toggle('active', button.dataset.vaultView === view));
    const filtered = tributes.filter(t => (view !== 'reliquary' || t.reliquary) && (!selectedPlayer || t.playerName === selectedPlayer) && (!selectedSession || (t.sessionId || 'CASUAL') === selectedSession) && (!dateFilter || new Date(t.originalMessageTimestamp || t.submittedAt).toISOString().slice(0, 10) === dateFilter));
    grid.innerHTML = filtered.length ? filtered.map(t => `<article class="blood-vault-card${t.viewedByGM ? '' : ' unread'}" data-vault-id="${this.escapeHtml(t.id)}"><button type="button" class="blood-vault-image"><img src="${t.imageData}" alt="Archived Blood Tribute"></button><div><strong>${this.escapeHtml(t.playerName || 'LITTLE HERO')}</strong><span>${new Date(t.originalMessageTimestamp || t.submittedAt).toLocaleString()} // ${this.escapeHtml(t.sessionId || 'CASUAL')}</span><button type="button" class="blood-vault-reliquary">${t.reliquary ? 'REMOVE FROM RELIQUARY' : 'MOVE TO RELIQUARY'}</button></div></article>`).join('') : '<p class="blood-vault-empty">NO TRIBUTES IN THIS ARCHIVE</p>';
  },

  openBloodTributeConfirmation(messageId) {
    const overlay = document.getElementById('blood-tribute-confirm');
    if (!overlay) return;
    overlay.dataset.messageId = messageId;
    overlay.hidden = false;
  },

  openBloodTributeVault() {
    this._vaultView = this._vaultView || 'recent';
    this.renderBloodTributeVault();
    document.getElementById('blood-tribute-vault-modal').hidden = false;
  },

  closeBloodTributeVault() { document.getElementById('blood-tribute-vault-modal').hidden = true; },

  openBloodTributeImage(tribute) {
    if (!tribute?.imageData) return;
    const viewer = document.getElementById('blood-vault-viewer');
    const image = viewer?.querySelector('img');
    if (!viewer || !image) return;
    image.src = tribute.imageData;
    image.alt = `Blood Tribute from ${tribute.playerName || 'Little Hero'}`;
    viewer.hidden = false;
  },

  async requestReliquaryAccess() {
    const code = await window.AsocDialog.prompt({
      title: 'RELIQUARY // SEALED ARCHIVE',
      message: 'Enter the Reliquary access code:',
      maxLength: 32,
      required: true,
      confirmLabel: 'UNSEAL'
    });
    if (!code) return;
    if (this.mode === 'multiplayer' && this.roomCode) {
      this.send({ type: 'gm:reliquaryAccess', code: String(code).trim() });
    } else {
      this.signalReliquaryAccessDenied(false);
    }
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

  updateRitualUI(ritual) {
    this.ritual = ritual || { active: false };
    const el = document.getElementById('ritual-tracker-gm');
    if (el) el.hidden = !this.ritual.active;
    Ritual.update('ritual-tracker-gm', this.ritual, true, {
      onViewBoard: () => this.togglePublicView(true),
      onAcceptTribute: () => this.send({ type: 'ritual:tributeAccept' }),
      onRejectTribute: () => this.send({ type: 'ritual:tributeReject' }),
      onReset: () => { if (confirm('RESET RITUAL?\n\nClears every joined vote and any tribute decision. START GAME re-locks.')) this.send({ type: 'ritual:reset' }); },
      onCancel: () => { if (confirm('CANCEL RITUAL?\n\nAborts this battle attempt entirely and returns the room to AMUSEMENT PARK. This does not start Battle.')) this.send({ type: 'ritual:cancel' }); }
    });
    // The START GAME button's own ritual-lock state depends on Ritual's
    // last-received data (see ritual.js's isBlockingStart) -- re-render it
    // now so a fulfillment/un-fulfillment reflects immediately rather than
    // waiting for the next unrelated timer tick.
    this.updateTimerUI();
  },

  updateFailFinalButtonVisibility() {
    const btn = document.getElementById('declare-final-failed-btn');
    if (!btn) return;
    // Mirrors the server rule: GAME LOST stays available until players have
    // actually SOLVED the Final or the match is over. A Final the GM merely
    // revealed (REVEAL ALL / REVEAL FINAL) does not remove the button.
    const finalSettled = this.gameWon || this.gameLost || !!this.solvedTargets?.FINAL;
    btn.style.display = (this.mode === 'multiplayer' && this.roomMode === 'BATTLE' && !finalSettled) ? 'block' : 'none';
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

  // Phase 1: the Final reveal goes out to the whole room immediately.
  // The narrative is deliberately NOT shown here anymore: it belongs to the
  // post-game AFTERMATH sequence after GAME WON / GAME LOST. Final scoring
  // can still be released independently through SHOW RESULTS while play
  // continues on any unresolved columns.
  showFinalReveal(outcome) {
    this.finalRevealed = true;
    this.updateFailFinalButtonVisibility();
    this._finalPanelOutcome = outcome?.outcome || 'success';
    this._finalResultsPending = true;
    this.openFinalPanel();
  },

  // The SOLUTION CONFIRMED / FINAL FAILED panel. CLOSE only hides it: the
  // withheld results live on the server (room.scoring.pendingResults), and
  // while they are pending the END GAME control reopens this same panel.
  // Reopening never re-sends anything; SHOW RESULTS is idempotent server-side
  // (releasePendingResults returns null once released).
  openFinalPanel() {
    if (this._activeFinalBanner?.isConnected) return this._activeFinalBanner;
    const layer = document.getElementById('score-announcement-layer');
    if (!layer || !this._finalResultsPending) return null;
    const isSuccess = this._finalPanelOutcome !== 'failed';

    const banner = document.createElement('div');
    banner.className = `final-outcome-banner ${isSuccess ? 'final-outcome-success' : 'final-outcome-failed'}`;
    banner.innerHTML = `
      <div class="fo-headline">${isSuccess ? 'SOLUTION CONFIRMED' : 'FINAL FAILED'}</div>
      <div class="fo-actions">
        <button class="gm-global-btn primary fo-continue-btn">SHOW RESULTS</button>
        <button class="gm-global-btn fo-close-btn" type="button">CLOSE</button>
      </div>
      <div class="fo-results" style="display: none;"></div>
    `;
    layer.appendChild(banner);
    this._activeFinalBanner = banner;

    banner.querySelector('.fo-continue-btn').addEventListener('click', () => {
      this.send({ type: 'gm:revealResults' });
    });
    banner.querySelector('.fo-close-btn').addEventListener('click', () => {
      banner.remove();
      if (this._activeFinalBanner === banner) this._activeFinalBanner = null;
      this.updateFinalPanelReopen();
    });
    this.updateFinalPanelReopen();
    return banner;
  },

  // Called from every state:public. Pending results + no open panel = show
  // END GAME. Released (or reversed) results retire the panel for good.
  syncFinalPanelState(state, battleVisible) {
    const pending = battleVisible && state.finalResultsPending === true;
    this._finalResultsPending = pending;
    if (pending) {
      this._finalPanelOutcome = state.finalResultsOutcome || this._finalPanelOutcome || 'success';
    } else {
      this._finalPanelOutcome = null;
    }
    this.updateFinalPanelReopen();
  },

  updateFinalPanelReopen() {
    const btn = document.getElementById('final-panel-reopen-btn');
    if (!btn) return;
    const panelOpen = !!this._activeFinalBanner?.isConnected;
    // Once every field is resolved, FINISH GAME is the next step (the
    // withheld points also release at RECOUNT), so END GAME steps aside and
    // can never sit on top of it.
    btn.style.display = this._finalResultsPending && !panelOpen && !this.gameComplete ? '' : 'none';
  },

  // Phase 2: the GM clicked SHOW RESULTS -- the server has broadcast the
  // actual point/penalty numbers to everyone, including us. Fill them into
  // whichever banner is still open (should always be `_activeFinalBanner`).
  revealFinalResults(results) {
    // Released: nothing is pending any more, whether or not the panel is open.
    this._finalResultsPending = false;
    this._finalPanelOutcome = null;
    this.updateFinalPanelReopen();
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
    this.playRoomModeTransition(this.roomMode, target === 'CASUAL' ? 'CASUAL' : 'BATTLE_ARMED');
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
      ? 'RETURN EVERYONE TO AMUSEMENT PARK?\n\nBattle state resets. Chat, identities, profiles, themes and message history stay online.'
      : 'KILL ACTIVE BATTLE?\n\nBattle state resets and everyone returns to AMUSEMENT PARK. Chat and identities remain online.';
    if (!window.confirm(prompt)) return;

    const roomToggle = document.getElementById('host-room-btn');
    if (roomToggle) {
      roomToggle.disabled = true;
      roomToggle.textContent = 'RETURNING...';
    }

    this.send({ type: 'room:close' });
  },

  setupMasterAccess() {
    const wrap = document.querySelector('.master-access-wrap');
    const trigger = document.getElementById('master-access-btn');
    const menu = document.getElementById('master-access-menu');
    if (!wrap || !trigger || !menu) return;

    const close = () => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    const toggle = (event) => {
      event?.stopPropagation?.();
      const open = menu.hidden;
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    trigger.addEventListener('click', toggle);
    document.getElementById('master-open-player-mirror')?.addEventListener('click', () => {
      close();
      this.openPlayerMirror();
    });
    document.getElementById('master-switch-player')?.addEventListener('click', () => {
      close();
      this.switchThisTabToPlayer();
    });
    document.getElementById('master-signout')?.addEventListener('click', () => {
      close();
      this.signOutMasterAccount();
    });
    document.addEventListener('click', (event) => {
      if (!wrap.contains(event.target)) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
  },

  openPlayerMirror() {
    const masterToken = localStorage.getItem('asoc_master_token') || GameData.gmToken || '';
    if (!masterToken) {
      location.replace('/join.html');
      return;
    }
    localStorage.setItem('asoc_master_token', masterToken);
    window.open('/join.html?masterMirror=1', '_blank', 'noopener');
  },

  switchThisTabToPlayer() {
    const masterToken = localStorage.getItem('asoc_master_token') || GameData.gmToken || '';
    if (!masterToken) {
      location.replace('/join.html');
      return;
    }
    localStorage.setItem('asoc_master_token', masterToken);
    if (this.hostToken) localStorage.setItem('asoc_master_host_token', this.hostToken);
    sessionStorage.setItem('asoc_master_persona', 'PLAYER_TEST');
    sessionStorage.removeItem('asoc_gm_token');
    sessionStorage.removeItem('asoc_player_auth_token');
    sessionStorage.removeItem('asoc_player_in_master');
    sessionStorage.removeItem('asoc_player_id');
    sessionStorage.removeItem('asoc_player_name');
    location.href = '/join.html?masterMirror=1';
  },

  async signOutMasterAccount() {
    if (!window.confirm('SIGN OUT MASTER ACCOUNT?\n\nAll Master tabs and Player Mirrors will lose Master authorization. The Master Room itself will remain intact.')) return;

    const masterToken = localStorage.getItem('asoc_master_token') || GameData.gmToken || '';
    try {
      if (masterToken) {
        await fetch('/api/auth/gm/logout', {
          method: 'POST',
          headers: { 'x-gm-token': masterToken }
        });
      }
    } catch (_) {
      // Local credential cleanup still proceeds if the server link is unavailable.
    } finally {
      localStorage.removeItem('asoc_master_token');
      localStorage.removeItem('asoc_master_host_token');
      sessionStorage.removeItem('asoc_master_persona');
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
    const chatPanel = document.querySelector('.gm-module-chat .gm-chat-panel');
    if (brokerBar && chatPanel && brokerBar.parentElement !== chatPanel) chatPanel.appendChild(brokerBar);
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
      const headerHtml = `<div class="public-title">${this.escapeHtml(game.title)}</div>`;
      if (headerBar._asocHeaderHtml !== headerHtml) {
        headerBar.innerHTML = headerHtml;
        headerBar._asocHeaderHtml = headerHtml;
      }
    }

    // Keyed patch (see js/dom-patch.js): this rebuild runs every second and
    // every 40ms during a Broker line, so unchanged cells must survive it.
    const entries = [
      { key: 'skeleton', html: Skeleton.skeletonHTML(game.difficulty) },
      { key: 'broker-line', html: this.renderShadowBrokerLineHTML() }
    ];

    for (let row = 1; row <= 4; row++) {
      columns.forEach(col => {
        const key = `${col}${row}`;
        const content = GameData.getCellData(col, row);
        const revealed = Board.isRevealed(col, row);

        entries.push({ key: `cell:${key}`, html: this.createPublicCellHTML(key, content, false, revealed, `${col}${row}`) });
      });
    }

    columns.forEach(col => {
      const key = `${col}5`;
      const content = GameData.getCellData(col, 5);
      const revealed = Board.isRevealed(col, 5);
      const outcome = Board.getCellOutcome(col, 5);

      entries.push({ key: `cell:${key}`, html: this.createPublicCellHTML(key, content, true, revealed, `${col}5`, false, outcome) });
    });

    const finalContent = GameData.getFinalSolution();
    const finalRevealed = Board.isFinalRevealed();
    const finalOutcome = Board.getFinalOutcome();
    // See _finalFlourishUntil's declaration -- true for every rebuild
    // that falls inside the short window applyServerState() opened on the
    // authoritative reveal transition, false for anything before or after.
    const playFinalFlourish = finalRevealed && Date.now() < this._finalFlourishUntil;
    entries.push({ key: 'cell:FINAL', html: this.createPublicCellHTML('FINAL', finalContent, true, finalRevealed, 'FINAL', true, finalOutcome, playFinalFlourish) });

    let boardEl = publicBoard.querySelector(':scope > .asoc-board');
    if (!boardEl) {
      publicBoard.innerHTML = '<div class="asoc-board"></div>';
      boardEl = publicBoard.firstElementChild;
    }
    const { inserted } = DomPatch.patch(boardEl, entries);
    if (inserted.length) Skeleton.attach(boardEl);
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

    const cascade = revealed ? this.columnCascadePresentation(key) : { active: false, className: '', style: '' };
    if (cascade.active) classes.push(...cascade.className.split(' '));
    const displayContent = revealed ? (content || '—') : (isFinal ? '???' : '■■■');

    return `
      <div class="${classes.join(' ')}" data-label="${label}" style="${Skeleton.cellStyle(label)}${cascade.style}">
        <div class="cell-content"><span class="cell-text">${this.escapeHtml(displayContent)}</span></div>
      </div>
    `;
  },

  columnCascadePresentation(key) {
    const match = /^([A-D])([1-5])$/.exec(String(key || ''));
    if (!match) return { active: false, className: '', style: '' };
    const column = match[1];
    const row = Number(match[2]);
    const startedAt = Number(this._columnCascadeStarts[column] || 0);
    if (!startedAt) return { active: false, className: '', style: '' };
    const elapsed = Math.max(0, Date.now() - startedAt);
    if (elapsed >= 1650) {
      delete this._columnCascadeStarts[column];
      return { active: false, className: '', style: '' };
    }
    const delay = row <= 4 ? (row - 1) * 180 : 790;
    return {
      active: true,
      className: 'column-solve-cascade' + (row === 5 ? ' column-solve-cascade-solution' : ''),
      style: `;--column-cascade-delay:${delay}ms;--column-cascade-elapsed:${elapsed}ms`
    };
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
    const avatarName = this.escapeHtml(entity.name || entity.playerName || 'Little Hero');
    // IKS OKS GAUNTLET health ring (js/iks-ring.js) for joined fighters.
    const ring = window.IksRing ? html => IksRing.wrap(entity, html) : html => html;
    return ring(`
      <span class="little-hero-avatar${compact ? ' little-hero-avatar-compact' : ''}${avatarData ? ' avatar-preview-trigger' : ''}" style="--lh-frame:${frameColor}"${avatarData ? ` role="button" tabindex="0" aria-label="View ${avatarName} avatar" data-preview-label="${avatarName} // AVATAR"` : ''}>
        ${avatarData ? `<img src="${avatarData}" alt="${avatarName} avatar">` : '<span class="little-hero-avatar-fallback">LH</span>'}
      </span>
    `);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  escapeHtmlAttr(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/"/g, '&quot;');
  },

  buildGMControls() {
    this.syncGMBoardInteractionState();

    const revealHideAllBtn = document.getElementById('reveal-hide-all-btn');
    if (revealHideAllBtn) {
      const allRevealed = !!window.GameData.currentGame && Board.isAllRevealed();
      revealHideAllBtn.textContent = allRevealed ? 'HIDE ALL' : 'REVEAL ALL';
      revealHideAllBtn.classList.toggle('revealed', allRevealed);
    }
  },

  buildEmptyGMControls() {
    this.syncGMBoardInteractionState();

    const revealHideAllBtn = document.getElementById('reveal-hide-all-btn');
    if (revealHideAllBtn) {
      revealHideAllBtn.textContent = 'REVEAL ALL';
      revealHideAllBtn.classList.remove('revealed');
    }
  },

  renderGMChat() {
    const container = document.getElementById('gm-chat-messages');
    if (!container) return;

    const previousScrollTop = container.scrollTop;
    const previousScrollHeight = container.scrollHeight;
    const previousClientHeight = container.clientHeight;
    const physicallyNearBottom =
      (previousScrollTop + previousClientHeight) >= (previousScrollHeight - 80);
    const followLatest = physicallyNearBottom || !this.userScrolledUp;

    let historyAnchorId = '';
    let historyAnchorOffset = 0;
    if (!followLatest) {
      const containerRect = container.getBoundingClientRect();
      const candidates = container.querySelectorAll('[data-message-id]');
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > containerRect.top + 1) {
          historyAnchorId = el.dataset.messageId || '';
          historyAnchorOffset = rect.top - containerRect.top;
          break;
        }
      }
    }

    const now = Date.now();
    let nextWrongFadeMs = Infinity;
    let nextTributeTickMs = Infinity;
    const entries = [];
    const search = String(this._gmChatSearch || '').trim().toLocaleLowerCase();
    const visibleMessages = search
      ? this.chatMessages.filter(msg => [msg.text, msg.playerName, msg.verdict, msg.target]
          .some(value => String(value || '').toLocaleLowerCase().includes(search)))
      : this.chatMessages;

    visibleMessages.forEach((msg, index) => {
      const previous = index > 0 ? visibleMessages[index - 1] : null;
      if (previous && (Number(msg.timestamp) - Number(previous.timestamp)) > 300000) {
        entries.push({ key: `sep:${msg.id}`, html: this.createGMChatTimeSeparator(msg.timestamp) });
      }
      if (msg.verdict === 'wrong') {
        const wrongSeenAt = this._gmWrongVerdictSeenAt.get(msg.id) ?? (now - 3000);
        const remaining = 3000 - (now - wrongSeenAt);
        if (remaining > 0) nextWrongFadeMs = Math.min(nextWrongFadeMs, remaining);
      }
      if (msg.source === 'bloodTribute' || msg.bloodTribute?.active) {
        const tributeRemaining = Number(msg.bloodTribute?.expiresAt || msg.publicUntil) - now;
        if (tributeRemaining > 0) nextTributeTickMs = Math.min(nextTributeTickMs, tributeRemaining, 1000);
      }
      entries.push({
        key: `msg:${msg.id}`,
        html: this.createGMChatMessageHTML(
          msg,
          this.shouldGroupGMChatMessage(previous, msg),
          now
        )
      });
    });

    this._gmChatProgrammaticScroll = true;
    // Keyed patch, not innerHTML: every chat:update (any player typing a
    // line, a seen receipt, a reaction) used to rebuild every message and
    // every verdict button, so a click landing mid-rebuild was lost and the
    // log flickered. Unchanged messages now stay the same DOM nodes.
    // @mention decoration depends on the roster, so a roster change rebuilds.
    const mentionRoster = (this.currentPlayers || []).map(player => String(player?.name || '')).sort().join('|');
    if (this._gmChatMentionRoster !== mentionRoster) {
      this._gmChatMentionRoster = mentionRoster;
      container.textContent = '';
    }
    const { inserted } = DomPatch.patch(container, entries);
    inserted.forEach(node => {
      this.decorateGMChatLinks(node);
      this.decorateGMChatMentions(node);
    });
    this.armGMPollCountdowns(container);
    // The inline CORRECT target picker lives inside its message node; if that
    // message was rebuilt (reaction, edit), put the picker back.
    if (this.pendingVerdict && !container.querySelector(`[data-message-id="${CSS.escape(String(this.pendingVerdict))}"] .gm-chat-target-controls`)) {
      if (container.querySelector(`[data-message-id="${CSS.escape(String(this.pendingVerdict))}"]`)) this.showTargetSelector(this.pendingVerdict);
      else this.pendingVerdict = null;
    }

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

    const pinLatest = () => {
      container.scrollTop = container.scrollHeight;
      this.userScrolledUp = false;
      this._gmNewMessageCount = 0;
      this._gmUnreadChat = 0;
      this._gmUnreadSystem = 0;
      this.updateGMNewMessageChip();
    };

    if (followLatest) {
      pinLatest();

      // Late-loading images/GIFs must not drag the operator viewport upward.
      inserted.flatMap(node => Array.from(node.querySelectorAll('img,video'))).forEach(media => {
        const repin = () => {
          if (!this.userScrolledUp) {
            this._gmChatProgrammaticScroll = true;
            pinLatest();
            requestAnimationFrame(() => { this._gmChatProgrammaticScroll = false; });
          }
        };
        if (media.tagName === 'IMG' && !media.complete) {
          media.addEventListener('load', repin, { once:true });
          media.addEventListener('error', repin, { once:true });
        } else if (media.tagName === 'VIDEO') {
          media.addEventListener('loadedmetadata', repin, { once:true });
        }
      });

      requestAnimationFrame(() => {
        pinLatest();
        requestAnimationFrame(() => { this._gmChatProgrammaticScroll = false; });
      });
    } else {
      const anchor = historyAnchorId
        ? container.querySelector(`[data-message-id="${CSS.escape(historyAnchorId)}"]`)
        : null;

      if (anchor) {
        const containerRect = container.getBoundingClientRect();
        const currentOffset = anchor.getBoundingClientRect().top - containerRect.top;
        container.scrollTop += currentOffset - historyAnchorOffset;
      } else {
        container.scrollTop = Math.max(0, previousScrollTop);
      }
      requestAnimationFrame(() => { this._gmChatProgrammaticScroll = false; });
    }

    this.updateSolvedCount();
    this.updateGMLatestReadout();
    this.updateDenyAllButton();
  },

  updateDenyAllButton() {
    const btn = document.getElementById('gm-deny-all-btn');
    if (!btn) return;
    const live = this.mode === 'multiplayer' && this.roomMode === 'BATTLE' && !this.gameComplete;
    const pending = live ? this.pendingAttemptCount() : 0;
    btn.hidden = !live;
    btn.disabled = pending === 0;
    if (!pending) this.disarmDenyAll();
    else if (!btn.classList.contains('is-armed')) btn.textContent = `DENY ALL · ${pending}`;
  },

  disarmDenyAll() {
    const btn = document.getElementById('gm-deny-all-btn');
    clearTimeout(this._denyAllArmTimer);
    this._denyAllArmTimer = null;
    if (!btn) return;
    btn.classList.remove('is-armed');
    btn.textContent = 'DENY ALL';
  },

  // Two-step click: the first arms it (3s), the second commits. A stray
  // click can otherwise wipe a whole round of guesses at once.
  handleDenyAllClick() {
    const btn = document.getElementById('gm-deny-all-btn');
    if (!btn || btn.disabled) return;
    if (btn.classList.contains('is-armed')) {
      this.disarmDenyAll();
      this.denyAllGuesses();
      return;
    }
    btn.classList.add('is-armed');
    btn.textContent = `DENY ${this.pendingAttemptCount()}?`;
    clearTimeout(this._denyAllArmTimer);
    this._denyAllArmTimer = setTimeout(() => {
      this.disarmDenyAll();
      this.updateDenyAllButton();
    }, 3000);
  },

  // GOLD SOLUTION WORDS -- GM-only live-battle assist. The GM client already
  // holds the real A5-D5 / FINAL answers (GameData.currentGame); players never
  // receive them, and this runs only in the GM's own renderer. Returns []
  // outside a live BATTLE so CASUAL / RECOUNT never highlight.
  gmSolutionTerms() {
    if (this.roomMode !== 'BATTLE') return [];
    const game = window.GameData?.currentGame;
    if (!game) return [];
    const bySlot = [
      ...['A', 'B', 'C', 'D'].map(col => [`${col}5`, game.columns?.[col]?.solution]),
      ['FINAL', game.finalSolution]
    ];
    return bySlot
      .map(([slot, term]) => ({ slot, term: String(term || '').trim() }))
      .filter(entry => entry.term);
  },

  // Pure: split `text` into [{ text, slots }] segments where `slots` lists
  // the solution slots a segment matches (null for plain text). Whole-word,
  // case-insensitive, multi-word aware (any whitespace between words), never
  // inside a longer word, never inside a URL and never right after "@" (so
  // link/mention decoration still sees one intact text run).
  splitSolutionMatches(text, terms) {
    const source = String(text ?? '');
    const bySlotKey = new Map();
    (terms || []).forEach(({ slot, term }) => {
      const key = String(term || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      if (!key) return;
      if (!bySlotKey.has(key)) bySlotKey.set(key, []);
      bySlotKey.get(key).push(slot);
    });
    if (!source || !bySlotKey.size) return [{ text: source, slots: null }];

    // Syntax characters only: under the `u` flag any other escaped char
    // (e.g. "\-") is a SyntaxError.
    const specials = '^$.*+?()[]{}|/\\';
    const alternatives = [...bySlotKey.keys()]
      .sort((a, b) => b.length - a.length)
      .map(key => key.split(' ').map(word => [...word].map(ch => specials.includes(ch) ? '\\' + ch : ch).join('')).join('\\s+'));
    const pattern = new RegExp('(?<![\\p{L}\\p{N}_@])(?:' + alternatives.join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');

    const segments = [];
    const push = (value, slots = null) => {
      if (!value) return;
      const last = segments[segments.length - 1];
      if (!slots && last && !last.slots) last.text += value;
      else segments.push({ text: value, slots });
    };
    const urlPattern = /https?:\/\/[^\s<>"']+/gi;
    let cursor = 0;
    const scan = (chunk) => {
      pattern.lastIndex = 0;
      let last = 0;
      let match;
      while ((match = pattern.exec(chunk))) {
        push(chunk.slice(last, match.index));
        const key = match[0].replace(/\s+/g, ' ').toLocaleLowerCase();
        push(match[0], bySlotKey.get(key) || []);
        last = match.index + match[0].length;
      }
      push(chunk.slice(last));
    };
    let url;
    while ((url = urlPattern.exec(source))) {
      scan(source.slice(cursor, url.index));
      push(url[0]);
      cursor = url.index + url[0].length;
    }
    scan(source.slice(cursor));
    return segments.length ? segments : [{ text: source, slots: null }];
  },

  // Escapes every piece first, then wraps only the escaped matched text.
  gmSolutionHighlightHTML(text) {
    const terms = this.gmSolutionTerms();
    if (!terms.length) return this.escapeHtml(text);
    return this.splitSolutionMatches(text, terms)
      .map(segment => segment.slots
        ? `<span class="gm-solution-hit" data-solution="${this.escapeHtml(segment.slots.join(' '))}">${this.escapeHtml(segment.text)}</span>`
        : this.escapeHtml(segment.text))
      .join('');
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

  openGMSeenPopover(messageId, anchorEl) {
    const popover = document.getElementById('gm-chat-seen-popover');
    if (!popover || !messageId) return false;
    const msg = (this.chatMessages || []).find(entry => String(entry.id) === String(messageId));
    if (!msg) return false;
    const seenIds = new Set((Array.isArray(msg.seenBy) ? msg.seenBy : []).map(entry => String(entry.playerId)));
    const roster = this.currentPlayers || [];
    const nameFor = (id) => {
      const member = roster.find(p => String(p.id) === String(id));
      return member?.name || 'Little Hero';
    };
    const receiptNameFor = (id) => {
      const receipt = (Array.isArray(msg.seenBy) ? msg.seenBy : [])
        .find(entry => String(entry.playerId) === String(id));
      return String(receipt?.playerName || '').trim() || nameFor(id);
    };
    const seenNames = [...seenIds].map(receiptNameFor);
    const notSeenIds = (Array.isArray(msg.recipientIds) ? msg.recipientIds : [])
      .filter(id => !seenIds.has(String(id)));
    const notSeenNames = [...new Set(notSeenIds)].map(nameFor);

    const seenHtml = seenNames.length
      ? seenNames.map(name => `<div class="chat-seen-name seen">${this.escapeHtml(name)}</div>`).join('')
      : `<div class="chat-seen-name muted">No one has seen this yet</div>`;
    const notSeenHtml = notSeenNames.length
      ? `<div class="chat-seen-section-label">NOT SEEN</div>` + notSeenNames.map(name => `<div class="chat-seen-name unseen">${this.escapeHtml(name)}</div>`).join('')
      : '';
    if (popover.parentElement !== document.body) document.body.appendChild(popover);
    popover.innerHTML = `<div class="chat-seen-id">${this.escapeHtml(msg.id)}</div>
      <div class="chat-seen-section-label">SEEN · ${seenNames.length}/${msg.recipientCount || 0}</div>${seenHtml}${notSeenHtml}`;
    popover.hidden = false;
    const rect = anchorEl?.getBoundingClientRect?.();
    if (rect) {
      const left = Math.max(0, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.right + 8));
      const top = rect.bottom + 8 < window.innerHeight ? rect.bottom + 8 : Math.max(0, rect.top - popover.offsetHeight - 8);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }
    return true;
  },

  updateGMLatestReadout() {
    const readout = document.getElementById('gm-latest-readout');
    if (!readout) return;
    const latest = [...(this.chatMessages || [])]
      .reverse()
      .find(msg => msg && msg.deleted !== true && Number(msg.recipientCount) > 0);
    if (!latest) {
      readout.innerHTML = `<span class="gm-latest-readout-label">LATEST READOUT</span><span class="gm-latest-readout-state">NO TRANSMISSIONS</span>`;
      return;
    }
    const roster = this.currentPlayers || [];
    const names = [...new Map((Array.isArray(latest.seenBy) ? latest.seenBy : []).map(receipt => {
      const id = String(receipt.playerId || '');
      const member = roster.find(player => String(player.id) === id);
      return [id, String(receipt.playerName || member?.name || 'Little Hero').trim() || 'Little Hero'];
    })).values()];
    const seen = names.length;
    const total = Number(latest.recipientCount) || 0;
    const state = seen
      ? `<strong>SEEN BY</strong> ${names.map(name => this.escapeHtml(name)).join(' · ')}`
      : `<strong>AWAITING READERS</strong>`;
    readout.innerHTML = `<span class="gm-latest-readout-label">LATEST READOUT <b>${seen}/${total}</b></span><span class="gm-latest-readout-state">${state}</span>`;
  },

  closeGMSeenPopover() {
    const popover = document.getElementById('gm-chat-seen-popover');
    if (popover) popover.hidden = true;
  },

  openGMReactionDetails(messageId, selectedEmoji, anchorEl) {
    const popover = document.getElementById('gm-chat-reaction-details');
    const msg = (this.chatMessages || []).find(entry => String(entry.id) === String(messageId));
    if (!popover || !msg) return false;
    const reactions = Object.entries(msg.reactions || {})
      .filter(([emoji, ids]) => this.isGMReactionEmoji(emoji) && Array.isArray(ids) && ids.length);
    if (!reactions.length) return false;
    const activeEmoji = reactions.some(([emoji]) => emoji === selectedEmoji) ? selectedEmoji : reactions[0][0];
    const roster = this.currentPlayers || [];
    const person = id => String(id) === '__GM__'
      ? { name:'Shadow Broker', avatarData:'assets/ui/shadow-broker.png', frameColor:'#9B5DE0' }
      : roster.find(player => String(player.id) === String(id)) || { name:'Little Hero', frameColor:'#6f7885' };
    const tabs = reactions.map(([emoji, ids]) => `<button type="button" class="chat-reaction-detail-tab${emoji === activeEmoji ? ' active' : ''}" data-reaction-filter="${this.escapeHtml(emoji)}"><span>${this.renderGMReactionEmojiHTML(emoji, 'commander-reaction-emoji')}</span><b>${ids.length}</b></button>`).join('');
    const rows = reactions.flatMap(([emoji, ids]) => ids.map(id => {
      const member = person(id);
      const name = this.escapeHtml(member.name || member.playerName || 'Little Hero');
      const avatar = member.avatarData ? `<img src="${this.escapeHtml(member.avatarData)}" alt="">` : `<span>${name.slice(0, 2).toUpperCase()}</span>`;
      const frame = /^#[0-9A-Fa-f]{6}$/.test(member.frameColor || '') ? member.frameColor : '#6f7885';
      return `<div class="chat-reaction-detail-person${emoji === activeEmoji ? '' : ' filtered'}" data-reaction-emoji="${this.escapeHtml(emoji)}"><i style="--reaction-frame:${frame}">${avatar}</i><strong>${name}</strong><em>${this.renderGMReactionEmojiHTML(emoji, 'commander-reaction-emoji')}</em></div>`;
    })).join('');
    if (popover.parentElement !== document.body) document.body.appendChild(popover);
    popover.innerHTML = `<div class="chat-reaction-detail-head"><strong>${reactions.reduce((sum, [, ids]) => sum + ids.length, 0)} REACTIONS</strong><button type="button" data-reaction-close aria-label="Close">×</button></div><div class="chat-reaction-detail-tabs">${tabs}</div><div class="chat-reaction-detail-list">${rows}</div>`;
    popover.dataset.messageId = messageId;
    popover.hidden = false;
    const rect = anchorEl?.getBoundingClientRect?.();
    if (rect) {
      popover.style.left = `${Math.max(8, Math.min(window.innerWidth - popover.offsetWidth - 8, rect.left))}px`;
      popover.style.top = `${rect.bottom + 8 + popover.offsetHeight < window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - popover.offsetHeight - 8)}px`;
    }
    return true;
  },

  createGMReactionSummaryHTML(msg) {
    const reactions = msg?.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
    const chips = Object.entries(reactions)
      .filter(([emoji, playerIds]) => this.isGMReactionEmoji(emoji) && Array.isArray(playerIds) && playerIds.length)
      .map(([emoji, playerIds]) => {
        const mine = playerIds.map(String).includes('__GM__');
        const emojiHtml = this.renderGMReactionEmojiHTML(emoji, 'commander-reaction-emoji');
        const reactorNames = playerIds.map(id => {
          if (String(id) === '__GM__') return 'Shadow Broker';
          return (this.currentPlayers || []).find(player => String(player.id) === String(id))?.name || 'Little Hero';
        });
        const reactors = this.escapeHtmlAttr(reactorNames.join('\n'));
        return `<button type="button" class="gm-chat-reaction-chip${mine ? ' mine' : ''}${window.CommanderEmojis?.has?.(emoji) ? ' commander-reaction-chip' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-emoji="${this.escapeHtml(emoji)}" data-reactors="${reactors}" title="${reactors}" aria-label="Reacted by ${this.escapeHtmlAttr(reactorNames.join(', '))}" aria-pressed="${mine ? 'true' : 'false'}"><span>${emojiHtml}</span><b>${playerIds.length}</b></button>`;
      })
      .join('');

    const addButton = this.mode === 'multiplayer'
      ? `<button type="button" class="gm-chat-reaction-add" data-message-id="${this.escapeHtml(msg.id)}" title="React as GameMaster" aria-label="React to message">＋</button>`
      : '';
    return `<div class="gm-chat-reactions${chips ? ' has-reactions' : ''}">${chips}${addButton}${this.createGMSeenChipHTML(msg)}</div>`;
  },

  createGMSeenChipHTML(msg) {
    if (!msg || msg.deleted === true) return '';
    const total = Number(msg.recipientCount) || 0;
    const seen = Array.isArray(msg.seenBy) ? msg.seenBy.length : 0;
    if (total <= 0) return '';
    return `<button type="button" class="gm-chat-seen-chip" data-message-id="${this.escapeHtml(msg.id)}" title="Who has seen this transmission"><span class="gm-chat-seen-icon">&#10003;</span><b>${seen}/${total}</b></button>`;
  },

  formatGMPollCountdown(expiresAt) {
    const remaining = Math.max(0, Number(expiresAt || 0) - Date.now());
    const totalSeconds = Math.max(0, Math.ceil(remaining / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  },

  armGMPollCountdowns(container = document.getElementById('gm-chat-messages')) {
    clearInterval(this._gmPollCountdownInterval);
    this._gmPollCountdownInterval = null;
    if (!container) return;
    const update = () => {
      container.querySelectorAll('.gm-poll-countdown[data-expires-at]').forEach(node => {
        node.textContent = this.formatGMPollCountdown(node.dataset.expiresAt);
      });
    };
    update();
    if (container.querySelector('.gm-poll-countdown[data-expires-at]')) {
      this._gmPollCountdownInterval = setInterval(update, 250);
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
    const gmId = '__GM__';
    const closed = Number(poll.closedAt) > 0;
    const expiresAt = Number(poll.expiresAt) || 0;
    const autoTagged = poll.createdByRole === 'gm';

    const optionHtml = options.map((option, index) => {
      const ids = Array.isArray(votes[String(index)]) ? votes[String(index)].map(String) : [];
      const selected = ids.includes(gmId);
      const percent = totalVoters ? Math.round((ids.length / totalVoters) * 100) : 0;
      const voterNames = ids.map(id => id === gmId ? 'SHADOW BROKER' : String(voters[id]?.name || 'LITTLE HERO'));
      const voterTitle = voterNames.length ? 'VOTERS // ' + voterNames.join(', ') : 'NO VOTES';
      const voterChips = ids.map(id => {
        const voter = voters[id] || {};
        const name = id === gmId ? 'SHADOW BROKER' : String(voter.name || 'LITTLE HERO');
        const frameColor = /^#[0-9A-Fa-f]{6}$/.test(voter.frameColor || '') ? voter.frameColor : '#9B5DE0';
        const avatar = id === gmId
          ? '<img src="assets/ui/shadow-broker.png" alt="">'
          : (typeof voter.avatarData === 'string' && voter.avatarData.startsWith('data:image/')
              ? `<img src="${this.escapeHtml(voter.avatarData)}" alt="">`
              : `<i>${this.escapeHtml(name.slice(0, 1).toUpperCase())}</i>`);
        return `<span class="gm-poll-voter-chip" title="${this.escapeHtml(name)}" style="--poll-voter-color:${frameColor}">${avatar}<b>${this.escapeHtml(name)}</b></span>`;
      }).join('');

      return `
        <button type="button" class="gm-poll-choice${selected ? ' selected' : ''}" data-gm-poll-vote="${index}" data-message-id="${this.escapeHtml(msg.id)}" ${closed ? 'disabled' : ''}>
          <span class="gm-poll-choice-fill" style="width:${percent}%"></span>
          <span class="gm-poll-choice-label">${this.escapeHtml(option)}</span>
          <span class="gm-poll-choice-result" title="${this.escapeHtml(voterTitle)}"><b>${percent}%</b><small>${ids.length}</small></span>
          <span class="gm-poll-voters"><span class="gm-poll-voters-label">VOTED</span>${voterChips || '<em>NONE</em>'}</span>
        </button>
      `;
    }).join('');

    const timerHtml = expiresAt
      ? (closed
          ? '<strong class="gm-poll-countdown is-ended">CLOSED</strong>'
          : `<strong class="gm-poll-countdown" data-expires-at="${expiresAt}">${this.formatGMPollCountdown(expiresAt)}</strong>`)
      : '<strong class="gm-poll-countdown no-limit">NO LIMIT</strong>';

    return `
      <div class="gm-poll-card${closed ? ' is-closed' : ''}">
        <div class="gm-poll-card-head">
          <span>ASOC CONSENSUS PROTOCOL${poll.allowMultiple ? ' // MULTI-SELECT' : ''}</span>
          <span class="gm-poll-state"><b>${closed ? 'ARCHIVED' : 'PUBLIC // LIVE'}</b>${autoTagged ? '<em>@ALL TAGGED</em>' : ''}${timerHtml}</span>
        </div>
        <div class="gm-poll-question">${this.escapeHtml(poll.question || msg.text || '')}</div>
        <div class="gm-poll-choice-list">${optionHtml}</div>
        <div class="gm-poll-card-foot">
          <span>ROOM RESPONSE // ${totalVoters} VOTER${totalVoters === 1 ? '' : 'S'}</span>
          ${!closed ? `<button type="button" class="gm-poll-close" data-gm-poll-close="${this.escapeHtml(msg.id)}">CLOSE POLL</button>` : ''}
        </div>
      </div>
    `;
  },

  // /spit and /fart cards from the Shadow Broker's perspective: the Broker's
  // own act reads "You ...", a Little Hero aiming at the Broker (target id
  // __SHADOW_BROKER__) reads "X ... you.", anything else is neutral.
  gmSystemActLine(msg, act) {
    const verbs = { spit: ['spit on', 'spits on'], fart: ['fart on', 'farts on'], nod: ['nod at', 'nods at'] }[act] || ['acknowledge', 'acknowledges'];
    const data = msg[act] || {};
    const actorName = this.escapeHtml(String(data.actorName || msg.playerName || 'SHADOW BROKER'));
    const targetName = this.escapeHtml(String(data.targetName || '???'));
    if (msg.playerId == null && String(data.actorId || '') === '') return `You ${verbs[0]} ${targetName}.`;
    if (String(data.targetId || '') === '__SHADOW_BROKER__') return `${actorName} ${verbs[1]} you.`;
    return `${actorName} ${verbs[1]} ${targetName}.`;
  },

  // The Broker is the actor when actorId is null, the target when aimed at it.
  gmSystemEmoteLine(msg) {
    const emote = msg.emote || {};
    const lines = emote.lines || {};
    if (emote.actorId == null || emote.actorId === '') return this.escapeHtml(lines.actor || lines.other || '');
    if (String(emote.targetId || '') === '__SHADOW_BROKER__') return this.escapeHtml(lines.target || lines.other || '');
    return this.escapeHtml(lines.other || msg.text || '');
  },

  gmSystemAfkLine(msg) {
    const afk = msg.afk || {};
    return `SHADOW BROKER CHECKS ON ${this.escapeHtml(String(afk.targetName || '???'))}. STILL THERE?`;
  },

  createGMSystemChatCardHTML(msg) {
    const esc = (value) => this.escapeHtml(String(value == null ? '' : value));
    const actor = esc(msg.playerName || 'SHADOW BROKER');
    const typeMap = {
      dice: () => {
        const d = msg.dice || {};
        const rolls = Array.isArray(d.rolls) ? d.rolls.map(esc).join(' · ') : '';
        const bonus = Number(d.bonus) || 0;
        return {
          label: 'DICE',
          body: `${actor} casts <b>${esc(d.diceText)}</b> → <b>${esc(d.total)}</b>`,
          detail: rolls ? `${rolls}${bonus ? ` +${bonus}` : ''}` : ''
        };
      },
      flip: () => {
        const f = msg.flip || {};
        const call = f.call ? ` calls ${esc(String(f.call).toUpperCase())} &amp;` : '';
        const verdictMark = f.matched === true
          ? '<span class="chat-system-ok">CALLED</span>'
          : (f.matched === false ? '<span class="chat-system-ko">MISSED</span>' : '');
        return { label: 'COIN', body: `${actor}${call} flips → <b>${esc(String(f.result || '').toUpperCase())}</b>`, detail: verdictMark };
      },
      choose: () => {
        const c = msg.choose || {};
        return {
          label: 'CHOOSE',
          body: `${actor} chooses → <b>${esc(c.pick)}</b>`,
          detail: esc((Array.isArray(c.options) ? c.options : []).join(' · '))
        };
      },
      order: () => {
        const o = msg.order || {};
        return { label: 'TURN ORDER', body: esc((Array.isArray(o.order) ? o.order : []).join(' → ')), detail: '' };
      },
      stats: () => {
        const s = msg.stats || {};
        return {
          label: 'THE BOOK',
          body: `${actor} consults`,
          detail: `${esc(s.messages)} msgs · ${esc(s.correct)} correct · ${esc(s.failed)} wrong · ${esc(s.points)} pts`
        };
      },
      commands: () => {
        const rows = (Array.isArray(msg.commands?.commands) ? msg.commands.commands : [])
          .map(c => `<div class="chat-system-command"><code>${esc(c.name)}</code><span>${esc(c.help)}</span></div>`)
          .join('');
        return { label: 'COMMANDS', body: rows, detail: '' };
      },
      spit: () => ({ label: 'SPIT', body: this.gmSystemActLine(msg, 'spit'), detail: '' }),
      fart: () => ({ label: 'FART', body: this.gmSystemActLine(msg, 'fart'), detail: '' }),
      emote: () => ({ label: msg.emote?.label || 'EMOTE', body: this.gmSystemEmoteLine(msg), detail: '' }),
      nod: () => ({ label: 'NOD', body: this.gmSystemActLine(msg, 'nod'), detail: 'ACKNOWLEDGED' }),
      afk: () => ({ label: 'AFK CHECK', body: this.gmSystemAfkLine(msg), detail: '' }),
      unstableConcoction: () => {
        const c = msg.unstableConcoction || {};
        const resolved = c.phase === 'resolved';
        return {
          label: 'UNSTABLE CONCOCTION',
          body: resolved ? `<b>${esc(c.playerName || actor)}</b> → <b>${esc(c.outcome || '')}</b>` : `<b>${esc(c.playerName || actor)}</b> opened the chamber.`,
          detail: resolved ? 'REACTION COMPLETE // 24H LOCK ENGAGED' : 'REACTION STARTED // TARGET LOCKED'
        };
      }
    };
    const render = typeMap[msg.messageType];
    if (!render) return '';
    const { label, body, detail } = render();
    return `
      <div class="chat-system-card chat-system-${esc(msg.messageType)}" data-message-id="${esc(msg.id)}" data-player-name="${actor}">
        <div class="chat-system-label">${esc(label)}</div>
        <div class="chat-system-body">${body}</div>
        ${detail ? `<div class="chat-system-detail">${detail}</div>` : ''}
      </div>
    `;
  },

  createGMChatMessageHTML(msg, grouped = false, now = Date.now()) {
    if (msg.deleted === true) {
      const deletedBy = msg.deletedBy === '__GM__' ? 'SHADOW BROKER' : '';
      const byLine = deletedBy ? `<span class="gm-chat-tombstone-by">by ${this.escapeHtml(deletedBy)}</span>` : '';
      return `<div class="gm-chat-message gm-chat-tombstone" data-message-id="${this.escapeHtml(msg.id)}">
        <span class="gm-chat-tombstone-icon" aria-hidden="true">&#128465;</span>
        <strong>TRANSMISSION WITHDRAWN</strong>${byLine}
      </div>`;
    }
    if (msg.bloodTribute?.claimed) {
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<div class="gm-chat-message blood-tribute-tombstone" data-message-id="${this.escapeHtml(msg.id)}"><strong>☠ BLOOD TRIBUTE CLAIMED</strong><span>${this.escapeHtml(msg.playerName || 'LITTLE HERO')} // ${time}</span></div>`;
    }
    const manualTribute = msg.bloodTribute?.active;
    const manualRemaining = Math.max(0, Math.ceil((Number(msg.bloodTribute?.expiresAt) - now) / 1000));
    const manualBadge = manualTribute ? `<div class="blood-tribute-chat-head"><span>☠ BLOOD TRIBUTE</span><b>${String(Math.floor(manualRemaining / 60)).padStart(2, '0')}:${String(manualRemaining % 60).padStart(2, '0')}</b></div>` : '';
    if (msg.source === 'bloodTribute') {
      const remainingMs = Number(msg.publicUntil) - now;
      if (!msg.imageData || remainingMs <= 0) return '';
      const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
      const seconds = String(totalSeconds % 60).padStart(2, '0');
      return `
        <div class="gm-chat-blood-tribute-entry" data-message-id="${this.escapeHtml(msg.id)}">
          <div class="blood-tribute-chat-head"><span>BLOOD TRIBUTE // ${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span><b>PUBLIC PURGE ${minutes}:${seconds}</b></div>
          <button type="button" class="chat-image-link blood-tribute-preview" aria-label="Expand blood tribute image"><img class="blood-tribute-public-image" src="${msg.imageData}" alt="Temporary tribute image"></button>
        </div>
      `;
    }

    if (msg.messageType && ['dice', 'flip', 'choose', 'order', 'stats', 'commands', 'spit', 'fart', 'nod', 'emote', 'afk', 'unstableConcoction'].includes(msg.messageType)) {
      return this.createGMSystemChatCardHTML(msg);
    }

    if (msg.messageType === 'roll' && msg.roll) {
      const value = Math.max(1, Number(msg.roll.value) || 1);
      const rollClass = value === 100 ? ' roll-legendary' : value === 1 ? ' roll-cursed' : value === 69 ? ' roll-nice' : value <= 33 ? ' roll-low' : value <= 66 ? ' roll-mid' : ' roll-high';
      return `
        <div class="asoc-roll-entry${rollClass}" data-message-id="${this.escapeHtml(msg.id)}">
          <span class="asoc-roll-name">${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span>
          <span class="asoc-roll-label">rolls</span>
          <strong class="asoc-roll-value">${this.escapeHtml(String(value))}</strong>
          ${value === 69 ? '<strong class="asoc-roll-nice">NICE!</strong>' : ''}
        </div>
      `;
    }

    if (msg.messageType === 'gifRemote' && msg.gif) {
      const isBrokerGif = msg.source === 'chatGifGm';
      const identity = (this.currentPlayers || []).find(p => p.id === msg.playerId) || msg;
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const themeId = isBrokerGif ? 'gunmetal' : ASOCThemes.get(identity.themeId).id;
      const themeStyle = isBrokerGif ? '' : ASOCThemes.messageStyle(identity.themeId);
      const frameColor = isBrokerGif
        ? '#9B5DE0'
        : (/^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885');
      const title = this.escapeHtml(msg.gif.title || 'GIF');
      const gifUrl = this.escapeHtml(msg.gif.gifUrl || msg.gif.previewUrl || '#');
      const preview = this.escapeHtml(msg.gif.previewUrl || '');
      const media = msg.gif.mp4Url
        ? `<video class="gm-chat-gif-attachment" autoplay loop muted playsinline preload="metadata" poster="${preview}"><source src="${this.escapeHtml(msg.gif.mp4Url)}" type="video/mp4"></video>`
        : `<img class="gm-chat-gif-attachment" src="${gifUrl}" alt="${title}">`;

      if (isBrokerGif) {
        return `
          <div class="gm-shadow-broker-entry gm-shadow-broker-media-entry" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="SHADOW BROKER" data-editable="false" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
            <div class="shadow-broker-transmission shadow-broker-broadcast">
              <img src="assets/ui/shadow-broker.png" class="shadow-broker-avatar" alt="Shadow Broker">
              <div class="shadow-broker-body">
                <div class="gm-shadow-broker-media-head"><span class="shadow-broker-name">SHADOW BROKER</span><span class="gm-chat-time">${time}</span></div>
                <button type="button" class="gm-chat-gif-link" title="${title}" aria-label="Open GIF preview">${media}</button>
                <div class="gm-chat-gif-provider-mark">GIPHY</div>
              </div>
            </div>
            ${this.createGMReactionSummaryHTML(msg)}
          </div>
        `;
      }

      const avatar = this.littleHeroAvatarHTML(identity, true);
      return `
        <div class="gm-chat-message gm-flow-message gm-gif-message" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="${this.escapeHtml(msg.playerName || 'LITTLE HERO')}" data-editable="false" data-theme-id="${themeId}" style="${themeStyle}--little-hero-accent:${frameColor}" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
          <div class="gm-chat-avatar-rail">${avatar}</div>
          <div class="gm-chat-bubble-cluster">
            <div class="gm-chat-message-main">
              <div class="gm-chat-flow-header"><span class="gm-chat-player-name">${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span><span class="gm-chat-time">${time}</span></div>
              <button type="button" class="gm-chat-gif-link" title="${title}" aria-label="Open GIF preview">${media}</button>
              <div class="gm-chat-gif-provider-mark">GIPHY</div>
              ${this.createGMReactionSummaryHTML(msg)}
            </div>
            <div class="gm-chat-quick-actions adjudicated" aria-hidden="true"></div>
          </div>
        </div>
      `;
    }

    if (msg.messageType === 'poll' && msg.poll) {
      const isBrokerPoll = msg.poll.createdByRole === 'gm';
      const identity = (this.currentPlayers || []).find(p => p.id === msg.playerId) || msg;
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (isBrokerPoll) {
        return `
          <div class="gm-shadow-broker-entry gm-shadow-broker-poll-entry" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="SHADOW BROKER" data-editable="false" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
            <div class="shadow-broker-transmission shadow-broker-broadcast shadow-broker-poll-transmission">
              <img src="assets/ui/shadow-broker.png" class="shadow-broker-avatar" alt="Shadow Broker">
              <div class="shadow-broker-body">
                <div class="shadow-broker-poll-identity"><span class="shadow-broker-name">SHADOW BROKER</span><span class="gm-chat-time">${time}</span></div>
                ${this.createGMPollCardHTML(msg)}
              </div>
            </div>
            ${this.createGMReactionSummaryHTML(msg)}
          </div>
        `;
      }

      const avatar = this.littleHeroAvatarHTML(identity, true);
      const themeId = ASOCThemes.get(identity.themeId).id;
      const themeStyle = ASOCThemes.messageStyle(identity.themeId);
      const frameColor = /^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885';
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
        <div class="gm-shadow-broker-entry${manualTribute ? ' active-blood-tribute' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="SHADOW BROKER" data-editable="${msg.editableByHost === true ? 'true' : 'false'}" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
          ${manualBadge}${replyContextHtml}
          ${Skeleton.shadowBrokerTransmissionHTML(messageText || (msg.imageUrl ? 'IMAGE TRANSMISSION' : ''), { glitchIn: isNew })}\n          ${msg.imageUrl ? `<button type="button" class="chat-image-link" aria-label="Open image preview"><img class="chat-image-attachment" src="${this.escapeHtml(msg.imageUrl)}" alt="Chat image"></button>` : ''}
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
    // Keep adjudication controls available after a verdict so the GM can
    // correct a mistaken X/heart. The server already reverses prior scoring,
    // solved-target credit and ledger state when a verdict is changed.
    const showControls = msg.adjudicable === true && !this.gameComplete;
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
      <div class="gm-chat-message gm-flow-message ${manualTribute ? 'active-blood-tribute' : ''} ${grouped ? 'grouped' : ''} ${agedRejected ? 'aged-rejected' : ''} ${hasVerdict ? 'has-verdict' : ''} ${msg.verdict || ''}${window.IksRing?.messageClass(identity) || ''}" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="${this.escapeHtml(msg.playerName || 'LITTLE HERO')}" data-editable="false" data-theme-id="${ASOCThemes.get(identity.themeId).id}" style="${themeStyle}--little-hero-accent:${frameColor}" oncontextmenu="return App.openGMMessageActionMenu(event,this)">
        <div class="gm-chat-avatar-rail">${this.littleHeroAvatarHTML(identity, true)}</div>
        <div class="gm-chat-bubble-cluster">
          <div class="gm-chat-message-main">${manualBadge}
            <div class="gm-chat-flow-header"><span class="gm-chat-player-name">${this.escapeHtml(msg.playerName)}</span></div>
            ${replyContextHtml}
            <div class="gm-chat-message-line"><div class="gm-chat-message-text">${this.gmSolutionHighlightHTML(messageText)}</div><span class="gm-chat-time">${time}</span>${msg.editedAt ? '<span class="gm-chat-edited-marker">EDITED</span>' : ''}</div>${msg.imageUrl ? `<button type="button" class="chat-image-link" aria-label="Open image preview"><img class="chat-image-attachment" src="${this.escapeHtml(msg.imageUrl)}" alt="Chat image"></button>` : ''}
            ${verdictMetaHtml}
            ${verdictResponseHtml}
            ${this.createGMReactionSummaryHTML(msg)}
          </div>
          ${showControls ? `<div class="gm-chat-quick-actions" aria-label="Judge message if it is an answer">
            <button class="gm-verdict-btn wrong${msg.verdict === 'wrong' ? ' is-active' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-verdict="wrong" aria-pressed="${msg.verdict === 'wrong' ? 'true' : 'false'}" title="${msg.verdict === 'wrong' ? 'Undo WRONG // back to unjudged' : 'Reject as answer'}">×</button>
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

  gmMessageDeletable(messageId) {
    const msg = (this.chatMessages || []).find(entry => String(entry.id) === String(messageId));
    if (!msg || msg.deleted === true) return false;
    if (msg.source === 'bloodTribute' || msg.bloodTribute?.active) return false;
    return msg.playerId == null && String(msg.playerName || '') === 'SHADOW BROKER';
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
    const deleteButton = menu.querySelector('[data-gm-chat-action="delete"]');
    if (deleteButton) deleteButton.hidden = !this.gmMessageDeletable(messageId);
    const chatMessage = this.chatMessages.find(item => item.id === messageId);
    const tributeButton = menu.querySelector('[data-gm-chat-action="tribute"]');
    const cancelTributeButton = menu.querySelector('[data-gm-chat-action="tribute-cancel"]');
    if (tributeButton) tributeButton.hidden = !chatMessage?.imageUrl || !!chatMessage?.bloodTribute;
    if (cancelTributeButton) cancelTributeButton.hidden = !chatMessage?.bloodTribute?.active;
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

  isPriorityChatMessage(message) {
    return !!message && (
      message.source === 'shadowBroker' || message.source === 'bloodTribute' ||
      message.bloodTribute || message.verdict || message.messageType || message.roll
    );
  },

  showGMChatPriority(message) {
    const lane = document.getElementById('gm-chat-priority-lane');
    if (!lane || !message) return;
    const label = message.verdict ? `VERDICT // ${String(message.verdict).toUpperCase()}`
      : message.messageType ? String(message.messageType).replaceAll('_', ' ').toUpperCase()
      : message.source === 'bloodTribute' ? 'BLOOD TRIBUTE'
      : 'PRIORITY TRANSMISSION';
    lane.innerHTML = `<strong>${this.escapeHtml(label)}</strong><span>${this.escapeHtml(message.text || message.playerName || 'SYSTEM EVENT')}</span>`;
    lane.hidden = false;
    clearTimeout(this._gmPriorityLaneTimer);
    this._gmPriorityLaneTimer = setTimeout(() => { lane.hidden = true; }, 7000);
  },

  setGMDeliveryState(text, state = '', hideAfter = 0) {
    const node = document.getElementById('gm-chat-delivery-state');
    if (!node) return;
    clearTimeout(this._gmDeliveryTimer);
    node.textContent = text;
    node.dataset.state = state;
    node.hidden = false;
    if (hideAfter) this._gmDeliveryTimer = setTimeout(() => { node.hidden = true; }, hideAfter);
  },

  updateGMNewMessageChip() {
    const chip = document.getElementById('gm-chat-new-messages');
    if (!chip) return;
    chip.hidden = this._gmNewMessageCount <= 0;
    if (!chip.hidden) {
      const parts = [];
      if (this._gmUnreadChat) parts.push(`${this._gmUnreadChat} CHAT`);
      if (this._gmUnreadSystem) parts.push(`${this._gmUnreadSystem} SYSTEM`);
      chip.textContent = `↓ ${parts.join(' · ') || `${this._gmNewMessageCount} NEW`}`;
    }
  },

  jumpToLatestGMChat() {
    const container = document.getElementById('gm-chat-messages');
    if (!container) return;
    this._gmChatProgrammaticScroll = true;
    container.scrollTop = container.scrollHeight;
    this.userScrolledUp = false;
    this._gmNewMessageCount = 0;
    this._gmUnreadChat = 0;
    this._gmUnreadSystem = 0;
    this.updateGMNewMessageChip();
    requestAnimationFrame(() => { this._gmChatProgrammaticScroll = false; });
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
    if (this.roomMode !== 'BATTLE') {
      countEl.hidden = true;
      countEl.textContent = '';
      return;
    }
    const solved = Object.keys(this.solvedTargets).length;
    countEl.hidden = false;
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

    if (this._gmMediaComposer?.hasPending?.()) {
      this._gmMediaComposer.submit();
      return;
    }

    const state = this.syncGMComposerModel();
    const text = state.text.trim();
    if (!text) return;

    const reliquaryCommand = text.match(/^\/reliquary(?:\s+(.+))?$/i);
    const bareCode = /^\d{6}$/.test(text) ? text : '';
    if (reliquaryCommand || bareCode) {
      const code = bareCode || String(reliquaryCommand?.[1] || '').trim();
      this.setGMComposerText('', 0);
      if (this.mode === 'multiplayer' && this.roomCode) this.send({ type: 'gm:reliquaryAccess', code });
      else this.signalReliquaryAccessDenied(false);
      composer.focus();
      return;
    }

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
      this.setGMDeliveryState('SENDING', 'sending');
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

  signalReliquaryAccessDenied(locked = false) {
    const composer = this.getGMComposerElement();
    if (!composer) return;
    const original = composer.dataset.placeholder || 'Transmit to players...';
    composer.dataset.placeholder = locked ? 'RELIQUARY LOCKED // WAIT 60 SECONDS' : 'ACCESS DENIED';
    document.getElementById('shadow-broker-form')?.classList.add('shadow-broker-no-room');
    clearTimeout(this._reliquaryDeniedTimer);
    this._reliquaryDeniedTimer = setTimeout(() => {
      composer.dataset.placeholder = original;
      document.getElementById('shadow-broker-form')?.classList.remove('shadow-broker-no-room');
    }, 2200);
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

    // The red X toggles: pressing it on a message that is already WRONG
    // clears the verdict back to unjudged (server-authoritative, see
    // applyVerdict's null path), mirroring how the heart can be retracted.
    const current = (this.chatMessages || []).find(entry => String(entry.id) === String(messageId));
    this.send({
      type: 'gm:judgeGuess',
      messageId,
      verdict: verdict === 'wrong' && current?.verdict === 'wrong' ? 'clear' : verdict
    });
  },

  // DENY ALL: one server operation marks every unjudged player attempt on
  // the live board WRONG through the same applyVerdict() path as the X.
  denyAllGuesses() {
    if (this.mode !== 'multiplayer' || !this.roomCode) return;
    this.send({ type: 'gm:denyAll' });
  },

  // Unjudged player attempts the server would accept a verdict for.
  pendingAttemptCount() {
    return (this.chatMessages || []).filter(msg => msg.adjudicable === true && msg.deleted !== true && !msg.verdict).length;
  },

  showTargetSelector(messageId) {
    this.pendingVerdict = messageId;
    const container = document.getElementById('gm-chat-messages');
    if (!container) return;

    const msgEl = container.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
    if (!msgEl) return;
    // Mutated in place: the next chat patch must rebuild it, not keep it.
    window.DomPatch?.invalidate(msgEl.closest('#gm-chat-messages > *') || msgEl);

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
          <button type="button" class="gm-target-btn" data-message-id="${this.escapeHtml(messageId)}" data-target="A" title="Column A Solution">A</button>
          <button type="button" class="gm-target-btn" data-message-id="${this.escapeHtml(messageId)}" data-target="B" title="Column B Solution">B</button>
          <button type="button" class="gm-target-btn" data-message-id="${this.escapeHtml(messageId)}" data-target="C" title="Column C Solution">C</button>
          <button type="button" class="gm-target-btn" data-message-id="${this.escapeHtml(messageId)}" data-target="D" title="Column D Solution">D</button>
          <button type="button" class="gm-target-btn final" data-message-id="${this.escapeHtml(messageId)}" data-target="FINAL" title="Final Solution">FINAL</button>
        </div>
        <button type="button" class="gm-verdict-clear" title="Cancel">✕</button>
      </div>
    `;

    if (!controlsEl.dataset.targetPointerBound) {
      controlsEl.dataset.targetPointerBound = '1';
      controlsEl.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) return;
        const btn = event.target.closest('.gm-target-btn');
        if (!btn || btn.disabled) return;
        const target = btn.dataset.target || '';
        const liveMessageId = btn.dataset.messageId || this.pendingVerdict || '';
        if (!liveMessageId || !target) return;

        // Commit before mouseup/click: live chat can re-render from another
        // player's message at any instant and detach this DOM node.
        event.preventDefault();
        event.stopPropagation();
        btn.disabled = true;
        btn.classList.add('is-submitting');
        this.confirmCorrectVerdict(liveMessageId, target);
      });
    }
  },

  confirmCorrectVerdict(messageId, target) {
    if (!messageId || !['A','B','C','D','FINAL'].includes(target)) return;
    if (this.mode !== 'multiplayer' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const btn = document.querySelector(`.gm-target-btn[data-message-id="${CSS.escape(String(messageId))}"][data-target="${CSS.escape(String(target))}"]`);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-submitting');
      }
      return;
    }

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
    // Chat nodes survive re-renders now, so drop the injected picker here.
    document.querySelectorAll('#gm-chat-messages .gm-chat-target-controls').forEach(el => el.remove());
    this.renderGMChat();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
