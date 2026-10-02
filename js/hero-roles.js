// HERO ROLES -- DPS / TANK / HEAL, on the Little Hero page and the Shadow
// Broker console. Presentation + intents only: the server (hero-roles.js via
// server.js) decides every pick, charge, clue and WOMF effect.
//
//   Little Hero: pick a role before the battle; once it is live, use the
//   role's one ability (BURST a column / LAST STAND a column / RESURRECT a
//   teammate) from the role panel.
//   Everyone: the BURST card, TANK shields on marked columns, role sigils
//   beside names.
//   Shadow Broker: ROLES ON/OFF for the session.
(() => {
  'use strict';
  const isGM = () => !!window.App && !window.PlayerApp;
  const host = () => (isGM() ? window.App : window.PlayerApp);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLUMNS = ['A', 'B', 'C', 'D'];
  const ROLES = {
    dps: { name: 'DPS', ability: 'BURST', verb: 'Show the room the next clue of a column.', color: '#ff4a5c' },
    tank: { name: 'TANK', ability: 'LAST STAND', verb: 'Shield a column: if it FAILS, no WOMF.', color: '#5aa9ff' },
    heal: { name: 'HEAL', ability: 'RESURRECTION', verb: "Give a teammate's used ability back.", color: '#62f0a0' }
  };
  const SIGIL = {
    dps: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l9 9-2 2-9-9V3h2zm16 0v2l-9 9-2-2 9-9h2zM6 15l3 3-3 3-1.5-1.5L6 18l-1.5-1.5zm12 0l1.5 1.5L18 18l1.5 1.5L18 21l-3-3z" fill="currentColor"/></svg>',
    tank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z" fill="currentColor"/><path d="M12 5v14" stroke="rgba(0,0,0,.45)" stroke-width="1.6"/></svg>',
    heal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4v6h6v4h-6v8h-4v-8H4V9h6z" fill="currentColor"/></svg>'
  };

  const Roles = {
    state: null,      // public heroRoles projection
    roomMode: null,
    roster: [],
    targeting: false,
    note: '',

    init() {
      if (this.initialized) return;
      this.initialized = true;
      document.addEventListener('click', e => this.click(e));
      new MutationObserver(records => {
        if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1))) this.scheduleDecorate();
      }).observe(document.body, { childList: true, subtree: true });
      setInterval(() => this.tickBurst(), 200);
      const ritual = document.getElementById('ritual-overlay');
      if (ritual) new MutationObserver(() => this.render()).observe(ritual, { attributes: true, attributeFilter: ['hidden'] });
    },

    // ------------------------------------------------------------- inputs --
    onState(message) {
      if (!message) return;
      this.state = message.heroRoles || null;
      this.roomMode = message.roomMode || this.roomMode;
      if (this.state?.live === false || !this.state?.enabled) this.targeting = false;
      this.render();
      this.scheduleDecorate();
    },
    onPlayers(players) {
      this.roster = Array.isArray(players) ? players : [];
      this.render();
      this.scheduleDecorate();
    },
    onError(message) {
      this.note = String(message || '');
      this.targeting = false;
      this.render();
      clearTimeout(this._noteT);
      this._noteT = setTimeout(() => { this.note = ''; this.render(); }, 4000);
    },

    myId() { return String(window.PlayerApp?.playerId || ''); },
    battleSurface() { return this.roomMode === 'BATTLE' || this.roomMode === 'BATTLE_ARMED'; },
    nameOf(id) { return this.roster.find(p => String(p.id) === String(id))?.name || 'LITTLE HERO'; },

    // -------------------------------------------------------------- panel --
    // During the summon ritual the picker lives on the ritual screen (that is
    // when heroes choose); afterwards it sits on the battlefield.
    ensureDock() {
      let dock = document.getElementById('hero-role-dock');
      const ritual = document.getElementById('ritual-overlay');
      const parent = ritual && !ritual.hidden ? ritual : document.getElementById('board-layer');
      if (!parent) return dock;
      if (!dock) {
        dock = document.createElement('section');
        dock.id = 'hero-role-dock';
        dock.className = 'hero-role-dock';
        dock.setAttribute('aria-label', 'Hero role');
      }
      if (dock.parentElement !== parent) parent.appendChild(dock);
      dock.classList.toggle('in-ritual', parent === ritual);
      return dock;
    },

    render() {
      if (isGM()) return this.renderGM();
      const s = this.state;
      const show = !!s && s.enabled && this.battleSurface();
      const dock = show ? this.ensureDock() : document.getElementById('hero-role-dock');
      if (!dock) return;
      dock.hidden = !show;
      if (!show) return;
      const mine = s.picks[this.myId()] || null;
      dock.dataset.role = mine || '';
      dock.innerHTML = s.live ? this.liveHTML(s, mine) : this.pickHTML(s, mine);
    },

    teamHTML(s) {
      return `<div class="hr-team">${Object.keys(ROLES).map(r => {
        const count = Object.values(s.picks).filter(v => v === r).length;
        return `<span class="hr-team-role role-${r}" title="${ROLES[r].name}: ${count} hero${count === 1 ? '' : 'es'}, ${ROLES[r].ability} used ${s.roleUses[r]}/${s.cap}"><i>${SIGIL[r]}</i>${count}<small>${s.roleUses[r]}/${s.cap}</small></span>`;
      }).join('')}</div>`;
    },

    pickHTML(s, mine) {
      return `<header><b>CHOOSE YOUR ROLE</b><small>LOCKS WHEN THE BATTLE STARTS</small></header>
        <div class="hr-picks">${Object.entries(ROLES).map(([id, r]) => `
          <button type="button" class="hr-pick role-${id}${mine === id ? ' is-picked' : ''}" data-hr="pick" data-role="${id}" aria-pressed="${mine === id}">
            <i>${SIGIL[id]}</i><b>${r.name}</b><small>${r.ability}</small><span>${esc(r.verb)}</span>
          </button>`).join('')}</div>
        ${this.teamHTML(s)}
        ${this.note ? `<p class="hr-note">${esc(this.note)}</p>` : ''}`;
    },

    liveHTML(s, mine) {
      if (!mine) return `<header><b>NO ROLE</b><small>ROLES LOCKED FOR THIS BATTLE</small></header>${this.teamHTML(s)}`;
      const r = ROLES[mine];
      const used = !!s.used[this.myId()];
      const capped = !used && s.roleUses[mine] >= s.cap;
      const status = used ? 'USED' : capped ? `TEAM ${s.cap}/${s.cap}` : 'READY';
      let targets = '';
      if (this.targeting && !used && !capped) {
        if (mine === 'heal') {
          const list = Object.entries(s.picks).filter(([id, role]) => id !== this.myId() && role !== 'heal' && s.used[id]);
          targets = list.length
            ? `<div class="hr-targets is-heroes">${list.map(([id, role]) => `<button type="button" data-hr="resurrect" data-target="${esc(id)}" class="role-${role}"><i>${SIGIL[role]}</i>${esc(this.nameOf(id))}</button>`).join('')}</div>`
            : '<p class="hr-note">NO TEAMMATE HAS SPENT AN ABILITY YET.</p>';
        } else {
          targets = `<div class="hr-targets">${COLUMNS.map(c => `<button type="button" data-hr="${mine === 'dps' ? 'burst' : 'lastStand'}" data-column="${c}" ${mine === 'tank' && s.marks[c] ? 'disabled' : ''}>${c}</button>`).join('')}<button type="button" class="is-cancel" data-hr="cancel">×</button></div>`;
        }
      }
      return `<header class="role-${mine}"><i>${SIGIL[mine]}</i><b>${r.name}</b><small>${r.ability}</small><em class="hr-status is-${status === 'READY' ? 'ready' : 'spent'}">${status}</em></header>
        ${targets || `<button type="button" class="hr-use role-${mine}" data-hr="use" ${used || capped ? 'disabled' : ''}>${used ? `${r.ability} SPENT` : capped ? 'TEAM LIMIT REACHED' : `USE ${r.ability}`}</button>`}
        ${this.teamHTML(s)}
        ${this.note ? `<p class="hr-note">${esc(this.note)}</p>` : ''}`;
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
        const transmog = document.getElementById('broker-transmog-btn');
        row.insertBefore(btn, transmog ? transmog.nextSibling : row.children[1] || null);
      }
      const on = this.state ? this.state.enabled !== false : true;
      btn.textContent = `ROLES ${on ? 'ON' : 'OFF'}`;
      btn.classList.toggle('is-off', !on);
      btn.title = on ? 'DPS / TANK / HEAL are active. Click to switch them off for this session.' : 'Hero roles are off. Click to switch them on.';
    },

    click(e) {
      const el = e.target.closest('[data-hr]');
      if (!el || el.disabled) return;
      const a = el.dataset.hr;
      e.preventDefault();
      const send = m => host()?.send?.(m);
      if (a === 'gm-toggle') { const on = this.state ? this.state.enabled !== false : true; if (confirm(on ? 'SWITCH HERO ROLES OFF FOR THIS SESSION?' : 'SWITCH HERO ROLES ON?')) send({ type: 'gm:heroRoles', enabled: !on }); return; }
      if (a === 'pick') return send({ type: 'heroRole:pick', role: el.dataset.role });
      if (a === 'use') { this.targeting = true; this.note = ''; return this.render(); }
      if (a === 'cancel') { this.targeting = false; return this.render(); }
      if (a === 'burst' || a === 'lastStand') { this.targeting = false; this.render(); return send({ type: `heroRole:${a}`, column: el.dataset.column }); }
      if (a === 'resurrect') { this.targeting = false; this.render(); return send({ type: 'heroRole:resurrect', targetId: el.dataset.target }); }
    },

    // -------------------------------------------------------------- BURST --
    onBurst(m) {
      if (!m) return;
      const skew = Number(m.serverNow) ? Number(m.serverNow) - Date.now() : 0;
      this.burst = { column: m.column, clue: String(m.clue || ''), byName: m.byName, until: Number(m.until) - skew, total: Math.max(1000, Number(m.until) - Number(m.serverNow || Date.now())) };
      document.getElementById('hero-burst')?.remove();
      const el = document.createElement('div');
      el.id = 'hero-burst';
      el.className = 'hero-burst';
      el.setAttribute('role', 'status');
      const isImage = /^(data:image\/|https?:\/\/|\/|assets\/).+\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(this.burst.clue) || /^data:image\//.test(this.burst.clue);
      el.innerHTML = `<div class="hero-burst-card">
        <header><i>${SIGIL.dps}</i><b>BURST // COLUMN ${esc(m.column)}</b><small>${esc(m.byName || 'DPS')} TORE IT OPEN</small></header>
        <div class="hero-burst-clue">${isImage ? `<img src="${esc(this.burst.clue)}" alt="">` : esc(this.burst.clue)}</div>
        <div class="hero-burst-bar"><span></span></div>
        <small class="hero-burst-foot">THE NEXT CLUE OF COLUMN ${esc(m.column)}. IT CLOSES IN <b data-burst-left></b>s.</small>
      </div>`;
      (document.getElementById('board-layer') || document.body).appendChild(el);
      this.tickBurst();
    },
    tickBurst() {
      const el = document.getElementById('hero-burst');
      if (!el || !this.burst) return;
      const left = this.burst.until - Date.now();
      if (left <= 0) { el.remove(); this.burst = null; return; }
      el.querySelector('.hero-burst-bar span').style.width = `${Math.max(0, Math.min(100, (left / this.burst.total) * 100))}%`;
      const n = el.querySelector('[data-burst-left]');
      if (n) n.textContent = String(Math.ceil(left / 1000));
    },

    // ------------------------------------------------- shields + sigils --
    scheduleDecorate() {
      if (this._decorating) return;
      this._decorating = true;
      requestAnimationFrame(() => { this._decorating = false; this.decorate(); });
    },
    decorate() {
      const s = this.state;
      const on = !!s && s.enabled !== false;
      COLUMNS.forEach(c => {
        document.querySelectorAll(`[data-label="${c}5"]`).forEach(cell => cell.toggleAttribute('data-hero-shield', on && !!s.marks?.[c]));
      });
      const picks = on ? s.picks || {} : {};
      document.querySelectorAll('[data-dossier]').forEach(nameEl => {
        const role = picks[String(nameEl.dataset.dossier)] || null;
        let badge = nameEl.querySelector(':scope > .hero-role-sigil');
        if (!role) { badge?.remove(); return; }
        if (badge?.dataset.role === role) return;
        badge?.remove();
        badge = document.createElement('i');
        badge.className = `hero-role-sigil role-${role}`;
        badge.dataset.role = role;
        badge.title = `${ROLES[role].name} // ${ROLES[role].ability}`;
        badge.innerHTML = SIGIL[role];
        nameEl.appendChild(badge);
      });
    }
  };

  window.HeroRoles = Roles;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Roles.init(), { once: true });
  else Roles.init();
})();
