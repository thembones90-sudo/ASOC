(() => {
  'use strict';

  const OUTCOMES = ['+1 ASOC GAME', 'BLOOD TRIBUTE', 'FUCK OFF'];
  const Concoction = {
    state: { cooldownUntil: 0, spinning: false },
    activeToken: '',
    tickTimer: null,
    panelTimer: null,
    watchdogTimer: null,
    resolvedToken: '',
    initialized: false,

    init() {
      if (this.initialized) return;
      this.initialized = true;
      this.installPanel();
      document.getElementById('minigames-unstable-concoction')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (PlayerApp.roomMode !== 'CASUAL' || this.isLocked()) return;
        if (!window.confirm(
          'TRIGGER UNSTABLE CONCOCTION?\n\n' +
          'This burns the room’s one dose for the next 24 hours -- for everyone, not just you. ' +
          'Outcome is random: +1 ASOC GAME, BLOOD TRIBUTE, or nothing.\n\n' +
          'Proceed?'
        )) return;
        event.currentTarget.disabled = true;
        document.getElementById('casual-minigames-menu')?.setAttribute('hidden', '');
        document.getElementById('casual-minigames-toggle')?.setAttribute('aria-expanded', 'false');
        PlayerApp.send({ type: 'unstableConcoction:spin' });
      });
      this.renderStatus();
    },

    installPanel() {
      if (document.getElementById('unstable-concoction-panel')) return;
      const panel = document.createElement('div');
      panel.id = 'unstable-concoction-panel';
      panel.className = 'unstable-concoction-panel';
      panel.hidden = true;
      panel.innerHTML = `
        <div class="unstable-concoction-shell" role="dialog" aria-modal="true" aria-label="Unstable Concoction">
          <div class="concoction-vapor" aria-hidden="true"></div>
          <img class="concoction-toxic-drop" src="assets/ui/unstable-concoction-toxic-drop.png" alt="" aria-hidden="true">
          <div class="concoction-kicker">COMPOUND // VOLATILE</div>
          <h2>UNSTABLE CONCOCTION</h2>
          <div class="concoction-wheel-wrap">
            <i class="concoction-pointer" aria-hidden="true"></i>
            <div class="concoction-wheel" id="unstable-concoction-wheel">
              <span>+1 ASOC<br>GAME</span><span>BLOOD<br>TRIBUTE</span><span>FUCK<br>OFF</span>
            </div>
          </div>
          <div id="unstable-concoction-readout" class="concoction-readout">REACTION IN PROGRESS</div>
          <button type="button" class="concoction-dismiss" hidden>RETURN TO CHAT</button>
        </div>`;
      document.getElementById('game-screen')?.appendChild(panel);
      panel.querySelector('.concoction-dismiss')?.addEventListener('click', () => this.closePanel());
    },

    isLocked() {
      return this.state.spinning || Number(this.state.cooldownUntil) > Date.now();
    },

    updateState(state) {
      const wasSpinning = this.state.spinning === true;
      this.state = state && typeof state === 'object'
        ? { cooldownUntil: Number(state.cooldownUntil) || 0, ...state }
        : { cooldownUntil: 0, spinning: false };
      this.renderStatus();
      if (PlayerApp.roomMode === 'CASUAL' && this.state.spinning &&
          String(this.state.playerId || '') === String(PlayerApp.playerId || '')) {
        this.showSpin(this.state.spinToken, this.state.resolvesAt);
      } else if (wasSpinning && !this.state.spinning && this.activeToken && this.resolvedToken !== this.activeToken) {
        this.finishWithoutResult();
      }
    },

    renderStatus() {
      const button = document.getElementById('minigames-unstable-concoction');
      const status = document.getElementById('unstable-concoction-status');
      if (!button || !status) return;
      const remaining = Math.max(0, Number(this.state.cooldownUntil) - Date.now());
      const locked = this.state.spinning || remaining > 0;
      button.disabled = locked;
      button.setAttribute('aria-disabled', String(locked));
      if (this.state.spinning) status.textContent = 'REACTING';
      else if (!remaining) status.textContent = 'READY';
      else {
        const totalMinutes = Math.ceil(remaining / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        status.textContent = hours ? `${hours}H ${String(minutes).padStart(2, '0')}M` : `${minutes}M`;
      }
      clearTimeout(this.tickTimer);
      if (remaining > 0) {
        const nextTick = remaining < 60000 ? 1000 : (remaining % 60000) + 25;
        this.tickTimer = setTimeout(() => this.renderStatus(), Math.max(250, nextTick));
      }
    },

    onStarted(message) {
      this.state.cooldownUntil = Number(message.cooldownUntil) || this.state.cooldownUntil;
      this.state.spinning = true;
      this.renderStatus();
      if (String(message.playerId || '') === String(PlayerApp.playerId || '')) {
        this.showSpin(message.spinToken, message.resolvesAt);
      }
    },

    showSpin(token, resolvesAt) {
      if (!token || this.activeToken === token || PlayerApp.roomMode !== 'CASUAL') return;
      this.activeToken = token;
      this.resolvedToken = '';
      clearTimeout(this.panelTimer);
      clearTimeout(this.watchdogTimer);
      const panel = document.getElementById('unstable-concoction-panel');
      const wheel = document.getElementById('unstable-concoction-wheel');
      const readout = document.getElementById('unstable-concoction-readout');
      if (!panel || !wheel || !readout) return;
      panel.hidden = false;
      readout.textContent = 'REACTION IN PROGRESS';
      readout.removeAttribute('data-outcome');
      panel.querySelector('.concoction-dismiss')?.setAttribute('hidden', '');
      wheel.className = 'concoction-wheel';
      wheel.style.setProperty('--spin-ms', `${Math.max(350, Number(resolvesAt) - Date.now())}ms`);
      requestAnimationFrame(() => wheel.classList.add('is-spinning'));
      const remaining = Math.max(0, Number(resolvesAt) - Date.now());
      this.watchdogTimer = setTimeout(() => this.finishWithoutResult(), remaining + 6000);
    },

    onResolved(message) {
      this.state.spinning = false;
      this.state.cooldownUntil = Number(message.cooldownUntil) || this.state.cooldownUntil;
      this.renderStatus();
      if (String(message.playerId || '') !== String(PlayerApp.playerId || '')) return;
      const panel = document.getElementById('unstable-concoction-panel');
      const wheel = document.getElementById('unstable-concoction-wheel');
      const readout = document.getElementById('unstable-concoction-readout');
      if (!panel || !wheel || !readout || !OUTCOMES.includes(message.outcome)) return;
      this.resolvedToken = String(message.spinToken || this.activeToken || '');
      clearTimeout(this.watchdogTimer);
      panel.hidden = false;
      wheel.classList.remove('is-spinning');
      wheel.dataset.result = String(OUTCOMES.indexOf(message.outcome));
      readout.textContent = message.outcome;
      readout.dataset.outcome = String(OUTCOMES.indexOf(message.outcome));
      panel.querySelector('.concoction-dismiss')?.removeAttribute('hidden');
      clearTimeout(this.panelTimer);
      this.panelTimer = setTimeout(() => this.closePanel(), message.outcome === 'BLOOD TRIBUTE' ? 3000 : 2400);
    },

    finishWithoutResult() {
      if (!this.activeToken) return;
      const panel = document.getElementById('unstable-concoction-panel');
      const wheel = document.getElementById('unstable-concoction-wheel');
      const readout = document.getElementById('unstable-concoction-readout');
      if (!panel || !wheel || !readout) return this.closePanel();
      wheel.classList.remove('is-spinning');
      readout.textContent = 'REACTION COMPLETE';
      readout.removeAttribute('data-outcome');
      panel.querySelector('.concoction-dismiss')?.removeAttribute('hidden');
      clearTimeout(this.panelTimer);
      this.panelTimer = setTimeout(() => this.closePanel(), 1400);
    },

    closePanel() {
      clearTimeout(this.panelTimer);
      clearTimeout(this.watchdogTimer);
      const panel = document.getElementById('unstable-concoction-panel');
      const wheel = document.getElementById('unstable-concoction-wheel');
      if (panel) panel.hidden = true;
      if (wheel) {
        wheel.classList.remove('is-spinning');
        delete wheel.dataset.result;
      }
      this.activeToken = '';
      this.resolvedToken = '';
    },

    onLocked(message) {
      this.state.cooldownUntil = Number(message.cooldownUntil) || this.state.cooldownUntil;
      this.state.spinning = false;
      this.renderStatus();
      this.closePanel();
    },

    onError() {
      if (!this.state.spinning) this.closePanel();
      this.renderStatus();
    },

    leaveCasual() {
      this.closePanel();
      document.getElementById('casual-minigames-menu')?.setAttribute('hidden', '');
      document.getElementById('casual-minigames-toggle')?.setAttribute('aria-expanded', 'false');
    }
  };

  window.UnstableConcoction = Concoction;
  const boot = () => Concoction.init();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
