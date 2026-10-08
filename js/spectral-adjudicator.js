(() => {
  'use strict';
  const root = () => document.getElementById('spectral-console');
  const send = payload => window.App?.send?.(payload);
  function render(state = {}) {
    const mode = state.mode || 'MANUAL';
    const paused = state.paused === true;
    const select = document.getElementById('spectral-mode');
    if (select) select.value = mode;
    const status = document.getElementById('spectral-status');
    if (status) status.textContent = `${mode} // ${paused ? 'PAUSED' : 'ACTIVE'}`;
    const pending = document.getElementById('spectral-pending');
    if (pending) pending.textContent = `${(state.pending || []).length} PENDING`;
    root()?.classList.toggle('is-paused', paused);
  }
  function init() {
    document.getElementById('spectral-mode')?.addEventListener('change', e => send({ type:'gm:spectral:mode', mode:e.target.value }));
    document.getElementById('spectral-pause')?.addEventListener('click', () => send({ type:'gm:spectral:pause' }));
    document.getElementById('spectral-resume')?.addEventListener('click', () => send({ type:'gm:spectral:resume' }));
    send({ type:'gm:spectral:sync' });
  }
  const api = { open(){ send({ type:'gm:spectral:sync' }); }, onMessage(message){ if(message.type === 'spectral:state') render(message.state); if(['room:created','host:reconnected','host:recovered'].includes(message.type)) send({type:'gm:spectral:sync'}); } };
  window.App?.registerGmModule?.('spectral-adjudicator', api);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
