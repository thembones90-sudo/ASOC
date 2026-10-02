// COIN DROP -- a Shadow Coin flashes onto the Little Hero's board for a few
// seconds; the first click (server-judged) wins it. Colour = Warcraft tier:
// poor gray, common white, uncommon green, rare blue, epic purple,
// legendary orange. The amount is revealed only when someone catches it.
(() => {
  'use strict';
  const TIER_COLOR = { poor: '#9d9d9d', common: '#ffffff', uncommon: '#1eff00', rare: '#2b8cff', epic: '#a335ee', legendary: '#ff8000' };
  let live = null; // { id, el, timer }

  const stage = () => {
    const board = document.getElementById('board-layer');
    const r = board?.getBoundingClientRect();
    return r && r.width > 160 && r.height > 120 ? r : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  };

  const chime = tier => {
    try {
      if (window.AsocAudio?.isMuted?.()) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = chime.ctx || (chime.ctx = new Ctx());
      const notes = tier === 'legendary' ? [784, 988, 1175, 1568] : tier === 'epic' ? [880, 1175, 1397] : [988, 1319];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const t = ctx.currentTime + i * 0.09;
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.4);
      });
    } catch {}
  };

  const remove = (delay = 0) => {
    const cur = live;
    if (!cur) return;
    live = null;
    clearTimeout(cur.timer);
    setTimeout(() => cur.el.remove(), delay);
  };

  const label = (el, text, cls) => {
    const tag = document.createElement('b');
    tag.className = 'cd-tag ' + (cls || '');
    tag.textContent = text;
    el.appendChild(tag);
  };

  function spawn(drop) {
    if (!drop?.id || document.hidden) return;
    remove();
    const r = stage();
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `coin-drop tier-${drop.tier}`;
    el.style.setProperty('--cd-color', TIER_COLOR[drop.tier] || '#fff');
    el.style.setProperty('--cd-life', `${drop.durationMs || 5000}ms`);
    el.style.left = `${r.left + r.width * drop.x}px`;
    el.style.top = `${r.top + r.height * drop.y}px`;
    el.setAttribute('aria-label', `${drop.label} Shadow Coin. Click to catch it.`);
    el.innerHTML = `${drop.tier === 'legendary' ? '<i class="cd-rays"></i>' : ''}<span class="cd-coin"><span class="cd-face">SC</span></span><small class="cd-tier">${drop.label}</small>`;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!live || live.id !== drop.id || el.classList.contains('is-pending')) return;
      el.classList.add('is-pending');
      window.PlayerApp?.send?.({ type: 'coinDrop:claim', id: drop.id });
    });
    document.body.appendChild(el);
    live = { id: drop.id, el, timer: setTimeout(() => { el.classList.add('is-gone'); remove(400); }, (drop.durationMs || 5000) + 900) };
    chime(drop.tier);
  }

  // ------------------------------------------------------------ ROLL-OFF --
  // Two (or more) Little Heroes clicked the same coin at the same moment:
  // a public duel. Everyone watches; the player whose turn it is gets ROLL.
  const isGM = () => !!window.App && !window.PlayerApp;
  const meId = () => String(window.PlayerApp?.playerId || '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let duel = null; // { id, el, countdown }

  const flickerChat = () => {
    document.querySelectorAll('#chat-messages, #gm-chat-messages').forEach(box => {
      box.classList.remove('coin-roll-flicker');
      void box.offsetWidth;
      box.classList.add('coin-roll-flicker');
      setTimeout(() => box.classList.remove('coin-roll-flicker'), 1600);
    });
  };
  const avatarHTML = c => c.avatar && /^(data:image\/|\/|https:)/.test(c.avatar)
    ? `<img src="${esc(c.avatar)}" alt="">`
    : `<span>${esc(String(c.name || '?').trim().charAt(0).toUpperCase())}</span>`;

  function renderDuel(roll, phase) {
    if (!duel || duel.id !== roll.id) {
      duel?.el.remove();
      const el = document.createElement('div');
      el.className = `coin-roll tier-${roll.tier}`;
      el.style.setProperty('--cd-color', TIER_COLOR[roll.tier] || '#fff');
      document.body.appendChild(el);
      el.addEventListener('click', e => {
        if (e.target.closest('[data-roll]')) { e.target.closest('[data-roll]').disabled = true; window.PlayerApp?.send?.({ type: 'coinRoll:cast', id: roll.id }); }
        if (e.target.closest('[data-close]')) closeDuel();
      });
      duel = { id: roll.id, el };
    }
    const turn = roll.contenders.find(c => c.id === roll.turnId);
    const mine = turn && turn.id === meId();
    duel.el.innerHTML = `
      <div class="cr-card">
        <header><small>⚔ ROLL-OFF ⚔</small><b>${esc(roll.label)} SHADOW COIN</b><em>${esc(roll.amount)} SC AT STAKE</em></header>
        <div class="cr-duel">${roll.contenders.map((c, i) => `${i ? '<i class="cr-vs">VS</i>' : ''}
          <div class="cr-hero${c.id === roll.turnId && phase !== 'result' ? ' is-turn' : ''}" data-hero="${esc(c.id)}">
            <div class="cr-avatar">${avatarHTML(c)}</div>
            <b>${esc(c.name)}${c.id === meId() ? ' <small>(YOU)</small>' : ''}</b>
            <div class="cr-die">${c.roll == null ? '—' : esc(c.roll)}</div>
            ${c.auto ? '<small class="cr-auto">AUTO-ROLLED</small>' : ''}
          </div>`).join('')}</div>
        <footer class="cr-foot">${phase === 'result' ? '' : turn
          ? (mine ? `<button type="button" class="cr-roll-btn" data-roll>🎲 ROLL!</button>` : `<p>${esc(turn.name)} IS ROLLING…</p>`)
          : ''}${phase === 'result' ? '' : '<div class="cr-timer"><i></i></div>'}</footer>
        <button type="button" class="cr-close" data-close aria-label="Close">×</button>
      </div>`;
    const bar = duel.el.querySelector('.cr-timer i');
    if (bar && roll.turnEndsAt) {
      const left = Math.max(0, roll.turnEndsAt - Date.now());
      bar.style.animationDuration = `${left}ms`;
    }
  }
  function animateDie(playerId, value) {
    const die = duel?.el.querySelector(`[data-hero="${CSS.escape(playerId)}"] .cr-die`);
    if (!die) return;
    die.classList.add('is-rolling');
    let n = 0;
    const spin = setInterval(() => { die.textContent = 1 + Math.floor(Math.random() * 100); if (++n > 14) { clearInterval(spin); die.textContent = value; die.classList.remove('is-rolling'); die.classList.add('is-set'); } }, 60);
  }
  function showResult(m) {
    renderDuel(m.roll, 'result');
    const winners = new Map(m.winners.map(w => [w.id, w]));
    duel.el.querySelectorAll('[data-hero]').forEach(card => {
      const w = winners.get(card.dataset.hero);
      card.classList.add(w ? 'is-winner' : 'is-loser');
      if (w) card.insertAdjacentHTML('beforeend', `<em class="cr-prize">+${esc(w.amount)} SC</em>`);
    });
    duel.el.querySelector('.cr-foot').innerHTML = `<p class="cr-verdict">${m.split ? `A TIE! THE COIN IS SPLIT` : `${esc(m.winners[0].name)} TAKES IT`}</p>`;
    chime(m.split ? 'epic' : 'legendary');
    const id = duel.id;
    setTimeout(() => { if (duel?.id === id) closeDuel(); }, 6000);
  }
  function closeDuel() { duel?.el.remove(); duel = null; }

  function onMessage(m) {
    if (m.type === 'coinRoll:start') { flickerChat(); chime('epic'); return renderDuel(m.roll, 'turn'); }
    if (m.type === 'coinRoll:turn') return renderDuel(m.roll, 'turn');
    if (m.type === 'coinRoll:rolled') { if (!duel || duel.id !== m.id) renderDuel(m.roll, 'turn'); const btn = duel.el.querySelector('[data-roll]'); if (btn) btn.disabled = true; return animateDie(m.playerId, m.value); }
    if (m.type === 'coinRoll:result') return showResult(m);
    if (m.type === 'coinRoll:error') return;
    if (m.type === 'coinDrop:spawn') { if (isGM()) return; return spawn(m.drop); }
    if (m.type === 'coinDrop:contested') {
      if (!live || live.id !== m.id) return;
      live.el.classList.add('is-snatched');
      label(live.el, 'ROLL-OFF!');
      return remove(1200);
    }
    if (!live || live.id !== m.id) return;
    const el = live.el;
    const mine = String(m.playerId || '') === String(window.PlayerApp?.playerId || '');
    if (m.type === 'coinDrop:claimed' || (m.type === 'coinDrop:result' && m.ok)) {
      if (el.classList.contains('is-won') || el.classList.contains('is-snatched')) return;
      if (m.type === 'coinDrop:result' || mine) {
        el.classList.add('is-won');
        label(el, `+${m.amount} SC`, 'is-amount');
        chime(m.tier === 'legendary' ? 'legendary' : 'epic');
      } else {
        el.classList.add('is-snatched');
        label(el, `SNATCHED BY ${String(m.playerName || 'SOMEONE').toUpperCase()} // +${m.amount} SC`);
      }
      return remove(1800);
    }
    if (m.type === 'coinDrop:result' && !m.ok) {
      el.classList.remove('is-pending');
      if (m.reason === 'SNATCHED') { el.classList.add('is-snatched'); label(el, `SNATCHED BY ${String(m.by || 'SOMEONE').toUpperCase()}`); return remove(1600); }
      if (m.reason === 'GONE') { el.classList.add('is-gone'); return remove(400); }
      if (m.reason === 'ROLL-OFF') { el.classList.add('is-snatched'); label(el, 'ROLL-OFF!'); return remove(1200); }
      return;
    }
    if (m.type === 'coinDrop:gone' && !el.classList.contains('is-pending')) { el.classList.add('is-gone'); remove(400); }
  }

  window.CoinDrop = { onMessage };
})();
