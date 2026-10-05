(function () {
  'use strict';
  const presets = new Map();
  let selected = 'default', active = null, ambientTimer = null, microTimer = null;
  const timers = new Set();
  const later = (fn, delay) => { const id = setTimeout(() => { timers.delete(id); fn(); }, delay); timers.add(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); clearTimeout(ambientTimer); clearTimeout(microTimer); ambientTimer = microTimer = null; };
  const removeLayers = () => document.querySelectorAll('.battle-animation-layer,.glitch-world-micro').forEach(node => node.remove());
  function cleanup() {
    clearTimers(); removeLayers();
    document.documentElement.classList.remove('battle-ambience-glitch-world');
    document.body.classList.remove('battle-glitch-transition');
    active?.cleanup?.(); active = null;
  }
  function register(config) {
    if (!config?.id || typeof config.play !== 'function') throw new Error('Invalid Battle Animation preset');
    presets.set(config.id, Object.freeze({ ...config })); return config.id;
  }
  function select(id) { selected = presets.has(id) ? id : 'default'; return selected; }
  function list() { return [...presets.values()].map(({ id, name, message }) => ({ id, name, message })); }
  function microGlitch() {
    if (selected !== 'glitch-world' || !document.body.classList.contains('room-mode-battle')) return;
    if (document.querySelector('[role="dialog"]:not([hidden]),.victory-overlay,.defeat-overlay')) return scheduleMicro();
    const candidates = [...document.querySelectorAll('.little-hero-avatar,.toolbar-btn,.cell:not(.revealed),.gm-presence-count')].filter(node => node.offsetParent);
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    if (target) { target.classList.add('glitch-world-micro'); later(() => target.classList.remove('glitch-world-micro'), 150); }
    scheduleMicro();
  }
  function scheduleMicro() { clearTimeout(microTimer); microTimer = setTimeout(microGlitch, 30000 + Math.random() * 30000); }
  function syncAmbience(mode) {
    document.documentElement.classList.remove('battle-ambience-glitch-world'); clearTimeout(microTimer);
    if (mode === 'BATTLE' && selected === 'glitch-world') {
      document.documentElement.classList.add('battle-ambience-glitch-world'); scheduleMicro();
    }
  }
  function handleTransition(context) {
    cleanup(); select(context.selection);
    if (context.direction !== 'battle' || selected === 'default') { syncAmbience(context.next); return false; }
    active = presets.get(selected); active.play({ ...context, later, finish: () => syncAmbience(context.next) }); return true;
  }
  register({ id: 'default', name: 'DEFAULT', message: '', play() {}, cleanup() {} });
  register({
    id: 'glitch-world', name: 'GLITCH WORLD', message: 'Welcome to Glitch World, little heroes. Reality is no longer guaranteed.',
    play({ later, finish }) {
      const reduced = matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      const layer = document.createElement('div');
      layer.className = 'battle-animation-layer glitch-world-transition'; layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = `<div class="glitch-fault"></div><div class="glitch-slices">${Array.from({length:7},(_,i)=>`<i style="--slice:${i}"></i>`).join('')}</div><div class="glitch-noise"></div><div class="glitch-collapse"><img src="/assets/ui/cyber-gothic-battle-eye.png?v=1" alt=""><div class="glitch-system-line"></div></div><div class="glitch-rebuild">Welcome to Glitch World, little heroes.<small>Reality is no longer guaranteed.</small></div>`;
      document.body.appendChild(layer); document.body.classList.add('battle-glitch-transition');
      requestAnimationFrame(() => layer.classList.add('phase-fault'));
      if (reduced) {
        layer.classList.add('phase-collapse','phase-rebuild');
        later(() => { layer.remove(); document.body.classList.remove('battle-glitch-transition'); finish(); }, 1800); return;
      }
      later(() => layer.classList.add('phase-corrupt'), 700);
      later(() => layer.classList.add('phase-desync'), 1600);
      later(() => { layer.classList.add('phase-collapse'); layer.querySelector('.glitch-system-line').textContent='REALITY DESYNCHRONIZED'; }, 2500);
      later(() => { layer.querySelector('.glitch-system-line').textContent='SYSTEM INTEGRITY: 17%'; }, 2780);
      later(() => { layer.querySelector('.glitch-system-line').textContent='GLITCH WORLD DETECTED'; }, 3030);
      later(() => layer.classList.add('phase-rebuild'), 3250);
      later(() => { layer.remove(); document.body.classList.remove('battle-glitch-transition'); finish(); }, 4550);
    }, cleanup() {}
  });
  window.BattleAnimations = { register, list, select, selected: () => selected, handleTransition, syncAmbience, cleanup };
})();
