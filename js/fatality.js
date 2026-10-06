(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let active = null;
  function avatar(src, name) {
    return src ? `<img src="${esc(src)}" alt="">` : `<b>${esc(String(name||'?').trim().slice(0,2).toUpperCase())}</b>`;
  }
  function play(message) {
    if (!message || message.type !== 'fatality:strike') return;
    active?.remove();
    const mode = message.variant === 'frost' ? 'frost' : 'pyroblast';
    const layer = document.createElement('div');
    active = layer;
    layer.className = `fatality-layer fatality-${mode}`;
    layer.setAttribute('aria-live','assertive');
    layer.innerHTML = `
      <div class="fatality-dark"></div>
      <div class="fatality-cue">FINISH THEM</div>
      <div class="fatality-stage">
        <div class="fatality-fighter fatality-attacker"><div class="fatality-avatar">${avatar(message.actorAvatarData,message.actorName)}</div><strong>${esc(message.actorName)}</strong></div>
        <div class="fatality-fighter fatality-victim"><div class="fatality-avatar">${avatar(message.targetAvatarData,message.targetName)}</div><strong>${esc(message.targetName)}</strong></div>
        <div class="fatality-blast"></div><div class="fatality-burst"></div><div class="fatality-shards"></div>
      </div>
      <div class="fatality-end"><strong>FATALITY</strong><span>${esc(String(message.actorName||'SHADOW BROKER').toUpperCase())} WINS</span><em>${mode === 'frost' ? 'ABSOLUTE ZERO' : 'PYROBLAST'}</em></div>`;
    document.body.appendChild(layer);
    document.documentElement.classList.add('fatality-impact');
    setTimeout(()=>document.documentElement.classList.remove('fatality-impact'), 2700);
    setTimeout(()=>{ if(active===layer) active=null; layer.remove(); }, 6200);
  }
  const style=document.createElement('style');
  style.textContent=`
  .fatality-layer{position:fixed;inset:0;z-index:2147482500;overflow:hidden;pointer-events:none;font-family:Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif;color:#fff}
  .fatality-dark{position:absolute;inset:0;background:radial-gradient(circle at 50% 55%,#271010 0,#08090d 55%,#000 100%);animation:fat-dark 6.2s both}
  .fatality-stage{position:absolute;inset:0}.fatality-fighter{position:absolute;top:34%;width:210px;text-align:center;z-index:4;animation:fat-enter .7s cubic-bezier(.2,.9,.2,1) both}
  .fatality-attacker{left:18%}.fatality-victim{right:18%}.fatality-avatar{width:180px;height:180px;border-radius:50%;overflow:hidden;border:5px solid #222;background:#090909;box-shadow:0 0 40px #000}
  .fatality-avatar img{width:100%;height:100%;object-fit:cover}.fatality-avatar b{display:grid;place-items:center;width:100%;height:100%;font-size:54px}.fatality-fighter strong{display:block;margin-top:12px;font:700 20px/1 Arial;letter-spacing:3px}
  .fatality-cue{position:absolute;inset:17% 0 auto;text-align:center;font-size:clamp(52px,8vw,120px);letter-spacing:5px;color:#c20b12;text-shadow:0 4px 0 #310000,0 0 24px #ff2020;z-index:8;animation:fat-cue 1.8s both}
  .fatality-blast{position:absolute;left:29%;top:47%;width:42%;height:14%;transform-origin:left center;z-index:3;opacity:0;animation:fat-blast 1.2s 1.65s both}
  .fatality-pyroblast .fatality-blast{background:linear-gradient(90deg,#fff7a8,#ff9b19 22%,#f0260a 62%,transparent);filter:blur(4px);box-shadow:0 0 45px #ff4200}
  .fatality-frost .fatality-blast{background:linear-gradient(90deg,#fff,#9eeeff 28%,#2d9fff 68%,transparent);filter:blur(3px);box-shadow:0 0 50px #7cecff}
  .fatality-burst{position:absolute;right:18%;top:37%;width:200px;height:200px;border-radius:50%;opacity:0;z-index:5;animation:fat-burst .8s 2.35s both}
  .fatality-pyroblast .fatality-burst{background:radial-gradient(circle,#fff 0,#ffcc38 16%,#ff3b0a 42%,transparent 72%);box-shadow:0 0 100px #ff2500}
  .fatality-frost .fatality-burst{background:radial-gradient(circle,#fff 0,#bff7ff 18%,#4bbcff 43%,transparent 70%);box-shadow:0 0 100px #67dfff}
  .fatality-pyroblast .fatality-victim{animation:fat-enter .7s both,fat-burn 1.4s 2.15s forwards}.fatality-frost .fatality-victim{animation:fat-enter .7s both,fat-freeze 1.3s 2.05s forwards,fat-shatter .55s 3.15s forwards}
  .fatality-end{position:absolute;inset:auto 0 10%;text-align:center;z-index:10;opacity:0;animation:fat-end 2.5s 3.35s both}.fatality-end strong{display:block;font-size:clamp(68px,10vw,150px);line-height:.8;color:#c30b12;text-shadow:0 5px #310000,0 0 25px #e00}.fatality-end span{display:block;margin-top:20px;font:800 25px Arial;letter-spacing:6px}.fatality-end em{display:block;margin-top:9px;font:700 15px Arial;letter-spacing:5px;color:#aaa}
  .fatality-pyroblast .fatality-end em{color:#ff8c32}.fatality-frost .fatality-end em{color:#83ddff}
  .fatality-impact{animation:fat-shake .45s 2.35s}
  @keyframes fat-dark{0%{opacity:0}8%,88%{opacity:1}100%{opacity:0}}@keyframes fat-enter{from{transform:translateY(90px) scale(.7);opacity:0}to{transform:none;opacity:1}}@keyframes fat-cue{0%{opacity:0;transform:scale(1.5)}18%,65%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.8)}}@keyframes fat-blast{0%{opacity:0;transform:scaleX(.05)}18%,75%{opacity:1;transform:scaleX(1)}100%{opacity:0}}@keyframes fat-burst{0%{opacity:0;transform:scale(.2)}35%{opacity:1;transform:scale(1.6)}100%{opacity:0;transform:scale(2.2)}}@keyframes fat-burn{30%{filter:sepia(1) saturate(5);transform:scale(1.03)}70%{filter:brightness(.08) sepia(1);transform:scale(.92)}100%{opacity:0;filter:brightness(0);transform:scale(.55) translateY(80px)}}@keyframes fat-freeze{to{filter:grayscale(.2) brightness(1.45) sepia(.1) hue-rotate(155deg) saturate(3);box-shadow:0 0 50px #8de8ff}}@keyframes fat-shatter{to{opacity:0;transform:scale(1.7) rotate(8deg);filter:blur(10px) brightness(2)}}@keyframes fat-end{0%{opacity:0;transform:scale(1.3)}15%,75%{opacity:1;transform:scale(1)}100%{opacity:0}}@keyframes fat-shake{0%,100%{transform:none}20%{transform:translate(-12px,7px)}40%{transform:translate(10px,-8px)}60%{transform:translate(-8px,-4px)}80%{transform:translate(6px,5px)}}
  @media(prefers-reduced-motion:reduce){.fatality-layer *{animation-duration:.01ms!important;animation-delay:0s!important}}
  `;
  document.head.appendChild(style);
  window.Fatality = Object.freeze({play});
})();