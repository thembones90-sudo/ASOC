/*
 * ASOC ENGINE - The Forge
 * Gamemaster Game Library + Game Creator.
 * All filesystem operations are delegated to the server API
 * (game-store.js) - never direct file access from the browser.
 */

const Forge = {
  isOpen: false,
  view: 'library',
  games: [],
  backgrounds: [],
  editingGame: null,
  isNew: false,
  dirty: false,
  searchTerm: '',
  sortBy: 'newest',
  difficultyFilter: 'ALL',
  _debounceTimer: null,

  CANVAS_W: 1900,
  CANVAS_H: 1267,

  init() {
    const overlay = document.getElementById('forge-overlay');
    if (!overlay) return;

    overlay.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-forge-close], [data-forge-cancel]');
      if (closeBtn) {
        if (this.view === 'creator' && this.dirty) {
          if (!confirm('Discard unsaved changes to this game?')) return;
          this.clearDraft();
        }
        this.close();
        return;
      }

      if (e.target.closest('[data-forge-new]')) {
        this.openCreator(null, true);
        return;
      }
      if (e.target.closest('[data-forge-import-xlsx]')) {
        document.getElementById('forge-xlsx-input')?.click();
        return;
      }
      if (e.target.closest('[data-forge-back-library]')) {
        if (this.dirty) {
          if (!confirm('Discard unsaved changes and return to library?')) return;
          this.clearDraft();
        }
        this.renderLibrary();
        return;
      }
      if (e.target.closest('[data-forge-save]')) {
        this.saveGame();
        return;
      }
      if (e.target.closest('[data-forge-continue-edit]')) {
        this.dirty = false;
        this.renderCreator();
        return;
      }

      const loadBtn = e.target.closest('[data-game-load]');
      if (loadBtn) {
        this.loadGame(loadBtn.dataset.gameLoad);
        return;
      }
      const editBtn = e.target.closest('[data-game-edit]');
      if (editBtn) {
        this.openCreatorFromLibrary(editBtn.dataset.gameEdit);
        return;
      }
      const dupBtn = e.target.closest('[data-game-dup]');
      if (dupBtn) {
        this.duplicateGame(dupBtn.dataset.gameDup);
        return;
      }
      const delBtn = e.target.closest('[data-game-del]');
      if (delBtn) {
        this.deleteGame(delBtn.dataset.gameDel);
        return;
      }
      const bgDelHover = e.target.closest('[data-remove-bg]');
      if (bgDelHover) {
        this.removeBackgroundUpload();
        return;
      }
    });

    this.initCreatorUX(overlay);

    overlay.addEventListener('input', (e) => {
      const search = e.target.closest('#forge-search');
      if (search) {
        this.searchTerm = search.value;
        this.renderLibraryBody();
        return;
      }
      const field = e.target.closest('[data-creator-field]');
      if (field) this.onFieldChange(field);
    });

    overlay.addEventListener('change', (e) => {
      const sort = e.target.closest('#forge-sort');
      if (sort) {
        this.sortBy = sort.value;
        this.renderLibraryBody();
        return;
      }
      const filter = e.target.closest('#forge-filter');
      if (filter) {
        this.difficultyFilter = filter.value;
        this.renderLibraryBody();
        return;
      }
      const field = e.target.closest('[data-creator-field]');
      if (field) this.onFieldChange(field);

      const bgSelect = e.target.closest('[data-creator-background]');
      if (bgSelect) {
        this.editingGame.background = bgSelect.value;
        this.dirty = true;
        this.updatePreview();
        this.updatePreviewBackground();
      }

      const upload = e.target.closest('[data-bg-upload]');
      if (upload && upload.files && upload.files[0]) {
        this.uploadBackground(upload.files[0]);
        upload.value = '';
      }

      const xlsxInput = e.target.closest('#forge-xlsx-input');
      if (xlsxInput && xlsxInput.files && xlsxInput.files[0]) {
        this.importXlsxFile(xlsxInput.files[0]);
        xlsxInput.value = '';
      }
    });
  },

  getGameById(id) {
    return this.games.find(g => g.id === id) || null;
  },

  async open() {
    this.isOpen = true;
    document.getElementById('forge-overlay').classList.add('active');
    await this.reloadLibrary();
    this.renderLibrary();
  },

  close() {
    this.isOpen = false;
    this.dirty = false;
    this.editingGame = null;
    document.getElementById('forge-overlay').classList.remove('active');
  },

  async reloadLibrary() {
    await GameData.loadBackgroundList();
    this.backgrounds = GameData.availableBackgrounds || [];
    await GameData.loadGameList();
    this.games = GameData.availableGames || [];
  },

  getSortedFilteredGames() {
    let list = this.games.slice();

    if (this.difficultyFilter && this.difficultyFilter !== 'ALL') {
      list = list.filter(g => g.difficulty === this.difficultyFilter);
    }

    const term = this.searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter(g =>
        (g.title || '').toLowerCase().includes(term) ||
        (g.theme || '').toLowerCase().includes(term) ||
        (g.finalSolution || '').toLowerCase().includes(term)
      );
    }

    switch (this.sortBy) {
      case 'oldest':
        list.sort((a, b) => String(a.created).localeCompare(String(b.created)));
        break;
      case 'title':
        list.sort((a, b) => String(a.title).localeCompare(String(b.title)));
        break;
      case 'difficulty':
        list.sort((a, b) => GameData.DIFFICULTY_VALUES.indexOf(a.difficulty) - GameData.DIFFICULTY_VALUES.indexOf(b.difficulty));
        break;
      case 'newest':
      default:
        list.sort((a, b) => String(b.modified || b.created || '').localeCompare(String(a.modified || a.created || '')));
        break;
    }

    return list;
  },

  renderLibrary() {
    this.view = 'library';
    const shell = document.getElementById('forge-shell');
    if (!shell) return;

    shell.innerHTML = `
      <div class="forge-header">
        <span class="forge-title">GAME LIBRARY</span>
        <button class="forge-close" data-forge-close title="Close">✕</button>
      </div>
      <div class="forge-toolbar">
        <button class="forge-btn primary" data-forge-new>NEW GAME</button>
        <button class="forge-btn" data-forge-import-xlsx>IMPORT FROM EXCEL</button>
        <input type="file" id="forge-xlsx-input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display: none;">
        <button class="forge-btn ghost" data-forge-close>CLOSE</button>
      </div>
      <div class="forge-toolbar-row">
        <input type="search" class="forge-input" id="forge-search" placeholder="Search title / theme / final..." value="${this.escapeAttr(this.searchTerm)}">
        <select class="forge-select" id="forge-sort">
          <option value="newest" ${this.sortBy === 'newest' ? 'selected' : ''}>NEWEST</option>
          <option value="oldest" ${this.sortBy === 'oldest' ? 'selected' : ''}>OLDEST</option>
          <option value="title" ${this.sortBy === 'title' ? 'selected' : ''}>TITLE</option>
          <option value="difficulty" ${this.sortBy === 'difficulty' ? 'selected' : ''}>DIFFICULTY</option>
        </select>
        <select class="forge-select" id="forge-filter">
          <option value="ALL" ${this.difficultyFilter === 'ALL' ? 'selected' : ''}>ALL DIFFICULTY</option>
          ${GameData.DIFFICULTY_VALUES.map(d => `<option value="${d}" ${this.difficultyFilter === d ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="forge-library" id="forge-library-body"></div>
    `;

    this.renderLibraryBody();
  },

  renderLibraryBody() {
    const body = document.getElementById('forge-library-body');
    if (!body) return;

    const list = this.getSortedFilteredGames();

    if (list.length === 0) {
      body.innerHTML = `
        <div class="forge-empty">
          <div class="forge-empty-title">NO GAMES FOUND</div>
          <div class="forge-empty-sub">Create your first ASOC board.</div>
          <button class="forge-btn primary" data-forge-new>NEW GAME</button>
        </div>
      `;
      return;
    }

    body.innerHTML = list.map(g => {
      const isSample = g.isSample === true;
      const modified = g.modified ? new Date(g.modified).toLocaleString() : g.created || '';
      return `
        <div class="game-card">
          <div class="game-card-top">
            <div class="game-card-title-wrap">
              <span class="game-card-title">${this.escapeHtml(g.title)}</span>
              ${isSample ? '<span class="game-card-sample">SAMPLE</span>' : ''}
            </div>
            <span class="difficulty-badge diff-${g.difficulty.toLowerCase()}">${g.difficulty}</span>
          </div>
          <div class="game-card-theme">${g.theme ? this.escapeHtml(g.theme) : '—'}</div>
          <div class="game-card-final">FINAL: <span>${this.escapeHtml(g.finalSolution || '—')}</span></div>
          <div class="game-card-meta">
            <span>${this.escapeHtml(g.background || '')}</span>
            <span>${isSample ? 'SAMPLE' : modified}</span>
          </div>
          <div class="game-card-actions">
            <button class="forge-btn" data-game-load="${this.escapeAttr(g.id)}">LOAD</button>
            <button class="forge-btn" data-game-edit="${this.escapeAttr(g.id)}">EDIT</button>
            <button class="forge-btn" data-game-dup="${this.escapeAttr(g.id)}">DUPLICATE</button>
            <button class="forge-btn danger" data-game-del="${this.escapeAttr(g.id)}" ${isSample ? 'disabled title="Sample game cannot be deleted"' : ''}>DELETE</button>
          </div>
        </div>
      `;
    }).join('');
  },

  async openCreatorFromLibrary(id) {
    try {
      const full = await GameData.fetchGame(id);
      this.openCreator(full, false);
    } catch (e) {
      alert('Could not load game for editing: ' + e.message);
    }
  },

  openCreator(game, isNew) {
    const base = game || this.emptyDraft();
    this.editingGame = JSON.parse(JSON.stringify(base));
    this.isNew = !!isNew;
    this.dirty = false;
    this.view = 'creator';
    this._showMissing = false;
    this._longLabels = new Set();
    this.renderCreator();
    this.offerDraft();
    setTimeout(() => this.focusField(this.isNew && !this.editingGame.theme ? 'theme' : 'A1', { select: false }), 60);
  },

  emptyDraft() {
    return {
      id: '',
      title: '',
      theme: '',
      background: this.backgrounds[0]?.path || '',
      difficulty: 'GREEN',
      columns: {
        A: { clues: ['', '', '', ''], solution: '' },
        B: { clues: ['', '', '', ''], solution: '' },
        C: { clues: ['', '', '', ''], solution: '' },
        D: { clues: ['', '', '', ''], solution: '' }
      },
      finalSolution: '',
      story: '',
      gmNotes: '',
      hints: [],
      cellHints: {},
      created: new Date().toISOString().split('T')[0]
    };
  },

  // Fill order for ENTER navigation and plain-list pastes: down each column
  // (A1-A5, B1-B5, ...), then the FINAL.
  FIELD_ORDER: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4', 'C5', 'D1', 'D2', 'D3', 'D4', 'D5', 'finalSolution'],
  HINT_MAX: 160,
  DRAFT_PREFIX: 'asoc_forge_draft:',

  renderCreator() {
    this.view = 'creator';
    const shell = document.getElementById('forge-shell');
    if (!shell) return;

    const d = this.editingGame;
    if (!d.cellHints || typeof d.cellHints !== 'object') d.cellHints = {};
    const cols = ['A', 'B', 'C', 'D'];

    const colHtml = cols.map(col => {
      const colData = d.columns[col] || { clues: ['', '', '', ''], solution: '' };
      const cellInputs = [1, 2, 3, 4].map(r => `
        <label class="cell-field" data-cell-wrap="${col}${r}">
          <span class="cell-field-label">${col}${r}<i class="creator-hint-dot" title="Has a prepared hint"${d.cellHints[`${col}${r}`] ? '' : ' hidden'}></i></span>
          <input type="text" class="forge-input" data-creator-field="${col}${r}" maxlength="60" autocomplete="off" value="${this.escapeAttr(colData.clues[r - 1] || '')}">
        </label>
      `).join('');
      return `
        <div class="creator-col">
          <div class="creator-col-header">COLUMN ${col}</div>
          ${cellInputs}
          <label class="cell-field solution" data-cell-wrap="${col}5">
            <span class="cell-field-label">${col}5 · SOLUTION</span>
            <input type="text" class="forge-input" data-creator-field="${col}5" maxlength="60" autocomplete="off" value="${this.escapeAttr(colData.solution || '')}">
          </label>
        </div>
      `;
    }).join('');

    const legacyHints = Array.isArray(d.hints) && d.hints.length;
    const heading = this.isNew ? 'NEW GAME — ASOC CREATOR' : `EDIT GAME — ${this.escapeHtml(d.theme || d.title || 'ASOC CREATOR')}`;

    shell.innerHTML = `
      <div class="forge-header">
        <span class="forge-title">${heading}</span>
        <span class="creator-progress" id="creator-progress" aria-live="polite"></span>
        <button class="forge-close" data-forge-close title="Close">✕</button>
      </div>
      <div class="creator-draft-banner" id="creator-draft-banner" hidden></div>
      <div class="creator-grid">
        <div class="creator-form">
          <div class="creator-section">
            <h4 class="creator-label">IDENTITY</h4>
            <label class="cell-field" data-cell-wrap="theme">
              <span class="cell-field-label">THEME</span>
              <input type="text" class="forge-input" data-creator-field="theme" maxlength="80" autocomplete="off" value="${this.escapeAttr(d.theme)}" placeholder="e.g. Birth of Earth">
            </label>
            <label class="cell-field">
              <span class="cell-field-label">DIFFICULTY</span>
              <select class="forge-select" data-creator-field="difficulty">
                ${GameData.DIFFICULTY_VALUES.map(v => `<option value="${v}" ${d.difficulty === v ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
          </div>

          <div class="creator-section">
            <h4 class="creator-label">BACKGROUND</h4>
            <label class="cell-field">
              <span class="cell-field-label">SELECT BACKGROUND</span>
              <select class="forge-select" data-creator-background>
                ${this.backgrounds.map(b => `<option value="${this.escapeAttr(b.path)}" ${d.background === b.path ? 'selected' : ''}>${this.escapeHtml(b.filename)}</option>`).join('')}
              </select>
            </label>
            <div class="forge-error" id="creator-bg-warning" style="display: none;">Not the canonical 1900 × 1267 size. It will be displayed without distortion instead of resized.</div>
            <div class="upload-zone">
              <label class="upload-label">
                ADD BACKGROUND
                <input type="file" class="upload-input" data-bg-upload accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml">
              </label>
              <span class="upload-note">PNG · JPG · WEBP · SVG — max 10 MB</span>
              <span class="upload-status" id="upload-status"></span>
            </div>
          </div>

          <div class="creator-section">
            <h4 class="creator-label">BOARD — ALL 20 ENTRIES + FINAL</h4>
            <div class="creator-board-tools">
              <button type="button" class="forge-btn ghost creator-tool-btn" data-creator-paste>PASTE WHOLE BOARD</button>
              <span class="creator-tip">ENTER → next field · SHIFT+ENTER ← back · click the preview board to jump to a field</span>
            </div>
            <div class="creator-cols">${colHtml}</div>
            <label class="cell-field final" data-cell-wrap="finalSolution">
              <span class="cell-field-label">FINAL SOLUTION</span>
              <input type="text" class="forge-input" data-creator-field="finalSolution" maxlength="60" autocomplete="off" value="${this.escapeAttr(d.finalSolution)}" placeholder="The final answer">
            </label>
            <div class="creator-hint-bar" id="creator-hint-bar" hidden>
              <span class="cell-field-label" id="creator-hint-label">HINT FOR A1</span>
              <input type="text" class="forge-input" data-creator-hint maxlength="${this.HINT_MAX}" autocomplete="off" placeholder="Optional. Shown to you (GM only) when a player asks for this row's hint.">
            </div>
            <div class="creator-warnings" id="creator-warnings" aria-live="polite"></div>
          </div>

          <div class="creator-section">
            <h4 class="creator-label">OPTIONAL METADATA</h4>
            <label class="cell-field">
              <span class="cell-field-label">STORY</span>
              <textarea class="forge-textarea" data-creator-field="story" rows="2">${this.escapeHtml(d.story || '')}</textarea>
            </label>
            <label class="cell-field">
              <span class="cell-field-label">GM NOTES</span>
              <textarea class="forge-textarea" data-creator-field="gmNotes" rows="2">${this.escapeHtml(d.gmNotes || '')}</textarea>
            </label>
            ${legacyHints ? `
            <label class="cell-field">
              <span class="cell-field-label">OLDER HINTS (ONE PER LINE) — new hints go on each board field</span>
              <textarea class="forge-textarea" data-creator-field="hints" rows="3">${this.escapeHtml(d.hints.join('\n'))}</textarea>
            </label>` : ''}
          </div>

          <div id="forge-errors" class="forge-errors"></div>

          <div class="forge-actions">
            <button class="forge-btn primary" data-forge-save>${this.isNew ? 'SAVE GAME' : 'SAVE CHANGES'}</button>
            <button class="forge-btn ghost" data-forge-back-library>BACK TO LIBRARY</button>
          </div>
        </div>

        <div class="creator-preview">
          <div class="creator-preview-header">
            <span>${'LIVE PREVIEW'}</span>
            <span class="creator-preview-tools">
              <button type="button" class="creator-test-btn" data-creator-test aria-pressed="false">TEST PLAY</button>
              <button type="button" class="creator-test-btn" data-creator-test-reset hidden>HIDE ALL</button>
            </span>
          </div>
          <div class="creator-test-note" id="creator-test-note" hidden>TEST PLAY // click cells to reveal them like in a real game. Nothing is saved.</div>
          <div class="creator-preview-stage">
            <div class="creator-preview-frame">
              <img class="creator-bg" id="creator-bg" alt="Preview background">
              <div class="public-header creator-preview-title">
                <div class="public-title"></div>
              </div>
              <div class="asoc-board" id="creator-board"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="creator-paste" id="creator-paste" hidden>
        <div class="creator-paste-card" role="dialog" aria-modal="true" aria-labelledby="creator-paste-title">
          <h4 id="creator-paste-title">PASTE WHOLE BOARD</h4>
          <p>Paste either <b>21 lines</b> in order (A1…A5, B1…B5, C1…C5, D1…D5, FINAL), lines like <b>A1: word</b>, or a <b>spreadsheet block</b> (4 columns × 5 rows, optional 6th row with the FINAL).</p>
          <textarea class="forge-textarea" id="creator-paste-text" rows="12" spellcheck="false"></textarea>
          <div class="creator-paste-status" id="creator-paste-status"></div>
          <div class="forge-actions">
            <button type="button" class="forge-btn primary" data-creator-paste-apply>FILL BOARD</button>
            <button type="button" class="forge-btn ghost" data-creator-paste-cancel>CANCEL</button>
          </div>
        </div>
      </div>
    `;

    this._testPlay = false;
    this._testRevealed = new Set();
    this.updatePreviewTitle();
    this.updatePreview();
    this.updatePreviewBackground();
    this.refreshCreatorState();
  },

  // ------------------------------------------------------------------
  // Creator helpers
  fieldInput(name) {
    return document.querySelector(`#forge-shell [data-creator-field="${name}"]`);
  },

  fieldValue(name) {
    const d = this.editingGame;
    if (!d) return '';
    if (name === 'finalSolution') return d.finalSolution || '';
    if (name === 'theme') return d.theme || '';
    const m = /^([A-D])([1-5])$/.exec(name);
    if (!m) return '';
    const col = d.columns[m[1]] || {};
    return (m[2] === '5' ? col.solution : col.clues?.[Number(m[2]) - 1]) || '';
  },

  previewLabelFor(name) { return name === 'finalSolution' ? 'FINAL' : name; },
  fieldForPreviewLabel(label) { return label === 'FINAL' ? 'finalSolution' : label; },

  // Progress, missing / duplicate / too-long marks, all from the draft.
  refreshCreatorState() {
    const d = this.editingGame;
    if (!d || this.view !== 'creator') return;
    const filled = this.FIELD_ORDER.filter(name => String(this.fieldValue(name)).trim()).length;
    const total = this.FIELD_ORDER.length;
    const progress = document.getElementById('creator-progress');
    if (progress) {
      const themeMissing = !String(d.theme || '').trim();
      const ready = filled === total && !themeMissing;
      progress.textContent = ready ? `${filled} / ${total} FILLED · READY TO SAVE` : `${filled} / ${total} FILLED${themeMissing ? ' · THEME MISSING' : ''}`;
      progress.classList.toggle('is-ready', ready);
    }

    // Missing fields are only outlined after a save attempt.
    ['theme', ...this.FIELD_ORDER].forEach(name => {
      const input = this.fieldInput(name);
      if (input) input.classList.toggle('is-missing', !!this._showMissing && !String(this.fieldValue(name)).trim());
    });

    // Duplicates (warning only, never blocks saving).
    const byWord = new Map();
    this.FIELD_ORDER.forEach(name => {
      const word = String(this.fieldValue(name)).trim().toLocaleUpperCase();
      if (!word) return;
      if (!byWord.has(word)) byWord.set(word, []);
      byWord.get(word).push(this.previewLabelFor(name));
    });
    const dupes = [...byWord.entries()].filter(([, labels]) => labels.length > 1);
    const dupeLabels = new Set(dupes.flatMap(([, labels]) => labels));
    this.FIELD_ORDER.forEach(name => this.fieldInput(name)?.classList.toggle('is-duplicate', dupeLabels.has(this.previewLabelFor(name))));
    const longLabels = this._longLabels || new Set();
    this.FIELD_ORDER.forEach(name => this.fieldInput(name)?.classList.toggle('is-long', longLabels.has(this.previewLabelFor(name))));

    const warnings = [];
    dupes.forEach(([word, labels]) => warnings.push(`DUPLICATE // “${word}” is used in ${labels.join(', ')}`));
    if (longLabels.size) warnings.push(`LONG WORDS // ${[...longLabels].join(', ')} will be shrunk a lot on the board (hard to read from afar)`);
    const box = document.getElementById('creator-warnings');
    if (box) {
      const html = warnings.map(w => `<div class="creator-warning">${this.escapeHtml(w)}</div>`).join('');
      if (box.innerHTML !== html) box.innerHTML = html;
    }
  },

  // Highlight the preview cell of the field being typed in.
  highlightPreview(name) {
    const board = document.getElementById('creator-board');
    if (!board) return;
    board.querySelectorAll('.board-cell.creator-focus').forEach(el => el.classList.remove('creator-focus'));
    if (!name) return;
    const label = this.previewLabelFor(name);
    board.querySelector(`.board-cell[data-label="${label}"]`)?.classList.add('creator-focus');
  },

  focusField(name, { select = true } = {}) {
    const input = this.fieldInput(name);
    if (!input) return;
    input.focus({ preventScroll: false });
    input.scrollIntoView({ block: 'nearest' });
    if (select) input.select?.();
    const wrap = input.closest('.cell-field');
    if (wrap) {
      wrap.classList.remove('creator-flash');
      void wrap.offsetWidth;
      wrap.classList.add('creator-flash');
    }
  },

  // Per-cell hint bar follows the focused clue field (rows 1-4 only: hint
  // requests exist for opened clue rows).
  showHintBar(name) {
    const bar = document.getElementById('creator-hint-bar');
    if (!bar) return;
    if (!/^[A-D][1-4]$/.test(name || '')) {
      if (!bar.contains(document.activeElement)) bar.hidden = true;
      return;
    }
    this._hintCell = name;
    bar.hidden = false;
    const label = document.getElementById('creator-hint-label');
    if (label) label.textContent = `HINT FOR ${name}`;
    const input = bar.querySelector('[data-creator-hint]');
    if (input) input.value = this.editingGame.cellHints?.[name] || '';
  },

  setCellHint(value) {
    const cell = this._hintCell;
    if (!cell || !this.editingGame) return;
    const hints = this.editingGame.cellHints || (this.editingGame.cellHints = {});
    const text = String(value || '').slice(0, this.HINT_MAX);
    if (text.trim()) hints[cell] = text;
    else delete hints[cell];
    const dot = document.querySelector(`#forge-shell [data-cell-wrap="${cell}"] .creator-hint-dot`);
    if (dot) dot.hidden = !text.trim();
    this.markDirty();
  },

  markDirty() {
    this.dirty = true;
    clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => this.saveDraft(), 400);
  },

  // ------------------------------------------------------------------
  // Auto-saved drafts (this browser only): a reload or an accidental close
  // never loses a half-built board.
  draftKey() {
    return this.DRAFT_PREFIX + (this.isNew ? 'new' : String(this.editingGame?.id || 'new'));
  },

  saveDraft() {
    if (!this.editingGame || this.view !== 'creator' || !this.dirty) return;
    try {
      localStorage.setItem(this.draftKey(), JSON.stringify({ savedAt: Date.now(), game: this.editingGame }));
    } catch (_) { /* storage unavailable: drafts are a convenience only */ }
  },

  readDraft() {
    try {
      const raw = localStorage.getItem(this.draftKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.game && typeof parsed.game === 'object' ? parsed : null;
    } catch (_) { return null; }
  },

  clearDraft() {
    clearTimeout(this._draftTimer);
    try { localStorage.removeItem(this.draftKey()); } catch (_) { /* ignore */ }
  },

  offerDraft() {
    const draft = this.readDraft();
    const banner = document.getElementById('creator-draft-banner');
    if (!banner) return;
    if (!draft || JSON.stringify(draft.game) === JSON.stringify(this.editingGame)) {
      banner.hidden = true;
      return;
    }
    const when = new Date(draft.savedAt || Date.now());
    const stamp = when.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const filled = this.FIELD_ORDER.filter(name => {
      const m = /^([A-D])([1-5])$/.exec(name);
      const g = draft.game;
      const v = name === 'finalSolution' ? g.finalSolution : (m && (m[2] === '5' ? g.columns?.[m[1]]?.solution : g.columns?.[m[1]]?.clues?.[Number(m[2]) - 1]));
      return String(v || '').trim();
    }).length;
    banner.innerHTML = `<span>UNSAVED DRAFT FOUND // ${this.escapeHtml(draft.game.theme || 'UNTITLED')} · ${filled}/21 FILLED · ${this.escapeHtml(stamp)}</span><button type="button" class="forge-btn primary" data-creator-draft-restore>RESTORE DRAFT</button><button type="button" class="forge-btn ghost" data-creator-draft-discard>DISCARD</button>`;
    banner.hidden = false;
  },

  restoreDraft() {
    const draft = this.readDraft();
    if (!draft) return;
    const keepId = this.editingGame?.id;
    this.editingGame = JSON.parse(JSON.stringify(draft.game));
    if (!this.isNew && keepId) this.editingGame.id = keepId;
    this.renderCreator();
    this.dirty = true;
    const banner = document.getElementById('creator-draft-banner');
    if (banner) banner.hidden = true;
  },

  // ------------------------------------------------------------------
  // Paste a whole board: 21 ordered lines, "A1: word" lines, or a
  // spreadsheet block (tabs). Returns { values: {A1: 'x', ...}, labeled }.
  parseBoardText(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(line => line.replace(/\s+$/, '')).filter(line => line.trim() !== '');
    const values = {};
    if (!lines.length) return { values, labeled: false };

    const labeledRe = /^\s*(FINAL(?:\s+SOLUTION)?|[A-D][1-5])\s*[:=.)\-–—]\s*(.*)$/i;
    if (lines.every(line => labeledRe.test(line))) {
      lines.forEach(line => {
        const m = labeledRe.exec(line);
        const key = /^FINAL/i.test(m[1]) ? 'finalSolution' : m[1].toUpperCase();
        values[key] = m[2].trim();
      });
      return { values, labeled: true };
    }

    if (lines.some(line => line.includes('\t'))) {
      let rows = lines.map(line => line.split('\t').map(cell => cell.trim()));
      if (rows[0].every(cell => !cell || /^(col(umn)?\s*)?[A-D]$/i.test(cell))) rows = rows.slice(1);
      if (rows.length && rows.every(row => /^(\d|row\s*\d|[A-D]?[1-5])?$/i.test(row[0] || '') && row.length >= 5)) rows = rows.map(row => row.slice(1));
      ['A', 'B', 'C', 'D'].forEach((col, c) => {
        for (let r = 1; r <= 5; r++) {
          const v = rows[r - 1]?.[c];
          if (v) values[`${col}${r}`] = v;
        }
      });
      const finalRow = rows[5];
      const finalValue = finalRow && finalRow.find(cell => cell);
      if (finalValue) values.finalSolution = finalValue;
      return { values, labeled: true };
    }

    lines.map(line => line.trim()).forEach((line, i) => {
      if (i < this.FIELD_ORDER.length) values[this.FIELD_ORDER[i]] = line;
    });
    return { values, labeled: false, list: lines.map(line => line.trim()) };
  },

  applyBoardValues(values) {
    let count = 0;
    Object.entries(values).forEach(([name, value]) => {
      if (!this.FIELD_ORDER.includes(name)) return;
      const text = String(value || '').slice(0, 60);
      this.applyField(name, text);
      const input = this.fieldInput(name);
      if (input) input.value = text;
      count++;
    });
    if (count) {
      this.markDirty();
      this.clearErrors();
      this.updatePreview();
    }
    return count;
  },

  openPastePanel() {
    const panel = document.getElementById('creator-paste');
    if (!panel) return;
    panel.hidden = false;
    const area = document.getElementById('creator-paste-text');
    const status = document.getElementById('creator-paste-status');
    if (status) status.textContent = '';
    if (area) { area.value = ''; area.focus(); }
  },

  applyPastePanel() {
    const area = document.getElementById('creator-paste-text');
    const status = document.getElementById('creator-paste-status');
    const { values } = this.parseBoardText(area?.value || '');
    const count = this.applyBoardValues(values);
    if (!count) {
      if (status) status.textContent = 'Nothing recognised. Use 21 lines, “A1: word” lines, or a spreadsheet block.';
      return;
    }
    document.getElementById('creator-paste').hidden = true;
    const firstEmpty = this.FIELD_ORDER.find(name => !String(this.fieldValue(name)).trim());
    if (firstEmpty) this.focusField(firstEmpty);
  },

  // Pasting several lines / a spreadsheet block straight into a board field
  // fills the board: labeled or grid pastes go to their own cells, a plain
  // list fills forward from the field pasted into.
  handleFieldPaste(event, input) {
    const text = event.clipboardData?.getData('text/plain') || '';
    const lineCount = text.replace(/\r/g, '').split('\n').filter(line => line.trim()).length;
    if (!text.includes('\t') && lineCount < 2) return;
    const parsed = this.parseBoardText(text);
    let values = parsed.values;
    if (!parsed.labeled && parsed.list) {
      values = {};
      const start = this.FIELD_ORDER.indexOf(input.dataset.creatorField);
      parsed.list.forEach((word, i) => {
        const name = this.FIELD_ORDER[start + i];
        if (name) values[name] = word;
      });
    }
    event.preventDefault();
    this.applyBoardValues(values);
  },

  // ------------------------------------------------------------------
  // Test play: the preview behaves like the live board (all covered, click
  // to reveal). Purely local; nothing is sent or saved.
  toggleTestPlay(force) {
    this._testPlay = typeof force === 'boolean' ? force : !this._testPlay;
    this._testRevealed = new Set();
    const btn = document.querySelector('#forge-shell [data-creator-test]');
    if (btn) {
      btn.textContent = this._testPlay ? 'EXIT TEST PLAY' : 'TEST PLAY';
      btn.setAttribute('aria-pressed', String(this._testPlay));
      btn.classList.toggle('active', this._testPlay);
    }
    const reset = document.querySelector('#forge-shell [data-creator-test-reset]');
    if (reset) reset.hidden = !this._testPlay;
    const note = document.getElementById('creator-test-note');
    if (note) note.hidden = !this._testPlay;
    this.updatePreview();
  },

  initCreatorUX(overlay) {
    overlay.addEventListener('click', (e) => {
      if (this.view !== 'creator') return;
      if (e.target.closest('[data-creator-paste]')) return this.openPastePanel();
      if (e.target.closest('[data-creator-paste-apply]')) return this.applyPastePanel();
      if (e.target.closest('[data-creator-paste-cancel]')) { document.getElementById('creator-paste').hidden = true; return; }
      if (e.target.closest('[data-creator-test]')) return this.toggleTestPlay();
      if (e.target.closest('[data-creator-test-reset]')) { this._testRevealed = new Set(); this.updatePreview(); return; }
      if (e.target.closest('[data-creator-draft-restore]')) return this.restoreDraft();
      if (e.target.closest('[data-creator-draft-discard]')) {
        this.clearDraft();
        document.getElementById('creator-draft-banner').hidden = true;
        return;
      }
      const cell = e.target.closest('#creator-board .board-cell[data-label]');
      if (cell) {
        const label = cell.dataset.label;
        if (this._testPlay) {
          if (this._testRevealed.has(label)) this._testRevealed.delete(label);
          else this._testRevealed.add(label);
          this.updatePreview();
          return;
        }
        this.focusField(this.fieldForPreviewLabel(label));
      }
    });

    overlay.addEventListener('keydown', (e) => {
      if (this.view !== 'creator') return;
      if (e.key === 'Escape' && !document.getElementById('creator-paste')?.hidden) {
        document.getElementById('creator-paste').hidden = true;
        e.stopPropagation();
        return;
      }
      const input = e.target.closest?.('input[data-creator-field]');
      if (!input || e.key !== 'Enter' || e.isComposing) return;
      const order = ['theme', ...this.FIELD_ORDER];
      const index = order.indexOf(input.dataset.creatorField);
      if (index < 0) return;
      e.preventDefault();
      const next = order[index + (e.shiftKey ? -1 : 1)];
      if (next) this.focusField(next);
      else input.blur();
    });

    overlay.addEventListener('focusin', (e) => {
      if (this.view !== 'creator') return;
      const input = e.target.closest?.('[data-creator-field]');
      if (!input) return;
      const name = input.dataset.creatorField;
      this._focusField = this.FIELD_ORDER.includes(name) ? name : null;
      this.highlightPreview(this._focusField);
      this.showHintBar(name);
    });

    overlay.addEventListener('paste', (e) => {
      if (this.view !== 'creator') return;
      const input = e.target.closest?.('input[data-creator-field]');
      if (input && this.FIELD_ORDER.includes(input.dataset.creatorField)) this.handleFieldPaste(e, input);
    });

    overlay.addEventListener('input', (e) => {
      if (this.view !== 'creator') return;
      if (e.target.closest?.('[data-creator-hint]')) this.setCellHint(e.target.value);
    });
  },

  getFieldValue(field) {
    const el = document.getElementById(field) || null;
    return el ? el.value : '';
  },

  onFieldChange(field) {
    const name = field.dataset.creatorField;
    const value = field.value;

    this.applyField(name, value);
    this.markDirty();
    this.clearErrors();

    if (name === 'title' || name === 'theme') this.updatePreviewTitle();
    this.refreshCreatorState();

    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.updatePreview(), 150);
  },

  applyField(name, value) {
    const d = this.editingGame;
    if (!d) return;
    if (name === 'title' || name === 'theme' || name === 'difficulty' || name === 'story' || name === 'gmNotes') {
      d[name] = value;
      return;
    }
    if (name === 'hints') {
      d.hints = value.split('\n').map(h => h.trim()).filter(Boolean);
      return;
    }
    if (name === 'finalSolution') {
      d.finalSolution = value;
      return;
    }
    const m = /^([A-D])([1-5])$/.exec(name || '');
    if (m) {
      const col = m[1];
      const row = parseInt(m[2], 10);
      if (row === 5) d.columns[col].solution = value;
      else d.columns[col].clues[row - 1] = value;
    }
  },

  updatePreviewTitle() {
    const d = this.editingGame;
    const wrap = document.querySelector('.creator-preview-title');
    if (!wrap) return;
    // The THEME is the game's name (there is no separate title field).
    wrap.innerHTML = `<div class="public-title"></div>`;
    wrap.querySelector('.public-title').textContent = d.theme || d.title || 'UNTITLED';
  },

  updatePreview() {
    if (!this.editingGame) return;
    Board.renderPreview('#creator-board', this.editingGame, this._testPlay ? { revealed: this._testRevealed } : {});
    this.highlightPreview(this._focusField);
    this.refreshCreatorState();
    // After the board fitted its words, note which ones had to shrink a lot.
    clearTimeout(this._fitCheckTimer);
    this._fitCheckTimer = setTimeout(() => this.checkLongWords(), 180);
  },

  checkLongWords() {
    const board = document.getElementById('creator-board');
    if (!board || this._testPlay) return;
    const long = new Set();
    board.querySelectorAll('.board-cell.revealed[data-label]').forEach(cell => {
      const txt = cell.querySelector('.cell-text') || cell.querySelector('.cell-content');
      const m = /scale\(([\d.]+)\)/.exec(txt?.style.transform || '');
      if (m && Number(m[1]) < 0.62) long.add(cell.dataset.label);
    });
    const before = [...(this._longLabels || [])].join();
    this._longLabels = long;
    if ([...long].join() !== before) this.refreshCreatorState();
  },

  updatePreviewBackground() {
    const bg = document.getElementById('creator-bg');
    if (!bg) return;
    const path = this.editingGame.background || '';
    if (path) bg.src = path;
    else bg.src = '';

    const warn = document.getElementById('creator-bg-warning');
    if (warn) warn.style.display = 'none';
    if (!path) return;

    const img = new Image();
    img.onload = () => {
      if (warn && (img.naturalWidth !== this.CANVAS_W || img.naturalHeight !== this.CANVAS_H)) {
        warn.style.display = 'block';
      }
    };
    img.src = path;
  },

  collectDraft() {
    const d = this.editingGame;
    if (!d) return null;
    const value = name => (document.querySelector(`[data-creator-field="${name}"]`)?.value || '').trim();
    d.theme = value('theme');
    // The theme names the game. A new game's title follows it; an existing
    // game keeps the title it was saved under (library name / file).
    d.title = this.isNew ? d.theme : (String(d.title || '').trim() || d.theme);
    d.difficulty = (document.querySelector('[data-creator-field="difficulty"]')?.value || d.difficulty || 'GREEN').toUpperCase();
    d.finalSolution = value('finalSolution');
    d.story = document.querySelector('[data-creator-field="story"]')?.value || '';
    d.gmNotes = document.querySelector('[data-creator-field="gmNotes"]')?.value || '';
    const legacy = document.querySelector('[data-creator-field="hints"]');
    if (legacy) d.hints = legacy.value.split('\n').map(h => h.trim()).filter(Boolean);
    d.cellHints = Object.fromEntries(Object.entries(d.cellHints || {})
      .filter(([cell, text]) => /^[A-D][1-4]$/.test(cell) && String(text || '').trim())
      .map(([cell, text]) => [cell, String(text).trim().slice(0, this.HINT_MAX)]));

    ['A', 'B', 'C', 'D'].forEach(col => {
      if (!d.columns[col]) d.columns[col] = { clues: ['', '', '', ''], solution: '' };
      for (let r = 1; r <= 4; r++) d.columns[col].clues[r - 1] = value(`${col}${r}`);
      d.columns[col].solution = value(`${col}5`);
    });

    return d;
  },

  // Everything missing, in fill order (theme first).
  missingFields() {
    return ['theme', ...this.FIELD_ORDER].filter(name => !String(this.fieldValue(name)).trim());
  },

  async saveGame() {
    const d = this.collectDraft();
    if (!d) return;

    this.clearErrors();
    d.background = this.editingGame.background || '';
    if (!d.id && this.isNew) d.id = '';

    // Outline every empty field and jump to the first one instead of
    // listing errors at the bottom.
    const missing = this.missingFields();
    if (missing.length) {
      this._showMissing = true;
      this.refreshCreatorState();
      const names = missing.map(name => name === 'finalSolution' ? 'FINAL' : name === 'theme' ? 'THEME' : name);
      this.showErrors([`${missing.length} field${missing.length === 1 ? ' is' : 's are'} still empty: ${names.join(', ')}`]);
      this.focusField(missing[0]);
      return;
    }

    try {
      const res = await GameData.saveGame(d);
      this.clearDraft();
      this.dirty = false;
      this.showStatus('Game saved successfully.');
      await this.reloadLibrary();
      if (App && App.mode === 'local' && App.loadGameById) {
        await App.loadGameById(res.game.id);
      } else if (App && App.mode === 'multiplayer' && App.roomCode) {
        this.applySavedGameToRoom(res);
      }
      this.close();
    } catch (e) {
      this.showErrors([e.message]);
    }
  },

  // A game saved in a live room should be on the board immediately, not
  // after a manual reset. The server already hot-swapped the words when this
  // was the board's own game and nothing had started (res.liveRefreshed).
  applySavedGameToRoom(res) {
    const id = res?.game?.id;
    if (!id || res.liveRefreshed) return;
    const sameGame = String(id) === String(GameData.currentGame?.id || '');
    const revealed = Object.values(Board.sessionState?.cells || {}).some(Boolean) || Board.isFinalRevealed?.();
    const timerLive = App.timer && App.timer.phase && App.timer.phase !== 'ready';
    const live = revealed || timerLive;
    const target = sameGame ? 'Apply these changes to' : `Put "${res.game.title}" on`;
    if (live && !confirm(
      `${target} the live board now?\n\n` +
      'The current board is in progress: loading resets it.\n\n' +
      '[ OK ] Load now    [ Cancel ] Keep playing (applies at the next reset)'
    )) return;
    App.send({ type: 'gm:switchGame', gameId: id, keepMode: true });
  },

  async loadGame(id) {
    const game = this.getGameById(id);
    if (!game) {
      alert('Game not found in library.');
      return;
    }

    if (App && App.mode === 'multiplayer' && App.roomCode) {
      const proceed = confirm(
        'A multiplayer session is currently active.\n\n' +
        `Loading "${game.title}" will reset the room board and current session, and clear chat.\n\n` +
        '[ OK ] Load for room    [ Cancel ]'
      );
      if (!proceed) return;
      App.switchRoomGame(id);
      this.close();
      return;
    }

    try {
      await App.loadGameById(id);
      this.close();
    } catch (e) {
      alert('Failed to load game: ' + e.message);
    }
  },

  async duplicateGame(id) {
    try {
      const res = await GameData.duplicateGame(id);
      await this.reloadLibrary();
      this.renderLibraryBody();
      this.showStatus(`Duplicated as "${res.game.title}".`);
    } catch (e) {
      alert('Duplicate failed: ' + e.message);
    }
  },

  async deleteGame(id) {
    const game = this.getGameById(id);
    if (!game) return;
    const title = game.title;
    if (!confirm(`Delete "${title}" permanently?\n\nThis cannot be undone.`)) return;

    try {
      await GameData.deleteGame(id);
      await this.reloadLibrary();
      this.renderLibraryBody();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  },

  async importXlsxFile(file) {
    try {
      const res = await GameData.importXlsx(file);
      if (res.warnings && res.warnings.length) {
        alert('Imported with notes:\n\n' + res.warnings.join('\n'));
      }
      // Opens straight into the creator/preview view, exactly like NEW GAME —
      // nothing is written to the library until the user hits SAVE GAME there,
      // so a typo or wrong background can still be fixed before it's kept.
      this.openCreator(res.game, true);
    } catch (e) {
      alert('Could not import this file:\n\n' + e.message);
    }
  },

  async uploadBackground(file) {
    const status = document.getElementById('upload-status');
    if (status) status.textContent = 'Uploading...';
    try {
      const res = await GameData.uploadBackground(file);
      await GameData.loadBackgroundList();
      this.backgrounds = GameData.availableBackgrounds || [];
      this.editingGame.background = res.path;
      this.dirty = true;
      if (this.view === 'creator') {
        this.renderCreator();
        this.updatePreviewBackground();
      }
      // renderCreator() above rebuilds the whole creator panel via
      // innerHTML, which replaces the #upload-status node -- re-query it
      // so the success message lands on the element actually in the
      // document, not the one that render call just destroyed.
      const liveStatus = document.getElementById('upload-status');
      if (liveStatus) liveStatus.textContent = `Added: ${res.filename}`;
    } catch (e) {
      if (status) status.textContent = 'Upload failed: ' + e.message;
      alert('Background upload failed: ' + e.message);
    }
  },

  removeBackgroundUpload() {
    const warn = document.getElementById('creator-bg-warning');
    if (warn) warn.style.display = 'none';
  },

  showStatus(message) {
    alert(message);
  },

  showErrors(errors) {
    const container = document.getElementById('forge-errors');
    if (!container) return;
    container.innerHTML = `
      <div class="forge-errors-title">Cannot save game:</div>
      ${errors.map(e => `<div class="forge-error">${this.escapeHtml(e)}</div>`).join('')}
    `;
  },

  clearErrors() {
    const container = document.getElementById('forge-errors');
    if (container) container.innerHTML = '';
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  },

  escapeAttr(text) {
    return this.escapeHtml(text).replace(/"/g, '&quot;');
  }
};

window.Forge = Forge;