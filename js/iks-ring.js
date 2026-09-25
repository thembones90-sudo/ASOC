// IKS OKS GAUNTLET health ring, shared by the GM (index.html) and player
// (join.html) renderers. wrap() puts a 10-segment health ring around any
// avatar markup -- only for Little Heroes who joined the current gauntlet
// (the server sends iksHealth only for them). Victors burn.
(() => {
  'use strict';
  const MAX = 10;

  function standing(entity) {
    const hp = Number(entity?.iksHealth);
    if (!Number.isFinite(hp)) return null;
    return { hp: Math.max(0, Math.min(MAX, Math.round(hp))), eliminated: entity.iksEliminated === true, victor: entity.iksChampion === true };
  }

  function classes(s) {
    if (!s) return '';
    return ' iks-hp' +
      (s.hp <= 3 ? ' iks-hp-low' : s.hp <= 6 ? ' iks-hp-mid' : '') +
      (s.eliminated ? ' iks-eliminated' : '') +
      (s.victor ? ' iks-victor' : '');
  }

  const IksRing = {
    MAX,
    standing,
    wrap(entity, avatarHTML) {
      const s = standing(entity);
      if (!s) return avatarHTML;
      const label = s.victor ? `GAUNTLET VICTOR // ${s.hp}/${MAX} HEALTH` : s.eliminated ? 'ELIMINATED // 0 HEALTH' : `IKS OKS HEALTH ${s.hp}/${MAX}`;
      return `<span class="iks-hp-wrap${classes(s)}" style="--iks-hp:${s.hp}" title="${label}">${avatarHTML}<i class="iks-hp-ring" aria-hidden="true"></i>${s.victor ? '<i class="iks-fire" aria-hidden="true"></i>' : ''}</span>`;
    },
    // Extra class for a chat message whose author won the gauntlet.
    messageClass(entity) {
      return standing(entity)?.victor ? ' iks-victor-message' : '';
    },
    // Decorate a fixed element (the player's own profile avatar preview).
    applyTo(element, entity) {
      if (!element) return;
      const s = standing(entity);
      ['iks-hp', 'iks-hp-low', 'iks-hp-mid', 'iks-eliminated', 'iks-victor'].forEach(c => element.classList.remove(c));
      element.querySelectorAll(':scope > .iks-hp-ring, :scope > .iks-fire').forEach(node => node.remove());
      if (!s) { element.style.removeProperty('--iks-hp'); element.removeAttribute('data-iks-hp'); return; }
      classes(s).trim().split(/\s+/).forEach(c => element.classList.add(c));
      element.style.setProperty('--iks-hp', String(s.hp));
      element.dataset.iksHp = `${s.hp}/${MAX}`;
      element.insertAdjacentHTML('beforeend', '<i class="iks-hp-ring" aria-hidden="true"></i>' + (s.victor ? '<i class="iks-fire" aria-hidden="true"></i>' : ''));
    }
  };

  if (typeof window !== 'undefined') window.IksRing = IksRing;
  if (typeof module !== 'undefined' && module.exports) module.exports = IksRing;
})();
