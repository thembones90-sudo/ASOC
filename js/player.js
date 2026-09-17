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

  init() {
    this.bindJoinForm();
    this.loadStoredCredentials();
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
        this.showGameScreen();
        this.setConnectionStatus('connected');
        this.reconnectAttempts = 0;
        break;

      case 'join:success':
        this.playerId = message.playerId;
        sessionStorage.setItem('asoc_player_id', this.playerId);
        break;

      case 'chat:update':
        this.chatMessages = message.messages || [];
        this.solvedTargets = message.solvedTargets || {};
        this.renderChat();
        break;

      case 'players:update':
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

    let html = `
      <div class="public-header">
        <div class="public-title">${this.escapeHtml(state.title)}</div>
        <div class="public-theme">${this.escapeHtml(state.theme)}</div>
      </div>
      <div class="asoc-board">
        ${Skeleton.skeletonHTML()}
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
      html += this.createPublicCellHTML(key, content, true, revealed, `${col}5`);
    });

    const finalRevealed = state.finalSolution?.revealed === true;
    const finalContent = finalRevealed ? (state.finalSolution.value || '—') : '???';
    html += this.createPublicCellHTML('FINAL', finalContent, true, finalRevealed, 'FINAL', true);

    html += '</div>';
    publicBoard.innerHTML = html;
    Skeleton.attach(publicBoard.querySelector('.asoc-board'));

    this.applyBackground(state.background);
  },

  createPublicCellHTML(key, content, isSolution, revealed, label, isFinal = false) {
    const classes = ['board-cell'];
    if (isSolution) classes.push('solution-cell');
    if (isFinal) classes.push('final-solution');
    if (!revealed) classes.push('hidden');
    else classes.push('revealed');

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
    const verdictIcon = this.getVerdictIcon(msg.verdict);
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isOwn = msg.playerId === this.playerId;

    return `
      <div class="chat-message ${isOwn ? 'own' : ''}" data-message-id="${msg.id}">
        <div class="chat-message-header">
          <span class="chat-player-name">${this.escapeHtml(msg.playerName)}</span>
          <span class="chat-time">${time}</span>
        </div>
        <div class="chat-message-text">${this.escapeHtml(msg.text)}</div>
        ${verdictIcon ? `<div class="chat-verdict ${msg.verdict}">${verdictIcon}</div>` : ''}
        ${msg.target ? `<div class="chat-target">→ ${this.getTargetLabel(msg.target)}</div>` : ''}
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

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => PlayerApp.init());
window.PlayerApp = PlayerApp;