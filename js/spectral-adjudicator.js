(() => {
  'use strict';
  const root = () => document.getElementById('spectral-console');
  const send = payload => window.App?.send?.(payload);
  let reviewPanel, reviewList, reviewToggle, reviewNotice;
  let previousIds = new Set();
  let pendingEntries = [];
  function node(tag, text) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; }
  function ensureReview() {
    if (reviewPanel) return;
    reviewToggle = node('button', 'SPECTRA // 0 TO REVIEW');
    reviewToggle.type = 'button'; reviewToggle.id = 'spectral-review-toggle'; reviewToggle.hidden = true;
    reviewToggle.setAttribute('aria-controls', 'spectral-review-panel');
    reviewToggle.setAttribute('aria-expanded', 'false');
    reviewPanel = node('section'); reviewPanel.id = 'spectral-review-panel'; reviewPanel.hidden = true;
    reviewPanel.setAttribute('aria-label', 'Spectra GM answer review');
    const header = node('header'); header.append(node('strong', 'SPECTRA // GM REVIEW'));
    const close = node('button', 'MINIMIZE'); close.type = 'button';
    close.addEventListener('click', () => setOpen(false)); header.append(close);
    reviewNotice = node('p'); reviewNotice.setAttribute('role', 'status'); reviewNotice.setAttribute('aria-live', 'polite');
    reviewList = node('div'); reviewList.id = 'spectral-review-list';
    reviewPanel.append(header, reviewNotice, reviewList);
    document.body.append(reviewToggle, reviewPanel);
    reviewToggle.addEventListener('click', () => setOpen(reviewPanel.hidden));
    reviewPanel.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); reviewToggle.focus(); } });
  }
  function setOpen(open) { reviewPanel.hidden = !open; reviewToggle.setAttribute('aria-expanded', String(open)); }
  function renderReview(entries) {
    ensureReview();
    const fresh = entries.some(entry => !previousIds.has(entry.messageId));
    previousIds = new Set(entries.map(entry => entry.messageId));
    // Avoid resetting the GM's target selection on unrelated state updates.
    const changed = JSON.stringify(entries) !== JSON.stringify(pendingEntries);
    pendingEntries = entries;
    reviewToggle.hidden = entries.length === 0;
    reviewToggle.textContent = `SPECTRA // ${entries.length} TO REVIEW`;
    if (!entries.length) { setOpen(false); reviewList.replaceChildren(); return; }
    if (changed) {
      reviewList.replaceChildren();
      for (const entry of entries) {
        const card = node('article'); card.dataset.messageId = entry.messageId;
        card.append(node('strong', entry.playerName || 'PLAYER'), node('blockquote', entry.text || entry.answer || ''));
        card.append(node('p', `${entry.reason || 'GM_APPROVAL_REQUIRED'} // proposed answer: ${entry.answer || ''}`));
        const label = node('label', 'Judge for '), select = node('select');
        select.setAttribute('aria-label', `Target for ${entry.playerName || 'player'} answer`);
        for (const target of ['', 'A', 'B', 'C', 'D', 'FINAL']) {
          const option = node('option', target || 'SELECT TARGET'); option.value = target; select.append(option);
        }
        select.value = entry.reason === 'AMBIGUOUS_TARGET' ? '' : entry.target || '';
        label.append(select); card.append(label);
        const accept = node('button', 'ACCEPT'), reject = node('button', 'REJECT');
        accept.type = reject.type = 'button'; accept.disabled = !select.value;
        select.addEventListener('change', () => { accept.disabled = !select.value; });
        for (const [button, verdict] of [[accept, 'correct'], [reject, 'wrong']]) {
          button.addEventListener('click', () => {
            send({ type: 'gm:judgeGuess', messageId: entry.messageId, verdict, target: select.value || entry.target });
            reviewNotice.textContent = 'Verdict sent. Waiting for server confirmation.';
          });
          card.append(button);
        }
        reviewList.append(card);
      }
    }
    if (fresh) { setOpen(true); reviewNotice.textContent = `${entries.length} answer${entries.length === 1 ? '' : 's'} need your judgment. Nothing has been accepted automatically.`; }
  }
  function render(state = {}) {
    const mode = state.mode || 'MANUAL';
    const paused = state.paused === true;
    const select = document.getElementById('spectral-mode');
    if (select) select.value = mode;
    const status = document.getElementById('spectral-status');
    if (status) status.textContent = `${state.scheduleArmed ? 'ARMED 12:55' : 'DISARMED'} // ${mode}${paused ? ' // PAUSED' : ''}`;
    if (status) status.title = `Belgrade: summon 12:55; start 13:00 with 5 votes; cutoff 13:05.${state.scheduleStatus ? ' Daily status: ' + state.scheduleStatus : ''}`;
    const pending = document.getElementById('spectral-pending');
    if (pending) pending.textContent = `${(state.pending || []).length} PENDING`;
    renderReview(state.pending || []);
    root()?.classList.toggle('is-paused', paused);
    root()?.classList.toggle('is-armed', state.scheduleArmed === true);
  }
  function init() {
    document.getElementById('spectral-mode')?.addEventListener('change', e => send({ type:'gm:spectral:mode', mode:e.target.value }));
    document.getElementById('spectral-arm')?.addEventListener('click', () => send({ type:'gm:spectral:arm' }));
    document.getElementById('spectral-disarm')?.addEventListener('click', () => send({ type:'gm:spectral:disarm' }));
    send({ type:'gm:spectral:sync' });
  }
  const api = { open(){ send({ type:'gm:spectral:sync' }); }, onMessage(message){
    if(message.type === 'spectral:state') render(message.state);
    if(message.type === 'error' && reviewPanel && !reviewPanel.hidden) reviewNotice.textContent = message.message || 'Verdict could not be applied. Please try again.';
    if(['room:created','host:reconnected','host:recovered'].includes(message.type)) send({type:'gm:spectral:sync'});
  } };
  window.App?.registerGmModule?.('spectral-adjudicator', api);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
