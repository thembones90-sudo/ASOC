(() => {
  'use strict';

  const ROLE_META = {
    dps: { label: 'DPS', icon: '⚔', perk: 'Execute / Rapid Strike' },
    tank: { label: 'WARRIOR', icon: '🛡', perk: 'Guard / Taunt / Shield Wall' },
    heal: { label: 'HEALER', icon: '✦', perk: 'Heal / 2 Resurrections' }
  };

  const DragonRaid = {
    raid: null,
    serverNow: 0,
    receivedAt: 0,
    note: '',
    myLastRoll: null,
    myHeartRoll: null,
    hiddenRaidId: null,
    ticker: null,

    init() {
      if (this.initialized) return;
      this.initialized = true;
      document.addEventListener('click', event => this.click(event));
      this.ensureSetup();
      this.ticker = setInterval(() => this.tick(), 250);
    },

    ensureSetup() {
      if (!this.isGM() || document.getElementById('dragon-raid-setup-overlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'dragon-raid-setup-overlay';
      overlay.className = 'dragon-setup-overlay';
      overlay.hidden = true;
      const bosses = [
        ['varkhul', 'WENDIGO', 'HUNGER // ISOLATION // PREDATION', 'CABINET ENCOUNTER // 3–5 HEROES'],
        ['kraevar', 'HYM', 'GUILT // SHADOW // POSSESSION', 'CABINET ENCOUNTER // 3–5 HEROES'],
        ['azhraak', 'AZHRAAK, LORD OF THE BURNING VAULT', 'INFERNO // PARTY-WIDE FIRE', 'NORMAL RAID // 3–5 HEROES'],
        ['drazhul', 'DRAZHUL, KEEPER OF THE SHADOW HEART', 'SHADOW VEIL // DRAIN AND DEBUFFS', 'NORMAL RAID // 3–5 HEROES'],
        ['deathwing', 'DEATHWING', 'THE DESTROYER // CATACLYSM', 'HEROIC RAID // EXACTLY 5 HEROES']
      ];
      overlay.innerHTML = `<section class="dragon-setup-panel" role="dialog" aria-modal="true" aria-labelledby="dragon-setup-title">
        <header><div><small>SHADOW BROKER AUTHORITY</small><h2 id="dragon-setup-title">CABINET OF CURIOSITIES</h2></div><button type="button" data-dragon-action="setup-close" aria-label="Close">×</button></header>
        <p>Choose the enemy. Recruitment begins only after your confirmation.</p>
        <div class="dragon-setup-grid">${bosses.map(([id,name,identity,tier]) => `<button type="button" data-dragon-action="setup-launch" data-boss-id="${id}" class="${id === 'deathwing' ? 'is-heroic' : ''}"><small>${tier}</small><b>${name}</b><span>${identity}</span><em>SUMMON</em></button>`).join('')}</div>
      </section>`;
      document.body.appendChild(overlay);
    },

    openSetup() {
      this.ensureSetup();
      const overlay = document.getElementById('dragon-raid-setup-overlay');
      if (overlay) overlay.hidden = false;
    },

    closeSetup() {
      const overlay = document.getElementById('dragon-raid-setup-overlay');
      if (overlay) overlay.hidden = true;
    },

    isGM() {
      return !!window.App && !window.PlayerApp;
    },

    myId() {
      return String(window.PlayerApp?.playerId || '');
    },

    send(payload) {
      return this.isGM() ? window.App?.send?.(payload) : window.PlayerApp?.send?.(payload);
    },

    onState(raid, serverNow) {
      if (!raid) {
        this.raid = null;
        this.render();
        return;
      }
      this.raid = raid;
      this.serverNow = Number(serverNow) || Date.now();
      this.receivedAt = Date.now();
      if (this.hiddenRaidId && this.hiddenRaidId !== raid.id) this.hiddenRaidId = null;
      this.render();
    },

    onMessage(message) {
      if (!message) return;
      if (message.type === 'dragon:update') {
        this.onState(message.raid, message.serverNow);
        if (message.heartTie) this.note = 'THE HEART REJECTS EQUALITY // TIED HEROES ROLL AGAIN';
        return;
      }
      if (message.type === 'dragon:error') {
        this.note = String(message.message || 'THE DRAGON REFUSES');
        this.render();
        clearTimeout(this._noteTimer);
        this._noteTimer = setTimeout(() => {
          this.note = '';
          this.render();
        }, 4200);
        return;
      }
      if (message.type === 'dragon:actionResult') {
        this.myLastRoll = { round: Number(message.result?.round) || 0, value: Number(message.result?.roll) || 0 };
        this.render();
        return;
      }
      if (message.type === 'dragon:heartRollResult') {
        this.myHeartRoll = { round: Number(message.round) || 0, value: Number(message.value) || 0 };
        this.render();
      }
    },

    now() {
      if (!this.serverNow || !this.receivedAt) return Date.now();
      return this.serverNow + (Date.now() - this.receivedAt);
    },

    remaining(deadline) {
      return Math.max(0, Number(deadline || 0) - this.now());
    },

    clock(ms) {
      const total = Math.ceil(Math.max(0, ms) / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    },

    esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[c]);
    },

    ensureOverlay() {
      let overlay = document.getElementById('dragon-raid-overlay');
      if (overlay) return overlay;
      overlay = document.createElement('section');
      overlay.id = 'dragon-raid-overlay';
      overlay.className = 'dragon-raid-overlay';
      overlay.setAttribute('aria-live', 'polite');
      overlay.innerHTML = '<div class="dragon-raid-shell"></div>';
      document.body.appendChild(overlay);
      return overlay;
    },

    roleName(role) {
      return ROLE_META[role]?.label || String(role || '').toUpperCase();
    },

    participantHTML(p) {
      const meta = ROLE_META[p.role] || { label: p.role, icon: '◆' };
      const pct = p.maxHp ? Math.max(0, Math.min(100, Math.round((p.hp / p.maxHp) * 100))) : 0;
      const statuses = Object.entries(p.statuses || {}).filter(([, value]) => !!value).map(([key, value]) => `${key.toUpperCase()}${typeof value === 'number' && value > 1 ? ' ' + value : ''}`);
      const cooldowns = Object.entries(p.cooldowns || {}).filter(([, value]) => value > 0).map(([key, value]) => `${key.toUpperCase()} CD${value}`);
      return `<article class="dragon-raider-card ${p.alive ? '' : 'is-fallen'}" data-role="${this.esc(p.role)}">
        <header><span class="dragon-role-icon">${meta.icon}</span><b>${this.esc(p.name)}</b><small>${this.esc(meta.label)}</small></header>
        <div class="dragon-raider-hp"><i style="width:${pct}%"></i></div>
        <footer><span>♥ ${p.hp} / ${p.maxHp}</span>${p.role === 'heal' ? `<span>✦ ${p.resurrectionCharges} RES</span>` : ''}<span>⚔ ${p.damage}</span></footer>
        ${p.alive ? `<em>${this.raid.activePlayerId === p.id ? '◆ ACTIVE TURN' : 'AWAITING TURN'}${statuses.length ? ' // ' + statuses.join(' · ') : ''}${cooldowns.length ? ' // ' + cooldowns.join(' · ') : ''}</em>` : '<em>☠ FALLEN</em>'}
      </article>`;
    },

    partySlotsHTML() {
      const raid = this.raid;
      const cards = (raid?.participants || []).map(p => this.participantHTML(p));
      while (cards.length < 5) cards.push('<article class="dragon-raider-card is-empty"><b>EMPTY</b><small>RAID SLOT</small></article>');
      return cards.join('');
    },

    recruitmentHTML() {
      const raid = this.raid;
      const mine = raid.participants.find(p => String(p.id) === this.myId());
      const full = raid.participants.length >= raid.maxRaiders;
      const choose = !this.isGM() && !mine && !full
        ? `<div class="dragon-class-pick">
            <button data-dragon-action="join" data-role="tank"><b>🛡 WARRIOR</b><small>15 HP</small></button>
            <button data-dragon-action="join" data-role="dps"><b>⚔ DPS</b><small>EXECUTE / RAPID STRIKE</small></button>
            <button data-dragon-action="join" data-role="heal"><b>✦ HEALER</b><small>2× RESURRECTION</small></button>
          </div>`
        : mine
          ? `<div class="dragon-locked">RAID SLOT CLAIMED // ${this.roleName(mine.role)}</div>`
          : full && !this.isGM()
            ? '<div class="dragon-locked">RAID FULL // YOU SNOOZE, YOU LOSE</div>'
            : '';
      return `
        <div class="dragon-heading">
          <span class="dragon-mark">🐉</span>
          <div><small>${raid.boss.heroic ? 'HEROIC WORLD EVENT' : 'DRAGON RAID'}</small><h1>${this.esc(raid.boss.name)} HAS AWAKENED</h1></div>
          <strong data-dragon-clock="recruit">${this.clock(this.remaining(raid.recruitEndsAt))}</strong>
        </div>
        <p class="dragon-lore">Heroes act in order. Then the dragon answers. ${raid.boss.heroic ? 'Deathwing accepts exactly five victims.' : 'Three may challenge it. Five may enter.'}</p>
        <div class="dragon-party-count">RAID PARTY <b>${raid.participants.length} / 5</b> <span>MINIMUM 3</span></div>
        <div class="dragon-raider-grid">${this.partySlotsHTML()}</div>
        ${choose}
      `;
    },

    battleHTML() {
      const raid = this.raid;
      const mine = raid.participants.find(p => String(p.id) === this.myId());
      const hpPct = Math.max(0, Math.min(100, raid.dragonHp / raid.dragonMaxHp * 100));
      const myTurn = !this.isGM() && raid.phase === 'HERO_TURN' && mine?.alive && raid.activePlayerId === mine.id;
      const active = raid.participants.find(p => p.id === raid.activePlayerId);
      const targetOptions = raid.participants.map(p => `<option value="${this.esc(p.id)}">${this.esc(p.name)} // ${p.alive ? p.hp + ' HP' : 'FALLEN'}</option>`).join('');
      let actions = '';
      if (myTurn) {
        const roleActions = mine.role === 'tank'
          ? `<button data-dragon-action="act" data-ability="taunt">TAUNT</button><button data-dragon-action="act" data-ability="shieldWall" ${mine.shieldWall ? '' : 'disabled'}>SHIELD WALL (${mine.shieldWall})</button>`
          : mine.role === 'heal'
            ? `<button data-dragon-action="act" data-ability="heal">HEAL TARGET</button><button data-dragon-action="act" data-ability="resurrect" ${mine.resurrectionCharges ? '' : 'disabled'}>RESURRECT (${mine.resurrectionCharges})</button>`
            : `<button data-dragon-action="act" data-ability="execute" ${mine.cooldowns?.execute ? 'disabled' : ''}>EXECUTE (${mine.cooldowns?.execute || 'READY'})</button><button data-dragon-action="act" data-ability="rapid" ${mine.cooldowns?.rapid ? 'disabled' : ''}>RAPID STRIKE (${mine.cooldowns?.rapid || 'READY'})</button>`;
        actions = `<div class="dragon-action-tray"><select id="dragon-action-target">${targetOptions}</select><button class="dragon-primary" data-dragon-action="act" data-ability="attack">ATTACK // ROLL D20</button>${roleActions}</div>`;
      }
      const last = raid.lastAction ? `<div class="dragon-round-feed"><span class="${this.esc(raid.lastAction.result)}"><b>${this.esc(raid.lastAction.name)}</b> // ${this.esc(raid.lastAction.action || raid.lastAction.result)} // D20 ${raid.lastAction.roll} ${raid.lastAction.damage ? '// ' + raid.lastAction.damage + ' DAMAGE' : ''}</span></div>` : '';
      return `
        <div class="dragon-heading">
          <span class="dragon-mark is-burning">🐉</span>
          <div><small>${raid.boss.heroic ? 'HEROIC RAID' : 'NORMAL RAID'} // ROUND ${raid.round} // ${raid.phase === 'BOSS_TURN' ? 'BOSS PHASE' : 'HERO PHASE'}</small><h1>${this.esc(raid.boss.name)}</h1><small>${this.esc(raid.boss.passive)}${raid.boss.wrath ? ` // WRATH ${raid.boss.wrath}` : ''}${raid.worldBreaker ? ' // WORLD BREAKER' : ''}${raid.sunder ? ' // SUNDERED' : ''}</small></div>
          <strong data-dragon-clock="battle">${this.clock(this.remaining(raid.battleEndsAt))}</strong>
        </div>
        <div class="dragon-boss-hp">
          <div><b>${this.esc(raid.boss.name)}</b><strong>♥ ${raid.dragonHp} / ${raid.dragonMaxHp}</strong></div>
          <span><i style="width:${hpPct}%"></i></span>
        </div>
        <div class="dragon-raider-grid">${this.partySlotsHTML()}</div>
        <div class="dragon-turn-banner">${raid.phase === 'BOSS_TURN' ? '🐉 THE DRAGON MOVES' : `ACTIVE HERO // ${this.esc(active?.name || '—')}`}</div>
        ${actions}
        ${!myTurn && mine?.alive ? '<div class="dragon-locked">WAIT FOR YOUR TURN</div>' : ''}
        ${!mine && !this.isGM() ? '<div class="dragon-locked">SPECTATING // RAID GATES SEALED</div>' : ''}
        ${this.myLastRoll && this.myLastRoll.round === raid.round ? `<div class="dragon-own-roll">YOUR ROLL // <b>${this.myLastRoll.value}</b></div>` : ''}
        ${last}
      `;
    },

    heartHTML() {
      const raid = this.raid;
      const heart = raid.heart || {};
      const mine = raid.participants.find(p => String(p.id) === this.myId());
      const eligible = !!mine?.alive && (heart.contenders || []).includes(this.myId());
      const rolled = !!heart.rolls?.[this.myId()];
      const lootRows = (raid.loot?.survivors || []).map(id => {
        const p = raid.participants.find(x => String(x.id) === String(id));
        return `<span><b>${this.esc(p?.name || id)}</b><strong>+${raid.loot.shares[id] || 0} SC</strong></span>`;
      }).join('');
      const heartRows = (heart.contenders || []).map(id => {
        const p = raid.participants.find(x => String(x.id) === String(id));
        const value = heart.rolls?.[id];
        return `<span><b>${this.esc(p?.name || id)}</b><strong>${value || '—'}</strong></span>`;
      }).join('');
      return `
        <div class="dragon-heading victory">
          <span class="dragon-mark">☠</span>
          <div><small>THE BEAST HAS FALLEN</small><h1>THE HOARD BREAKS OPEN</h1></div>
          <strong>VICTORY</strong>
        </div>
        <div class="dragon-hoard"><small>DRAGON HOARD</small><b>🪙 ${raid.loot?.total || 0}</b><div>${lootRows}</div></div>
        <div class="dragon-heart">
          <small>GUARANTEED BOSS RELIC</small>
          <h2>🖤 HEART OF THE SHADOW</h2>
          <p>Only the living may claim it.</p>
          <div class="dragon-heart-rolls">${heartRows}</div>
          ${!this.isGM() && eligible && !rolled ? '<button class="dragon-primary heart" data-dragon-action="heart">ROLL FOR THE HEART</button>' : ''}
          ${!this.isGM() && eligible && rolled ? '<div class="dragon-locked">HEART ROLL COMMITTED</div>' : ''}
          ${!this.isGM() && mine && !mine.alive ? '<div class="dragon-dead-loot">☠ YOU ARE DEAD // NO HEART // NO LOOT</div>' : ''}
        </div>
      `;
    },

    completeHTML() {
      const raid = this.raid;
      const winner = raid.heart?.winnerName || 'UNKNOWN';
      const shares = raid.loot?.shares || {};
      const lootRows = Object.entries(shares).map(([id, amount]) => {
        const p = raid.participants.find(x => String(x.id) === String(id));
        return `<span><b>${this.esc(p?.name || id)}</b><strong>+${amount} SC</strong></span>`;
      }).join('');
      return `
        <div class="dragon-heading victory">
          <span class="dragon-mark">🖤</span>
          <div><small>RAID COMPLETE</small><h1>THE HEART HAS CHOSEN</h1></div>
          <strong>SLAIN</strong>
        </div>
        <div class="dragon-summary-grid">
          <div><small>ROUNDS</small><b>${raid.round}</b></div>
          <div><small>SURVIVORS</small><b>${raid.loot?.survivors?.length || 0}</b></div>
          <div><small>HOARD</small><b>${raid.loot?.total || 0}</b></div>
        </div>
        <div class="dragon-hoard"><div>${lootRows}</div></div>
        <div class="dragon-heart winner"><small>HEART OF THE SHADOW</small><h2>🖤 ${this.esc(winner)}</h2></div>
        <button class="dragon-secondary" data-dragon-action="hide">CLOSE RAID REPORT</button>
      `;
    },

    failureHTML() {
      const raid = this.raid;
      const aborted = raid.phase === 'ABORTED';
      const reason = raid.result?.reason === 'TIME_EXPIRED'
        ? 'TIME EXPIRED'
        : raid.result?.reason === 'PARTY_WIPE'
          ? 'THE RAID PARTY HAS FALLEN'
          : 'TOO FEW RAIDERS';
      return `
        <div class="dragon-heading defeat">
          <span class="dragon-mark">🐉</span>
          <div><small>${aborted ? 'RAID ABORTED' : 'RAID FAILED'}</small><h1>${reason}</h1></div>
          <strong>${aborted ? 'WITHDRAWN' : 'DEFEAT'}</strong>
        </div>
        <p class="dragon-lore">${aborted ? 'The Dragon finds the turnout beneath its contempt.' : 'The Dragon survives. Its hoard remains untouched.'}</p>
        <div class="dragon-dead-loot">${aborted ? 'NO PENALTY' : 'NO COINS // NO HEART OF THE SHADOW'}</div>
        <button class="dragon-secondary" data-dragon-action="hide">CLOSE RAID REPORT</button>
      `;
    },

    render() {
      const raid = this.raid;
      const existing = document.getElementById('dragon-raid-overlay');
      if (!raid || this.hiddenRaidId === raid.id) {
        if (existing) existing.hidden = true;
        return;
      }
      const overlay = this.ensureOverlay();
      overlay.hidden = false;
      overlay.dataset.phase = raid.phase || '';
      const shell = overlay.querySelector('.dragon-raid-shell');
      let body = '';
      if (raid.phase === 'RECRUITING') body = this.recruitmentHTML();
      else if (['HERO_TURN', 'BOSS_TURN', 'VICTORY'].includes(raid.phase)) body = this.battleHTML();
      else if (raid.phase === 'HEART') body = this.heartHTML();
      else if (raid.phase === 'COMPLETE') body = this.completeHTML();
      else body = this.failureHTML();
      shell.innerHTML = `
        <div class="dragon-embers" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        ${body}
        ${this.note ? `<div class="dragon-note">${this.esc(this.note)}</div>` : ''}
      `;
    },

    tick() {
      const raid = this.raid;
      if (!raid) return;
      const overlay = document.getElementById('dragon-raid-overlay');
      if (!overlay || overlay.hidden) return;
      const recruit = overlay.querySelector('[data-dragon-clock="recruit"]');
      if (recruit) recruit.textContent = this.clock(this.remaining(raid.recruitEndsAt));
      const battle = overlay.querySelector('[data-dragon-clock="battle"]');
      if (battle) {
        const left = this.remaining(raid.battleEndsAt);
        battle.textContent = this.clock(left);
        battle.classList.toggle('is-critical', left <= 60000);
        battle.classList.toggle('is-terminal', left <= 10000);
      }
    },

    click(event) {
      const button = event.target.closest('[data-dragon-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.dragonAction;
      if (action === 'setup-open') return this.openSetup();
      if (action === 'setup-close') return this.closeSetup();
      if (action === 'setup-launch') {
        const bossId = button.dataset.bossId;
        this.closeSetup();
        return this.send({ type: 'gm:dragonRaid', bossId });
      }
      if (action === 'join') {
        button.disabled = true;
        return this.send({ type: 'dragon:join', role: button.dataset.role });
      }
      if (action === 'act') {
        button.disabled = true;
        const targetId = document.getElementById('dragon-action-target')?.value || '';
        return this.send({ type: 'dragon:action', action: button.dataset.ability || 'attack', targetId });
      }
      if (action === 'heart') {
        button.disabled = true;
        return this.send({ type: 'dragon:heartRoll' });
      }
      if (action === 'hide') {
        this.hiddenRaidId = this.raid?.id || null;
        this.render();
      }
    }
  };

  window.DragonRaid = DragonRaid;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => DragonRaid.init(), { once: true });
  else DragonRaid.init();
})();
