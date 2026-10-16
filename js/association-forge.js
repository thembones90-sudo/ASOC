/* GM-only authoring research. Nothing writes to the board until ASSIGN is pressed. */
window.AssociationForge = (() => {
  const sessions = new WeakMap();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(root, forge) {
    if (!root || !forge.editingGame) return;
    const draft = forge.editingGame;
    let state = sessions.get(draft);
    if (!state) { state = { query: draft.finalSolution || '', queryMode: 'associated', sourceMode: '', source: '', custom: false, items: [], selected: [], sourceWord: '', error: '', busy: false, pos: 'all', mode: 'all', search: '', sort: 'strength' }; sessions.set(draft, state); }
    root.innerHTML = `<details class="association-forge"><summary>ASSOCIATION FORGE <small>RESEARCH // GM CONTROLLED</small></summary>
      <div class="association-body">
        <p>Find column-solution candidates. Nothing changes on your board until you explicitly assign a word.</p>
        <div class="association-query"><label>RESEARCH WORD<input class="forge-input" data-association-word maxlength="60" autocomplete="off" value="${esc(state.query)}"></label><label>QUERY MODE<select class="forge-select" data-association-query-mode><option value="associated">ASSOCIATED</option><option value="means_like">MEANS LIKE</option></select></label><button type="button" class="forge-btn primary" data-association-fetch>FETCH ASSOCIATIONS</button><button type="button" class="forge-btn ghost" data-association-final>USE FINAL</button></div>
        <p data-association-source></p><div data-association-status role="status" aria-live="polite"></div>
        <div class="association-filters">
          <label>SEARCH<input class="forge-input" data-association-search type="search" value="${esc(state.search)}"></label>
          <label>PART OF SPEECH<select class="forge-select" data-association-pos>${['all','noun','verb','adjective','adverb'].map(p=>`<option value="${p}">${p.toUpperCase()}</option>`).join('')}</select></label>
          <label>SORT<select class="forge-select" data-association-sort><option value="strength">STRONGEST FIRST</option><option value="alpha">A–Z</option></select></label>
          <label>LOCAL RESEARCH AID<select class="forge-select" data-association-mode><option value="all">ALL</option><option value="red">RED</option><option value="purple">PURPLE</option></select></label>
        </div>
        <p class="association-note">RED hides simple word-family variants. PURPLE also puts multiple-POS candidates first within the selected sort. Multiple parts of speech do not prove multiple meanings. These aids do not detect synonyms, technical domains or puzzle difficulty. Scores rank results within this query; they are not percentages or comparable between modes.</p>
        <div class="association-results" data-association-results></div>
        <div class="association-selected"><h5 data-association-count>SELECTED CANDIDATES 0/4</h5><div data-association-selected></div></div>
      </div></details>`;
    const query = root.querySelector('[data-association-word]');
    const fetchButton = root.querySelector('[data-association-fetch]');
    const status = root.querySelector('[data-association-status]');
    const results = root.querySelector('[data-association-results]');
    const selected = root.querySelector('[data-association-selected]');
    const sameFamily = word => {
      const base = state.sourceWord.toLowerCase(), candidate = word.toLowerCase();
      return [base, base+'s', base+'es', base+'d', base+'ed', base+'ing', base.replace(/e$/, '')+'ing'].includes(candidate);
    };
    function render() {
      if (!root.isConnected) return;
      fetchButton.disabled = state.busy;
      root.querySelector('[data-association-query-mode]').disabled = state.busy;
      fetchButton.textContent = state.busy ? 'FETCHING…' : 'FETCH ASSOCIATIONS';
      root.querySelector('.association-body').setAttribute('aria-busy', String(state.busy));
      status.textContent = state.error || (state.busy ? 'Fetching associations. Your current results and board are preserved.' : state.sourceWord ? `${state.items.length} single-word results${state.cached ? ' // CACHED' : ''}` : 'Enter a final word and fetch explicitly.');
      status.classList.toggle('association-error', !!state.error);
      root.querySelector('[data-association-source]').textContent = `BOARD FINAL: ${draft.finalSolution || 'NOT SET'}${state.sourceWord ? ` // RESULTS FOR: ${state.sourceWord} // ${state.source} // ${state.sourceMode === 'means_like' ? 'MEANS LIKE' : 'ASSOCIATED'}` : ''}`;
      let visible = state.items.filter(item => (state.pos === 'all' || item.partsOfSpeech.includes(state.pos)) && item.word.toLowerCase().includes(state.search.toLowerCase()));
      if (state.mode !== 'all') visible = visible.filter(item => !sameFamily(item.word));
      visible.sort((a,b) => (state.mode === 'purple' ? Number(b.partsOfSpeech.length > 1) - Number(a.partsOfSpeech.length > 1) : 0) || (state.sort === 'alpha' ? a.word.localeCompare(b.word) : (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.word.localeCompare(b.word)));
      results.innerHTML = visible.map(item => `<button type="button" class="association-chip" data-association-pick="${esc(item.word)}" aria-pressed="${state.selected.includes(item.word)}"><b>${esc(item.word)}</b><span>${esc(item.partsOfSpeech.join(' / ') || 'POS not supplied')} · ${item.score == null ? 'score not supplied' : `score ${item.score}`}</span>${item.partsOfSpeech.length > 1 ? '<small>MULTIPLE POS</small>' : ''}</button>`).join('') || `<p>${state.sourceWord ? `No matching associations for ${esc(state.sourceWord)}.` : 'Your research results will appear here.'}</p>`;
      root.querySelector('[data-association-count]').textContent = `SELECTED CANDIDATES ${state.selected.length}/4`;
      selected.innerHTML = state.selected.map(word => `<div class="association-candidate"><b>${esc(word)}</b><div aria-label="Assign ${esc(word)} to a column">${['A','B','C','D'].map(col => `<button type="button" class="forge-btn ghost" data-association-assign="${col}" data-word="${esc(word)}">${col}5</button>`).join('')}<button type="button" class="forge-btn ghost" data-association-remove="${esc(word)}" aria-label="Remove ${esc(word)}">×</button></div></div>`).join('');
    }
    async function fetchWords() {
      if (state.busy) return;
      const word = query.value.trim();
      const queryMode = state.queryMode;
      if (!/^[a-z]+(?:['-][a-z]+)*$/i.test(word) || word.length > 60) { state.error = 'Enter one English word (maximum 60 characters).'; render(); return; }
      state.busy = true; state.error = ''; render();
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
      try {
        const data = await GameData.apiFetch(`api/associations?word=${encodeURIComponent(word)}&mode=${encodeURIComponent(queryMode)}`, { signal: controller.signal });
        if (!Array.isArray(data.items) || typeof data.word !== 'string') throw Error('Association service returned an invalid response.');
        state.items = data.items; state.sourceWord = data.word; state.sourceMode = data.mode; state.source = data.source || 'Association provider'; state.cached = data.cached; state.selected = [];
      } catch (error) { state.error = error.name === 'AbortError' ? 'Association service timed out. Your previous results are retained.' : error.message || 'Association service temporarily unavailable.'; }
      finally { clearTimeout(timer); state.busy = false; state.repaint?.(); }
    }
    root.querySelector('details').addEventListener('toggle', () => {
      if (!state.custom) { query.value = state.query = draft.finalSolution || ''; }
      render();
    });
    forge.fieldInput('finalSolution')?.addEventListener('input', () => {
      // Forge's delegated input handler updates the draft later in this event.
      setTimeout(() => {
        if (!state.custom) query.value = state.query = draft.finalSolution || '';
        render();
      }, 0);
    });
    query.addEventListener('input', () => { state.query = query.value; state.custom = true; });
    query.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); fetchWords(); } });
    root.querySelector('[data-association-final]').addEventListener('click', () => { state.custom = false; query.value = state.query = draft.finalSolution || ''; render(); });
    fetchButton.addEventListener('click', fetchWords);
    const modeControl = root.querySelector('[data-association-query-mode]');
    modeControl.value = state.queryMode;
    modeControl.addEventListener('change', () => { state.queryMode = modeControl.value; });
    for (const name of ['pos','sort','mode','search']) {
      const control = root.querySelector(`[data-association-${name}]`); control.value = state[name];
      control.addEventListener(name === 'search' ? 'input' : 'change', () => { state[name] = control.value; render(); });
    }
    root.addEventListener('click', async event => {
      const pick = event.target.closest('[data-association-pick]');
      const remove = event.target.closest('[data-association-remove]');
      if (pick || remove) {
        const word = pick?.dataset.associationPick || remove.dataset.associationRemove;
        if (state.selected.includes(word)) state.selected = state.selected.filter(w => w !== word);
        else if (state.selected.length < 4) { state.selected.push(word); state.error = ''; }
        else state.error = 'Select at most four candidates. Remove one before adding another.';
        render(); return;
      }
      const assign = event.target.closest('[data-association-assign]');
      if (!assign || forge.editingGame !== draft) return;
      const col = assign.dataset.associationAssign, word = assign.dataset.word;
      if (!state.selected.includes(word) || !/^[A-D]$/.test(col)) return;
      if (forge._makerLocked?.has(col)) { state.error = `Column ${col} is locked. Unlock it in Automatic Game Maker before assigning.`; render(); return; }
      const slot = `${col}5`, old = forge.fieldValue(slot);
      if (old === word) return;
      if (old && !await AsocDialog.confirm({ title: `REPLACE ${slot}?`, message: `${slot} already contains: ${old}\nReplace ${old} with ${word}? Existing clues will be kept for your review.`, confirmLabel: 'REPLACE' })) return;
      // A modal may outlive this draft or another edit. Never apply a stale decision.
      if (forge.editingGame !== draft || !root.isConnected || !state.selected.includes(word) || forge.fieldValue(slot) !== old || forge._makerLocked?.has(col)) return;
      forge.setCreatorField(slot, word);
      state.error = ''; render(); status.textContent = `${word} assigned to ${slot}. Existing clues preserved; review their fit.`;
    });
    state.repaint = render;
    render();
  }
  return { mount };
})();
