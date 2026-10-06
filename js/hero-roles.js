// HERO ROLES -- DPS / TANK / HEAL, on the Little Hero page and the Shadow
// Broker console. Decorative for now: a Little Hero picks a role and wears
// its badge beside their name. The server (hero-roles.js) owns the picks.
//
//   Little Hero: once the Shadow Broker hits LOCK IN on a full (5/5)
//   ritual, choose a class; it locks once the battle is live and the panel
//   shows the party line-up.
//   Everyone: role badges beside names.
//   Shadow Broker: ROLES ON/OFF for the session.
(() => {
  'use strict';
  const isGM = () => !!window.App && !window.PlayerApp;
  const host = () => (isGM() ? window.App : window.PlayerApp);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLES = {
    dps: { name: 'DPS', tag: 'DAMAGE' },
    tank: { name: 'TANK', tag: 'PROTECTOR' },
    heal: { name: 'HEAL', tag: 'MEDIC' }
  };
  // DPS: a red blade. TANK: a silver shield. HEAL: a green medic cross.
  const SIGIL = {
    dps: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3l-1.2 4.6-9.3 9.3-3.4-3.4 9.3-9.3z" fill="currentColor"/><path d="M14.9 6.1l3 3" stroke="rgba(255,255,255,.55)" stroke-width="1"/><path d="M4.6 12.4l7 7-1.4 1.4-7-7z" fill="currentColor"/><path d="M6.6 16l1.4 1.4-3.6 3.6-1.4-1.4z" fill="currentColor"/><circle cx="3.6" cy="20.4" r="1.4" fill="currentColor"/></svg>',
    tank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z" fill="currentColor"/><path d="M12 4.3l6 2.2V11c0 3.9-2.5 7.3-6 8.8z" fill="rgba(255,255,255,.35)"/><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1"/></svg>',
    heal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z" fill="currentColor"/><path d="M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="1"/></svg>'
  };

  const Roles = {
    state: null,      // public heroRoles projection
    roomMode: null,
    roster: [],
    ritual: null,     // ritual:update (lockedIn opens the class picker)
    note: '',

    init() {
      if (this.initialized) return;
      this.initialized = true;
      document.addEventListener('click', e => this.click(e));
      new MutationObserver(records => {
        if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1))) this.scheduleDecorate();
      }).observe(document.body, { childList: true, subtree: true });
      const ritual = document.getElementById('ritual-overlay');
      if (ritual) new MutationObserver(() => this.render()).observe(ritual, { attributes: true, attributeFilter: ['hidden'] });
    },

    // ------------------------------------------------------------- inputs --
    onState(message) {
      if (!message) return;
      this.state = message.heroRoles || null;
      this.roomMode = message.roomMode || this.roomMode;
      this.render();
      this.scheduleDecorate();
    },
    onRitual(ritual) {
      const was = !!this.ritual?.lockedIn;
      this.ritual = ritual || null;
      this.render();
    },
    onPlayers(players) {
      this.roster = Array.isArray(players) ? players : [];
      this.render();
      this.scheduleDecorate();
    },
    onError(message) {
      this.note = String(message || '');
      this.render();
      clearTimeout(this._noteT);
      this._noteT = setTimeout(() => { this.note = ''; this.render(); }, 4000);
    },

    myId() { return String(window.PlayerApp?.playerId || ''); },

    // -------------------------------------------------------------- panel --
    // During the summon ritual the picker lives on the ritual screen (that is
    // when heroes choose); afterwards it sits on the battlefield.
    ensureDock() {
      let dock = document.getElementById('hero-role-dock');
      const ritual = document.getElementById('ritual-overlay');
      const status = document.querySelector('.detainee-status-module');
      const parent = ritual && !ritual.hidden
        ? ritual
        : (status || document.querySelector('#little-hero-hud .hero-hud-stats') || document.getElementById('chat-panel'));
      if (!parent) return dock;
      if (!dock) {
        dock = document.createElement('section');
        dock.id = 'hero-role-dock';
        dock.className = 'hero-role-dock';
        dock.setAttribute('aria-label', 'Hero role');
      }
      if (dock.parentElement !== parent) parent.appendChild(dock);
      dock.classList.toggle('in-ritual', parent === ritual);
      dock.classList.toggle('in-status', parent === status);
      return dock;
    },

    render() {
      if (isGM()) return this.renderGM();
      const s = this.state;
      // Before the battle the picker only opens after LOCK IN.
      const show = !!s && s.enabled && (s.live || (this.roomMode === 'BATTLE_ARMED' && !!this.ritual?.lockedIn));
      const dock = show ? this.ensureDock() : document.getElementById('hero-role-dock');
      if (!dock) return;
      dock.hidden = !show;
      if (!show) return;
      const mine = s.picks[this.myId()] || null;
      dock.dataset.role = mine || '';
      dock.classList.toggle('is-live', !!s.live);
      dock.classList.toggle('is-prompt', !s.live && !mine);
      dock.innerHTML = s.live ? this.liveHTML(s, mine) : this.pickHTML(s, mine);
    },

    teamHTML(s) {
      return `<div class="hr-team">${Object.keys(ROLES).map(r => {
        const count = Object.values(s.picks).filter(v => v === r).length;
        return `<span class="hr-team-role role-${r}" title="${ROLES[r].name}: ${count} hero${count === 1 ? '' : 'es'}"><i>${SIGIL[r]}</i>${count}</span>`;
      }).join('')}</div>`;
    },

    pickHTML(s, mine) {
      return `<header><b>LOCKED IN // CHOOSE YOUR CLASS</b><small>LOCKS WHEN THE BATTLE STARTS</small></header>
        <div class="hr-picks">${Object.entries(ROLES).map(([id, r]) => `
          <button type="button" class="hr-pick role-${id}${mine === id ? ' is-picked' : ''}" data-hr="pick" data-role="${id}" aria-pressed="${mine === id}">
            <i>${SIGIL[id]}</i><b>${r.name}</b><small>${r.tag}</small>
          </button>`).join('')}</div>
        ${this.teamHTML(s)}
        ${this.note ? `<p class="hr-note">${esc(this.note)}</p>` : ''}`;
    },

    liveHTML(s, mine) {
      const head = mine
        ? `<header class="role-${mine}"><i>${SIGIL[mine]}</i><b>${ROLES[mine].name}</b><small>${ROLES[mine].tag}</small></header>`
        : '<header><b>NO ROLE</b><small>ROLES LOCKED FOR THIS BATTLE</small></header>';
      return `${head}${this.teamHTML(s)}${this.note ? `<p class="hr-note">${esc(this.note)}</p>` : ''}`;
    },

    // Shadow Broker: a session switch in the command rail.
    renderGM() {
      let btn = document.getElementById('hero-roles-toggle');
      if (!btn) {
        const row = document.querySelector('.battle-controls-utility-row');
        if (!row) return;
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'hero-roles-toggle';
        btn.className = 'toolbar-btn hero-roles-toggle';
        btn.dataset.hr = 'gm-toggle';
        // Appended LAST: the Shadow Broker's own order (QUESTS, TRANSMOG,
        // BACKDOOR) must never shift. Anything new goes after it.
        row.appendChild(btn);
      }
      const on = this.state ? this.state.enabled !== false : true;
      btn.textContent = `ROLES ${on ? 'ON' : 'OFF'}`;
      btn.classList.toggle('is-off', !on);
      btn.title = on ? 'DPS / TANK / HEAL badges are on. Click to switch them off for this session.' : 'Hero roles are off. Click to switch them on.';
    },

    click(e) {
      const el = e.target.closest('[data-hr]');
      if (!el || el.disabled) return;
      const a = el.dataset.hr;
      e.preventDefault();
      const send = m => host()?.send?.(m);
      if (a === 'gm-toggle') { const on = this.state ? this.state.enabled !== false : true; if (confirm(on ? 'SWITCH HERO ROLES OFF FOR THIS SESSION?' : 'SWITCH HERO ROLES ON?')) send({ type: 'gm:heroRoles', enabled: !on }); return; }
      if (a === 'pick') return send({ type: 'heroRole:pick', role: el.dataset.role });
    },

    // ------------------------------------------------------------ badges --
    scheduleDecorate() {
      if (this._decorating) return;
      this._decorating = true;
      requestAnimationFrame(() => { this._decorating = false; this.decorate(); });
    },
    decorate() {
      const s = this.state;
      const picks = s && s.enabled !== false && s.live ? s.picks || {} : {};
      document.querySelectorAll('[data-dossier]').forEach(nameEl => {
        const role = picks[String(nameEl.dataset.dossier)] || null;
        let badge = nameEl.querySelector(':scope > .hero-role-sigil');
        if (!role) { badge?.remove(); return; }
        if (badge?.dataset.role === role) return;
        badge?.remove();
        badge = document.createElement('i');
        badge.className = `hero-role-sigil role-${role}`;
        badge.dataset.role = role;
        badge.title = ROLES[role].name;
        badge.innerHTML = SIGIL[role];
        nameEl.appendChild(badge);
      });
    }
  };

  window.HeroRoles = Roles;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Roles.init(), { once: true });
  else Roles.init();
})();
