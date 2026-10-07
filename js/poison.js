(() => {
  'use strict';

  let states = {};
  let lastTickFlash = 0;
  let gmOffer = null;
  let observer = null;
  let countdownTimer = null;
  let gmTargets = [];
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
      .poison-cast-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:2147482460;padding:11px 16px;border:1px solid #4fbf2b;background:#081007;color:#b9ff90;font:900 12px/1 Arial;letter-spacing:.1em;box-shadow:0 0 22px rgba(73,255,47,.18)}
    `;
    document.head.appendChild(style);
  }

  function decorate() {
    ensureStyle();
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
        <div><b>POISON TARGET</b><small>REGISTERED LITTLE HEROES // ONLINE OR OFFLINE</small></div>
        <button type="button" class="poison-picker-close" aria-label="Close">×</button>
      </div>
      <input class="poison-picker-search" type="search" placeholder="SEARCH LITTLE HERO..." autocomplete="off">
      <div class="poison-target-list"></div>`;
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
    list.innerHTML = filtered.map(target => {
      const avatar = target.avatarData || ASSETS.status;
      const status = target.online ? 'ONLINE' : 'OFFLINE';
      return `<button type="button" class="poison-target-option" data-poison-target-id="${esc(target.id)}">
        <img src="${esc(avatar)}" alt="">
        <span><b>${esc(target.name)}</b><small>ACCOUNT TARGET</small></span>
        <strong class="${target.online ? 'online' : 'offline'}">${status}</strong>
      </button>`;
    }).join('');
  }

  function castAtTarget(playerId) {
    if (gmCasting || !playerId || !window.App?.send) return;
    gmCasting = true;
    document.querySelectorAll('.poison-target-option').forEach(button => { button.disabled = true; });
    window.App.send({ type:'gm:poisonCast', playerId:String(playerId) });
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
    states = message?.poison && typeof message.poison === 'object' ? message.poison : {};
    decorate();
    updateGmBadges();
    renderPlayer();
  }

  function onMessage(message) {
    if (!message) return;
    if (message.type === 'gm:poisonTargets') {
      gmTargets = Array.isArray(message.targets) ? message.targets : [];
      gmCasting = false;
      if (gmPickerOpen) renderGmTargets();
      return;
    }
    if (message.type === 'gm:poisonCastResult') {
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
        castAtTarget(target.dataset.poisonTargetId);
        return;
      }
      if (gmPickerOpen) {
        const picker = document.getElementById('poison-target-picker');
        if (picker && !picker.contains(event.target)) closeGmPicker();
      }
    });
    window.addEventListener('resize', () => { if (gmPickerOpen) positionGmPicker(); });
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
