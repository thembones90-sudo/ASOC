(function () {
  'use strict';

  const isGM = !!window.App;
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

  const ui = {
    pacts: [],
    send(payload) { host.send?.(payload); },
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
            const hasPending = this.pacts.some(p => p.status === 'SUBMITTED');
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
      const btn = document.querySelector('.black-market-entry');
      if (!btn) return;
      const pending = this.pacts.filter(p => isGM
        ? ['SUBMITTED','TRIBUTE_SUBMITTED'].includes(p.state)
        : ['COUNTEROFFERED','APPROVED_PENDING_TRIBUTE','TRIBUTE_REJECTED'].includes(p.state)
      ).length;
      btn.classList.toggle('has-pending', pending > 0);
      btn.dataset.pending = pending || '';
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
      return '<article class="bm-pact" data-pact="' + this.esc(p.id) + '"><div class="bm-pact-head"><div><small>' + this.esc(p.category) + (gm ? ' // ' + this.esc(p.playerName) : '') + '</small><b>' + this.esc(p.title) + '</b></div><span>' + this.esc(STATE_LABEL[p.state] || p.state) + '</span></div><p>' + this.esc(p.request) + '</p>' + (p.terms ? '<blockquote>' + this.esc(p.terms) + '</blockquote>' : '') + (p.rejectionReason ? '<em>' + this.esc(p.rejectionReason) + '</em>' : '') + image + this.actions(p, gm) + '</article>';
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
        if (act === 'offer-tribute') return this.offerTribute(pactId);
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
    offerTribute(pactId) {
      let input = document.getElementById('black-market-tribute-file');
      if (!input) {
        input = document.createElement('input');
        input.id = 'black-market-tribute-file';
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.setAttribute('aria-hidden', 'true');
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        document.body.appendChild(input);
      }
      input.value = '';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/i.test(file.type || '')) {
          return this.toast('THE RELIQUARY REJECTS THIS IMAGE TYPE');
        }
        if (file.size > 2200000) {
          return this.toast('THE OFFERING EXCEEDS THE VAULT LIMIT');
        }
        const consent = confirm('PRIVATE SUBMISSION NOTICE\n\nVisible only to you and the Shadow Broker. If accepted, it will be consigned to the Reliquary. If rejected, it will not enter the Reliquary.\n\nConfirm you are 18+ and consent to this storage rule.');
        if (!consent) return;
        const reader = new FileReader();
        reader.onerror = () => this.toast('THE RELIQUARY COULD NOT READ THE OFFERING');
        reader.onload = () => {
          if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
            return this.toast('THE OFFERING COULD NOT BE SEALED');
          }
          this.send({ type:'blackMarket:tributeSubmit', pactId, imageData:reader.result, consent:true });
        };
        reader.readAsDataURL(file);
      };
      input.click();
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
