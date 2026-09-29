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
    APPROVED_PENDING_TRIBUTE: 'BLOOD IS OWED',
    TRIBUTE_SUBMITTED: 'THE OFFERING AWAITS JUDGMENT',
    TRIBUTE_REJECTED: 'THE OFFERING WAS DENIED',
    OWED: 'A DEBT IS RECORDED',
    IN_PROGRESS: 'THE DEBT IS BEING HONORED',
    FULFILLED: 'THE PACT IS FULFILLED',
    DENIED: 'THE PETITION IS DENIED',
    BROKEN: 'THE PACT IS BROKEN'
  };

  // Tribute image limits. The 2.2MB file cap is what keeps the base64 data URL
  // (~2.93MB) under the server's MAX_TRIBUTE_DATA_LENGTH of 3,000,000 and well
  // under the 5MB WebSocket payload ceiling, so a legal file is never rejected
  // on arrival for size.
  const TRIBUTE_MAX_BYTES = 2200000;
  const TRIBUTE_MIME = ['image/png', 'image/jpeg', 'image/webp'];
  const TRIBUTE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,/;
  const TRIBUTE_CONSENT_NOTICE = 'PRIVATE SUBMISSION NOTICE\n\nVisible only to you and the Shadow Broker. If accepted, it will be consigned to the Reliquary. If rejected, it will not enter the Reliquary.\n\nConfirm you are 18+ and consent to this storage rule.';

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
          this.pacts = Array.isArray(message.pacts) ? message.pacts : [];
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
        if (message?.type === 'blackMarket:error') {
          this.toast(message.message || 'THE PACT REJECTS YOUR HAND');
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
        overlay.className = 'black-market-overlay';
        overlay.innerHTML = '<div class="black-market-void"></div><section class="black-market-room" role="dialog" aria-modal="true"><header><div><small>PRIVATE CHANNEL // SHADOW BROKER</small><h2>BLACK MARKET</h2></div><button type="button" data-bm-close>×</button></header><div id="black-market-body"></div></section>';
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
      return '<div class="bm-intro"><b>PETITION THE BROKER</b><p>This chamber belongs to you alone. No other Little Hero sees what is written here.</p></div>' + petition + '<h3>LEDGER OF PACTS</h3><div class="bm-ledger">' + ledger + '</div>';
    },
    renderGm() {
      const pending = this.pacts.filter(p => ['SUBMITTED','TRIBUTE_SUBMITTED'].includes(p.state));
      const rest = this.pacts.filter(p => !['SUBMITTED','TRIBUTE_SUBMITTED'].includes(p.state));
      return '<div class="bm-intro"><b>SEALED PETITIONS</b><p>Each chamber terminates here. Nothing below is broadcast to the room.</p></div><h3>AWAITING JUDGMENT</h3><div class="bm-ledger">' + (pending.map(p => this.card(p, true)).join('') || '<p class="bm-empty">THE MARKET SLEEPS.</p>') + '</div><h3>LEDGER OF PACTS</h3><div class="bm-ledger">' + (rest.map(p => this.card(p, true)).join('') || '<p class="bm-empty">NO DEBTS RECORDED.</p>') + '</div>';
    },
    card(p, gm) {
      const image = gm && p.state === 'TRIBUTE_SUBMITTED' && p.tributeImageData ? '<img class="bm-tribute-preview" src="' + p.tributeImageData + '" alt="Private Blood Tribute">' : '';
      return '<article class="bm-pact is-' + this.esc(String(p.state || '').toLowerCase()) + '" data-state="' + this.esc(p.state) + '" data-pact="' + this.esc(p.id) + '"><div class="bm-pact-head"><div><small>' + this.esc(p.category) + (gm ? ' // ' + this.esc(p.playerName) : '') + '</small><b>' + this.esc(p.title) + '</b></div><span>' + this.esc(STATE_LABEL[p.state] || p.state) + '</span></div><p>' + this.esc(p.request) + '</p>' + (p.terms ? '<blockquote>' + this.esc(p.terms) + '</blockquote>' : '') + (p.rejectionReason ? '<em>' + this.esc(p.rejectionReason) + '</em>' : '') + image + this.actions(p, gm) + '</article>';
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
      if (['APPROVED_PENDING_TRIBUTE','TRIBUTE_REJECTED'].includes(p.state)) return '<div class="bm-actions"><button data-act="offer-tribute">OFFER BLOOD TRIBUTE</button></div>';
      return '';
    },
    bindActions(body) {
      body.querySelector('#bm-petition')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        this.send({ type:'blackMarket:petition', title:fd.get('title'), category:fd.get('category'), request:fd.get('request') });
      });
      body.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
        const pactId = btn.closest('[data-pact]')?.dataset.pact;
        const act = btn.dataset.act;
        if (act === 'accept-counter') return this.send({ type:'blackMarket:acceptCounter', pactId });
        if (act === 'offer-tribute') return this.offerTribute(pactId, btn);
        if (act === 'tribute-accept') return this.send({ type:'blackMarket:tributeJudge', pactId, accepted:true });
        if (act === 'tribute-reject') {
          const reason = prompt('WHY IS THE OFFERING DENIED?') || '';
          return this.send({ type:'blackMarket:tributeJudge', pactId, accepted:false, reason });
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
          const terms = prompt('REWRITE THE TERMS OF THE PACT');
          if (!terms?.trim()) return;
          btn.disabled = true;
          return this.send({ type:'blackMarket:gmDecision', pactId, action:'counter', terms:terms.trim(), tributeRequired:true });
        }
        if (act === 'deny') {
          const terms = prompt('REASON FOR DENIAL // OPTIONAL') || '';
          btn.disabled = true;
          return this.send({ type:'blackMarket:gmDecision', pactId, action:'deny', terms, tributeRequired:false });
        }
        btn.disabled = true;
        this.send({ type:'blackMarket:gmDecision', pactId, action:act, terms:'', tributeRequired:false });
      }));
    },
    // One hidden file input, mounted once and reused. A fresh input per click
    // leaked a node on every attempt, and a detached input is exactly the kind
    // of thing the desktop shell will refuse to open a picker for.
    _tributeInput: null,
    _tributePactId: null,
    _tributeBusy: false,
    _tributeButton: null,

    tributeInput() {
      if (this._tributeInput) return this._tributeInput;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = TRIBUTE_MIME.join(',');
      input.id = 'bm-tribute-input';
      input.hidden = true;
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
      const btn = this._tributeButton;
      this._tributeButton = null;
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = 'OFFER BLOOD TRIBUTE';
      }
    },

    offerTribute(pactId, button) {
      if (this._tributeBusy) return;
      // Consent is taken BEFORE the picker opens. A blocking confirm() placed
      // after a native file dialog has closed is the classic way to lose a
      // submission: the dialog can swallow the confirmation or park it behind
      // the window, and the player's selection evaporates with nothing on
      // screen. Asking first keeps consent -> pick -> read -> send inside a
      // single user gesture, so input.click() is still trusted when it runs.
      if (!confirm(TRIBUTE_CONSENT_NOTICE)) return;
      this._tributePactId = pactId;
      this._tributeBusy = true;
      this._tributeButton = button || null;
      if (button) {
        button.disabled = true;
        button.textContent = 'THE VAULT IS WAITING…';
      }
      this.tributeInput().click();
    },

    onTributePicked(input) {
      const pactId = this._tributePactId;
      const file = input.files && input.files[0];
      // Clear the selection so choosing the same file again still fires change.
      input.value = '';
      // Dismissed with nothing chosen: not an error, just release and wait.
      if (!file) return this.releaseTribute();
      // accept= on the input is only a filter hint; the picker can still hand
      // back anything, so the type is checked for real.
      if (!TRIBUTE_MIME.includes(String(file.type || '').toLowerCase())) {
        this.releaseTribute();
        return this.toast('THE VAULT ACCEPTS ONLY PNG, JPEG OR WEBP');
      }
      if (file.size > TRIBUTE_MAX_BYTES) {
        this.releaseTribute();
        return this.toast('THE OFFERING EXCEEDS THE VAULT LIMIT');
      }
      const reader = new FileReader();
      // A read that never completes is precisely the "OFFER flashes, nothing
      // happens" symptom, so every failure path reports instead of vanishing.
      reader.onerror = () => {
        this.releaseTribute();
        this.toast('THE IMAGE COULD NOT BE READ');
      };
      reader.onabort = () => {
        this.releaseTribute();
        this.toast('THE READING WAS INTERRUPTED');
      };
      reader.onload = () => {
        const imageData = String(reader.result || '');
        if (!TRIBUTE_DATA_URL.test(imageData)) {
          this.releaseTribute();
          return this.toast('THE OFFERING IS INVALID');
        }
        let sent = false;
        try {
          sent = this.send({ type:'blackMarket:tributeSubmit', pactId, imageData, consent:true }) === true;
        } catch (error) {
          sent = false;
        }
        if (!sent) {
          this.releaseTribute();
          return this.toast('THE RELIQUARY HAS LOST THE LINK');
        }
        // The pact leaves APPROVED_PENDING_TRIBUTE the moment the server
        // accepts it, so the refreshed state re-renders the ledger without an
        // OFFER button; the lock is dropped rather than released.
        this._tributeBusy = false;
        this._tributePactId = null;
        this._tributeButton = null;
        this.toast('THE OFFERING HAS BEEN SEALED');
      };
      reader.readAsDataURL(file);
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
    esc(value) {
      return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
  };

  window.BlackMarket = ui;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ui.install(), { once:true });
  else ui.install();
})();
