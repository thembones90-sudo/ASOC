(() => {
  'use strict';

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active = null;
  let timers = [];
  let lastKey = '';

  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const cleanup = () => {
    clearTimers();
    document.documentElement.classList.remove('fatality-impact', 'fatality-impact-heavy');
    active?.remove();
    active = null;
  };
  const hit = (heavy = false) => {
    try {
      window.AsocAudio?.playUi?.('impact');
      if (heavy) later(() => window.AsocAudio?.playUi?.('impact'), 80);
    } catch {}
  };
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

    const layer = document.createElement('div');
    active = layer;
    layer.className = `fatality-layer fatality-${mode}`;
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
      </div>`;

    document.body.appendChild(layer);

    later(() => hit(false), 650);
    later(() => {
      hit(false);
      document.documentElement.classList.add('fatality-impact');
    }, 1780);
    later(() => {
      hit(true);
      document.documentElement.classList.remove('fatality-impact');
      document.documentElement.classList.add('fatality-impact-heavy');
    }, 2380);
    later(() => document.documentElement.classList.remove('fatality-impact-heavy'), 2850);
    later(() => {
      if (active === layer) {
        active = null;
        layer.remove();
      }
      clearTimers();
    }, 6400);
  }

  const style = document.createElement('style');
  style.id = 'asoc-fatality-css';
  style.textContent = `
  .fatality-layer{position:fixed;inset:0;z-index:2147482500;overflow:hidden;pointer-events:none;font-family:Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif;color:#fff}
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
  @media(max-width:720px){.fatality-attacker{left:5%}.fatality-victim{right:5%}.fatality-fighter{width:145px}.fatality-avatar{width:118px;height:118px}.fatality-target-ring{left:54px;top:54px;width:132px;height:132px}.fatality-blast{left:27%;width:46%}.fatality-end span{font-size:17px;letter-spacing:3px}}
  @media(prefers-reduced-motion:reduce){.fatality-layer *{animation-duration:.01ms!important;animation-delay:0s!important}.fatality-layer{background:#050505}}
  `;
  document.head.appendChild(style);

  window.Fatality = Object.freeze({ play, cleanup });
})();
