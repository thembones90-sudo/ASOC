'use strict';
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const remaining = (deadline, now = Date.now()) => Math.max(0, Math.ceil((Number(deadline || 0) - now) / 1000));
  const send = payload => { const app = window.App || window.PlayerApp; return app?.send ? app.send(payload) !== false : false; };
  const drafts = new Map(), roots = new Set();
  let draftTimer;
  const narration = { WRITING: 'THE GATES ARE SEALED. WRITE ONE SENTENCE WORTH YOUR NAME.', REVEAL: 'THE IRON FALLS. READ THEIR WORDS BEFORE YOU PASS SENTENCE.', VOTING: 'THE CROWD HOLDS THE BLADE. CAST YOUR JUDGMENT.', RESULT: 'THE PIT HAS SPOKEN.', CANCELLED: 'THE SHADOW BROKER HAS CLOSED THE GATES.' };
  function render(state, root, { gm = false, live } = {}) {
    if (!root) return;
    roots.add(root); root._mudState = state;
    if (!state?.active) { delete root._mudVisibleDuel; root.hidden = true; root.replaceChildren(); return; }
    const finished = ['RESULT', 'CANCELLED'].includes(state.phase);
    // A completed duel received on login is history, not a fresh verdict.
    // Only a duel displayed while active may automatically show its ending.
    if (!finished) root._mudVisibleDuel = state.id;
    if (finished && (live === false || root._mudVisibleDuel !== state.id)) { delete root._mudVisibleDuel; root.hidden = true; root.replaceChildren(); return; }
    if (root.dataset.dismissed === state.id) { root.hidden = true; return; }
    root.hidden = false;
    const oldInput = root.querySelector('textarea'), focused = document.activeElement === oldInput;
    const selection = oldInput ? [oldInput.selectionStart, oldInput.selectionEnd] : null;
    const c = state.contestants || [], entries = state.entries || [];
    const cards = c.map((x, i) => `<article class="mudpits-card ${i ? 'mudpits-card--right' : ''}"><div class="mudpits-kicker">GLADIATOR ${i + 1}</div><h3>${esc(x.name)}</h3><div class="mudpits-status">${state.revealed ? 'UNSEALED' : x.submitted ? 'SEALED IN IRON' : 'WRITING IN THE DARK'}</div>${state.revealed ? `<p class="mudpits-entry">${esc(entries[i]?.text || 'NO VALID SENTENCE // VOID')}</p>` : ''}${state.counts ? `<strong class="mudpits-count">${state.counts[x.id] || 0} VOTES</strong>` : ''}${state.viewer?.canVote && entries[i]?.text ? `<button class="mudpits-vote" data-mudpits-vote="${esc(x.id)}">JUDGE THIS SENTENCE</button>` : ''}</article>`).join('<div class="mudpits-vs" aria-label="versus">VS</div>');
    const verdict = state.phase === 'RESULT' ? state.winnerId ? `${esc(state.names[state.winnerId])} CLAIMS THE PIT${state.awarded ? ' // +1 SC' : ' // REWARD PENDING'}` : 'VOID // NO VICTOR. NO REWARD.' : narration[state.phase];
    root.innerHTML = `<section class="mudpits-shell" data-mudpits-id="${esc(state.id)}"><header class="mudpits-head"><div><div class="mudpits-kicker">SHADOW BROKER // IRON & BLOOD</div><h2>THE MUD PITS</h2><small>${esc(state.phase)}</small></div><div class="mudpits-timer" data-mudpits-clock></div></header><div class="mudpits-duel">${cards}</div>${state.viewer?.canSubmit ? '<form data-mudpits-form><label>YOUR SENTENCE // 250 CHARACTERS MAXIMUM<textarea class="mudpits-write" maxlength="250" required placeholder="One sentence. Make it count."></textarea></label><button class="mudpits-submit">SEAL MY SENTENCE</button></form>' : ''}<p class="mudpits-notice" role="status">${state.viewer?.hasVoted ? 'YOUR JUDGMENT IS SEALED.' : ''}</p><div class="mudpits-judgment">${verdict}</div><footer>${state.viewer?.canCancel && gm ? '<button data-mudpits-cancel>CLOSE THE PIT // CANCEL</button>' : ''}${finished ? '<button data-mudpits-dismiss>DISMISS VERDICT</button>' : ''}</footer></section>`;
    const input = root.querySelector('textarea');
    if (input) {
      input.value = drafts.get(state.id) ?? state.viewer?.myDraft ?? '';
      if (focused) { input.focus(); input.setSelectionRange(...selection); }
      input.addEventListener('input', () => {
        drafts.set(state.id, input.value); clearTimeout(draftTimer);
        draftTimer = setTimeout(() => send({ type: 'mudpits:draft', duelId: state.id, text: input.value }), 400);
      });
    }
    root.querySelector('form')?.addEventListener('submit', ev => {
      ev.preventDefault(); clearTimeout(draftTimer);
      if (send({ type: 'mudpits:submit', duelId: state.id, text: input.value })) ev.currentTarget.querySelector('button').disabled = true;
    });
    root.querySelectorAll('[data-mudpits-vote]').forEach(button => button.addEventListener('click', () => {
      if (send({ type: 'mudpits:vote', duelId: state.id, contestantId: button.dataset.mudpitsVote })) root.querySelectorAll('[data-mudpits-vote]').forEach(b => { b.disabled = true; });
    }));
    root.querySelector('[data-mudpits-cancel]')?.addEventListener('click', () => send({ type: 'mudpits:cancel', duelId: state.id }));
    root.querySelector('[data-mudpits-dismiss]')?.addEventListener('click', () => { root.dataset.dismissed = state.id; root.hidden = true; drafts.delete(state.id); });
    root._mudOffset = Date.now() - Number(state.serverNow || Date.now()); clock(root);
  }
  function clock(root) {
    const s = root._mudState, node = root.querySelector('[data-mudpits-clock]');
    if (!s || !node) return;
    const deadline = s.phase === 'WRITING' ? s.writeDeadline : s.phase === 'REVEAL' ? s.readDeadline : s.voteDeadline;
    const seconds = remaining(deadline, Date.now() - (root._mudOffset || 0));
    node.textContent = ['RESULT', 'CANCELLED'].includes(s.phase) ? 'SEALED' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  setInterval(() => { for (const root of roots) root.isConnected ? clock(root) : roots.delete(root); }, 250);
  function onMessage(message) {
    if (message?.type !== 'mudpits:error') return;
    for (const root of roots) {
      const note = root.querySelector('.mudpits-notice'); if (note) note.textContent = message.error || 'THE PIT REFUSED YOUR REQUEST';
      root.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }
  window.MudPitsUI = { render, remaining, onMessage };
})();
