(() => {
  'use strict';

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active = null;
  let timers = [];
  let lastKey = '';
  let onKey = null;
  let speed = 1;

  // Victims stay charred / frozen for a while. Client-side only; keyed by display name.
  const AFTERMATH_MS = 45000;
  const aftermath = new Map();
  let aftermathTick = null;

  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  };
  // Timeline helper: base-timeline milliseconds, scaled for bystander playback speed.
  const at = (ms, fn) => later(fn, ms / speed);
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const cleanup = () => {
    clearTimers();
    if (onKey) { document.removeEventListener('keydown', onKey, true); onKey = null; }
    document.documentElement.classList.remove('fatality-impact', 'fatality-impact-heavy');
    active?.remove();
    active = null;
  };
  const sfx = kind => {
    try { window.AsocAudio?.playUi?.(kind); } catch {}
  };
  const hit = (heavy = false) => {
    sfx('impact');
    if (heavy) later(() => sfx('impact'), 80);
  };
  const isGm = () => !!window.App?.send;
  const myId = () => String(window.PlayerApp?.playerId ?? '');

  function decorateAftermath() {
    const now = Date.now();
    for (const [name, entry] of aftermath) if (entry.until <= now) aftermath.delete(name);
    document.querySelectorAll('.little-hero-avatar').forEach(node => {
      const alt = node.querySelector(':scope > img')?.getAttribute('alt') || '';
      const name = alt.replace(/ avatar$/, '').trim();
      let entry = name ? aftermath.get(name) : null;
      if (!entry && !name) {
        const holder = node.closest('[data-player-id]:not(button)');
        const id = holder ? String(holder.getAttribute('data-player-id') || '') : '';
        if (id) for (const e of aftermath.values()) if (e.id && e.id === id) entry = e;
      }
      const layer = node.querySelector(':scope > .fat-after');
      const want = entry ? `fat-after-${entry.mode}` : '';
      ['fat-after-burn', 'fat-after-frost'].forEach(cls => { if (cls !== want) node.classList.remove(cls); });
      if (!entry) { layer?.remove(); return; }
      if (!node.classList.contains(want)) node.classList.add(want);
      if (layer && layer.dataset.mode !== entry.mode) layer.remove();
      if (!node.querySelector(':scope > .fat-after')) {
        if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
        const fx = document.createElement('i');
        fx.className = 'fat-after';
        fx.dataset.mode = entry.mode;
        fx.setAttribute('aria-hidden', 'true');
        fx.innerHTML = '<s></s><s></s><s></s>';
        node.appendChild(fx);
      }
    });
    if (!aftermath.size && aftermathTick) { clearInterval(aftermathTick); aftermathTick = null; }
  }

  function startAftermath(message, mode) {
    const name = String(message.targetName || '').trim();
    if (!name) return;
    aftermath.set(name, { mode, id: message.targetId ? String(message.targetId) : '', until: Date.now() + AFTERMATH_MS });
    decorateAftermath();
    if (!aftermathTick) aftermathTick = setInterval(decorateAftermath, 900);
  }

  function avatar(src, name) {
    return src
      ? `<img src="${esc(src)}" alt="">`
      : `<b>${esc(String(name || '?').trim().slice(0, 2).toUpperCase())}</b>`;
  }
  function particles(mode) {
    return Array.from({ length: 22 }, (_, i) =>
      `<i style="--i:${i};--x:${(i * 37) % 100};--d:${420 + (i % 7) * 85}ms"></i>`
    ).join('');
  }

  function play(message) {
    if (!message || message.type !== 'fatality:strike') return;

    const key = `${message.timestamp || 0}:${message.targetId || ''}:${message.variant || ''}`;
    if (key && key === lastKey) return;
    lastKey = key;

    cleanup();

    const mode = message.variant === 'frost' ? 'frost' : 'pyroblast';
    const finisher = mode === 'frost' ? 'ABSOLUTE ZERO' : 'PYROBLAST';
    const reflected = message.reflected === true;
    const actorName = String(message.actorName || 'SHADOW BROKER').toUpperCase();
    const targetName = String(message.targetName || 'LITTLE HERO').toUpperCase();

    // The victim and the Shadow Broker watch the full show; everyone else gets a tighter cut.
    const bystander = !isGm() && !!myId() && String(message.targetId || '') !== myId();
    speed = bystander ? 1.45 : 1;
    let played = false;
    const settle = () => {
      if (played) return;
      played = true;
      startAftermath(message, mode === 'frost' ? 'frost' : 'burn');
    };

    const layer = document.createElement('div');
    active = layer;
    layer.className = `fatality-layer fatality-${mode}${reflected ? ' fatality-reflected' : ''}`;
    layer.setAttribute('aria-live', 'assertive');
    layer.innerHTML = `
      <div class="fatality-dark"></div>
      <div class="fatality-scan">${reflected ? 'COUNTER-PROTOCOL // FATALITY RETURNED TO SENDER' : 'EXECUTION PROTOCOL // TARGET LOCKED'}</div>
      <div class="fatality-cue">${reflected ? 'SPELL REFLECT' : 'FINISH THEM'}</div>
      <div class="fatality-variant">${finisher}</div>
      <div class="fatality-stage">
        <div class="fatality-fighter fatality-attacker">
          <div class="fatality-avatar">${avatar(message.actorAvatarData, message.actorName)}</div>
          <strong>${esc(message.actorName || 'SHADOW BROKER')}</strong>
        </div>
        <div class="fatality-fighter fatality-victim">
          <div class="fatality-target-ring"></div>
          <div class="fatality-avatar">${avatar(message.targetAvatarData, message.targetName)}</div>
          <strong>${esc(message.targetName)}</strong>
        </div>
        ${reflected ? '<div class="fatality-bolt"></div><div class="fatality-mirror"></div>' : ''}
        <div class="fatality-blast"></div>
        <div class="fatality-burst"></div>
        <div class="fatality-particles">${particles(mode)}</div>
        <div class="fatality-crack"></div>
      </div>
      <div class="fatality-end">
        <strong>FATALITY</strong>
        <span>${esc(actorName)} WINS</span>
        <em>${finisher} // ${esc(targetName)} ELIMINATED</em>
        <q>${esc(message.line || '')}</q>
      </div>
      <div class="fatality-skip">CLICK OR PRESS ESC TO SKIP</div>`;

    document.body.appendChild(layer);

    if (speed !== 1) {
      try { layer.getAnimations({ subtree: true }).forEach(a => { a.playbackRate = speed; }); } catch {}
    }

    const finish = () => {
      if (active === layer) {
        active = null;
        layer.remove();
      }
      if (onKey) { document.removeEventListener('keydown', onKey, true); onKey = null; }
      clearTimers();
    };
    const skip = () => {
      if (active !== layer) return;
      clearTimers();
      settle();
      document.documentElement.classList.remove('fatality-impact', 'fatality-impact-heavy');
      layer.classList.add('fatality-skipping');
      later(finish, 260);
    };
    layer.addEventListener('click', skip);
    onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); skip(); } };
    document.addEventListener('keydown', onKey, true);

    at(150, () => sfx('charge'));
    at(650, () => sfx('lock'));
    if (reflected) at(1300, () => sfx('reflect'));
    at(1600, () => sfx(mode === 'frost' ? 'ice' : 'fire'));
    at(1780, () => {
      hit(false);
      document.documentElement.classList.add('fatality-impact');
    });
    at(2200, () => {
      sfx(mode === 'frost' ? 'freeze' : 'burn');
      settle();
    });
    at(2380, () => {
      hit(true);
      document.documentElement.classList.remove('fatality-impact');
      document.documentElement.classList.add('fatality-impact-heavy');
    });
    at(2850, () => document.documentElement.classList.remove('fatality-impact-heavy'));
    if (mode === 'frost') at(3050, () => sfx('shatter'));
    at(3250, () => sfx('fatal'));
    at(6400, finish);
  }

  const style = document.createElement('style');
  style.id = 'asoc-fatality-css';
  style.textContent = `
  .fatality-layer{position:fixed;inset:0;z-index:2147482500;overflow:hidden;pointer-events:auto;cursor:pointer;font-family:Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif;color:#fff}
  .fatality-dark{position:absolute;inset:0;background:radial-gradient(circle at 50% 54%,#211014 0,#08090d 52%,#000 100%);animation:fat-dark 6.4s both}
  .fatality-frost .fatality-dark{background:radial-gradient(circle at 50% 54%,#0c2630 0,#071018 48%,#000 100%)}
  .fatality-stage{position:absolute;inset:0}
  .fatality-scan{position:absolute;top:7%;left:50%;transform:translateX(-50%);z-index:9;font:700 12px/1 Arial;letter-spacing:.28em;color:#8f7e82;opacity:0;animation:fat-scan .85s .08s both}
  .fatality-cue{position:absolute;inset:16% 0 auto;text-align:center;font-size:clamp(52px,8vw,120px);letter-spacing:5px;color:#c20b12;text-shadow:0 4px 0 #310000,0 0 24px #ff2020;z-index:8;animation:fat-cue 1.75s .2s both}
  .fatality-variant{position:absolute;top:28%;left:50%;transform:translateX(-50%);z-index:9;font:900 clamp(18px,2.2vw,34px)/1 Arial;letter-spacing:.22em;opacity:0;animation:fat-variant .5s 1.25s forwards}
  .fatality-pyroblast .fatality-variant{color:#ff9b34;text-shadow:0 0 18px #ff3c00}
  .fatality-frost .fatality-variant{color:#8cecff;text-shadow:0 0 18px #1bbcff}

  .fatality-fighter{position:absolute;top:36%;width:210px;text-align:center;z-index:5;animation:fat-enter .7s cubic-bezier(.2,.9,.2,1) both}
  .fatality-attacker{left:17%}.fatality-victim{right:17%}
  .fatality-avatar{position:relative;width:180px;height:180px;border-radius:50%;overflow:hidden;border:5px solid #222;background:#090909;box-shadow:0 0 40px #000}
  .fatality-avatar img{width:100%;height:100%;object-fit:cover}.fatality-avatar b{display:grid;place-items:center;width:100%;height:100%;font-size:54px}
  .fatality-fighter strong{display:block;margin-top:12px;font:700 20px/1 Arial;letter-spacing:3px}
  .fatality-target-ring{position:absolute;left:82px;top:82px;width:196px;height:196px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid #b00;box-shadow:0 0 22px #e00;animation:fat-ring .85s .72s both;z-index:-1}
  .fatality-frost .fatality-target-ring{border-color:#58cfff;box-shadow:0 0 22px #58cfff}

  .fatality-blast{position:absolute;left:28%;top:48%;width:44%;height:13%;transform-origin:left center;z-index:3;opacity:0;animation:fat-blast 1.15s 1.6s both}
  .fatality-pyroblast .fatality-blast{background:linear-gradient(90deg,#fff8c9,#ffbd38 18%,#ff5a16 52%,#d90000 76%,transparent);filter:blur(4px);box-shadow:0 0 55px #ff4200}
  .fatality-frost .fatality-blast{height:10%;top:49%;background:linear-gradient(90deg,#fff,#d8fbff 18%,#65dbff 45%,#168fff 72%,transparent);filter:blur(2px);box-shadow:0 0 65px #74e7ff}

  .fatality-burst{position:absolute;right:16%;top:36%;width:220px;height:220px;border-radius:50%;opacity:0;z-index:6;animation:fat-burst .85s 2.18s both}
  .fatality-pyroblast .fatality-burst{background:radial-gradient(circle,#fff 0,#ffe275 12%,#ff711f 32%,#f00 50%,transparent 73%);box-shadow:0 0 120px #ff2500}
  .fatality-frost .fatality-burst{background:radial-gradient(circle,#fff 0,#dcfbff 13%,#7bdfff 33%,#168dff 50%,transparent 70%);box-shadow:0 0 130px #67dfff}

  .fatality-particles{position:absolute;inset:0;z-index:7;overflow:hidden}
  .fatality-particles i{position:absolute;left:calc(var(--x)*1%);top:50%;width:7px;height:20px;opacity:0;animation:fat-particle var(--d) 2.28s ease-out forwards}
  .fatality-pyroblast .fatality-particles i{border-radius:50%;background:#ff8a1c;box-shadow:0 0 12px #ff2600}
  .fatality-frost .fatality-particles i{width:5px;height:28px;background:#bdf8ff;clip-path:polygon(50% 0,100% 100%,0 76%);box-shadow:0 0 12px #50d7ff}

  .fatality-crack{position:absolute;right:12%;top:29%;width:300px;height:300px;opacity:0;z-index:4}
  .fatality-frost .fatality-crack{opacity:0;background:repeating-conic-gradient(from 10deg at 50% 50%,transparent 0 13deg,rgba(190,245,255,.65) 14deg 15deg,transparent 16deg 32deg);clip-path:circle(48%);animation:fat-crack .7s 2.22s forwards}
  .fatality-pyroblast .fatality-crack{background:radial-gradient(circle,transparent 0 28%,rgba(255,100,0,.26) 29% 31%,transparent 33%);animation:fat-crack .55s 2.24s forwards}

  .fatality-pyroblast .fatality-victim{animation:fat-enter .7s both,fat-burn 1.45s 2.08s forwards}
  .fatality-frost .fatality-victim{animation:fat-enter .7s both,fat-freeze 1.1s 1.92s forwards,fat-shatter .55s 3.05s forwards}

  .fatality-end{position:absolute;inset:auto 0 9%;text-align:center;z-index:10;opacity:0;animation:fat-end 2.55s 3.25s both}
  .fatality-end strong{display:block;font-size:clamp(68px,10vw,150px);line-height:.8;color:#c30b12;text-shadow:0 5px #310000,0 0 25px #e00}
  .fatality-frost .fatality-end strong{color:#d9f8ff;text-shadow:0 5px #08384a,0 0 30px #39cfff}
  .fatality-end span{display:block;margin-top:20px;font:800 25px Arial;letter-spacing:6px}
  .fatality-end em{display:block;margin-top:9px;font:700 14px Arial;letter-spacing:4px;color:#aaa}.fatality-end q{display:block;max-width:min(840px,82vw);margin:18px auto 0;font:700 clamp(16px,1.8vw,26px)/1.25 Arial;letter-spacing:.03em;color:#e8d9dc;text-shadow:0 2px 12px #000}.fatality-end q:before,.fatality-end q:after{content:''}
  .fatality-pyroblast .fatality-end em{color:#ff8c32}.fatality-frost .fatality-end em{color:#83ddff}

  .fatality-impact{animation:fat-shake .35s}
  .fatality-impact-heavy{animation:fat-shake-heavy .48s}
  @keyframes fat-dark{0%{opacity:0}7%,90%{opacity:1}100%{opacity:0}}
  @keyframes fat-scan{0%{opacity:0;letter-spacing:.6em}100%{opacity:1;letter-spacing:.28em}}
  @keyframes fat-enter{from{transform:translateY(90px) scale(.7);opacity:0}to{transform:none;opacity:1}}
  @keyframes fat-cue{0%{opacity:0;transform:scale(1.5)}18%,62%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.82)}}
  @keyframes fat-variant{from{opacity:0;transform:translateX(-50%) scale(1.4)}to{opacity:1;transform:translateX(-50%) scale(1)}}
  @keyframes fat-ring{from{opacity:0;transform:translate(-50%,-50%) scale(1.7)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
  @keyframes fat-blast{0%{opacity:0;transform:scaleX(.03)}15%,72%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1.06)}}
  @keyframes fat-burst{0%{opacity:0;transform:scale(.2)}35%{opacity:1;transform:scale(1.65)}100%{opacity:0;transform:scale(2.35)}}
  @keyframes fat-particle{0%{opacity:0;transform:translate(0,0) rotate(0)}18%{opacity:1}100%{opacity:0;transform:translate(calc((var(--x) - 50)*1.4px),calc(-90px - var(--i)*7px)) rotate(220deg)}}
  @keyframes fat-crack{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1.15)}}
  @keyframes fat-burn{25%{filter:sepia(1) saturate(6) brightness(1.25);transform:scale(1.04)}65%{filter:brightness(.16) sepia(1) saturate(5);transform:scale(.9)}100%{opacity:0;filter:brightness(0);transform:scale(.48) translateY(95px)}}
  @keyframes fat-freeze{0%{filter:none}55%{filter:brightness(1.7) hue-rotate(150deg) saturate(2.5)}100%{filter:grayscale(.15) brightness(1.45) hue-rotate(155deg) saturate(3.3);box-shadow:0 0 70px #8de8ff}}
  @keyframes fat-shatter{to{opacity:0;transform:scale(1.8) rotate(9deg);filter:blur(11px) brightness(2.4)}}
  @keyframes fat-end{0%{opacity:0;transform:scale(1.3)}14%,77%{opacity:1;transform:scale(1)}100%{opacity:0}}
  @keyframes fat-shake{0%,100%{transform:none}25%{transform:translate(-6px,3px)}50%{transform:translate(5px,-4px)}75%{transform:translate(-3px,-2px)}}
  @keyframes fat-shake-heavy{0%,100%{transform:none}16%{transform:translate(-14px,8px)}32%{transform:translate(12px,-9px)}48%{transform:translate(-10px,-5px)}64%{transform:translate(8px,6px)}80%{transform:translate(-5px,3px)}}
  .fatality-skip{position:absolute;left:50%;bottom:2.2%;transform:translateX(-50%);z-index:20;font:700 11px/1 Arial;letter-spacing:.3em;color:#9a8c90;opacity:0;animation:fat-skip .5s 1s forwards;pointer-events:none}
  .fatality-skipping{opacity:0;transition:opacity .25s ease}
  @keyframes fat-skip{to{opacity:.7}}

  .fatality-bolt{position:absolute;left:29%;top:48.4%;width:42%;height:2.8%;transform-origin:right center;background:linear-gradient(90deg,#fff,#a8ecff 28%,rgba(120,220,255,.25) 70%,transparent);filter:blur(1px);box-shadow:0 0 28px #8fe6ff;opacity:0;z-index:3;animation:fat-bolt .5s .85s both}
  .fatality-mirror{position:absolute;left:calc(17% - 35px);top:calc(36% - 36px);width:260px;height:260px;border-radius:50%;z-index:6;opacity:0;border:3px solid #fff;background:conic-gradient(from 0deg,rgba(255,255,255,.55),rgba(150,225,255,.1),rgba(255,255,255,.65),rgba(150,225,255,.1),rgba(255,255,255,.55));box-shadow:0 0 50px #bfeaff,inset 0 0 40px rgba(255,255,255,.55);animation:fat-mirror .75s 1.3s both}
  @keyframes fat-bolt{0%{opacity:0;transform:scaleX(.03)}25%{opacity:1}100%{opacity:0;transform:scaleX(1)}}
  @keyframes fat-mirror{0%{opacity:0;transform:scale(.55)}30%{opacity:1;transform:scale(1.12);filter:brightness(2.2)}100%{opacity:0;transform:scale(1.25)}}
  .fatality-reflected .fatality-blast{animation-delay:1.75s}

  .fat-after-burn{filter:grayscale(.3) sepia(.7) brightness(.58) contrast(1.2)!important;box-shadow:0 0 9px rgba(255,90,20,.65)!important}
  .fat-after-frost{filter:saturate(.5) brightness(1.2) hue-rotate(150deg)!important;box-shadow:0 0 10px rgba(130,228,255,.8)!important}
  .fat-after{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:6}
  .fat-after-burn>.fat-after{background:radial-gradient(circle at 50% 45%,transparent 28%,rgba(8,5,4,.6) 82%),linear-gradient(0deg,rgba(255,90,10,.38),transparent 52%);animation:fat-ember 1.5s ease-in-out infinite alternate}
  .fat-after-burn>.fat-after s{position:absolute;bottom:-10%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(190,190,190,.5),rgba(90,90,90,.25) 60%,transparent 72%);animation:fat-smoke 2.4s linear infinite}
  .fat-after-burn>.fat-after s:nth-child(1){left:14%;width:34%}
  .fat-after-burn>.fat-after s:nth-child(2){left:44%;width:28%;animation-delay:-.9s}
  .fat-after-burn>.fat-after s:nth-child(3){left:62%;width:36%;animation-delay:-1.6s}
  .fat-after-frost>.fat-after{background:radial-gradient(circle at 50% 50%,transparent 32%,rgba(215,250,255,.55) 92%),repeating-conic-gradient(from 12deg at 50% 50%,transparent 0 12deg,rgba(225,252,255,.4) 13deg 14deg,transparent 15deg 30deg);mix-blend-mode:screen;animation:fat-glint 2.2s ease-in-out infinite alternate}
  .fat-after-frost>.fat-after s{position:absolute;width:12%;aspect-ratio:1;background:#fff;clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);animation:fat-twinkle 1.6s ease-in-out infinite}
  .fat-after-frost>.fat-after s:nth-child(1){left:18%;top:20%}
  .fat-after-frost>.fat-after s:nth-child(2){left:66%;top:30%;animation-delay:-.6s}
  .fat-after-frost>.fat-after s:nth-child(3){left:42%;top:68%;animation-delay:-1.1s}
  @keyframes fat-ember{from{opacity:.78}to{opacity:1}}
  @keyframes fat-smoke{0%{transform:translateY(0) scale(.5);opacity:0}20%{opacity:.8}100%{transform:translateY(-330%) scale(1.3);opacity:0}}
  @keyframes fat-glint{from{opacity:.65}to{opacity:1}}
  @keyframes fat-twinkle{0%,100%{opacity:0;transform:scale(.3)}50%{opacity:1;transform:scale(1)}}
  @media(prefers-reduced-motion:reduce){.fat-after,.fat-after s{animation:none!important}}
  @media(max-width:720px){.fatality-attacker{left:5%}.fatality-victim{right:5%}.fatality-fighter{width:145px}.fatality-avatar{width:118px;height:118px}.fatality-target-ring{left:54px;top:54px;width:132px;height:132px}.fatality-blast{left:27%;width:46%}.fatality-end span{font-size:17px;letter-spacing:3px}}
  @media(prefers-reduced-motion:reduce){.fatality-layer *{animation-duration:.01ms!important;animation-delay:0s!important}.fatality-layer{background:#050505}}
  `;
  document.head.appendChild(style);

  window.Fatality = Object.freeze({ play, cleanup });
})();
