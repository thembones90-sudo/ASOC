// THY SHALL NOT RAGE -- client for both the Little Hero page (PlayerApp) and
// the Shadow Broker console (App). Presentation + input only: the server
// (rage.js via server.js) rolls the dice and decides every move.
//
// One window (#rage-overlay) sits over the page. OPEN CHAT folds it into a
// live dock above the chat composer; one click brings the board back.
(() => {
  'use strict';
  const GM_ID = '__GM__';
  const TRACK = 40;
  const HOME_FIRST = 40;
  // The ten figurine colours (ids match rage.js COLORS).
  const COLORS = {
    blood: ['#e0303f', 'BLOOD'], void: ['#9b5de0', 'VOID'], venom: ['#5fd23a', 'VENOM'], gold: ['#ffd23a', 'GOLD'],
    frost: ['#3fc8ff', 'FROST'], rose: ['#ff5fb8', 'ROSE'], ember: ['#ff8a1f', 'EMBER'], spectre: ['#22d6b8', 'SPECTRE'],
    abyss: ['#3d5cff', 'ABYSS'], bone: ['#e8e1d4', 'BONE']
  };
  const EMPTY_SEAT = '#4a4148';
  const hexOf = c => COLORS[c]?.[0] || EMPTY_SEAT;
  // 11x11 cross board. PATH[i] is track square i; seat s starts on s*10.
  const PATH = [[0,4],[1,4],[2,4],[3,4],[4,4],[4,3],[4,2],[4,1],[4,0],[5,0],[6,0],[6,1],[6,2],[6,3],[6,4],[7,4],[8,4],[9,4],[10,4],[10,5],[10,6],[9,6],[8,6],[7,6],[6,6],[6,7],[6,8],[6,9],[6,10],[5,10],[4,10],[4,9],[4,8],[4,7],[4,6],[3,6],[2,6],[1,6],[0,6],[0,5]];
  const HOMES = [[[1,5],[2,5],[3,5],[4,5]], [[5,1],[5,2],[5,3],[5,4]], [[9,5],[8,5],[7,5],[6,5]], [[5,9],[5,8],[5,7],[5,6]]];
  const YARDS = [[[0,0],[1,0],[0,1],[1,1]], [[9,0],[10,0],[9,1],[10,1]], [[9,9],[10,9],[9,10],[10,10]], [[0,9],[1,9],[0,10],[1,10]]];
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const HOP_MS = 150;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isGM = () => !!window.App && !window.PlayerApp;
  const host = () => (isGM() ? window.App : window.PlayerApp);
  const viewerId = () => (isGM() ? GM_ID : String(window.PlayerApp?.playerId || ''));
  const casual = () => host()?.roomMode === 'CASUAL' || document.body.classList.contains('room-mode-casual');

  function cellOf(seat, p, piece) {
    if (p < 0) return YARDS[seat][piece];
    if (p >= HOME_FIRST) return HOMES[seat][p - HOME_FIRST];
    return PATH[(seat * 10 + p) % TRACK];
  }
  const pct = v => `${((v + 0.5) * 100 / 11).toFixed(3)}%`;

  const Rage = {
    state: null,
    open: false,
    chat: false,
    skew: 0,
    seen: null,        // last event seq already animated (null = not baselined)
    positions: {},     // "pid:i" -> progress currently drawn
    animating: 0,
    invited: new Set(),
    stakeDraft: 5,

    init() {
      if (this.initialized) return;
      this.initialized = true;
      document.addEventListener('click', e => this.click(e));
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this.open && !this.chat) this.hide();
      });
      document.getElementById('minigames-rage')?.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('casual-minigames-menu')?.setAttribute('hidden', '');
        document.getElementById('casual-minigames-toggle')?.setAttribute('aria-expanded', 'false');
        this.show();
      });
      setInterval(() => this.tickClocks(), 250);
    },

    send(message) { host()?.send?.(message); },

    ensureOverlay() {
      let el = document.getElementById('rage-overlay');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'rage-overlay';
      el.className = 'rage-overlay';
      el.hidden = true;
      el.innerHTML = `
        <div class="rage-window" role="dialog" aria-label="Thy Shall Not Rage">
          <header class="rage-head">
            <div class="rage-title"><b>THY SHALL NOT RAGE</b><small>NE LJUTI SE ČOVEČE // FOUR HOME OR NOTHING</small></div>
            <div class="rage-head-actions">
              <button type="button" data-rage="chat">OPEN CHAT</button>
              <button type="button" data-rage="close" aria-label="Close">×</button>
            </div>
          </header>
          <div id="rage-body" class="rage-body"></div>
        </div>`;
      document.body.appendChild(el);
      return el;
    },

    ensureDock() {
      const id = isGM() ? 'gm-rage-dock' : 'rage-restore';
      let dock = document.getElementById(id);
      if (dock) return dock;
      const parent = isGM() ? document.querySelector('.gm-module-chat .gm-chat-panel') : document.getElementById('chat-panel');
      if (!parent) return null;
      dock = document.createElement('button');
      dock.type = 'button';
      dock.id = id;
      dock.className = isGM() ? 'gm-kaladont-dock rage-dock' : 'kaladont-restore kaladont-dock rage-dock';
      dock.dataset.rage = 'game';
      dock.hidden = true;
      parent.appendChild(dock);
      return dock;
    },

    show() {
      if (!casual()) return;
      this.open = true;
      this.chat = false;
      this.ensureOverlay().hidden = false;
      this.send({ type: 'rage:sync' });
      this.render(true);
      this.renderDock();
    },
    hide() {
      this.open = false;
      this.chat = false;
      if (document.getElementById('rage-overlay')) document.getElementById('rage-overlay').hidden = true;
      this.renderDock();
    },
    toChat() {
      this.chat = true;
      document.getElementById('rage-overlay').hidden = true;
      this.renderDock();
      (document.getElementById('shadow-broker-composer') || document.getElementById('chat-input'))?.focus();
    },
    fromChat() {
      this.chat = false;
      this.ensureOverlay().hidden = false;
      this.renderDock();
      this.render(true);
    },
    leaveCasual() {
      this.hide();
      document.getElementById('rage-invite')?.remove();
    },

    onState(state) {
      const prev = this.state;
      this.state = state || null;
      if (state?.serverNow) this.skew = state.serverNow - Date.now();
      this.updateCards();
      this.invite(state);
      // Seated players are pulled in when the game starts.
      if (state?.you?.playing && prev?.phase === 'lobby' && state.phase !== 'lobby' && !this.open) this.show();
      if (!state || state.id !== prev?.id) { this.seen = null; this.positions = {}; this.colorDraft = null; }
      if (!casual()) this.leaveCasual();
      this.render(false);
      this.renderDock();
    },

    updateCards() {
      const s = this.state;
      const label = !s ? (isGM() ? 'IDLE' : 'CREATE') : s.phase === 'lobby' ? `LOBBY ${s.members.length}/4` : s.phase === 'ended' ? 'RESULT' : 'LIVE';
      ['rage-status', 'gm-rage-status'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = label; });
    },

    invite(s) {
      const old = document.getElementById('rage-invite');
      if (old && (!s || s.phase !== 'lobby' || s.you?.member || old.dataset.lobby !== s.id)) old.remove();
      if (!s || s.phase !== 'lobby' || s.you?.member || this.invited.has(s.id) || !casual()) return;
      this.invited.add(s.id);
      const toast = document.createElement('div');
      toast.id = 'rage-invite';
      toast.className = 'kaladont-invite rage-invite';
      toast.dataset.lobby = s.id;
      toast.setAttribute('role', 'status');
      toast.innerHTML = `<div><b>THY SHALL NOT RAGE</b><small>${esc(s.ownerName)} opened a table · ${s.stake ? `STAKE ${s.stake} SC` : 'FOR FUN'}</small></div><button type="button" data-rage="invite-open">VIEW</button><button type="button" data-rage="invite-dismiss" class="is-dismiss">LATER</button>`;
      document.body.appendChild(toast);
    },

    // ---------------- rendering ----------------
    render(force) {
      const body = document.getElementById('rage-body');
      if (!body || !this.open) return;
      const s = this.state;
      const mode = !s ? 'create' : s.phase === 'lobby' ? 'lobby' : 'game';
      const key = `${mode}:${s?.id || ''}`;
      if (mode === 'game') {
        if (force || body.dataset.key !== key) { body.innerHTML = this.gameShell(s); body.dataset.key = key; this.seen = null; this.positions = {}; }
        return this.patchGame(s);
      }
      // Keep a half-typed stake through repaints.
      const stake = body.querySelector('#rage-stake');
      if (stake) this.stakeDraft = stake.value;
      body.dataset.key = key;
      body.innerHTML = mode === 'create' ? this.createHTML() : this.lobbyHTML(s);
    },

    avatar(id) {
      if (id === GM_ID) return (window.App?.brokerProfile?.avatarData) || 'assets/ui/shadow-broker.png';
      const list = host()?.currentPlayers || [];
      return list.find(p => String(p.id) === String(id))?.avatarData || '';
    },
    face(id, name) {
      const src = this.avatar(id);
      return src ? `<img src="${esc(src)}" alt="">` : `<i>${esc(String(name || '?').slice(0, 1))}</i>`;
    },

    createHTML() {
      return `
        <div class="rage-create">
          <div class="rage-rules">
            <b>THE LAW OF THE TABLE</b>
            <ul>
              <li><i aria-hidden="true">♟</i><span><em>2–4 players</em>, 4 pieces each. First to bring all four home wins.</span></li>
              <li><i aria-hidden="true">⚅</i><span>A <em>6</em> leaves the yard. With nothing on the board you get <em>3 tries</em> for it.</span></li>
              <li><i aria-hidden="true">↻</i><span>Every <em>6</em> rolls again.</span></li>
              <li><i aria-hidden="true">☠</i><span>Eating is a <em>must</em>: if you can send someone back, you have to.</span></li>
              <li><i aria-hidden="true">⌂</i><span>Home squares need an <em>exact roll</em>. Too slow and the House moves for you.</span></li>
            </ul>
          </div>
          <div class="rage-terms">
            <button type="button" class="rage-term is-fun" data-rage="create-fun">
              <b>FOR FUN</b>
              <small>No coins. Only pride.</small>
              <span class="rage-term-cta">OPEN FUN TABLE</span>
            </button>
            <div class="rage-term is-coins">
              <b>FOR COINS</b>
              <small>Everyone who joins agrees to the stake. Winner takes the pot.</small>
              <label>STAKE <input id="rage-stake" type="number" min="1" max="50" value="${esc(this.stakeDraft)}"> SC A HEAD</label>
              <button type="button" data-rage="create-coins">OPEN COIN TABLE</button>
            </div>
          </div>
          ${isGM() ? '<p class="rage-note">You play as the SHADOW BROKER and never pay a stake. If you win a coin table, THE HOUSE TAKES THE POT.</p>' : ''}
        </div>`;
    },

    lobbyHTML(s) {
      const you = s.you || {};
      const seats = Array.from({ length: 4 }, (_, i) => {
        const m = s.members[i];
        if (!m) return `<li class="is-empty"><span class="rage-face"><i>+</i></span><b>OPEN SEAT</b></li>`;
        return `<li class="${m.color ? '' : 'is-picking'}" style="--seat:${hexOf(m.color)}"><span class="rage-face">${this.face(m.id, m.name)}</span><b>${esc(m.name)}</b><small class="rage-seat-color">${m.color ? esc(COLORS[m.color]?.[1] || '') : 'PICKING COLOUR…'}</small>${m.id === s.ownerId ? '<small>HOST</small>' : ''}${m.online ? '' : '<small class="is-off">OFFLINE</small>'}</li>`;
      }).join('');
      const terms = s.stake ? `FOR COINS · STAKE <em>${s.stake} SC</em> A HEAD` : 'FOR FUN · NO COINS';
      const online = s.members.filter(m => m.online).length;
      const picking = s.members.filter(m => m.online && !m.color).length;
      const blocked = online < 2 ? ' (NEED 2)' : picking ? ` (${picking} PICKING)` : '';
      let actions = '';
      if (!you.member) actions += `<button type="button" class="is-primary" data-rage="join" ${s.members.length >= 4 ? 'disabled' : ''}>${s.stake ? `AGREE & JOIN · ${s.stake} SC` : 'JOIN TABLE'}</button>`;
      if (you.owner) actions += `<button type="button" class="is-primary" data-rage="start" ${blocked ? 'disabled' : ''}>START${blocked}</button><button type="button" data-rage="cancel">CANCEL TABLE</button>`;
      else if (you.member) actions += `<button type="button" data-rage="leave">LEAVE</button>`;
      if (isGM() && !you.owner) actions += `<button type="button" data-rage="gm-cancel">CLOSE TABLE</button>`;
      return `
        <div class="rage-lobby">
          <div class="rage-lobby-terms ${s.stake ? 'is-coins' : ''}"><small>${esc(s.ownerName)}'S TABLE</small><b>${terms}</b>${s.stake ? '<span>Joining is agreeing. Stakes are taken when the game starts and returned if it is called off.</span>' : ''}</div>
          <ul class="rage-seats">${seats}</ul>
          ${you.member ? this.pickerHTML(s) : ''}
          <div class="rage-actions">${actions}</div>
          ${you.owner ? '<p class="rage-note">Only players online when you press START take a seat.</p>' : ''}
        </div>`;
    },

    // Ten figurine colours. Selecting is private until COMMIT; a committed
    // colour is locked to its owner and greyed out for everyone else.
    pickerHTML(s) {
      const committed = s.members.find(m => m.id === viewerId())?.color || null;
      const holderOf = c => s.members.find(m => m.color === c && m.id !== viewerId());
      if (this.colorDraft && holderOf(this.colorDraft)) this.colorDraft = null;
      const shown = committed || this.colorDraft;
      const swatches = (s.colors || Object.keys(COLORS)).map(c => {
        const holder = holderOf(c);
        const [hex, name] = COLORS[c] || [EMPTY_SEAT, c];
        const off = !!holder || (committed && c !== committed);
        return `<button type="button" class="rage-swatch${c === shown ? ' is-mine' : ''}${holder ? ' is-taken' : ''}${committed && c === committed ? ' is-locked' : ''}" data-rage="color" data-color="${esc(c)}" style="--seat:${hex}" aria-pressed="${c === shown}" ${off ? 'disabled' : ''} title="${esc(name)}${holder ? ` · TAKEN BY ${esc(holder.name)}` : ''}"><span></span><small>${holder ? esc(String(holder.name).slice(0, 8)) : esc(name)}</small></button>`;
      }).join('');
      const foot = committed
        ? `<p class="rage-picker-state is-locked">LOCKED IN: <em style="color:${hexOf(committed)}">${esc(COLORS[committed]?.[1] || '')}</em></p>`
        : `<div class="rage-picker-state"><span>${this.colorDraft ? `SELECTED: <em style="color:${hexOf(this.colorDraft)}">${esc(COLORS[this.colorDraft]?.[1] || '')}</em>` : 'SELECT A COLOUR, THEN COMMIT'}</span><button type="button" class="is-primary" data-rage="commit-color" ${this.colorDraft ? '' : 'disabled'}>COMMIT</button></div>`;
      return `<div class="rage-picker${committed ? ' is-committed' : ''}"><b>YOUR FIGURINE</b><div class="rage-swatches">${swatches}</div>${foot}</div>`;
    },

    gameShell(s) {
      const cells = [];
      const track = new Map(PATH.map((c, i) => [c.join(','), i]));
      for (let y = 0; y < 11; y += 1) {
        for (let x = 0; x < 11; x += 1) {
          const k = `${x},${y}`;
          let cls = '';
          let style = '';
          if (track.has(k)) {
            const i = track.get(k);
            cls = 'rage-sq';
            if (i % 10 === 0) { cls += ' is-start'; style = `--seat:${this.seatHex(s, i / 10)}`; }
          } else {
            const home = HOMES.findIndex(h => h.some(c => c.join(',') === k));
            const yard = YARDS.findIndex(h => h.some(c => c.join(',') === k));
            if (home !== -1) { cls = 'rage-sq is-home'; style = `--seat:${this.seatHex(s, home)}`; }
            else if (yard !== -1) { cls = 'rage-sq is-yard'; style = `--seat:${this.seatHex(s, yard)}`; }
          }
          if (cls) cells.push(`<i class="${cls}" style="grid-column:${x + 1};grid-row:${y + 1};${style}"></i>`);
        }
      }
      // A faded owner face in each occupied corner.
      const corners = [[0.5, 0.5], [9.5, 0.5], [9.5, 9.5], [0.5, 9.5]];
      const faces = s.players.map(p => {
        const [x, y] = corners[p.seat];
        return `<span class="rage-corner" data-seat="${p.seat}" style="left:${pct(x)};top:${pct(y)};--seat:${hexOf(p.color)}">${this.face(p.id, p.name)}</span>`;
      }).join('');
      return `
        <div class="rage-game">
          <div class="rage-board-wrap">
            <div class="rage-board" id="rage-board">
              <div class="rage-grid">${cells.join('')}</div>
              ${faces}
              <div class="rage-sigil" aria-hidden="true"><b>✠</b></div>
              <div class="rage-targets" id="rage-targets"></div>
              <div class="rage-pieces" id="rage-pieces"></div>
              <div class="rage-flash" id="rage-flash" aria-live="polite"></div>
            </div>
          </div>
          <aside class="rage-side">
            <div class="rage-turn" id="rage-turn"></div>
            <div class="rage-dice-row">
              <div class="rage-die" id="rage-die" aria-label="Die">${this.dieFaces(null)}</div>
              <div class="rage-roll-box" id="rage-roll-box"></div>
            </div>
            <ol class="rage-players" id="rage-players"></ol>
            <div class="rage-pot" id="rage-pot"></div>
            <div class="rage-log" id="rage-log"></div>
            <div class="rage-actions" id="rage-end-actions"></div>
          </aside>
        </div>`;
    },

    dieFaces(n) {
      return Array.from({ length: 9 }, (_, i) => `<s class="${n && PIPS[n].includes(i) ? 'on' : ''}"></s>`).join('');
    },

    nameOf(id) { return this.state?.players.find(p => p.id === id)?.name || 'SOMEONE'; },
    colorOf(id) { return hexOf(this.state?.players.find(p => p.id === id)?.color); },
    // An empty seat's yard and home lane stay neutral grey.
    seatHex(s, seat) { return hexOf(s.players.find(p => p.seat === seat)?.color); },

    patchGame(s) {
      const you = s.you || {};
      const live = s.phase === 'roll' || s.phase === 'move';
      const me = s.players.find(p => p.id === viewerId());
      // Turn banner + clock.
      const turnEl = document.getElementById('rage-turn');
      if (turnEl) {
        let line;
        if (s.phase === 'ended') line = `<b class="is-win" style="--seat:${this.colorOf(s.winnerId)}">${s.winnerId === viewerId() ? 'YOU WIN' : `${esc(s.winnerName)} WINS`}</b><small>${s.reward?.amount ? (s.reward.house ? `THE HOUSE TAKES ${s.reward.amount} SC` : `POT PAID: +${s.reward.amount} SC`) : 'ALL FOUR HOME'}</small>`;
        else if (you.yourTurn) line = `<b class="is-you">${s.phase === 'roll' ? 'YOUR ROLL' : s.mustCapture ? 'YOU MUST EAT' : 'PICK A PIECE'}</b><small>${s.phase === 'roll' && s.tries > 1 ? `${s.tries} TRIES FOR A 6` : s.phase === 'roll' && s.roll === 6 ? 'SIX! ROLL AGAIN' : s.phase === 'move' ? `YOU ROLLED ${s.roll}` : 'THROW THE DIE'}</small>`;
        else line = `<b style="--seat:${this.colorOf(s.turnId)}">${esc(s.turnName)}</b><small>${s.phase === 'roll' ? 'IS ROLLING' : `ROLLED ${s.roll} · CHOOSING`}</small>`;
        turnEl.innerHTML = `${line}${live ? `<span class="rage-clock" data-deadline="${s.deadline}"></span>` : ''}`;
        turnEl.style.setProperty('--seat', this.colorOf(s.turnId || s.winnerId));
      }
      const rollBox = document.getElementById('rage-roll-box');
      if (rollBox) {
        const canRoll = you.yourTurn && s.phase === 'roll';
        rollBox.innerHTML = canRoll ? `<button type="button" class="rage-roll" data-rage="roll" data-seq="${s.turnSeq}">ROLL</button>` : live && you.yourTurn ? '<span class="rage-hint">CLICK A GLOWING PIECE</span>' : '';
      }
      const list = document.getElementById('rage-players');
      if (list) {
        list.innerHTML = s.players.map(p => {
          const home = p.pieces.filter(x => x >= HOME_FIRST).length;
          const yard = p.pieces.filter(x => x < 0).length;
          return `<li class="${p.id === s.turnId ? 'is-turn' : ''}${p.out ? ' is-out' : ''}" style="--seat:${hexOf(p.color)}"><span class="rage-face">${this.face(p.id, p.name)}</span><b>${esc(p.name)}${p.id === viewerId() ? ' <em>YOU</em>' : ''}</b><small>${p.out ? 'FORFEITED' : `${home}/4 HOME · ${yard} IN YARD`}${p.online ? '' : ' · OFFLINE'}</small></li>`;
        }).join('');
      }
      const pot = document.getElementById('rage-pot');
      if (pot) pot.innerHTML = s.stake ? `<b>POT</b><span>${s.pot} SC</span><small>${s.stake} A HEAD${s.players.some(p => p.id === GM_ID) ? ' · THE BROKER PLAYS FREE' : ''}</small>` : '<b>FOR FUN</b><small>NO COINS ON THE TABLE</small>';
      const end = document.getElementById('rage-end-actions');
      if (end) {
        let html = '';
        if (s.phase === 'ended') html = `<button type="button" class="is-primary" data-rage="new">NEW TABLE</button>`;
        else if (me && !me.out) html = `<button type="button" data-rage="forfeit">FORFEIT</button>`;
        if (isGM() && live) html += `<button type="button" data-rage="gm-cancel">OVERTURN BOARD</button>`;
        end.innerHTML = html;
      }
      this.renderLog(s);
      this.animate(s);
    },

    renderLog(s) {
      const log = document.getElementById('rage-log');
      if (!log) return;
      const lines = s.events.filter(e => e.kind !== 'move').slice(-5).reverse().map(e => {
        const c = this.colorOf(e.by);
        if (e.kind === 'roll') return `<p><i style="background:${c}"></i>${esc(this.nameOf(e.by))} rolled <b>${e.value}</b></p>`;
        if (e.kind === 'capture') return `<p class="is-capture"><i style="background:${c}"></i>${esc(this.nameOf(e.by))} sent <b>${esc(this.nameOf(e.victim))}</b> back</p>`;
        if (e.kind === 'win') return `<p class="is-win"><i style="background:${c}"></i>${esc(this.nameOf(e.by))} brought all four home</p>`;
        return '';
      }).join('');
      log.innerHTML = lines;
    },

    // Pieces: drawn once per game and moved square by square.
    animate(s) {
      const layer = document.getElementById('rage-pieces');
      const targets = document.getElementById('rage-targets');
      if (!layer) return;
      const fresh = this.seen === null;
      const newEvents = fresh ? [] : s.events.filter(e => e.seq > this.seen);
      this.seen = s.events.length ? s.events[s.events.length - 1].seq : 0;
      const movable = new Map((s.options || []).map(o => [o.piece, o]));
      const moves = new Map(newEvents.filter(e => e.kind === 'move').map(e => [`${e.by}:${e.piece}`, e]));
      const captured = newEvents.filter(e => e.kind === 'capture');
      s.players.forEach(p => {
        p.pieces.forEach((prog, i) => {
          const key = `${p.id}:${i}`;
          let el = layer.querySelector(`[data-key="${CSS.escape(key)}"]`);
          if (!el) {
            el = document.createElement('button');
            el.type = 'button';
            el.className = 'rage-piece';
            el.dataset.key = key;
            el.style.setProperty('--seat', hexOf(p.color));
            el.innerHTML = '<span></span>';
            layer.appendChild(el);
            this.place(el, cellOf(p.seat, prog, i));
            this.positions[key] = prog;
          }
          el.classList.toggle('is-out', !!p.out);
          const mine = p.id === viewerId();
          const option = mine ? movable.get(i) : null;
          el.classList.toggle('is-movable', !!option);
          el.classList.toggle('is-capture', !!option?.capture);
          if (option) { el.dataset.rage = 'move'; el.dataset.piece = String(i); el.dataset.seq = String(s.turnSeq); }
          else { delete el.dataset.rage; }
          el.disabled = !option;
          const was = this.positions[key];
          if (was === prog) return;
          this.positions[key] = prog;
          const ev = moves.get(key);
          if (ev && ev.from >= 0 && prog > ev.from) {
            // Walk it square by square.
            const steps = [];
            for (let q = ev.from + 1; q <= prog; q += 1) steps.push(cellOf(p.seat, q, i));
            steps.forEach((c, n) => setTimeout(() => { this.place(el, c); el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); }, n * HOP_MS));
          } else if (prog < 0 && was >= 0 && captured.some(c => c.victim === p.id && c.piece === i)) {
            const c = captured.find(x => x.victim === p.id && x.piece === i);
            setTimeout(() => {
              el.classList.add('is-sent-back');
              this.flash(c);
              this.place(el, cellOf(p.seat, -1, i));
              setTimeout(() => el.classList.remove('is-sent-back'), 900);
            }, this.walkTime(moves, c.by));
          } else {
            this.place(el, cellOf(p.seat, prog, i));
          }
        });
      });
      // Where each movable piece would land.
      if (targets) {
        const me = s.players.find(p => p.id === viewerId());
        targets.innerHTML = me ? (s.options || []).map(o => {
          const [x, y] = cellOf(me.seat, o.to, o.piece);
          return `<i class="${o.capture ? 'is-capture' : ''}" data-target-piece="${o.piece}" style="left:${pct(x)};top:${pct(y)};--seat:${hexOf(me.color)}"></i>`;
        }).join('') : '';
      }
      const rolls = newEvents.filter(e => e.kind === 'roll');
      if (rolls.length) this.rollDie(rolls[rolls.length - 1].value);
      else if (fresh) { const last = [...s.events].reverse().find(e => e.kind === 'roll'); this.setDie(last?.value || null); }
      if (!fresh && newEvents.some(e => e.kind === 'win')) this.winFlash(s);
    },

    walkTime(moves, by) {
      const m = [...moves.values()].find(e => e.by === by);
      return m && m.from >= 0 ? (m.to - m.from) * HOP_MS : 0;
    },

    place(el, [x, y]) { el.style.left = pct(x); el.style.top = pct(y); },

    setDie(n) {
      const die = document.getElementById('rage-die');
      if (!die) return;
      die.innerHTML = this.dieFaces(n);
      die.classList.toggle('is-six', n === 6);
    },
    rollDie(n) {
      const die = document.getElementById('rage-die');
      if (!die) return;
      die.classList.remove('is-rolling');
      void die.offsetWidth;
      die.classList.add('is-rolling');
      let t = 0;
      const spin = setInterval(() => { this.setDie(1 + Math.floor(Math.random() * 6)); if ((t += 1) > 6) { clearInterval(spin); this.setDie(n); die.classList.remove('is-rolling'); } }, 70);
    },

    flash(capture) {
      const el = document.getElementById('rage-flash');
      if (!el) return;
      const mine = capture.victim === viewerId();
      el.innerHTML = `<div class="rage-sent"><b>SENT BACK</b><small>${esc(this.nameOf(capture.by))} ate ${mine ? 'YOU' : esc(this.nameOf(capture.victim))}</small></div>`;
      el.classList.remove('is-on');
      void el.offsetWidth;
      el.classList.add('is-on');
      document.getElementById('rage-board')?.classList.add('is-shaken');
      setTimeout(() => document.getElementById('rage-board')?.classList.remove('is-shaken'), 450);
      clearTimeout(this._flashT);
      this._flashT = setTimeout(() => el.classList.remove('is-on'), 1500);
    },
    winFlash(s) {
      const el = document.getElementById('rage-flash');
      if (!el) return;
      el.innerHTML = `<div class="rage-sent is-win" style="--seat:${this.colorOf(s.winnerId)}"><b>${s.winnerId === viewerId() ? 'YOU WIN' : esc(s.winnerName)}</b><small>${s.winnerId === viewerId() ? 'ALL FOUR HOME' : 'BROUGHT ALL FOUR HOME'}</small></div>`;
      el.classList.remove('is-on');
      void el.offsetWidth;
      el.classList.add('is-on', 'is-long');
    },

    renderDock() {
      const show = this.chat && this.open && casual();
      const dock = show ? this.ensureDock() : document.getElementById(isGM() ? 'gm-rage-dock' : 'rage-restore');
      if (!dock) return;
      dock.hidden = !show;
      if (!show) return;
      const s = this.state;
      const back = '<em>RETURN</em>';
      let mid = '';
      if (!s) mid = '';
      else if (s.phase === 'lobby') mid = `<span>LOBBY · ${s.members.length}/4</span>`;
      else if (s.phase === 'ended') mid = `<span>${esc(s.winnerName || '')} WINS</span>`;
      else mid = `<span class="${s.you?.yourTurn ? 'is-you' : ''}">${s.you?.yourTurn ? (s.phase === 'roll' ? 'YOUR ROLL' : 'YOUR MOVE') : esc(s.turnName)}</span>${s.phase === 'move' && s.roll ? `<strong>${s.roll}</strong>` : ''}<span class="kal-clock rage-clock" data-deadline="${s.deadline}"></span>`;
      dock.innerHTML = `<b>THY SHALL NOT RAGE</b>${mid}${back}`;
    },

    tickClocks() {
      if (this.open && !casual()) this.leaveCasual();
      document.querySelectorAll('.rage-clock[data-deadline]').forEach(el => {
        const left = Math.max(0, Number(el.dataset.deadline) - (Date.now() + this.skew));
        const sec = Math.ceil(left / 1000);
        el.textContent = `0:${String(sec).padStart(2, '0')}`;
        el.classList.toggle('is-urgent', sec <= 5);
      });
    },

    click(e) {
      const btn = e.target.closest('[data-rage]');
      if (!btn || btn.disabled) return;
      const a = btn.dataset.rage;
      e.preventDefault();
      if (a === 'close') return this.hide();
      if (a === 'chat') return this.toChat();
      if (a === 'game') return this.fromChat();
      if (a === 'create-fun') return this.send({ type: 'rage:create', stake: 0 });
      if (a === 'create-coins') {
        const stake = Math.floor(Number(document.getElementById('rage-stake')?.value) || 0);
        if (stake < 1 || stake > 50) return alert('STAKE MUST BE 1–50 SHADOW COINS');
        return this.send({ type: 'rage:create', stake });
      }
      if (a === 'color') { this.colorDraft = btn.dataset.color; return this.render(false); }
      if (a === 'commit-color') { if (!this.colorDraft) return; btn.disabled = true; return this.send({ type: 'rage:color', color: this.colorDraft }); }
      if (a === 'join') return this.send({ type: 'rage:join' });
      if (a === 'leave') return this.send({ type: 'rage:leave' });
      if (a === 'start') return this.send({ type: 'rage:start' });
      if (a === 'cancel') { if (confirm('CANCEL THIS TABLE?')) this.send({ type: 'rage:cancel' }); return; }
      if (a === 'gm-cancel') { if (confirm('OVERTURN THE BOARD FOR EVERYONE?\n\nAny stakes are returned.')) this.send({ type: 'rage:cancel' }); return; }
      if (a === 'forfeit') { if (confirm('FORFEIT? Your stake stays in the pot.')) this.send({ type: 'rage:leave' }); return; }
      if (a === 'new') return this.send({ type: 'rage:create', stake: this.state?.stake || 0 });
      if (a === 'roll') { btn.disabled = true; return this.send({ type: 'rage:roll', turnSeq: Number(btn.dataset.seq) }); }
      if (a === 'move') {
        document.querySelectorAll('#rage-pieces .is-movable').forEach(p => { p.disabled = true; p.classList.remove('is-movable'); });
        return this.send({ type: 'rage:move', piece: Number(btn.dataset.piece), turnSeq: Number(btn.dataset.seq) });
      }
      if (a === 'invite-open') { document.getElementById('rage-invite')?.remove(); return this.show(); }
      if (a === 'invite-dismiss') { document.getElementById('rage-invite')?.remove(); }
    }
  };

  window.RageGame = Rage;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Rage.init(), { once: true });
  else Rage.init();
})();
