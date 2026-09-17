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
        }
        this.close();
        return;
      }

      if (e.target.closest('[data-forge-new]')) {
        this.openCreator(null, true);
        return;
      }
      if (e.target.closest('[data-forge-back-library]')) {
        if (this.dirty && !confirm('Discard unsaved changes and return to library?')) return;
        this.openLibrary();
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
    });
  },

  getGameById(id) {
    return this.games.find(g => g.id === id) || null;
  },

  async open() {
    this.isOpen = true;
    document.getElementById('forge-overlay').classList.add('active');
    await this.reloadLibrary();
    this.openLibrary();
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
    this.renderCreator();
    this.updatePreview();
    this.updatePreviewBackground();
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
      created: new Date().toISOString().split('T')[0]
    };
  },

  renderCreator() {
    this.view = 'creator';
    const shell = document.getElementById('forge-shell');
    if (!shell) return;

    const d = this.editingGame;
    const cols = ['A', 'B', 'C', 'D'];

    const colHtml = cols.map(col => {
      const colData = d.columns[col] || { clues: ['', '', '', ''], solution: '' };
      const cellInputs = [1, 2, 3, 4].map(r => `
        <label class="cell-field">
          <span class="cell-field-label">${col}${r}</span>
          <input type="text" class="forge-input" data-creator-field="${col}${r}" maxlength="60" value="${this.escapeAttr(colData.clues[r - 1] || '')}">
        </label>
      `).join('');
      return `
        <div class="creator-col">
          <div class="creator-col-header">COLUMN ${col}</div>
          ${cellInputs}
          <label class="cell-field solution">
            <span class="cell-field-label">${col}5 · SOLUTION</span>
            <input type="text" class="forge-input" data-creator-field="${col}5" maxlength="60" value="${this.escapeAttr(colData.solution || '')}">
          </label>
        </div>
      `;
    }).join('');

    shell.innerHTML = `
      <div class="forge-header">
        <span class="forge-title">${this.isNew ? 'NEW GAME — ASOC CREATOR' : 'EDIT — ASOC CREATOR'}</span>
        <button class="forge-close" data-forge-close title="Close">✕</button>
      </div>
      <div class="creator-grid">
        <div class="creator-form">
          <div class="creator-section">
            <h4 class="creator-label">IDENTITY</h4>
            <label class="cell-field">
              <span class="cell-field-label">TITLE</span>
              <input type="text" class="forge-input" data-creator-field="title" maxlength="80" value="${this.escapeAttr(d.title)}" placeholder="e.g. PRIMAL">
            </label>
            <label class="cell-field">
              <span class="cell-field-label">THEME</span>
              <input type="text" class="forge-input" data-creator-field="theme" maxlength="80" value="${this.escapeAttr(d.theme)}" placeholder="e.g. Birth of Earth">
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
            <div class="creator-cols">${colHtml}</div>
            <label class="cell-field final">
              <span class="cell-field-label">FINAL SOLUTION</span>
              <input type="text" class="forge-input" data-creator-field="finalSolution" maxlength="60" value="${this.escapeAttr(d.finalSolution)}" placeholder="The final answer">
            </label>
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
            <label class="cell-field">
              <span class="cell-field-label">HINTS (ONE PER LINE)</span>
              <textarea class="forge-textarea" data-creator-field="hints" rows="3">${this.escapeHtml((Array.isArray(d.hints) ? d.hints : []).join('\n'))}</textarea>
            </label>
          </div>

          <div id="forge-errors" class="forge-errors"></div>

          <div class="forge-actions">
            <button class="forge-btn primary" data-forge-save>SAVE GAME</button>
            <button class="forge-btn ghost" data-forge-back-library>BACK TO LIBRARY</button>
          </div>
        </div>

        <div class="creator-preview">
          <div class="creator-preview-header">LIVE PREVIEW</div>
          <div class="creator-preview-stage">
            <img class="creator-bg" id="creator-bg" alt="Preview background">
            <div class="public-header creator-preview-title">
              <div class="public-title"></div>
            </div>
            <div class="asoc-board" id="creator-board"></div>
          </div>
        </div>
      </div>
    `;

    this.updatePreviewTitle();
    this.updatePreview();
    this.updatePreviewBackground();
  },

  getFieldValue(field) {
    const el = document.getElementById(field) || null;
    return el ? el.value : '';
  },

  onFieldChange(field) {
    const name = field.dataset.creatorField;
    const value = field.value;

    this.applyField(name, value);
    this.dirty = true;
    this.clearErrors();

    if (name === 'title') this.updatePreviewTitle();

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
    wrap.innerHTML = `
      <div class="public-title"></div>
      <div class="public-theme"></div>
    `;
    wrap.querySelector('.public-title').textContent = d.title || 'UNTITLED';
    wrap.querySelector('.public-theme').textContent = d.theme || '—';
  },

  updatePreview() {
    if (!this.editingGame) return;
    Board.renderPreview('#creator-board', this.editingGame);
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

    d.title = (document.querySelector('[data-creator-field="title"]')?.value || '').trim();
    d.theme = (document.querySelector('[data-creator-field="theme"]')?.value || '').trim();
    d.difficulty = (document.querySelector('[data-creator-field="difficulty"]')?.value || 'GREEN').toUpperCase();
    d.finalSolution = (document.querySelector('[data-creator-field="finalSolution"]')?.value || '').trim();
    d.story = document.querySelector('[data-creator-field="story"]')?.value || '';
    d.gmNotes = document.querySelector('[data-creator-field="gmNotes"]')?.value || '';
    d.hints = (document.querySelector('[data-creator-field="hints"]')?.value || '').split('\n').map(h => h.trim()).filter(Boolean);

    ['A', 'B', 'C', 'D'].forEach(col => {
      for (let r = 1; r <= 4; r++) {
        d.columns[col].clues[r - 1] = (document.querySelector(`[data-creator-field="${col}${r}"]`)?.value || '').trim();
      }
      d.columns[col].solution = (document.querySelector(`[data-creator-field="${col}5"]`)?.value || '').trim();
    });

    return d;
  },

  async saveGame() {
    const d = this.collectDraft();
    if (!d) return;

    this.clearErrors();
    d.background = this.editingGame.background || '';
    if (!d.id && this.isNew) d.id = '';

    try {
      const res = await GameData.saveGame(d);
      this.dirty = false;
      this.showStatus('Game saved successfully.');
      await this.reloadLibrary();
      if (App && App.mode === 'local' && App.loadGameById) {
        await App.loadGameById(res.game.id);
      }
      this.close();
    } catch (e) {
      this.showErrors([e.message]);
    }
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
      if (status) status.textContent = `Added: ${res.filename}`;
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