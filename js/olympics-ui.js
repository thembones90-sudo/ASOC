(function () {
  'use strict';
  const HANDS = { rock: ['🪨', 'ROCK'], paper: ['📜', 'PAPER'], scissors: ['✂️', 'SCISSORS'] };
  const safeSession = {
    get(key) { try { return sessionStorage.getItem(key) || ''; } catch (_) { return ''; } },
    set(key, value) { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch (_) {} }
  };
  const DISMISSED_KEY = 'asoc_olympics_dismissed_id';
  const INVITED_KEY = 'asoc_olympics_invited_id';
  const state = { data: null, championId: null, open: false, error: '', invitedId: safeSession.get(INVITED_KEY), dismissedId: safeSession.get(DISMISSED_KEY), lastReveal: '' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const app = () => window.App || window.PlayerApp;
  const isGm = () => !!window.App && !window.PlayerApp;
  const me = () => isGm() ? '__GM__' : String(window.PlayerApp?.playerId || '');
  const send = payload => app()?.send?.(payload);
  const person = id => state.data?.participants?.find(player => String(player.id) === String(id)) || { id, name: id ? 'LITTLE HERO' : 'BYE', avatarData: '', frameColor: '#60406e' };

  function avatar(player, large = false) {
    const image = player?.avatarData ? `<img src="${esc(player.avatarData)}" alt="">` : '<span>◆</span>';
    return `<span class="oly-avatar${large ? ' is-large' : ''}" style="--oly-frame:${esc(player?.frameColor || '#8844aa')}">${image}</span>`;
  }
  function ensure() {
    let root = document.getElementById('olympics-overlay');
    if (root) return root;
    root = document.createElement('section'); root.id = 'olympics-overlay'; root.className = 'oly-overlay'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Rock Paper Scissors Olympics');
    document.body.appendChild(root); return root;
  }
  function close() {
    state.open = false;
    if (state.data?.id) { state.dismissedId = String(state.data.id); safeSession.set(DISMISSED_KEY, state.dismissedId); }
    ensure().hidden = true;
  }
  function open() {
    state.open = true;
    if (state.data?.id && state.dismissedId === String(state.data.id)) { state.dismissedId = ''; safeSession.set(DISMISSED_KEY, ''); }
    render();
    send({ type: 'olympics:sync' });
  }
  function playerCard(player, active = false) {
    return `<article class="oly-player${active ? ' is-active' : ''}${player.eliminated ? ' is-eliminated' : ''}${player.connected === false ? ' is-disconnected' : ''}">
      ${avatar(player)}<span><b>${esc(player.name)}</b><small>${player.eliminated ? 'ELIMINATED' : player.connected === false ? 'DISCONNECTED' : `${Number(player.supporters) || 0} SUPPORTERS`}</small></span>
      ${state.championId === player.id ? '<i title="Olympic Champion">🏆</i>' : ''}</article>`;
  }
  function bracket() {
    if (!state.data?.rounds?.length) return '';
    return `<section class="oly-bracket"><header><b>TOURNAMENT BRACKET</b><span>HORIZONTAL ARCHIVE</span></header><div class="oly-bracket-scroll">${state.data.rounds.map(round => `<div class="oly-round"><h3>${esc(round.label)}</h3>${round.matches.map(match => {
      const a = person(match.playerAId), b = person(match.playerBId);
      return `<div class="oly-bracket-match${state.data.currentMatch?.id === match.id ? ' is-current' : ''}">
        <span class="${match.winnerId === a.id ? 'is-winner' : ''}">${esc(a.name)} <b>${Number(match.score?.[a.id]) || 0}</b></span>
        <i>${match.status === 'bye' ? 'BYE' : 'VS'}</i>
        <span class="${match.winnerId === b.id ? 'is-winner' : ''}">${esc(b.name)} <b>${b.id ? Number(match.score?.[b.id]) || 0 : '—'}</b></span>
      </div>`;
    }).join('')}</div>`).join('')}<div class="oly-round oly-champion-slot"><h3>CHAMPION</h3><div>${state.data.championId ? playerCard(person(state.data.championId)) : '<span>AWAITING ASCENSION</span>'}</div></div></div></section>`;
  }
  function lobby() {
    const joined = state.data.joined, count = Number(state.data.olympians) || 0;
    return `<div class="oly-intro"><span class="oly-sigil">🪨 📜 ✂️</span><h1>THE OLYMPICS HAVE BEGUN.</h1><p>Intellect has failed you. Resort to your hands.</p></div>
      <section class="oly-lobby"><header><b>OLYMPIANS: ${count}</b><span>MINIMUM 2</span></header><div class="oly-roster">${state.data.participants.map(player => playerCard(player)).join('') || '<p>THE ARENA AWAITS ITS FIRST VICTIM.</p>'}</div>
      <div class="oly-actions">${isGm()
        ? `${joined ? '<button data-oly="leave">WITHDRAW SHADOW BROKER</button>' : '<button class="is-primary" data-oly="join">ENTER AS SHADOW BROKER</button>'}<button data-oly-gm="begin" ${count < 2 ? 'disabled' : ''}>BEGIN OLYMPICS</button><button class="is-danger" data-oly-gm="cancel">CANCEL</button>`
        : joined ? '<button data-oly="leave">WITHDRAW</button>' : '<button class="is-primary" data-oly="join">ENTER THE OLYMPICS</button>'}</div></section>`;
  }
  function choiceButton(choice, match, waiting = false) {
    const [symbol, label] = HANDS[choice], mine = match.yourChoice === choice;
    return `<button class="oly-hand${mine ? ' is-locked' : ''}" data-oly-choice="${choice}" ${match.yourChoice || state.data.paused || waiting ? 'disabled' : ''}><b>${symbol}</b><span>${label}</span></button>`;
  }
  function supportButton(player) {
    const selected = state.data.support === player.id;
    return `<button class="oly-support${selected ? ' is-selected' : ''}" data-oly-support="${esc(player.id)}">🔥 ${selected ? 'SUPPORTED' : 'SUPPORT'} <b>${Number(player.supporters) || 0}</b></button>`;
  }
  function arena() {
    const match = state.data.currentMatch;
    if (!match) return '<div class="oly-wait">THE BRACKET IS TURNING.</div>' + bracket();
    const a = person(match.playerAId), b = person(match.playerBId), viewer = me();
    const competitor = [a.id, b.id].includes(viewer) && !state.data.spectator;
    const waitingForThrow = Number(match.selectionOpensAt) > Date.now();
    const reveal = match.reveal;
    const revealKey = reveal ? `${match.id}:${reveal.throwSeq}` : '';
    if (revealKey && revealKey !== state.lastReveal) { state.lastReveal = revealKey; setTimeout(() => ensure().querySelector('.oly-duel')?.classList.add('is-impact'), 30); }
    const hand = player => reveal ? HANDS[reveal.choices?.[player.id]] : null;
    const score = `${Number(match.score?.[a.id]) || 0} : ${Number(match.score?.[b.id]) || 0}`;
    const status = state.data.paused ? `PAUSED // ${String(state.data.pauseReason || '').toUpperCase()}`
      : reveal ? (reveal.result === 'STALEMATE' ? 'STALEMATE // THROW AGAIN' : reveal.result === 'TIMEOUT' ? 'TIME CLAIMED' : reveal.result)
        : waitingForThrow ? 'PREPARE TO THROW'
        : match.yourChoice ? 'HAND LOCKED' : competitor ? 'CHOOSE YOUR HAND' : 'WITNESS THE THROW';
    const final = match.requiredWins === 4;
    return `<div class="oly-arena${final ? ' is-final' : ''}">${final ? '<div class="oly-final-title">THE GRAND FINAL</div>' : ''}
      <div class="oly-duel" data-result="${esc(reveal?.action || reveal?.result || '')}">
        <div class="oly-combatant">${avatar(a, true)}<h2>${esc(a.name)}</h2>${hand(a) ? `<strong class="oly-reveal-hand">${hand(a)[0]}<small>${hand(a)[1]}</small></strong>` : `<span class="oly-lock">${match.locked?.[a.id] ? 'LOCKED IN' : 'CHOOSING'}</span>`}${a.id !== viewer && !a.eliminated ? supportButton(a) : ''}</div>
        <div class="oly-versus"><small>FIRST TO ${match.requiredWins}</small><b>${score}</b><i>VS</i><span class="oly-countdown" data-oly-deadline="${Number(match.deadline) || 0}" data-oly-opens="${Number(match.selectionOpensAt) || 0}">${match.deadline ? '3' : '—'}</span></div>
        <div class="oly-combatant">${avatar(b, true)}<h2>${esc(b.name)}</h2>${hand(b) ? `<strong class="oly-reveal-hand">${hand(b)[0]}<small>${hand(b)[1]}</small></strong>` : `<span class="oly-lock">${match.locked?.[b.id] ? 'LOCKED IN' : 'CHOOSING'}</span>`}${b.id !== viewer && !b.eliminated ? supportButton(b) : ''}</div>
      </div><div class="oly-status">${esc(status)}</div>
      ${competitor && match.phase === 'selecting' ? `<div class="oly-hands">${Object.keys(HANDS).map(choice => choiceButton(choice, match, waitingForThrow)).join('')}</div>` : ''}
      ${isGm() ? gmControls(match) : ''}${bracket()}</div>`;
  }
  function gmControls(match) {
    return `<section class="oly-gm-controls"><b>SHADOW BROKER CONTROLS</b>
      <button data-oly-gm="${state.data.paused ? 'resume' : 'pause'}">${state.data.paused ? 'RESUME' : 'PAUSE TOURNAMENT'}</button>
      <button data-oly-gm="restartThrow">RESTART THROW</button><button data-oly-gm="restartMatch">RESTART MATCH</button>
      <button data-oly-forfeit="${esc(match.playerAId)}">FORFEIT ${esc(person(match.playerAId).name)}</button><button data-oly-forfeit="${esc(match.playerBId)}">FORFEIT ${esc(person(match.playerBId).name)}</button>
      <button class="is-danger" data-oly-gm="cancel">CANCEL OLYMPICS</button></section>`;
  }
  function complete() {
    const champion = person(state.data.championId), runner = person(state.data.runnerUpId), usage = state.data.stats?.usage || {};
    const total = Math.max(1, Number(usage.rock || 0) + Number(usage.paper || 0) + Number(usage.scissors || 0));
    const totals = state.data.participants.reduce((sum, player) => {
      sum.won += Number(player.stats?.throwsWon) || 0; sum.lost += Number(player.stats?.throwsLost) || 0; return sum;
    }, { won: 0, lost: 0 });
    const favored = Object.keys(HANDS).sort((a, b) => Number(usage[b] || 0) - Number(usage[a] || 0))[0];
    return `<div class="oly-champion"><small>OLYMPICS COMPLETE</small><h1>OLYMPIC CHAMPION</h1>${avatar(champion, true)}<h2>${esc(champion.name)}</h2><strong>LORD OF THE THREE HANDS</strong></div>
      <section class="oly-stats"><div><span>CHAMPION</span><b>${esc(champion.name)}</b></div><div><span>RUNNER-UP</span><b>${esc(runner.name)}</b></div><div><span>MATCHES PLAYED</span><b>${Number(state.data.stats?.matchesPlayed) || 0}</b></div><div><span>THROWS WON</span><b>${totals.won}</b></div><div><span>THROWS LOST</span><b>${totals.lost}</b></div><div><span>TIES</span><b>${Number(state.data.stats?.ties) || 0}</b></div><div><span>ROCK USAGE</span><b>${Number(usage.rock) || 0}</b></div><div><span>PAPER USAGE</span><b>${Number(usage.paper) || 0}</b></div><div><span>SCISSORS USAGE</span><b>${Number(usage.scissors) || 0}</b></div><div><span>FAVORED WEAPON</span><b>${HANDS[favored][1]} — ${Math.round(Number(usage[favored] || 0) / total * 100)}%</b></div></section>
      ${bracket()}${isGm() ? '<div class="oly-actions"><button data-oly-gm="create">DECLARE NEW OLYMPICS</button><button data-oly-gm="cancel">DISMISS</button></div>' : ''}`;
  }
  function render() {
    const root = ensure(); root.hidden = !state.open; if (!state.open) return;
    const body = !state.data ? '<div class="oly-wait">THE ARENA SLEEPS.</div>' : state.data.status === 'lobby' ? lobby() : state.data.status === 'complete' ? complete() : arena();
    root.innerHTML = `<div class="oly-shell"><header><div><b>ROCK <i>•</i> PAPER <i>•</i> SCISSORS OLYMPICS</b><small>ANCIENT RITUAL // MECHANICAL AUTHORITY</small></div><button data-oly-close aria-label="Close">×</button></header>${state.error ? `<div class="oly-error">${esc(state.error)}</div>` : ''}<main>${body}</main></div>`;
    tickClock();
  }
  function tickClock() {
    const node = ensure().querySelector('[data-oly-deadline]'); if (!node) return;
    const deadline = Number(node.dataset.olyDeadline), opens = Number(node.dataset.olyOpens); if (!deadline) return;
    const current = Date.now(), before = opens - current;
    if (before > 0) {
      node.textContent = String(Math.max(1, Math.ceil(before / 1000)));
      return;
    }
    if (node.dataset.thrown !== '1') {
      node.dataset.thrown = '1'; node.textContent = 'THROW';
      ensure().querySelectorAll('[data-oly-choice]').forEach(button => { if (!state.data?.paused && !state.data?.currentMatch?.yourChoice) button.disabled = false; });
      const label = ensure().querySelector('.oly-status'); if (label) label.textContent = 'CHOOSE YOUR HAND';
      setTimeout(tickClock, 350); return;
    }
    const left = Math.max(0, deadline - current); node.textContent = (left / 1000).toFixed(1);
  }
  function confirmAction(action, name = '') {
    const prompts = { restartThrow: 'RESTART THIS THROW?', restartMatch: 'RESTART THIS MATCH?', cancel: 'CANCEL THE ENTIRE OLYMPICS?', forfeit: `FORFEIT ${name || 'THIS PLAYER'}?` };
    return !prompts[action] || window.confirm(prompts[action]);
  }
  function onClick(event) {
    if (event.target.closest('[data-oly-close]')) return close();
    if (event.target === ensure()) return close();
    const choice = event.target.closest('[data-oly-choice]')?.dataset.olyChoice;
    if (choice) { const match = state.data?.currentMatch; if (match) send({ type: 'olympics:select', matchId: match.id, throwSeq: match.throwSeq, choice }); return; }
    const support = event.target.closest('[data-oly-support]')?.dataset.olySupport;
    if (support) return send({ type: 'olympics:support', playerId: support });
    const action = event.target.closest('[data-oly]')?.dataset.oly;
    if (action) return send({ type: `olympics:${action}` });
    const gmAction = event.target.closest('[data-oly-gm]')?.dataset.olyGm;
    if (gmAction) { if (!confirmAction(gmAction)) return; return send({ type: `gm:olympics:${gmAction}` }); }
    const forfeit = event.target.closest('[data-oly-forfeit]')?.dataset.olyForfeit;
    if (forfeit && confirmAction('forfeit', person(forfeit).name)) send({ type: 'gm:olympics:forfeit', playerId: forfeit });
  }
  function updateCards() {
    const label = !state.data ? 'AWAITING' : state.data.status === 'lobby' ? `LOBBY ${state.data.olympians}` : state.data.status === 'complete' ? 'COMPLETE' : 'LIVE';
    document.querySelectorAll('[data-olympics-status]').forEach(node => { node.textContent = label; });
  }
  function onMessage(message) {
    if (message.type === 'olympics:error') { state.error = String(message.message || 'COMMAND REJECTED'); if (state.open) render(); return; }
    if (message.type !== 'olympics:state') return;
    const hadTournament = !!state.data;
    state.data = message.state || null; state.championId = message.championId || state.data?.championId || null; state.error = ''; updateCards();
    if (hadTournament && !state.data) { state.invitedId = ''; state.dismissedId = ''; safeSession.set(INVITED_KEY, ''); safeSession.set(DISMISSED_KEY, ''); return close(); }
    const tournamentId = String(state.data?.id || '');
    const dismissed = tournamentId && state.dismissedId === tournamentId;
    if (!isGm() && state.data?.status === 'lobby' && !state.data.joined && state.invitedId !== tournamentId && !dismissed) {
      state.invitedId = tournamentId; safeSession.set(INVITED_KEY, tournamentId); state.open = true;
    }
    if (!dismissed && state.data?.joined && ['running', 'complete'].includes(state.data.status)) state.open = true;
    if (state.open) render();
  }
  document.addEventListener('click', event => {
    const launcher = event.target.closest('[data-open-olympics]');
    if (launcher) {
      event.preventDefault();
      document.getElementById('casual-minigames-menu')?.setAttribute('hidden', '');
      document.getElementById('casual-minigames-toggle')?.setAttribute('aria-expanded', 'false');
      if (isGm() && !state.data) send({ type: 'gm:olympics:create' });
      return open();
    }
    if (!ensure().hidden) onClick(event);
  });
  setInterval(tickClock, 100);
  window.OlympicsUI = { onMessage, open, close, state };
})();
