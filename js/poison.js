(() => {
  'use strict';

  let states = {};
  let lastTickFlash = 0;
  let gmOffer = null;
  let observer = null;
  let countdownTimer = null;
  let gmTargets = [];
  let gmSelected = new Set();   // ids ticked in the picker
  let gmCastArmed = false;      // footer button waiting for its confirming second click
  let gmArmTimer = null;
  let gmQueue = [];             // ids still waiting for their gm:poisonCast
  let gmQueueTotal = 0;
  let gmQueueDone = { ok: [], fail: [] };
  let gmQueueWatch = null;
  let gmPickerOpen = false;
  let gmCasting = false;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const me = () => String(window.PlayerApp?.playerId || '');
  const ASSET_ROOT = 'assets/skills/poison/';
  const ASSETS = Object.freeze({
    command: ASSET_ROOT + 'poison-command.webp',
    status: ASSET_ROOT + 'poison-status.webp',
    failed: ASSET_ROOT + 'poison-failed-roll.webp',
    tribute: ASSET_ROOT + 'poison-tribute.webp',
    timer: ASSET_ROOT + 'poison-timer.webp'
  });

  function ensureStyle() {
    if (document.getElementById('asoc-poison-css')) return;
    const style = document.createElement('style');
    style.id = 'asoc-poison-css';
    style.textContent = `
      [data-player-id].asoc-poisoned{position:relative;isolation:isolate}
      [data-player-id].asoc-poisoned img{filter:hue-rotate(55deg) saturate(2.2) brightness(.82) contrast(1.08)!important}
      [data-player-id].asoc-poisoned img.poison-status-icon,[data-player-id].asoc-poisoned .poison-gm-badge img{filter:none!important}
      [data-player-id].asoc-poisoned::before,
      [data-player-id].asoc-poisoned::after{content:"";position:absolute;pointer-events:none;z-index:20;border-radius:50%;background:radial-gradient(circle at 35% 30%,#d9ff72 0 16%,#6fd629 28%,#1b6f17 67%,transparent 72%);box-shadow:0 0 8px #79ff39;animation:poison-bubble 1.9s infinite ease-in}
      [data-player-id].asoc-poisoned::before{width:12px;height:12px;left:8%;bottom:8%;animation-delay:-.4s}
      [data-player-id].asoc-poisoned::after{width:8px;height:8px;right:14%;bottom:4%;animation-delay:-1.15s}
      [data-player-id].asoc-poisoned{box-shadow:0 0 0 1px rgba(109,255,57,.22),0 0 18px rgba(71,214,37,.25)}
      @keyframes poison-bubble{0%{transform:translateY(0) scale(.55);opacity:0}18%{opacity:.9}78%{opacity:.75}100%{transform:translateY(-42px) scale(1.3);opacity:0}}
      .poison-doom-pulse{animation:poison-doom .55s ease}
      @keyframes poison-doom{0%,100%{filter:none}45%{filter:sepia(1) hue-rotate(45deg) saturate(4) brightness(.8)}}
      #poison-player-overlay,#poison-gm-offer{position:fixed;inset:0;z-index:2147482200;display:grid;place-items:center;background:rgba(0,7,0,.72);backdrop-filter:blur(5px)}
      #poison-player-overlay[hidden],#poison-gm-offer[hidden]{display:none!important}
      .poison-card{width:min(560px,92vw);border:1px solid #4fbf2b;background:linear-gradient(155deg,#09100a,#111a0d 58%,#071007);box-shadow:0 0 0 1px #162a12 inset,0 0 45px rgba(73,255,47,.18);padding:24px;color:#e9f8e4;font-family:Arial,sans-serif;position:relative;overflow:hidden}
      .poison-card::before{content:"";position:absolute;inset:-30%;background:radial-gradient(circle,rgba(80,255,55,.1),transparent 58%);animation:poison-haze 4s infinite alternate}
      @keyframes poison-haze{to{transform:translate(7%,5%) scale(1.08)}}
      .poison-card>*{position:relative;z-index:2}.poison-kicker{font:800 12px/1 Arial;letter-spacing:.24em;color:#77e746}.poison-card h2{margin:9px 0 7px;font:900 clamp(32px,6vw,58px)/.95 Impact,Arial Black,sans-serif;letter-spacing:.06em;color:#a8ff70;text-shadow:0 0 18px #2c8e1e}.poison-card p{line-height:1.45;color:#b8c8b2}.poison-status{margin:16px 0;padding:12px;border:1px solid #325d26;background:#071006;font-weight:800;letter-spacing:.08em}.poison-actions{display:flex;gap:10px;flex-wrap:wrap}.poison-actions button,.poison-upload-label{border:1px solid #64ce3e;background:#13230f;color:#dfffd0;padding:10px 14px;font-weight:900;letter-spacing:.08em;cursor:pointer}.poison-actions button:hover,.poison-upload-label:hover{background:#1d3615}.poison-upload-label input{display:none}.poison-small{font-size:12px;color:#7e9678}.poison-image{display:block;width:min(420px,80vw);max-height:50vh;object-fit:contain;margin:14px auto;border:1px solid #426c31;background:#000}.poison-loss{color:#b8ff82}.poison-dot-float{position:absolute;left:50%;top:0;z-index:50;transform:translate(-50%,0);font:900 13px/1 Arial;color:#b8ff82;text-shadow:0 0 8px #1b6f17,0 2px 3px #000;pointer-events:none;animation:poison-float 1.35s ease-out forwards}@keyframes poison-float{0%{opacity:0;transform:translate(-50%,12px) scale(.75)}15%{opacity:1}100%{opacity:0;transform:translate(-50%,-42px) scale(1.18)}}
      .poison-gm-badge{display:inline-grid;place-items:center;margin-left:7px;width:25px;height:25px;padding:1px;border:1px solid #5ed338;border-radius:6px;background:#0b1908;box-shadow:0 0 10px rgba(82,255,52,.22);cursor:help;overflow:hidden}
      .poison-gm-badge img{width:100%;height:100%;object-fit:cover;border-radius:4px;filter:none!important}
      .gm-command-icon-image{width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid rgba(115,255,72,.45);box-shadow:0 0 12px rgba(86,255,55,.3);filter:none!important}
      .poison-state-icon{display:block;width:66px;height:66px;object-fit:cover;margin:8px auto 14px;border-radius:10px;border:1px solid #4fbf2b;box-shadow:0 0 20px rgba(73,255,47,.28);filter:none!important}
      .poison-inline-icon{width:27px;height:27px;object-fit:cover;border-radius:5px;vertical-align:middle;margin-right:8px;border:1px solid rgba(115,255,72,.35);filter:none!important}
      .poison-status-icon{position:absolute;right:-5px;top:-5px;z-index:45;width:23px;height:23px;object-fit:cover;border-radius:6px;border:1px solid #76e64d;box-shadow:0 0 9px #3ebd27;filter:none!important;pointer-events:none}
      .poison-ceremony-icon{display:block;width:86px;height:86px;object-fit:cover;margin:0 auto 18px;border-radius:11px;border:1px solid currentColor;box-shadow:0 0 26px currentColor;filter:none!important}
      .poison-cast-layer{position:fixed;inset:0;z-index:2147482300;pointer-events:none;overflow:hidden}
      .poison-cast-dagger{position:absolute;left:var(--sx);top:var(--sy);width:90px;height:7px;transform-origin:left center;transform:rotate(var(--ang));background:linear-gradient(90deg,transparent,#15340f 20%,#7dff4d 72%,#eaffdc);box-shadow:0 0 10px #6dff42,0 0 24px rgba(86,255,55,.7);clip-path:polygon(0 42%,78% 42%,100% 0,91% 50%,100% 100%,78% 58%,0 58%);animation:poison-dagger-flight .72s cubic-bezier(.18,.8,.2,1) forwards}
      .poison-cast-dagger::after{content:"";position:absolute;inset:-10px -15px;background:radial-gradient(circle at 85% 50%,rgba(120,255,70,.8),transparent 38%);filter:blur(4px)}
      .poison-target-struck{animation:poison-target-hit .6s ease}
      @keyframes poison-dagger-flight{0%{opacity:0;transform:translate(0,0) rotate(var(--ang)) scaleX(.35)}12%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--ang)) scaleX(1.25)}}
      @keyframes poison-target-hit{0%,100%{filter:none}35%{filter:hue-rotate(55deg) saturate(3) brightness(1.15);transform:scale(1.06)}60%{filter:hue-rotate(55deg) saturate(3.5) brightness(.78)}}
      .poison-roll-ceremony{position:fixed;inset:0;z-index:2147482350;display:grid;place-items:center;pointer-events:none;background:radial-gradient(circle at 50% 50%,rgba(7,22,5,.52),rgba(0,0,0,.72));animation:poison-roll-bg 1.9s both}
      .poison-roll-box{text-align:center;font-family:Arial,sans-serif;color:#e9f8e4;animation:poison-roll-pop 1.9s both}
      .poison-roll-number{display:block;font:900 clamp(110px,18vw,240px)/.8 Impact,Arial Black,sans-serif;letter-spacing:.02em;text-shadow:0 0 28px currentColor,0 8px 0 #071007}
      .poison-roll-label{display:block;margin-top:22px;font:900 clamp(22px,3vw,42px)/1 Arial;letter-spacing:.14em}
      .poison-roll-ceremony.success .poison-roll-number,.poison-roll-ceremony.success .poison-roll-label{color:#a9ff79}.poison-roll-ceremony.fail .poison-roll-number,.poison-roll-ceremony.fail .poison-roll-label{color:#ff6b59}
      @keyframes poison-roll-bg{0%{opacity:0}12%,78%{opacity:1}100%{opacity:0}}@keyframes poison-roll-pop{0%{opacity:0;transform:scale(1.45)}18%{opacity:1;transform:scale(1)}78%{opacity:1}100%{opacity:0;transform:scale(.82)}}
      #poison-gm-button{display:block!important;min-height:74px!important;height:74px!important;padding:0!important;border:1px solid rgba(92,255,61,.36)!important;border-radius:7px!important;background-color:#050805!important;background-image:url("assets/skills/poison/poison-button-face.webp?v=20261007-poison-face-2")!important;background-repeat:no-repeat!important;background-position:center!important;background-size:cover!important;box-shadow:0 0 10px rgba(77,255,46,.10),inset 0 0 14px rgba(77,255,46,.05)!important;overflow:hidden!important;cursor:pointer!important;transition:filter .16s ease,box-shadow .16s ease,border-color .16s ease,transform .10s ease!important}
      #poison-gm-button:hover{filter:brightness(1.08) saturate(1.08)!important;border-color:rgba(126,255,104,.72)!important;box-shadow:0 0 16px rgba(77,255,46,.18),inset 0 0 18px rgba(77,255,46,.08)!important}
      #poison-gm-button:active{transform:translateY(1px) scale(.995)!important;filter:brightness(.96)!important}
      #poison-gm-button.is-armed{filter:brightness(1.12) saturate(1.18)!important;border-color:rgba(145,255,124,.92)!important;box-shadow:0 0 20px rgba(77,255,46,.24),inset 0 0 20px rgba(77,255,46,.10)!important}
      #poison-gm-button>*{display:none!important}
      #poison-target-picker{position:fixed;z-index:2147482450;width:min(420px,92vw);max-height:min(560px,82vh);display:flex;flex-direction:column;border:1px solid #4fbf2b;background:linear-gradient(165deg,#090d08,#11180e);box-shadow:0 24px 70px rgba(0,0,0,.62),0 0 35px rgba(73,255,47,.13);color:#eaf8e5;font-family:Arial,sans-serif}
      #poison-target-picker[hidden]{display:none!important}
      .poison-picker-head{display:grid;grid-template-columns:48px 1fr auto;align-items:center;gap:11px;padding:14px;border-bottom:1px solid #294522}
      .poison-picker-head img{width:46px;height:46px;object-fit:cover;border-radius:8px;border:1px solid #5fc83a}
      .poison-picker-head b{display:block;font:900 18px/1 Arial;letter-spacing:.1em;color:#b8ff87}
      .poison-picker-head small{display:block;margin-top:5px;font:700 10px/1.2 Arial;letter-spacing:.09em;color:#7e9777}
      .poison-picker-close{border:0;background:transparent;color:#8fa389;font-size:24px;cursor:pointer}
      .poison-picker-search{margin:12px 12px 8px;padding:10px 11px;border:1px solid #315126;background:#050805;color:#eaf8e5;outline:none;font:800 13px/1 Arial}
      .poison-picker-search:focus{border-color:#6dd745;box-shadow:0 0 12px rgba(94,228,56,.12)}
      .poison-target-list{overflow:auto;padding:4px 10px 12px;display:grid;gap:7px}
      .poison-target-option{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:10px;width:100%;padding:8px 10px;border:1px solid #253c20;background:#0b100a;color:#e9f8e4;text-align:left;cursor:pointer}
      .poison-target-option:hover{border-color:#5fc83a;background:#10190e}
      .poison-target-option img{width:40px;height:40px;object-fit:cover;border-radius:50%;border:1px solid #3f6335}
      .poison-target-option b{font:900 13px/1 Arial;letter-spacing:.06em}
      .poison-target-option small{display:block;margin-top:4px;font:700 9px/1 Arial;letter-spacing:.1em;color:#70826b}
      .poison-target-option .online{color:#82ff68}.poison-target-option .offline{color:#737d70}
      .poison-picker-empty{padding:28px 12px;text-align:center;color:#768271;font-weight:800;letter-spacing:.08em}
      #poison-gm-button{position:relative!important}
      #poison-gm-button::after{position:absolute;left:32%;right:5%;text-align:center;pointer-events:none;font-family:Arial,sans-serif;text-transform:uppercase;transition:text-shadow .16s ease,opacity .16s ease,color .16s ease}
      #poison-gm-button::after{content:'POISON';top:50%;transform:translateY(-50%);font-weight:900;font-size:clamp(17px,2.3vw,25px);line-height:1;letter-spacing:.34em;padding-left:.34em;color:#ecffd9;text-shadow:0 0 6px rgba(120,255,70,.95),0 0 18px rgba(77,255,46,.7),0 2px 3px #000}
      #poison-gm-button:hover::after,#poison-gm-button:focus-visible::after,#poison-gm-button.is-armed::after{color:#fff;text-shadow:0 0 8px #b8ff87,0 0 26px rgba(95,255,60,.95),0 2px 3px #000}
      #poison-gm-button:focus-visible{outline:2px solid #8dff6a!important;outline-offset:2px}
      .poison-target-group{display:flex;align-items:center;gap:8px;margin:6px 2px 0;font:900 10px/1 Arial,sans-serif;letter-spacing:.16em;color:#82ff68}
      .poison-target-group::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,#2f5a24,transparent)}
      .poison-target-group.is-offline{color:#737d70}.poison-target-group.is-offline::after{background:linear-gradient(90deg,#2b3228,transparent)}
      .poison-target-option{grid-template-columns:22px 42px 1fr auto!important}
      .poison-target-option.is-offline{opacity:.72}
      .poison-check{width:18px;height:18px;border:1px solid #3f6335;border-radius:3px;background:#050805;display:grid;place-items:center;color:transparent;font:900 12px/1 Arial,sans-serif}
      .poison-target-option.is-selected{border-color:#6dd745;background:linear-gradient(90deg,#13230f,#0d150b);box-shadow:0 0 14px rgba(94,228,56,.16)}
      .poison-target-option.is-selected.is-offline{opacity:1}
      .poison-target-option.is-selected .poison-check{border-color:#8dff6a;background:#2a5d1c;color:#d8ffc8}
      .poison-target-option .poison-tag{display:inline-block;margin-left:7px;padding:2px 5px;border:1px solid #6dd745;color:#b8ff87;font:900 8px/1 Arial,sans-serif;letter-spacing:.12em;vertical-align:1px}
      .poison-picker-foot{display:grid;gap:8px;padding:10px 12px 12px;border-top:1px solid #294522;background:#070b06}
      .poison-picker-tools{display:flex;gap:8px}
      .poison-picker-tools button{flex:1;padding:8px 6px;border:1px solid #2f5a24;background:#0b100a;color:#9fd88a;font:900 10px/1 Arial,sans-serif;letter-spacing:.12em;cursor:pointer}
      .poison-picker-tools button:hover{border-color:#6dd745;color:#d8ffc8}
      .poison-cast-btn{padding:13px 10px;border:1px solid #4fbf2b;background:linear-gradient(180deg,#1b3a12,#0e2009);color:#d8ffc8;font:900 12px/1 Arial,sans-serif;letter-spacing:.16em;cursor:pointer}
      .poison-cast-btn:disabled{opacity:.4;cursor:not-allowed;border-color:#2b4a22}
      .poison-cast-btn.is-armed{border-color:#ff5a4d;background:linear-gradient(180deg,#5a1410,#2a0a08);color:#ffe3df;box-shadow:0 0 18px rgba(255,70,52,.3)}
      .poison-cast-btn.is-casting{border-color:#8dff6a;color:#b8ff87}
      .poison-cast-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:2147482460;padding:11px 16px;border:1px solid #4fbf2b;background:#081007;color:#b9ff90;font:900 12px/1 Arial;letter-spacing:.1em;box-shadow:0 0 22px rgba(73,255,47,.18)}
      .asoc-poison-avatar{position:relative;animation:poison-avatar-pulse 1.8s ease-in-out infinite}
      .asoc-poison-avatar img{filter:hue-rotate(75deg) saturate(2.6) sepia(.35) brightness(.92) contrast(1.1)!important}
      .asoc-poison-avatar .little-hero-avatar-fallback{color:#caff9a!important}
      .poison-acid{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:6;mix-blend-mode:screen;background:radial-gradient(circle at 50% 125%,rgba(130,255,60,.4),rgba(60,200,30,.18) 55%,transparent 72%);box-shadow:inset 0 0 0 2px rgba(110,255,60,.85),inset 0 0 10px rgba(110,255,60,.75)}
      .poison-acid s{position:absolute;bottom:-20%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 35% 30%,#efffb0 0 14%,#8bff3f 30%,rgba(40,160,20,.55) 62%,rgba(190,255,120,.16) 72%);box-shadow:0 0 5px #8bff3f;animation:poison-acid-rise var(--t,2.2s) var(--d,0s) infinite ease-in}
      .poison-acid s:nth-child(1){left:10%;width:20%;--t:2.1s;--d:-.2s}
      .poison-acid s:nth-child(2){left:34%;width:14%;--t:1.7s;--d:-1.1s}
      .poison-acid s:nth-child(3){left:54%;width:24%;--t:2.5s;--d:-.7s}
      .poison-acid s:nth-child(4){left:76%;width:13%;--t:1.9s;--d:-1.5s}
      .poison-acid s:nth-child(5){left:22%;width:11%;--t:1.5s;--d:-.4s}
      .poison-acid s:nth-child(6){left:66%;width:16%;--t:2.3s;--d:-1.9s}
      @keyframes poison-acid-rise{0%{transform:translateY(0) scale(.5);opacity:0}15%{opacity:.95}70%{opacity:.85}100%{transform:translateY(-430%) scale(1.15);opacity:0}}
      @keyframes poison-avatar-pulse{0%,100%{filter:drop-shadow(0 0 2px rgba(98,255,58,.55))}50%{filter:drop-shadow(0 0 8px rgba(125,255,73,.95))}}
      .asoc-poison-avatar.poison-avatar-hit{animation:poison-avatar-hit .9s ease-out,poison-avatar-pulse 1.8s .9s ease-in-out infinite}
      @keyframes poison-avatar-hit{0%{transform:scale(1.2);filter:brightness(2.2) saturate(3) hue-rotate(60deg)}40%{transform:scale(.94)}100%{transform:scale(1)}}
      @media (prefers-reduced-motion:reduce){.poison-acid s,.asoc-poison-avatar{animation:none!important}}
    `;
    document.head.appendChild(style);
  }

  // Every avatar of a poisoned hero (chat, rosters, seats) turns acid green with rising bubbles.
  function decorateAvatars() {
    const byName = new Map();
    Object.values(states).forEach(s => { const n = String(s?.playerName || '').trim(); if (n) byName.set(n, s); });
    document.querySelectorAll('.little-hero-avatar').forEach(node => {
      let state = null;
      const alt = node.querySelector(':scope > img')?.getAttribute('alt') || '';
      const name = alt.replace(/ avatar$/, '').trim();
      if (name) state = byName.get(name) || null;
      else {
        const holder = node.closest('[data-player-id]:not(button)');
        if (holder) state = states[String(holder.getAttribute('data-player-id') || '')] || null;
      }
      const was = node.classList.contains('asoc-poison-avatar');
      if (state && !was) {
        node.classList.add('asoc-poison-avatar', 'poison-avatar-hit');
        setTimeout(() => node.classList.remove('poison-avatar-hit'), 1000);
      } else if (!state && was) {
        node.classList.remove('asoc-poison-avatar', 'poison-avatar-hit');
      }
      const layer = node.querySelector(':scope > .poison-acid');
      if (state && !layer) {
        const acid = document.createElement('i');
        acid.className = 'poison-acid';
        acid.setAttribute('aria-hidden', 'true');
        acid.innerHTML = '<s></s><s></s><s></s><s></s><s></s><s></s>';
        node.appendChild(acid);
      } else if (!state && layer) {
        layer.remove();
      }
    });
  }

  function decorate() {
    ensureStyle();
    decorateAvatars();
    document.querySelectorAll('[data-player-id]:not(button)').forEach(node => {
      const id = String(node.getAttribute('data-player-id') || '');
      const state = states[id];
      node.classList.toggle('asoc-poisoned', !!state);
      if (state) node.dataset.poisonStatus = state.status || '';
      else delete node.dataset.poisonStatus;

      if (node.matches('.pl-entry[data-player-id]')) {
        let icon = node.querySelector(':scope > .poison-status-icon');
        if (state && !icon) {
          icon = document.createElement('img');
          icon.className = 'poison-status-icon';
          icon.src = ASSETS.status;
          icon.alt = '';
          icon.title = 'POISONED';
          node.appendChild(icon);
        } else if (!state) {
          icon?.remove();
        }
      }
    });
  }

  function updateGmBadges() {
    if (!window.App?.send) return;
    document.querySelectorAll('.mp-player[data-player-id]').forEach(row => {
      const id = String(row.getAttribute('data-player-id') || '');
      const state = states[id];
      let badge = row.querySelector(':scope > .poison-gm-badge');
      if (!state) {
        badge?.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'poison-gm-badge';
        badge.innerHTML = `<img src="${ASSETS.status}" alt="">`;
        row.appendChild(badge);
      }
      const next = state.status === 'bleeding' && state.nextTickAt
        ? Math.max(0, Math.ceil((Number(state.nextTickAt) - Date.now()) / 1000))
        : null;
      const lost = Number(state.totalLost || 0).toFixed(1);
      badge.title = state.status === 'awaiting_roll'
        ? `POISONED // AWAITING SAVE // ${lost} SC LOST`
        : `BLEEDING // NEXT TICK ${next}s // ${lost} SC LOST`;
    });
  }

  function targetNode(playerId) {
    const nodes = [...document.querySelectorAll('[data-player-id]:not(button)')];
    return nodes.find(node => String(node.getAttribute('data-player-id') || '') === String(playerId || '')) || null;
  }

  function playCast(message) {
    ensureStyle();
    const target = targetNode(message.playerId);
    const rect = target?.getBoundingClientRect?.();
    const sx = Math.max(20, window.innerWidth * 0.12);
    const sy = window.innerHeight * 0.52;
    const tx = rect ? rect.left + rect.width / 2 : window.innerWidth * 0.72;
    const ty = rect ? rect.top + rect.height / 2 : window.innerHeight * 0.5;
    const dx = tx - sx;
    const dy = ty - sy;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const layer = document.createElement('div');
    layer.className = 'poison-cast-layer';
    layer.innerHTML = '<div class="poison-cast-dagger"></div>';
    const dagger = layer.firstElementChild;
    dagger.style.setProperty('--sx', sx + 'px');
    dagger.style.setProperty('--sy', sy + 'px');
    dagger.style.setProperty('--dx', dx + 'px');
    dagger.style.setProperty('--dy', dy + 'px');
    dagger.style.setProperty('--ang', angle + 'deg');
    document.body.appendChild(layer);
    setTimeout(() => {
      target?.classList.remove('poison-target-struck');
      if (target) { void target.offsetWidth; target.classList.add('poison-target-struck'); }
      window.AsocAudio?.playUi?.('impact');
    }, 560);
    setTimeout(() => {
      target?.classList.remove('poison-target-struck');
      layer.remove();
    }, 1050);
  }

  function showRollCeremony(message, success) {
    const value = Number(message.roll);
    if (!Number.isFinite(value)) return;
    document.querySelector('.poison-roll-ceremony')?.remove();
    const layer = document.createElement('div');
    layer.className = 'poison-roll-ceremony ' + (success ? 'success' : 'fail');
    const icon = success ? ASSETS.status : ASSETS.failed;
    layer.innerHTML = `<div class="poison-roll-box"><img class="poison-ceremony-icon" src="${icon}" alt=""><span class="poison-roll-number">${value}</span><span class="poison-roll-label">${success ? 'VENOM RESISTED // CURED' : 'SAVE FAILED // BLOOD TRIBUTE REQUIRED'}</span></div>`;
    document.body.appendChild(layer);
    window.AsocAudio?.playUi?.(success ? 'success' : 'impact');
    setTimeout(() => layer.remove(), 1950);
  }

  function ensureGmPicker() {
    let root = document.getElementById('poison-target-picker');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'poison-target-picker';
    root.hidden = true;
    root.innerHTML = `
      <div class="poison-picker-head">
        <img src="${ASSETS.command}" alt="">
        <div><b>POISON TARGET</b><small>PICK ONE OR MANY // THEN CAST</small></div>
        <button type="button" class="poison-picker-close" aria-label="Close">×</button>
      </div>
      <input class="poison-picker-search" type="search" placeholder="SEARCH LITTLE HERO..." autocomplete="off">
      <div class="poison-target-list"></div>
      <div class="poison-picker-foot">
        <div class="poison-picker-tools"><button type="button" data-poison-tool="online">SELECT ALL ONLINE</button><button type="button" data-poison-tool="clear">CLEAR</button></div>
        <button type="button" class="poison-cast-btn" data-poison-cast disabled>SELECT A TARGET</button>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('.poison-picker-close')?.addEventListener('click', closeGmPicker);
    root.querySelector('.poison-picker-search')?.addEventListener('input', renderGmTargets);
    return root;
  }

  function positionGmPicker() {
    const root = ensureGmPicker();
    const button = document.getElementById('poison-gm-button');
    const rect = button?.getBoundingClientRect?.();
    const width = Math.min(420, window.innerWidth * 0.92);
    const left = rect ? Math.min(window.innerWidth - width - 16, Math.max(16, rect.right + 12)) : Math.max(16, (window.innerWidth - width) / 2);
    const top = rect ? Math.min(window.innerHeight - 220, Math.max(16, rect.top)) : 80;
    root.style.left = left + 'px';
    root.style.top = top + 'px';
  }

  function openGmPicker() {
    if (!window.App?.send) return;
    const root = ensureGmPicker();
    gmPickerOpen = true;
    gmTargets = [];
    resetGmSelection();
    document.getElementById('poison-gm-button')?.classList.add('is-armed');
    root.hidden = false;
    positionGmPicker();
    const list = root.querySelector('.poison-target-list');
    if (list) list.innerHTML = '<div class="poison-picker-empty">FETCHING LITTLE HEROES...</div>';
    window.App.send({ type:'gm:poisonTargets' });
    setTimeout(() => root.querySelector('.poison-picker-search')?.focus(), 0);
  }

  function closeGmPicker() {
    gmPickerOpen = false;
    gmCasting = false;
    resetGmSelection();
    stopGmQueue();
    document.getElementById('poison-gm-button')?.classList.remove('is-armed');
    const root = document.getElementById('poison-target-picker');
    if (root) root.hidden = true;
  }

  function renderGmTargets() {
    const root = ensureGmPicker();
    const list = root.querySelector('.poison-target-list');
    const query = String(root.querySelector('.poison-picker-search')?.value || '').trim().toLocaleLowerCase();
    const filtered = gmTargets.filter(target => !query || String(target.name || '').toLocaleLowerCase().includes(query));
    if (!filtered.length) {
      list.innerHTML = '<div class="poison-picker-empty">NO LITTLE HEROES FOUND</div>';
      return;
    }
    const row = target => {
      const avatar = target.avatarData || ASSETS.status;
      const id = String(target.id);
      const picked = gmSelected.has(id);
      const poisoned = !!states[id];
      const status = picked ? 'SELECTED' : (target.online ? 'ONLINE' : 'OFFLINE');
      const note = poisoned ? 'ALREADY POISONED // CASTING RENEWS IT' : 'ACCOUNT TARGET';
      return `<button type="button" class="poison-target-option${picked ? ' is-selected' : ''}${target.online ? '' : ' is-offline'}" data-poison-target-id="${esc(id)}" aria-pressed="${picked}">
        <span class="poison-check" aria-hidden="true">✓</span>
        <img src="${esc(avatar)}" alt="">
        <span><b>${esc(target.name)}${poisoned ? '<i class="poison-tag">POISONED</i>' : ''}</b><small>${note}</small></span>
        <strong class="${target.online ? 'online' : 'offline'}">${status}</strong>
      </button>`;
    };
    const online = filtered.filter(target => target.online);
    const offline = filtered.filter(target => !target.online);
    list.innerHTML = (online.length ? `<div class="poison-target-group">ONLINE // ${online.length}</div>${online.map(row).join('')}` : '')
      + (offline.length ? `<div class="poison-target-group is-offline">OFFLINE // ${offline.length}</div>${offline.map(row).join('')}` : '');
    syncGmFoot();
  }

  function resetGmSelection() {
    clearTimeout(gmArmTimer);
    gmArmTimer = null;
    gmCastArmed = false;
    gmSelected = new Set();
    syncGmFoot();
  }

  function syncGmFoot() {
    const btn = document.querySelector('#poison-target-picker .poison-cast-btn');
    if (!btn) return;
    const n = gmSelected.size;
    btn.classList.toggle('is-armed', gmCastArmed && !gmCasting);
    btn.classList.toggle('is-casting', gmCasting);
    btn.disabled = !gmCasting && n === 0;
    if (gmCasting) btn.textContent = `CASTING ${Math.min(gmQueueTotal, gmQueueDone.ok.length + gmQueueDone.fail.length + 1)} OF ${gmQueueTotal}...`;
    else if (!n) btn.textContent = 'SELECT A TARGET';
    else if (gmCastArmed) btn.textContent = `CLICK AGAIN: POISON ${n} ${n === 1 ? 'HERO' : 'HEROES'}`;
    else btn.textContent = `POISON ${n} ${n === 1 ? 'HERO' : 'HEROES'}`;
  }

  function toggleGmTarget(playerId) {
    const id = String(playerId || '');
    if (!id || gmCasting) return;
    if (gmSelected.has(id)) gmSelected.delete(id); else gmSelected.add(id);
    gmCastArmed = false;
    clearTimeout(gmArmTimer);
    renderGmTargets();
  }

  function gmTool(kind) {
    if (gmCasting) return;
    if (kind === 'clear') gmSelected = new Set();
    if (kind === 'online') {
      const query = String(document.querySelector('#poison-target-picker .poison-picker-search')?.value || '').trim().toLocaleLowerCase();
      gmTargets.filter(t => t.online && (!query || String(t.name || '').toLocaleLowerCase().includes(query))).forEach(t => gmSelected.add(String(t.id)));
    }
    gmCastArmed = false;
    clearTimeout(gmArmTimer);
    renderGmTargets();
  }

  // Casting at several heroes is a fair-sized act: the first click arms the button, the second sends.
  function pressGmCast() {
    if (gmCasting || !gmSelected.size) return;
    if (!gmCastArmed) {
      gmCastArmed = true;
      syncGmFoot();
      clearTimeout(gmArmTimer);
      gmArmTimer = setTimeout(() => { gmCastArmed = false; syncGmFoot(); }, 4000);
      return;
    }
    clearTimeout(gmArmTimer);
    gmCastArmed = false;
    startGmQueue([...gmSelected]);
  }

  // The server casts one target per message, so a multi-cast is a short, spaced-out queue.
  function startGmQueue(ids) {
    if (!window.App?.send || !ids.length) return;
    gmQueue = ids.slice();
    gmQueueTotal = ids.length;
    gmQueueDone = { ok: [], fail: [] };
    gmCasting = true;
    document.querySelectorAll('.poison-target-option').forEach(button => { button.disabled = true; });
    syncGmFoot();
    sendNextGmCast();
  }

  function sendNextGmCast() {
    clearTimeout(gmQueueWatch);
    if (!gmQueue.length) return finishGmQueue();
    const id = gmQueue.shift();
    syncGmFoot();
    gmQueueWatch = setTimeout(() => noteGmCastResult({ ok: false, error: 'NO ANSWER', playerId: id }), 8000);
    window.App.send({ type:'gm:poisonCast', playerId:String(id) });
  }

  function noteGmCastResult(message) {
    clearTimeout(gmQueueWatch);
    if (message.ok) gmQueueDone.ok.push(String(message.playerName || message.playerId || 'TARGET'));
    else gmQueueDone.fail.push(String(message.error || 'POISON CAST REJECTED'));
    if (gmQueue.length) setTimeout(() => { if (gmCasting) sendNextGmCast(); }, 700);
    else finishGmQueue();
  }

  function finishGmQueue() {
    const done = gmQueueDone;
    stopGmQueue();
    closeGmPicker();
    const total = done.ok.length + done.fail.length;
    if (total <= 1) {
      if (done.ok.length) showGmToast(`POISON CAST // ${done.ok[0]}`);
      else showGmToast(done.fail[0] || 'POISON CAST REJECTED', true);
    } else if (!done.fail.length) showGmToast(`POISON CAST // ${done.ok.length} HEROES`);
    else showGmToast(`POISON CAST // ${done.ok.length} OF ${total} // ${done.fail[0]}`, !done.ok.length);
  }

  function stopGmQueue() {
    clearTimeout(gmQueueWatch);
    gmQueue = [];
    gmQueueTotal = 0;
    gmQueueDone = { ok: [], fail: [] };
    gmCasting = false;
  }

  function showGmToast(text, bad = false) {
    document.querySelector('.poison-cast-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'poison-cast-toast';
    if (bad) {
      toast.style.borderColor = '#b94b43';
      toast.style.color = '#ff8b80';
    }
    toast.textContent = String(text || '');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  function ensurePlayerOverlay() {
    let root = document.getElementById('poison-player-overlay');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'poison-player-overlay';
    root.hidden = true;
    root.innerHTML = '<div class="poison-card" id="poison-player-card"></div>';
    document.body.appendChild(root);
    return root;
  }

  function renderPlayer() {
    const root = ensurePlayerOverlay();
    const state = states[me()];
    if (!state) { root.hidden = true; return; }
    const card = root.querySelector('#poison-player-card');
    if (!card) return;
    root.hidden = false;
    if (state.status === 'awaiting_roll') {
      card.innerHTML = `
        <div class="poison-kicker">SHADOW BROKER // VENOM</div>
        <img class="poison-state-icon" src="${ASSETS.status}" alt="Poison">
        <h2>YOU HAVE BEEN POISONED</h2>
        <p>You get exactly one survival check. No rerolls. No custom range. No courtroom appeals.</p>
        <div class="poison-status">TYPE <b>/roll</b> // 50+ CURES // 1–49 FAILS</div>
        <div class="poison-actions"><button type="button" data-poison-roll>ROLL FOR CURE</button></div>
        <p class="poison-small">Failing the save begins a 0.1 Shadow Coin bleed every 20 seconds.</p>`;
      card.querySelector('[data-poison-roll]')?.addEventListener('click', () => {
        window.PlayerApp?.send?.({ type:'chat:guess', text:'/roll' });
      });
      return;
    }
    const remaining = Math.max(0, Math.ceil((Number(state.nextTickAt || 0) - Date.now()) / 1000));
    card.innerHTML = `
      <div class="poison-kicker">SURVIVAL CHECK FAILED</div>
      <img class="poison-state-icon" src="${ASSETS.tribute}" alt="Blood Tribute cure">
      <h2>THE VENOM REMAINS</h2>
      <p class="poison-loss">You bleed <b>0.1 SC every 20 seconds</b> until the Shadow Broker accepts your Blood Tribute.</p>
      <div class="poison-status"><img class="poison-inline-icon" src="${ASSETS.timer}" alt="">NEXT BLEED // <span data-poison-countdown>${remaining}s</span>${state.pendingTribute ? ' // TRIBUTE AWAITS JUDGMENT' : ''}</div>
      ${state.pendingTribute ? '<p>Your offering is before the Broker. The poison does not pause while you wait.</p>' : `
      <div class="poison-actions">
        <label class="poison-upload-label">CHOOSE BLOOD TRIBUTE<input data-poison-file type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button type="button" data-poison-submit>OFFER TRIBUTE</button>
      </div>
      <p class="poison-small" data-poison-file-name>PNG, JPG or WEBP // 2 MB max</p>`}
    `;
    if (!state.pendingTribute) {
      const file = card.querySelector('[data-poison-file]');
      file?.addEventListener('change', () => {
        const n = card.querySelector('[data-poison-file-name]');
        if (n) n.textContent = file.files?.[0]?.name || 'PNG, JPG or WEBP // 2 MB max';
      });
      card.querySelector('[data-poison-submit]')?.addEventListener('click', submitTribute);
    }
  }

  function submitTribute() {
    const file = document.querySelector('#poison-player-card [data-poison-file]')?.files?.[0];
    const note = document.querySelector('#poison-player-card [data-poison-file-name]');
    if (!file) { if (note) note.textContent = 'NO IMAGE SELECTED'; return; }
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { if (note) note.textContent = 'PNG, JPG OR WEBP ONLY'; return; }
    if (file.size > 2 * 1024 * 1024) { if (note) note.textContent = 'IMAGE TOO LARGE // 2 MB MAX'; return; }
    if (note) note.textContent = 'TRANSMITTING BLOOD TRIBUTE...';
    const reader = new FileReader();
    reader.onload = () => {
      const imageData = String(reader.result || '');
      if (!imageData.startsWith('data:image/')) { if (note) note.textContent = 'IMAGE COULD NOT BE READ'; return; }
      window.PlayerApp?.send?.({ type:'poison:tributeSubmit', imageData, retentionAcknowledged:true });
    };
    reader.onerror = () => { if (note) note.textContent = 'IMAGE COULD NOT BE READ'; };
    reader.readAsDataURL(file);
  }

  function ensureGmOffer() {
    let root = document.getElementById('poison-gm-offer');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'poison-gm-offer';
    root.hidden = true;
    root.innerHTML = '<div class="poison-card" id="poison-gm-card"></div>';
    document.body.appendChild(root);
    return root;
  }

  function renderGmOffer() {
    const root = ensureGmOffer();
    if (!gmOffer) { root.hidden = true; return; }
    root.hidden = false;
    const card = root.querySelector('#poison-gm-card');
    card.innerHTML = `
      <div class="poison-kicker">BLOOD TRIBUTE // POISON CURE</div>
      <img class="poison-state-icon" src="${ASSETS.tribute}" alt="Poison cure">
      <h2>THE VICTIM SEEKS MERCY</h2>
      <p><b>${esc(gmOffer.playerName || 'LITTLE HERO')}</b> offers blood to stop the venom.</p>
      <img class="poison-image" src="${esc(gmOffer.imageData || '')}" alt="Poison cure Blood Tribute">
      <div class="poison-actions">
        <button type="button" data-poison-accept>ACCEPT // CURE POISON</button>
        <button type="button" data-poison-reject>REJECT // LET IT BLEED</button>
      </div>`;
    card.querySelector('[data-poison-accept]')?.addEventListener('click', () => decide(true));
    card.querySelector('[data-poison-reject]')?.addEventListener('click', () => decide(false));
  }

  function decide(accepted) {
    if (!gmOffer) return;
    window.App?.send?.({ type:'gm:poisonTributeDecision', playerId:gmOffer.playerId, accepted });
    gmOffer = null;
    renderGmOffer();
  }

  function onState(message) {
    window.ChaosGame?.onState?.(message);
    states = message?.poison && typeof message.poison === 'object' ? message.poison : {};
    decorate();
    updateGmBadges();
    renderPlayer();
  }

  function onMessage(message) {
    if (!message) return;
    window.ChaosGame?.onMessage?.(message);
    if (message.type === 'gm:poisonTargets') {
      gmTargets = Array.isArray(message.targets) ? message.targets : [];
      gmCasting = false;
      if (gmPickerOpen) renderGmTargets();
      return;
    }
    if (message.type === 'gm:poisonCastResult') {
      if (gmQueueTotal) { noteGmCastResult(message); return; }
      gmCasting = false;
      if (message.ok) {
        closeGmPicker();
        showGmToast(`POISON CAST // ${message.playerName || 'TARGET'}`);
      } else {
        showGmToast(message.error || 'POISON CAST REJECTED', true);
        document.querySelectorAll('.poison-target-option').forEach(button => { button.disabled = false; });
      }
      return;
    }
    if (message.type === 'poison:applied') playCast(message);
    if (message.type === 'poison:failed') showRollCeremony(message, false);
    if (message.type === 'poison:cured' && message.reason === 'roll') showRollCeremony(message, true);
    if (message.type === 'poison:tributeOffered' && window.App?.send) {
      gmOffer = message;
      renderGmOffer();
      return;
    }
    if (message.type === 'poison:tick') {
      const playerId = String(message.playerId || '');
      const label = Number(message.deducted || 0) > 0 ? '-0.1 SC' : 'NO SC LEFT';
      document.querySelectorAll('[data-player-id]:not(button)').forEach(node => {
        if (String(node.getAttribute('data-player-id') || '') !== playerId) return;
        const floater = document.createElement('span');
        floater.className = 'poison-dot-float';
        floater.textContent = label;
        node.appendChild(floater);
        setTimeout(() => floater.remove(), 1450);
      });
      if (playerId === me()) {
        lastTickFlash = Date.now();
        document.documentElement.classList.remove('poison-doom-pulse');
        void document.documentElement.offsetWidth;
        document.documentElement.classList.add('poison-doom-pulse');
        setTimeout(() => document.documentElement.classList.remove('poison-doom-pulse'), 650);
        window.AsocAudio?.playUi?.('impact');
      }
    }
    if (message.type === 'poison:tributeAcceptedForReview' && String(message.tributeId || '')) {
      const state = states[me()];
      if (state) state.pendingTribute = true;
      renderPlayer();
    }
    if (message.type === 'poison:tributeRejected' && String(message.playerId) === me()) {
      const state = states[me()];
      if (state) state.pendingTribute = false;
      renderPlayer();
    }
  }

  function start() {
    ensureStyle();
    document.addEventListener('click', event => {
      const skill = event.target.closest?.('#poison-gm-button');
      if (skill) {
        event.preventDefault();
        event.stopPropagation();
        openGmPicker();
        return;
      }
      const target = event.target.closest?.('[data-poison-target-id]');
      if (target) {
        event.preventDefault();
        toggleGmTarget(target.dataset.poisonTargetId);
        return;
      }
      const tool = event.target.closest?.('[data-poison-tool]');
      if (tool) { event.preventDefault(); gmTool(tool.dataset.poisonTool); return; }
      if (event.target.closest?.('[data-poison-cast]')) { event.preventDefault(); pressGmCast(); return; }
      if (gmPickerOpen) {
        const picker = document.getElementById('poison-target-picker');
        if (picker && !picker.contains(event.target)) closeGmPicker();
      }
    });
    window.addEventListener('resize', () => { if (gmPickerOpen) positionGmPicker(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && gmPickerOpen) closeGmPicker(); });
    ensureGmPicker();
    decorate();
    observer = new MutationObserver(() => decorate());
    observer.observe(document.documentElement, { childList:true, subtree:true });
    countdownTimer = setInterval(() => {
      updateGmBadges();
      const state = states[me()];
      if (state?.status === 'bleeding') {
        const el = document.querySelector('[data-poison-countdown]');
        if (el) el.textContent = Math.max(0, Math.ceil((Number(state.nextTickAt || 0) - Date.now()) / 1000)) + 's';
      }
    }, 500);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once:true }) : start();
  window.PoisonEffect = Object.freeze({ onState, onMessage, decorate });
})();
