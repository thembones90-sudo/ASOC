(() => {
  'use strict';
  const seen = new Set();
  const models = {
    bottle: ['bottle-voidwarden', 'bottle-reliquary', 'bottle-bloodcrown'],
    can: ['can-iron-ration', 'can-void-coil', 'can-royal-stout'],
    barrel: ['barrel-oathwood', 'barrel-iron-keg', 'barrel-plague-cask']
  };
  let timer;
  let drunkTimer;
  function clearDrunk() {
    clearTimeout(drunkTimer);
    document.getElementById('asoc-beer-drunk')?.remove();
  }
  function acceptBeer() {
    dismiss();
    clearDrunk();
    const effect = document.createElement('div');
    effect.id = 'asoc-beer-drunk';
    effect.dataset.strength = '50';
    effect.setAttribute('aria-hidden', 'true');
    document.body.append(effect);
    // Cosmetic and local only; neither other clients nor game state change.
    drunkTimer = setTimeout(clearDrunk, 5000);
  }
  const art = {
    bottle: '<path d="M139 31h42v58l13 25q12 13 12 36v100q0 13-14 13h-64q-14 0-14-13V150q0-23 12-36l13-25Z" fill="url(#beer-glass)" stroke="#edbd68" stroke-width="3"/><path d="M136 29h48v13h-48Z" fill="url(#beer-metal)"/><path d="M119 155h82v68h-82Z" fill="#261518" stroke="#e7b25a" stroke-width="2"/><path d="m160 166 9 15 17 3-12 12 3 17-17-8-17 8 3-17-12-12 17-3Z" fill="#f6cc7a"/><path d="M147 50v39l-14 29q-7 15-7 27" stroke="#fff3b0" stroke-opacity=".6" stroke-width="5" fill="none"/><path d="m183 24 15-9 12 3-16 12Z" fill="#efc57b"/>',
    can: '<rect x="96" y="56" width="128" height="207" rx="23" fill="url(#beer-metal)" stroke="#ffe3a6" stroke-width="3"/><path d="M99 83h122v151H99Z" fill="url(#beer-amber)"/><path d="m104 90 110 134M104 115l110 134" stroke="#351623" stroke-width="13"/><ellipse cx="160" cy="60" rx="61" ry="12" fill="#dbc8a9" stroke="#fff0cb" stroke-width="3"/><ellipse cx="160" cy="59" rx="17" ry="6" fill="#281b19"/><path d="M153 54q22-13 27 1l-7 9h-18Z" fill="#9b8c7d" stroke="#fff0cb"/><path d="m160 122 12 22 24 5-17 18 4 25-23-12-23 12 4-25-17-18 24-5Z" fill="#ffe6ad"/><g fill="#fff3cf" fill-opacity=".7"><ellipse cx="114" cy="105" rx="3" ry="5"/><ellipse cx="208" cy="186" rx="3" ry="5"/><ellipse cx="119" cy="216" rx="2" ry="4"/><ellipse cx="202" cy="113" rx="2" ry="4"/></g>',
    barrel: '<path d="M79 73q81-30 162 0 38 91 0 173-81 30-162 0-38-82 0-173Z" fill="url(#beer-wood)" stroke="#e5b46a" stroke-width="4"/><path d="M108 69q-29 93 0 182m35-190q-10 96 0 197m34-197q10 96 0 197m35-189q29 93 0 182" fill="none" stroke="#351c11" stroke-width="5"/><path d="M66 104q94 24 188 0l7 25q-101 24-202 0Zm-7 87q101 24 202 0l-7 25q-94 24-188 0Z" fill="url(#beer-metal)" stroke="#3d2920" stroke-width="3"/><ellipse cx="160" cy="72" rx="80" ry="19" fill="#704123" stroke="#e6b970" stroke-width="4"/><ellipse cx="160" cy="72" rx="60" ry="11" fill="none" stroke="#b67c3b" stroke-width="2"/><circle cx="160" cy="166" r="21" fill="#32171b" stroke="#f1c678" stroke-width="3"/><path d="M157 154h12v24h17v12h-29Z" fill="url(#beer-metal)" stroke="#ffdda0" stroke-width="2"/>'
  };
  const names = { bottle: 'THE GOLDEN BOTTLE', can: 'THE FROSTED CAN', barrel: 'THE LEGENDARY BARREL' };
  function dismiss() {
    clearTimeout(timer);
    document.getElementById('asoc-beer-layer')?.remove();
  }
  function show(event) {
    if (!event || !Object.hasOwn(art, event.variant) || typeof event.id !== 'string' || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 64) seen.delete(seen.values().next().value);
    if (document.hidden) return;
    dismiss();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const layer = document.createElement('section');
    layer.id = 'asoc-beer-layer'; layer.dataset.variant = event.variant;
    layer.classList.toggle('is-reduced', !!reduced);
    layer.innerHTML = `<div class="asoc-beer-panel"><button type="button" class="asoc-beer-close" aria-label="Dismiss beer celebration">×</button><div class="asoc-beer-kicker">THE NEXT ROUND IS ON</div><h2 class="asoc-beer-offerer"></h2><div class="asoc-beer-stage" aria-hidden="true"><div class="asoc-beer-ring"></div><div class="asoc-beer-rays"></div><svg class="asoc-beer-vessel" viewBox="0 0 320 280"><defs><linearGradient id="beer-glass"><stop stop-color="#301d0c"/><stop offset=".35" stop-color="#f4b73c"/><stop offset=".55" stop-color="#8a450d"/><stop offset="1" stop-color="#20160b"/></linearGradient><linearGradient id="beer-metal"><stop stop-color="#665446"/><stop offset=".3" stop-color="#fff0c5"/><stop offset=".55" stop-color="#baa481"/><stop offset="1" stop-color="#554738"/></linearGradient><linearGradient id="beer-amber" x2="0" y2="1"><stop stop-color="#f9c855"/><stop offset="1" stop-color="#ad5116"/></linearGradient><linearGradient id="beer-wood"><stop stop-color="#482718"/><stop offset=".4" stop-color="#c18a47"/><stop offset="1" stop-color="#492516"/></linearGradient></defs><ellipse cx="160" cy="266" rx="100" ry="9" fill="#0007"/>${art[event.variant]}</svg><div class="asoc-beer-particles"></div><div class="asoc-beer-foam"><i></i><i></i><i></i><i></i><i></i></div></div><div class="asoc-beer-title"></div><p class="asoc-beer-cheers" role="status"></p><small>RAISE IT HIGH. ŽIVELI!</small></div>`;
    const name = String(event.offeredBy?.name || 'SOMEONE').slice(0, 80);
    layer.querySelector('.asoc-beer-offerer').textContent = name;
    layer.querySelector('.asoc-beer-title').textContent = names[event.variant];
    if (models[event.variant].includes(event.model)) {
      const vessel = document.createElement('img');
      vessel.className = 'asoc-beer-vessel'; vessel.alt = '';
      vessel.src = `assets/ui/beer/${event.model}.svg?v=20261016-beer-1`;
      vessel.addEventListener('error', () => { vessel.replaceWith(fallback); }, { once: true });
      const fallback = layer.querySelector('svg.asoc-beer-vessel');
      fallback.replaceWith(vessel);
    }
    layer.querySelector('.asoc-beer-cheers').textContent = `${name} offers the room a ${event.variant} of beer!`;
    const choices = document.createElement('div');
    choices.className = 'asoc-beer-choices';
    choices.innerHTML = '<button type="button" data-beer-accept>ACCEPT BEER</button><button type="button" data-beer-refuse>REFUSE</button>';
    choices.querySelector('[data-beer-accept]').addEventListener('click', acceptBeer, { once: true });
    choices.querySelector('[data-beer-refuse]').addEventListener('click', dismiss, { once: true });
    layer.querySelector('.asoc-beer-panel').append(choices);
    if (!reduced) {
      const particles = layer.querySelector('.asoc-beer-particles');
      for (let i = 0; i < 24; i++) {
        const particle = document.createElement('i');
        const angle = i * Math.PI / 12;
        particle.className = i % 3 ? 'is-spark' : 'is-foam';
        particle.style.setProperty('--dx', `${Math.cos(angle) * (95 + i % 4 * 26)}px`);
        particle.style.setProperty('--dy', `${Math.sin(angle) * (85 + i % 3 * 30)}px`);
        particle.style.setProperty('--delay', `${i % 4 * 45}ms`);
        particles.append(particle);
      }
    }
    layer.querySelector('.asoc-beer-close').setAttribute('aria-label', 'Refuse beer offer');
    layer.querySelector('.asoc-beer-close').addEventListener('click', dismiss);
    document.body.append(layer);
    // The reveal ends, but the choice never silently becomes an acceptance.
    timer = setTimeout(() => {
      layer.classList.add('is-awaiting-choice');
      layer.querySelector('.asoc-beer-particles').replaceChildren();
    }, 5200);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { dismiss(); clearDrunk(); } });
  window.addEventListener('pagehide', () => { dismiss(); clearDrunk(); });
  window.AsocBeer = { show, dismiss };
})();
