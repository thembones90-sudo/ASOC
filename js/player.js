const PlayerApp = {
  ws: null,
  roomCode: 'MASTER',
  masterArmed: false,
  roomMode: 'CASUAL',
  _masterStateBaselined: false,
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

  playerId: '',
  playerName: '',
  avatarData: '',
  frameColor: '#9B5DE0',
  themeId: 'gunmetal',
  themeColor: '#343A42',
  finalSolverAura: null,
  _finalSolverAuraTimer: null,
  _sendAvatarAppearance: false,
  _sendFrameAppearance: false,
  _sendThemeAppearance: false,
  _themeChangedByUser: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  lastPublicState: null,
  chatMessages: [],
  solvedTargets: {},
  userScrolledUp: false,
  _newMessageCount: 0,
  _wrongFadeTimer: null,
  _wrongVerdictSeenAt: new Map(),
  _tributeExpiryTimer: null,
  _chatArrivalIds: new Set(),
  _chatVerdictTransitionIds: new Set(),
  _activeFinalBanner: null,
  _finalBannerFadeTimer: null,
  _finalBannerRemoveTimer: null,
  _boardRenderSignature: '',
  _renderedBoardGameId: '',
  _renderedBoardDifficulty: '',
  bloodTribute: { status: 'idle' },
  tributeUploading: false,
  chatReactionEmojis: ['😂', '❤️', '🔥', '👍', '🤏', '😇', '😭', '😍', '💀', '🤣', '👎', '😎', '🫡', '🗿', '🤡', '🤦', '🤷', '👀', '👁️', '😏', '😒', '🙄', '😡', '🤬', '😈', '👿', '🤔', '🧐', '😐', '😑', '😬', '😱', '🥶', '🥵', '🫠', '🥴', '🤯', '🥳', '😴', '🤤', '🤢', '🤮', '💩', '🖕', '👏', '🙏', '💪', '🧠', '🖤', '💜', '💔', '⚡', '💥', '✅', '❌', '🏆', '🥰', '🐺'],
  emojiFavoriteDefaults: ['😂', '❤️', '🔥', '👍', '😭'],
  emojiFavorites: [],
  _emojiFavoritesEditing: false,
  _emojiFavoriteSlot: 0,
  _editingMessage: null,
  // FINAL SOLUTION REVEAL FLOURISH -- same one-shot guard as App's copy in
  // js/app.js (see its comment): renderBoard() fully rebuilds the board on
  // every broadcast, so this flag is what keeps the animation from
  // replaying on every incidental re-render while the Final stays revealed.
  _finalFlourishPlayed: false,
  // GREEN column solve cascade. Baseline guard prevents reconnect/join from
  // replaying columns that were solved before this client arrived.
  _columnCascadeBaselined: false,
  _columnCascadeStarts: {},
  // GAME WON -- mirrors the server's authoritative sessionState.gameWon.
  // Same contract as the GM: the live sequence plays only on a false->true
  // flip after this connection's baseline state; the first state after every
  // (re)connect is the baseline, so a refresh/reconnect never replays it.
  gameWon: false,
  _victoryBaselined: false,
  gameLost: false,
  _lossBaselined: false,
  _lossResultKey: null,
  _resumeJoinScheduled: false,

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
    this.bindDesignationEditor();
    window.addEventListener('asoc:player-session-restored', () => this.resumeStoredMasterSession());
    this.setupPlayerLayoutSplitter();
    this.setupHudBoardWidthSync();
    Womf.init('womf-tracker-player');
    Wheel.init('wheel-overlay');
    Timer.init('timer-tracker-player');
    this.resumeStoredMasterSession();
  },

  resumeStoredMasterSession() {
    if (this._resumeJoinScheduled) return;
    const masterMirror = sessionStorage.getItem('asoc_master_persona') === 'PLAYER_TEST';
    const resumeFlag = masterMirror
      ? sessionStorage.getItem('asoc_player_in_master')
      : localStorage.getItem('asoc_player_in_master');
    if (resumeFlag !== '1') return;
    const token = sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || '';
    const name = (document.getElementById('player-name')?.value || '').trim();
    if (!token || !name) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this._resumeJoinScheduled = true;
    setTimeout(() => {
      this._resumeJoinScheduled = false;
      this.joinGame();
    }, 0);
  },

  bindJoinForm() {
    const form = document.getElementById('join-form');
    const nameInput = document.getElementById('player-name');

    const chatInput = document.getElementById('chat-input');
    const imageButton = document.getElementById('chat-image-upload-btn');
    const imageInput = document.getElementById('chat-image-upload-input');
    const gifInput = document.getElementById('chat-gif-upload-input');
    const attachmentMenu = document.getElementById('chat-attachment-menu');
    const attachmentWrap = imageButton?.closest('.chat-attachment-wrap');
    const pollComposer = document.getElementById('chat-poll-composer');
    const pollQuestion = document.getElementById('chat-poll-question');
    const pollOptionsEditor = document.getElementById('chat-poll-options');
    const pollMultiple = document.getElementById('chat-poll-multiple');
    const pollDuration = document.getElementById('chat-poll-duration');

    let gifPicker = document.getElementById('chat-gif-picker');
    if (!gifPicker && attachmentWrap) {
      gifPicker = document.createElement('div');
      gifPicker.id = 'chat-gif-picker';
      gifPicker.className = 'chat-gif-picker';
      gifPicker.hidden = true;
      gifPicker.innerHTML = `
        <div class="chat-gif-picker-head">
          <div><b>GIF // ASOC NETWORK</b><small>GIPHY LINK</small></div>
          <button type="button" data-gif-close aria-label="Close GIF browser">×</button>
        </div>
        <div class="chat-gif-search-row">
          <input type="search" maxlength="60" autocomplete="off" spellcheck="false" placeholder="Search GIFs..." data-gif-search>
        </div>
        <div class="chat-gif-status" data-gif-status>TRENDING // STANDBY</div>
        <div class="chat-gif-grid" data-gif-grid></div>
        <div class="chat-gif-actions">
          <button type="button" data-gif-upload>UPLOAD GIF</button>
          <button type="button" data-gif-more hidden>LOAD MORE</button>
        </div>
        <div class="chat-gif-provider">Powered by GIPHY</div>
      `;
      attachmentWrap.appendChild(gifPicker);
    }
    const gifSearchInput = gifPicker?.querySelector('[data-gif-search]');
    const gifStatus = gifPicker?.querySelector('[data-gif-status]');
    const gifGrid = gifPicker?.querySelector('[data-gif-grid]');
    const gifMoreButton = gifPicker?.querySelector('[data-gif-more]');
    let gifResults = [];
    let gifOffset = 0;
    let gifMode = 'trending';
    let gifQuery = '';
    let gifLoading = false;
    let gifSearchTimer = null;

    const setGifStatus = (text, danger = false) => {
      if (!gifStatus) return;
      gifStatus.textContent = text;
      gifStatus.classList.toggle('is-danger', danger);
    };

    const closeGifPicker = () => {
      if (!gifPicker) return;
      gifPicker.hidden = true;
      clearTimeout(gifSearchTimer);
    };

    const renderGifResults = () => {
      if (!gifGrid) return;
      gifGrid.replaceChildren();
      gifResults.forEach((gif, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-gif-result';
        button.dataset.gifIndex = String(index);
        button.title = gif.title || 'GIF';
        const img = document.createElement('img');
        img.src = gif.previewUrl;
        img.alt = gif.title || 'GIF';
        img.loading = 'lazy';
        button.appendChild(img);
        gifGrid.appendChild(button);
      });
    };

    const loadGifPage = async ({ append = false } = {}) => {
      if (!gifPicker || gifLoading) return;
      const query = String(gifSearchInput?.value || '').trim();
      if (query.length === 1) {
        setGifStatus('TYPE AT LEAST 2 CHARACTERS');
        return;
      }
      gifMode = query.length >= 2 ? 'search' : 'trending';
      gifQuery = query;
      if (!append) gifOffset = 0;
      gifLoading = true;
      gifMoreButton?.setAttribute('disabled', 'disabled');
      setGifStatus(gifMode === 'search' ? 'SEARCHING // ' + query.toUpperCase() : 'TRENDING // ACQUIRING');
      try {
        const token = sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || '';
        const params = new URLSearchParams({ offset: String(gifOffset), limit: '12' });
        if (gifMode === 'search') params.set('q', query);
        const response = await fetch('/api/gif/' + gifMode + '?' + params.toString(), {
          headers: { 'x-player-token': token }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (payload.code === 'GIF_LIMIT_REACHED') {
            setGifStatus('FUCK OFF, LIMIT REACHED', true);
            if (gifMoreButton) gifMoreButton.hidden = true;
            return;
          }
          throw new Error(payload.message || payload.error || 'GIF NETWORK // OFFLINE');
        }
        const incoming = Array.isArray(payload.results) ? payload.results : [];
        gifResults = append ? gifResults.concat(incoming) : incoming;
        gifOffset = Number(payload.pagination?.nextOffset) || (gifOffset + incoming.length);
        renderGifResults();
        if (gifMoreButton) gifMoreButton.hidden = payload.pagination?.hasMore !== true;
        const playerRemaining = payload.quota?.playerRemaining;
        setGifStatus(
          gifMode === 'search'
            ? 'RESULTS // ' + gifResults.length + (Number.isFinite(playerRemaining) ? ' // ' + playerRemaining + ' SEARCHES LEFT' : '')
            : 'TRENDING // ' + gifResults.length
        );
      } catch (error) {
        setGifStatus(error.message || 'GIF NETWORK // OFFLINE', true);
      } finally {
        gifLoading = false;
        gifMoreButton?.removeAttribute('disabled');
      }
    };

    const openGifPicker = () => {
      closeAttachmentMenu();
      closePollComposer();
      if (!gifPicker) return gifInput?.click();
      gifPicker.hidden = false;
      gifSearchInput?.focus();
      if (!gifResults.length) loadGifPage({ append: false });
    };

    gifPicker?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.target.closest('[data-gif-close]')) {
        closeGifPicker();
        return;
      }
      if (event.target.closest('[data-gif-upload]')) {
        closeGifPicker();
        gifInput?.click();
        return;
      }
      if (event.target.closest('[data-gif-more]')) {
        loadGifPage({ append: true });
        return;
      }
      const resultButton = event.target.closest('[data-gif-index]');
      if (!resultButton) return;
      const gif = gifResults[Number(resultButton.dataset.gifIndex)];
      if (!gif || !this.ws || this.ws.readyState !== 1) return;
      this.send({ type: 'chat:gif', gif });
      closeGifPicker();
    });

    gifSearchInput?.addEventListener('input', () => {
      clearTimeout(gifSearchTimer);
      gifSearchTimer = setTimeout(() => {
        gifResults = [];
        loadGifPage({ append: false });
      }, 500);
    });

    const closePollComposer = () => {
      if (!pollComposer) return;
      pollComposer.hidden = true;
    };

    const closeAttachmentMenu = () => {
      if (!attachmentMenu || !imageButton) return;
      attachmentMenu.hidden = true;
      imageButton.setAttribute('aria-expanded', 'false');
    };

    const currentPollOptions = () => Array.from(
      pollOptionsEditor?.querySelectorAll('.chat-poll-option-input') || []
    ).map(input => input.value);

    const renderPollOptionsEditor = (values = ['', '']) => {
      if (!pollOptionsEditor) return;
      const clean = values.slice(0, 8);
      while (clean.length < 2) clean.push('');
      pollOptionsEditor.replaceChildren();
      clean.forEach((value, index) => {
        const row = document.createElement('div');
        row.className = 'chat-poll-option-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 80;
        input.className = 'chat-poll-option-input';
        input.placeholder = 'Option ' + (index + 1);
        input.value = value;
        row.appendChild(input);
        if (clean.length > 2) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'chat-poll-option-remove';
          remove.dataset.pollRemove = String(index);
          remove.textContent = '×';
          remove.setAttribute('aria-label', 'Remove option ' + (index + 1));
          row.appendChild(remove);
        }
        pollOptionsEditor.appendChild(row);
      });
    };

    const openPollComposer = () => {
      closeAttachmentMenu();
      closeGifPicker();
      if (!pollComposer) return;
      if (!pollOptionsEditor?.children.length) renderPollOptionsEditor();
      pollComposer.hidden = false;
      pollQuestion?.focus();
    };

    imageButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!attachmentMenu) return imageInput?.click();
      const opening = attachmentMenu.hidden;
      attachmentMenu.hidden = !opening;
      imageButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) {
        closePollComposer();
        closeGifPicker();
        const emojiPicker = document.getElementById('chat-emoji-picker');
        const emojiToggle = document.getElementById('chat-emoji-toggle');
        if (emojiPicker) emojiPicker.hidden = true;
        emojiToggle?.setAttribute('aria-expanded', 'false');
      }
    });

    attachmentMenu?.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest('[data-chat-attachment]')?.dataset.chatAttachment;
      if (!action) return;
      if (action === 'image') {
        closeAttachmentMenu();
        imageInput?.click();
        return;
      }
      if (action === 'gif') {
        openGifPicker();
        return;
      }
      if (action === 'poll') openPollComposer();
    });

    document.getElementById('chat-poll-cancel')?.addEventListener('click', (event) => {
      event.stopPropagation();
      closePollComposer();
    });

    document.getElementById('chat-poll-add-option')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const values = currentPollOptions();
      if (values.length >= 8) return;
      renderPollOptionsEditor([...values, '']);
      pollOptionsEditor?.querySelector('.chat-poll-option-row:last-child input')?.focus();
    });

    pollOptionsEditor?.addEventListener('click', (event) => {
      event.stopPropagation();
      const remove = event.target.closest('[data-poll-remove]');
      if (!remove) return;
      const index = Number(remove.dataset.pollRemove);
      const values = currentPollOptions();
      if (!Number.isInteger(index) || values.length <= 2) return;
      values.splice(index, 1);
      renderPollOptionsEditor(values);
    });

    document.getElementById('chat-poll-create')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const question = pollQuestion?.value.trim() || '';
      const options = currentPollOptions().map(value => value.trim()).filter(Boolean);
      if (!question) return alert('Poll question required.');
      if (options.length < 2) return alert('Poll needs at least two options.');
      if (new Set(options.map(value => value.toLocaleLowerCase())).size !== options.length) {
        return alert('Poll options must be unique.');
      }
      if (!this.ws || this.ws.readyState !== 1) return alert('Chat is not connected.');
      this.send({
        type: 'chat:poll:create',
        question,
        options,
        allowMultiple: pollMultiple?.checked === true,
        durationSeconds: Number(pollDuration?.value || 0)
      });
      if (pollQuestion) pollQuestion.value = '';
      if (pollMultiple) pollMultiple.checked = false;
      renderPollOptionsEditor();
      closePollComposer();
    });

    pollComposer?.addEventListener('click', event => event.stopPropagation());

    document.addEventListener('click', (event) => {
      if (attachmentWrap && !attachmentWrap.contains(event.target)) {
        closeAttachmentMenu();
        closePollComposer();
        closeGifPicker();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeAttachmentMenu();
        closePollComposer();
        closeGifPicker();
      }
    });

    const setChatMediaBusy = (busy) => {
      if (!imageButton) return;
      imageButton.disabled = !!busy;
      imageButton.classList.toggle('is-uploading', !!busy);
      if (busy) imageButton.setAttribute('aria-busy', 'true');
      else imageButton.removeAttribute('aria-busy');
    };

    const uploadChatMedia = async (file, caption = '') => {
      if (!file) return;
      const type = String(file.type || '').toLowerCase();
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(type)) {
        throw new Error('PNG, JPG, WEBP or GIF images only.');
      }
      if (file.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.');
      const token = sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || '';
      setChatMediaBusy(true);
      try {
        const res = await fetch('/api/chat/image?caption=' + encodeURIComponent(caption), {
          method: 'POST',
          headers: { 'Content-Type': type, 'x-player-token': token },
          body: file
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'Image upload failed');
        return result;
      } finally {
        setChatMediaBusy(false);
      }
    };

    const uploadChatMediaUrl = async (imageUrl, caption = '') => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('Chat is not connected.');
      }
      setChatMediaBusy(true);
      try {
        this.send({ type: 'chat:image-url', url: imageUrl, caption });
      } finally {
        setChatMediaBusy(false);
      }
    };

    const clearChatAfterMedia = () => {
      if (chatInput) {
        chatInput.value = '';
        chatInput.maxLength = 100;
      }
      this._editingMessage = null;
      this._replyTo = null;
      const replyPreview = document.getElementById('chat-reply-preview');
      if (replyPreview) replyPreview.style.display = 'none';
      const replyPreviewText = document.getElementById('chat-reply-preview-text');
      if (replyPreviewText) replyPreviewText.textContent = '';
      this.closeChatMentionPicker?.();
    };

    const captionForMedia = () => {
      const text = chatInput?.value.trim() || '';
      const reply = this._replyTo;
      if (!reply) return text;
      const prefix = `↳ @${reply.name}${reply.excerpt ? ` // ${reply.excerpt}` : ''}: `;
      return prefix + text;
    };

    this._chatMediaComposer?.clear?.();
    this._chatMediaComposer = window.ChatMediaComposer?.create?.({
      form: document.getElementById('chat-form'),
      shellSelector: '.chat-composer-shell',
      getCaption: captionForMedia,
      clearCaption: clearChatAfterMedia,
      focus: () => chatInput?.focus(),
      uploadFile: uploadChatMedia,
      uploadUrl: uploadChatMediaUrl
    }) || null;

    // GLOBAL PLAYER IMAGE DROP GUARD
    // Desktop/browser drags often land outside the composer itself. Without
    // this guard the browser treats the payload as navigation and opens the
    // image in a new tab. Route any supported image/file/image-URL dropped
    // anywhere on the live player screen into the exact same staged composer.
    if (!this._globalChatMediaDropBound) {
      this._globalChatMediaDropBound = true;

      const playerScreenIsLive = () => {
        const screen = document.getElementById('game-screen');
        if (!screen) return false;
        const style = window.getComputedStyle(screen);
        return !screen.hidden && style.display !== 'none' && style.visibility !== 'hidden';
      };

      const transferLooksLikeMedia = (transfer) => {
        if (!transfer) return false;

        const types = Array.from(transfer.types || []).map(type => String(type).toLowerCase());
        if (types.includes('files') || types.includes('text/uri-list')) return true;

        const items = Array.from(transfer.items || []);
        if (items.some(item => item.kind === 'file' && /^image\//i.test(item.type || ''))) return true;

        const files = Array.from(transfer.files || []);
        if (files.some(file => /^image\/(?:png|jpeg|webp|gif)$/i.test(file.type || ''))) return true;

        const plain = String(transfer.getData?.('text/plain') || '').trim();
        return /^https?:\/\/\S+$/i.test(plain);
      };

      const setGlobalDropCue = (active) => {
        const formEl = document.getElementById('chat-form');
        formEl?.classList.toggle('media-dragover', !!active);
      };

      window.addEventListener('dragover', (event) => {
        if (!playerScreenIsLive() || !transferLooksLikeMedia(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        setGlobalDropCue(true);
      }, true);

      window.addEventListener('dragleave', (event) => {
        if (!playerScreenIsLive()) return;
        if (event.relatedTarget == null) setGlobalDropCue(false);
      }, true);

      window.addEventListener('drop', (event) => {
        if (!playerScreenIsLive() || !transferLooksLikeMedia(event.dataTransfer)) return;

        // This is the critical line: kill browser navigation first, then
        // stage the media. Even if staging rejects the payload, ASOC stays open.
        event.preventDefault();
        event.stopPropagation();
        setGlobalDropCue(false);

        const handled = this._chatMediaComposer?.handleDrop?.(event);
        if (handled) {
          this.closeChatMentionPicker?.();
          chatInput?.focus();
        }
      }, true);
    }

    imageInput?.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      imageInput.value = '';
      if (file) this._chatMediaComposer?.stageFile?.(file);
    });

    gifInput?.addEventListener('change', () => {
      const file = gifInput.files?.[0];
      gifInput.value = '';
      if (file) this._chatMediaComposer?.stageFile?.(file);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.joinGame();
    });

    document.getElementById('blood-tribute-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitBloodTribute();
    });

    nameInput.addEventListener('input', () => {
      this.updateAppearancePreview();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.joinGame();
      }
    });

    const avatarFile = document.getElementById('little-hero-avatar-file');
    const framePicker = document.getElementById('little-hero-frame-picker');
    const framePanel = document.getElementById('frame-color-panel');
    const frameField = document.getElementById('frame-color-field');
    const frameFieldCursor = document.getElementById('frame-color-field-cursor');
    const frameHue = document.getElementById('frame-hue');
    const framePresets = Array.from(document.querySelectorAll('[data-frame-color]'));
    const frameRow = framePicker?.closest('.little-hero-frame-row');
    const themeSelect = document.getElementById('theme-select');
    const themeToggle = document.getElementById('theme-select-toggle');
    const themeMenu = document.getElementById('theme-select-menu');
    const themeButtons = Array.from(document.querySelectorAll('.theme-option[data-theme-id]'));

    avatarFile?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        this.avatarData = await this.processAvatarFile(file);
        this._sendAvatarAppearance = true;
        this.getAppearanceStorage().setItem('asoc_little_hero_avatar', this.avatarData);
        this.updateAppearancePreview();
      } catch (error) {
        this.showError(error.message || 'Could not process avatar');
      }
    });

    const applyFrameColor = (value) => {
      if (!/^#[0-9A-Fa-f]{6}$/.test(value)) return false;
      this.frameColor = value.toUpperCase();
      this._sendFrameAppearance = true;
      this.getAppearanceStorage().setItem('asoc_little_hero_frame', this.frameColor);
      this.updateAppearancePreview();
      return true;
    };

    const closeFramePanel = () => {
      if (!framePanel || !framePicker) return;
      framePanel.hidden = true;
      framePicker.setAttribute('aria-expanded', 'false');
    };

    const applyFieldPoint = (clientX, clientY) => {
      if (!frameField || !frameHue) return;
      const rect = frameField.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const saturation = rect.width ? (x / rect.width) * 100 : 0;
      const value = rect.height ? 100 - (y / rect.height) * 100 : 0;
      applyFrameColor(this.hsvToHex(frameHue.value, saturation, value));
    };

    framePicker?.addEventListener('click', () => {
      if (!framePanel) return;
      const willOpen = framePanel.hidden;
      framePanel.hidden = !willOpen;
      framePicker.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) this.syncFrameColorEditor();
    });
    frameHue?.addEventListener('input', () => {
      const hsv = this.hexToHsv(this.frameColor);
      applyFrameColor(this.hsvToHex(frameHue.value, hsv.s, hsv.v));
    });
    frameField?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      frameField.setPointerCapture?.(e.pointerId);
      applyFieldPoint(e.clientX, e.clientY);
    });
    frameField?.addEventListener('pointermove', (e) => {
      if (!(e.buttons & 1)) return;
      applyFieldPoint(e.clientX, e.clientY);
    });
    frameField?.addEventListener('keydown', (e) => {
      const hsv = this.hexToHsv(this.frameColor);
      let s = hsv.s, v = hsv.v;
      if (e.key === 'ArrowLeft') s -= 2;
      else if (e.key === 'ArrowRight') s += 2;
      else if (e.key === 'ArrowUp') v += 2;
      else if (e.key === 'ArrowDown') v -= 2;
      else return;
      e.preventDefault();
      applyFrameColor(this.hsvToHex(hsv.h, Math.max(0,Math.min(100,s)), Math.max(0,Math.min(100,v))));
    });
    framePresets.forEach(button => button.addEventListener('click', () => applyFrameColor(button.dataset.frameColor)));
    document.addEventListener('pointerdown', (e) => {
      if (framePanel && !framePanel.hidden && frameRow && !frameRow.contains(e.target)) closeFramePanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && framePanel && !framePanel.hidden) closeFramePanel();
    });

    const applyThemeProfile = (themeId) => {
      const theme = ASOCThemes.get(themeId);
      this.themeId = theme.id;
      this.themeColor = theme.color;
      this._sendThemeAppearance = true;
      this._themeChangedByUser = true;
      this.getAppearanceStorage().setItem('asoc_little_hero_theme_id', this.themeId);
      this.getAppearanceStorage().setItem('asoc_little_hero_theme', this.themeColor);
      this.updateAppearancePreview();
    };

    const positionThemeMenu = () => {
      if (!themeSelect || !themeToggle || !themeMenu || themeMenu.hidden) return;
      const rect = themeToggle.getBoundingClientRect();
      const viewportPad = 12;
      const availableAbove = Math.max(0, rect.top - viewportPad - 5);
      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPad - 5);
      const openUp = availableBelow < 190 && availableAbove > availableBelow;
      const available = openUp ? availableAbove : availableBelow;
      const maxHeight = Math.max(132, Math.min(280, available));

      themeMenu.style.maxHeight = `${maxHeight}px`;
      themeSelect.classList.toggle('opens-up', openUp);
    };

    const closeThemeMenu = () => {
      if (!themeSelect || !themeToggle || !themeMenu) return;
      themeSelect.classList.remove('open', 'opens-up');
      themeToggle.setAttribute('aria-expanded', 'false');
      themeMenu.hidden = true;
    };

    themeToggle?.addEventListener('click', () => {
      const willOpen = !themeSelect?.classList.contains('open');
      if (!themeSelect || !themeMenu) return;
      themeSelect.classList.toggle('open', willOpen);
      themeToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      themeMenu.hidden = !willOpen;
      if (willOpen) requestAnimationFrame(positionThemeMenu);
    });

    themeButtons.forEach(button => {
      button.addEventListener('click', () => {
        applyThemeProfile(button.dataset.themeId);
        closeThemeMenu();
      });
    });

    document.addEventListener('click', (e) => {
      if (themeSelect && !themeSelect.contains(e.target)) closeThemeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeThemeMenu();
    });

    window.addEventListener('resize', positionThemeMenu);
    window.addEventListener('scroll', positionThemeMenu, true);
  },

  getAppearanceStorage() {
    return sessionStorage.getItem('asoc_master_persona') === 'PLAYER_TEST' ? sessionStorage : localStorage;
  },

  loadStoredCredentials() {
    const storedName = sessionStorage.getItem('asoc_player_name');
    const storedId = sessionStorage.getItem('asoc_player_id');
    const appearanceStorage = this.getAppearanceStorage();
    const storedAvatar = appearanceStorage.getItem('asoc_little_hero_avatar');
    const storedFrame = appearanceStorage.getItem('asoc_little_hero_frame');
    const storedThemeId = appearanceStorage.getItem('asoc_little_hero_theme_id');

    if (storedName) document.getElementById('player-name').value = storedName;
    if (storedId) this.playerId = storedId;

    if (storedAvatar !== null) {
      this.avatarData = storedAvatar;
      this._sendAvatarAppearance = true;
    }
    if (storedFrame && /^#[0-9A-Fa-f]{6}$/.test(storedFrame)) {
      this.frameColor = storedFrame.toUpperCase();
      this._sendFrameAppearance = true;
    }
    if (storedThemeId) {
      const theme = ASOCThemes.get(storedThemeId);
      this.themeId = theme.id;
      this.themeColor = theme.color;
      this._sendThemeAppearance = true;
    } else {
      const theme = ASOCThemes.get(ASOCThemes.DEFAULT_ID);
      this.themeId = theme.id;
      this.themeColor = theme.color;
    }
    this.updateAppearancePreview();
  },

  hexToHsv(hex) {
    const clean = String(hex || '#9B5DE0').replace('#', '');
    const r = parseInt(clean.slice(0,2),16) / 255;
    const g = parseInt(clean.slice(2,4),16) / 255;
    const b = parseInt(clean.slice(4,6),16) / 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * (((b - r) / d) + 2);
      else h = 60 * (((r - g) / d) + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    return { h: Math.round(h), s: Math.round(s * 100), v: Math.round(max * 100) };
  },

  hsvToHex(h, s, v) {
    h = ((Number(h) % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, Number(s))) / 100;
    v = Math.max(0, Math.min(100, Number(v))) / 100;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rp = 0, gp = 0, bp = 0;
    if (h < 60) [rp,gp,bp] = [c,x,0];
    else if (h < 120) [rp,gp,bp] = [x,c,0];
    else if (h < 180) [rp,gp,bp] = [0,c,x];
    else if (h < 240) [rp,gp,bp] = [0,x,c];
    else if (h < 300) [rp,gp,bp] = [x,0,c];
    else [rp,gp,bp] = [c,0,x];
    const part = n => Math.round((n + m) * 255).toString(16).padStart(2,'0').toUpperCase();
    return `#${part(rp)}${part(gp)}${part(bp)}`;
  },

  syncFrameColorEditor() {
    const controls = document.querySelector('.little-hero-frame-controls');
    const panel = document.getElementById('frame-color-panel');
    const hue = document.getElementById('frame-hue');
    const fieldCursor = document.getElementById('frame-color-field-cursor');
    const rOut = document.getElementById('frame-r');
    const gOut = document.getElementById('frame-g');
    const bOut = document.getElementById('frame-b');
    const label = document.getElementById('frame-color-label');
    const hsv = this.hexToHsv(this.frameColor);
    const clean = this.frameColor.replace('#','');
    const rgb = {
      r: parseInt(clean.slice(0,2),16),
      g: parseInt(clean.slice(2,4),16),
      b: parseInt(clean.slice(4,6),16)
    };
    if (controls) controls.style.setProperty('--lh-frame', this.frameColor);
    if (panel) {
      panel.style.setProperty('--lh-frame', this.frameColor);
      panel.style.setProperty('--frame-hue', hsv.h);
    }
    if (hue) hue.value = hsv.h;
    if (fieldCursor) {
      fieldCursor.style.left = `${hsv.s}%`;
      fieldCursor.style.top = `${100 - hsv.v}%`;
    }
    if (rOut) rOut.textContent = rgb.r;
    if (gOut) gOut.textContent = rgb.g;
    if (bOut) bOut.textContent = rgb.b;
    if (label) {
      const names = {
        '#9B5DE0':'PURPLE',
        '#D94B62':'CRIMSON',
        '#E38B2C':'AMBER',
        '#E5C84B':'GOLD',
        '#4FB36C':'GREEN',
        '#3FA7C9':'CYAN',
        '#4F6EE8':'BLUE',
        '#D36BC4':'PINK'
      };
      label.textContent = names[this.frameColor] || this.frameColor;
    }
  },

  updateAppearancePreview() {
    const preview = document.getElementById('little-hero-avatar-preview');
    const image = document.getElementById('little-hero-avatar-image');
    const gameScreen = document.getElementById('game-screen');
    if (preview) preview.style.setProperty('--lh-frame', this.frameColor);
    this.syncFrameColorEditor();
    const theme = ASOCThemes.get(this.themeId);
    ASOCThemes.applyToScreen(gameScreen, theme.id);

    const profileCard = document.getElementById('little-hero-profile-preview');
    const joinScreen = document.getElementById('join-screen');
    const profileTheme = document.getElementById('little-hero-profile-theme');
    const profileName = document.getElementById('little-hero-profile-name');
    const nameInput = document.getElementById('player-name');
    if (profileCard) {
      profileCard.dataset.themeId = theme.id;
      profileCard.style.setProperty('--profile-theme', theme.color);
      profileCard.style.setProperty('--profile-shell-top', theme.shellTop);
      profileCard.style.setProperty('--profile-shell-bottom', theme.shellBottom);
      profileCard.style.setProperty('--profile-banner-accent', theme.bannerAccent || theme.color);
      profileCard.style.setProperty('--profile-banner-glow', theme.bannerGlow || theme.ambient);
      profileCard.style.setProperty('--profile-border-accent', theme.borderAccent || theme.color);
    }
    if (joinScreen) {
      joinScreen.dataset.themeId = theme.id;
      joinScreen.style.setProperty('--join-theme-ambient', theme.ambientStrength || theme.ambient);
    }
    if (profileTheme) profileTheme.textContent = theme.name;
    if (profileName) profileName.textContent = (nameInput?.value || '').trim() || 'LITTLE HERO';

    const themeSelect = document.getElementById('theme-select');
    const themePreview = document.getElementById('theme-select-preview');
    const themeName = document.getElementById('theme-select-name');
    const themeSubtitle = document.getElementById('theme-select-subtitle');
    if (themeSelect) {
      themeSelect.dataset.themeId = theme.id;
      themeSelect.style.setProperty('--selector-accent', theme.bannerAccent || theme.color);
      themeSelect.style.setProperty('--selector-glow', theme.bannerGlow || theme.ambient);
      themeSelect.style.setProperty('--selector-border', theme.borderAccent || theme.color);
    }
    if (themePreview) themePreview.className = `theme-select-preview ${theme.id}`;
    if (themeName) themeName.textContent = theme.name;
    if (themeSubtitle) themeSubtitle.textContent = `${theme.code || '--'} // ${theme.subtitle}`;

    document.querySelectorAll('.theme-option[data-theme-id]').forEach(button => {
      const active = button.dataset.themeId === theme.id;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      const state = button.querySelector('.theme-option-state');
      if (state) state.textContent = active ? 'ACTIVE' : 'SELECT';
    });
    if (preview && image) {
      if (this.avatarData) {
        image.src = this.avatarData;
        preview.classList.add('has-image');
      } else {
        image.removeAttribute('src');
        preview.classList.remove('has-image');
      }
    }
  },

  processAvatarFile(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
        reject(new Error('Avatar must be PNG, JPG, or WEBP'));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error('Avatar source image is too large'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read avatar image'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Could not decode avatar image'));
        image.onload = () => {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const crop = Math.min(image.naturalWidth, image.naturalHeight);
          const sx = (image.naturalWidth - crop) / 2;
          const sy = (image.naturalHeight - crop) / 2;
          ctx.drawImage(image, sx, sy, crop, crop, 0, 0, size, size);
          const data = canvas.toDataURL('image/webp', 0.82);
          if (data.length > 190000) {
            reject(new Error('Processed avatar is still too large'));
            return;
          }
          resolve(data);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  },

  async updateDesignation(requestedName) {
    const playerName = String(requestedName || '').trim().slice(0, 20);
    if (!playerName) throw new Error('Name cannot be empty');

    const authToken = sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || '';
    if (!authToken) throw new Error('Little Hero authentication required');

    const res = await fetch('/api/auth/player/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-player-token': authToken
      },
      body: JSON.stringify({ name: playerName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update Little Hero designation');

    const canonicalName = String(data.player?.name || playerName).trim();
    this.playerName = canonicalName;
    sessionStorage.setItem('asoc_player_name', canonicalName);
    const input = document.getElementById('player-name');
    if (input) input.value = canonicalName;
    this.updateAppearancePreview();
    return canonicalName;
  },

  bindDesignationEditor() {
    const identity = document.getElementById('hero-hud-identity');
    if (!identity || identity._designationEditorBound) return;
    identity._designationEditorBound = true;
    identity.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action="rename-little-hero"]');
      if (!button) return;
      const currentName = this.playerName || sessionStorage.getItem('asoc_player_name') || '';
      const requested = window.prompt('NEW LITTLE HERO DESIGNATION', currentName);
      if (requested === null) return;
      button.disabled = true;
      try {
        await this.updateDesignation(requested);
      } catch (error) {
        this.showError(error.message || 'Could not update Little Hero designation');
      } finally {
        button.disabled = false;
      }
    });
  },

  async joinGame() {
    let playerName = document.getElementById('player-name').value.trim();

    if (!playerName) {
      this.showError('Please enter your name');
      return;
    }

    const authToken = sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || '';
    const storedName = (sessionStorage.getItem('asoc_player_name') || '').trim();
    if (authToken && playerName !== storedName) {
      try {
        playerName = await this.updateDesignation(playerName);
      } catch (error) {
        this.showError(error.message || 'Could not update Little Hero designation');
        return;
      }
    }

    this.roomCode = 'MASTER';
    this.playerName = playerName;
    // Fresh join attempt — any previous room-closed state no longer applies.
    this._roomClosedByServer = false;

    sessionStorage.setItem('asoc_player_name', playerName);
    if (this.playerId) sessionStorage.setItem('asoc_player_id', this.playerId);

    this.connectWebSocket();
  },

  connectWebSocket() {
    // Never create a second live socket for the same page. Two concurrent
    // sockets with one authenticated Little Hero id can supersede each other
    // forever: new socket closes old -> old reconnects -> closes new -> repeat.
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    this._protocolReady = false;
    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    socket.onopen = () => {
      // Ignore callbacks from a socket that has already been superseded locally.
      if (this.ws !== socket) return;
      console.log('[PLAYER] WebSocket connected');
      this._victoryBaselined = false;
      this._columnCascadeBaselined = false;
      this._columnCascadeStarts = {};
      this.setConnectionStatus('connecting');
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error('[PLAYER] Message parse error:', e);
      }
    };

    socket.onclose = (event) => {
      // A stale socket must never start a new reconnect cycle after a newer
      // socket has already replaced it.
      if (this.ws !== socket) return;
      this.ws = null;
      console.log('[PLAYER] WebSocket closed', event.code, event.reason || '');

      // 4001 is the server's deliberate "newer login won" close. Reconnecting
      // this superseded client is exactly what creates the perpetual duel.
      if (event.code === 4001) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.setConnectionStatus('disconnected');
        this.showJoinScreen();
        this.showError('This Little Hero identity is active in another tab or device.');
        return;
      }

      // Deliberate moderation closes must never enter the automatic reconnect
      // loop. Kicks may be manually retried; bans will be rejected server-side
      // against the authenticated account id on every future join attempt.
      if (event.code === 4002 || event.code === 4003) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        const masterMirror = sessionStorage.getItem('asoc_master_persona') === 'PLAYER_TEST';
        (masterMirror ? sessionStorage : localStorage).removeItem('asoc_player_in_master');
        this.setConnectionStatus('disconnected');
        this.showJoinScreen();
        this.showError(event.code === 4003
          ? 'ACCESS DENIED // Shadow Broker has banned this Little Hero from the Master Room.'
          : 'CONNECTION TERMINATED // Shadow Broker removed you from the Master Room.');
        return;
      }

      this.handleDisconnect();
    };

    socket.onerror = (err) => {
      if (this.ws !== socket) return;
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
      case 'protocol:hello':
        this.send({ type: 'protocol:hello', protocolVersion: 1 });
        break;

      case 'protocol:ready': {
        this._protocolReady = true;
        // Only join after both sides agree on the wire protocol. A stale
        // browser therefore cannot accidentally issue commands to a newer
        // server (or vice versa).
        const joinMessage = {
          type: 'room:join',
          name: this.playerName,
          authToken: sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || ''
        };
        if (this._sendAvatarAppearance) joinMessage.avatarData = this.avatarData;
        if (this._sendFrameAppearance) joinMessage.frameColor = this.frameColor;
        if (this._sendThemeAppearance) {
          joinMessage.themeId = this.themeId;
          joinMessage.themeColor = this.themeColor;
          joinMessage.themeColorExplicit = this._themeChangedByUser;
        }
        this.send(joinMessage);
        break;
      }

      case 'protocol:mismatch':
        this._protocolReady = false;
        this.setConnectionStatus('disconnected');
        alert(message.message || 'SYSTEM VERSION MISMATCH // REFRESH REQUIRED');
        break;

      case 'state:public': {
        const previousState = this.lastPublicState;
        const roomMode = message.roomMode || (message.armed === true ? 'BATTLE_ARMED' : 'CASUAL');
        const battleVisible = roomMode !== 'CASUAL';
        const boardChanged = !!(previousState?.gameId && message.gameId && previousState.gameId !== message.gameId);
        if (boardChanged || !battleVisible) {
          document.querySelector('.victory-overlay')?.remove();
          document.querySelector('.defeat-overlay')?.remove();
          Skeleton.closeAftermath?.();
        }

        const cascadeNow = Date.now();
        if (battleVisible && this._columnCascadeBaselined) {
          ['A', 'B', 'C', 'D'].forEach(column => {
            const previousOutcome = previousState?.cells?.[`${column}5`]?.outcome || null;
            const nextOutcome = message.cells?.[`${column}5`]?.outcome || null;
            if (previousOutcome !== 'success' && nextOutcome === 'success') {
              this._columnCascadeStarts[column] = cascadeNow;
            }
          });
        }
        this._columnCascadeBaselined = true;
        this.lastPublicState = message;
        this.applyRoomMode(roomMode);
        if (battleVisible) {
          window.AsocAudio?.syncBoard?.('player', message);
          this.renderBoard(message, previousState);
        } else {
          window.AsocAudio?.resetObservers?.();
        }
        this.applyVictoryState(battleVisible && message.gameWon === true, battleVisible ? (message.matchResult || null) : null);
        this.applyLossState(battleVisible ? (message.matchResult || null) : null);
        if (!battleVisible) {
          // CASUAL hides the battle, it does not end it. Re-entering BATTLE is
          // a hydration (like a late join), so a WON/LOST match already on the
          // board must not replay its live ceremony on every toggle.
          this._victoryBaselined = false;
          this._lossBaselined = false;
        }
        this.applyFinalSolverAura(battleVisible ? (message.finalSolverAura || null) : null, message.serverNow);
        Womf.update('womf-tracker-player', battleVisible ? (message.womf || { charge: 0, armed: false }) : { charge: 0, armed: false });
        Wheel.update('wheel-overlay', battleVisible ? message.wheel : { open: false, segments: [], phase: 'idle', winnerIndex: null, spinToken: null }, false);
        this.updateBloodTributeDemand(battleVisible ? (message.bloodTribute || { status: 'idle' }) : { status: 'idle' });
        Timer.update('timer-tracker-player', battleVisible ? (message.timer || { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 }) : { phase: 'ready', duration: 0, remaining: 0, borrowedDuration: 0, borrowedRemaining: 0 }, false);
        if (battleVisible) this.updateTerminalPhase(message);
        else Recount.apply(null);
        document.getElementById('game-screen')?.classList.toggle('phase-final', battleVisible && message.finalSolution?.revealed === true);
        this.showGameScreen();
        this.setConnectionStatus('connected');
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        break;
      }

      case 'join:success':
        this.playerId = message.playerId;
        sessionStorage.setItem('asoc_player_id', this.playerId);
        requestAnimationFrame(() => this._restorePlayerLayoutRatio?.());
        const masterMirror = sessionStorage.getItem('asoc_master_persona') === 'PLAYER_TEST';
        (masterMirror ? sessionStorage : localStorage).setItem('asoc_player_in_master', '1');
        this.updateBloodTributeDemand(this.lastPublicState?.bloodTribute || { status: 'idle' });
        if (message.littleHero) {
          if (message.littleHero.name) {
            this.playerName = String(message.littleHero.name);
            sessionStorage.setItem('asoc_player_name', this.playerName);
            const nameInput = document.getElementById('player-name');
            if (nameInput) nameInput.value = this.playerName;
          }
          this.avatarData = message.littleHero.avatarData || '';
          this.frameColor = /^#[0-9A-Fa-f]{6}$/.test(message.littleHero.frameColor || '')
            ? message.littleHero.frameColor.toUpperCase()
            : '#9B5DE0';
          const theme = ASOCThemes.get(message.littleHero.themeId || ASOCThemes.DEFAULT_ID);
          this.themeId = theme.id;
          this.themeColor = theme.color;
          const appearanceStorage = masterMirror ? sessionStorage : localStorage;
          appearanceStorage.setItem('asoc_little_hero_avatar', this.avatarData);
          appearanceStorage.setItem('asoc_little_hero_frame', this.frameColor);
          appearanceStorage.setItem('asoc_little_hero_theme_id', this.themeId);
          appearanceStorage.setItem('asoc_little_hero_theme', this.themeColor);
          this._sendAvatarAppearance = true;
          this._sendFrameAppearance = true;
          this._sendThemeAppearance = true;
          this._themeChangedByUser = false;
          this.updateAppearancePreview();
        }
        break;

      case 'chat:update': {
        const incoming = message.messages || [];
        const previousIds = new Set(this.chatMessages.map(m => m.id));
        const previousById = new Map(this.chatMessages.map(m => [m.id, m]));
        this._chatArrivalIds = new Set();
        this._chatVerdictTransitionIds = new Set();
        let followLatest = false;
        // Only look for a "new" standalone Broker broadcast to trigger the
        // board-line reveal AFTER the first hydration -- otherwise a
        // player joining mid-game would see the room's entire chat history
        // replay as a fresh transmission the moment they connect.
        if (this._chatEverInitialized) {
          const newMessages = incoming.filter(m => !previousIds.has(m.id));
          followLatest = newMessages.some(m =>
            String(m.playerId || '') === String(this.playerId || '')
          );
          const verdictUpdates = incoming.filter(m => {
            const previous = previousById.get(m.id);
            return previous && previous.verdict !== m.verdict && m.verdict;
          });
          if (verdictUpdates.some(m => m.verdict === 'correct')) {
            window.AsocAudio?.correct?.();
          }
          this._chatArrivalIds = new Set(
            newMessages
              .filter(m => m?.source !== 'shadowBroker')
              .map(m => String(m.id || ''))
              .filter(Boolean)
          );
          this._chatVerdictTransitionIds = new Set(
            verdictUpdates.map(m => String(m.id || '')).filter(Boolean)
          );

          const newActivityCount = newMessages.length + verdictUpdates.length;
          if (this.userScrolledUp && newActivityCount) {
            this._newMessageCount += newActivityCount;
            this.updateNewMessageChip();
          }
          const newBrokerMsg = newMessages.find(m => m.source === 'shadowBroker');
          if (newBrokerMsg) {
            this.playShadowBrokerBoardLine(newBrokerMsg.text);
            const panel = document.getElementById('chat-panel');
            panel?.classList.add('broker-priority');
            clearTimeout(this._brokerPriorityTimer);
            this._brokerPriorityTimer = setTimeout(() => panel?.classList.remove('broker-priority'), 4200);
          }
        }
        const verdictNow = Date.now();
        incoming.forEach(msg => {
          const previous = previousById.get(msg.id);
          if (msg.verdict === 'wrong') {
            if (previous?.verdict !== 'wrong') {
              this._wrongVerdictSeenAt.set(
                msg.id,
                this._chatEverInitialized ? verdictNow : verdictNow - 3000
              );
            } else if (!this._wrongVerdictSeenAt.has(msg.id)) {
              this._wrongVerdictSeenAt.set(msg.id, verdictNow - 3000);
            }
          } else {
            this._wrongVerdictSeenAt.delete(msg.id);
          }
        });
        this._chatEverInitialized = true;
        this.chatMessages = incoming;
        this.solvedTargets = message.solvedTargets || {};
        const solvedCount = document.getElementById('chat-solved-count');
        if (solvedCount) solvedCount.textContent = this.roomMode === 'CASUAL' ? 'CHANNEL OPEN' : `SOLVED: ${Object.keys(this.solvedTargets).length}/5`;
        this.renderChat({ forceLatest: followLatest });
        this._chatArrivalIds.clear();
        this._chatVerdictTransitionIds.clear();
        break;
      }

      case 'shadowBroker:clear':
        this.clearShadowBrokerBoardLine();
        break;

      case 'players:update': {
        this.updatePlayerLeaderboard(message.players);
        const commsRoom = document.getElementById('battle-comms-room');
        const commsOnline = document.getElementById('battle-comms-online');
        const casualOnline = document.getElementById('casual-online-count');
        const onlineCount = (message.players || []).filter(p => p.connected !== false).length;
        if (commsRoom) commsRoom.textContent = this.roomMode === 'CASUAL'
          ? 'AMUSEMENT PARK // MASTER ROOM'
          : 'ABUSEMENT PARK // MASTER ROOM';
        if (commsOnline) commsOnline.textContent = '● ' + onlineCount + ' ONLINE';
        if (casualOnline) {
          const value = casualOnline.querySelector('b');
          if (value) value.textContent = onlineCount;
          casualOnline.setAttribute('aria-label', onlineCount + ' players online');
        }
        break;
      }

      case 'battle:launchCountdown':
        // Mirror the GM's full-screen T-10 launch sequence on every player
        // client. This is presentation only; the authoritative game timer
        // still starts from the host's gm:timerStart at zero.
        Timer.runStartCountdown('timer-tracker-player');
        break;

      case 'battle:controlsOnline':
        this.showBattleControlsOnline();
        this.addBattleEvent('BATTLE CONTROLS ONLINE');
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

      case 'threefold:challenge':
        window.Threefold?.onChallenge?.(message);
        break;

      case 'threefold:declined':
        window.Threefold?.onDeclined?.(message);
        break;

      case 'threefold:state':
        window.Threefold?.onState?.(message);
        break;

      case 'threefold:closed':
        window.Threefold?.onClosed?.(message);
        break;

      case 'score:event':
        this.showScoreToast(message);
        if (message.awardType === 'final') window.AsocAudio?.finalSolved?.();
        else window.AsocAudio?.columnSolved?.();
        this.addBattleEvent(`${message.playerName} // ${message.awardType === 'final' ? 'FINAL SOLUTION' : 'COLUMN ' + message.target} // +${message.points}`);
        break;

      case 'score:streak': {
        this.showStreakBanner(message.activeStreak);
        const streak = document.getElementById('hero-hud-streak');
        if (streak) {
          streak.textContent = message.activeStreak?.playerId === this.playerId
            ? 'x' + message.activeStreak.columnCount
            : 'x0';
        }
        if (message.activeStreak) {
          this.addBattleEvent(`${message.activeStreak.playerName} // STREAK x${message.activeStreak.columnCount}`);
        }
        break;
      }

      case 'score:finalReveal':
        this.showFinalReveal(message);
        this.addBattleEvent('FINAL PHASE ENGAGED');
        document.getElementById('game-screen')?.classList.add('phase-final');
        break;

      case 'score:finalResults':
        this.revealFinalResults(message);
        break;

      case 'match:aftermath':
        document.querySelector('.victory-overlay')?.remove();
        document.querySelector('.defeat-overlay')?.remove();
        Skeleton.playAftermath(message.result || {}, { isHost: false });
        break;

      case 'recount:update':
        // RECOUNT is the server-authoritative signal that the Shadow Broker
        // advanced beyond AFTERMATH. Close the epilogue for every Little Hero
        // at the same instant before presenting results.
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

      case 'tribute:accepted': {
        this.tributeUploading = false;
        const status = document.getElementById('blood-tribute-status');
        if (status) status.textContent = 'TRIBUTE ACCEPTED // PUBLIC WINDOW 02:00';
        const file = document.getElementById('blood-tribute-file');
        if (file) file.value = '';
        break;
      }

      case 'moderation:kicked':
      case 'moderation:banned': {
        const masterMirror = sessionStorage.getItem('asoc_master_persona') === 'PLAYER_TEST';
        (masterMirror ? sessionStorage : localStorage).removeItem('asoc_player_in_master');
        this.showError(message.message || (message.type === 'moderation:banned'
          ? 'ACCESS DENIED // This Little Hero is banned from the Master Room.'
          : 'CONNECTION TERMINATED // Shadow Broker removed you from the Master Room.'));
        break;
      }

      case 'auth:required': {
        const masterMirror = sessionStorage.getItem('asoc_master_persona') === 'PLAYER_TEST';
        if (!masterMirror) localStorage.removeItem('asoc_player_auth_token');
        sessionStorage.removeItem('asoc_player_auth_token');
        this.showError(message.message || 'Little Hero authentication required');
        setTimeout(() => location.replace(masterMirror ? '/join.html?masterMirror=1' : '/join.html'), 700);
        break;
      }

      case 'error':
        this.showError(message.message);
        if (this.bloodTribute?.status === 'required') {
          this.tributeUploading = false;
          const tributeStatus = document.getElementById('blood-tribute-status');
          if (tributeStatus) tributeStatus.textContent = message.message || 'TRIBUTE REJECTED';
        }
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

  renderBoard(state, previousState = null) {
    const publicBoard = document.getElementById('public-board');
    if (!publicBoard || !state) return;

    const columns = ['A', 'B', 'C', 'D'];
    this._revealFlashUntil ||= {};
    if (previousState) {
      Object.entries(state.cells || {}).forEach(([key, cell]) => {
        if (cell?.revealed === true && previousState.cells?.[key]?.revealed !== true) {
          this._revealFlashUntil[key] = Date.now() + 2500;
        }
      });
      if (state.finalSolution?.revealed === true && previousState.finalSolution?.revealed !== true) {
        this._revealFlashUntil.FINAL = Date.now() + 2500;
      }
    }
    this.solutionCountdowns = state.solutionCountdowns || {};
    this.hintClaims = state.hintClaims || {};
    const gameId = String(state.gameId || '');
    const difficulty = String(state.difficulty || '');

    const gameData = {
      id: state.gameId,
      title: state.title,
      theme: state.theme,
      difficulty: state.difficulty,
      background: state.background,
      columns: {},
      finalSolution: state.finalSolution?.value || ''
    };
    columns.forEach(col => {
      gameData.columns[col] = { clues: ['', '', '', ''], solution: '' };
    });
    Object.entries(state.cells || {}).forEach(([key, cell]) => {
      if (!cell?.revealed || !cell.value) return;
      const col = key[0];
      const row = parseInt(key.slice(1), 10);
      if (row >= 1 && row <= 4) gameData.columns[col].clues[row - 1] = cell.value;
      else if (row === 5) gameData.columns[col].solution = cell.value;
    });
    window.GameData.currentGame = gameData;

    const boardSignature = JSON.stringify({
      gameId,
      difficulty,
      cells: Object.fromEntries(
        Object.entries(state.cells || {}).map(([key, cell]) => [
          key,
          [!!cell?.revealed, cell?.revealed ? String(cell?.value || '') : '', String(cell?.outcome || '')]
        ])
      ),
      final: [
        !!state.finalSolution?.revealed,
        state.finalSolution?.revealed ? String(state.finalSolution?.value || '') : '',
        String(state.finalSolution?.outcome || '')
      ]
    });

    const existingBoard = publicBoard.querySelector(':scope > .asoc-board');
    const mustRebuild = !existingBoard
      || this._renderedBoardGameId !== gameId
      || this._renderedBoardDifficulty !== difficulty;

    if (mustRebuild) {
      let html = `
        <div class="asoc-board">
          ${Skeleton.skeletonHTML(state.difficulty)}
          ${this.renderShadowBrokerLineHTML()}
      `;

      for (let row = 1; row <= 4; row++) {
        columns.forEach(col => {
          const key = `${col}${row}`;
          const cell = state.cells?.[key];
          const revealed = cell?.revealed === true;
          const content = revealed ? (cell.value || '—') : '■■■';
          html += this.createPublicCellHTML(key, content, false, revealed, key);
        });
      }

      columns.forEach(col => {
        const key = `${col}5`;
        const cell = state.cells?.[key];
        const revealed = cell?.revealed === true;
        const content = revealed ? (cell.value || '—') : '■■■';
        html += this.createPublicCellHTML(key, content, true, revealed, key, false, cell?.outcome || null);
      });

      const finalRevealed = state.finalSolution?.revealed === true;
      const finalContent = finalRevealed ? (state.finalSolution.value || '—') : '???';
      const finalOutcome = state.finalSolution?.outcome || null;
      const playFinalFlourish = finalRevealed && !this._finalFlourishPlayed;
      this._finalFlourishPlayed = finalRevealed;
      html += this.createPublicCellHTML('FINAL', finalContent, true, finalRevealed, 'FINAL', true, finalOutcome, playFinalFlourish);
      html += '</div>';

      publicBoard.innerHTML = html;
      const board = publicBoard.querySelector(':scope > .asoc-board');
      Skeleton.attach(board);

      this._renderedBoardGameId = gameId;
      this._renderedBoardDifficulty = difficulty;
      this._boardRenderSignature = boardSignature;
      this.applyRevealFlash(publicBoard.querySelector(':scope > .asoc-board'));
      this.renderSolutionCountdownBadges();
      this.renderHintButtons();
      this.applyBackground(state.background);
      return;
    }

    const board = existingBoard;
    const boardChanged = boardSignature !== this._boardRenderSignature;

    if (boardChanged) {
      const syncCell = (key, content, isSolution, revealed, isFinal = false, outcome = null, flourish = false) => {
        const cell = board.querySelector(`.board-cell[data-label="${CSS.escape(key)}"]`);
        if (!cell) return;

        const classes = ['board-cell'];
        if (isSolution) classes.push('solution-cell');
        if (isFinal) classes.push('final-solution');
        classes.push(revealed ? 'revealed' : 'hidden');
        if (outcome === 'failed') classes.push('outcome-failed');
        if (flourish) classes.push('final-flourish');

        const cascade = revealed ? this.columnCascadePresentation(key) : { active:false, className:'', style:'' };
        if (cascade.active) classes.push(...cascade.className.split(' ').filter(Boolean));

        const nextClass = classes.join(' ');
        if (cell.className !== nextClass) cell.className = nextClass;

        const nextStyle = `${Skeleton.cellStyle(key)}${cascade.style || ''}`;
        if (cell.getAttribute('style') !== nextStyle) cell.setAttribute('style', nextStyle);

        const text = cell.querySelector('.cell-text');
        const nextText = String(content ?? '');
        if (text && text.textContent !== nextText) text.textContent = nextText;
      };

      for (let row = 1; row <= 4; row++) {
        columns.forEach(col => {
          const key = `${col}${row}`;
          const cell = state.cells?.[key];
          const revealed = cell?.revealed === true;
          syncCell(key, revealed ? (cell.value || '—') : '■■■', false, revealed);
        });
      }

      columns.forEach(col => {
        const key = `${col}5`;
        const cell = state.cells?.[key];
        const revealed = cell?.revealed === true;
        syncCell(key, revealed ? (cell.value || '—') : '■■■', true, revealed, false, cell?.outcome || null);
      });

      const finalRevealed = state.finalSolution?.revealed === true;
      const playFinalFlourish = finalRevealed && !this._finalFlourishPlayed;
      this._finalFlourishPlayed = finalRevealed;
      syncCell(
        'FINAL',
        finalRevealed ? (state.finalSolution?.value || '—') : '???',
        true,
        finalRevealed,
        true,
        state.finalSolution?.outcome || null,
        playFinalFlourish
      );

      this._boardRenderSignature = boardSignature;
      Skeleton.fit(board);
    }

    this.applyRevealFlash(board);
    this.renderSolutionCountdownBadges();
    this.renderHintButtons();
    this.renderShadowBrokerBoardLineInPlace();
    this.applyBackground(state.background);
  },

  applyRevealFlash(board) {
    if (!board) return;
    const now = Date.now();
    Object.entries(this._revealFlashUntil || {}).forEach(([key, deadline]) => {
      const cell = board.querySelector(`.board-cell[data-label="${CSS.escape(key)}"]`);
      if (!cell) return;
      if (deadline > now) {
        cell.classList.add('cell-new-reveal-flash');
        setTimeout(() => cell.classList.remove('cell-new-reveal-flash'), Math.max(0, deadline - now));
      } else {
        delete this._revealFlashUntil[key];
        cell.classList.remove('cell-new-reveal-flash');
      }
    });
  },

  renderSolutionCountdownBadges() {
    const board = document.querySelector('#public-board > .asoc-board');
    if (!board) return;
    board.querySelectorAll('.solution-countdown-badge').forEach(el => el.remove());
    clearTimeout(this._solutionCountdownTicker);
    const now = Date.now();
    let active = false;
    Object.values(this.solutionCountdowns || {}).forEach(entry => {
      const remaining = Math.max(0, Number(entry.deadline || 0) - now);
      if (remaining <= 0) return;
      active = true;
      const key = entry.target === 'FINAL' ? 'FINAL' : entry.target + '5';
      const cell = board.querySelector(`.board-cell[data-label="${CSS.escape(key)}"]`);
      if (!cell) return;
      const total = Math.ceil(remaining / 1000);
      const badge = document.createElement('div');
      badge.className = 'solution-countdown-badge';
      badge.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      cell.appendChild(badge);
    });
    if (active) this._solutionCountdownTicker = setTimeout(() => this.renderSolutionCountdownBadges(), 250);
  },

  renderHintButtons() {
    const board = document.querySelector('#public-board > .asoc-board');
    if (!board) return;
    board.querySelectorAll('.cell-hint-button').forEach(el => el.remove());
    if (this.roomMode !== 'BATTLE') return;

    for (const col of ['A', 'B', 'C', 'D']) {
      for (let row = 1; row <= 4; row++) {
        const key = `${col}${row}`;
        const cellState = this.lastPublicState?.cells?.[key];
        if (cellState?.revealed !== true) continue;
        const cell = board.querySelector(`.board-cell[data-label="${CSS.escape(key)}"]`);
        if (!cell) continue;
        const claim = this.hintClaims?.[key];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell-hint-button' + (claim ? ' is-used' : '');
        button.textContent = claim ? 'HINT USED' : 'HINT';
        button.disabled = !!claim;
        button.title = claim ? `Hint used by ${claim.playerName || 'Little Hero'}` : `Request the one hint available for ${key}`;
        if (!claim) {
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            button.disabled = true;
            this.send({ type: 'player:hintRequest', cell: key });
          });
        }
        cell.appendChild(button);
      }
    }
  },

  renderShadowBrokerBoardLineInPlace() {
    const board = document.querySelector('#public-board > .asoc-board');
    if (!board) return;

    const current = board.querySelector(':scope > .shadow-broker-board-line');
    const markup = this.renderShadowBrokerLineHTML();

    if (!markup) {
      current?.remove();
      return;
    }

    const holder = document.createElement('div');
    holder.innerHTML = markup.trim();
    const next = holder.firstElementChild;
    if (!next) return;

    if (current) current.replaceWith(next);
    else {
      const skeleton = board.querySelector(':scope > .skeleton-img');
      if (skeleton?.nextSibling) board.insertBefore(next, skeleton.nextSibling);
      else board.appendChild(next);
    }
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
        <span class="shadow-broker-board-line-text" style="opacity:${state.opacity.toFixed(3)}${interruptStyle}">${window.CommanderEmojis?.renderText?.(state.visibleText, 'commander-board-emoji') || this.escapeHtml(state.visibleText)}</span>
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
      this.renderShadowBrokerBoardLineInPlace();
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
    this.renderShadowBrokerBoardLineInPlace();
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

    return `
      <div class="${classes.join(' ')}" data-label="${label}" style="${Skeleton.cellStyle(label)}${cascade.style}">
        <div class="cell-content"><span class="cell-text">${this.escapeHtml(content)}</span></div>
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

  applyBackground(path) {
    const bgLayer = document.getElementById('background-layer');
    if (!bgLayer) return;
    const next = String(path || '');
    const current = bgLayer.getAttribute('src') || '';
    if (current === next) return;
    bgLayer.setAttribute('src', next);
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
        <div class="asoc-mode-transition-eye"><img src="/assets/ui/asoc-favicon.svg?v=1" alt=""></div>
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
    const hadBaseline = this._masterStateBaselined;
    this.roomMode = next;
    this.masterArmed = next !== 'CASUAL';
    this._masterStateBaselined = true;
    if (hadBaseline) this.playRoomModeTransition(previous, next);

    const screen = document.getElementById('game-screen');
    const standby = document.getElementById('master-room-standby');
    if (screen) {
      screen.classList.toggle('master-room-unarmed', next === 'CASUAL');
      screen.classList.toggle('room-mode-casual', next === 'CASUAL');
      screen.classList.toggle('room-mode-battle-armed', next === 'BATTLE_ARMED');
      screen.classList.toggle('room-mode-battle', next === 'BATTLE');
      screen.classList.toggle('room-mode-recount', next === 'RECOUNT');
      screen.dataset.roomMode = next;
    }
    if (standby) standby.hidden = true;
    Recount.refreshPill?.();

    const title = document.querySelector('.chat-title');
    const roomLabel = document.getElementById('battle-comms-room');
    const solvedCount = document.getElementById('chat-solved-count');
    if (title) {
      title.innerHTML = next === 'CASUAL'
        ? '<span class="casual-network-name">ASOC NETWORK</span><span class="casual-network-state"> // AMUSEMENT PARK</span>'
        : 'BATTLE COMMS';
    }
    if (roomLabel) roomLabel.textContent = next === 'CASUAL'
      ? 'MASTER ROOM'
      : 'ABUSEMENT PARK // MASTER ROOM';
    if (solvedCount) solvedCount.textContent = next === 'CASUAL'
      ? 'CHANNEL OPEN'
      : `SOLVED: ${Object.keys(this.solvedTargets).length}/5`;

    // Casual and Battle are the SAME transcript. Re-render only when the
    // room mode actually changes; state:public also carries timer/cell ticks,
    // and rebuilding chat for those packets causes visible shimmer and lag.
    if (previous !== next && Array.isArray(this.chatMessages)) this.renderChat();

    if (hadBaseline && previous === 'CASUAL' && next === 'BATTLE_ARMED') {
      this.addBattleEvent('BATTLE CONTROL SIGNAL DETECTED');
    } else if (hadBaseline && (previous === 'BATTLE' || previous === 'RECOUNT') && next === 'CASUAL') {
      this.addBattleEvent('SYSTEM UNARMED // COMMUNICATION CHANNEL OPEN');
    }
  },

  showGameScreen() {
    document.getElementById('join-screen').style.display = 'none';
    document.getElementById('game-screen').classList.add('active');
    if (typeof this._hudBandSync === 'function') this._hudBandSync();
    document.getElementById('reconnecting-overlay').classList.remove('active');
    this.bindChatForm();
    this.bindLeaderboardToggle();
    Recount.mountPill();
  },

  setupPlayerLayoutSplitter() {
    const splitter = document.getElementById('player-layout-splitter');
    const layout = document.getElementById('player-battle-layout');
    const comms = document.getElementById('battle-comms-lobby');
    if (!splitter || !layout || !comms) return;

    if (splitter.dataset.bound === 'true') {
      requestAnimationFrame(() => this._restorePlayerLayoutRatio?.());
      return;
    }

    // NOTE: this mobile boundary is hand-synced with the desktop-only
    // `@media (min-width: 901px)` HUD rail block in join.html (near the
    // `.board-hud-rail` rules). CSS media queries cannot share a variable,
    // so if this boundary ever changes, that join.html block needs the
    // same edit.
    const MOBILE_QUERY = '(max-width: 900px)';
    const MIN_CHAT_PX = 260;
    const MIN_BOARD_PX = 520;
    const MIN_RATIO = 0.18;
    const MAX_RATIO = 0.50;

    const storageKey = () => {
      const identity = String(
        this.playerId ||
        sessionStorage.getItem('asoc_player_id') ||
        this.playerName ||
        sessionStorage.getItem('asoc_player_name') ||
        'little-hero'
      ).trim().toLowerCase();
      return 'asoc_player_comms_ratio_v1:' + encodeURIComponent(identity || 'little-hero');
    };

    const metrics = () => {
      const layoutWidth = Math.max(layout.getBoundingClientRect().width || window.innerWidth || 1, 1);
      const splitterWidth = Math.max(splitter.getBoundingClientRect().width || 14, 1);
      const available = Math.max(layoutWidth - splitterWidth, 1);
      const min = Math.min(MAX_RATIO, Math.max(MIN_RATIO, MIN_CHAT_PX / available));
      const boardLimitedMax = (available - MIN_BOARD_PX) / available;
      const max = Math.max(min, Math.min(MAX_RATIO, Number.isFinite(boardLimitedMax) ? boardLimitedMax : MAX_RATIO));
      return { available, min, max };
    };

    const clampRatio = (ratio) => {
      const { min, max } = metrics();
      return Math.max(min, Math.min(max, ratio));
    };

    const updateAria = (ratio) => {
      const { min, max } = metrics();
      const pct = Math.round(ratio * 100);
      splitter.setAttribute('aria-valuemin', String(Math.round(min * 100)));
      splitter.setAttribute('aria-valuemax', String(Math.round(max * 100)));
      splitter.setAttribute('aria-valuenow', String(pct));
      splitter.setAttribute('aria-valuetext', `Battle Comms ${pct}% // board ${100 - pct}%`);
      const grip = splitter.querySelector('.player-layout-splitter-grip');
      if (grip) grip.dataset.resizeReadout = `CHAT ${pct}%`;
    };

    const refitBoard = () => {
      window.dispatchEvent(new Event('resize'));
    };

    let dragging = false;
    let currentRatio = null;

    const applyRatio = (ratio, persist = false) => {
      if (!Number.isFinite(ratio) || window.matchMedia(MOBILE_QUERY).matches) return;
      const { available } = metrics();
      currentRatio = clampRatio(ratio);
      const widthPx = Math.max(1, Math.round(available * currentRatio));
      layout.style.setProperty('--player-comms-width', widthPx + 'px');
      updateAria(currentRatio);
      if (persist) {
        try { localStorage.setItem(storageKey(), String(currentRatio)); } catch (_) {}
      }
      refitBoard();
    };

    const computedRatio = () => {
      const { available } = metrics();
      return clampRatio((comms.getBoundingClientRect().width || MIN_CHAT_PX) / available);
    };

    const resetRatio = () => {
      currentRatio = null;
      layout.style.removeProperty('--player-comms-width');
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      requestAnimationFrame(() => {
        if (!window.matchMedia(MOBILE_QUERY).matches) updateAria(computedRatio());
        refitBoard();
      });
    };

    const restoreSaved = () => {
      if (window.matchMedia(MOBILE_QUERY).matches) return;
      try {
        const saved = Number.parseFloat(localStorage.getItem(storageKey()));
        if (Number.isFinite(saved)) applyRatio(saved, false);
        else updateAria(computedRatio());
      } catch (_) {
        updateAria(computedRatio());
      }
    };

    this._restorePlayerLayoutRatio = restoreSaved;

    splitter.dataset.bound = 'true';

    requestAnimationFrame(restoreSaved);

    splitter.addEventListener('pointerdown', (event) => {
      if (window.matchMedia(MOBILE_QUERY).matches) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true;
      document.body.classList.add('player-layout-resizing');
      splitter.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    splitter.addEventListener('pointermove', (event) => {
      if (!dragging || window.matchMedia(MOBILE_QUERY).matches) return;
      const rect = layout.getBoundingClientRect();
      const splitterWidth = splitter.getBoundingClientRect().width || 14;
      const available = Math.max(rect.width - splitterWidth, 1);
      const chatWidth = Math.max(0, rect.right - event.clientX - splitterWidth / 2);
      applyRatio(chatWidth / available, false);
    });

    const finishDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('player-layout-resizing');
      try { splitter.releasePointerCapture?.(event.pointerId); } catch (_) {}
      if (currentRatio !== null) {
        try { localStorage.setItem(storageKey(), String(currentRatio)); } catch (_) {}
      }
    };

    splitter.addEventListener('pointerup', finishDrag);
    splitter.addEventListener('pointercancel', finishDrag);

    splitter.addEventListener('dblclick', (event) => {
      event.preventDefault();
      resetRatio();
    });

    splitter.addEventListener('keydown', (event) => {
      if (window.matchMedia(MOBILE_QUERY).matches) return;
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

    window.addEventListener('resize', () => {
      if (window.matchMedia(MOBILE_QUERY).matches) {
        document.body.classList.remove('player-layout-resizing');
        return;
      }

      if (currentRatio !== null) {
        const { available } = metrics();
        currentRatio = clampRatio(currentRatio);
        layout.style.setProperty('--player-comms-width', Math.max(1, Math.round(available * currentRatio)) + 'px');
        updateAria(currentRatio);
      } else {
        updateAria(computedRatio());
      }
    });
  },

  // Completed state = body.game-won (CSS), driven only by server state.
  applyVictoryState(won, matchResult = null) {
    const live = this._victoryBaselined && !this.gameWon && won;
    this._victoryBaselined = true;
    this.gameWon = won;
    document.body.classList.toggle('game-won', won);
    if (live) Skeleton.playGameWon(matchResult || {}, { live: true, isHost: false, afterMatch: false });
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
    if (!lost) {
      document.querySelector('.defeat-overlay')?.remove();
    } else if (live) {
      Skeleton.playGameLost(matchResult, { live: true, isHost: false, afterMatch: false });
    } else if (changed && !document.querySelector('.defeat-overlay')) {
      Skeleton.playGameLost(matchResult, { live: false });
    }
  },

  // HUD-TO-BOARD WIDTH SYNC -- measures the combined height of the
  // TIMER + WOMF rail and publishes it to CSS as --hud-band so the
  // rail's width formula in join.html can deduct exactly that band from
  // #board-layer's container height. The actual strip heights are
  // content-driven and change with the viewport, so they are measured,
  // never hardcoded. Writes are threshold-guarded to avoid any
  // measure->resize loop.
  setupHudBoardWidthSync() {
    const rail = document.getElementById('board-hud-rail');
    const layer = document.getElementById('board-layer');
    if (!rail || !layer) return;

    const sync = () => {
      const band = rail.getBoundingClientRect().height;
      const current = parseFloat(layer.style.getPropertyValue('--hud-band')) || 0;
      if (Math.abs(band - current) > 0.2) {
        layer.style.setProperty('--hud-band', `${band}px`);
      }
    };

    // Exposed for an on-activation re-sync (showGameScreen): the rail is
    // unrendered (display:none) when init() runs, so the first measurement
    // can be 0. Re-syncing once the screen shows removes any dependence on
    // ResizeObserver timing for the first painted frame.
    this._hudBandSync = sync;

    sync();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(sync).observe(rail);
    } else {
      window.addEventListener('resize', sync);
    }
  },

  showJoinScreen() {
    this.gameWon = false;
    this._victoryBaselined = false;
    this._columnCascadeBaselined = false;
    this._columnCascadeStarts = {};
    this.gameLost = false;
    this._lossBaselined = false;
    this._lossResultKey = null;
    document.body.classList.remove('game-won');
    document.body.classList.remove('game-lost');
    Recount.apply(null);
    Skeleton.closeAftermath?.();
    document.querySelector('.defeat-overlay')?.remove();
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
    const link = document.getElementById('hero-hud-link');
    if (link) {
      link.className = 'hero-hud-link hero-stat hero-stat-link ' + (status === 'connected' ? 'stable' : status === 'disconnected' ? 'lost' : '');
      const value = link.querySelector('.hero-link-value');
      const label = status === 'connected' ? 'STABLE' : status === 'disconnected' ? 'LOST' : 'CONNECTING';
      if (value) value.textContent = label;
    }
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
    // One page gets one reconnect timer. Multiple close callbacks must not
    // queue competing sockets.
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      alert('Unable to reconnect. Please refresh the page.');
      this.showJoinScreen();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
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
    this.currentPlayers = players || [];
    const mentionPicker = document.getElementById('chat-mention-picker');
    if (mentionPicker && !mentionPicker.hidden) this.updateChatMentionPicker(document.getElementById('chat-input'), mentionPicker);
    const strip = document.getElementById('player-leaderboard-strip');
    const list = document.getElementById('player-leaderboard-list');
    const identity = document.getElementById('hero-hud-identity');
    if (!players || players.length === 0) {
      if (strip) strip.style.display = 'none';
      return;
    }
    const ranked = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
    if (strip && list) {
      strip.style.display = 'flex';
      list.innerHTML = ranked.map(p => {
        const presenceClass = p.connected === false ? 'is-offline' : 'is-online';
        return `
        <span class="pl-entry ${presenceClass} ${p.id === this.playerId ? 'pl-entry-me' : ''}" title="${this.escapeHtml(p.name)} // ${p.score || 0} points">${this.littleHeroAvatarHTML(p, true)}<span class="pl-entry-name">${this.escapeHtml(p.name)}</span><b>${p.score || 0}</b></span>
      `;
      }).join('');
    }
    const meIndex = ranked.findIndex(p => p.id === this.playerId);
    const me = meIndex >= 0 ? ranked[meIndex] : null;
    if (me) {
      if (identity) identity.innerHTML = `${this.littleHeroAvatarHTML(me, true)}<span>${this.escapeHtml(me.name)} // LITTLE HERO</span><button type="button" class="hero-designation-edit" data-action="rename-little-hero" title="Change in-game name" aria-label="Change Little Hero designation"><span>DESIGNATION</span></button>`;
      const score = document.getElementById('hero-hud-score');
      const rank = document.getElementById('hero-hud-rank');
      if (score) {
        if (score.textContent !== String(me.score || 0)) { score.classList.remove('hero-hud-score-bump'); void score.offsetWidth; score.classList.add('hero-hud-score-bump'); }
        score.textContent = me.score || 0;
      }
      if (rank) rank.textContent = '#' + (meIndex + 1);
    }
    if (this.chatMessages && this.chatMessages.length) this.renderChat();
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
        <span class="lb-name lb-little-hero">${this.littleHeroAvatarHTML(p, true)}<span>${this.escapeHtml(p.name)}</span></span>
        <span class="lb-score">${p.lifetimeScore}</span>
      </div>
    `).join('') || '<div class="leaderboard-empty">No recorded players yet</div>';
  },

  addBattleEvent(text) {
    const feed = document.getElementById('battle-event-feed');
    if (!feed || !text) return;
    const event = document.createElement('div');
    event.className = 'battle-event';
    event.textContent = '── ASOC // ' + text + ' ──';
    feed.appendChild(event);
    while (feed.children.length > 3) feed.firstElementChild.remove();
    setTimeout(() => event.remove(), 9000);
  },

  updateTerminalPhase(state) {
    const screen = document.getElementById('game-screen');
    if (!screen) return;
    const phase = state?.timer?.phase || '';
    screen.classList.toggle('phase-borrowed', phase === 'borrowed');
    if (phase === 'borrowed' && this._lastTerminalPhase !== 'borrowed') this.addBattleEvent('BORROWED TIME AUTHORIZED');
    this._lastTerminalPhase = phase;
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
    toast.className = 'score-toast score-toast-compact';
    const detail = award.awardType === 'final'
      ? `FINAL SOLVED AFTER ${award.columnsKnownAtSolve} COLUMN${award.columnsKnownAtSolve === 1 ? '' : 'S'}`
      : `COLUMN ${award.target}${award.afterFinal ? ' · 50% — FINAL ALREADY SOLVED' : ''}`;
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

  // Final resolution is a notification, not an answer dump. Keep it compact,
  // reveal ZERO game answers, and remove it automatically after ~5 seconds.
  showFinalReveal(outcome) {
    const layer = document.getElementById('score-announcement-layer');
    if (!layer) return;

    const isSuccess = outcome.outcome === 'success';
    this._activeFinalBanner?.remove();

    const banner = document.createElement('div');
    banner.className = `final-outcome-banner fo-notice ${isSuccess ? 'final-outcome-success' : 'final-outcome-failed'}`;
    banner.innerHTML = `
      <div class="fo-headline">${isSuccess ? 'SOLUTION CONFIRMED' : 'FINAL FAILED'}</div>
      <div class="fo-debrief-label">${isSuccess ? 'FINAL LOCK ACCEPTED' : 'FINAL LOCK REJECTED'}</div>
      <div class="fo-results" style="display:none;"></div>
    `;

    layer.appendChild(banner);
    this._activeFinalBanner = banner;
    this.scheduleFinalBannerDismiss(banner);
  },

  // SHOW RESULTS may arrive before or after the five-second notice expires.
  // Preserve the score information, but never reintroduce any clue/solution text.
  revealFinalResults(results) {
    let banner = this._activeFinalBanner;
    if (!banner || !banner.isConnected) {
      this.showFinalReveal(results);
      banner = this._activeFinalBanner;
    }
    if (!banner) return;

    const isSuccess = results.outcome === 'success';
    const resultsEl = banner.querySelector('.fo-results');
    if (!resultsEl) return;

    resultsEl.innerHTML = isSuccess
      ? `<div class="fo-columns-known">FINAL SOLVED AFTER ${results.columnsKnownAtSolve} COLUMN${results.columnsKnownAtSolve === 1 ? '' : 'S'}</div>
         <div class="fo-points fo-points-positive">+${results.points} — ${this.escapeHtml(results.playerName)}</div>`
      : `<div class="fo-points fo-points-negative">-${results.penalty} PER PLAYER</div>`;
    resultsEl.style.display = 'block';

    this.scheduleFinalBannerDismiss(banner);
  },

  scheduleFinalBannerDismiss(banner, visibleMs = 5000) {
    clearTimeout(this._finalBannerFadeTimer);
    clearTimeout(this._finalBannerRemoveTimer);

    const fadeAt = Math.max(0, visibleMs - 500);
    this._finalBannerFadeTimer = setTimeout(() => {
      if (banner?.isConnected) banner.classList.add('final-outcome-out');
    }, fadeAt);

    this._finalBannerRemoveTimer = setTimeout(() => {
      banner?.remove();
      if (this._activeFinalBanner === banner) this._activeFinalBanner = null;
      this._finalBannerFadeTimer = null;
      this._finalBannerRemoveTimer = null;
    }, visibleMs);
  },

  emojiFavoritesStorageKey() {
    const stableIdentity = String(
      this.playerId ||
      sessionStorage.getItem('asoc_player_id') ||
      this.playerName ||
      sessionStorage.getItem('asoc_player_name') ||
      'little-hero'
    ).trim().toLowerCase();
    return 'asoc_chat_emoji_top5_v1:' + encodeURIComponent(stableIdentity || 'little-hero');
  },

  loadChatEmojiFavorites() {
    const fallback = [...this.emojiFavoriteDefaults];
    try {
      const raw = localStorage.getItem(this.emojiFavoritesStorageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      if (
        Array.isArray(parsed) &&
        parsed.length === 5 &&
        new Set(parsed).size === 5 &&
        parsed.every(emoji => this.chatReactionEmojis.includes(emoji))
      ) {
        this.emojiFavorites = [...parsed];
        return this.emojiFavorites;
      }
    } catch (e) {
      // A blocked/corrupt localStorage preference should never break chat.
    }
    this.emojiFavorites = fallback;
    return this.emojiFavorites;
  },

  saveChatEmojiFavorites(favorites) {
    const clean = Array.isArray(favorites)
      ? favorites.filter((emoji, index, list) => this.chatReactionEmojis.includes(emoji) && list.indexOf(emoji) === index).slice(0, 5)
      : [];
    if (clean.length !== 5) return false;
    this.emojiFavorites = clean;
    try {
      localStorage.setItem(this.emojiFavoritesStorageKey(), JSON.stringify(clean));
    } catch (e) {
      // Keep the in-memory choice even if storage is unavailable.
    }
    return true;
  },

  replaceChatEmojiFavorite(slot, emoji) {
    const index = Math.max(0, Math.min(4, Number(slot) || 0));
    if (!this.chatReactionEmojis.includes(emoji)) return;
    const favorites = [...this.loadChatEmojiFavorites()];
    const existing = favorites.indexOf(emoji);
    if (existing >= 0 && existing !== index) {
      const displaced = favorites[index];
      favorites[index] = emoji;
      favorites[existing] = displaced;
    } else {
      favorites[index] = emoji;
    }
    this.saveChatEmojiFavorites(favorites);
  },

  renderChatEmojiPickers(emojiPicker = document.getElementById('chat-emoji-picker'), reactionPicker = document.getElementById('chat-reaction-picker')) {
    const favorites = this.loadChatEmojiFavorites();
    const editing = this._emojiFavoritesEditing === true;
    const favoriteButtons = favorites
      .map((emoji, index) => `<button type="button" class="chat-emoji-option chat-emoji-favorite${editing ? ' editing' : ''}${editing && index === this._emojiFavoriteSlot ? ' active-slot' : ''}" data-emoji="${emoji}" data-favorite-slot="${index}" title="${editing ? 'Shortcut slot ' + (index + 1) : 'Favorite shortcut'}">${emoji}</button>`)
      .join('');
    const bodyEmojis = editing
      ? this.chatReactionEmojis
      : this.chatReactionEmojis.filter(emoji => !favorites.includes(emoji));
    const bodyButtons = bodyEmojis
      .map(emoji => `<button type="button" class="chat-emoji-option chat-emoji-library${editing && favorites.includes(emoji) ? ' is-favorite' : ''}" data-emoji="${emoji}">${emoji}</button>`)
      .join('');
    const divider = '<div class="chat-emoji-divider" aria-hidden="true"></div>';

    if (emojiPicker) {
      emojiPicker.innerHTML = `
        <div class="chat-emoji-picker-head">
          <span>TOP 5 EMOJIS</span>
          <span class="chat-emoji-edit-status">${editing ? 'SLOT ' + (this._emojiFavoriteSlot + 1) : '5 SAVED'}</span>
          <button type="button" class="chat-emoji-edit-toggle">${editing ? 'DONE' : 'EDIT'}</button>
        </div>
        ${favoriteButtons}
        ${divider}
        <div class="chat-emoji-section-label">EMOJI PACK</div>
        ${bodyButtons}
      `;
    }

    if (reactionPicker) {
      const reactionBodyEmojis = editing
        ? this.chatReactionEmojis
        : this.chatReactionEmojis.filter(emoji => !favorites.includes(emoji));
      const reactionBody = reactionBodyEmojis
        .map(emoji => `<button type="button" class="chat-emoji-option chat-emoji-library${editing && favorites.includes(emoji) ? ' is-favorite' : ''}" data-emoji="${emoji}">${emoji}</button>`)
        .join('');
      reactionPicker.innerHTML = `
        <div class="chat-emoji-picker-head">
          <span>TOP 5 EMOJIS</span>
          <span class="chat-emoji-edit-status">${editing ? 'SLOT ' + (this._emojiFavoriteSlot + 1) : '5 SAVED'}</span>
          <button type="button" class="chat-emoji-edit-toggle">${editing ? 'DONE' : 'EDIT'}</button>
        </div>
        ${favoriteButtons}
        ${divider}
        <div class="chat-emoji-section-label">EMOJI PACK</div>
        ${reactionBody}
      `;
    }
  },


  ensureChatMentionPicker(form) {
    if (!form) return null;
    let picker = form.querySelector('#chat-mention-picker');
    if (picker) return picker;
    picker = document.createElement('div');
    picker.id = 'chat-mention-picker';
    picker.className = 'chat-mention-picker';
    picker.hidden = true;
    picker.setAttribute('role', 'listbox');
    picker.setAttribute('aria-label', 'Tag a player');
    form.appendChild(picker);
    return picker;
  },

  getChatMentionContext(input) {
    if (!input) return null;
    const caret = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const before = input.value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && /[\\p{L}\\p{N}_]/u.test(before.charAt(at - 1))) return null;
    const query = before.slice(at + 1);
    if (query.length > 40 || /[\r\n:]/.test(query)) return null;
    return { start: at, end: caret, query };
  },

  getChatMentionCandidates(query = '') {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return (this.currentPlayers || [])
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
      })
      .slice(0, 8);
  },

  refreshChatMentionRoster() {
    if (!this.roomCode || this.ws?.readyState !== 1) return;
    const now = Date.now();
    if (now - Number(this._chatMentionRosterRequestedAt || 0) < 900) return;
    this._chatMentionRosterRequestedAt = now;
    this.send({ type: 'players:list' });
  },

  renderChatMentionPicker(picker) {
    if (!picker || picker.hidden) return;
    const candidates = this._chatMentionCandidates || [];
    picker.innerHTML = candidates.map((player, index) => `
      <button type="button" class="chat-mention-option${index === this._chatMentionIndex ? ' active' : ''}" data-mention-index="${index}" role="option" aria-selected="${index === this._chatMentionIndex ? 'true' : 'false'}">
        ${this.littleHeroAvatarHTML(player, true)}
        <span>${this.escapeHtml(player.name)}</span>
        <small>${player.connected === false ? 'OFFLINE' : 'TAG'}</small>
      </button>
    `).join('');
  },

  updateChatMentionPicker(input = document.getElementById('chat-input'), picker = document.getElementById('chat-mention-picker')) {
    if (!input || !picker) return;
    const context = this.getChatMentionContext(input);
    if (!context) {
      this.closeChatMentionPicker(picker);
      return;
    }

    // @ always resolves against the authoritative MASTER session roster.
    // Ask the server for a fresh snapshot while mention mode is active so
    // reconnects, renames and restored session participants are targetable.
    this.refreshChatMentionRoster();

    const candidates = this.getChatMentionCandidates(context.query);
    if (!candidates.length) {
      this._chatMentionContext = context;
      this._chatMentionCandidates = [];
      this._chatMentionIndex = 0;
      picker.hidden = false;
      picker.innerHTML = '<div class="chat-mention-empty">NO MATCHING SESSION PLAYER</div>';
      return;
    }
    this._chatMentionContext = context;
    this._chatMentionCandidates = candidates;
    this._chatMentionIndex = Math.max(0, Math.min(this._chatMentionIndex || 0, candidates.length - 1));
    picker.hidden = false;
    this.renderChatMentionPicker(picker);
    const emojiPicker = document.getElementById('chat-emoji-picker');
    if (emojiPicker) emojiPicker.hidden = true;
    document.getElementById('chat-emoji-toggle')?.setAttribute('aria-expanded', 'false');
    const attachmentMenu = document.getElementById('chat-attachment-menu');
    if (attachmentMenu) attachmentMenu.hidden = true;
    document.getElementById('chat-image-upload-btn')?.setAttribute('aria-expanded', 'false');
  },

  closeChatMentionPicker(picker = document.getElementById('chat-mention-picker')) {
    if (picker) {
      picker.hidden = true;
      picker.innerHTML = '';
    }
    this._chatMentionContext = null;
    this._chatMentionCandidates = [];
    this._chatMentionIndex = 0;
  },

  selectChatMention(index, input = document.getElementById('chat-input'), picker = document.getElementById('chat-mention-picker')) {
    const candidate = (this._chatMentionCandidates || [])[Number(index)];
    const context = this._chatMentionContext;
    if (!candidate || !context || !input) return false;
    const replacement = '@' + String(candidate.name) + ' ';
    const next = input.value.slice(0, context.start) + replacement + input.value.slice(context.end);
    const maxLength = Number(input.maxLength) > 0 ? Number(input.maxLength) : 100;
    if (next.length > maxLength) return false;
    input.value = next;
    const caret = context.start + replacement.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    this.closeChatMentionPicker(picker);
    return true;
  },

  handleChatMentionKeydown(event, input, picker) {
    if (!picker || picker.hidden) return false;
    const candidates = this._chatMentionCandidates || [];
    if (!candidates.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this._chatMentionIndex = (this._chatMentionIndex + delta + candidates.length) % candidates.length;
      this.renderChatMentionPicker(picker);
      picker.querySelector('.chat-mention-option.active')?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.selectChatMention(this._chatMentionIndex || 0, input, picker);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeChatMentionPicker(picker);
      return true;
    }
    return false;
  },

  decorateChatMentions(container) {
    if (!container) return;
    const names = [...new Set((this.currentPlayers || [])
      .map(player => String(player?.name || '').trim())
      .filter(Boolean))]
      .sort((a, b) => b.length - a.length);

    const regexSpecials = '^$.*+?()[]{}|' + String.fromCharCode(92);
    const escaped = ['all', ...names].map(name => [...name].map(char => regexSpecials.includes(char) ? String.fromCharCode(92) + char : char).join(''));
    const pattern = new RegExp('@(' + escaped.join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');
    const me = String(this.playerName || '').trim().toLocaleLowerCase();
    const targets = container.querySelectorAll('.chat-message-text, .shadow-broker-text');

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
          const mentionName = String(match[1] || '').toLocaleLowerCase();
          const isAll = mentionName === 'all';
          const isMe = isAll || mentionName === me;
          span.className = 'chat-mention' + (isAll ? ' mention-all' : '') + (isMe ? ' mention-me' : '');
          span.textContent = match[0];
          fragment.appendChild(span);
          if (isMe) target.closest('.chat-message, .chat-broker-entry')?.classList.add('chat-mentions-me');
          last = match.index + match[0].length;
        }
        if (!changed) return;
        if (last < value.length) fragment.appendChild(document.createTextNode(value.slice(last)));
        node.replaceWith(fragment);
      });
    });
  },

  bindChatForm() {
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');

    if (!form) return;
    if (form.dataset.chatBound === '1') return;
    form.dataset.chatBound = '1';

    const emojiToggle = document.getElementById('chat-emoji-toggle');
    const emojiPicker = document.getElementById('chat-emoji-picker');
    const reactionPicker = document.getElementById('chat-reaction-picker');
    const contextMenu = document.getElementById('chat-message-context-menu');
    const mentionPicker = this.ensureChatMentionPicker(form);
    if (reactionPicker && reactionPicker.parentElement !== document.body) document.body.appendChild(reactionPicker);
    if (contextMenu && contextMenu.parentElement !== document.body) document.body.appendChild(contextMenu);
    let contextMessageEl = null;
    const closeContextMenu = () => {
      if (!contextMenu) return;
      contextMenu.hidden = true;
      contextMenu.removeAttribute('data-message-id');
      contextMenu._messageEl = null;
      contextMessageEl = null;
    };
    const openContextMenu = (messageEl, clientX, clientY) => {
      if (!contextMenu || !messageEl) return;
      const messageId = messageEl.dataset.messageId || '';
      if (!messageId) return;
      contextMessageEl = messageEl;
      contextMenu._messageEl = messageEl;
      contextMenu.dataset.messageId = messageId;
      const editButton = contextMenu.querySelector('[data-chat-action="edit"]');
      if (editButton) editButton.hidden = messageEl.dataset.editable !== 'true';
      contextMenu.hidden = false;
      if (reactionPicker) reactionPicker.hidden = true;
      if (emojiPicker) emojiPicker.hidden = true;
      emojiToggle?.setAttribute('aria-expanded', 'false');
      const attachmentMenu = document.getElementById('chat-attachment-menu');
      const attachmentToggle = document.getElementById('chat-image-upload-btn');
      if (attachmentMenu) attachmentMenu.hidden = true;
      attachmentToggle?.setAttribute('aria-expanded', 'false');
      requestAnimationFrame(() => {
        const rect = contextMenu.getBoundingClientRect();
        const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
        const top = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
        contextMenu.style.left = left + 'px';
        contextMenu.style.top = top + 'px';
        contextMenu.querySelector('button')?.focus({ preventScroll:true });
      });
    };

    this.renderChatEmojiPickers(emojiPicker, reactionPicker);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitGuess();
    });

    input.addEventListener('keydown', (e) => {
      if (this.handleChatMentionKeydown(e, input, mentionPicker)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitGuess();
      }
    });
    input.addEventListener('input', () => this.updateChatMentionPicker(input, mentionPicker));
    input.addEventListener('click', () => this.updateChatMentionPicker(input, mentionPicker));
    input.addEventListener('paste', (event) => {
      if (this._chatMediaComposer?.handlePaste?.(event)) {
        this.closeChatMentionPicker(mentionPicker);
      }
    });
    mentionPicker?.addEventListener('mousedown', (e) => e.preventDefault());
    mentionPicker?.addEventListener('click', (e) => {
      const option = e.target.closest('.chat-mention-option');
      if (!option) return;
      this.selectChatMention(option.dataset.mentionIndex || 0, input, mentionPicker);
    });

    emojiToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!emojiPicker) return;
      const opening = emojiPicker.hidden;
      emojiPicker.hidden = !opening;
      emojiToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) {
        this.renderChatEmojiPickers(emojiPicker, reactionPicker);
        this.closeChatMentionPicker(mentionPicker);
        const attachmentMenu = document.getElementById('chat-attachment-menu');
        const attachmentToggle = document.getElementById('chat-image-upload-btn');
        if (attachmentMenu) attachmentMenu.hidden = true;
        attachmentToggle?.setAttribute('aria-expanded', 'false');
        const gifPicker = document.getElementById('chat-gif-picker');
        if (gifPicker) gifPicker.hidden = true;
      }
      if (reactionPicker) reactionPicker.hidden = true;
    });

    emojiPicker?.addEventListener('click', (e) => {
      e.stopPropagation();
      const editToggle = e.target.closest('.chat-emoji-edit-toggle');
      if (editToggle) {
        this._emojiFavoritesEditing = !this._emojiFavoritesEditing;
        this._emojiFavoriteSlot = Math.max(0, Math.min(4, this._emojiFavoriteSlot || 0));
        this.renderChatEmojiPickers(emojiPicker, reactionPicker);
        return;
      }

      const option = e.target.closest('.chat-emoji-option');
      if (!option) return;

      if (this._emojiFavoritesEditing) {
        const favoriteSlot = option.dataset.favoriteSlot;
        if (favoriteSlot !== undefined) {
          this._emojiFavoriteSlot = Math.max(0, Math.min(4, Number(favoriteSlot) || 0));
          this.renderChatEmojiPickers(emojiPicker, reactionPicker);
          return;
        }

        const emoji = option.dataset.emoji || '';
        this.replaceChatEmojiFavorite(this._emojiFavoriteSlot, emoji);
        this._emojiFavoriteSlot = (this._emojiFavoriteSlot + 1) % 5;
        this.renderChatEmojiPickers(emojiPicker, reactionPicker);
        return;
      }

      this.insertChatEmoji(option.dataset.emoji || '');
      emojiPicker.hidden = true;
      emojiToggle?.setAttribute('aria-expanded', 'false');
    });

    reactionPicker?.addEventListener('click', (e) => {
      e.stopPropagation();
      const editToggle = e.target.closest('.chat-emoji-edit-toggle');
      if (editToggle) {
        this._emojiFavoritesEditing = !this._emojiFavoritesEditing;
        this._emojiFavoriteSlot = Math.max(0, Math.min(4, this._emojiFavoriteSlot || 0));
        this.renderChatEmojiPickers(emojiPicker, reactionPicker);
        return;
      }

      const option = e.target.closest('.chat-emoji-option');
      if (!option) return;

      if (this._emojiFavoritesEditing) {
        const favoriteSlot = option.dataset.favoriteSlot;
        if (favoriteSlot !== undefined) {
          this._emojiFavoriteSlot = Math.max(0, Math.min(4, Number(favoriteSlot) || 0));
          this.renderChatEmojiPickers(emojiPicker, reactionPicker);
          return;
        }

        const emoji = option.dataset.emoji || '';
        this.replaceChatEmojiFavorite(this._emojiFavoriteSlot, emoji);
        this._emojiFavoriteSlot = (this._emojiFavoriteSlot + 1) % 5;
        this.renderChatEmojiPickers(emojiPicker, reactionPicker);
        return;
      }

      const messageId = reactionPicker.dataset.messageId || '';
      if (messageId) this.sendChatReaction(messageId, option.dataset.emoji || '');
      reactionPicker.hidden = true;
    });

    document.addEventListener('click', (e) => {
      if (emojiPicker && !emojiPicker.hidden && !emojiPicker.contains(e.target) && e.target !== emojiToggle) {
        emojiPicker.hidden = true;
        emojiToggle?.setAttribute('aria-expanded', 'false');
        this._emojiFavoritesEditing = false;
        this._emojiFavoriteSlot = 0;
      }
      if (
        reactionPicker &&
        !reactionPicker.hidden &&
        !reactionPicker.contains(e.target) &&
        !e.target.closest('.chat-reaction-add')
      ) {
        reactionPicker.hidden = true;
        this._emojiFavoritesEditing = false;
        this._emojiFavoriteSlot = 0;
      }
      if (contextMenu && !contextMenu.hidden && !contextMenu.contains(e.target)) closeContextMenu();
      if (mentionPicker && !mentionPicker.hidden && !form.contains(e.target)) this.closeChatMentionPicker(mentionPicker);
    });

    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
      chatContainer.addEventListener('scroll', () => {
        // renderChat() replaces the transcript DOM and performs its own scroll
        // restoration. Browsers can emit scroll events during that operation;
        // those are not user intent and must never flip us into history mode.
        if (this._chatProgrammaticScroll) {
          closeContextMenu();
          return;
        }

        const { scrollTop, scrollHeight, clientHeight } = chatContainer;
        this.userScrolledUp = (scrollTop + clientHeight) < (scrollHeight - 80);
        if (!this.userScrolledUp && this._newMessageCount) {
          this._newMessageCount = 0;
          this.updateNewMessageChip();
        }
        closeContextMenu();
      }, { passive:true });
      chatContainer.addEventListener('click', (e) => {
        const pollVote = e.target.closest('[data-poll-vote]');
        if (pollVote) {
          this.send({
            type: 'chat:poll:vote',
            messageId: pollVote.dataset.messageId || '',
            optionIndex: Number(pollVote.dataset.pollVote)
          });
          return;
        }

        const pollClose = e.target.closest('[data-poll-close]');
        if (pollClose) {
          this.send({ type: 'chat:poll:close', messageId: pollClose.dataset.pollClose || '' });
          return;
        }

        const reactionChip = e.target.closest('.chat-reaction-chip');
        if (reactionChip) {
          this.sendChatReaction(reactionChip.dataset.messageId || '', reactionChip.dataset.emoji || '');
          return;
        }

        const reactionAdd = e.target.closest('.chat-reaction-add');
        if (reactionAdd) {
          this.openChatReactionPicker(reactionAdd.dataset.messageId || '', { x: e.clientX, y: e.clientY });
          return;
        }

        const replyButton = e.target.closest('.chat-reply-btn');
        if (replyButton) {
          const messageEl = replyButton.closest('.chat-message, .chat-broker-entry');
          this.startChatReply(messageEl, replyButton.dataset.replyId || messageEl?.dataset.messageId || '');
          return;
        }
      });
    }

    document.addEventListener('contextmenu', (e) => {
      const messageEl = e.target.closest('#chat-messages .chat-message, #chat-messages .chat-broker-entry');
      if (!messageEl) return;
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(messageEl, e.clientX, e.clientY);
    }, true);

    // Phones have no right-click. A deliberate long-press opens the same
    // Reply / React action menu without hijacking normal chat scrolling.
    let chatHoldTimer = null;
    let chatHoldStart = null;
    const cancelChatHold = () => {
      if (chatHoldTimer) clearTimeout(chatHoldTimer);
      chatHoldTimer = null;
      chatHoldStart = null;
    };
    chatContainer?.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.button !== 0) return;
      const messageEl = e.target.closest('.chat-message, .chat-broker-entry');
      if (!messageEl || e.target.closest('button, a, input, textarea')) return;
      cancelChatHold();
      chatHoldStart = { x:e.clientX, y:e.clientY, messageEl };
      chatHoldTimer = setTimeout(() => {
        if (!chatHoldStart) return;
        navigator.vibrate?.(18);
        openContextMenu(chatHoldStart.messageEl, chatHoldStart.x, chatHoldStart.y);
        cancelChatHold();
      }, 520);
    }, { passive:true });
    chatContainer?.addEventListener('pointermove', (e) => {
      if (!chatHoldStart) return;
      if (Math.hypot(e.clientX - chatHoldStart.x, e.clientY - chatHoldStart.y) > 12) cancelChatHold();
    }, { passive:true });
    chatContainer?.addEventListener('pointerup', cancelChatHold, { passive:true });
    chatContainer?.addEventListener('pointercancel', cancelChatHold, { passive:true });

    contextMenu?.addEventListener('click', (e) => {
      const action = e.target.closest('[data-chat-action]')?.dataset.chatAction;
      if (!action) return;
      // Keep this click away from the page-level outside-click handler: it
      // would read a REACT click as "outside the picker" and hide the picker
      // this very click just opened.
      e.stopPropagation();
      const messageId = contextMenu.dataset.messageId || '';
      // Chat re-renders replace message nodes wholesale, so the element cached
      // when the menu opened may be detached by now. Re-resolve it by id.
      const messageEl = (messageId && document.querySelector(`#chat-messages [data-message-id="${CSS.escape(messageId)}"]`))
        || contextMenu._messageEl || contextMessageEl;
      if (!messageEl || !messageId) return;
      closeContextMenu();
      if (action === 'reply') {
        this.startChatReply(messageEl, messageId);
      } else if (action === 'edit') {
        this.startChatEdit(messageEl, messageId);
      } else if (action === 'react') {
        // A detached anchor has a zero rect; the message is gone, nothing to react to.
        if (messageEl.isConnected) this.openChatReactionPicker(messageId, { x: e.clientX, y: e.clientY });
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        this.closeChatMentionPicker(mentionPicker);
        if (this._editingMessage) this.cancelChatReply();
      }
    });
    window.addEventListener('resize', closeContextMenu, { passive:true });

    document.getElementById('chat-new-messages')?.addEventListener('click', () => {
      this.jumpToLatestChat();
    });

    document.getElementById('chat-reply-cancel')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cancelChatReply();
    });
  },

  openMessageActionMenu(event, messageEl) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const menu = document.getElementById('chat-message-context-menu');
    const messageId = messageEl?.dataset?.messageId || '';
    if (!menu || !messageEl || !messageId) return false;

    menu._messageEl = messageEl;
    menu.dataset.messageId = messageId;
    const editButton = menu.querySelector('[data-chat-action="edit"]');
    if (editButton) editButton.hidden = messageEl.dataset.editable !== 'true';
    menu.hidden = false;
    const reactionPicker = document.getElementById('chat-reaction-picker');
    const emojiPicker = document.getElementById('chat-emoji-picker');
    if (reactionPicker) reactionPicker.hidden = true;
    if (emojiPicker) emojiPicker.hidden = true;
    document.getElementById('chat-emoji-toggle')?.setAttribute('aria-expanded', 'false');
    const attachmentMenu = document.getElementById('chat-attachment-menu');
    if (attachmentMenu) attachmentMenu.hidden = true;
    document.getElementById('chat-image-upload-btn')?.setAttribute('aria-expanded', 'false');

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

  startChatEdit(messageEl, messageId) {
    const input = document.getElementById('chat-input');
    if (!input || !messageEl || !messageId || messageEl.dataset.editable !== 'true') return;

    const msg = (this.chatMessages || []).find(entry => String(entry.id) === String(messageId));
    if (!msg || msg.source || String(msg.playerId || '') !== String(this.playerId || '') || msg.verdict != null) return;

    const raw = String(msg.text || '');
    const replyMatch = raw.match(/^((?:↳ @[^:]{1,40}?)(?: \/\/ [^:]{1,30})?:\s*)([\s\S]*)$/);
    const prefix = replyMatch ? replyMatch[1] : '';
    const body = replyMatch ? replyMatch[2] : raw;

    this._replyTo = null;
    this._editingMessage = { id: messageId, prefix };
    input.maxLength = Math.max(1, 100 - prefix.length);
    input.value = body.slice(0, input.maxLength);

    const preview = document.getElementById('chat-reply-preview');
    const previewText = document.getElementById('chat-reply-preview-text');
    if (previewText) previewText.textContent = 'EDITING YOUR MESSAGE // ENTER TO SAVE';
    if (preview) preview.style.display = 'flex';

    const reactionPicker = document.getElementById('chat-reaction-picker');
    const emojiPicker = document.getElementById('chat-emoji-picker');
    if (reactionPicker) reactionPicker.hidden = true;
    if (emojiPicker) emojiPicker.hidden = true;

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  },

  startChatReply(messageEl, replyId) {
    const input = document.getElementById('chat-input');
    if (!input || !messageEl || !replyId) return;

    const name = messageEl.dataset.playerName || (messageEl.classList.contains('chat-broker-entry') ? 'SHADOW BROKER' : 'LITTLE HERO');
    const excerpt = (messageEl.querySelector('.chat-message-text, .shadow-broker-text')?.textContent || '')
      .replace(/[:\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30);

    this._editingMessage = null;
    this._replyTo = { id: replyId, name, excerpt };

    const replyPrefix = `↳ @${name}${excerpt ? ` // ${excerpt}` : ''}: `;
    input.maxLength = Math.max(1, 100 - replyPrefix.length);
    if (input.value.length > input.maxLength) {
      input.value = input.value.slice(0, input.maxLength);
    }

    const preview = document.getElementById('chat-reply-preview');
    const previewText = document.getElementById('chat-reply-preview-text');
    if (previewText) {
      previewText.textContent = `REPLY TO ${name}${excerpt ? ` // ${excerpt}` : ''}`;
    }
    if (preview) preview.style.display = 'flex';

    const reactionPicker = document.getElementById('chat-reaction-picker');
    const emojiPicker = document.getElementById('chat-emoji-picker');
    if (reactionPicker) reactionPicker.hidden = true;
    if (emojiPicker) emojiPicker.hidden = true;

    input.focus();
  },

  cancelChatReply() {
    const wasEditing = !!this._editingMessage;
    this._replyTo = null;
    this._editingMessage = null;
    const input = document.getElementById('chat-input');
    if (input) {
      input.maxLength = 100;
      if (wasEditing) input.value = '';
    }
    const preview = document.getElementById('chat-reply-preview');
    if (preview) preview.style.display = 'none';
    const previewText = document.getElementById('chat-reply-preview-text');
    if (previewText) previewText.textContent = '';
    input?.focus();
  },

  insertChatEmoji(emoji) {
    if (!emoji) return;
    const input = document.getElementById('chat-input');
    if (!input) return;

    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    const next = input.value.slice(0, start) + emoji + input.value.slice(end);
    input.value = next.slice(0, input.maxLength || 100);
    const caret = Math.min(start + emoji.length, input.value.length);
    input.setSelectionRange(caret, caret);
    input.focus();
  },

  sendChatReaction(messageId, emoji) {
    if (!messageId || !this.chatReactionEmojis.includes(emoji)) return;
    this.send({ type: 'chat:react', messageId, emoji });
  },

  openChatReactionPicker(messageId, clickPoint = null) {
    const picker = document.getElementById('chat-reaction-picker');
    if (!picker || !messageId) return;

    this._emojiFavoritesEditing = false;
    this._emojiFavoriteSlot = 0;
    picker.dataset.messageId = messageId;
    this.renderChatEmojiPickers(document.getElementById('chat-emoji-picker'), picker);
    picker.hidden = false;

    const inputEmojiPicker = document.getElementById('chat-emoji-picker');
    if (inputEmojiPicker) inputEmojiPicker.hidden = true;
    document.getElementById('chat-emoji-toggle')?.setAttribute('aria-expanded', 'false');
    const attachmentMenu = document.getElementById('chat-attachment-menu');
    if (attachmentMenu) attachmentMenu.hidden = true;
    document.getElementById('chat-image-upload-btn')?.setAttribute('aria-expanded', 'false');

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

  isDisplayableReactionEmoji(emoji) {
    return this.chatReactionEmojis.includes(emoji) || window.CommanderEmojis?.has?.(emoji) === true;
  },

  renderReactionEmojiHTML(emoji, className = 'commander-reaction-emoji') {
    if (window.CommanderEmojis?.has?.(emoji)) {
      return window.CommanderEmojis.html(emoji, className);
    }
    return this.escapeHtml(emoji);
  },

  createReactionBarHTML(msg) {
    const reactions = msg?.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
    const chips = Object.entries(reactions)
      .filter(([emoji, playerIds]) => this.isDisplayableReactionEmoji(emoji) && Array.isArray(playerIds) && playerIds.length)
      .map(([emoji, playerIds]) => {
        const mine = playerIds.map(String).includes(String(this.playerId));
        const commanderOnly = window.CommanderEmojis?.has?.(emoji) === true;
        const emojiHtml = this.renderReactionEmojiHTML(emoji, 'commander-reaction-emoji');
        return `<button type="button" class="chat-reaction-chip${mine ? ' mine' : ''}${commanderOnly ? ' commander-reaction-chip' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-emoji="${this.escapeHtml(emoji)}" aria-pressed="${mine ? 'true' : 'false'}" title="${commanderOnly ? 'Commander reaction' : 'React'}"><span class="chat-reaction-emoji">${emojiHtml}</span><span class="chat-reaction-count">${playerIds.length}</span></button>`;
      })
      .join('');

    return `<div class="chat-reactions${chips ? ' has-reactions' : ''}">${chips}<button type="button" class="chat-reaction-add" data-message-id="${this.escapeHtml(msg.id)}" title="React" aria-label="React to message">＋</button></div>`;
  },

  updateNewMessageChip() {
    const chip = document.getElementById('chat-new-messages');
    if (!chip) return;
    chip.hidden = this._newMessageCount <= 0;
    if (!chip.hidden) {
      chip.textContent = `↓ ${this._newMessageCount} NEW TRANSMISSION${this._newMessageCount === 1 ? '' : 'S'}`;
    }
  },

  jumpToLatestChat() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    this.userScrolledUp = false;
    this._newMessageCount = 0;
    this.updateNewMessageChip();
  },

  submitGuess() {
    const input = document.getElementById('chat-input');
    if (!input) return;

    if (this._chatMediaComposer?.hasPending?.()) {
      this.closeChatMentionPicker();
      this._chatMediaComposer.submit();
      return;
    }

    const text = input.value.trim();
    if (!text) return;

    // Fallback parity with the Shadow Broker: if a direct image address made
    // it into the text box instead of being staged by the paste event, Enter
    // still treats the URL as media instead of broadcasting it as a guess.
    if (/^https?:\/\/\S+$/i.test(text) && this._chatMediaComposer?.stageUrl?.(text)) {
      input.value = '';
      this.closeChatMentionPicker();
      this._chatMediaComposer.submit();
      return;
    }

    const editing = this._editingMessage;
    this.closeChatMentionPicker();
    input.value = '';
    this._editingMessage = null;
    const reply = this._replyTo;
    this._replyTo = null;
    input.maxLength = 100;
    const preview = document.getElementById('chat-reply-preview');
    if (preview) preview.style.display = 'none';
    const previewText = document.getElementById('chat-reply-preview-text');
    if (previewText) previewText.textContent = '';

    if (editing) {
      this.send({ type: 'chat:edit', messageId: editing.id, text: (editing.prefix || '') + text });
      return;
    }

    const replyPrefix = reply
      ? `↳ @${reply.name}${reply.excerpt ? ` // ${reply.excerpt}` : ''}: `
      : '';
    this.send({ type: 'chat:guess', text: reply ? replyPrefix + text : text });
  },

  updateBloodTributeDemand(state) {
    this.bloodTribute = state || { status: 'idle' };
    const overlay = document.getElementById('blood-tribute-overlay');
    if (!overlay) return;
    const mine = this.bloodTribute.status === 'required' && this.bloodTribute.playerId === this.playerId;
    overlay.hidden = !mine;
    if (!mine) {
      this.tributeUploading = false;
      return;
    }
    const player = document.getElementById('blood-tribute-player');
    const status = document.getElementById('blood-tribute-status');
    if (player) player.textContent = `${this.bloodTribute.playerName || this.playerName || 'LITTLE HERO'} // YOUR DEBT IS DUE`;
    if (status && !this.tributeUploading) status.textContent = 'SELECT AN IMAGE TO PAY THE TRIBUTE';
  },

  submitBloodTribute() {
    if (this.tributeUploading) return;
    const demand = this.bloodTribute;
    if (!demand || demand.status !== 'required' || demand.playerId !== this.playerId) return;
    const input = document.getElementById('blood-tribute-file');
    const status = document.getElementById('blood-tribute-status');
    const file = input?.files?.[0];
    if (!file) {
      if (status) status.textContent = 'NO IMAGE SELECTED';
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      if (status) status.textContent = 'PNG, JPG OR WEBP ONLY';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      if (status) status.textContent = 'IMAGE TOO LARGE // 2 MB MAX';
      return;
    }

    this.tributeUploading = true;
    if (status) status.textContent = 'TRANSMITTING TRIBUTE...';
    const reader = new FileReader();
    reader.onload = () => {
      const imageData = String(reader.result || '');
      if (!imageData.startsWith('data:image/')) {
        this.tributeUploading = false;
        if (status) status.textContent = 'IMAGE COULD NOT BE READ';
        return;
      }
      this.send({ type: 'tribute:submit', imageData, retentionAcknowledged: true });
    };
    reader.onerror = () => {
      this.tributeUploading = false;
      if (status) status.textContent = 'IMAGE COULD NOT BE READ';
    };
    reader.readAsDataURL(file);
  },

  formatPollCountdown(expiresAt) {
    const remaining = Math.max(0, Number(expiresAt || 0) - Date.now());
    const totalSeconds = Math.max(0, Math.ceil(remaining / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  },

  armPollCountdowns(container = document.getElementById('chat-messages')) {
    clearInterval(this._pollCountdownInterval);
    this._pollCountdownInterval = null;
    if (!container) return;
    const update = () => {
      container.querySelectorAll('.chat-poll-countdown[data-expires-at]').forEach(node => {
        node.textContent = this.formatPollCountdown(node.dataset.expiresAt);
      });
    };
    update();
    if (container.querySelector('.chat-poll-countdown[data-expires-at]')) {
      this._pollCountdownInterval = setInterval(update, 250);
    }
  },

  createPollCardHTML(msg) {
    const poll = msg?.poll || {};
    const options = Array.isArray(poll.options) ? poll.options : [];
    const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
    const voters = poll.voters && typeof poll.voters === 'object' ? poll.voters : {};
    const voterIds = new Set();
    Object.values(votes).forEach(ids => {
      if (Array.isArray(ids)) ids.forEach(id => voterIds.add(String(id)));
    });
    const totalVoters = voterIds.size;
    const myId = String(this.playerId || '');
    const closed = Number(poll.closedAt) > 0;
    const expiresAt = Number(poll.expiresAt) || 0;
    const canClose = !closed && poll.createdByRole === 'player' && String(poll.createdById || '') === myId;
    const autoTagged = poll.createdByRole === 'gm';

    const optionHtml = options.map((option, index) => {
      const ids = Array.isArray(votes[String(index)]) ? votes[String(index)].map(String) : [];
      const selected = myId && ids.includes(myId);
      const percent = totalVoters ? Math.round((ids.length / totalVoters) * 100) : 0;
      const voterNames = ids.map(id => id === '__GM__' ? 'SHADOW BROKER' : String(voters[id]?.name || 'LITTLE HERO'));
      const voterTitle = voterNames.length ? 'VOTERS // ' + voterNames.join(', ') : 'NO VOTES';
      const voterChips = ids.map(id => {
        const voter = voters[id] || {};
        const name = id === '__GM__' ? 'SHADOW BROKER' : String(voter.name || 'LITTLE HERO');
        const frameColor = /^#[0-9A-Fa-f]{6}$/.test(voter.frameColor || '') ? voter.frameColor : '#9B5DE0';
        const avatar = id === '__GM__'
          ? '<img src="assets/ui/shadow-broker.png" alt="">'
          : (typeof voter.avatarData === 'string' && voter.avatarData.startsWith('data:image/')
              ? `<img src="${this.escapeHtml(voter.avatarData)}" alt="">`
              : `<i>${this.escapeHtml(name.slice(0, 1).toUpperCase())}</i>`);
        return `<span class="chat-poll-voter-chip" title="${this.escapeHtml(name)}" style="--poll-voter-color:${frameColor}">${avatar}<b>${this.escapeHtml(name)}</b></span>`;
      }).join('');

      return `
        <button type="button" class="chat-poll-choice${selected ? ' selected' : ''}" data-poll-vote="${index}" data-message-id="${this.escapeHtml(msg.id)}" ${closed ? 'disabled' : ''}>
          <span class="chat-poll-choice-fill" style="width:${percent}%"></span>
          <span class="chat-poll-choice-label">${this.escapeHtml(option)}</span>
          <span class="chat-poll-choice-result" title="${this.escapeHtml(voterTitle)}"><b>${percent}%</b><small>${ids.length}</small></span>
          <span class="chat-poll-voters"><span class="chat-poll-voters-label">VOTED</span>${voterChips || '<em>NONE</em>'}</span>
        </button>
      `;
    }).join('');

    const timerHtml = expiresAt
      ? (closed
          ? '<strong class="chat-poll-countdown is-ended">CLOSED</strong>'
          : `<strong class="chat-poll-countdown" data-expires-at="${expiresAt}">${this.formatPollCountdown(expiresAt)}</strong>`)
      : '<strong class="chat-poll-countdown no-limit">NO LIMIT</strong>';

    return `
      <div class="chat-poll-card${closed ? ' is-closed' : ''}">
        <div class="chat-poll-card-head">
          <span>ASOC CONSENSUS PROTOCOL${poll.allowMultiple ? ' // MULTI-SELECT' : ''}</span>
          <span class="chat-poll-state"><b>${closed ? 'ARCHIVED' : 'PUBLIC // LIVE'}</b>${autoTagged ? '<em>@ALL TAGGED</em>' : ''}${timerHtml}</span>
        </div>
        <div class="chat-poll-question">${this.escapeHtml(poll.question || msg.text || '')}</div>
        <div class="chat-poll-choice-list">${optionHtml}</div>
        <div class="chat-poll-card-foot">
          <span>ROOM RESPONSE // ${totalVoters} VOTER${totalVoters === 1 ? '' : 'S'}</span>
          ${canClose ? `<button type="button" class="chat-poll-close" data-poll-close="${this.escapeHtml(msg.id)}">CLOSE POLL</button>` : ''}
        </div>
      </div>
    `;
  },

  renderChat({ forceLatest = false } = {}) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    // Trust the actual viewport position first. A stale userScrolledUp flag can
    // be produced by DOM reflow/media loading; physical proximity to the bottom
    // is authoritative for whether live chat should follow new traffic.
    const previousScrollTop = container.scrollTop;
    const previousScrollHeight = container.scrollHeight;
    const previousClientHeight = container.clientHeight;
    const physicallyNearBottom =
      (previousScrollTop + previousClientHeight) >= (previousScrollHeight - 80);
    const followLatest = forceLatest || physicallyNearBottom || !this.userScrolledUp;

    // When the user is deliberately reading history, anchor the first visible
    // real message and its visual offset. Rebuilding the transcript can change
    // scrollHeight while images/GIFs are re-created, so scrollHeight deltas are
    // not a stable way to preserve position.
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

    let html = '';
    let nextWrongFadeMs = Infinity;
    let nextTributeTickMs = Infinity;
    const now = Date.now();
    const search = String(this._chatSearch || '').trim().toLocaleLowerCase();
    const visibleMessages = search
      ? this.chatMessages.filter(msg => [msg.text, msg.playerName, msg.verdict, msg.target]
          .some(value => String(value || '').toLocaleLowerCase().includes(search)))
      : this.chatMessages;
    visibleMessages.forEach((msg, index) => {
      const previous = index > 0 ? visibleMessages[index - 1] : null;
      if (previous && (Number(msg.timestamp) - Number(previous.timestamp)) > 300000) {
        html += this.createChatTimeSeparator(msg.timestamp);
      }
      if (msg.verdict === 'wrong') {
        const wrongSeenAt = this._wrongVerdictSeenAt.get(msg.id) ?? (now - 3000);
        const remaining = 3000 - (now - wrongSeenAt);
        if (remaining > 0) nextWrongFadeMs = Math.min(nextWrongFadeMs, remaining);
      }
      if (msg.source === 'bloodTribute' || msg.bloodTribute?.active) {
        const tributeRemaining = Number(msg.bloodTribute?.expiresAt || msg.publicUntil) - now;
        if (tributeRemaining > 0) nextTributeTickMs = Math.min(nextTributeTickMs, tributeRemaining, 1000);
      }
      html += this.createChatMessageHTML(msg, this.shouldGroupChatMessage(previous, msg), now);
    });

    this._chatProgrammaticScroll = true;
    container.innerHTML = html;

    this._chatArrivalIds?.forEach(id => {
      const el = container.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      el?.classList.add('chat-arrival');
    });
    this._chatVerdictTransitionIds?.forEach(id => {
      const el = container.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      el?.classList.add('chat-verdict-transition');
    });

    this.decorateChatMentions(container);
    this.armPollCountdowns(container);

    clearTimeout(this._wrongFadeTimer);
    if (Number.isFinite(nextWrongFadeMs)) {
      this._wrongFadeTimer = setTimeout(() => this.renderChat(), Math.max(30, nextWrongFadeMs + 30));
    }
    clearTimeout(this._tributeExpiryTimer);
    if (Number.isFinite(nextTributeTickMs)) {
      this._tributeExpiryTimer = setTimeout(() => this.renderChat(), Math.max(30, nextTributeTickMs + 30));
    }

    const pinLatest = () => {
      container.scrollTop = container.scrollHeight;
      this.userScrolledUp = false;
      this._newMessageCount = 0;
      this.updateNewMessageChip();
    };

    if (followLatest) {
      pinLatest();

      // Images/video can acquire their real dimensions after innerHTML lands.
      // While the user is following live chat, keep the newest message pinned
      // through those late media reflows instead of letting the viewport drift
      // several messages upward.
      container.querySelectorAll('img,video').forEach(media => {
        const repin = () => {
          if (!this.userScrolledUp) {
            this._chatProgrammaticScroll = true;
            pinLatest();
            requestAnimationFrame(() => { this._chatProgrammaticScroll = false; });
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
        requestAnimationFrame(() => { this._chatProgrammaticScroll = false; });
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
        // If the anchor disappeared because history was trimmed, retain the
        // literal viewport position. Never compensate using scrollHeight.
        container.scrollTop = Math.max(0, previousScrollTop);
      }

      requestAnimationFrame(() => { this._chatProgrammaticScroll = false; });
    }
  },

  createChatTimeSeparator(timestamp) {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="chat-time-separator"><span>${time}</span></div>`;
  },

  shouldGroupChatMessage(previous, current) {
    // Every Battle Comms entry is a standalone identity unit. In ASOC any
    // line can become an answer/verdict target, so speaker identity must
    // never depend on the message above it.
    return false;
  },

  createChatMessageHTML(msg, grouped = false, now = Date.now()) {
    if (msg.bloodTribute?.claimed) {
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `<div class="chat-message blood-tribute-tombstone" data-message-id="${this.escapeHtml(msg.id)}"><strong>☠ BLOOD TRIBUTE CLAIMED</strong><span>${this.escapeHtml(msg.playerName || 'LITTLE HERO')} // ${time}</span></div>`;
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
        <div class="chat-blood-tribute-entry" data-message-id="${this.escapeHtml(msg.id)}">
          <div class="blood-tribute-chat-head"><span>BLOOD TRIBUTE // ${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span><b>PUBLIC PURGE ${minutes}:${seconds}</b></div>
          <button type="button" class="chat-image-link blood-tribute-preview" aria-label="Expand blood tribute image"><img class="blood-tribute-public-image" src="${msg.imageData}" alt="Temporary tribute image"></button>
        </div>
      `;
    }

    if (msg.messageType === 'roll' && msg.roll) {
      const value = Math.max(1, Math.min(100, Number(msg.roll.value) || 1));
      const hue = Math.round(((value - 1) / 99) * 115);
      const rollColor = `hsl(${hue} 92% 48%)`;
      const min = Number(msg.roll.min) || 1;
      const max = Number(msg.roll.max) || 100;
      const extremeClass = value === 100 ? ' roll-max' : value === 1 ? ' roll-min' : '';
      return `
        <div class="asoc-roll-entry${extremeClass}" data-message-id="${this.escapeHtml(msg.id)}" style="--roll-color:${rollColor}">
          <span class="asoc-roll-die" aria-hidden="true">🎲</span>
          <span class="asoc-roll-name">${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span>
          <span class="asoc-roll-label">ROLLS</span>
          <strong class="asoc-roll-value">${this.escapeHtml(String(msg.roll.value))}</strong>
          <span class="asoc-roll-range">(${this.escapeHtml(String(min))}–${this.escapeHtml(String(max))})</span>
        </div>
      `;
    }

    if (msg.messageType === 'gifRemote' && msg.gif) {
      const isBrokerGif = msg.source === 'chatGifGm';
      const isOwn = !isBrokerGif && String(msg.playerId || '') === String(this.playerId || '');
      const identity = (this.currentPlayers || []).find(p =>
        String(p.id || '') === String(msg.playerId || '')
      ) || msg;
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const avatar = isBrokerGif
        ? '<img src="assets/ui/shadow-broker.png" class="shadow-broker-avatar" alt="Shadow Broker">'
        : this.littleHeroAvatarHTML(identity);
      const themeId = isBrokerGif ? 'gunmetal' : ASOCThemes.get(identity.themeId).id;
      const style = isBrokerGif
        ? '--little-hero-accent:#9B5DE0;'
        : ASOCThemes.messageStyle(identity.themeId) + '--little-hero-accent:' + (/^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885');
      const title = this.escapeHtml(msg.gif.title || 'GIF');
      const gifUrl = this.escapeHtml(msg.gif.gifUrl || msg.gif.previewUrl || '#');
      const preview = this.escapeHtml(msg.gif.previewUrl || '');
      const media = msg.gif.mp4Url
        ? `<video class="chat-gif-attachment" autoplay loop muted playsinline preload="metadata" poster="${preview}"><source src="${this.escapeHtml(msg.gif.mp4Url)}" type="video/mp4"></video>`
        : `<img class="chat-gif-attachment" src="${gifUrl}" alt="${title}">`;
      return `
        <div class="chat-message chat-gif-message ${isOwn ? 'own' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="${this.escapeHtml(msg.playerName || 'LITTLE HERO')}" data-editable="false" data-theme-id="${themeId}" style="${style}" oncontextmenu="return PlayerApp.openMessageActionMenu(event,this)">
          <div class="chat-avatar-rail">${avatar}</div>
          <div class="chat-message-main">
            <div class="chat-message-header"><span class="chat-player-name">${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span><span class="chat-time">${time}</span></div>
            <button type="button" class="chat-reply-btn" data-reply-id="${this.escapeHtml(msg.id)}" title="Reply" aria-label="Reply to GIF">&#8617;</button>
            <button type="button" class="chat-gif-link" title="${title}" aria-label="Open GIF preview">${media}</button>
            <div class="chat-gif-provider-mark">GIPHY</div>
            ${this.createReactionBarHTML(msg)}
          </div>
        </div>
      `;
    }

    if (msg.messageType === 'poll' && msg.poll) {
      const isBrokerPoll = msg.poll.createdByRole === 'gm';
      const isOwn = !isBrokerPoll && String(msg.playerId || '') === String(this.playerId || '');
      const identity = (this.currentPlayers || []).find(p =>
        String(p.id || '') === String(msg.playerId || '')
      ) || msg;
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (isBrokerPoll) {
        return `
          <div class="chat-broker-entry chat-reactable chat-broker-poll-entry" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="SHADOW BROKER" data-editable="false" oncontextmenu="return PlayerApp.openMessageActionMenu(event,this)">
            <div class="shadow-broker-transmission shadow-broker-broadcast shadow-broker-poll-transmission">
              <img src="assets/ui/shadow-broker.png" class="shadow-broker-avatar" alt="Shadow Broker">
              <div class="shadow-broker-body">
                <div class="shadow-broker-poll-identity"><span class="shadow-broker-name">SHADOW BROKER</span><span class="chat-time">${time}</span></div>
                ${this.createPollCardHTML(msg)}
              </div>
            </div>
            ${this.createReactionBarHTML(msg)}
          </div>
        `;
      }

      const themeId = ASOCThemes.get(identity.themeId).id;
      const style = ASOCThemes.messageStyle(identity.themeId) + '--little-hero-accent:' + (/^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885');
      return `
        <div class="chat-message chat-poll-message ${isOwn ? 'own' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="${this.escapeHtml(msg.playerName || 'LITTLE HERO')}" data-editable="false" data-theme-id="${themeId}" style="${style}" oncontextmenu="return PlayerApp.openMessageActionMenu(event,this)">
          <div class="chat-avatar-rail">${this.littleHeroAvatarHTML(identity)}</div>
          <div class="chat-message-main">
            <div class="chat-message-header"><span class="chat-player-name">${this.escapeHtml(msg.playerName || 'LITTLE HERO')}</span><span class="chat-time">${time}</span></div>
            <button type="button" class="chat-reply-btn" data-reply-id="${this.escapeHtml(msg.id)}" title="Reply" aria-label="Reply to ${this.escapeHtml(msg.playerName || 'poll')}">&#8617;</button>
            ${this.createPollCardHTML(msg)}
            ${this.createReactionBarHTML(msg)}
          </div>
        </div>
      `;
    }

    // SHADOW BROKER standalone broadcast -- a freestanding transmission,
    // not tied to any player's guess. Entirely separate markup from the
    // guess-bubble path below; no verdict, no target, no "own" styling.
    if (msg.source === 'shadowBroker') {
      const isNew = !this._seenShadowBrokerKeys.has(msg.id);
      if (isNew) this._seenShadowBrokerKeys.add(msg.id);
      const replyMatch = typeof msg.text === 'string'
        ? msg.text.match(/^↳ @([^:]{1,40}?)(?: \/\/ ([^:]{1,30}))?:\s*([\s\S]*)$/)
        : null;
      const messageText = replyMatch ? replyMatch[3] : msg.text;
      const replyContextHtml = replyMatch
        ? `<div class="chat-reply-context">↳ ${this.escapeHtml(replyMatch[1])}${replyMatch[2] ? ` // ${this.escapeHtml(replyMatch[2])}` : ''}</div>`
        : '';
      return `
        <div class="chat-broker-entry chat-reactable${manualTribute ? ' active-blood-tribute' : ''}" data-message-id="${this.escapeHtml(msg.id)}" data-player-name="SHADOW BROKER" data-editable="false" oncontextmenu="return PlayerApp.openMessageActionMenu(event,this)">
          ${manualBadge}${replyContextHtml}
          ${Skeleton.shadowBrokerTransmissionHTML(messageText || (msg.imageUrl ? 'IMAGE TRANSMISSION' : ''), { glitchIn: isNew })}\n          ${msg.imageUrl ? `<button type="button" class="chat-image-link" aria-label="Open image preview"><img class="chat-image-attachment" src="${this.escapeHtml(msg.imageUrl)}" alt="Chat image"></button>` : ''}
          ${msg.editedAt ? '<span class="chat-edited-marker">EDITED</span>' : ''}
          ${this.createReactionBarHTML(msg)}
        </div>
      `;
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const wrongSeenAt = this._wrongVerdictSeenAt.get(msg.id) ?? (now - 3000);
    const agedRejected = msg.verdict === 'wrong' && (now - wrongSeenAt) >= 3000;
    const isOwn = String(msg.playerId || '') === String(this.playerId || '');
    const canEdit = isOwn && !msg.source && msg.verdict == null;
    const identity = (this.currentPlayers || []).find(p =>
      String(p.id || '') === String(msg.playerId || '')
    ) || msg;
    const replyMatch = typeof msg.text === 'string'
      ? msg.text.match(/^↳ @([^:]{1,40}?)(?: \/\/ ([^:]{1,30}))?:\s*([\s\S]*)$/)
      : null;
    const messageText = replyMatch ? replyMatch[3] : msg.text;
    const replyContextHtml = replyMatch
      ? `<div class="chat-reply-context">↳ ${this.escapeHtml(replyMatch[1])}${replyMatch[2] ? ` // ${this.escapeHtml(replyMatch[2])}` : ''}</div>`
      : '';
    const verdictMetaHtml = msg.verdict === 'correct'
      ? `<div class="chat-machine-verdict accepted">ACCEPTED // ${this.escapeHtml(this.getTargetLabel(msg.target || 'LOCKED'))}</div>`
      : msg.verdict === 'wrong'
        ? '<div class="chat-machine-verdict rejected">FUCK OFF</div>'
        : '';

    // The Shadow Broker's verdict response is an ADDITIONAL identity layer
    // rendered alongside the verdict, not a replacement for it -- the
    // guess bubble above keeps its existing correct/wrong classes and
    // .chat-message-text color/strikethrough treatment exactly as before.
    // msg.verdict remains the sole source of truth; nothing here alters it.
    let verdictResponseHtml = '';
    if (msg.verdict === 'correct') {
      const verdictKey = `${msg.id}:${msg.verdict}`;
      const isNew = !this._seenShadowBrokerKeys.has(verdictKey);
      if (isNew) this._seenShadowBrokerKeys.add(verdictKey);
      verdictResponseHtml = Skeleton.shadowBrokerTransmissionHTML(msg.verdictResponse || 'Indeed.', {
        glitchIn: isNew,
        variant: 'verdict-response',
        verdict: msg.verdict
      });
    }

    return `
      <div class="chat-message ${manualTribute ? 'active-blood-tribute' : ''} ${isOwn ? 'own' : ''} ${grouped ? 'grouped' : ''} ${agedRejected ? 'aged-rejected' : ''} ${msg.verdict || ''}" data-message-id="${msg.id}" data-player-name="${this.escapeHtml(msg.playerName)}" data-editable="${canEdit ? 'true' : 'false'}" data-theme-id="${ASOCThemes.get(identity.themeId).id}" style="${ASOCThemes.messageStyle(identity.themeId)}--little-hero-accent:${/^#[0-9A-Fa-f]{6}$/.test(identity.frameColor || '') ? identity.frameColor : '#6f7885'}" oncontextmenu="return PlayerApp.openMessageActionMenu(event,this)">
        <div class="chat-avatar-rail">${this.littleHeroAvatarHTML(identity)}</div>
        <div class="chat-message-main">${manualBadge}
          <div class="chat-message-header"><span class="chat-player-name">${this.escapeHtml(msg.playerName)}</span></div>
          <button type="button" class="chat-reply-btn" data-reply-id="${msg.id}" title="Reply" aria-label="Reply to ${this.escapeHtml(msg.playerName)}">&#8617;</button>
          ${replyContextHtml}
          <div class="chat-message-line"><div class="chat-message-text">${this.escapeHtml(messageText)}</div><span class="chat-time">${time}</span>${msg.editedAt ? '<span class="chat-edited-marker">EDITED</span>' : ''}</div>${msg.imageUrl ? `<button type="button" class="chat-image-link" aria-label="Open image preview"><img class="chat-image-attachment" src="${this.escapeHtml(msg.imageUrl)}" alt="Chat image"></button>` : ''}
          ${verdictMetaHtml}
          ${verdictResponseHtml}
          ${this.createReactionBarHTML(msg)}
        </div>
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

  applyFinalSolverAura(aura, serverNow = Date.now()) {
    const remaining = aura && Number.isFinite(Number(aura.expiresAt))
      ? Number(aura.expiresAt) - Number(serverNow || Date.now())
      : 0;
    const next = remaining > 0 && aura.playerId
      ? { ...aura, localExpiresAt: Date.now() + remaining }
      : null;
    const currentKey = this.finalSolverAura
      ? `${this.finalSolverAura.playerId}:${this.finalSolverAura.startedAt}:${this.finalSolverAura.expiresAt}`
      : '';
    const nextKey = next ? `${next.playerId}:${next.startedAt}:${next.expiresAt}` : '';
    if (currentKey === nextKey) return;

    clearTimeout(this._finalSolverAuraTimer);
    this._finalSolverAuraTimer = null;
    this.finalSolverAura = next;
    if (next) {
      this._finalSolverAuraTimer = setTimeout(() => {
        const live = this.finalSolverAura;
        if (!live || live.playerId !== next.playerId || live.expiresAt !== next.expiresAt) return;
        this.finalSolverAura = null;
        this._finalSolverAuraTimer = null;
        if (this.currentPlayers) this.updatePlayerLeaderboard(this.currentPlayers);
        else if (this.chatMessages?.length) this.renderChat();
      }, Math.max(20, remaining + 20));
    }
    if (this.currentPlayers) this.updatePlayerLeaderboard(this.currentPlayers);
    else if (this.chatMessages?.length) this.renderChat();
  },

  littleHeroAvatarHTML(entity = {}, compact = false) {
    const frameColor = /^#[0-9A-Fa-f]{6}$/.test(entity.frameColor || '')
      ? entity.frameColor.toUpperCase()
      : '#9B5DE0';
    const avatarData = typeof entity.avatarData === 'string' &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(entity.avatarData)
      ? entity.avatarData
      : '';
    const entityId = entity.id || entity.playerId || '';
    const auraActive = !!(
      this.finalSolverAura &&
      this.finalSolverAura.playerId === entityId &&
      Date.now() < this.finalSolverAura.localExpiresAt
    );
    return `
      <span class="little-hero-avatar${compact ? ' little-hero-avatar-compact' : ''}${auraActive ? ' final-solver-aura' : ''}" style="--lh-frame:${frameColor};--lh-aura:${frameColor}">
        ${avatarData ? `<img src="${avatarData}" alt="">` : '<span class="little-hero-avatar-fallback">LH</span>'}
      </span>
    `;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => PlayerApp.init());
window.PlayerApp = PlayerApp;
