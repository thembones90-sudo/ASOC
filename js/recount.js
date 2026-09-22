/*
 * ASOC ENGINE - RECOUNT screen (shared by the GM console and every player).
 *
 * The post-game results phase. The server computes the RECOUNT once, stores it
 * with the match, and delivers it as `recount:update {recount, live}` ONLY
 * after the host presses SHOW RESULTS. This module only renders it:
 *   live:true   -> staged reveal (winner -> scoreboard -> awards one by one,
 *                  a longer pause before a third -> overall rankings)
 *   live:false  -> hydration (late join / reconnect): stored, NOT auto-opened
 *                  and never replayed; reopened on demand, fully revealed
 *   recount:null-> closes and forgets it (board reset / match re-opened)
 * Never compute or decide anything here: every award and rank is the server's.
 */
const Recount = (() => {
  let data = null;
  let overlay = null;
  let timers = [];
  let pill = null;
  const listeners = [];
  const keyHandler = e => { if (e.key === 'Escape') close(); };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = n => Number(n || 0).toLocaleString('en-US');

  function movementHTML(movement) {
    if (movement === null || movement === undefined) return '<span class="rc-move rc-move-none">—</span>';
    if (movement > 0) return `<span class="rc-move rc-move-up">▲${movement}</span>`;
    if (movement < 0) return `<span class="rc-move rc-move-down">▼${Math.abs(movement)}</span>`;
    return '<span class="rc-move rc-move-none">—</span>';
  }

  function namesOf(list) { return list.map(x => esc(x.name)).join(' <i>&amp;</i> '); }

  function buildAwardCard(award, index) {
    return `
      <article class="rc-award rc-cat-${esc(award.category)}${award.severity ? ` rc-sev-${esc(award.severity)}` : ''} rc-step" data-step="award-${index}">
        <div class="rc-award-head">${esc(award.header)}</div>
        <div class="rc-award-body">
          <div class="rc-award-title">${esc(award.id)}</div>
          <div class="rc-award-who">${award.playerNames.map(esc).join(' <i>&amp;</i> ')}</div>
          <ul class="rc-evidence">${award.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
          <div class="rc-commentary">${esc(award.commentary)}</div>
        </div>
      </article>`;
  }

  function buildFindingCard(finding, index, offset) {
    return `
      <article class="rc-award rc-cat-loss rc-step" data-step="award-${offset + index}">
        <div class="rc-award-head">LOSS FINDING</div>
        <div class="rc-award-body">
          <div class="rc-award-title">${esc(finding.type)}</div>
          <div class="rc-award-who">${finding.group ? 'ALL PLAYERS' : esc(finding.playerName || '')}</div>
          <div class="rc-commentary">${esc(finding.comment)}</div>
        </div>
      </article>`;
  }

  function build(r) {
    const lost = r.outcome === 'LOST';
    const tops = lost ? (r.topPerformers || []) : (r.winners || []);
    const label = r.topLabel || (lost ? 'TOP PERFORMER' : 'MATCH WINNER');
    const findings = Array.isArray(r.lossFindings) ? r.lossFindings : [];
    const awardCards = r.awards.map(buildAwardCard);
    const findingCards = findings.map((f, i) => buildFindingCard(f, i, r.awards.length));
    const stripNames = tops.length ? tops.map(t => esc(t.name)).join(' &amp; ') : '—';

    const board = r.scoreboard.map((row, i) => `
      <tr class="rc-row rc-step" data-step="board" style="--i:${i}">
        <td class="rc-rank">${row.rank}</td>
        <td class="rc-name">${esc(row.name)}${tops.some(t => t.name === row.name) ? ' <b class="rc-crown">◆</b>' : ''}</td>
        <td class="rc-num">${num(row.points)}</td>
        <td class="rc-num rc-dim">${row.judged.correct}/${row.judged.total}</td>
      </tr>`).join('');

    const overall = r.overall.map((row, i) => `
      <tr class="rc-row rc-step${row.inMatch ? ' rc-inmatch' : ''}" data-step="overall" style="--i:${i}">
        <td class="rc-rank">${row.rank}</td>
        <td class="rc-name">${esc(row.name)}</td>
        <td class="rc-num">${num(row.total)}</td>
        <td class="rc-num rc-dim rc-hide-sm">${row.gamesPlayed}</td>
        <td class="rc-num rc-dim rc-hide-sm">${row.average === null ? '—' : num(row.average)}</td>
        <td class="rc-num">${movementHTML(row.movement)}</td>
      </tr>`).join('');

    const noAwards = !awardCards.length && !findingCards.length
      ? '<div class="rc-empty rc-step" data-step="award-0">NO NOTABLE FINDINGS. THE SYSTEM FOUND NOTHING WORTH REPORTING.</div>' : '';

    return `
      <div class="recount-panel">
        <header class="recount-head">
          <div>
            <div class="recount-title">RECOUNT</div>
            <div class="recount-sub">AUDIT OF COMPLETED MATCH${r.title ? ` // ${esc(r.title)}` : ''}
              ${lost ? '<b class="rc-badge rc-badge-lost">GAME LOST</b>' : (r.gameWon ? '<b class="rc-badge rc-badge-won">GAME WON</b>' : '')}</div>
          </div>
          <div class="recount-controls">
            <button type="button" class="recount-skip">SKIP</button>
            <button type="button" class="recount-close">CLOSE</button>
          </div>
        </header>

        <section class="rc-block rc-top rc-step" data-step="top">
          <div class="rc-label">${esc(label)}</div>
          ${tops.length
            ? `<div class="rc-top-name">${namesOf(tops)}</div><div class="rc-top-points">${num(tops[0].points)} POINTS</div>`
            : '<div class="rc-top-name rc-dim">NONE</div><div class="rc-top-points">NO PLAYER EARNED POINTS</div>'}
          <div class="rc-strip">${esc(label.replace('MATCH ', ''))}: ${stripNames} · HIGH SCORE: ${num(r.summary.highScore)} · PLAYERS: ${r.summary.players} · ${lost ? 'GAME LOST' : 'GAME COMPLETE'} · TOTAL POINTS: ${num(r.summary.totalPoints)}</div>
        </section>

        <section class="rc-block rc-step" data-step="boardhead">
          <h3>MATCH SCOREBOARD</h3>
          <table class="rc-table"><thead><tr><th>#</th><th>PLAYER</th><th class="rc-num">MATCH PTS</th><th class="rc-num">CORRECT</th></tr></thead>
            <tbody>${board}</tbody></table>
        </section>

        <section class="rc-block rc-awards-wrap">
          <h3 class="rc-step" data-step="award-0">MATCH AWARDS</h3>
          ${awardCards.join('')}${findings.length ? '<h3 class="rc-sub-h">LOSS FINDINGS</h3>' : ''}${findingCards.join('')}${noAwards}
        </section>

        <section class="rc-block rc-step" data-step="overallhead">
          <h3>OVERALL RANKINGS</h3>
          <table class="rc-table"><thead><tr><th>#</th><th>PLAYER</th><th class="rc-num">TOTAL</th><th class="rc-num rc-hide-sm">GAMES</th><th class="rc-num rc-hide-sm">AVG</th><th class="rc-num">MOVE</th></tr></thead>
            <tbody>${overall}</tbody></table>
        </section>
      </div>`;
  }

  // Reveal choreography. Every step is an element with data-step; a step is
  // shown by adding .is-in (CSS transitions do the fading).
  function stepsOf(group) { return overlay ? Array.from(overlay.querySelectorAll(`[data-step="${group}"]`)) : []; }
  function show(group) { stepsOf(group).forEach((el, i) => setTimeout(() => el.classList.add('is-in'), i * 140)); }
  function showAll() {
    timers.forEach(clearTimeout); timers = [];
    if (overlay) {
      overlay.querySelectorAll('.rc-step').forEach(el => el.classList.add('is-in'));
      overlay.classList.add('rc-done');
    }
  }
  function schedule(delay, fn) { timers.push(setTimeout(fn, delay)); }

  function playReveal(r) {
    const awardCount = r.awards.length + (Array.isArray(r.lossFindings) ? r.lossFindings.length : 0);
    schedule(500, () => show('top'));
    schedule(1900, () => { show('boardhead'); show('board'); });
    // One award at a time. The third lands after a slightly longer pause: the
    // system has just found something else.
    let at = 3900;
    for (let i = 0; i < Math.max(1, awardCount); i++) {
      const step = i;
      schedule(at, () => show(`award-${step}`));
      at += i === 1 ? 3200 : 2600;
    }
    schedule(at + 600, () => { show('overallhead'); show('overall'); });
    schedule(at + 2600, () => overlay && overlay.classList.add('rc-done'));
  }

  function close() {
    timers.forEach(clearTimeout); timers = [];
    document.removeEventListener('keydown', keyHandler);
    if (overlay) { overlay.remove(); overlay = null; }
    notify();
  }

  function open({ live = false } = {}) {
    if (!data) return;
    close();
    overlay = document.createElement('div');
    overlay.className = 'recount-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'RECOUNT');
    overlay.innerHTML = build(data);
    document.body.appendChild(overlay);
    overlay.querySelector('.recount-close').addEventListener('click', close);
    overlay.querySelector('.recount-skip').addEventListener('click', showAll);
    document.addEventListener('keydown', keyHandler);
    if (live) playReveal(data); else showAll();
    notify();
  }

  function notify() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); updatePill(); }

  // Players get a small reopen pill (the GM has its own console button).
  function updatePill() {
    if (!pill) return;
    const casual = document.getElementById('game-screen')?.classList.contains('room-mode-casual') === true;
    pill.hidden = !data || !!overlay || casual;
  }
  function mountPill() {
    if (pill) return;
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'recount-pill';
    pill.textContent = 'RECOUNT';
    pill.hidden = true;
    pill.addEventListener('click', () => open({ live: false }));
    document.body.appendChild(pill);
    updatePill();
  }

  // recount === null closes and forgets. live === true plays the staged reveal
  // (the host just pressed SHOW RESULTS); anything else only stores it.
  function apply(recount, { live = false } = {}) {
    if (!recount) {
      data = null;
      close();
      return;
    }
    data = recount;
    if (live) open({ live: true }); else notify();
  }

  return {
    apply, open, close, mountPill,
    refreshPill: updatePill,
    has: () => !!data,
    isOpen: () => !!overlay,
    onChange: fn => listeners.push(fn),
    _data: () => data
  };
})();

window.Recount = Recount;
