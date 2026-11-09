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

  const prose = value => String(value ?? '').replace(/\s*\/\/\s*/g, ' · ');
  const heading = value => prose(value).replace(/[_-]/g, ' ').toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
  function faceHTML(name) {
    const roster = window.App?.currentPlayers || window.PlayerApp?.currentPlayers || [];
    const player = roster.find(p => String(p.name).toLowerCase() === String(name).toLowerCase());
    const url = String(player?.avatarData || '');
    const safe = /^(?:https?:\/\/|\/(?!\/)|assets\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(url);
    const initials = String(name || '?').trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('');
    return `<span class="rc-avatar" aria-hidden="true">${safe ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initials)}</span>`;
  }
  function namesOf(list) { return list.map(x => `<span class="rc-person">${faceHTML(x.name)}<span>${esc(x.name)}</span></span>`).join(''); }

  function buildAwardCard(award, index) {
    return `
      <article class="rc-award rc-cat-${esc(award.category)}${award.severity ? ` rc-sev-${esc(award.severity)}` : ''} rc-step" data-step="award-${index}">
        <div class="rc-award-head">${esc(heading(award.header))}</div>
        <div class="rc-award-body">
          <div class="rc-award-title">${esc(heading(award.id))}</div>
          <div class="rc-award-who">${namesOf(award.playerNames.map(name=>({name})))}</div>
          <ul class="rc-evidence">${award.evidence.map(e => `<li>${esc(prose(e))}</li>`).join('')}</ul>
          <div class="rc-commentary">${esc(prose(award.commentary))}</div>
        </div>
      </article>`;
  }

  function buildFindingCard(finding, index, offset) {
    return `
      <article class="rc-award rc-cat-loss rc-step" data-step="award-${offset + index}">
        <div class="rc-award-head">Match finding</div>
        <div class="rc-award-body">
          <div class="rc-award-title">${esc(heading(finding.type))}</div>
          <div class="rc-award-who">${finding.group ? 'All players' : namesOf([{name:finding.playerName || ''}])}</div>
          <div class="rc-commentary">${esc(prose(finding.comment))}</div>
        </div>
      </article>`;
  }

  function build(r) {
    const lost = r.outcome === 'LOST';
    const tops = lost ? (r.topPerformers || []) : (r.winners || []);
    const label = r.topLabel || (lost ? 'TOP PERFORMER' : 'MATCH WINNER');
    const awardList = Array.isArray(r.awards) ? r.awards.slice(0, 3) : [];
    const findingBudget = Math.max(0, 3 - awardList.length);
    const findings = Array.isArray(r.lossFindings) ? r.lossFindings.slice(0, findingBudget) : [];
    const awardCards = awardList.map(buildAwardCard);
    const findingCards = findings.map((f, i) => buildFindingCard(f, i, awardList.length));
    const board = r.scoreboard.map((row, i) => `
      <tr class="rc-row rc-step${Number(row.rank) >= 1 && Number(row.rank) <= 3 ? ` rc-place-${Number(row.rank)}` : ''}" data-step="board" style="--i:${i}">
        <td class="rc-rank">${row.rank}</td>
        <td class="rc-name">${faceHTML(row.name)}<span>${esc(row.name)}</span>${tops.some(t => t.name === row.name) ? ' <b class="rc-crown">◆</b>' : ''}</td>
        <td class="rc-num">${num(row.points)}</td>
        <td class="rc-num rc-dim">${row.solves || 0}</td>
        <td class="rc-num rc-dim">${row.accuracy === null || row.accuracy === undefined ? '—' : Math.round(row.accuracy * 100) + '%'}</td>
      </tr>`).join('');

    const overall = r.overall.map((row, i) => `
      <tr class="rc-row rc-step${row.inMatch ? ' rc-inmatch' : ''}" data-step="overall" style="--i:${i}">
        <td class="rc-rank">${row.rank}</td>
        <td class="rc-name">${faceHTML(row.name)}<span>${esc(row.name)}</span></td>
        <td class="rc-num">${num(row.total)}</td>
        <td class="rc-num rc-dim rc-hide-sm">${row.gamesPlayed}</td>
        <td class="rc-num rc-dim rc-hide-sm">${row.average === null ? '—' : num(row.average)}</td>
        <td class="rc-num">${movementHTML(row.movement)}</td>
      </tr>`).join('');

    const noAwards = !awardCards.length && !findingCards.length
      ? '<div class="rc-empty rc-step" data-step="award-0">No notable findings for this match.</div>' : '';
    const satisfaction = r.satisfaction || {};
    const satisfactionAverage = satisfaction.average == null ? null : Number(satisfaction.average);
    const historicalAverage = satisfaction.historicalAverage == null ? null : Number(satisfaction.historicalAverage);
    const votes = Number(satisfaction.votes) || 0;
    const rating = Number.isFinite(satisfactionAverage) ? satisfactionAverage.toFixed(1) : '—';
    const history = Number.isFinite(historicalAverage)
      ? `All-time average ${historicalAverage.toFixed(1)}/10 across ${Number(satisfaction.ratedGames) || 0} rated games.` : 'No earlier ratings available.';
    return `
      <div class="recount-panel">
        <header class="recount-head">
          <div><div class="rc-report-kicker">Match report</div><h2 class="recount-title">Recount</h2><div class="recount-sub">${esc(prose(r.title || 'Completed match'))}</div></div>
          <div class="rc-header-end"><span class="rc-badge ${lost ? 'rc-badge-lost' : r.gameWon ? 'rc-badge-won' : ''}">${lost ? 'Game lost' : r.gameWon ? 'Game won' : 'Match complete'}</span>
          <div class="recount-controls"><button type="button" class="recount-skip">Show all</button><button type="button" class="recount-close" aria-label="Close Recount">Close</button></div></div>
        </header>
        <div class="rc-overview">
          <section class="rc-block rc-top rc-step" data-step="top">
            <div class="rc-winner-copy"><div class="rc-label">${esc(heading(label))}</div><div class="rc-top-name">${tops.length ? namesOf(tops) : 'No top performer'}</div></div>
            <div class="rc-top-points"><strong>${num(tops[0]?.points || 0)}</strong><span>points</span></div>
            <div class="rc-strip"><span><b>${num(r.summary.players)}</b> players</span><span><b>${num(r.summary.totalPoints)}</b> total points</span><span><b>${num(r.scoreboard.reduce((sum,row)=>sum+(Number(row.solves)||0),0))}</b> solutions</span></div>
          </section>
          <section class="rc-block rc-satisfaction rc-step" data-step="satisfaction">
            <h3>Player rating</h3><div class="rc-satisfaction-score">${rating}<span>/ 10</span></div>
            <div class="rc-rating-votes">${votes ? `${votes} ${votes === 1 ? 'vote' : 'votes'}` : 'No ratings yet'}</div>
            <div class="rc-satisfaction-history">${history}</div>
          </section>
        </div>
        <section class="rc-block rc-step" data-step="boardhead">
          <h3>Match scoreboard</h3><div class="rc-table-scroll"><table class="rc-table"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col" class="rc-num">Points</th><th scope="col" class="rc-num">Solves</th><th scope="col" class="rc-num">Accuracy</th></tr></thead><tbody>${board}</tbody></table></div>
        </section>
        <section class="rc-block rc-awards-wrap" style="--rc-awards:${Math.max(1, awardCards.length + findingCards.length)}"><h3 class="rc-step" data-step="award-0">Match awards</h3>${awardCards.join('')}${findingCards.join('')}${noAwards}</section>
        <section class="rc-block rc-overall rc-step" data-step="overallhead"><h3>Overall rankings</h3><div class="rc-table-scroll"><table class="rc-table"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col" class="rc-num">Total points</th><th scope="col" class="rc-num rc-hide-sm">Games</th><th scope="col" class="rc-num rc-hide-sm">Average</th><th scope="col" class="rc-num">Change</th></tr></thead><tbody>${overall}</tbody></table></div></section>
      </div>`;
  }

  // Reveal choreography. Every step is an element with data-step; a step is
  // shown by adding .is-in (CSS transitions do the fading).
  function stepsOf(group) { return overlay ? Array.from(overlay.querySelectorAll(`[data-step="${group}"]`)) : []; }
  function show(group) { stepsOf(group).forEach((el, i) => schedule(i * 100, () => el.isConnected && el.classList.add('is-in'))); }
  function showAll() {
    timers.forEach(clearTimeout); timers = [];
    if (overlay) {
      overlay.querySelectorAll('.rc-step').forEach(el => el.classList.add('is-in'));
      overlay.classList.add('rc-done');
      overlay.querySelector('.recount-skip').hidden = true;
    }
  }
  function schedule(delay, fn) { timers.push(setTimeout(fn, delay)); }

  function playReveal(r) {
    const awardCount = r.awards.length + (Array.isArray(r.lossFindings) ? r.lossFindings.length : 0);
    schedule(500, () => show('top'));
    schedule(1400, () => show('satisfaction'));
    schedule(2200, () => { show('boardhead'); show('board'); });
    // One award at a time. The third lands after a slightly longer pause: the
    // system has just found something else.
    let at = 3900;
    for (let i = 0; i < Math.max(1, awardCount); i++) {
      const step = i;
      schedule(at, () => show(`award-${step}`));
      at += i === 1 ? 3200 : 2600;
    }
    schedule(at + 600, () => { show('overallhead'); show('overall'); });
    schedule(at + 2600, showAll);
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
    if (live && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) playReveal(data); else showAll();
    notify();
  }

  function notify() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); updatePill(); }

  // Players get a small reopen pill (the GM has its own console button).
  function updatePill() {
    if (!pill) return;
    const casual = document.getElementById('game-screen')?.classList.contains('room-mode-casual') === true;
    const hide = !data || !!overlay || casual;
    if (pill.hidden !== hide) pill.hidden = hide;
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
