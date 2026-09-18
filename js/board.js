const Board = {
  container: null,
  sessionState: {},
  history: [],
  maxHistory: 50,
  // Track if we're in a bulk action to group undo
  _bulkAction: false,
  _bulkActionSnapshot: null,

  // SHADOW BROKER BOARD LINE, on the GM's OWN working board this time --
  // the GM was previously expected to confirm a sent transmission via the
  // GUESSES chat log alone, but that's not "seeing what players see." This
  // mirrors App's identical copy for Public View (js/app.js) and
  // PlayerApp's for the player screen (js/player.js) exactly: only
  // (text, startedAt) is stored, and renderShadowBrokerLineHTML()
  // recomputes the visible substring/opacity fresh from wall-clock time on
  // every render() rebuild, so any incidental re-render mid-transmission
  // (a cell reveal, an undo) can never desync or truncate it.
  // _brokerLineTicker just re-invokes render() on a fast interval so the
  // reveal is actually visible frame-by-frame; it self-clears once the
  // state function reports the transmission finished.
  _brokerLineText: null,
  _brokerLineStartedAt: 0,
  _brokerLineTicker: null,
  _brokerLineInterruptedUntil: 0,
  _brokerLineQueue: [],

  init(containerSelector) {
    this.container = document.querySelector(containerSelector);
    this.resetSessionState();
    this.render();
  },

  resetSessionState() {
    this.sessionState = {
      cells: {},
      finalSolution: false,
      // Per-cell equivalent of a WOMF-declared column failure -- only ever
      // set on a solution slot (A5/B5/C5/D5) by the server, keyed by cell
      // key, value 'failed'. See getCellOutcome()/applyServerState().
      cellOutcomes: {},
      // 'success' | 'failed' | null -- mirrors the server's
      // sessionState.finalOutcome (already sent as state.finalSolution.outcome
      // in every state:public broadcast). Drives the same green/red
      // treatment as cellOutcomes, just for the FINAL slot specifically.
      finalOutcome: null,
      // PROGRESSIVE CLUE QUEUE -- per-column list of physical row numbers
      // (1-4) in first-reveal order; position = difficulty index. See
      // setRevealed() below and GameData.getCellData(). Mirrors the
      // server-authoritative version in multiplayer (applyServerState);
      // built locally here for solo/local mode and as the optimistic
      // pre-broadcast value in multiplayer.
      clueOrder: { A: [], B: [], C: [], D: [] }
    };
    this.history = [];
    this._bulkAction = false;
    this._bulkActionSnapshot = null;
    this.updateGMButtons();
  },

  getCellKey(column, row) {
    return `${column}${row}`;
  },

  isRevealed(column, row) {
    const key = this.getCellKey(column, row);
    return this.sessionState.cells[key] === true;
  },

  // WOMF-only: null unless the server tagged this cell 'failed' (a
  // declared column failure force-reveals its solution slot in red rather
  // than the normal reveal color). Always null in local/solo mode.
  getCellOutcome(column, row) {
    const key = this.getCellKey(column, row);
    return (this.sessionState.cellOutcomes && this.sessionState.cellOutcomes[key]) || null;
  },

  getFinalOutcome() {
    return this.sessionState.finalOutcome || null;
  },

  isFinalRevealed() {
    return this.sessionState.finalSolution === true;
  },

  isColumnRevealed(column) {
    for (let row = 1; row <= 5; row++) {
      if (!this.isRevealed(column, row)) return false;
    }
    return true;
  },

  isAllRevealed() {
    const columns = ['A', 'B', 'C', 'D'];
    return columns.every(col => this.isColumnRevealed(col)) && this.isFinalRevealed();
  },

  setRevealed(column, row, revealed) {
    const key = this.getCellKey(column, row);
    const prevState = this.sessionState.cells[key];
    if (prevState === revealed) return false;

    // PROGRESSIVE CLUE QUEUE: a slot's FIRST reveal (rows 1-4 only) appends
    // its physical row number to this column's queue -- position in that
    // array is the difficulty index (see GameData.getCellData()). Hiding
    // never touches the queue, so re-revealing the same slot later shows
    // the same clue. Track whether THIS call did the assigning so undo()
    // can cleanly reverse just that.
    let clueOrderAssigned = false;
    if (revealed && row >= 1 && row <= 4) {
      if (!this.sessionState.clueOrder) this.sessionState.clueOrder = { A: [], B: [], C: [], D: [] };
      const order = this.sessionState.clueOrder[column];
      if (order && !order.includes(row)) {
        order.push(row);
        clueOrderAssigned = true;
      }
    }

    if (!this._bulkAction) {
      this.recordAction({
        type: 'cell',
        column,
        row,
        prevState,
        clueOrderAssigned
      });
    }

    this.sessionState.cells[key] = revealed;
    this.updateCellDisplay(column, row);
    this.updateGMButtons();
    return true;
  },

  setFinalRevealed(revealed) {
    if (this.sessionState.finalSolution === revealed) return false;

    if (!this._bulkAction) {
      this.recordAction({
        type: 'final',
        prevState: this.sessionState.finalSolution
      });
    }

    this.sessionState.finalSolution = revealed;
    this.updateFinalDisplay();
    this.updateGMButtons();
    return true;
  },

  _beginBulkAction() {
    if (this._bulkAction) return;
    this._bulkAction = true;
    this._bulkActionSnapshot = {
      cells: JSON.parse(JSON.stringify(this.sessionState.cells)),
      finalSolution: this.sessionState.finalSolution,
      clueOrder: JSON.parse(JSON.stringify(this.sessionState.clueOrder || { A: [], B: [], C: [], D: [] }))
    };
  },

  _endBulkAction() {
    if (!this._bulkAction) return;
    const prevState = this._bulkActionSnapshot;
    const newState = {
      cells: JSON.parse(JSON.stringify(this.sessionState.cells)),
      finalSolution: this.sessionState.finalSolution,
      clueOrder: JSON.parse(JSON.stringify(this.sessionState.clueOrder || { A: [], B: [], C: [], D: [] }))
    };
    
    // Only record if something actually changed
    const hasChanges = JSON.stringify(prevState) !== JSON.stringify(newState);
    if (hasChanges) {
      this.recordAction({
        type: 'bulk',
        prevState,
        newState
      });
    }
    
    this._bulkAction = false;
    this._bulkActionSnapshot = null;
  },

  revealColumn(column) {
    this._beginBulkAction();
    let changed = false;
    for (let row = 1; row <= 5; row++) {
      if (this.setRevealed(column, row, true)) changed = true;
    }
    this._endBulkAction();
    return changed;
  },

  hideColumn(column) {
    this._beginBulkAction();
    let changed = false;
    for (let row = 1; row <= 5; row++) {
      if (this.setRevealed(column, row, false)) changed = true;
    }
    this._endBulkAction();
    return changed;
  },

  revealAll() {
    this._beginBulkAction();
    let changed = false;
    const columns = ['A', 'B', 'C', 'D'];
    columns.forEach(col => {
      for (let row = 1; row <= 5; row++) {
        if (this.setRevealed(col, row, true)) changed = true;
      }
    });
    if (this.setFinalRevealed(true)) changed = true;
    this._endBulkAction();
    return changed;
  },

  hideAll() {
    this._beginBulkAction();
    let changed = false;
    const columns = ['A', 'B', 'C', 'D'];
    columns.forEach(col => {
      for (let row = 1; row <= 5; row++) {
        if (this.setRevealed(col, row, false)) changed = true;
      }
    });
    if (this.setFinalRevealed(false)) changed = true;
    this._endBulkAction();
    return changed;
  },

  resetBoard() {
    const hadChanges = Object.keys(this.sessionState.cells).some(k => this.sessionState.cells[k]) 
                      || this.sessionState.finalSolution;
    
    if (hadChanges) {
      this.recordAction({
        type: 'reset',
        prevState: JSON.parse(JSON.stringify(this.sessionState))
      });
      this.resetSessionState();
      this.render();
    }
  },

  recordAction(action) {
    this.history.push(action);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  },

  undo() {
    if (this.history.length === 0) return false;

    const action = this.history.pop();
    
    switch (action.type) {
      case 'cell':
        this.sessionState.cells[`${action.column}${action.row}`] = action.prevState;
        // If THIS reveal was what first assigned the slot's queue position,
        // undoing it releases that position -- the row goes back to
        // "unassigned" so a future re-reveal gets a fresh (possibly
        // different) queue slot, exactly reversing setRevealed()'s effect.
        if (action.clueOrderAssigned && this.sessionState.clueOrder) {
          const order = this.sessionState.clueOrder[action.column];
          if (order) {
            const idx = order.indexOf(action.row);
            if (idx !== -1) order.splice(idx, 1);
          }
        }
        this.updateCellDisplay(action.column, action.row);
        break;
      case 'final':
        this.sessionState.finalSolution = action.prevState;
        this.updateFinalDisplay();
        break;
      case 'bulk':
        this.sessionState = action.prevState;
        this.render();
        break;
      case 'reset':
        this.sessionState = action.prevState;
        this.render();
        break;
    }
    
    this.updateGMButtons();
    return true;
  },

  canUndo() {
    return this.history.length > 0;
  },

  updateCellDisplay(column, row) {
    const key = this.getCellKey(column, row);
    const cell = this.container.querySelector(`[data-cell="${key}"]`);
    if (!cell) return;

    const revealed = this.sessionState.cells[key] === true;
    cell.classList.toggle('hidden', !revealed);
    cell.classList.toggle('revealed', revealed);
    const outcome = this.sessionState.cellOutcomes && this.sessionState.cellOutcomes[key];
    cell.classList.toggle('outcome-failed', outcome === 'failed');

    // PROGRESSIVE CLUE QUEUE: a physical slot's word is only pinned down
    // the moment it's actually (re-)revealed -- buildBoardHTML() baked in
    // whatever GameData.getCellData() returned at the LAST FULL RENDER,
    // which for a not-yet-assigned row 1-4 slot is only a best-guess
    // preview (the next upcoming clue) and goes stale the instant a
    // sibling slot in the same column claims a queue position. Refresh
    // the tile's actual word here, every time its reveal state changes,
    // so it always reflects the column's current queue -- mirrors what
    // updateGMButtons() already does for the CLUE GRID sidebar buttons.
    if (window.GameData && window.GameData.currentGame) {
      const contentEl = cell.querySelector('.cell-content');
      if (contentEl) {
        const content = GameData.getCellData(column, row);
        contentEl.textContent = content || '—';
      }
    }
  },

  updateFinalDisplay() {
    const cell = this.container.querySelector('[data-cell="FINAL"]');
    if (!cell) return;

    const revealed = this.sessionState.finalSolution === true;
    cell.classList.toggle('hidden', !revealed);
    cell.classList.toggle('revealed', revealed);
    cell.classList.toggle('outcome-failed', this.getFinalOutcome() === 'failed');
  },

  updateGMButtons() {
    const game = window.GameData && window.GameData.currentGame;
    document.querySelectorAll('.gm-cell-btn').forEach(btn => {
      const column = btn.dataset.column;
      const row = parseInt(btn.dataset.row, 10);
      const wordEl = btn.querySelector('span:last-child');
      if (column && row) {
        const revealed = this.isRevealed(column, row);
        btn.classList.toggle('revealed', revealed);
        btn.classList.toggle('outcome-failed', this.getCellOutcome(column, row) === 'failed');
        if (wordEl) wordEl.textContent = game ? (window.GameData.getCellData(column, row) || '') : '';
      } else if (btn.dataset.final === 'true') {
        const revealed = this.isFinalRevealed();
        btn.classList.toggle('revealed', revealed);
        btn.classList.toggle('outcome-failed', this.getFinalOutcome() === 'failed');
        if (wordEl) wordEl.textContent = game ? (window.GameData.getFinalSolution() || '') : '';
      }
    });

    const undoBtn = document.querySelector('.gm-global-btn.undo-btn');
    if (undoBtn) {
      undoBtn.disabled = !this.canUndo();
    }
  },

  render() {
    if (!this.container || !window.GameData.currentGame) return;

    this.container.innerHTML = this.buildBoardHTML(window.GameData.currentGame);
    Skeleton.attach(this.container);
    this.updateGMButtons();
  },

  renderInto(containerSelector, game) {
    const el = typeof containerSelector === 'string' ? document.querySelector(containerSelector) : containerSelector;
    if (!el) return;
    el.innerHTML = this.buildBoardHTML(game || window.GameData.currentGame);
    Skeleton.attach(el);
  },

  // Lightweight refresh for a live, decorative-only difficulty change:
  // swaps the already-rendered skeleton poster's image src in place,
  // without rebuilding the board (which would blow away sessionState-
  // driven reveal/hide DOM classes on the cells). Mirrors the mapping
  // used at initial render time in
  // buildBoardHTML() -> Skeleton.skeletonHTML(game.difficulty).
  updateSkeleton(difficulty) {
    if (!this.container) return;
    const img = this.container.querySelector('.skeleton-img');
    if (!img) return;
    img.src = Skeleton.skeletonPath(difficulty);
  },

  renderPreview(containerSelector, game) {
    const el = typeof containerSelector === 'string' ? document.querySelector(containerSelector) : containerSelector;
    if (!el) return;
    const prevIsRevealed = this.isRevealed;
    const prevIsFinal = this.isFinalRevealed;
    this.isRevealed = () => false;
    this.isFinalRevealed = () => false;
    try {
      el.innerHTML = this.buildBoardHTML(game || window.GameData.currentGame);
      Skeleton.attach(el);
    } finally {
      this.isRevealed = prevIsRevealed;
      this.isFinalRevealed = prevIsFinal;
    }
  },

  buildBoardHTML(game) {
    if (!game) return '';
    const columns = ['A', 'B', 'C', 'D'];
    // Route through the queue-aware GameData.getCellData() for the actual
    // loaded game (so physical slots show the correct progressive-queue
    // clue), but keep the naive direct index for Forge's preview calls,
    // which pass an arbitrary in-progress DRAFT game object that was never
    // loaded into GameData.currentGame and has no reveal/queue state of
    // its own -- Forge always wants to preview clue1/clue2/clue3/clue4 in
    // their natural slots while editing.
    const cellData = (col, row) => {
      if (game === GameData.currentGame) return GameData.getCellData(col, row) || '';
      if (row >= 1 && row <= 4) return game.columns[col]?.clues?.[row - 1] || '';
      if (row === 5) return game.columns[col]?.solution || '';
      return '';
    };
    let html = '';

    for (let row = 1; row <= 4; row++) {
      columns.forEach(col => {
        const key = this.getCellKey(col, row);
        const content = cellData(col, row);
        const isSolution = false;
        const revealed = this.isRevealed(col, row);

        html += this.createCellHTML(key, content, isSolution, revealed, `${col}${row}`);
      });
    }

    columns.forEach(col => {
      const key = this.getCellKey(col, 5);
      const content = cellData(col, 5);
      const isSolution = true;
      const revealed = this.isRevealed(col, 5);
      const outcome = this.getCellOutcome(col, 5);

      html += this.createCellHTML(key, content, isSolution, revealed, `${col}5`, false, outcome);
    });

    const finalRevealed = this.isFinalRevealed();
    // Never put the real Final Solution word in the DOM while it's hidden
    // -- "???" at all times until it's actually revealed (by a correct
    // guess, a GM reveal, or a future timer expiry), same placeholder the
    // Public View and player join.html already use.
    const finalContent = finalRevealed ? (game.finalSolution || '') : '???';
    const finalOutcome = this.getFinalOutcome();
    html += this.createCellHTML('FINAL', finalContent, true, finalRevealed, 'FINAL', true, finalOutcome);

    return Skeleton.skeletonHTML(game.difficulty) + this.renderShadowBrokerLineHTML() + html;
  },

  // See PlayerApp's identical copy in js/player.js for the full rationale.
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

  // Called by App (js/app.js) the instant a new Shadow Broker message
  // (the GM's own broadcast, or a verdict response) lands in chat:update
  // -- alongside its own identical call for Public View -- so the GM's
  // own working board shows exactly what players are about to see,
  // without needing to switch to Public View to check.
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
      this.render();
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
    this.render();
  },

  createCellHTML(key, content, isSolution, revealed, label, isFinal = false, outcome = null) {
    const classes = ['board-cell'];
    if (isSolution) classes.push('solution-cell');
    if (isFinal) classes.push('final-solution');
    if (!revealed) classes.push('hidden');
    else classes.push('revealed');
    if (outcome === 'failed') classes.push('outcome-failed');

    return `
      <div class="${classes.join(' ')}" data-cell="${key}" data-label="${label}" style="${Skeleton.cellStyle(label)}">
        <div class="cell-content">${this.escapeHtml(content || '—')}</div>
      </div>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  getSessionState() {
    return JSON.parse(JSON.stringify(this.sessionState));
  },

  setSessionState(state) {
    this.sessionState = state || { cells: {}, finalSolution: false, cellOutcomes: {}, finalOutcome: null, clueOrder: { A: [], B: [], C: [], D: [] } };
    if (!this.sessionState.clueOrder) this.sessionState.clueOrder = { A: [], B: [], C: [], D: [] };
    this.history = [];
    this.render();
  },

  exportState() {
    return {
      gameId: GameData.currentGame?.id,
      sessionState: this.getSessionState(),
      timestamp: new Date().toISOString()
    };
  },

  // Export sanitized public state - ONLY reveals currently visible information
  // Hidden answers are completely omitted, not just marked as hidden
  exportPublicState() {
    const game = GameData.currentGame;
    if (!game) return null;

    const columns = ['A', 'B', 'C', 'D'];
    const publicCells = {};

    for (let row = 1; row <= 4; row++) {
      columns.forEach(col => {
        const key = `${col}${row}`;
        const revealed = this.isRevealed(col, row);
        if (revealed) {
          publicCells[key] = {
            revealed: true,
            value: GameData.getCellData(col, row)
          };
        } else {
          publicCells[key] = { revealed: false };
        }
      });
    }

    columns.forEach(col => {
      const key = `${col}5`;
      const revealed = this.isRevealed(col, 5);
      if (revealed) {
        publicCells[key] = {
          revealed: true,
          value: GameData.getCellData(col, 5)
        };
      } else {
        publicCells[key] = { revealed: false };
      }
    });

    const finalRevealed = this.isFinalRevealed();
    const finalSolution = GameData.getFinalSolution();
    const finalCell = finalRevealed 
      ? { revealed: true, value: finalSolution }
      : { revealed: false };

    return {
      gameId: game.id,
      title: game.title,
      theme: game.theme,
      difficulty: game.difficulty,
      cells: publicCells,
      finalSolution: finalCell,
      timestamp: new Date().toISOString()
    };
  }
};

window.Board = Board;