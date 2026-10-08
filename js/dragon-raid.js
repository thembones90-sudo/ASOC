(() => {
  'use strict';

  const ROLE_META = {
    dps: { label: 'DPS', icon: '⚔', perk: 'Execute / Rapid Strike' },
    tank: { label: 'WARRIOR', icon: '🛡', perk: 'Guard / Taunt / Shield Wall' },
    heal: { label: 'HEALER', icon: '✦', perk: 'Heal / 2 Resurrections' }
  };

  // Central portraits. Files live in assets/cabinet/ (one per specimen); the version tag busts caches when art is swapped.
  const ART_VERSION = '20261008-cabinet-art-1';
  const BOSS_ART = {
    wendigo: 'assets/cabinet/wendigo.webp',
    hym: 'assets/cabinet/hym.webp',
    hydra: 'assets/cabinet/hydra.webp',
    necromorph: 'assets/cabinet/necromorph.webp',
    deathwing: 'assets/cabinet/deathwing.webp'
  };
  // Only short same-origin image paths are ever placed in an <img src>.
  const SAFE_AVATAR = /^\/?(?:avatars\/[a-f0-9]{32}\.(?:png|jpg|webp)|assets\/[A-Za-z0-9_\-\/.]{1,160}\.(?:png|jpe?g|webp|svg|gif))$/;

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
      // Broken portrait -> graceful fallback (capture phase: image errors do not bubble).
      document.addEventListener('error', event => this.portraitError(event.target), true);
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
        ['wendigo', 'WENDIGO', 'IT HEARS THE WEAK. IT HUNTS THE ALONE.', 'SPECIMEN I — 3–5 LITTLE HEROES', 'BREAK THE SEAL'],
        ['hym', 'HYM', 'YOUR GUILT FEEDS IT. YOUR FAILURE GIVES IT FORM.', 'SPECIMEN II — 3–5 LITTLE HEROES', 'LET IT IN'],
        ['hydra', 'HYDRA', 'SEVEN HEADS. SEVEN HUNGERS. ONE SWAMP.', 'SPECIMEN III — 3–5 LITTLE HEROES', 'WADE IN'],
        ['necromorph', 'NECROMORPH', 'IT SHOULD BE DEAD. IT DID NOT GET THE MESSAGE.', 'SPECIMEN IV — 3–5 LITTLE HEROES', 'OPEN THE AIRLOCK'],
        ['deathwing', 'DEATHWING', 'THE WORLD BREAKER. THIS ONE DOES NOT GO BACK IN THE CABINET.', 'HEROIC CALAMITY — EXACTLY FIVE LITTLE HEROES', 'WAKE THE DESTROYER']
      ];
      overlay.innerHTML = `<section class="dragon-setup-panel" role="dialog" aria-modal="true" aria-labelledby="dragon-setup-title">
        <header><div><small>SHADOW BROKER — FORBIDDEN ARCHIVE</small><h2 id="dragon-setup-title">CABINET OF CURIOSITIES</h2></div><button type="button" data-dragon-action="setup-close" aria-label="Close">×</button></header>
        <p>The Cabinet is open. Choose what the Little Heroes must survive.</p>
        <div class="dragon-setup-grid">${bosses.map(([id,name,identity,tier,action]) => `<button type="button" data-dragon-action="setup-launch" data-boss-id="${id}" class="${id === 'deathwing' ? 'is-heroic' : ''}"><small>${tier}</small><b>${name}</b><span>${identity}</span><em>${action}</em></button>`).join('')}</div>
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
      if (this.isGM() && ['RECRUITING','HERO_TURN','BOSS_TURN','VICTORY','HEART'].includes(raid.phase)) this.hiddenRaidId = null;
      this.render();
    },

    onMessage(message) {
      if (!message) return;
      if (message.type === 'dragon:update') {
        this.onState(message.raid, message.serverNow);
        if (message.heartTie) this.note = 'THE HEART REJECTS EQUALITY — TIED HEROES ROLL AGAIN';
        const combat = message.actionResult || message.bossResult || message.turnForfeited;
        if (combat) requestAnimationFrame(() => requestAnimationFrame(() => this.animateCombat(combat)));
        return;
      }
      if (message.type === 'dragon:error') {
        this.note = String(message.message || 'THE CABINET REFUSES');
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

    async animateCombat(result) {
      if (!result || !document.getElementById('dragon-raid-overlay')) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const boss = document.querySelector('.dragon-arena-boss');
      const arena = document.querySelector('.dragon-arena');
      const player = id => document.querySelector(`.dragon-raider-card[data-player-id="${CSS.escape(String(id || ''))}"]`);
      const center = el => {
        const r = el?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      };
      const lunge = (from, to, power = 0.42) => {
        if (!from || !to || !from.animate) return;
        const a = center(from), b = center(to);
        if (!a || !b) return;
        const dx = (b.x - a.x) * power;
        const dy = (b.y - a.y) * power;
        from.animate([
          { translate: '0px 0px', scale: '1' },
          { translate: `${dx}px ${dy}px`, scale: '1.055', offset: .42 },
          { translate: `${dx * .72}px ${dy * .72}px`, scale: '1.02', offset: .58 },
          { translate: '0px 0px', scale: '1' }
        ], { duration: 430, easing: 'cubic-bezier(.2,.85,.25,1)' });
      };
      const recoil = (target, strength = 1) => {
        if (!target?.animate) return;
        target.animate([
          { translate: '0px 0px', rotate: '0deg' },
          { translate: `${-6 * strength}px ${3 * strength}px`, rotate: `${-1.2 * strength}deg`, offset: .28 },
          { translate: `${5 * strength}px ${-2 * strength}px`, rotate: `${.8 * strength}deg`, offset: .52 },
          { translate: '0px 0px', rotate: '0deg' }
        ], { duration: 300, easing: 'ease-out' });
        target.classList.add('is-hit-flash');
        setTimeout(() => target.classList.remove('is-hit-flash'), 320);
      };
      const healPulse = target => {
        if (!target?.animate) return;
        target.animate([
          { scale: '1', filter: 'brightness(1)' },
          { scale: '1.045', filter: 'brightness(1.35)', offset: .5 },
          { scale: '1', filter: 'brightness(1)' }
        ], { duration: 520, easing: 'ease-out' });
        target.classList.add('is-heal-flash');
        setTimeout(() => target.classList.remove('is-heal-flash'), 560);
      };
      const trail = (from, to, bossStrike = false, kind = '') => {
        if (!from || !to || !arena) return;
        const a = center(from), b = center(to), ar = arena.getBoundingClientRect();
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.max(60, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const fx = document.createElement('i');
        fx.className = 'dragon-attack-trail' + (bossStrike ? ' is-boss' : '') + (kind ? ' is-' + kind : '');
        fx.style.left = (a.x - ar.left) + 'px';
        fx.style.top = (a.y - ar.top) + 'px';
        fx.style.width = Math.min(len * .72, 220) + 'px';
        fx.style.transform = `rotate(${angle}deg) scaleX(.2)`;
        arena.appendChild(fx);
        setTimeout(() => fx.remove(), 420);
      };
      const impact = (target, kind = '') => {
        if (!target || !arena) return;
        const tr = target.getBoundingClientRect();
        const ar = arena.getBoundingClientRect();
        const fx = document.createElement('i');
        fx.className = 'dragon-impact' + (kind ? ' is-' + kind : '');
        fx.style.left = (tr.left + tr.width / 2 - ar.left) + 'px';
        fx.style.top = (tr.top + tr.height / 2 - ar.top) + 'px';
        arena.appendChild(fx);
        setTimeout(() => fx.remove(), 520);
      };
      const pulse = (target, className, ms = 560) => {
        if (!target) return;
        target.classList.add(className);
        setTimeout(() => target.classList.remove(className), ms);
      };
      const slash = (target, kind = 'slash', delay = 0) => {
        if (!target || !arena) return;
        setTimeout(() => {
          const tr = target.getBoundingClientRect();
          const ar = arena.getBoundingClientRect();
          const fx = document.createElement('i');
          fx.className = 'dragon-slash is-' + kind;
          fx.style.left = (tr.left + tr.width / 2 - ar.left) + 'px';
          fx.style.top = (tr.top + tr.height / 2 - ar.top) + 'px';
          arena.appendChild(fx);
          setTimeout(() => fx.remove(), 460);
        }, delay);
      };
      const lift = target => {
        if (!target?.animate) return;
        target.animate([
          { translate: '0px 8px', opacity: .45, filter: 'brightness(.8)' },
          { translate: '0px -8px', opacity: 1, filter: 'brightness(1.55)', offset: .58 },
          { translate: '0px 0px', opacity: 1, filter: 'brightness(1)' }
        ], { duration: 720, easing: 'cubic-bezier(.18,.86,.24,1)' });
        pulse(target, 'is-resurrecting', 760);
      };
      const arenaTint = (className, ms = 620) => {
        if (!arena) return;
        arena.classList.add(className);
        setTimeout(() => arena.classList.remove(className), ms);
      };
      const floatText = (target, text, kind = '') => {
        if (!target || !arena || !text) return;
        const tr = target.getBoundingClientRect();
        const ar = arena.getBoundingClientRect();
        const fx = document.createElement('b');
        fx.className = 'dragon-float-text' + (kind ? ' is-' + kind : '');
        fx.textContent = text;
        fx.style.left = (tr.left + tr.width / 2 - ar.left) + 'px';
        fx.style.top = (tr.top + Math.max(18, tr.height * .28) - ar.top) + 'px';
        arena.appendChild(fx);
        setTimeout(() => fx.remove(), 900);
      };
      const telegraph = (target, kind = 'danger', delay = 320) => {
        if (!target) return Promise.resolve();
        target.classList.add('is-targeted', 'is-targeted-' + kind);
        return new Promise(resolve => setTimeout(() => {
          target.classList.remove('is-targeted', 'is-targeted-' + kind);
          resolve();
        }, delay));
      };
      const phaseCue = (text, kind = '') => {
        if (!arena || !text) return;
        const fx = document.createElement('div');
        fx.className = 'dragon-phase-cue' + (kind ? ' is-' + kind : '');
        fx.textContent = text;
        arena.appendChild(fx);
        setTimeout(() => fx.remove(), 1250);
      };

      if (result.side === 'hero' && result.action === 'timeout') {
        const lost = player(result.playerId);
        floatText(lost, 'TURN LOST', 'fallen');
        pulse(lost, 'is-turn-lost', 640);
        return;
      }

      if (result.side === 'hero') {
        const actor = player(result.playerId);
        const target = result.targetId ? player(result.targetId) : null;
        if (result.action === 'heal') {
          lunge(actor, target || actor, .14);
          healPulse(target || actor);
          pulse(actor, 'is-casting-heal', 520);
          arenaTint('is-heal-cast', 520);
          if ((result.healing || 0) > 0) floatText(target || actor, '+' + result.healing, 'heal');
          return;
        }
        if (result.action === 'resurrect') {
          pulse(actor, 'is-casting-heal', 680);
          lift(target || actor);
          arenaTint('is-resurrection-cast', 760);
          if (result.revived) floatText(target || actor, 'REVIVED', 'revive');
          return;
        }
        if (result.action === 'taunt') {
          pulse(actor, 'is-taunting', 620);
          arenaTint('is-taunt-cast', 520);
          return;
        }
        if (result.action === 'shieldWall') {
          pulse(actor, 'is-shielded', 760);
          return;
        }
        trail(actor, boss, false);
        lunge(actor, boss, result.action === 'execute' ? .40 : .34);
        if (result.action === 'execute') slash(boss, 'execute');
        if (result.action === 'rapid') {
          slash(boss, 'rapid', 0);
          slash(boss, 'rapid', 95);
        }
        if ((result.damage || 0) > 0) {
          const crit = result.result === 'critical' || result.result === 'natural20';
          recoil(boss, result.result === 'natural20' ? 1.45 : crit ? 1.18 : 1);
          impact(boss, result.result === 'natural20' ? 'crit' : crit ? 'heavy' : '');
          floatText(boss, '-' + result.damage, result.result === 'natural20' ? 'crit' : crit ? 'heavy' : 'damage');
          if (crit) arenaTint('is-crit-hit', result.result === 'natural20' ? 620 : 420);
        }
        if ((this.raid?.dragonHp || 0) <= 0 && boss) {
          phaseCue('SPECIMEN TERMINATED', 'kill');
          boss.classList.add('is-boss-dying');
          arena?.classList.add('is-boss-death');
        }
        return;
      }

      if (result.side === 'boss') {
        const bossId = String(result.bossId || this.raid?.boss?.id || '');
        const skill = String(result.skill || '').toUpperCase();
        if (skill && skill !== 'MISS') {
          phaseCue(skill, 'attack');
          await new Promise(resolve => setTimeout(resolve, 220));
        }
        const rawTargets = (result.targets || []).map(id => player(String(id))).filter(Boolean);
        const targets = [...new Set(rawTargets)];
        const bossPulse = (strength = 1.08, duration = 460) => boss?.animate?.([
          { scale: '1' },
          { scale: String(strength), offset: .38 },
          { scale: '.99', offset: .62 },
          { scale: '1' }
        ], { duration, easing: 'cubic-bezier(.2,.85,.25,1)' });

        const teleKind = bossId === 'hydra' ? 'venom' : bossId === 'wendigo' ? 'frost' : bossId === 'hym' ? 'shadow' : bossId === 'necromorph' ? 'necro' : 'danger';
        if (targets.length) await Promise.all(targets.map(t => telegraph(t, teleKind, 320)));
        Object.entries(result.dealt || {}).forEach(([id, amount]) => {
          const t = player(id);
          if (t && Number(amount) > 0) floatText(t, '-' + amount, bossId === 'hydra' ? 'venom' : 'damage');
        });
        if ((result.healed || 0) > 0) floatText(boss, '+' + result.healed, 'heal');
        targets.forEach(t => {
          const id = t.dataset.playerId;
          const state = this.raid?.participants?.find?.(p => String(p.id) === String(id));
          if (state && !state.alive) setTimeout(() => {
            t.classList.add('is-hero-dying');
            floatText(t, 'FALLEN', 'fallen');
          }, 360);
        });
        if (bossId === 'hydra' && this.raid?.dragonHp <= this.raid?.dragonMaxHp * .5 && this._swampVigorCueRaidId !== this.raid?.id) {
          this._swampVigorCueRaidId = this.raid.id;
          phaseCue('SWAMP VIGOR AWAKENED', 'swamp');
          arenaTint('is-swamp-vigor', 1100);
        }

        if (bossId === 'hym') {
          bossPulse(1.04, 520);
          arenaTint(skill === 'THE SHADOW WITHIN' ? 'is-hym-cataclysm' : 'is-hym-cast', 700);
          targets.forEach((t, i) => setTimeout(() => {
            trail(boss, t, true, 'shadow');
            pulse(t, skill === 'WHISPER OF GUILT' ? 'is-guilt-mark' : 'is-shadow-hit', 680);
            if ((result.damage || 0) > 0) recoil(t, .55);
          }, i * 70));
          return;
        }

        if (bossId === 'hydra') {
          if (skill === 'VENOM FLOOD') {
            bossPulse(1.10, 560);
            arenaTint('is-venom-flood', 820);
            targets.forEach((t, i) => setTimeout(() => {
              recoil(t, .7);
              impact(t, 'venom');
              pulse(t, 'is-poison-hit', 780);
            }, i * 80));
            return;
          }
          if (skill === 'VENOM SPIT' && targets[0]) {
            trail(boss, targets[0], true, 'venom');
            lunge(boss, targets[0], .16);
            recoil(targets[0], .7);
            impact(targets[0], 'venom');
            pulse(targets[0], 'is-poison-hit', 760);
            return;
          }
          if (skill === 'MANY-HEADED BITE') {
            bossPulse(1.07, 430);
            targets.forEach((t, i) => setTimeout(() => {
              trail(boss, t, true, 'bite');
              recoil(t, .95);
              impact(t, 'bite');
            }, i * 85));
            return;
          }
        }

        if (bossId === 'wendigo') {
          if (skill === 'WHITE SILENCE') {
            bossPulse(1.06, 520);
            arenaTint('is-white-silence', 760);
            targets.forEach((t, i) => setTimeout(() => {
              recoil(t, .55);
              impact(t, 'frost');
            }, i * 65));
            return;
          }
          if (targets[0]) {
            trail(boss, targets[0], true, skill === 'DRAG INTO THE DARK' ? 'shadow' : 'frost');
            lunge(boss, targets[0], skill === 'FERAL LUNGE' ? .46 : .24);
            recoil(targets[0], skill === 'FERAL LUNGE' ? 1.25 : .85);
            impact(targets[0], skill === 'FERAL LUNGE' ? 'frost' : 'shadow');
            if (skill === 'DRAG INTO THE DARK') pulse(targets[0], 'is-isolated-hit', 760);
            return;
          }
        }

        if (bossId === 'necromorph') {
          if (skill === 'ABERRANT FRENZY') {
            bossPulse(1.09, 420);
            rawTargets.forEach((t, i) => setTimeout(() => {
              slash(t, 'necro', 0);
              recoil(t, 1.05);
              impact(t, 'necro');
            }, i * 115));
            return;
          }
          if (skill === 'VENT AMBUSH') {
            arenaTint('is-vent-ambush', 560);
            targets.forEach((t, i) => setTimeout(() => {
              slash(t, 'necro', 0);
              recoil(t, .9);
              impact(t, 'necro');
            }, i * 80));
            return;
          }
          if (skill === 'SCYTHE REND' && targets[0]) {
            trail(boss, targets[0], true, 'necro');
            lunge(boss, targets[0], .24);
            slash(targets[0], 'necro');
            recoil(targets[0], 1.2);
            impact(targets[0], 'necro');
            return;
          }
        }

        if (!targets.length) {
          bossPulse(result.result === 'catastrophic' ? 1.11 : 1.07, 440);
          if (result.result === 'catastrophic') arenaTint('is-catastrophic-strike', 700);
          return;
        }
        if (targets.length === 1) {
          trail(boss, targets[0], true);
          boss?.setAttribute('data-attacking', '1');
          lunge(boss, targets[0], .25);
          recoil(targets[0], result.result === 'catastrophic' ? 1.35 : 1);
          impact(targets[0], result.result === 'catastrophic' ? 'crit' : '');
          setTimeout(() => boss?.removeAttribute('data-attacking'), 460);
        } else {
          bossPulse(result.result === 'catastrophic' ? 1.12 : 1.09, 520);
          arenaTint(result.result === 'catastrophic' ? 'is-catastrophic-strike' : 'is-aoe-strike', 560);
          targets.forEach((t, i) => setTimeout(() => {
            recoil(t, result.result === 'catastrophic' ? 1.05 : .85);
            impact(t, result.result === 'catastrophic' ? 'crit' : '');
          }, i * 65));
        }
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

    safeAvatar(value) {
      const v = typeof value === 'string' ? value.trim() : '';
      return v && v.length <= 200 && !v.includes('..') && SAFE_AVATAR.test(v) ? v : '';
    },

    safeFrame(value) {
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#9B5DE0';
    },

    portraitHTML(p, meta) {
      const avatar = this.safeAvatar(p.avatarData);
      const initial = String(p.name || '?').trim().slice(0, 1).toUpperCase() || '?';
      return `<span class="dragon-raider-portrait ${avatar ? 'has-avatar' : 'is-fallback'}" style="--frame:${this.safeFrame(p.frameColor)}">${avatar
        ? `<img class="dragon-portrait-img" src="${this.esc(avatar)}" alt="" loading="lazy" decoding="async" draggable="false">`
        : ''}<span class="dragon-portrait-fallback">${this.esc(initial)}</span><i class="dragon-role-icon" title="${this.esc(meta.label)}">${meta.icon}</i></span>`;
    },

    portraitError(img) {
      if (!(img instanceof HTMLImageElement)) return;
      if (img.classList.contains('dragon-portrait-img')) {
        const box = img.closest('.dragon-raider-portrait');
        img.remove();
        if (box) { box.classList.remove('has-avatar'); box.classList.add('is-fallback'); }
      } else if (img.classList.contains('dragon-boss-img')) {
        const box = img.closest('.dragon-boss-avatar');
        img.remove();
        if (box) box.classList.remove('has-art');
      }
    },

    turnPct(raid) {
      const total = Number(raid.heroTurnMs) || 30000;
      return Math.max(0, Math.min(100, Math.round(this.remaining(raid.heroTurnEndsAt) / total * 100)));
    },

    turnSeconds(raid) {
      return Math.ceil(this.remaining(raid.heroTurnEndsAt) / 1000);
    },

    participantHTML(p) {
      const meta = ROLE_META[p.role] || { label: p.role, icon: '◆' };
      const pct = p.maxHp ? Math.max(0, Math.min(100, Math.round((p.hp / p.maxHp) * 100))) : 0;
      const statuses = Object.entries(p.statuses || {}).filter(([, value]) => !!value).map(([key, value]) => ({ key, label: `${key.toUpperCase()}${typeof value === 'number' && value > 1 ? ' ' + value : ''}` }));
      const cooldowns = Object.entries(p.cooldowns || {}).filter(([, value]) => value > 0).map(([key, value]) => `${key.toUpperCase()} CD${value}`);
      const skills = p.role === 'tank'
        ? ['TAUNT', 'SHIELD WALL']
        : p.role === 'heal'
          ? ['HEAL', 'RESURRECT']
          : ['EXECUTE', 'RAPID STRIKE'];
      const hpState = !p.alive ? 'is-fallen' : pct <= 20 ? 'is-critical-hp' : pct <= 40 ? 'is-low-hp' : '';
      return `<article class="dragon-raider-card ${hpState} ${this.raid.activePlayerId === p.id ? 'is-active' : ''}" data-player-id="${this.esc(p.id)}" data-role="${this.esc(p.role)}">
        <header>${this.portraitHTML(p, meta)}<b>${this.esc(p.name)}</b><small>${this.esc(meta.label)}</small></header>
        <div class="dragon-raider-skills">${skills.map(skill => `<span>${skill}</span>`).join('')}</div>
        ${statuses.length ? `<div class="dragon-status-chips">${statuses.map(s => `<span class="is-${this.esc(s.key)}">${this.esc(s.label)}</span>`).join('')}</div>` : ''}
        <div class="dragon-raider-hp"><i style="width:${pct}%"></i></div>
        <footer><span>♥ ${p.hp} / ${p.maxHp}</span>${p.role === 'heal' ? `<span>✦ ${p.resurrectionCharges} RES</span>` : ''}<span>⚔ ${p.damage}</span></footer>
        ${p.alive ? `<em>${this.raid.activePlayerId === p.id ? '◆ ACTIVE TURN' : 'AWAITING TURN'}${cooldowns.length ? ' · ' + cooldowns.join(' · ') : ''}</em>` : '<em>☠ FALLEN</em>'}
        ${this.raid.phase === 'HERO_TURN' && this.raid.activePlayerId === p.id && this.raid.heroTurnEndsAt ? `<div class="dragon-card-timer" data-dragon-turn-bar><b data-dragon-clock="turn">${this.turnSeconds(this.raid)}s</b><span><i style="width:${this.turnPct(this.raid)}%"></i></span></div>` : ''}
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
          ? `<div class="dragon-locked">RAID SLOT CLAIMED — ${this.roleName(mine.role)}</div>`
          : full && !this.isGM()
            ? '<div class="dragon-locked">RAID FULL — YOU SNOOZE, YOU LOSE</div>'
            : '';
      return `
        <div class="dragon-heading">
          <span class="dragon-mark">🐉</span>
          <div><small>${raid.boss.heroic ? 'HEROIC CALAMITY' : 'CABINET ENCOUNTER'}</small><h1>${this.esc(raid.boss.name)} HAS AWAKENED</h1></div>
          <strong data-dragon-clock="recruit">${this.clock(this.remaining(raid.recruitEndsAt))}</strong>
        </div>
        <p class="dragon-lore">Heroes act in order. Then the enemy answers. ${raid.boss.heroic ? 'Deathwing accepts exactly five victims.' : 'Three may challenge it. Five may enter.'}</p>
        <div class="dragon-party-count">RAID PARTY <b>${raid.participants.length} / 5</b> <span>${raid.boss.heroic ? 'EXACTLY 5 REQUIRED' : 'MINIMUM 3'}</span></div>
        <div class="dragon-raider-grid">${this.partySlotsHTML()}</div>
        ${this.isGM() ? `<div class="dragon-gm-observer"><span>SHADOW BROKER OBSERVER — RECRUITMENT LIVE</span><div class="dragon-gm-actions"><button type="button" data-dragon-action="start" ${raid.boss.heroic ? (raid.participants.length === 5 ? '' : 'disabled') : (raid.participants.length >= 3 ? '' : 'disabled')}>START RAID NOW</button><button type="button" data-dragon-action="cancel">CANCEL RAID</button></div></div>` : ''}
        ${choose}
      `;
    },

    battleHTML() {
      const raid = this.raid;
      const mine = raid.participants.find(p => String(p.id) === this.myId());
      const hpPct = Math.max(0, Math.min(100, raid.dragonHp / raid.dragonMaxHp * 100));
      const myTurn = !this.isGM() && raid.phase === 'HERO_TURN' && mine?.alive && raid.activePlayerId === mine.id;
      const active = raid.participants.find(p => p.id === raid.activePlayerId);
      const targetOptions = raid.participants.map(p => `<option value="${this.esc(p.id)}">${this.esc(p.name)} — ${p.alive ? p.hp + ' HP' : 'FALLEN'}</option>`).join('');
      let actions = '';
      if (myTurn) {
        const roleActions = mine.role === 'tank'
          ? `<button data-dragon-action="act" data-ability="taunt">TAUNT</button><button data-dragon-action="act" data-ability="shieldWall" ${mine.shieldWall ? '' : 'disabled'}>SHIELD WALL (${mine.shieldWall})</button>`
          : mine.role === 'heal'
            ? `<button data-dragon-action="act" data-ability="heal">HEAL TARGET</button><button data-dragon-action="act" data-ability="resurrect" ${mine.resurrectionCharges ? '' : 'disabled'}>RESURRECT (${mine.resurrectionCharges})</button>`
            : `<button data-dragon-action="act" data-ability="execute" ${mine.cooldowns?.execute ? 'disabled' : ''}>EXECUTE (${mine.cooldowns?.execute || 'READY'})</button><button data-dragon-action="act" data-ability="rapid" ${mine.cooldowns?.rapid ? 'disabled' : ''}>RAPID STRIKE (${mine.cooldowns?.rapid || 'READY'})</button>`;
        actions = `<div class="dragon-action-tray"><select id="dragon-action-target">${targetOptions}</select><button class="dragon-primary" data-dragon-action="act" data-ability="attack">ATTACK — ROLL D20</button>${roleActions}</div>`;
      }
      const last = raid.lastAction ? `<div class="dragon-round-feed">${raid.lastAction.action === 'timeout' ? `<span class="timeout"><b>${this.esc(raid.lastAction.name)}</b> — TURN FORFEITED — TIME EXPIRED</span>` : `<span class="${this.esc(raid.lastAction.result)}"><b>${this.esc(raid.lastAction.name)}</b> — ${this.esc(raid.lastAction.action || raid.lastAction.result)} — D20 ${raid.lastAction.roll} ${raid.lastAction.damage ? '— ' + raid.lastAction.damage + ' DAMAGE' : ''}</span>`}</div>` : '';
      return `
        <div class="dragon-heading">
          <span class="dragon-mark is-burning">☠</span>
          <div><small>${raid.boss.heroic ? 'HEROIC CALAMITY' : 'CABINET ARENA'} — ROUND ${raid.round} — ${raid.phase === 'BOSS_TURN' ? 'SPECIMEN PHASE' : 'HERO PHASE'}</small><h1>${this.esc(raid.boss.name)}</h1><small>${this.esc(raid.boss.passive)}${raid.boss.wrath ? ` — WRATH ${raid.boss.wrath}` : ''}${raid.worldBreaker ? ' — WORLD BREAKER' : ''}${raid.sunder ? ' — SUNDERED' : ''}</small></div>
          <strong data-dragon-clock="battle">${this.clock(this.remaining(raid.battleEndsAt))}</strong>
        </div>
        <div class="dragon-arena ${hpPct <= 25 ? 'is-boss-critical' : hpPct <= 50 ? 'is-boss-low' : ''}" data-boss-id="${this.esc(raid.boss.id)}" data-party-size="${raid.participants.length}">
          <div class="dragon-arena-atmosphere" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="dragon-active-lane" aria-hidden="true"></div>
          <div class="dragon-arena-ring" aria-hidden="true"></div>
          <div class="dragon-arena-party">${this.partySlotsHTML()}</div>
          <section class="dragon-arena-boss">
            <div class="dragon-boss-avatar ${BOSS_ART[raid.boss.id] ? 'has-art' : ''}" data-boss-avatar="${this.esc(raid.boss.id)}">
              ${BOSS_ART[raid.boss.id] ? `<img class="dragon-boss-img" src="${this.esc(BOSS_ART[raid.boss.id])}?v=${ART_VERSION}" alt="${this.esc(raid.boss.name)}" decoding="async" draggable="false">` : ''}
              <span class="dragon-boss-avatar-fallback">${this.esc(raid.boss.name.slice(0,1))}</span>
            </div>
            <div class="dragon-boss-title"><small>CONTAINMENT BROKEN</small><b>${this.esc(raid.boss.name)}</b><span class="dragon-passive-badge ${raid.boss.id === 'hydra' && raid.dragonHp <= raid.dragonMaxHp * .5 ? 'is-awakened' : ''}">${this.esc(raid.boss.passive)}</span></div>
            <div class="dragon-boss-hp">
              <div><strong>♥ ${raid.dragonHp} / ${raid.dragonMaxHp}</strong></div>
              <span><i style="width:${hpPct}%"></i></span>
            </div>
          </section>
        </div>
        <div class="dragon-turn-banner">${raid.phase === 'BOSS_TURN' ? 'THE SPECIMEN MOVES' : `ACTIVE HERO — ${this.esc(active?.name || '—')}${raid.heroTurnEndsAt ? ` — <strong class="dragon-turn-clock" data-dragon-clock="turn">${this.turnSeconds(raid)}s</strong>` : ''}`}</div>
        ${this.isGM() ? '<div class="dragon-gm-observer"><span>SHADOW BROKER OBSERVER — LIVE COMBAT</span><button type="button" data-dragon-action="cancel">CANCEL RAID</button></div>' : ''}
        ${actions}
        ${!myTurn && mine?.alive ? '<div class="dragon-locked">WAIT FOR YOUR TURN</div>' : ''}
        ${!mine && !this.isGM() ? '<div class="dragon-locked">SPECTATING — RAID GATES SEALED</div>' : ''}
        ${this.myLastRoll && this.myLastRoll.round === raid.round ? `<div class="dragon-own-roll">YOUR ROLL — <b>${this.myLastRoll.value}</b></div>` : ''}
        ${last}
      `;
    },

    heartHTML() {
      const raid = this.raid;
      const heart = raid.heart || {};
      const mine = raid.participants.find(p => String(p.id) === this.myId());
      const eligible = !!mine?.alive && (heart.contenders || []).includes(this.myId());
      const rolled = Object.prototype.hasOwnProperty.call(heart.rolls || {}, this.myId());
      const invalidated = new Set(heart.invalidated || []);
      const current = new Set(heart.contenders || []);
      const lootRows = (raid.loot?.survivors || []).map(id => {
        const p = raid.participants.find(x => String(x.id) === String(id));
        return `<span><b>${this.esc(p?.name || id)}</b><strong>+${raid.loot.shares[id] || 0} SC</strong></span>`;
      }).join('');
      const heartRows = (raid.loot?.survivors || []).map(id => {
        const p = raid.participants.find(x => String(x.id) === String(id));
        const hasRoll = Object.prototype.hasOwnProperty.call(heart.rolls || {}, id);
        const status = invalidated.has(id)
          ? '<strong class="is-invalid">INVALID</strong>'
          : current.has(id)
            ? `<strong>${hasRoll ? heart.rolls[id] : 'WAITING'}</strong>`
            : '<strong class="is-eliminated">ELIMINATED</strong>';
        return `<span><b>${this.esc(p?.name || id)}</b>${status}</span>`;
      }).join('');
      return `
        <div class="dragon-heading victory">
          <span class="dragon-mark">☠</span>
          <div><small>THE BEAST HAS FALLEN</small><h1>THE HOARD BREAKS OPEN</h1></div>
          <strong>VICTORY</strong>
        </div>
        <div class="dragon-hoard"><small>SHADOW COIN HOARD</small><b>🪙 ${raid.loot?.total || 0}</b><div>${lootRows}</div></div>
        <div class="dragon-heart">
          <small>GUARANTEED BOSS RELIC</small>
          <h2><img class="dragon-hos-icon" src="assets/ui/heart-of-the-shadow.webp" alt="" loading="lazy"> HEART OF THE SHADOW</h2>
          <p>Only the living may claim it. Fail to roll before the seal closes and your claim is void.</p>
          <div class="dragon-heart-deadline"><small>ROLL WINDOW — ROUND ${heart.round || 1}</small><strong data-dragon-clock="heart">${this.clock(this.remaining(heart.endsAt))}</strong><span>NO ROLL = INVALID</span></div>
          <div class="dragon-heart-rolls">${heartRows}</div>
          ${!this.isGM() && eligible && !rolled ? '<button class="dragon-primary heart" data-dragon-action="heart">ROLL FOR THE HEART</button>' : ''}
          ${!this.isGM() && eligible && rolled ? '<div class="dragon-locked">HEART ROLL COMMITTED</div>' : ''}
          ${!this.isGM() && mine && !mine.alive ? '<div class="dragon-dead-loot">☠ YOU ARE DEAD — NO HEART — NO LOOT</div>' : ''}
        </div>
      `;
    },

    completeHTML() {
      const raid = this.raid;
      const heartClaimed = !!raid.heart?.winnerId;
      const winner = raid.heart?.winnerName || 'UNCLAIMED';
      const shares = raid.loot?.shares || {};
      const lootRows = Object.entries(shares).map(([id, amount]) => {
        const p = raid.participants.find(x => String(x.id) === String(id));
        return `<span><b>${this.esc(p?.name || id)}</b><strong>+${amount} SC</strong></span>`;
      }).join('');
      return `
        <div class="dragon-heading victory">
          <span class="dragon-mark">🖤</span>
          <div><small>RAID COMPLETE</small><h1>${heartClaimed ? 'THE HEART HAS CHOSEN' : 'THE HEART WAS FORFEITED'}</h1></div>
          <strong>${heartClaimed ? 'CLAIMED' : 'UNCLAIMED'}</strong>
        </div>
        <div class="dragon-summary-grid">
          <div><small>ROUNDS</small><b>${raid.round}</b></div>
          <div><small>SURVIVORS</small><b>${raid.loot?.survivors?.length || 0}</b></div>
          <div><small>HOARD</small><b>${raid.loot?.total || 0}</b></div>
        </div>
        <div class="dragon-hoard"><div>${lootRows}</div></div>
        <div class="dragon-heart winner"><small>HEART OF THE SHADOW</small><img class="dragon-hos-icon dragon-hos-icon-large" src="assets/ui/heart-of-the-shadow.webp" alt="Heart of the Shadow" loading="lazy"><h2>${this.esc(winner)}</h2></div>
        <button class="dragon-secondary" data-dragon-action="hide">CLOSE RAID REPORT</button>
      `;
    },

    failureHTML() {
      const raid = this.raid;
      const aborted = raid.phase === 'ABORTED';
      const reason = raid.result?.reason === 'GM_CANCELLED'
        ? 'THE SHADOW BROKER HAS CLOSED THE CABINET'
        : raid.result?.reason === 'CATACLYSM'
        ? 'CATACLYSM'
        : raid.result?.reason === 'CATACLYSM_REQUIRES_FIVE'
          ? 'DEATHWING REQUIRES EXACTLY FIVE HEROES'
        : raid.result?.reason === 'TIME_EXPIRED'
          ? 'TIME EXPIRED'
        : raid.result?.reason === 'PARTY_WIPE'
          ? 'THE RAID PARTY HAS FALLEN'
          : 'TOO FEW LITTLE HEROES';
      return `
        <div class="dragon-heading defeat">
          <span class="dragon-mark">🐉</span>
          <div><small>${aborted ? 'RAID ABORTED' : 'RAID FAILED'}</small><h1>${reason}</h1></div>
          <strong>${aborted ? 'WITHDRAWN' : 'DEFEAT'}</strong>
        </div>
        <p class="dragon-lore">${raid.result?.reason === 'GM_CANCELLED' ? 'Encounter terminated by Shadow Broker authority. The specimen returns to containment.' : aborted ? 'The Cabinet remains sealed. The required challengers never arrived.' : 'The specimen survives. Its hoard remains untouched.'}</p>
        <div class="dragon-dead-loot">${aborted ? 'NO PENALTY' : 'NO COINS — NO HEART OF THE SHADOW'}</div>
        <button class="dragon-secondary" data-dragon-action="hide">CLOSE RAID REPORT</button>
      `;
    },

    updateActiveLane() {
      const arena = document.querySelector('.dragon-arena');
      const lane = arena?.querySelector('.dragon-active-lane');
      const active = arena?.querySelector('.dragon-raider-card.is-active');
      const boss = arena?.querySelector('.dragon-arena-boss');
      if (!arena || !lane || !active || !boss || this.raid?.phase !== 'HERO_TURN') {
        if (lane) lane.hidden = true;
        return;
      }
      const ar = arena.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      const b = boss.getBoundingClientRect();
      const ax = a.left + a.width / 2 - ar.left;
      const ay = a.top + a.height / 2 - ar.top;
      const bx = b.left + b.width / 2 - ar.left;
      const by = b.top + b.height / 2 - ar.top;
      const dx = bx - ax, dy = by - ay;
      lane.hidden = false;
      lane.style.left = ax + 'px';
      lane.style.top = ay + 'px';
      lane.style.width = Math.max(0, Math.hypot(dx, dy) - Math.min(a.width, b.width) * .34) + 'px';
      lane.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`;
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
      requestAnimationFrame(() => this.updateActiveLane());
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
      if (raid.phase === 'HERO_TURN' && raid.heroTurnEndsAt) {
        const secs = this.turnSeconds(raid);
        const pct = this.turnPct(raid);
        overlay.querySelectorAll('[data-dragon-clock="turn"]').forEach(node => {
          node.textContent = secs + 's';
          node.classList.toggle('is-critical', secs <= 10);
          node.classList.toggle('is-terminal', secs <= 5);
        });
        overlay.querySelectorAll('[data-dragon-turn-bar] i').forEach(bar => { bar.style.width = pct + '%'; });
      }
      const heart = overlay.querySelector('[data-dragon-clock="heart"]');
      if (heart) {
        const left = this.remaining(raid.heart?.endsAt);
        heart.textContent = this.clock(left);
        heart.classList.toggle('is-critical', left <= 10000);
        heart.classList.toggle('is-terminal', left <= 5000);
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
      if (action === 'start') {
        if (!this.isGM()) return;
        button.disabled = true;
        return this.send({ type: 'gm:dragonRaid', action: 'start' });
      }
      if (action === 'cancel') {
        if (!this.isGM()) return;
        button.disabled = true;
        return this.send({ type: 'gm:dragonRaid', action: 'cancel' });
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
