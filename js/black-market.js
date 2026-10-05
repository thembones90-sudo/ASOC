(function () {
  'use strict';

  const isGM = !!window.App;
  // The player global is window.PlayerApp (see js/player.js). This module reached
  // for window.Player, which has never existed in this codebase, so on the
  // player side `host` was undefined and the module returned before install():
  // the BLACK MARKET entry button rendered (it is static markup in join.html)
  // but nothing was ever wired to it, and every offer-tribute path was dead
  // code. That is why the submission looked like a no-op from the outside.
  const host = isGM ? window.App : window.PlayerApp;
  if (!host) return;

  const STATE_LABEL = {
    SUBMITTED: 'THE BROKER WEIGHS YOUR OFFERING',
    COUNTEROFFERED: 'THE TERMS HAVE BEEN REWRITTEN',
    APPROVED_PENDING_TRIBUTE: 'BLOOD TRIBUTE REQUIRED',
    TRIBUTE_SUBMITTED: 'THE OFFERING AWAITS JUDGMENT',
    TRIBUTE_REJECTED: 'THE OFFERING WAS DENIED',
    OWED: 'A DEBT IS RECORDED',
    IN_PROGRESS: 'THE DEBT IS BEING HONORED',
    FULFILLED: 'THE PACT IS FULFILLED',
    DENIED: 'THE PETITION IS DENIED',
    BROKEN: 'THE PACT IS BROKEN'
  };

  // Tribute bytes travel through the authenticated binary upload route. The
  // socket only carries the resulting short, single-use claim URL, avoiding
  // base64 inflation and the WebSocket frame ceiling entirely.
  const TRIBUTE_MAX_BYTES = 20 * 1024 * 1024;
  const TRIBUTE_MIME = ['image/png', 'image/jpeg', 'image/webp'];

  const ui = {
    pacts: [],
    // Returns the underlying send() result. PlayerApp.send answers true when the
    // frame left and false when the socket is down; the old wrapper threw that
    // answer away, so a submission into a dead socket was indistinguishable
    // from a successful one.
    send(payload) { return host.send?.(payload); },
    install() {
      let button = document.getElementById(isGM ? 'black-market-gm-button' : 'black-market-player-button');
      if (!button) {
        button = document.createElement('button');
        button.id = 'black-market-player-button';
        button.className = 'black-market-entry';
        button.hidden = true;
        button.innerHTML = '<span>BLACK MARKET</span><small>PRIVATE CHANNEL</small>';
        document.body.appendChild(button);
      }
      if (!isGM) button.hidden = false;
      button.addEventListener('click', () => {
        button.classList.add('bm-opening');
        setTimeout(() => button.classList.remove('bm-opening'), 420);
        setTimeout(() => this.open(), 145);
      });
      this.wrapMessages();
      setTimeout(() => this.send({ type: 'blackMarket:sync' }), 500);
    },
    wrapMessages() {
      if (host._blackMarketWrapped) return;
      const method = isGM ? 'handleServerMessage' : 'handleMessage';
      if (typeof host[method] !== 'function') return;
      const original = host[method].bind(host);
      host[method] = message => {
        if (message?.type === 'blackMarket:state' || message?.type === 'blackMarket:gmState') {
          if (!window.AsocRuntime?.acceptRevision?.(isGM ? 'black-market-gm' : 'black-market-player', message.revision) && window.AsocRuntime) return;
          this.pacts = Array.isArray(message.pacts) ? message.pacts : [];
          if (!isGM && this._tributeAwaitingPactId) {
            const submitted = this.pacts.find(p => p.id === this._tributeAwaitingPactId && p.state === 'TRIBUTE_SUBMITTED');
            if (submitted) this.confirmTributeSubmission();
          }
          if (isGM) {
            const entry = document.getElementById('black-market-gm-button');
            const hasPending = this.pacts.some(p => ['SUBMITTED','TRIBUTE_SUBMITTED'].includes(p.state));
            if (entry) entry.classList.toggle('bm-has-pending', hasPending);
          }
          if (!isGM) {
            const entry = document.getElementById('black-market-player-button');
            if (entry) entry.hidden = false;
          }
          if (document.getElementById('black-market-overlay')) this.render();
          this.updateBadge();
          return;
        }
        if (!isGM && message?.type === 'blackMarket:tributeDemanded') {
          this.showDemandNotice(message.pact || null);
          if (message.pact?.id) {
            const requestId = `bm-seen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
            this.send({ type: 'blackMarket:tributeSeen', pactId: message.pact.id, requestId });
          }
          this.send({ type: 'blackMarket:sync' });
          return;
        }
        if (message?.type === 'blackMarket:error') {
          window.AsocRuntime?.record?.('transaction-rejected', message.message || 'BLACK MARKET ERROR', message.requestId || 'black-market');
          if (this._tributeAwaitingPactId || this._tributeBusy) {
            this.releaseTribute();
            if (document.getElementById('black-market-overlay')) this.render();
            this.send({ type: 'blackMarket:sync' });
          }
          this.toast(message.message || 'THE PACT REJECTS YOUR HAND');
          return;
        }
        if (message?.type === 'blackMarket:ack') {
          window.AsocRuntime?.record?.('transaction-persisted', message.action || 'BLACK MARKET', `${message.pactId || ''} ${message.state || ''}`);
          if (message.action === 'blackMarket:tributeSubmit' && message.pactId === this._tributeAwaitingPactId && message.state === 'TRIBUTE_SUBMITTED') this.confirmTributeSubmission();
          return;
        }
        const result = original(message);
        if (!isGM && message?.type === 'join:success') {
          const entry = document.querySelector('.black-market-entry');
          if (entry) entry.hidden = false;
          setTimeout(() => this.send({ type: 'blackMarket:sync' }), 80);
        }
        return result;
      };
      host._blackMarketWrapped = true;
    },
    updateBadge() {
      const btn = document.getElementById(isGM ? 'black-market-gm-button' : 'black-market-player-button');
      if (!btn) return;
      const actionable = this.pacts.filter(p => isGM
        ? ['SUBMITTED','TRIBUTE_SUBMITTED'].includes(p.state)
        : ['COUNTEROFFERED','APPROVED_PENDING_TRIBUTE','TRIBUTE_REJECTED'].includes(p.state)
      );
      const pending = actionable.length;
      btn.classList.toggle('has-pending', pending > 0);
      if (isGM) btn.classList.toggle('bm-has-pending', pending > 0);
      btn.dataset.pending = pending || '';
      if (isGM) {
        const subtitle = btn.querySelector('small');
        const bloodAwaits = actionable.some(p => p.state === 'TRIBUTE_SUBMITTED');
        if (subtitle) subtitle.textContent = bloodAwaits ? 'BLOOD TRIBUTE AWAITS' : pending ? 'PETITION AWAITS' : 'PRIVATE CHANNEL';
        btn.setAttribute('aria-label', bloodAwaits ? `Black Market: ${pending} pending, Blood Tribute awaits judgment` : pending ? `Black Market: ${pending} petition awaiting judgment` : 'Black Market private channel');
      }
    },
    open() {
      if (!document.getElementById('black-market-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'black-market-overlay';
        overlay.className = 'black-market-overlay is-sanctum';
        // Both sides of the market are a blood sanctum: rune bands, corner
        // sigils, a turning seal behind the title and blood along the rim.
        const shrine = '<i class="bm-drips" aria-hidden="true"></i><i class="bm-corner tl" aria-hidden="true"></i><i class="bm-corner tr" aria-hidden="true"></i><i class="bm-corner bl" aria-hidden="true"></i><i class="bm-corner br" aria-hidden="true"></i><i class="bm-sigil" aria-hidden="true"></i>';
        const runes = '<div class="bm-runeband" aria-hidden="true"></div>';
        overlay.innerHTML = '<div class="black-market-void"></div><section class="black-market-room" role="dialog" aria-modal="true">' + shrine + '<header><div><small>' + (isGM ? 'SANCTUM OF DEBTS // SHADOW BROKER' : 'CHAMBER OF PETITIONS // SHADOW BROKER') + '</small><h2>BLACK MARKET</h2></div><button type="button" data-bm-close>×</button></header>' + runes + '<div id="black-market-body"></div>' + runes + '</section>';
        overlay.querySelector('[data-bm-close]').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
      }
      this.send({ type: 'blackMarket:sync' });
      this.render();
    },
    render() {
      const body = document.getElementById('black-market-body');
      if (!body) return;
      body.innerHTML = isGM ? this.renderGm() : this.renderPlayer();
      this.bindActions(body);
    },
    renderPlayer() {
      const active = this.pacts.find(p => !['FULFILLED','DENIED','BROKEN'].includes(p.state));
      const ledger = this.pacts.map(p => this.card(p, false)).join('') || '<p class="bm-empty">NO PACTS HAVE BEEN WRITTEN.</p>';
      const petition = active ? '' : '<form id="bm-petition" class="bm-petition"><label>TITLE<input name="title" maxlength="120" placeholder="Name the favor"></label><label>CATEGORY<select name="category"><option>DESIGN</option><option>WRITING</option><option>TECH</option><option>RESEARCH</option><option>CUSTOM</option></select></label><label>YOUR PETITION<textarea name="request" maxlength="1200" required placeholder="State what you ask of the Shadow Broker."></textarea></label><button type="submit">BIND THE REQUEST</button></form>';
      return '<div class="bm-intro"><i class="bm-wax" aria-hidden="true"></i><b>PETITION THE BROKER</b><p>This chamber belongs to you alone. No other Little Hero sees what is written here.</p></div>' + petition + '<h3>LEDGER OF PACTS</h3><div class="bm-ledger">' + ledger + '</div>';
    },
    renderGm() {
      const pending = this.pacts.filter(p => ['SUBMITTED','TRIBUTE_SUBMITTED'].includes(p.state));
      // Finished pacts (fulfilled, denied, broken) leave the Shadow Broker's
      // ledger the moment they are judged: only open debts remain.
      const rest = this.pacts.filter(p => !['SUBMITTED','TRIBUTE_SUBMITTED','FULFILLED','DENIED','BROKEN'].includes(p.state));
      const history = this.pacts.filter(p => ['FULFILLED','DENIED','BROKEN'].includes(p.state) && p.tributeRequired);
      const online = (host.currentPlayers || []).filter(player => player?.connected === true);
      const playerOptions = online.map(player => '<option value="' + this.esc(player.id) + '">' + this.esc(player.name || 'LITTLE HERO') + '</option>').join('');
      const levelOptions = Array.from({length:10}, (_,i) => '<option value="' + (i+1) + '">LEVEL ' + (i+1) + '</option>').join('');
      const collector = '<form id="bm-demand-tribute" class="bm-demand-tribute"><label>DEBTOR<select name="playerId" required>' + (playerOptions || '<option value="">NO LITTLE HEROES ONLINE</option>') + '</select></label><label>TRIBUTE LEVEL<select name="tributeLevel" required>' + levelOptions + '</select></label><label>CAUSE OF DEBT<input name="reason" maxlength="1200" placeholder="Lost wager, broken pact, failed challenge?"></label><button type="submit"' + (playerOptions ? '' : ' disabled') + '>BLOOD TRIBUTE REQUIRED</button></form>';
      return '<div class="bm-intro"><i class="bm-wax" aria-hidden="true"></i><b>SEALED PETITIONS</b><p>Each chamber terminates here. Nothing below is broadcast to the room.</p></div><h3>CALL A DEBT</h3>' + collector + '<h3>AWAITING JUDGMENT</h3><div class="bm-ledger">' + (pending.map(p => this.card(p, true)).join('') || '<p class="bm-empty">THE MARKET SLEEPS.</p>') + '</div><h3>LEDGER OF PACTS</h3><div class="bm-ledger">' + (rest.map(p => this.card(p, true)).join('') || '<p class="bm-empty">NO OPEN DEBTS.</p>') + '</div><h3>TRIBUTE HISTORY</h3><div class="bm-ledger">' + (history.map(p => this.card(p, true)).join('') || '<p class="bm-empty">NO CLOSED TRIBUTES.</p>') + '</div>';
    },
    card(p, gm) {
      const tributeSource = p.tributeImageUrl || p.tributeImageData || '';
      const image = gm && p.state === 'TRIBUTE_SUBMITTED' && tributeSource ? '<img class="bm-tribute-preview" src="' + this.esc(tributeSource) + '" alt="Private Blood Tribute">' : '';
      const tributeLevel = Math.max(1, Math.min(10, Number(p.tributeLevel) || 1));
      const meter = p.tributeRequired ? '<div class="bm-tribute-meter" aria-label="Blood Tribute level ' + tributeLevel + ' of 10">' + Array.from({ length: 10 }, (_, i) => '<i class="' + (i < tributeLevel ? 'is-lit' : '') + '"></i>').join('') + '</div>' : '';
      const level = p.tributeRequired ? '<div class="bm-tribute-level"><span>BLOOD TRIBUTE</span><b>LEVEL ' + tributeLevel + ' / 10</b>' + meter + '</div>' : '';
      const tracking = gm && p.tributeRequired && p.demandedAt ? '<div class="bm-delivery"><span class="bm-receipt is-sent"><i aria-hidden="true">↗</i><span><b>SENT</b><small>' + this.esc(this.fmtTime(p.demandedAt)) + '</small></span></span><span class="bm-receipt ' + (p.seenAt ? 'is-seen' : 'is-unseen') + '"><i aria-hidden="true">◉</i><span><b>' + (p.seenAt ? 'SEEN' : 'NOT SEEN') + '</b><small>' + (p.seenAt ? this.esc(this.fmtTime(p.seenAt)) : 'Awaiting player receipt') + '</small></span></span></div>' : '';
      const terms = p.terms ? '<section class="bm-terms"><div class="bm-terms-title">TERMS OF TRIBUTE</div><blockquote>' + this.esc(p.terms) + '</blockquote></section>' : '';
      return '<article class="bm-pact is-' + this.esc(String(p.state || '').toLowerCase()) + '" data-state="' + this.esc(p.state) + '" data-pact="' + this.esc(p.id) + '"><div class="bm-pact-sigil" aria-hidden="true"></div><div class="bm-pact-head"><div><small>' + this.esc(p.category) + (gm ? ' // ' + this.esc(p.playerName) : '') + '</small><b>' + this.esc(p.title) + '</b></div><span>' + this.esc(STATE_LABEL[p.state] || p.state) + '</span></div>' + level + tracking + '<p class="bm-pact-request">' + this.esc(p.request) + '</p>' + terms + (p.rejectionReason ? '<em>' + this.esc(p.rejectionReason) + '</em>' : '') + image + this.actions(p, gm) + '</article>';
    },
    actions(p, gm) {
      if (gm) {
        if (p.state === 'SUBMITTED') return '<div class="bm-actions"><button data-act="accept">SEAL THE PACT</button><button data-act="waive">WAIVE THE DEBT</button><button data-act="counter">REWRITE THE TERMS</button><button data-act="deny">DENY THE PETITION</button></div>';
        if (p.state === 'TRIBUTE_SUBMITTED') return '<div class="bm-actions"><button data-act="tribute-accept">ACCEPT BLOOD TRIBUTE</button><button data-act="tribute-reject">REJECT BLOOD TRIBUTE</button></div>';
        if (p.state === 'OWED') return '<div class="bm-actions"><button data-act="progress">HONOR THE DEBT</button><button data-act="fulfill">FULFILL THE PACT</button><button data-act="break">BREAK THE PACT</button></div>';
        if (p.state === 'IN_PROGRESS') return '<div class="bm-actions"><button data-act="fulfill">FULFILL THE PACT</button><button data-act="break">BREAK THE PACT</button></div>';
        return '';
      }
      if (p.state === 'COUNTEROFFERED') return '<div class="bm-actions"><button data-act="accept-counter">ACCEPT REWRITTEN TERMS</button></div>';
      if (p.id === this._tributeAwaitingPactId) return '<div class="bm-actions"><button type="button" disabled>SEALING THE OFFERING…</button></div>';
      if (['APPROVED_PENDING_TRIBUTE','TRIBUTE_REJECTED'].includes(p.state)) return '<div class="bm-actions"><button data-act="offer-tribute">OFFER BLOOD TRIBUTE</button></div>';
      return '';
    },
    bindActions(body) {
      body.querySelector('#bm-demand-tribute')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const playerId = String(fd.get('playerId') || '');
        const reason = String(fd.get('reason') || '').trim();
        const tributeLevel = Math.max(1, Math.min(10, Number(fd.get('tributeLevel')) || 1));
        if (!playerId) return this.toast('NO LITTLE HERO SELECTED');
        const requestId = `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
        this.send({ type:'blackMarket:gmDemandTribute', playerId, reason, tributeLevel, requestId });
        this.toast('THE DEBT HAS BEEN CALLED');
      });
      body.querySelector('#bm-petition')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        this.send({ type:'blackMarket:petition', title:fd.get('title'), category:fd.get('category'), request:fd.get('request') });
      });
      body.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
        const pactId = btn.closest('[data-pact]')?.dataset.pact;
        const act = btn.dataset.act;
        if (act === 'accept-counter') return this.send({ type:'blackMarket:acceptCounter', pactId });
        if (act === 'offer-tribute') return this.offerTribute(pactId, btn);
        if (act === 'tribute-accept') return this.send({ type:'blackMarket:tributeJudge', pactId, accepted:true });
        if (act === 'tribute-reject') {
          const reason = await window.AsocDialog.prompt({
            title:'DENY BLOOD TRIBUTE',
            message:'Tell the Little Hero why. They will see this reason.',
            placeholder:'e.g. Not bloody enough. Try again.',
            maxLength:200,
            required:true,
            confirmLabel:'DENY'
          });
          if (!reason?.trim()) return;
          return this.send({ type:'blackMarket:tributeJudge', pactId, accepted:false, reason:reason.trim() });
        }
        if (act === 'accept') {
          btn.disabled = true;
          return this.send({ type:'blackMarket:gmDecision', pactId, action:'accept', terms:'', tributeRequired:true });
        }
        if (act === 'waive') {
          btn.disabled = true;
          return this.send({ type:'blackMarket:gmDecision', pactId, action:'waive', terms:'', tributeRequired:false });
        }
        if (act === 'counter') {
          const terms = await window.AsocDialog.prompt({ title:'REWRITE THE TERMS OF THE PACT', required:true, confirmLabel:'COUNTER' });
          if (!terms?.trim()) return;
          btn.disabled = true;
          return this.send({ type:'blackMarket:gmDecision', pactId, action:'counter', terms:terms.trim(), tributeRequired:true });
        }
        if (act === 'deny') {
          const terms = await window.AsocDialog.prompt({ title:'REASON FOR DENIAL', message:'Optional.', confirmLabel:'DENY' }) || '';
          btn.disabled = true;
          return this.send({ type:'blackMarket:gmDecision', pactId, action:'deny', terms, tributeRequired:false });
        }
        btn.disabled = true;
        this.send({ type:'blackMarket:gmDecision', pactId, action:act, terms:'', tributeRequired:false });
      }));
    },
    showDemandNotice(pact) {
      document.getElementById('bm-demand-notice')?.remove();
      const veil = document.createElement('div');
      veil.id = 'bm-demand-notice';
      veil.className = 'bm-demand-notice';
      const reason = this.esc(pact?.request || 'The Shadow Broker has called your debt.');
      const level = Math.max(1, Math.min(10, Number(pact?.tributeLevel) || 1));
      veil.innerHTML = '<section class="bm-demand-notice-card" role="alertdialog" aria-modal="true"><small>BLACK MARKET // DEBT CALLED</small><h2>BLOOD TRIBUTE REQUIRED</h2><div class="bm-demand-level">LEVEL ' + level + ' / 10</div><p>' + reason + '</p><b>YOUR ACCOUNT HAS COME DUE.</b><button type="button" data-bm-pay-debt>ENTER THE BLACK MARKET</button></section>';
      veil.querySelector('[data-bm-pay-debt]')?.addEventListener('click', () => { veil.remove(); this.open(); });
      document.body.appendChild(veil);
    },

    // One hidden file input, mounted once and reused. A fresh input per click
    // leaked a node on every attempt, and a detached input is exactly the kind
    // of thing the desktop shell will refuse to open a picker for.
    _tributeInput: null,
    _tributePactId: null,
    _tributeBusy: false,
    _tributeButton: null,
    _tributePickerTimer: null,
    _tributeFocusRecovery: null,
    _tributeSelectionReceived: false,
    _tributePickerCycle: 0,
    _tributeAwaitingPactId: null,
    _tributeAckTimer: null,

    tributeInput() {
      if (this._tributeInput) return this._tributeInput;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = TRIBUTE_MIME.join(',');
      input.id = 'bm-tribute-input';
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      input.style.position = 'fixed';
      input.style.left = '-10000px';
      input.style.top = '0';
      input.style.width = '1px';
      input.style.height = '1px';
      input.style.opacity = '0';
      input.style.pointerEvents = 'none';
      input.addEventListener('change', () => this.onTributePicked(input));
      // Fired when the picker is dismissed without a choice. Without this a
      // cancelled dialog would strand the pending lock on the button forever.
      input.addEventListener('cancel', () => this.releaseTribute());
      document.body.appendChild(input);
      this._tributeInput = input;
      return input;
    },

    // The button may already be detached if the market re-rendered underneath
    // us, so only touch it while it is still in the document.
    releaseTribute() {
      this._tributeBusy = false;
      this._tributePactId = null;
      this._tributeSelectionReceived = false;
      this._tributePickerCycle += 1;
      this._tributeAwaitingPactId = null;
      clearTimeout(this._tributeAckTimer);
      this._tributeAckTimer = null;
      clearTimeout(this._tributePickerTimer);
      this._tributePickerTimer = null;
      if (this._tributeFocusRecovery) {
        window.removeEventListener('focus', this._tributeFocusRecovery);
        this._tributeFocusRecovery = null;
      }
      const btn = this._tributeButton;
      this._tributeButton = null;
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = 'OFFER BLOOD TRIBUTE';
      }
    },

    confirmTributeSubmission() {
      clearTimeout(this._tributeAckTimer);
      this._tributeAckTimer = null;
      this._tributeBusy = false;
      this._tributePactId = null;
      this._tributeAwaitingPactId = null;
      this._tributeSelectionReceived = false;
      this._tributePickerCycle += 1;
      this._tributeButton = null;
      this.toast('THE OFFERING HAS BEEN SEALED');
    },

    offerTribute(pactId, button) {
      if (this._tributeBusy || document.getElementById('bm-tribute-consent')) return;
      this.showTributeConsent(pactId, button);
    },

    showTributeConsent(pactId, button) {
      document.getElementById('bm-tribute-consent')?.remove();
      const veil = document.createElement('div');
      veil.id = 'bm-tribute-consent';
      veil.className = 'bm-tribute-consent';
      veil.innerHTML = `
        <section class="bm-tribute-consent-card" role="dialog" aria-modal="true" aria-labelledby="bm-tribute-consent-title">
          <small>PRIVATE CHANNEL // BLOOD TRIBUTE</small>
          <h3 id="bm-tribute-consent-title">THE RELIQUARY REQUIRES CONSENT</h3>
          <p>Your offering is visible only to you and the Shadow Broker. If accepted, it will be consigned to the Reliquary. If rejected, it will not enter the Reliquary.</p>
          <p class="bm-tribute-consent-age">By proceeding, you confirm you are 18+ and consent to this storage rule.</p>
          <div class="bm-tribute-consent-actions">
            <button type="button" data-bm-consent-open>I CONSENT // OPEN THE VAULT</button>
            <button type="button" data-bm-consent-cancel>WITHDRAW</button>
          </div>
        </section>`;
      const close = () => veil.remove();
      veil.querySelector('[data-bm-consent-cancel]')?.addEventListener('click', close);
      veil.addEventListener('click', e => { if (e.target === veil) close(); });
      veil.querySelector('[data-bm-consent-open]')?.addEventListener('click', () => {
        close();
        this._tributePactId = pactId;
        this._tributeBusy = true;
        this._tributeSelectionReceived = false;
        this._tributePickerCycle += 1;
        this._tributeButton = button || null;
        if (button && button.isConnected) {
          button.disabled = true;
          button.textContent = 'THE VAULT IS WAITING…';
        }
        const input = this.tributeInput();
        input.value = '';
        this.armTributePickerRecovery(input);
        input.click();
      });
      document.body.appendChild(veil);
    },

    armTributePickerRecovery(input) {
      clearTimeout(this._tributePickerTimer);
      if (this._tributeFocusRecovery) {
        window.removeEventListener('focus', this._tributeFocusRecovery);
        this._tributeFocusRecovery = null;
      }
      const cycle = this._tributePickerCycle;
      const started = Date.now();
      this._tributeFocusRecovery = () => {
        setTimeout(() => {
          if (!this._tributeBusy) return;
          if (cycle !== this._tributePickerCycle) return;
          if (this._tributeSelectionReceived) return;
          const hasFile = !!(input.files && input.files.length);
          if (!hasFile && Date.now() - started > 250) this.releaseTribute();
        }, 500);
      };
      window.addEventListener('focus', this._tributeFocusRecovery, { once:true });
      this._tributePickerTimer = setTimeout(() => {
        if (!this._tributeBusy) return;
        if (cycle !== this._tributePickerCycle) return;
        if (this._tributeSelectionReceived) return;
        if (!(input.files && input.files.length)) this.releaseTribute();
      }, 45000);
    },

    async onTributePicked(input) {
      const pactId = this._tributePactId;
      const file = input.files && input.files[0];
      if (file) this._tributeSelectionReceived = true;
      clearTimeout(this._tributePickerTimer);
      this._tributePickerTimer = null;
      if (this._tributeFocusRecovery) {
        window.removeEventListener('focus', this._tributeFocusRecovery);
        this._tributeFocusRecovery = null;
      }
      if (!file) {
        input.value = '';
        return this.releaseTribute();
      }
      if (!TRIBUTE_MIME.includes(String(file.type || '').toLowerCase())) {
        input.value = '';
        this.releaseTribute();
        return this.toast('THE VAULT ACCEPTS ONLY PNG, JPEG OR WEBP');
      }
      if (file.size > TRIBUTE_MAX_BYTES) {
        input.value = '';
        this.releaseTribute();
        return this.toast('THE OFFERING EXCEEDS THE 20 MB VAULT LIMIT');
      }

      if (this._tributeButton && this._tributeButton.isConnected) {
        this._tributeButton.textContent = 'SEALING THE OFFERING…';
      }

      try {
        const token = sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || '';
        if (!token) throw new Error('LITTLE HERO AUTHENTICATION REQUIRED');
        const response = await fetch('/api/black-market/tribute-image?pactId=' + encodeURIComponent(pactId), {
          method: 'POST',
          headers: { 'Content-Type': String(file.type || '').toLowerCase(), 'x-player-token': token },
          body: file
        });
        const payload = await response.json().catch(() => ({}));
        input.value = '';
        if (!response.ok || !/^\/uploads\/chat\/[a-f0-9]{32}\.(?:png|jpg|webp)$/i.test(String(payload.imageUrl || ''))) {
          throw new Error(payload.error || 'THE OFFERING COULD NOT ENTER THE VAULT');
        }
        const requestId = `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
        const sent = this.send({ type:'blackMarket:tributeSubmit', pactId, imageUrl:payload.imageUrl, consent:true, requestId }) === true;
        if (!sent) {
          this.releaseTribute();
          return this.toast('THE RELIQUARY HAS LOST THE LINK');
        }
        this._tributeAwaitingPactId = pactId;
        clearTimeout(this._tributeAckTimer);
        this._tributeAckTimer = setTimeout(() => {
          if (this._tributeAwaitingPactId !== pactId) return;
          this.releaseTribute();
          if (document.getElementById('black-market-overlay')) this.render();
          this.toast('THE RELIQUARY DID NOT CONFIRM THE OFFERING');
          this.send({ type:'blackMarket:sync' });
        }, 12000);
      } catch (error) {
        input.value = '';
        this.releaseTribute();
        this.toast(String(error?.message || 'THE OFFERING COULD NOT ENTER THE VAULT').toUpperCase());
      }
    },

    toast(message) {
      let node = document.getElementById('black-market-toast');
      if (!node) {
        node = document.createElement('div');
        node.id = 'black-market-toast';
        node.className = 'black-market-toast';
        document.body.appendChild(node);
      }
      node.textContent = message;
      node.classList.add('show');
      clearTimeout(this._toast);
      this._toast = setTimeout(() => node.classList.remove('show'), 3200);
    },
    fmtTime(value) {
      const n = Number(value);
      if (!n) return 'UNKNOWN';
      try { return new Date(n).toLocaleString([], { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short' }); }
      catch (_) { return new Date(n).toISOString(); }
    },
    esc(value) {
      return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  };

  window.BlackMarket = ui;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ui.install(), { once:true });
  else ui.install();
})();
