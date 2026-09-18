const GameData = {
  currentGame: null,
  availableGames: [],
  availableBackgrounds: [],
  gmToken: sessionStorage.getItem('asoc_gm_token') || '',

  // Canonical ASOC difficulty scale
  DIFFICULTY_VALUES: ['GREEN', 'YELLOW', 'AMBER', 'RED', 'PURPLE', 'BLACK'],

  difficultyColor(difficulty) {
    const colors = {
      GREEN: '#2ecc71',
      YELLOW: '#f1c40f',
      AMBER: '#e67e22',
      RED: '#e74c3c',
      PURPLE: '#9b59b6',
      BLACK: '#1a1a2e'
    };
    return colors[difficulty] || colors.GREEN;
  },

  validateDifficulty(difficulty) {
    return this.DIFFICULTY_VALUES.includes(difficulty) ? difficulty : 'GREEN';
  },

  setGMToken(token) {
    this.gmToken = token || '';
    if (this.gmToken) sessionStorage.setItem('asoc_gm_token', this.gmToken);
    else sessionStorage.removeItem('asoc_gm_token');
  },

  async apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.gmToken) headers['x-gm-token'] = this.gmToken;
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        if (data.error) detail = data.error;
        if (data.errors && data.errors.length) detail = data.errors.join(' ');
      } catch (e) {}
      throw new Error(detail);
    }
    return response.json();
  },

  async fetchGMToken() {
    try {
      const data = await this.apiFetch('api/gm/token');
      if (data.token) this.setGMToken(data.token);
      return data.token || null;
    } catch (e) {
      console.warn('Could not obtain GM token:', e.message);
      return null;
    }
  },

  async loadGameList() {
    try {
      const data = await this.apiFetch('api/games');
      this.availableGames = data.games || [];
    } catch (e) {
      console.warn('Could not load game list:', e.message);
      this.availableGames = [];
    }
    return this.availableGames;
  },

  async fetchGame(id) {
    const data = await this.apiFetch(`api/games/${encodeURIComponent(id)}`);
    return this.normalizeGameData(data.game);
  },

  async loadGameById(id) {
    this.currentGame = await this.fetchGame(id);
    return this.currentGame;
  },

  async loadGame(filenameOrId) {
    if (!filenameOrId) {
      if (this.availableGames.length) {
        return this.loadGameById(this.availableGames[0].id);
      }
      throw new Error('No games available');
    }
    const match = this.availableGames.find(g => g.filename === filenameOrId);
    const id = match ? match.id : filenameOrId;
    return this.loadGameById(id);
  },

  normalizeGameData(raw) {
    const normalized = {
      id: raw.id || 'unknown',
      title: raw.title || 'Untitled Game',
      theme: raw.theme || 'General',
      background: raw.background || '',
      difficulty: this.validateDifficulty(raw.difficulty),
      columns: {},
      finalSolution: raw.finalSolution || raw.final_solution || '',
      story: raw.story || '',
      gmNotes: raw.gmNotes || raw.gm_notes || '',
      hints: raw.hints || [],
      created: raw.created || new Date().toISOString().split('T')[0],
      modified: raw.modified || '',
      isSample: raw.isSample === true || raw.id === 'sample-001'
    };

    const colKeys = ['A', 'B', 'C', 'D'];
    colKeys.forEach(key => {
      const colData = raw.columns?.[key] || raw[key] || {};
      normalized.columns[key] = {
        clues: Array.isArray(colData.clues) ? colData.clues.slice(0, 4) : 
               (colData.clue1 || colData.clue2 || colData.clue3 || colData.clue4) ? [
                 colData.clue1 || '',
                 colData.clue2 || '',
                 colData.clue3 || '',
                 colData.clue4 || ''
               ] : ['', '', '', ''],
        solution: colData.solution || ''
      };
    });

    return normalized;
  },

  async loadBackgroundList() {
    try {
      const data = await this.apiFetch('api/backgrounds');
      this.availableBackgrounds = data.backgrounds || [];
    } catch (e) {
      console.warn('Could not load background list:', e.message);
      this.availableBackgrounds = [];
    }
    return this.availableBackgrounds;
  },

  getCurrentGame() {
    return this.currentGame;
  },

  async saveGame(gameData) {
    return this.apiFetch('api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gameData)
    });
  },

  async duplicateGame(id) {
    return this.apiFetch(`api/games/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  },

  async deleteGame(id) {
    return this.apiFetch(`api/games/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async uploadBackground(file) {
    return this.apiFetch(`api/backgrounds/upload?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file
    });
  },

  async importXlsx(file) {
    return this.apiFetch(`api/games/import-xlsx?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file
    });
  },

  getCellKey(column, row) {
    return `${column}${row}`;
  },

  getCellData(column, row) {
    if (!this.currentGame) return null;
    if (row >= 1 && row <= 4) {
      return this.currentGame.columns[column]?.clues[row - 1] || '';
    } else if (row === 5) {
      return this.currentGame.columns[column]?.solution || '';
    }
    return null;
  },

  getFinalSolution() {
    return this.currentGame?.finalSolution || '';
  }
};

window.GameData = GameData;