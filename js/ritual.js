// SUMMON RITUAL -- pre-Battle gate. Rendering module, same philosophy as
// timer.js/womf.js: the authoritative ritual state always comes from the
// server (ritual:update for players -- safe/anonymous fields only;
// ritual:gmUpdate for the Shadow Broker -- names + tribute preview added).
// This module never computes fulfillment itself; it only renders what it's
// given and forwards user actions as socket sends via `handlers`.
//
// Exactly two ways to fulfill it: 5 real online players "join the ritual",
// OR the Shadow Broker accepts one anonymously-submitted Blood Tribute
// image. Neither auto-starts Battle -- fulfillment only unlocks the
// Shadow Broker's own START GAME control (see the isBlockingStart() getter,
// consulted by timer.js's own START GAME render).
const Ritual = {
  _lastState: null,
  _wasFulfilled: false,
  _assetsPreloaded: false,
  _joinPending: false,
  _joinError: '',

  // Consulted by timer.js when it renders the START GAME button -- kept as
  // a getter rather than a threaded parameter so neither module has to
  // change its existing call signature.
  isBlockingStart() {
    const state = this._lastState;
    return !!(state && state.active && !state.fulfilled);
  },

  escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  },

  pentagonHTML() {
    return `
      <div class="ritual-pentagon" aria-hidden="true">
        <img class="ritual-platform" src="assets/ritual/summon-platform.png?v=20260924-runes-1" alt="">
        ${[0, 1, 2, 3, 4].map((i) => {
          const runeNumber = String(i + 1).padStart(2, '0');
          return `<span class="ritual-crystal ritual-rune-slot" data-crystal-index="${i}">
            <img class="ritual-rune-image" src="assets/ritual/rune-${runeNumber}-idle.png?v=20260924-runes-1" data-idle-src="assets/ritual/rune-${runeNumber}-idle.png?v=20260924-runes-1" data-active-src="assets/ritual/rune-${runeNumber}-active.png?v=20260924-runes-1" alt="">
            <em class="ritual-soul-name">AWAITING</em>
          </span>`;
        }).join('')}
      </div>
    `;
  },

  preloadAssets() {
    if (this._assetsPreloaded) return;
    this._assetsPreloaded = true;
    ['summon-platform.png', ...[1, 2, 3, 4, 5].flatMap((number) => {
      const id = String(number).padStart(2, '0');
      return [`rune-${id}-idle.png`, `rune-${id}-active.png`];
    })].forEach((file) => {
      const image = new Image();
      image.src = `assets/ritual/${file}?v=20260924-runes-1`;
    });
  },

  shellHTML(isGM) {
    return `
      <div class="ritual-stage">
        <div class="ritual-identity">
          <span class="ritual-kicker">${isGM ? 'SHADOW BROKER // PRE-BATTLE GATE' : 'COMPOUND // RITUAL'}</span>
          <div class="ritual-label">SUMMON RITUAL</div>
        </div>
        ${this.pentagonHTML()}
        <div class="ritual-status"></div>
        <div class="ritual-tribute-status" hidden></div>
        <div class="ritual-actions"></div>
        ${isGM ? '<div class="ritual-gm-detail"></div>' : ''}
      </div>
    `;
  },

  init(containerId, isGM) {
    const el = document.getElementById(containerId);
    if (!el || el.dataset.ritualInit === '1') return;
    this.preloadAssets();
    el.innerHTML = this.shellHTML(isGM);
    el.dataset.ritualInit = '1';
  },

  // isGM: whether to draw the BOUND/MISSING/TRIBUTE admin block + ACCEPT /
  // REJECT / RESET / CANCEL controls (players never get them). handlers:
  // { onJoin, onOfferTribute, onAcceptTribute, onRejectTribute, onReset,
  // onCancel }, each optional depending on isGM.
  update(containerId, state, isGM, handlers) {
    const el = document.getElementById(containerId);
    if (!el) return;
    this.init(containerId, isGM);
    this._lastState = state;

    const active = !!state?.active;
    const joinedCount = Math.max(0, Number(state?.joinedCount) || 0);
    const required = Math.max(1, Number(state?.requiredVotes) || 5);
    const fulfilled = !!state?.fulfilled;
    const fulfilledBy = state?.fulfilledBy || null;
    const tributeStatus = state?.tribute?.status || 'NONE';
    const byBlood = fulfilled && fulfilledBy === 'BLOOD_TRIBUTE';

    el.classList.toggle('ritual-active', active);
    el.classList.toggle('ritual-complete', fulfilled);
    el.classList.toggle('ritual-complete-blood', byBlood);

    // Crystals: normal fulfillment lights them up one at a time as votes
    // land; a Blood Tribute override ignites all five at once in a visibly
    // different, corrupted state -- never faked as though 5 players joined.
    el.querySelectorAll('.ritual-crystal').forEach((node, index) => {
      const wasActive = node.classList.contains('is-active');
      const nowActive = byBlood ? true : index < joinedCount;
      const soul = isGM ? state?.joined?.[index] : null;
      node.classList.toggle('is-active', nowActive);
      node.classList.toggle('is-blood', byBlood);
      const runeImage = node.querySelector('.ritual-rune-image');
      if (runeImage) {
        const nextSource = nowActive ? runeImage.dataset.activeSrc : runeImage.dataset.idleSrc;
        if (runeImage.getAttribute('src') !== nextSource) runeImage.setAttribute('src', nextSource);
      }
      const soulName = node.querySelector('.ritual-soul-name');
      if (soulName) soulName.textContent = soul?.name || (byBlood ? 'TRIBUTE' : 'AWAITING');
      if (nowActive && !wasActive) {
        node.classList.remove('ritual-crystal-wake');
        void node.offsetWidth; // restart the one-shot wake animation
        node.classList.add('ritual-crystal-wake');
      }
    });
    const fillRatio = byBlood ? 1 : Math.min(1, joinedCount / required);
    el.style.setProperty('--ritual-fill', String(fillRatio));

    // A single, capped tremor + pulse exactly on the false->true transition
    // -- never on every individual join.
    if (fulfilled && !this._wasFulfilled) {
      el.classList.remove('ritual-complete-flash');
      void el.offsetWidth;
      el.classList.add('ritual-complete-flash');
      window.AsocAudio?.ritualComplete?.();
    }
    this._wasFulfilled = fulfilled;

    const statusEl = el.querySelector('.ritual-status');
    if (statusEl) {
      if (byBlood) {
        statusEl.innerHTML = 'THE RELIQUARY HAS ACCEPTED THE OFFERING.<br>THE RITUAL IS FULFILLED.<br>AWAIT THE SHADOW BROKER.';
      } else if (fulfilled) {
        statusEl.innerHTML = 'THE CIRCLE IS COMPLETE.<br>THE REQUIREMENT HAS BEEN FULFILLED.<br>AWAIT THE SHADOW BROKER.';
      } else {
        statusEl.innerHTML = `${joinedCount === 0 ? 'THE SUMMONING HAS BEGUN' : ''}<b class="ritual-count">${joinedCount} / ${required} SOULS BOUND</b>`;
      }
    }

    const tributeEl = el.querySelector('.ritual-tribute-status');
    if (tributeEl) {
      const showPending = tributeStatus === 'PENDING' && !isGM;
      tributeEl.hidden = !showPending;
      if (showPending) tributeEl.textContent = 'A TRIBUTE HAS BEEN OFFERED. AWAITING JUDGMENT.';
    }

    if (!isGM) this._renderPlayerActions(el, { joinedCount, required, fulfilled, tributeStatus, iJoined: !!state?.iJoined }, handlers);
    else this._renderGmDetail(el, { joinedCount, required, fulfilled, fulfilledBy, tributeStatus, joined: state?.joined || [], tribute: state?.tribute || {} }, handlers);
  },

  _renderPlayerActions(el, ctx, handlers) {
    const actions = el.querySelector('.ritual-actions');
    if (!actions) return;
    const canOfferTribute = !ctx.fulfilled && ['NONE', 'REJECTED'].includes(ctx.tributeStatus);
    actions.innerHTML = `
      <button type="button" class="ritual-join-btn" ${(ctx.iJoined || ctx.fulfilled || this._joinPending) ? 'disabled' : ''}>${ctx.iJoined ? 'BOUND TO THE RITUAL' : this._joinPending ? 'BINDING SOUL…' : 'JOIN THE RITUAL'}</button>
      <div class="ritual-join-feedback" ${this._joinError ? '' : 'hidden'}>${this.escapeHtml(this._joinError)}</div>
      ${canOfferTribute ? `
        <button type="button" class="ritual-tribute-btn">OFFER BLOOD TRIBUTE</button>
        <div class="ritual-tribute-copy">THE RELIQUARY ACCEPTS ALTERNATIVE PAYMENT.</div>
      ` : ''}
    `;
    const joinBtn = actions.querySelector('.ritual-join-btn');
    if (ctx.iJoined) {
      this._joinPending = false;
      this._joinError = '';
    }
    if (joinBtn && !ctx.iJoined && !ctx.fulfilled && !this._joinPending && handlers?.onJoin) {
      joinBtn.onclick = () => {
        this._joinPending = true;
        this._joinError = '';
        joinBtn.disabled = true;
        joinBtn.textContent = 'BINDING SOUL…';
        const sent = handlers.onJoin();
        if (sent === false) this.showJoinError(el.id, 'RITUAL LINK OFFLINE // RECONNECTING');
      };
    }
    const tributeBtn = actions.querySelector('.ritual-tribute-btn');
    if (tributeBtn && handlers?.onOfferTribute) tributeBtn.onclick = handlers.onOfferTribute;
  },

  showJoinError(containerId, message) {
    this._joinPending = false;
    this._joinError = String(message || 'THE RITUAL REJECTED THIS SOUL');
    const el = document.getElementById(containerId);
    const feedback = el?.querySelector('.ritual-join-feedback');
    const button = el?.querySelector('.ritual-join-btn');
    if (feedback) {
      feedback.hidden = false;
      feedback.textContent = this._joinError;
    }
    if (button && !button.textContent.includes('BOUND')) {
      button.disabled = false;
      button.textContent = 'JOIN THE RITUAL';
    }
  },

  _renderGmDetail(el, ctx, handlers) {
    const detail = el.querySelector('.ritual-gm-detail');
    if (!detail) return;
    const names = ctx.joined.map((p) => this.escapeHtml(p.name)).join(' · ') || 'AWAITING FIRST SOUL';
    const missing = Math.max(0, ctx.required - ctx.joinedCount);
    const tributeLine = {
      NONE: 'NONE',
      PENDING: '1 PENDING',
      ACCEPTED: 'ACCEPTED',
      REJECTED: 'REJECTED // may resubmit'
    }[ctx.tributeStatus] || 'NONE';
    detail.innerHTML = `
      <div class="ritual-gm-summary">
        <div class="ritual-gm-roster"><span>BOUND //</span> ${names}</div>
        <div class="ritual-gm-meta"><b>${missing ? `${missing} SOUL${missing === 1 ? '' : 'S'} REMAIN` : 'CIRCLE COMPLETE'}</b><span>TRIBUTE // ${tributeLine}</span>${ctx.fulfilled ? `<span class="ritual-gm-fulfilled-tag">FULFILLED BY ${ctx.fulfilledBy === 'BLOOD_TRIBUTE' ? 'BLOOD TRIBUTE' : 'VOTES'}</span>` : ''}</div>
      </div>
      ${ctx.tributeStatus === 'PENDING' && ctx.tribute.imageData ? `<button type="button" class="ritual-gm-tribute-preview-btn"><img class="ritual-gm-tribute-preview" src="${this.escapeHtml(ctx.tribute.imageData)}" alt="Offered tribute"></button>` : ''}
      <div class="ritual-gm-actions">
        ${ctx.tributeStatus === 'PENDING' ? '<button type="button" class="ritual-gm-accept-btn">ACCEPT TRIBUTE</button><button type="button" class="ritual-gm-reject-btn">REJECT TRIBUTE</button>' : ''}
        <details class="ritual-danger-menu">
          <summary>RITUAL OPTIONS</summary>
          <div><button type="button" class="ritual-gm-reset-btn">RESET RITUAL</button><button type="button" class="ritual-gm-cancel-btn">CANCEL RITUAL</button></div>
        </details>
      </div>
    `;
    const bind = (selector, fn) => { const btn = detail.querySelector(selector); if (btn && fn) btn.onclick = fn; };
    bind('.ritual-gm-accept-btn', handlers?.onAcceptTribute);
    bind('.ritual-gm-reject-btn', handlers?.onRejectTribute);
    bind('.ritual-gm-reset-btn', handlers?.onReset);
    bind('.ritual-gm-cancel-btn', handlers?.onCancel);
    const previewBtn = detail.querySelector('.ritual-gm-tribute-preview-btn');
    if (previewBtn) previewBtn.onclick = () => previewBtn.classList.toggle('is-expanded');
  }
};

window.Ritual = Ritual;
