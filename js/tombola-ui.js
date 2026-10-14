(() => {
  'use strict';
  const ui = { state: null, open: false, pending: false, error: '', lastReveal: '', finale: '', clockOffset: 0 };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = () => window.App || window.PlayerApp;
  const send = (type, extra = {}) => {
    const result = app()?.send?.({ type, roundId: ui.state?.id, ...extra });
    if (result === false || !app()?.send) { ui.pending = false; ui.error = 'CONNECTION LOST // RECONNECT TO THE MASTER ROOM'; }
    return result;
  };
  const gm = () => !!window.App && !window.PlayerApp;
  function ensure() {
    let root = document.getElementById('tombola-overlay');
    if (root) return root;
    root = document.createElement('section'); root.id = 'tombola-overlay'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'ASOC Tombola');
    document.body.append(root);
    root.addEventListener('animationend', event => {
      if (event.target.matches('.tombola-field.is-new-reveal')) {
        event.target.classList.remove('is-new-reveal');
        event.target.querySelector('.tombola-reveal-fx')?.remove();
      }
    });
    root.addEventListener('click', event => {
      const close = event.target.closest('[data-tombola-close]');
      if (close) { if (!ui.state?.requiredTribute) { ui.open = false; root.hidden = true; } return; }
      if (event.target.closest('[data-tombola-pay]')) { window.BlackMarket?.open?.(); return; }
      const field = event.target.closest('[data-tombola-field]');
      if (field && ui.state?.viewer?.canPick && !ui.pending && !field.disabled) {
        ui.pending = true; ui.error = ''; send('tombola:pick', { field: Number(field.dataset.tombolaField) }); render(); return;
      }
      const action = event.target.closest('[data-tombola-action]')?.dataset.tombolaAction;
      if (!action || ui.pending) return;
      ui.pending = true; ui.error = ''; send(`tombola:${action}`); render();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && ui.open && !ui.state?.requiredTribute) { ui.open = false; root.hidden = true; } });
    document.addEventListener('focusin', event => {
      if (ui.state?.requiredTribute && !event.target.closest('#tombola-overlay, #black-market-overlay, #bm-demand-notice, #bm-tribute-consent')) root.querySelector('[data-tombola-pay]')?.focus();
    });
    return root;
  }
  function render() {
    const required = !!ui.state?.requiredTribute;
    if (required) ui.open = true;
    let veil = document.getElementById('tombola-required-veil');
    if (required && !veil) { veil = document.createElement('div'); veil.id = 'tombola-required-veil'; document.body.append(veil); }
    if (!required) veil?.remove();
    const root = ensure(); root.hidden = !ui.open;
    root.setAttribute('aria-modal', required ? 'true' : 'false');
    if (!ui.open) return;
    const s = ui.state;
    const fields = s?.fields || Array.from({ length: 36 }, (_, i) => ({ field: i + 1, revealed: false }));
    const terminal = s?.phase === 'ENDED', cancelled = s?.phase === 'CANCELLED';
    const tiles = fields.map(f => {
      const kind = f.revealed ? f.kind.toLowerCase() : 'closed';
      const amount = ['BLESSING', 'GRAIL'].includes(f.kind) ? `+${f.amount}` : `−${f.amount}`;
      const fresh = ui.lastReveal === `${s?.id}:${f.field}`;
      const fx = fresh ? '<span class="tombola-reveal-fx" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : '';
      const outcome = f.kind === 'GRAIL' ? '<b class="tombola-outcome tombola-grail"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M11 6h18l-2 12q-2 6-7 6t-7-6zM11 9H5q0 10 10 10M29 9h6q0 10-10 10M20 24v9M12 35h16"/></svg><span>THE GRAIL</span>+50<small>SC</small></b>' : f.kind === 'BLOOD_TRIBUTE' ? '<b class="tombola-outcome">BLOOD<br>TRIBUTE</b>' : `<b class="tombola-outcome">${amount}<small>SC</small></b>`;
      const label = f.revealed ? f.kind === 'BLOOD_TRIBUTE' ? `Field ${f.field}: Blood Tribute. Due after all 36 fields open.` : `Field ${f.field}: ${f.kind}, ${amount} SC. Actual balance change ${f.actualAmount} SC.` : `Open field ${f.field}`;
      return `<button type="button" class="tombola-field is-${kind}${fresh ? ' is-new-reveal' : ''}" data-tombola-field="${f.field}" aria-label="${esc(label)}" ${f.revealed || !s?.viewer?.canPick || ui.pending ? 'disabled' : ''}><span class="tombola-number">${f.field}</span>${fx}${f.revealed ? outcome : ''}</button>`;
    }).join('');
    const control = !s?.active ? gm() ? '<button data-tombola-action="create">OPEN A TOMBOLA LOBBY</button>' : '<p>THE SHADOW BROKER HAS NOT OPENED A ROUND.</p>'
      : s.phase === 'LOBBY' ? gm() ? '<button data-tombola-action="start">START ROUND</button><button data-tombola-action="cancel">CANCEL LOBBY</button>'
        : s.viewer?.participant ? '<button data-tombola-action="leave">LEAVE LOBBY</button>' : '<button data-tombola-action="join">JOIN TOMBOLA</button>'
      : s.phase === 'PLAYING' ? gm() ? '<button data-tombola-action="cancel">CANCEL ROUND</button>' : ''
      : gm() ? '<button data-tombola-action="create">OPEN A FRESH ROUND</button>' : '';
    root.classList.toggle('tombola-finale', terminal && ui.finale === s.id);
    root.innerHTML = `<div class="tombola-shell"><header class="tombola-heading"><div><small>SHADOW BROKER // SEALED FORTUNES</small><h2>ASOC TOMBOLA</h2></div><button data-tombola-close aria-label="Close Tombola">×</button></header><div class="tombola-turn" role="status">${terminal ? 'THE ROUND IS OVER FOR EVERYONE' : cancelled ? 'ROUND CANCELLED' : s?.phase === 'PLAYING' ? `${s.viewer?.canPick ? 'YOUR TURN' : 'CURRENT TURN'} // ${esc(s.currentPlayerName)}` : 'LOBBY // THE FIELDS REMAIN SEALED'}</div>${terminal ? `<div class="tombola-blood-verdict" role="alert"><strong>BLOOD TRIBUTE REQUIRED</strong><b>${esc(s.tributePlayerName)}</b><p>ALL 36 VAULTS ARE OPEN. THE MARKED PLAYER MUST SUBMIT BLOOD TRIBUTE IN THE BLACK MARKET.</p></div>` : ''}<div class="tombola-board" role="group" aria-label="36 numbered Tombola vaults">${tiles}</div><div class="tombola-status" role="status">${esc(ui.error || (ui.pending ? 'THE LOCK IS TURNING…' : s?.phase === 'PLAYING' ? 'ONE FIELD PER TURN. NO WAGERS. NO MERCY.' : '17 BLESSINGS · THE GRAIL +50 · 17 CURSES · ONE BLOOD TRIBUTE'))}</div><div class="tombola-controls">${control}</div>${s?.participants?.length ? `<ol class="tombola-roster" aria-label="Turn order">${s.participants.map(p => `<li${s.currentPlayerId === p.id ? ' class="is-active"' : ''}>${esc(p.name)}</li>`).join('')}</ol>` : ''}${s?.history?.length ? `<details class="tombola-history"><summary>PREVIOUS ROUNDS // ${s.history.length}</summary>${s.history.slice().reverse().map(r => `<p>${esc(r.id)} · ${esc(r.phase)} · ${r.revealedCount} OPENED${r.tributePlayerName ? ` · BLOOD: ${esc(r.tributePlayerName)}` : ''}</p>`).join('')}</details>` : ''}</div>`;
    if (ui.pending) root.querySelectorAll('[data-tombola-action]').forEach(button => { button.disabled = true; });
    if (required) {
      root.querySelector('[data-tombola-close]').disabled = true;
      root.querySelector('.tombola-controls').innerHTML = '<p>YOUR BLOOD TRIBUTE IS REQUIRED. SUBMIT IT TO CONTINUE.</p><button data-tombola-pay>SUBMIT BLOOD TRIBUTE</button>';
    }
    updateSignupCountdown();
    if (s?.phase === 'PLAYING') {
      root.querySelector('.tombola-turn').append(` // CYCLE ${s.cycle}`);
      const roster = root.querySelector('.tombola-roster');
      if (roster) roster.innerHTML = s.turnOrder.map(id => s.participants.find(p => p.id === id)).map(p => `<li${s.currentPlayerId === p.id ? ' class="is-active"' : ''}>${esc(p.name)}</li>`).join('');
    }
    ui.lastReveal = '';
  }
  function updateSignupCountdown() {
    const s = ui.state, root = document.getElementById('tombola-overlay');
    if (!ui.open || s?.phase !== 'LOBBY' || !root) return;
    const seconds = Math.max(0, Math.ceil((s.signupEndsAt - (Date.now() + ui.clockOffset)) / 1000));
    const remaining = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    root.querySelector('.tombola-turn').textContent = `LOBBY // ${s.participants.length} / 10 PLAYERS // ${seconds ? `SIGNUP ${remaining}` : 'SIGNUP CLOSED // WAITING FOR GM'}`;
    const join = root.querySelector('[data-tombola-action="join"]'); if (join) join.disabled = !seconds || !s.viewer.canJoin || ui.pending;
    const leave = root.querySelector('[data-tombola-action="leave"]'); if (leave) leave.disabled = !seconds || ui.pending;
  }
  setInterval(updateSignupCountdown, 1000);
  function onMessage(message) {
    if (message.type === 'tombola:error') { ui.error = message.error || 'TOMBOLA ACTION REFUSED'; ui.pending = false; render(); return; }
    if (message.type !== 'tombola:state') return;
    const prior = ui.state;
    ui.clockOffset = Number.isFinite(message.state?.serverNow) ? message.state.serverNow - Date.now() : 0;
    const { serverNow: oldClock, ...oldView } = prior || {};
    const { serverNow: newClock, ...newView } = message.state || {};
    if (prior && !ui.pending && JSON.stringify(oldView) === JSON.stringify(newView)) { updateSignupCountdown(); return; }
    ui.state = message.state; ui.pending = false; ui.error = '';
    ui.clockOffset = Number.isFinite(message.state?.serverNow) ? message.state.serverNow - Date.now() : 0;
    const reveals = ui.state?.fields?.filter(f => f.revealed) || [];
    if (ui.state?.id === prior?.id && reveals.length > (prior.fields?.filter(f => f.revealed).length || 0)) {
      const last = reveals.find(f => !prior.fields?.some(p => p.field === f.field && p.revealed)); ui.lastReveal = ui.open && last ? `${ui.state.id}:${last.field}` : '';
    } else ui.lastReveal = '';
    if (ui.state?.phase === 'PLAYING' && prior?.phase !== 'PLAYING' && ui.state.viewer?.participant) ui.open = true;
    if (ui.state?.phase === 'ENDED' && (prior?.id !== ui.state.id || prior?.phase !== 'ENDED')) {
      ui.finale = ui.state.id; ui.open = true;
    } else ui.finale = '';
    render();
  }
  function open() { ui.open = true; ensure(); send('tombola:sync'); render(); }
  function installLauncher() {
    document.getElementById('minigames-tombola')?.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const menu = document.getElementById('casual-minigames-menu'); if (menu) menu.hidden = true;
      open();
    });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', installLauncher, { once: true }) : installLauncher();
  window.TombolaUI = { open, onMessage };
})();
