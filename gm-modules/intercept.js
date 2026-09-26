// INTERCEPT -- the Shadow Broker's private view of Little Hero direct
// messages. Served only to an authenticated GM session (never public), opened
// by typing /intercept in the Shadow Broker composer. Read-only: opening a
// conversation marks nothing read and notifies nobody.
(function () {
  const App = window.App;
  if (!App) return;
  const state = { tab: 'conversations', data: null, thread: null, report: null, filter: '' };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = t => { const d = new Date(Number(t) || 0); return isNaN(d) ? '' : d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };

  const style = document.createElement('style');
  style.textContent = `
  .icp-overlay{position:fixed;inset:0;z-index:9500;display:grid;place-items:center;padding:16px;background:rgba(3,2,5,.9);backdrop-filter:blur(3px);font-family:var(--font-machine,ui-monospace,monospace);color:#ddd6e6}
  .icp-overlay[hidden]{display:none}
  .icp-panel{width:min(1280px,100%);height:min(860px,100%);display:grid;grid-template-rows:auto auto 1fr;border:1px solid #4a1f2a;border-top:2px solid #c0202c;background:linear-gradient(180deg,#140b10,#07060a);box-shadow:0 30px 90px rgba(0,0,0,.85),0 0 40px rgba(192,32,44,.15)}
  .icp-head{display:flex;align-items:center;gap:16px;padding:16px 20px;border-bottom:1px solid #2c1a22}
  .icp-head h2{margin:0;font-size:22px;letter-spacing:.34em;color:#ff8a8f;text-shadow:0 0 14px rgba(192,32,44,.5)}
  .icp-head small{color:#8f7a86;font-size:11px;letter-spacing:.2em}
  .icp-head .icp-sp{flex:1}
  .icp-btn{font:inherit;cursor:pointer;padding:8px 14px;font-size:12px;letter-spacing:.14em;border:1px solid #5a3040;background:#1a0f15;color:#e6d6de}
  .icp-btn:hover{border-color:#ff5a64;color:#fff}
  .icp-tabs{display:flex;gap:4px;padding:10px 20px 0;border-bottom:1px solid #2c1a22}
  .icp-tab{font:inherit;cursor:pointer;padding:9px 16px;font-size:12px;letter-spacing:.16em;border:1px solid #3a2530;border-bottom:none;background:#120a0f;color:#a58f9b}
  .icp-tab.on{color:#fff;background:#2a1119;box-shadow:inset 0 2px 0 #ff5a64}
  .icp-tab b{margin-left:6px;color:#ff8a8f}
  .icp-body{display:grid;grid-template-columns:minmax(260px,380px) 1fr;min-height:0}
  .icp-list{overflow:auto;border-right:1px solid #2c1a22}
  .icp-filter{width:calc(100% - 24px);margin:12px;padding:9px 10px;font:inherit;font-size:13px;color:#fff;background:#0b070a;border:1px solid #3a2530}
  .icp-row{display:block;width:100%;text-align:left;font:inherit;cursor:pointer;padding:12px 14px;border:none;border-bottom:1px solid #22151b;background:none;color:inherit}
  .icp-row:hover,.icp-row.on{background:#1f1016}
  .icp-row strong{display:block;font-size:14px;color:#f3e6ec;letter-spacing:.04em}
  .icp-row span{display:block;margin-top:4px;font-size:12px;color:#a58f9b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .icp-row em{font-style:normal;float:right;font-size:11px;color:#7d6a74}
  .icp-thread{display:grid;grid-template-rows:auto 1fr;min-height:0}
  .icp-thread-head{padding:14px 18px;border-bottom:1px solid #2c1a22;font-size:14px;letter-spacing:.14em;color:#ffb3b7}
  .icp-thread-head small{display:block;margin-top:4px;color:#8f7a86;font-size:11px;letter-spacing:.12em}
  .icp-msgs{overflow:auto;padding:16px 18px;display:flex;flex-direction:column;gap:8px}
  .icp-msg{max-width:72%;padding:8px 12px;border:1px solid #33222b;background:#130c10;align-self:flex-start}
  .icp-msg.b{align-self:flex-end;border-color:#3b2a4a;background:#140f1c}
  .icp-msg header{font-size:11px;letter-spacing:.12em;color:#a58f9b;margin-bottom:4px}
  .icp-msg p{margin:0;font-size:14px;line-height:1.45;color:#f0e8ee;white-space:pre-wrap;overflow-wrap:anywhere}
  .icp-empty{padding:40px;text-align:center;color:#7d6a74;letter-spacing:.2em;font-size:12px}
  .icp-reason{margin:0 18px;padding:10px 12px;border:1px solid #6b2a33;background:#210c11;color:#ffb3b7;font-size:13px}
  @media (max-width:760px){.icp-body{grid-template-columns:1fr}.icp-list{max-height:38vh;border-right:none;border-bottom:1px solid #2c1a22}}
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'icp-overlay';
  root.hidden = true;
  document.body.appendChild(root);

  function open() {
    root.hidden = false;
    state.thread = null; state.report = null;
    App.send({ type: 'gm:dmOverview' });
    render();
  }
  function close() { root.hidden = true; }

  function nameList(members) { return members.map(m => esc(m.name)).join(' ↔ '); }

  function listHTML() {
    const d = state.data;
    if (!d) return '<div class="icp-empty">TAPPING THE LINES…</div>';
    const q = state.filter.trim().toLowerCase();
    if (state.tab === 'reports') {
      const rows = d.reports.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
      if (!rows.length) return '<div class="icp-empty">NO REPORTS FILED</div>';
      return rows.map(r => `<button type="button" class="icp-row${state.report?.id === r.id ? ' on' : ''}" data-report="${esc(r.id)}"><em>${esc(when(r.at))}</em><strong>${Object.values(r.names || {}).map(esc).join(' ↔ ')}</strong><span>BY ${esc(r.reporterName)}${r.reason ? ' // ' + esc(r.reason) : ''}</span></button>`).join('');
    }
    if (state.tab === 'blocks') {
      const names = {};
      d.conversations.forEach(c => c.members.forEach(m => { names[m.id] = m.name; }));
      if (!d.blocks.length) return '<div class="icp-empty">NO BLOCKS</div>';
      return d.blocks.map(b => `<div class="icp-row"><strong>${esc(names[b.id] || b.id)}</strong><span>BLOCKED: ${b.blocked.map(id => esc(names[id] || id)).join(', ')}</span></div>`).join('');
    }
    const rows = d.conversations.filter(c => !q || c.members.some(m => m.name.toLowerCase().includes(q)) || c.last.toLowerCase().includes(q));
    if (!rows.length) return '<div class="icp-empty">NO CONVERSATIONS</div>';
    return rows.map(c => `<button type="button" class="icp-row${state.thread?.id === c.id ? ' on' : ''}" data-convo="${esc(c.id)}"><em>${esc(when(c.lastAt))} · ${c.count}</em><strong>${nameList(c.members)}</strong><span>${esc(c.last)}</span></button>`).join('');
  }

  function threadHTML() {
    const t = state.report ? { ...state.report, messages: state.report.snapshot, members: state.report.members } : state.thread;
    if (!t) return '<div class="icp-empty">SELECT A LINE</div>';
    const names = t.names || {};
    const first = (t.members || [])[0];
    const title = (t.members || []).map(id => esc(names[id] || id)).join(' ↔ ');
    const sub = state.report
      ? `REPORT BY ${esc(state.report.reporterName)} // ${esc(when(state.report.at))} // SNAPSHOT OF ${t.messages.length}`
      : `${t.messages.length} MESSAGES // READ-ONLY // NOTHING IS MARKED READ`;
    const msgs = t.messages.length
      ? t.messages.map(m => `<article class="icp-msg${m.from === first ? '' : ' b'}"><header>${esc(names[m.from] || m.from)} · ${esc(when(m.at))}</header><p>${esc(m.text)}</p></article>`).join('')
      : '<div class="icp-empty">EMPTY</div>';
    return `<div class="icp-thread-head">${title}<small>${sub}</small></div>
      ${state.report?.reason ? `<p class="icp-reason">REASON: ${esc(state.report.reason)}</p>` : ''}
      <div class="icp-msgs">${msgs}</div>`;
  }

  function render() {
    const d = state.data;
    const tab = (id, label, n) => `<button type="button" class="icp-tab${state.tab === id ? ' on' : ''}" data-tab="${id}">${label}${n ? `<b>${n}</b>` : ''}</button>`;
    const focus = document.activeElement === root.querySelector('.icp-filter');
    root.innerHTML = `
      <section class="icp-panel" role="dialog" aria-label="Intercept">
        <header class="icp-head"><div><h2>INTERCEPT</h2><small>DIRECT CHANNELS // SHADOW BROKER EYES ONLY</small></div><span class="icp-sp"></span>
          <button type="button" class="icp-btn" data-refresh>REFRESH</button><button type="button" class="icp-btn" data-close>CLOSE</button></header>
        <nav class="icp-tabs">${tab('conversations', 'CONVERSATIONS', d?.conversations.length)}${tab('reports', 'REPORTS', d?.reports.length)}${tab('blocks', 'BLOCKS', d?.blocks.length)}</nav>
        <div class="icp-body">
          <div class="icp-list"><input class="icp-filter" type="search" placeholder="FILTER NAMES OR TEXT" value="${esc(state.filter)}">${listHTML()}</div>
          <div class="icp-thread">${threadHTML()}</div>
        </div>
      </section>`;
    const msgs = root.querySelector('.icp-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    if (focus) { const f = root.querySelector('.icp-filter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  }

  root.addEventListener('click', e => {
    if (e.target === root || e.target.closest('[data-close]')) return close();
    if (e.target.closest('[data-refresh]')) { App.send({ type: 'gm:dmOverview' }); if (state.thread) App.send({ type: 'gm:dmThread', conversationId: state.thread.id }); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; state.thread = null; state.report = null; return render(); }
    const convo = e.target.closest('[data-convo]');
    if (convo) { state.report = null; return App.send({ type: 'gm:dmThread', conversationId: convo.dataset.convo }); }
    const report = e.target.closest('[data-report]');
    if (report) { state.thread = null; return App.send({ type: 'gm:dmReport', reportId: report.dataset.report }); }
  });
  root.addEventListener('input', e => { if (e.target.classList.contains('icp-filter')) { state.filter = e.target.value; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !root.hidden) close(); });

  function onMessage(message) {
    if (message.type === 'gm:dmOverview') { state.data = message.data; if (!root.hidden) render(); }
    else if (message.type === 'gm:dmThread') { state.thread = message.conversation; if (!root.hidden) render(); }
    else if (message.type === 'gm:dmReport') { state.report = message.report; if (!root.hidden) render(); }
  }

  App.registerGmModule('intercept', { open, onMessage });
})();
