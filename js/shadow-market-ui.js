// SHADOW MARKET UI -- the Little Hero's Shadow Coin terminal.
//   MARKET    buy / upgrade / equip cosmetics (appearance, effect, frame,
//             title) and unlock cosmetic /commands
//   ROULETTE  Shadow Roulette 0-12: optional Shadow Coin wagering
//   DOSSIER   relic showcase, relic catalogue, preview of your dossier
//   LEDGER    the server's transaction history for this account
// The server decides every price, gate and payout (shadow-market.js); this
// file only names items, slots and bets. Opened from the HUD coin chip.
(function () {
  const KIND_LABELS = {
    celebration: 'CORRECT-ANSWER CELEBRATIONS',
    name: 'NAME STYLES',
    sigil: 'SIGILS',
    appearance: 'AVATAR LOOKS',
    effect: 'AVATAR EFFECTS',
    frame: 'FRAMES',
    title: 'TITLES',
    command: 'COSMETIC /COMMANDS',
    card: 'DOSSIER BACKGROUNDS',
    showcase: 'RELIC SHOWCASE'
  };
  const EQUIP_KINDS = new Set(['appearance', 'effect', 'frame', 'title', 'celebration', 'name', 'sigil', 'card']);
  const SIGIL_GLYPHS = { 'sigil-eye': '◉', 'sigil-skull': '☠', 'sigil-crown': '♛', 'sigil-dagger': '†' };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  // Pocket order around the wheel (clockwise from the pointer).
  const WHEEL_ORDER = [0, 7, 2, 9, 4, 1, 10, 5, 8, 3, 6, 12, 11]; // alternates red / black
  const SPIN_MS = 3400;

  const state = {
    open: false,
    tab: 'market',
    data: null,          // last shadow:state payload
    notice: '',
    error: '',
    armedBuy: null,      // itemId awaiting a confirming second click
    armedTimer: null,
    bet: { type: 'red' },
    wager: 1,
    spinArmed: false,    // second click required for large wagers
    spinning: false,
    wheelTurn: 0,
    lastSpin: null,
    pendingState: null,  // state held back until the wheel lands
    returnFocus: null    // element that opened the market; restored on close
  };

  const esc = value => String(value == null ? '' : value)
    .replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = n => {
    const v = Math.round(Number(n || 0) * 10) / 10;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  const signed = n => (Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : '') + fmt(Math.abs(Number(n) || 0));
  const app = () => window.PlayerApp;
  const send = msg => app()?.send(msg);

  function rules() {
    return state.data?.roulette || {
      red: [1, 3, 5, 7, 9, 12], minWager: 0.1, maxWager: 10, confirmAbove: 5,
      payouts: { number: 12, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, trio: 3, quad: 2 },
      trios: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]], quads: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]
    };
  }
  const pocketColor = n => (n === 0 ? 'zero' : rules().red.includes(n) ? 'red' : 'black');

  function ensureRoot() {
    let root = document.getElementById('shadow-market');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'shadow-market';
    root.className = 'smk-overlay';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Shadow Market');
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    return root;
  }

  function open(tab) {
    const root = ensureRoot();
    if (!state.open) state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.open = true;
    if (tab) state.tab = tab;
    state.error = '';
    root.hidden = false;
    document.body.classList.add('smk-open');
    send({ type: 'shadow:state' });
    render();
    requestAnimationFrame(() => root.querySelector('[data-close]')?.focus());
  }

  function close() {
    state.open = false;
    const root = document.getElementById('shadow-market');
    if (root) root.hidden = true;
    document.body.classList.remove('smk-open');
    const target = state.returnFocus;
    state.returnFocus = null;
    if (target?.isConnected && typeof target.focus === 'function') requestAnimationFrame(() => target.focus());
  }

  function onMessage(message) {
    if (message.type === 'shadow:error') {
      state.error = message.message || 'The market refuses.';
      state.spinning = false;
      state.spinArmed = false;
      if (state.pendingState) { state.data = state.pendingState; state.pendingState = null; }
      if (state.open) render();
      return;
    }
    if (message.type === 'shadow:spinResult') {
      landWheel(message);
      return;
    }
    if (message.type === 'shadow:state') {
      // While the wheel turns, hold the new balance back so it cannot spoil
      // the landing.
      if (state.spinning) { state.pendingState = message; return; }
      state.data = message;
      if (message.notice) { state.notice = message.notice; state.error = ''; }
      if (state.open) render();
    }
  }

  // ---------------------------------------------------------------- render
  function selfEntity() {
    const a = app();
    return (a?.currentPlayers || []).find(p => String(p.id) === String(a?.playerId)) || { name: a?.playerName || 'LITTLE HERO' };
  }

  function previewAvatar(item) {
    const a = app();
    if (!a?.littleHeroAvatarHTML) return '';
    const self = selfEntity();
    const cosmetics = { ...(self.cosmetics || {}) };
    if (item.kind === 'appearance') cosmetics.appearance = item.id;
    if (item.kind === 'frame') cosmetics.frame = item.id;
    if (item.kind === 'effect') { cosmetics.effect = item.id; cosmetics.effectTier = Math.max(1, item.tier || 1); }
    // No IKS ring in the preview: strip fighter fields.
    const entity = { id: '', name: self.name, avatarData: self.avatarData, frameColor: self.frameColor, cosmetics };
    return a.littleHeroAvatarHTML(entity, false);
  }

  function itemCard(item, equipped) {
    const owned = item.tier > 0;
    const maxed = item.tier >= item.maxTier;
    const isEquipped = equipped[item.kind] === item.id;
    const visual = item.kind === 'appearance' || item.kind === 'effect' || item.kind === 'frame';
    const tiered = item.maxTier > 1;
    const locked = item.requires && !item.requires.met;
    let status = '';
    if (item.relic) status = owned ? '<span class="smk-tag smk-tag-relic">RELIC // OWNED</span>' : '<span class="smk-tag smk-tag-relic">RELIC // NOT FOR SALE</span>';
    else if (owned && maxed) status = '<span class="smk-tag smk-tag-owned">OWNED</span>';
    else if (owned) status = `<span class="smk-tag smk-tag-owned">TIER ${ROMAN[item.tier]}</span>`;

    const actions = [];
    if (!item.relic && !maxed) {
      if (locked) {
        actions.push(`<button type="button" class="smk-btn smk-btn-locked" disabled>LOCKED // ${esc(item.requires.label)} (${esc(item.requires.progress)}/${esc(item.requires.min)})</button>`);
      } else {
        const armed = state.armedBuy === item.id;
        const verb = owned ? `UPGRADE → ${ROMAN[item.tier + 1]}` : 'BUY';
        const afford = (state.data?.balance || 0) >= item.nextPrice;
        actions.push(`<button type="button" class="smk-btn smk-btn-buy${armed ? ' is-armed' : ''}" data-buy="${esc(item.id)}"${afford ? '' : ' disabled'}>${armed ? `CONFIRM ${fmt(item.nextPrice)} SC` : `${verb} // ${fmt(item.nextPrice)} SC`}</button>`);
      }
    }
    if (owned && EQUIP_KINDS.has(item.kind)) {
      actions.push(isEquipped
        ? `<button type="button" class="smk-btn smk-btn-equipped" data-unequip="${esc(item.kind)}">EQUIPPED // REMOVE</button>`
        : `<button type="button" class="smk-btn smk-btn-equip" data-equip="${esc(item.id)}" data-slot="${esc(item.kind)}">EQUIP</button>`);
    }
    if (owned && item.kind === 'command') actions.push(`<span class="smk-hint">TYPE /${esc(item.command)} IN CHAT</span>`);

    const tierTrack = tiered
      ? `<ol class="smk-tiers">${(item.tierNames || []).map((name, i) => `<li class="${i < item.tier ? 'is-owned' : ''}"><b>${ROMAN[i + 1]}</b> ${esc(name)}</li>`).join('')}</ol>`
      : '';
    const selfName = esc(selfEntity().name || 'LITTLE HERO');
    let preview;
    if (visual) preview = `<div class="smk-preview">${previewAvatar(item)}</div>`;
    else if (item.kind === 'title') preview = `<div class="smk-preview smk-preview-title"><span class="cos-title">${esc(item.name)}</span></div>`;
    else if (item.kind === 'command') preview = item.asset
      ? `<div class="smk-preview smk-preview-art smk-preview-cmd" style="--smk-art:url('${esc(item.asset)}')"><span>/${esc(item.command)}</span></div>`
      : `<div class="smk-preview smk-preview-cmd">/${esc(item.command)}</div>`;
    else if (item.kind === 'name') preview = `<div class="smk-preview smk-preview-name"><span class="cos-name cos-${esc(item.id)}">${selfName}</span></div>`;
    else if (item.kind === 'sigil') {
      const glyph = item.id === 'sigil-coin'
        ? '<span class="cos-sigil cos-sigil-coin"><img src="assets/ui/shadow-coin.webp" alt=""></span>'
        : `<span class="cos-sigil cos-${esc(item.id)}">${SIGIL_GLYPHS[item.id] || ''}</span>`;
      preview = `<div class="smk-preview smk-preview-sigil">${glyph}</div>`;
    } else if (item.kind === 'celebration') preview = item.asset
      ? `<div class="smk-preview smk-preview-art smk-preview-cel cel-demo-${esc(item.id)}" style="--smk-art:url('${esc(item.asset)}')"><span>ANSWER</span></div>`
      : `<div class="smk-preview smk-preview-cel cel-demo-${esc(item.id)}"><span>ANSWER</span></div>`;
    else if (item.kind === 'card') preview = `<div class="smk-preview smk-preview-card dsr-${esc(item.id)}"><span>FILE</span></div>`;
    else preview = `<div class="smk-preview smk-preview-cmd">${item.kind === 'showcase' ? '▣▣▣' : ''}</div>`;
    return `
      <article class="smk-item smk-kind-${esc(item.kind)}${owned ? ' is-owned' : ''}${isEquipped ? ' is-equipped' : ''}${item.relic ? ' is-relic' : ''}">
        ${preview}
        <div class="smk-item-body">
          <div class="smk-item-head"><h4>${esc(item.name)}</h4>${status}</div>
          ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
          ${tierTrack}
          <div class="smk-actions">${actions.join('')}</div>
        </div>
      </article>`;
  }

  function marketHTML() {
    const data = state.data;
    if (!data) return '<div class="smk-empty">CONTACTING THE SHADOW MARKET…</div>';
    const groups = {};
    for (const item of data.catalog) (groups[item.kind] ||= []).push(item);
    return Object.keys(KIND_LABELS).filter(kind => groups[kind]).map(kind => `
      <section class="smk-group">
        <h3>${KIND_LABELS[kind]}</h3>
        <div class="smk-grid">${groups[kind].map(item => itemCard(item, data.equipped || {})).join('')}</div>
      </section>`).join('') + '<p class="smk-rule">SHADOW COIN BUYS APPEARANCE, EXPRESSION AND PRESTIGE. IT NEVER BUYS COMPETENCE.</p>';
  }

  // DOSSIER tab: relic catalogue with earn progress + showcase selection.
  function dossierTabHTML() {
    const data = state.data;
    if (!data) return '<div class="smk-empty">CONTACTING THE SHADOW MARKET…</div>';
    const relics = data.catalog.filter(item => item.relic);
    const showcase = data.showcase || [];
    const slots = data.showcaseSlots || 1;
    const full = showcase.length >= slots;
    const cards = relics.map(item => {
      const owned = item.tier > 0;
      const shown = showcase.includes(item.id);
      const progress = item.earn && item.earn.min
        ? `<div class="smk-progress"><i style="width:${Math.round(100 * (item.earn.progress || 0) / item.earn.min)}%"></i><span>${esc(item.earn.progress || 0)} / ${esc(item.earn.min)}</span></div>`
        : '';
      const how = item.earn ? item.earn.label : 'Granted by the Shadow Broker';
      const action = !owned
        ? '<span class="smk-hint smk-hint-locked">SEALED</span>'
        : shown
          ? `<button type="button" class="smk-btn smk-btn-equipped" data-showcase-remove="${esc(item.id)}">ON DISPLAY // REMOVE</button>`
          : `<button type="button" class="smk-btn smk-btn-equip" data-showcase-add="${esc(item.id)}"${full ? ' disabled title="All showcase slots are full"' : ''}>DISPLAY</button>`;
      return `
        <article class="smk-item smk-relic${owned ? ' is-owned' : ' is-sealed'}${shown ? ' is-equipped' : ''}">
          <div class="smk-preview smk-preview-relic${item.asset ? ' smk-preview-art' : ''}"${item.asset ? ` style="--smk-art:url('${esc(owned ? item.asset : 'assets/shop/relic-sealed.png')}')"` : ''}>${owned ? '✦' : '?'}</div>
          <div class="smk-item-body">
            <div class="smk-item-head"><h4>${esc(item.name)}</h4>${owned ? '<span class="smk-tag smk-tag-relic">UNEARTHED</span>' : ''}</div>
            <p>${esc(owned ? item.desc : how)}</p>
            ${owned ? '' : progress}
            <div class="smk-actions">${action}</div>
          </div>
        </article>`;
    }).join('');
    return `
      <div class="smk-dossier-bar">
        <span>SHOWCASE <b>${showcase.length} / ${slots}</b> SLOTS</span>
        <button type="button" class="smk-btn" data-preview-dossier>PREVIEW MY DOSSIER</button>
      </div>
      <p class="smk-fine">RELICS ARE EARNED, NEVER SOLD. BUY MORE SHOWCASE SLOTS AND DOSSIER BACKGROUNDS IN THE MARKET. OTHERS OPEN YOUR DOSSIER BY CLICKING YOUR NAME IN CHAT.</p>
      <section class="smk-group"><h3>RELICS</h3><div class="smk-grid">${cards}</div></section>`;
  }

  function wheelHTML() {
    const seg = 360 / WHEEL_ORDER.length;
    const stops = WHEEL_ORDER.map((n, i) => {
      const color = n === 0 ? 'var(--smk-zero)' : pocketColor(n) === 'red' ? 'var(--smk-red)' : 'var(--smk-black)';
      return `${color} ${(i * seg).toFixed(3)}deg ${((i + 1) * seg).toFixed(3)}deg`;
    }).join(',');
    const labels = WHEEL_ORDER.map((n, i) => `<span class="smk-pocket" style="--a:${(i * seg + seg / 2).toFixed(3)}deg">${n}</span>`).join('');
    return `
      <div class="smk-wheel-wrap">
        <div class="smk-wheel-pointer" aria-hidden="true"></div>
        <div class="smk-wheel" id="smk-wheel" style="background:conic-gradient(${stops});transform:rotate(${state.wheelTurn}deg)">
          ${labels}
          <div class="smk-wheel-hub"><img src="assets/ui/shadow-coin.webp" alt=""></div>
        </div>
      </div>`;
  }

  function betKey(bet) { return `${bet.type}:${bet.value ?? ''}`; }
  function betLabel(bet) {
    const r = rules();
    if (bet.type === 'number') return `NUMBER ${bet.value}`;
    if (bet.type === 'trio') return `GROUP ${r.trios[bet.value].join('-')}`;
    if (bet.type === 'quad') return `GROUP ${r.quads[bet.value].join('-')}`;
    if (bet.type === 'low') return 'LOW 1-6';
    if (bet.type === 'high') return 'HIGH 7-12';
    return bet.type.toUpperCase();
  }

  function rouletteHTML() {
    const r = rules();
    const balance = state.data?.balance ?? 0;
    const current = betKey(state.bet);
    const btn = (bet, text, cls = '') =>
      `<button type="button" class="smk-bet ${cls}${betKey(bet) === current ? ' is-selected' : ''}" data-bet='${esc(JSON.stringify(bet))}'>${text}</button>`;
    const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      .map(n => btn({ type: 'number', value: n }, n, `smk-num smk-num-${pocketColor(n)}`)).join('');
    const outside = [['red', 'RED'], ['black', 'BLACK'], ['odd', 'ODD'], ['even', 'EVEN'], ['low', 'LOW 1-6'], ['high', 'HIGH 7-12']]
      .map(([type, text]) => btn({ type }, text, `smk-out smk-out-${type}`)).join('');
    const trios = r.trios.map((g, i) => btn({ type: 'trio', value: i }, g.join('-'), 'smk-grp')).join('');
    const quads = r.quads.map((g, i) => btn({ type: 'quad', value: i }, g.join('-'), 'smk-grp')).join('');
    const odds = r.payouts[state.bet.type];
    const wager = state.wager;
    const big = wager > r.confirmAbove;
    const canSpin = !state.spinning && wager >= r.minWager && wager <= r.maxWager && wager <= balance;
    const last = state.lastSpin;
    const result = last ? `
      <div class="smk-result smk-result-${last.outcome.won ? 'win' : 'loss'} smk-pocket-${esc(last.outcome.color)}">
        <strong>${esc(last.outcome.pocket)}</strong>
        <em>${esc(last.outcome.line)}</em>
        <b>${signed(last.net)} SC</b>
      </div>` : `<div class="smk-result smk-result-idle"><em>PLACE A WAGER. THE WHEEL IS PATIENT.</em></div>`;
    return `
      <div class="smk-roulette">
        <div class="smk-roulette-stage">${wheelHTML()}${state.spinning ? '<div class="smk-result smk-result-idle"><em>THE WHEEL TURNS…</em></div>' : result}</div>
        <div class="smk-board">
          <h3>BET</h3>
          <div class="smk-numbers">${numbers}</div>
          <div class="smk-outside">${outside}</div>
          <div class="smk-groups"><span>3-GROUP · 3:1</span>${trios}</div>
          <div class="smk-groups"><span>4-GROUP · 2:1</span>${quads}</div>
          <h3>WAGER</h3>
          <div class="smk-wager">
            <button type="button" class="smk-step" data-wager-step="-1" aria-label="Lower wager">−</button>
            <input id="smk-wager-input" type="number" min="${r.minWager}" max="${r.maxWager}" step="0.1" value="${fmt(wager)}" inputmode="decimal">
            <button type="button" class="smk-step" data-wager-step="1" aria-label="Raise wager">+</button>
            ${[1, 2, 5, 10].map(v => `<button type="button" class="smk-chip${wager === v ? ' is-selected' : ''}" data-wager="${v}">${v}</button>`).join('')}
          </div>
          <div class="smk-slip">
            <span>${esc(betLabel(state.bet))}</span>
            <span>WAGER <b>${fmt(wager)} SC</b></span>
            <span>PAYS <b>${odds}:1</b></span>
            <span>WIN RETURNS <b>${fmt(wager * (odds + 1))} SC</b></span>
          </div>
          <p class="smk-fine">0 IS THE HOUSE NUMBER. IT DEFEATS EVERY BET EXCEPT A STRAIGHT 0. MAX ${fmt(r.maxWager)} SC PER SPIN. WAGERS ABOVE ${fmt(r.confirmAbove)} SC REQUIRE CONFIRMATION.</p>
          <button type="button" class="smk-spin${state.spinArmed ? ' is-armed' : ''}" data-spin${canSpin ? '' : ' disabled'}>
            ${state.spinning ? 'SPINNING…' : state.spinArmed ? `CONFIRM ${fmt(wager)} SC SPIN` : big ? `SPIN // ${fmt(wager)} SC (CONFIRM)` : `SPIN // ${fmt(wager)} SC`}
          </button>
        </div>
      </div>`;
  }

  function ledgerHTML() {
    const rows = state.data?.ledger || [];
    if (!rows.length) return '<div class="smk-empty">NO TRANSACTIONS ON RECORD. YET.</div>';
    return `
      <table class="smk-ledger">
        <thead><tr><th>WHEN</th><th>ENTRY</th><th class="num">CHANGE</th><th class="num">BALANCE</th></tr></thead>
        <tbody>${rows.map(row => {
          const when = new Date(row.at);
          const stamp = isNaN(when) ? '' : when.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `<tr class="smk-kind-${esc(row.kind)}"><td>${esc(stamp)}</td><td>${esc(String(row.reason || row.kind).toUpperCase())}</td><td class="num ${row.delta >= 0 ? 'pos' : 'neg'}">${signed(row.delta)}</td><td class="num">${fmt(row.balance)}</td></tr>`;
        }).join('')}</tbody>
      </table>
      <p class="smk-fine">THE LAST 40 ENTRIES. EVERY REWARD, PENALTY, PURCHASE AND SPIN IS RECORDED SERVER-SIDE.</p>`;
  }

  function render() {
    const root = ensureRoot();
    const balance = state.data ? fmt(state.data.balance) : '…';
    const tab = (id, text) => `<button type="button" class="smk-tab${state.tab === id ? ' is-active' : ''}" data-tab="${id}">${text}</button>`;
    const body = state.tab === 'roulette' ? rouletteHTML() : state.tab === 'ledger' ? ledgerHTML() : state.tab === 'dossier' ? dossierTabHTML() : marketHTML();
    const scroll = root.querySelector('.smk-body')?.scrollTop || 0;
    root.innerHTML = `
      <div class="smk-panel">
        <header class="smk-head">
          <div>
            <h2>SHADOW MARKET</h2>
            <small>COSMETIC EXCHANGE // NO REFUNDS // NO ADVANTAGES</small>
          </div>
          <div class="smk-balance"><img src="assets/ui/shadow-coin.webp" alt=""><b>${balance}</b><span>SC</span></div>
          <button type="button" class="smk-close" data-close aria-label="Close Shadow Market">CLOSE</button>
        </header>
        <nav class="smk-tabs">${tab('market', 'MARKET')}${tab('roulette', 'SHADOW ROULETTE')}${tab('dossier', 'DOSSIER')}${tab('ledger', 'LEDGER')}</nav>
        ${state.error ? `<div class="smk-flash smk-flash-error">${esc(state.error)}</div>` : state.notice ? `<div class="smk-flash">${esc(state.notice)}</div>` : ''}
        <div class="smk-body">${body}</div>
      </div>`;
    const bodyEl = root.querySelector('.smk-body');
    if (bodyEl) bodyEl.scrollTop = scroll;
  }

  // ---------------------------------------------------------------- actions
  function onClick(event) {
    const t = event.target;
    if (t === event.currentTarget || t.closest('[data-close]')) return close();
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn) { state.tab = tabBtn.dataset.tab; state.error = ''; state.notice = ''; return render(); }

    const buy = t.closest('[data-buy]');
    if (buy && !buy.disabled) {
      const id = buy.dataset.buy;
      clearTimeout(state.armedTimer);
      if (state.armedBuy === id) {
        state.armedBuy = null;
        state.error = '';
        send({ type: 'shadow:buy', itemId: id });
      } else {
        state.armedBuy = id;
        state.armedTimer = setTimeout(() => { state.armedBuy = null; if (state.open) render(); }, 4000);
      }
      return render();
    }
    const equip = t.closest('[data-equip]');
    if (equip) return send({ type: 'shadow:equip', slot: equip.dataset.slot, itemId: equip.dataset.equip });
    const addRelic = t.closest('[data-showcase-add]');
    if (addRelic && !addRelic.disabled) return send({ type: 'shadow:showcase', itemIds: [...(state.data?.showcase || []), addRelic.dataset.showcaseAdd] });
    const removeRelic = t.closest('[data-showcase-remove]');
    if (removeRelic) return send({ type: 'shadow:showcase', itemIds: (state.data?.showcase || []).filter(id => id !== removeRelic.dataset.showcaseRemove) });
    if (t.closest('[data-preview-dossier]')) return window.ShadowCosmetics?.openDossier(app()?.playerId);
    const unequip = t.closest('[data-unequip]');
    if (unequip) return send({ type: 'shadow:equip', slot: unequip.dataset.unequip, itemId: null });

    const bet = t.closest('[data-bet]');
    if (bet && !state.spinning) {
      try { state.bet = JSON.parse(bet.dataset.bet); } catch (_) { /* ignore */ }
      state.spinArmed = false;
      return render();
    }
    const chip = t.closest('[data-wager]');
    if (chip && !state.spinning) { setWager(Number(chip.dataset.wager)); return render(); }
    const step = t.closest('[data-wager-step]');
    if (step && !state.spinning) {
      const delta = Number(step.dataset.wagerStep);
      setWager(state.wager + (state.wager < 1 || (state.wager === 1 && delta < 0) ? 0.1 : 1) * delta);
      return render();
    }
    const spin = t.closest('[data-spin]');
    if (spin && !spin.disabled) return doSpin();
  }

  function onInput(event) {
    if (event.target.id !== 'smk-wager-input') return;
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      state.wager = Math.round(Math.min(rules().maxWager, Math.max(0, value)) * 10) / 10;
      state.spinArmed = false;
      const slip = document.querySelector('#shadow-market .smk-slip');
      if (slip) {
        // Refresh the slip and spin button without stealing input focus.
        const odds = rules().payouts[state.bet.type];
        slip.children[1].innerHTML = `WAGER <b>${fmt(state.wager)} SC</b>`;
        slip.children[3].innerHTML = `WIN RETURNS <b>${fmt(state.wager * (odds + 1))} SC</b>`;
        const spinBtn = document.querySelector('#shadow-market [data-spin]');
        const r = rules();
        const ok = state.wager >= r.minWager && state.wager <= r.maxWager && state.wager <= (state.data?.balance || 0);
        if (spinBtn) {
          spinBtn.disabled = !ok;
          spinBtn.textContent = state.wager > r.confirmAbove ? `SPIN // ${fmt(state.wager)} SC (CONFIRM)` : `SPIN // ${fmt(state.wager)} SC`;
        }
      }
    }
  }

  function setWager(value) {
    const r = rules();
    state.wager = Math.round(Math.min(r.maxWager, Math.max(r.minWager, value)) * 10) / 10;
    state.spinArmed = false;
  }

  function doSpin() {
    const r = rules();
    if (state.wager > r.confirmAbove && !state.spinArmed) {
      state.spinArmed = true;
      return render();
    }
    state.spinArmed = false;
    state.spinning = true;
    state.error = '';
    state.notice = '';
    state.lastSpin = null;
    render();
    send({ type: 'shadow:spin', bet: state.bet, wager: state.wager, confirm: state.wager > r.confirmAbove });
  }

  function landWheel(message) {
    const pocket = Number(message.outcome?.pocket);
    const seg = 360 / WHEEL_ORDER.length;
    const index = Math.max(0, WHEEL_ORDER.indexOf(pocket));
    // Pointer sits at the top: rotate so the pocket's centre lands under it.
    const target = 360 - (index * seg + seg / 2);
    const base = Math.ceil(state.wheelTurn / 360) * 360;
    state.wheelTurn = base + 360 * 4 + target;
    const wheel = document.getElementById('smk-wheel');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (wheel) {
      wheel.style.transition = reduced ? 'none' : `transform ${SPIN_MS}ms cubic-bezier(.12,.72,.16,1)`;
      wheel.style.transform = `rotate(${state.wheelTurn}deg)`;
    }
    setTimeout(() => {
      state.spinning = false;
      state.lastSpin = message;
      if (state.pendingState) { state.data = state.pendingState; state.pendingState = null; }
      if (state.open) render();
      const w = document.getElementById('smk-wheel');
      if (w) w.style.transition = 'none';
    }, reduced ? 50 : SPIN_MS + 80);
  }

  // The in-room HUD coin chip opens the market.
  document.addEventListener('click', event => {
    if (event.target.closest('#hero-hud-coins-chip')) open('market');
  });
  document.addEventListener('keydown', event => {
    if (state.open && event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (state.open && event.key === 'Tab') {
      const root = document.getElementById('shadow-market');
      const focusable = root ? [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && el.offsetParent !== null) : [];
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!root.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.id === 'hero-hud-coins-chip') {
      event.preventDefault();
      open('market');
    }
  });

  window.ShadowMarketUI = { open, close, onMessage };
})();
