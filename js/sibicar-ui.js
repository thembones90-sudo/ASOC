(() => {
  const COPY = Object.freeze({
    win: ['A MIRACLE. YOU FOUND IT.', 'COGNITION DETECTED.', 'THE BRAIN IS YOURS.'],
    lose: ['NO BRAIN DETECTED.', 'WRONG SKULL, PEASANT.', 'THE BRAIN ELUDES YOU.']
  });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const UI = {
    state: 'IDLE', round: null, balance: 0, slots: [0, 1, 2], picked: null, busy: false, initialized: false,
    init() {
      if (this.initialized) return; this.initialized = true;
      document.getElementById('minigames-sibicar')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); document.getElementById('casual-minigames-menu').hidden = true; this.open(); });
      document.addEventListener('click', event => this.click(event));
    },
    ensure() {
      let overlay = document.getElementById('sibicar-overlay'); if (overlay) return overlay;
      overlay = document.createElement('div'); overlay.id = 'sibicar-overlay'; overlay.className = 'sibicar-overlay'; overlay.hidden = true;
      overlay.innerHTML = '<section class="sibicar-shell"><header><div><small>ASOC STREET COGNITION AUDIT</small><h2>ŠIBICAR</h2><p>THREE HEADS. ONE BRAIN. AN UNLIKELY ARRANGEMENT.</p></div><button type="button" data-sibicar-close aria-label="Close">×</button></header><div class="sibicar-body" data-sibicar-body></div></section>';
      document.body.appendChild(overlay); return overlay;
    },
    send(type, payload = {}) { return window.PlayerApp?.send?.({ type, ...payload }); },
    open() { this.ensure().hidden = false; this.state = 'MODE_SELECT'; this.render(); this.send('player:sibicarSync'); },
    close() { if (['INTRO_REVEAL', 'SHUFFLING', 'RESOLVING'].includes(this.state)) return; this.ensure().hidden = true; },
    click(event) {
      if (event.target.closest('[data-sibicar-close]')) return this.close();
      const mode = event.target.closest('[data-sibicar-mode]')?.dataset.sibicarMode;
      if (mode && !this.busy) { if (mode === 'FUN') return this.start('FUN', 0); this.state = 'WAGER_SELECT'; return this.render(); }
      const wager = event.target.closest('[data-sibicar-wager]')?.dataset.sibicarWager;
      if (wager && !this.busy) return this.start('WAGER', Number(wager));
      const head = event.target.closest('[data-sibicar-head]');
      if (head && this.state === 'AWAITING_PICK' && !this.busy) return this.pick(Number(head.dataset.sibicarHead));
      if (event.target.closest('[data-sibicar-replay]') && this.state === 'RESULT') { this.round = null; this.picked = null; this.slots = [0, 1, 2]; this.state = 'MODE_SELECT'; this.render(); }
    },
    start(mode, wager) { this.busy = true; this.state = mode === 'FUN' ? 'INTRO_REVEAL' : 'WAGER_SELECT'; this.render(); this.send('player:sibicarStart', { mode, wager }); },
    onError(message) { this.busy = false; this.state = this.round ? this.state : 'MODE_SELECT'; this.render(); window.AsocDialog?.alert?.(String(message || 'THE HUSTLER REFUSED THE DEAL.')); },
    async onRound(payload, restored = false, balance = this.balance) {
      if (!payload) return; this.round = payload; this.balance = Number(balance); this.slots = [0, 1, 2]; this.picked = null; this.busy = true;
      this.state = 'INTRO_REVEAL'; this.render();
      const brain = this.ensure().querySelector(`[data-sibicar-head="${payload.brainStart}"]`); brain?.classList.add('is-open', 'has-brain');
      await wait(restored ? 650 : 1300); brain?.classList.remove('is-open'); await wait(300);
      this.state = 'SHUFFLING'; this.render();
      for (const [a, b] of payload.shuffle || []) { const headA = this.slots.indexOf(a), headB = this.slots.indexOf(b); this.slots[headA] = b; this.slots[headB] = a; this.positionHeads(); await wait(470); }
      this.busy = false; this.state = 'AWAITING_PICK'; this.render();
    },
    pick(headId) { this.busy = true; this.picked = this.slots[headId]; this.state = 'RESOLVING'; this.render(); this.send('player:sibicarPick', { roundId: this.round.roundId, position: this.picked }); },
    async onResult(result) {
      if (!result) return; this.balance = Number(result.balance || 0); this.busy = true; this.state = 'RESOLVING'; this.render(); await wait(350);
      const heads = [...this.ensure().querySelectorAll('[data-sibicar-head]')];
      heads.forEach((head, id) => { const slot = this.slots[id]; if (slot === result.actualPosition) head.classList.add('is-open', 'has-brain', 'is-actual'); if (slot === result.selectedPosition) head.classList.add('is-selected'); });
      await wait(1000); this.busy = false; this.state = 'RESULT'; this.result = result; this.render();
    },
    positionHeads() { this.ensure().querySelectorAll('[data-sibicar-head]').forEach((head, id) => head.style.setProperty('--slot', this.slots[id])); },
    heads() { return `<div class="sibicar-stage" data-state="${this.state}">${[0,1,2].map(id => `<button type="button" class="sibicar-head" data-sibicar-head="${id}" style="--slot:${this.slots[id]}" ${this.state === 'AWAITING_PICK' ? '' : 'disabled'}><span class="sibicar-brain"><img src="assets/minigames/sibicar/brain.png" alt="Cartoon brain"></span><span class="sibicar-face"><img src="assets/minigames/sibicar/head.png" alt="Cartoon head ${id + 1}"></span><span class="sibicar-cap"></span><i>${id + 1}</i></button>`).join('')}</div>`; },
    render() {
      const body = this.ensure().querySelector('[data-sibicar-body]'); if (!body) return;
      if (this.state === 'MODE_SELECT' || this.state === 'IDLE') { body.innerHTML = `<div class="sibicar-mode"><div class="sibicar-mark"><img src="assets/minigames/sibicar/brain.png" alt=""></div><h3>WHERE IS THE BRAIN?</h3><p>Choose honest humiliation or financially irresponsible humiliation.</p><div><button data-sibicar-mode="FUN"><b>FUN MODE</b><small>NO WAGER // SAME SHUFFLE</small></button><button data-sibicar-mode="WAGER"><b>SHADOW COIN MODE</b><small>WIN RETURNS x2 TOTAL</small></button></div><span>BALANCE // ${this.balance} SC</span></div>`; return; }
      if (this.state === 'WAGER_SELECT' && !this.round) { body.innerHTML = `<div class="sibicar-wagers"><small>SHADOW COIN ESCROW</small><h3>CHOOSE YOUR BAD DECISION</h3><p>Stake is removed when the round begins. Correct pick returns twice the stake.</p><div>${[25,50,100,250].map(value => `<button data-sibicar-wager="${value}" ${value > this.balance ? 'disabled' : ''}>${value}<small>SC</small></button>`).join('')}</div><b>AVAILABLE // ${this.balance} SC</b></div>`; return; }
      const modeLine = this.round?.mode === 'WAGER' ? `WAGER LOCKED // ${this.round.wager} SC` : 'FUN MODE // NO SHADOW COINS AT RISK';
      const instruction = this.state === 'INTRO_REVEAL' ? 'THE BRAIN PRESENTS ITSELF.' : this.state === 'SHUFFLING' ? 'WATCH CAREFULLY. THIS MAY BE YOUR LAST THOUGHT.' : this.state === 'AWAITING_PICK' ? 'CHOOSE A HEAD.' : 'THE SKULLS ARE OPENING.';
      body.innerHTML = `<div class="sibicar-round-head"><span>${modeLine}</span><b>${instruction}</b><small>BALANCE // ${this.balance} SC</small></div>${this.heads()}`;
      this.positionHeads();
      if (this.state === 'RESULT' && this.result) {
        [...this.ensure().querySelectorAll('[data-sibicar-head]')].forEach((head, id) => { const slot = this.slots[id]; if (slot === this.result.actualPosition) head.classList.add('is-open', 'has-brain', 'is-actual'); if (slot === this.result.selectedPosition) head.classList.add('is-selected'); });
        const correct = this.result.correct, lines = correct ? COPY.win : COPY.lose, line = lines[Math.abs(String(this.result.roundId).length + Number(this.result.selectedPosition)) % lines.length];
        body.insertAdjacentHTML('beforeend', `<div class="sibicar-result ${correct ? 'is-win' : 'is-loss'}"><small>${correct ? 'COGNITIVE EVENT CONFIRMED' : 'CRANIUM EMPTY'}</small><h3>${line}</h3><p>${this.result.mode === 'WAGER' ? (correct ? `TOTAL RETURN ${this.result.payout} SC // NET +${this.result.wager} SC` : `WAGER LOST // -${this.result.wager} SC`) : 'FUN MODE // YOUR DIGNITY WAS THE ONLY STAKE'}</p><b>BALANCE // ${this.balance} SC</b><button data-sibicar-replay>PLAY AGAIN</button></div>`);
      }
    }
  };
  window.SibicarUI = UI; document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => UI.init(), { once:true }) : UI.init();
})();
