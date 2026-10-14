(() => {
  'use strict';
  let active = false;
  const selector = '#casual-minigames-dock,#hero-hud-dm-chip,#dmx-rail,#direct-messages,#shadow-market,#player-quest-hud,#player-quest-overlay,#player-scoreboard-btn,#player-alltime-hud-btn,#chat-image-upload-btn,#chat-voice-btn,#chat-emoji-toggle,#chat-hint-button,.chat-reaction-add,.chat-reaction-chip,[data-player-q],[data-m-action="games"],[data-m-action="shop"]';
  const lock = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110"><defs><linearGradient id="m" x2="1" y2="1"><stop stop-color="#f5f6f8"/><stop offset=".3" stop-color="#7c8798"/><stop offset=".5" stop-color="#d8dce2"/><stop offset="1" stop-color="#333b49"/></linearGradient></defs><path d="M26 49V30a24 24 0 0 1 48 0v19" fill="none" stroke="#15191f" stroke-width="16"/><path d="M26 49V30a24 24 0 0 1 48 0v19" fill="none" stroke="url(#m)" stroke-width="10"/><rect x="10" y="43" width="80" height="62" rx="7" fill="url(#m)" stroke="#171c24" stroke-width="4"/><rect x="18" y="51" width="64" height="46" rx="3" fill="#36404d" stroke="#c6ccd5"/><circle cx="50" cy="69" r="8" fill="#090c11"/><path d="M46 73h8l3 16H43z" fill="#090c11"/></svg>`;
  function apply() {
    document.querySelectorAll(selector).forEach(node => {
      node.classList.toggle('player-feature-locked', active);
      if (active) node.setAttribute('aria-disabled', 'true');
      else node.removeAttribute('aria-disabled');
    });
    document.body.classList.toggle('player-lockdown-active', active);
    const banner = document.getElementById('player-lockdown-banner');
    if (banner) banner.hidden = !active;
  }
  function start() {
    const style = document.createElement('style');
    style.textContent = `.player-feature-locked{position:relative!important;isolation:isolate;cursor:not-allowed!important;overflow:hidden!important}.player-feature-locked::after{content:'';position:absolute;inset:0;z-index:1000;pointer-events:none;background: url("data:image/svg+xml,${encodeURIComponent(lock)}") center/auto min(74px,90%) no-repeat,linear-gradient(135deg,#0a0d14d9,#161c28c9);box-shadow:inset 0 0 0 2px #737f92;animation:lock-slam .3s ease-out}.player-feature-locked>*{filter:grayscale(.85);opacity:.45}#player-lockdown-banner{padding:12px;text-align:center;background:linear-gradient(90deg,#161b24,#303847,#161b24);color:#e3e8f0;border:1px solid #8390a4;font:700 12px/1.4 monospace;letter-spacing:.12em}#player-lockdown-banner[hidden]{display:none}@keyframes lock-slam{from{transform:scale(1.25);opacity:0}to{transform:scale(1);opacity:1}}@media(prefers-reduced-motion:reduce){.player-feature-locked::after{animation:none}}`;
    document.head.appendChild(style);
    const banner = document.createElement('div');
    banner.id = 'player-lockdown-banner'; banner.hidden = true;
    banner.textContent = 'LOCKDOWN // FUNCTIONS SEALED BY THE SHADOW BROKER // PUBLIC CHAT OPEN';
    banner.setAttribute('role', 'status');
    (document.getElementById('chat-panel') || document.body).prepend(banner);
    document.addEventListener('click', event => {
      if (active && event.target.closest?.(selector)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
    apply();
  }
  window.PlayerLockdown = { update(value) { active = value === true; apply(); } };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
})();
