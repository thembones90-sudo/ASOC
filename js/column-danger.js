(() => {
  'use strict';
  function explode(column) {
    const col = /^[A-D]$/.test(String(column || '').toUpperCase()) ? String(column).toUpperCase() : '';
    if (!col) return;
    document.querySelector('.column-danger-explosion')?.remove();
    const layer = document.createElement('div');
    layer.className = 'column-danger-explosion';
    layer.innerHTML = `<div class="column-danger-blast"><i></i><i></i><i></i><strong>${col}</strong><span>COLUMN TIME EXPIRED</span><small>SHADOW BROKER // MARK THE VERDICT</small></div>`;
    document.body.appendChild(layer);
    document.documentElement.classList.add('column-danger-shake');
    window.AsocAudio?.wrong?.();
    setTimeout(() => document.documentElement.classList.remove('column-danger-shake'), 850);
    setTimeout(() => layer.remove(), 2600);
  }
  window.ColumnDanger = { explode };
})();
