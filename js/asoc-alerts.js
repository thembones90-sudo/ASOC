// ASOC desktop alerts.
//
// Decides which chat/game events deserve the user's attention while the ASOC
// Engine desktop window is in the background, and hands them to the desktop
// shell (desktop/preload.js exposes window.asocDesktop). Every event flashes
// the taskbar button and bumps the unread badge; only the important ones
// (mentions, replies, battle start/end, the Wheel choosing you, guesses
// awaiting a verdict, players joining) also raise a Windows notification.
//
// In a normal browser window.asocDesktop is absent and this is a no-op.
// The pure helpers are exported for tests/desktop-alerts.js.
(function (root) {
  const REPLY_PREFIX = /^↳ @([^:]{1,40}?)(?: \/\/ [^:]{1,30})?:\s*/;
  const MAX_BODY = 140;

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "@Name" anywhere, case-insensitive, not followed by more name characters
  // (so "@Ann" does not match "@Anna"). Names can contain spaces.
  function mentionsName(text, name) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    return new RegExp('(^|[^\\p{L}\\p{N}_])@' + escapeRegExp(clean) + '(?![\\p{L}\\p{N}_])', 'iu').test(String(text || ''));
  }

  function mentionsAll(text) {
    return /(^|[^\p{L}\p{N}_])@all(?![\p{L}\p{N}_])/iu.test(String(text || ''));
  }

  // Replies are plain text: "↳ @Name // excerpt: message".
  function replyTarget(text) {
    const match = String(text || '').match(REPLY_PREFIX);
    return match ? match[1].trim() : null;
  }

  function isReplyTo(text, name) {
    const target = replyTarget(text);
    return !!target && target.toLocaleLowerCase() === String(name || '').trim().toLocaleLowerCase();
  }

  function stripReplyPrefix(text) {
    return String(text || '').replace(REPLY_PREFIX, '');
  }

  function truncate(text, max = MAX_BODY) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
  }

  // One line describing a chat message for a notification body.
  function describeMessage(msg) {
    if (!msg) return '';
    if (msg.messageType === 'gif' || msg.messageType === 'gifRemote') return msg.text ? truncate('GIF · ' + msg.text) : 'GIF';
    if (msg.messageType === 'image' || msg.imageUrl) return truncate(msg.text ? '📷 ' + msg.text : '📷 Image');
    if (msg.messageType === 'poll') return truncate('📊 ' + (msg.poll?.question || msg.text || 'Poll'));
    return truncate(stripReplyPrefix(msg.text));
  }

  function senderName(msg) {
    return String(msg?.playerName || (msg?.source === 'shadowBroker' ? 'SHADOW BROKER' : 'ASOC'));
  }

  // Classify a new chat message for someone called `selfName`.
  // Returns 'mention' | 'reply' | 'chat'.
  function classifyForName(msg, selfName, { allowAll = false } = {}) {
    const text = String(msg?.text || '');
    if (isReplyTo(text, selfName)) return 'reply';
    if (mentionsName(stripReplyPrefix(text), selfName)) return 'mention';
    if (allowAll && mentionsAll(text)) return 'mention';
    return 'chat';
  }

  // The GM's own Master Mirror persona ("TEST SUBJECT") must never alert the
  // GM: it is the GM, not a Little Hero arriving or talking.
  function isMasterTestPersona(entity) {
    return String(entity?.playerId ?? entity?.id ?? '').startsWith('__MASTER_TEST__') || entity?.isTestPersona === true;
  }

  const GM_NAMES = ['SHADOW BROKER', 'BROKER', 'GM'];
  function classifyForGm(msg) {
    const text = String(msg?.text || '');
    if (isReplyTo(text, 'SHADOW BROKER')) return 'reply';
    const body = stripReplyPrefix(text);
    return GM_NAMES.some(name => mentionsName(body, name)) ? 'mention' : 'chat';
  }

  const api = {
    mentionsName,
    mentionsAll,
    replyTarget,
    isReplyTo,
    stripReplyPrefix,
    describeMessage,
    classifyForName,
    classifyForGm,
    unread: 0,

    bridge() {
      return root && root.asocDesktop && typeof root.asocDesktop.attention === 'function' ? root.asocDesktop : null;
    },

    // A Master Mirror tab is the GM testing the player view; alerting there
    // would duplicate every alert the GM window already raises.
    suppressed() {
      try { return root.sessionStorage.getItem('asoc_master_persona') === 'PLAYER_TEST'; } catch { return false; }
    },

    windowActive() {
      const doc = root.document;
      return !!doc && doc.visibilityState === 'visible' && doc.hasFocus();
    },

    // count: how many events to add to the badge.
    // popup: { title, body, tag } to also raise a Windows notification.
    signal({ count = 1, popup = null } = {}) {
      const bridge = this.bridge();
      if (!bridge || count <= 0 || this.suppressed() || this.windowActive()) return;
      this.unread += count;
      bridge.attention(this.unread);
      if (popup) bridge.notify({ title: truncate(popup.title, 64), body: truncate(popup.body || ''), tag: popup.tag || '' });
    },

    clear() {
      if (!this.unread) return;
      this.unread = 0;
      this.bridge()?.attention(0);
    },

    // Summarise a batch of popup-worthy items into one notification so a
    // burst of messages does not stack a dozen toasts.
    summarize(items, pluralTitle) {
      if (!items.length) return null;
      if (items.length === 1) return items[0];
      return { title: pluralTitle.replace('{n}', items.length), body: items.map(item => item.body).join(' · '), tag: items[0].tag };
    },

    // ---- Little Hero -----------------------------------------------------

    playerChat(newMessages, { selfId, selfName }) {
      const others = newMessages.filter(m => m && String(m.playerId || '') !== String(selfId || ''));
      if (!others.length) return;
      const important = [];
      others.forEach(msg => {
        const kind = classifyForName(msg, selfName, { allowAll: msg.source === 'shadowBroker' });
        if (kind === 'chat') return;
        important.push({
          title: kind === 'reply' ? `${senderName(msg)} replied to you` : `${senderName(msg)} mentioned you`,
          body: describeMessage(msg),
          tag: 'chat'
        });
      });
      this.signal({ count: others.length, popup: this.summarize(important, '{n} new mentions and replies') });
    },

    // Tracks public state across updates; the first state is a baseline so a
    // (re)connect never replays an old result as a fresh alert.
    playerState(state, { selfName }) {
      if (!state) return;
      const roomMode = state.roomMode || (state.armed === true ? 'BATTLE_ARMED' : 'CASUAL');
      const battle = roomMode !== 'CASUAL';
      const won = battle && state.gameWon === true;
      const lostKey = battle && state.matchResult?.outcome === 'LOST'
        ? String(state.matchResult.occurredAt || state.matchResult.message || 'lost')
        : null;
      const wheel = state.wheel || {};
      const wheelWinner = wheel.phase === 'result' ? wheel.segments?.[wheel.winnerIndex] : null;
      const wheelKey = wheelWinner ? String(wheel.spinToken || wheel.segments.join('|') + ':' + wheel.winnerIndex) : null;
      const prev = this._playerState;
      this._playerState = { won, lostKey, wheelKey };
      if (!prev) return;

      if (won && !prev.won) {
        this.signal({ popup: { title: 'GAME WON', body: 'The final association has been solved.', tag: 'result' } });
      }
      if (lostKey && lostKey !== prev.lostKey) {
        this.signal({ popup: { title: 'GAME LOST', body: truncate(state.matchResult.message || 'Time exhausted.'), tag: 'result' } });
      }
      if (wheelKey && wheelKey !== prev.wheelKey
        && String(wheelWinner).trim().toLocaleLowerCase() === String(selfName || '').trim().toLocaleLowerCase()) {
        this.signal({ popup: { title: 'THE WHEEL CHOSE YOU', body: 'Wheel of Misfortune landed on you.', tag: 'wheel' } });
      }
    },

    battleStarting() {
      this.signal({ popup: { title: 'BATTLE STARTING', body: 'The countdown has begun. Return to ABUSEMENT PARK.', tag: 'battle' } });
    },

    // ---- Shadow Broker (GM) ----------------------------------------------

    gmChat(newMessages) {
      const players = newMessages.filter(m => m && m.playerId && m.source !== 'shadowBroker' && !isMasterTestPersona(m));
      if (!players.length) return;
      const guesses = [];
      const direct = [];
      players.forEach(msg => {
        if (msg.adjudicable === true && !msg.verdict) {
          guesses.push({ title: `${senderName(msg)} is waiting for a verdict`, body: describeMessage(msg), tag: 'verdict' });
          return;
        }
        const kind = classifyForGm(msg);
        if (kind !== 'chat') {
          direct.push({
            title: kind === 'reply' ? `${senderName(msg)} replied to you` : `${senderName(msg)} mentioned you`,
            body: describeMessage(msg),
            tag: 'chat'
          });
        }
      });
      const popup = guesses.length
        ? this.summarize(guesses, '{n} guesses waiting for a verdict')
        : this.summarize(direct, '{n} new mentions and replies');
      this.signal({ count: players.length, popup });
    },

    gmPlayers(players) {
      const online = new Map((players || [])
        .filter(p => p && p.id && p.connected !== false && !isMasterTestPersona(p))
        .map(p => [String(p.id), String(p.name || 'A Little Hero')]));
      const prev = this._gmOnline;
      this._gmOnline = online;
      if (!prev) return;
      const joined = [...online].filter(([id]) => !prev.has(id)).map(([, name]) => name);
      if (!joined.length) return;
      this.signal({
        count: joined.length,
        popup: {
          title: joined.length === 1 ? `${joined[0]} joined` : `${joined.length} Little Heroes joined`,
          body: joined.length === 1 ? 'A Little Hero entered the Master Room.' : joined.join(', '),
          tag: 'join'
        }
      });
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  root.AsocAlerts = api;
  const clearIfActive = () => { if (api.windowActive()) api.clear(); };
  root.addEventListener('focus', clearIfActive);
  root.document.addEventListener('visibilitychange', clearIfActive);
})(typeof window !== 'undefined' ? window : globalThis);
