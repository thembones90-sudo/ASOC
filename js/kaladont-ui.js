// KALADONT presentation, shared by the Little Hero panel (js/kaladont-client.js)
// and the Shadow Broker arcade (js/gm-minigames.js). Pure rendering of the
// server's per-viewer projection (kaladont.js view()); every decision --
// order, timers, prefixes, votes, eliminations, winner -- is the server's.
// Buttons carry data-kaladont-action; the host page decides what to send.
(() => {
  'use strict';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const REASON_TEXT = {
    'TURN TIMEOUT': 'ran out of time',
    'INVALID PREFIX': 'broke the chain',
    'DUPLICATE WORD': 'repeated a word',
    'INVALID WORD': 'submitted an invalid word',
    'WORD REJECTED': 'was rejected by the tribunal',
    'KALADONT KILL': 'was killed by KALADONT'
  };

  // Clock skew: deadlines are absolute server times.
  function skewOf(state) {
    return state && Number.isFinite(Number(state.serverNow)) ? Number(state.serverNow) - Date.now() : 0;
  }

  function clock(deadline, skew, total) {
    return `<span class="kal-clock" data-kal-deadline="${Number(deadline) || 0}" data-kal-skew="${skew}" data-kal-total="${total}"></span>`;
  }

  function orderStrip(state) {
    const current = state.turn?.playerId;
    return `<ol class="kal-order" aria-label="Turn order">${state.order.map(p => `
      <li class="kal-chip${p.alive ? '' : ' is-out'}${p.id === current && state.phase !== 'ended' ? ' is-current' : ''}${p.online === false ? ' is-offline' : ''}" title="${p.alive ? (p.online === false ? 'DISCONNECTED' : 'ALIVE') : esc(p.reason)}">
        <span>${esc(p.name)}</span>${p.alive ? '' : `<small>${esc(p.reason || 'OUT')}</small>`}
      </li>`).join('')}</ol>`;
  }

  function history(state) {
    if (!state.history.length) return '<div class="kal-history is-empty">NO ACCEPTED WORDS YET</div>';
    const words = state.history.slice(-8).map(h => `<span title="${esc(h.byName)}">${esc(h.word)}</span>`).join('<i>›</i>');
    return `<div class="kal-history" aria-label="Accepted words">${state.history.length > 8 ? '<em>…</em>' : ''}${words}</div>`;
  }

  function prefixBlock(prefix) {
    return prefix
      ? `<div class="kal-prefix"><small>REQUIRED PREFIX</small><b>${esc(prefix)}</b></div>`
      : '<div class="kal-prefix is-open"><small>OPENING WORD</small><b>ANY</b></div>';
  }

  function lobby(state, opts) {
    const you = state.you || {};
    const online = state.members.filter(m => m.online !== false).length;
    const rows = state.members.map(m => `
      <li class="kal-member${m.online === false ? ' is-offline' : ''}">
        <span class="kal-dot" aria-hidden="true"></span><b>${esc(m.name)}</b>${m.id === state.ownerId ? '<small>CREATOR</small>' : ''}${m.online === false ? '<small>OFFLINE</small>' : ''}
      </li>`).join('');
    let actions = '';
    if (opts.spectator) actions = opts.canCancel ? '<button type="button" data-kaladont-action="gm-cancel" class="is-danger">END LOBBY</button>' : '';
    else if (you.owner) actions = `<button type="button" data-kaladont-action="start" ${online < 2 ? 'disabled' : ''}>START GAME</button><button type="button" data-kaladont-action="cancel" class="is-danger">CANCEL LOBBY</button>`;
    else if (you.member) actions = '<button type="button" data-kaladont-action="leave" class="is-danger">LEAVE</button>';
    else actions = '<button type="button" data-kaladont-action="join">JOIN</button>';
    return `
      <div class="kal-lobby">
        <div class="kal-kicker">LOBBY // ${esc(state.ownerName)}</div>
        <div class="kal-count"><b>${state.members.length}</b> JOINED${online !== state.members.length ? ` · ${online} ONLINE` : ''}</div>
        <ul class="kal-members">${rows}</ul>
        <p class="kal-rules">Turns are 60s. Each word must start with the last two letters of the last accepted word. Every living player votes on it: silence counts as ACCEPT, ties ACCEPT, a REJECT majority eliminates. <b>KALADONT</b> kills the next player. Last one standing wins.</p>
        <div class="kal-actions">${actions}</div>
        ${!opts.spectator && you.owner && online < 2 ? '<div class="kal-hint">WAITING FOR AT LEAST 2 ONLINE PLAYERS</div>' : ''}
      </div>`;
  }

  function turnView(state, opts) {
    const skew = skewOf(state);
    const mine = !opts.spectator && state.you?.alive && state.turn?.playerId === opts.viewerId;
    const input = mine
      ? `<form class="kal-submit" data-kaladont-form data-turn-seq="${state.turn.seq}">
           <input type="text" name="word" maxlength="32" autocomplete="off" spellcheck="false" autocapitalize="characters" placeholder="${state.prefix ? `${esc(state.prefix)}…` : 'ANY WORD'}" aria-label="Your word">
           <button type="submit">SUBMIT</button>
         </form>
         <div class="kal-hint">ONE SUBMISSION. IT CANNOT BE CHANGED.</div>`
      : `<div class="kal-waiting">${state.you?.alive ? 'WAITING FOR' : 'SPECTATING'} <b>${esc(state.turn.playerName)}</b></div>`;
    return `
      <div class="kal-stage">
        <div class="kal-current"><small>CURRENT PLAYER</small><b>${esc(state.turn.playerName)}</b>${mine ? '<em>YOUR TURN</em>' : ''}</div>
        ${prefixBlock(state.prefix)}
        <div class="kal-timer">${clock(state.turn.deadline, skew, 60)}</div>
        ${input}
      </div>`;
  }

  function tribunalView(state, opts) {
    const t = state.tribunal;
    const skew = skewOf(state);
    const canVote = !opts.spectator && state.you?.alive && !t.youVoted && !t.closed;
    return `
      <div class="kal-tribunal">
        <div class="kal-kicker">TRIBUNAL // ${esc(t.byName)} SUBMITS</div>
        <div class="kal-word">${esc(t.word)}</div>
        <div class="kal-tally"><b>${t.voted} / ${t.voters}</b> VOTED · ${clock(t.deadline, skew, 15)}</div>
        ${canVote
          ? `<div class="kal-vote" data-tribunal-seq="${t.seq}"><button type="button" data-kaladont-action="vote-accept" class="is-accept">ACCEPT</button><button type="button" data-kaladont-action="vote-reject" class="is-reject">REJECT</button></div>`
          : `<div class="kal-hint">${t.youVoted ? `YOU VOTED ${esc(t.youVoted.toUpperCase())} // VOTES STAY SECRET UNTIL THE VERDICT` : state.you?.alive ? '' : 'SPECTATORS DO NOT VOTE'}</div>`}
        <div class="kal-hint">SILENCE COUNTS AS ACCEPT · A TIE ACCEPTS</div>
      </div>`;
  }

  function verdictView(state) {
    const r = state.result;
    if (!r) return '';
    const title = r.kind === 'accepted' ? 'WORD ACCEPTED'
      : r.kind === 'rejected' ? 'WORD REJECTED'
      : r.kind === 'kaladont' ? 'KALADONT'
      : 'ELIMINATED';
    const line = r.kind === 'accepted' ? `${esc(r.playerName)} survives. Next prefix: <b>${esc(state.prefix)}</b>`
      : r.kind === 'kaladont' ? `${esc(r.playerName)} plays KALADONT${r.killedName ? ` and kills <b>${esc(r.killedName)}</b>` : ''}. The chain restarts.`
      : `${esc(r.playerName)} ${esc(REASON_TEXT[r.reason] || 'is out')}${r.word ? ` ("${esc(r.word)}")` : ''}.`;
    const votes = r.votes
      ? `<div class="kal-breakdown">
           <div class="is-accept"><b>ACCEPT ${r.votes.accept.length}</b>${r.votes.accept.map(v => `<span>${esc(v.name)}${v.defaulted ? ' <em>(silent)</em>' : ''}</span>`).join('')}</div>
           <div class="is-reject"><b>REJECT ${r.votes.reject.length}</b>${r.votes.reject.map(v => `<span>${esc(v.name)}</span>`).join('')}</div>
         </div>`
      : '';
    return `
      <div class="kal-verdict is-${esc(r.kind)}">
        ${r.word ? `<div class="kal-word is-small">${esc(r.word)}</div>` : ''}
        <div class="kal-verdict-title">${title}</div>
        <p>${line}</p>
        ${votes}
      </div>`;
  }

  function endedView(state, opts) {
    const standings = [...state.order].sort((a, b) => (a.place || 99) - (b.place || 99))
      .map(p => `<li><b>${p.place || '—'}</b><span>${esc(p.name)}</span><small>${p.place === 1 ? 'WINNER' : esc(p.reason || '')}</small></li>`).join('');
    return `
      <div class="kal-ended">
        <div class="kal-kicker">LAST LITTLE HERO STANDING</div>
        <div class="kal-winner">${esc(state.winnerName || 'NOBODY')}</div>
        <div class="kal-verdict-title">WINS KALADONT</div>
        <ol class="kal-standings">${standings}</ol>
        <div class="kal-actions">${opts.spectator ? '' : '<button type="button" data-kaladont-action="new">NEW LOBBY</button>'}<button type="button" data-kaladont-action="close">CLOSE</button></div>
      </div>`;
  }

  // opts: { viewerId, spectator, canCancel }
  function render(state, opts = {}) {
    if (!state) {
      return `
        <div class="kal-empty">
          <p>No KALADONT game is open.</p>
          ${opts.spectator ? '' : '<div class="kal-actions"><button type="button" data-kaladont-action="create">CREATE LOBBY</button></div>'}
        </div>`;
    }
    if (state.phase === 'lobby') return lobby(state, opts);
    const body = state.phase === 'turn' ? turnView(state, opts)
      : state.phase === 'tribunal' ? tribunalView(state, opts)
      : state.phase === 'verdict' ? verdictView(state)
      : endedView(state, opts);
    const gmEnd = opts.spectator && opts.canCancel && state.phase !== 'ended'
      ? '<div class="kal-actions"><button type="button" data-kaladont-action="gm-cancel" class="is-danger">END GAME</button></div>' : '';
    return `<div class="kal-game is-${esc(state.phase)}">${orderStrip(state)}${body}${state.phase === 'ended' ? '' : history(state)}${gmEnd}</div>`;
  }

  // Repaints every countdown in `root` once; hosts call it on an interval.
  function tickClocks(root) {
    root?.querySelectorAll?.('[data-kal-deadline]').forEach(el => {
      const deadline = Number(el.dataset.kalDeadline) - Number(el.dataset.kalSkew || 0);
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      el.textContent = `${left}s`;
      el.classList.toggle('is-urgent', left <= 10);
    });
  }

  const KaladontUI = { render, tickClocks, esc };
  if (typeof window !== 'undefined') window.KaladontUI = KaladontUI;
  if (typeof module !== 'undefined' && module.exports) module.exports = KaladontUI;
})();
