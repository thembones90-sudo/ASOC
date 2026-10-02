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

  function onMessage(m) {
    if (m.type === 'coinDrop:spawn') return spawn(m.drop);
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
      return;
    }
    if (m.type === 'coinDrop:gone' && !el.classList.contains('is-pending')) { el.classList.add('is-gone'); remove(400); }
  }

  window.CoinDrop = { onMessage };
})();
