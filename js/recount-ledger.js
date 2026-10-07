const RecountLedger = (() => {
  const roots = new Set();
  let matches = [];
  let request = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const number = value => Number(value || 0).toLocaleString('en-US');
  const when = value => value ? new Date(value).toLocaleString([], {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }) : 'DATE UNKNOWN';

  function matchHtml(match, index) {
    const rows = (match.scoreboard || []).map(row => `
      <tr>
        <td class="rl-rank">${number(row.rank)}</td>
        <td>${esc(row.name)}</td>
        <td class="rl-num">${number(row.points)}</td>
        <td class="rl-num">${number(row.solves)}</td>
        <td class="rl-num">${row.accuracy == null ? '—' : Math.round(row.accuracy * 100) + '%'}</td>
      </tr>`).join('');
    return `<details class="recount-ledger-match"${index === 0 ? ' open' : ''}>
      <summary>
        <span><b>${esc(match.title)}</b><small>${when(match.completedAt)}${match.satisfaction?.votes ? ` · SAT ${Number(match.satisfaction.average).toFixed(1)}/10 (${number(match.satisfaction.votes)})` : ''}</small></span>
        <strong class="is-${String(match.outcome || '').toLowerCase()}">${esc(match.outcome)}</strong>
      </summary>
      <div class="recount-ledger-table-wrap"><table>
        <thead><tr><th>#</th><th>PLAYER</th><th class="rl-num">POINTS</th><th class="rl-num">SOLVES</th><th class="rl-num">ACCURACY</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="recount-ledger-empty">NO SCORES RECORDED</td></tr>'}</tbody>
      </table></div>
    </details>`;
  }

  function paint(root) {
    const body = root.querySelector('[data-recount-ledger-body]');
    if (!body) return;
    body.innerHTML = matches.length
      ? matches.map(matchHtml).join('')
      : '<div class="recount-ledger-empty">NO COMPLETED RECOUNTS YET</div>';
  }

  function mount(root, send) {
    if (!root || root.dataset.recountLedgerMounted) return;
    root.dataset.recountLedgerMounted = 'true';
    roots.add(root);
    if (typeof send === 'function') request = send;
    root.innerHTML = `<div class="recount-ledger-head"><div><b>RECOUNT LEDGER</b><small>COMPLETED MATCH SCOREBOARDS</small></div><button type="button" data-recount-ledger-refresh>REFRESH</button></div><div data-recount-ledger-body><div class="recount-ledger-empty">LOADING SCOREBOARDS…</div></div>`;
    root.querySelector('[data-recount-ledger-refresh]').addEventListener('click', () => refresh());
    refresh();
  }

  function refresh() { if (request) request({ type: 'recount:ledgerGet', limit: 30 }); }
  function render(next) {
    matches = Array.isArray(next) ? next : [];
    roots.forEach(root => paint(root));
  }

  return { mount, refresh, render };
})();

window.RecountLedger = RecountLedger;
