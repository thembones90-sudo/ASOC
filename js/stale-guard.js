// STALE GUARD -- a page that was opened before a deploy keeps running the old
// JavaScript, silently missing new features (e.g. a MEGABONK it cannot show).
// On every connection the server announces the current client build (the
// ?v= of player.js / app.js in the served HTML). If this page's own build
// differs, it is out of date:
//   player page: reloads itself (or offers RELOAD during a live battle)
//   GM page:     offers RELOAD (never reloads under the Shadow Broker)
// A reload for a given build is attempted once per tab, so a cached or
// mismatched deploy can never cause a reload loop.
(function () {
  const pageBuild = role => {
    const script = document.querySelector(role === 'gm' ? 'script[src*="js/app.js"]' : 'script[src*="js/player.js"]');
    const match = script?.getAttribute('src')?.match(/[?&]v=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  function banner(text, withButton) {
    let el = document.getElementById('stale-guard-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'stale-guard-banner';
      el.setAttribute('role', 'status');
      Object.assign(el.style, {
        position: 'fixed', left: '50%', top: '12px', transform: 'translateX(-50%)', zIndex: '2147483200',
        display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
        font: '700 12px/1.3 ui-monospace, Consolas, monospace', letterSpacing: '.14em', color: '#fff',
        background: 'linear-gradient(180deg,#3a2266,#1d1233)', border: '1px solid #b58cff',
        boxShadow: '0 10px 30px rgba(0,0,0,.6)'
      });
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (withButton) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'RELOAD';
      Object.assign(button.style, { font: 'inherit', letterSpacing: '.14em', padding: '6px 12px', cursor: 'pointer', color: '#fff', background: '#7e4fd0', border: '1px solid #e6d4ff' });
      button.addEventListener('click', () => location.reload());
      el.appendChild(button);
    }
  }

  // Returns true when this page is stale.
  function check(serverBuild, { role = 'player', liveBattle = false } = {}) {
    const current = serverBuild && serverBuild[role];
    const mine = pageBuild(role);
    if (!current || !mine || current === mine) return false;
    const key = 'asoc_stale_reload_' + current;
    let tried = false;
    try { tried = sessionStorage.getItem(key) === '1'; } catch {}
    if (role === 'player' && !liveBattle && !tried) {
      try { sessionStorage.setItem(key, '1'); } catch {}
      banner('ASOC WAS UPDATED // RELOADING…', false);
      setTimeout(() => location.reload(), 1200);
    } else {
      banner('ASOC WAS UPDATED // RELOAD TO GET THE NEW VERSION', true);
    }
    return true;
  }

  window.StaleGuard = { check, pageBuild };
})();
