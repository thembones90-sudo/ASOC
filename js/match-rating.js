const MatchRating = (() => {
  let overlay = null;
  let state = null;
  let send = null;
  let isHost = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  function ratingButtons(selected) {
    return Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
      `<button type="button" class="match-rating-score${selected === n ? ' is-selected' : ''}" data-rating="${n}" aria-pressed="${selected === n ? 'true' : 'false'}">${n}</button>`
    ).join('');
  }

  function render() {
    if (!state || state.open !== true) { close(); return; }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'match-rating-overlay';
      document.body.appendChild(overlay);
    }

    const average = Number(state.average);
    const averageText = Number.isFinite(average) && state.votesCount > 0 ? average.toFixed(1) : '—';
    const selected = Number(state.myRating) || 0;

    overlay.innerHTML = isHost ? `
      <section class="match-rating-panel is-host" role="dialog" aria-modal="true" aria-label="Match satisfaction rating">
        <div class="match-rating-kicker">POST-MATCH // SATISFACTION AUDIT</div>
        <h1>RATE THE CARNAGE</h1>
        <p class="match-rating-copy">Little Heroes are scoring this game from 1 to 10. Humanity has finally found a number system it can operate under pressure.</p>
        <div class="match-rating-host-score"><strong>${averageText}</strong><span>/ 10</span></div>
        <div class="match-rating-host-meta">${Number(state.votesCount) || 0} / ${Number(state.eligibleCount) || 0} RATINGS RECEIVED</div>
        <button type="button" class="match-rating-proceed">PROCEED TO RECOUNT</button>
      </section>` : `
      <section class="match-rating-panel" role="dialog" aria-modal="true" aria-label="Rate this game">
        <div class="match-rating-kicker">AFTERMATH COMPLETE // ONE LAST VERDICT</div>
        <h1>RATE THIS GAME</h1>
        <p class="match-rating-copy">How much did you enjoy <b>${esc(state.title || 'this game')}</b>?</p>
        <div class="match-rating-scale-labels"><span>1 // MISERY</span><span>10 // GLORIOUS</span></div>
        <div class="match-rating-scores">${ratingButtons(selected)}</div>
        <div class="match-rating-status">${selected ? `RATING LOGGED // ${selected}/10` : 'SELECT ONE SCORE // 1–10'}</div>
      </section>`;

    if (isHost) {
      overlay.querySelector('.match-rating-proceed')?.addEventListener('click', () => {
        if (typeof send === 'function') send({ type: 'gm:showRecount' });
      });
    } else {
      overlay.querySelectorAll('.match-rating-score').forEach(btn => {
        btn.addEventListener('click', () => {
          const rating = Number(btn.dataset.rating);
          if (!Number.isInteger(rating) || rating < 1 || rating > 10 || typeof send !== 'function') return;
          send({ type: 'match:rate', rating });
        });
      });
    }
  }

  function open(nextState, options = {}) {
    state = { ...(nextState || {}), open: true };
    isHost = options.isHost === true;
    send = typeof options.send === 'function' ? options.send : send;
    render();
  }

  function update(nextState, options = {}) {
    if (options.isHost !== undefined) isHost = options.isHost === true;
    if (typeof options.send === 'function') send = options.send;
    state = { ...(state || {}), ...(nextState || {}) };
    if (state.open === false) { close(); return; }
    render();
  }

  return { open, update, close, isOpen: () => !!overlay };
})();

window.MatchRating = MatchRating;
