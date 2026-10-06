// THE FINAL HAS FALLEN -- the Final was solved while columns are still open.
//
// Driven entirely by the server's public state (state.finalDebt =
// { by, at, owed:[cols], paid:[cols] } | null), on both the Little Hero page
// and the Shadow Broker console:
//   - one-time 3.5 s sequence: board dims, a blood wax seal slams onto the
//     Final, "THE FINAL HAS FALLEN / BUT THE DEBT IS NOT PAID", owed tokens;
//   - lasting state: Final SEALED, owed columns chained + pulsing, debt strip;
//   - an owed column solved: its chains shatter, PAID stamp, strip counts down;
//   - all paid: ALL DEBTS PAID (the cue for the Shadow Broker's GAME WON).
// Refreshes and late joiners get the lasting state without the sequence.
(function () {
  'use strict';

  const COLS = ['A', 'B', 'C', 'D'];
  const SEEN_KEY = 'asoc_final_debt_seen';
  const html = document.documentElement;
  let current = null;
  let currentKey = '';
  let baselined = false;
  let layer = null;
  let tick = null;
  let paidShown = new Set();

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const seen = () => { try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; } };
  const markSeen = key => { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen().filter(k => k !== key), key].slice(-20))); } catch {} };
  const board = () => document.getElementById('board-layer');
  const cell = key => board()?.querySelector(`[data-label="${key}"]`) || null;
  const visibleRect = el => { const r = el?.getBoundingClientRect(); return r && r.width > 4 && r.height > 4 ? r : null; };

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = 'fd-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    return layer;
  }

  function clearDecor() {
    COLS.forEach(c => html.removeAttribute(`data-fd-owe-${c.toLowerCase()}`));
    html.removeAttribute('data-fd-active');
    if (layer) layer.innerHTML = '';
    clearInterval(tick);
    tick = null;
  }

  // Persistent debt markers are intentionally forbidden. The FALLEN ceremony
  // is the notification; after it finishes, the battlefield must be clean.
  function place() {
    if (layer) layer.innerHTML = '';
  }
  function decorate() {
    // The FALLEN banner and DEBT PAID stamps are transient notifications.
    // Keep current debt data in memory for confirmation/scoring, but leave
    // the battlefield clean once those notifications finish.
    clearDecor();
  }

  // The one-time ceremony.
  function playFallen(debt) {
    document.getElementById('fd-banner')?.remove();
    const tokens = (debt.owed || []).map((c, i) => `<em style="animation-delay:${2.4 + i * 0.15}s">${esc(c)}</em>`).join('');
    const banner = document.createElement('div');
    banner.id = 'fd-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
      <div class="fd-veil"></div>
      <div class="fd-card">
        <div class="fd-runes"></div>
        <div class="fd-line fd-line-1"><b>THE FINAL HAS FALLEN</b><small>claimed by ${esc(debt.by || 'a Little Hero')}</small></div>
        <div class="fd-line fd-line-2"><b>BUT THE DEBT IS NOT PAID</b><div class="fd-tokens">${tokens}</div></div>
        <div class="fd-runes"></div>
      </div>`;
    document.body.appendChild(banner);
    window.AsocAudio?.debtSealed?.();
    // The seal slams onto the Final at 0.3 s, the board shudders.
    setTimeout(() => {
      const fin = visibleRect(cell('FINAL'));
      if (fin) {
        const slam = document.createElement('i');
        slam.className = 'fd-seal is-slam';
        slam.style.left = `${fin.left + fin.width / 2 - 34}px`;
        slam.style.top = `${fin.top + fin.height / 2 - 34}px`;
        slam.innerHTML = '<b>SEALED</b>';
        document.body.appendChild(slam);
        setTimeout(() => slam.remove(), 1600);
      }
      board()?.classList.add('fd-shudder');
      setTimeout(() => board()?.classList.remove('fd-shudder'), 500);
    }, 300);
    setTimeout(() => banner.classList.add('is-leaving'), 3200);
    setTimeout(() => banner.remove(), 3700);
  }

  function playPaid(col) {
    window.AsocAudio?.debtPaid?.();
    const r = visibleRect(cell(`${col}5`)) || visibleRect(cell(`${col}1`));
    if (!r) return;
    const stamp = document.createElement('i');
    stamp.className = 'fd-paid';
    stamp.style.left = `${r.left + r.width / 2}px`;
    stamp.style.top = `${r.top + r.height / 2}px`;
    stamp.innerHTML = `<b>DEBT PAID</b>${'<s></s>'.repeat(7)}`;
    document.body.appendChild(stamp);
    setTimeout(() => stamp.remove(), 1500);
  }

  function update(state) {
    if (!state) return;
    const battle = state.roomMode && state.roomMode !== 'CASUAL';
    const debt = battle ? state.finalDebt || null : null;
    const key = debt ? `${state.gameId || ''}:${debt.at || ''}` : '';
    if (!baselined) {
      // First state after a load / reconnect: hydrate silently.
      baselined = true;
      if (key) markSeen(key);
      paidShown = new Set(debt?.paid || []);
    } else if (debt && key !== currentKey) {
      paidShown = new Set(debt.paid || []);
      if (debt.owed?.length && !seen().includes(key)) { markSeen(key); playFallen(debt); }
    } else if (debt) {
      (debt.paid || []).forEach(c => { if (!paidShown.has(c)) { paidShown.add(c); playPaid(c); } });
    }
    current = debt;
    currentKey = key;
    decorate();
  }

  window.addEventListener('resize', () => current && place());
  document.addEventListener('scroll', () => current && place(), true);

  // Shadow Broker: GAME WON while columns are still owed asks first.
  function confirmGameWon() {
    const owed = current?.owed || [];
    if (!owed.length) return true;
    const many = owed.length > 1;
    return window.confirm(`Column${many ? 's' : ''} ${owed.join(', ')} ${many ? 'are' : 'is'} still owed.\n\nDeclare GAME WON anyway?`);
  }

  window.FinalDebt = { update, confirmGameWon, get current() { return current; }, _playFallen: playFallen, _playPaid: playPaid };
})();
