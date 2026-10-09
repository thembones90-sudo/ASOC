/* CHAOS // the Shadow Broker's wager.
   Player side: offer card (30s, ACCEPT / REJECT), the forced /roll card, the Blood Tribute card.
   Shadow Broker side: CHAOS rail button, multi-target picker with roll target + coins, status badges,
   tribute judging. Server messages arrive through poison.js, which forwards every state/message here. */
(() => {
  'use strict';
  if (window.ChaosGame) return;

  const OFFER_MS = 30000;
  const ROLL_MS = 60000;
  const MIN_TARGET = 2;
  const MAX_TARGET = 100;
  const MIN_COINS = 0.1;
  const MAX_COINS = 100;
  const ARM_MS = 3500;

  let states = {};
  let clockOffset = 0;          // server clock minus this browser's clock
  let gmTargets = [];
  let gmSelected = new Set();
  let gmOpen = false;
  let gmArmed = false;
  let gmArmTimer = null;
  let gmSending = false;
  let sendTimer = null;
  let gmOffers = [];            // tributes waiting for the Shadow Broker's verdict
  let withdrawArm = null;       // { id, timer }
  let resultTimer = null;
  let tributeNote = '';
  let tick = null;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => String(window.PlayerApp?.playerId || '');
  const isGm = () => !!window.App?.send;
  const now = () => Date.now() + clockOffset;
  const coinText = n => `${Number(n).toFixed(Number(n) % 1 ? 1 : 0)} SC`;
  const secondsLeft = at => Math.max(0, Math.ceil((Number(at || 0) - now()) / 1000));

  /* ---------- player ---------- */

  function playerRoot() {
    let root = document.getElementById('chaos-player-overlay');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'chaos-player-overlay';
    root.hidden = true;
    root.innerHTML = '<div class="chaos-card" id="chaos-player-card"></div>';
    document.body.appendChild(root);
    return root;
  }

  function stakeLines(entry) {
    return `<ul class="chaos-terms">
      <li><b>ROLL ${entry.target}+</b><span>WIN ${coinText(entry.coins)}</span></li>
      <li><b>ROLL 100</b><span>DOUBLE // ${coinText(entry.coins * 2)}</span></li>
      <li><b>BELOW ${entry.target}</b><span>BLOOD TRIBUTE OWED</span></li>
      <li class="dark"><b>ROLL 1</b><span>DARK BLOOD TRIBUTE</span></li>
    </ul>`;
  }

  function renderPlayer() {
    if (isGm() && !me()) return;
    const root = playerRoot();
    const entry = states[me()];
    if (!entry) { root.hidden = true; return; }
    const card = root.querySelector('#chaos-player-card');
    root.hidden = false;
    root.classList.toggle('is-dark', entry.dark === true);
    const key = `${entry.id}:${entry.status}:${entry.pendingTribute}:${tributeNote}`;
    if (card.dataset.key === key) return;
    card.dataset.key = key;

    if (entry.status === 'offered') {
      card.innerHTML = `
        <div class="chaos-kicker">SHADOW BROKER // CHAOS</div>
        <h2>THE BROKER OFFERS CHAOS</h2>
        <p>Accept and you are playing. Reject, or stay silent, and nothing happens.</p>
        ${stakeLines(entry)}
        <div class="chaos-timer"><i data-chaos-bar></i></div>
        <div class="chaos-clock">ANSWER IN <b data-chaos-clock>${secondsLeft(entry.expiresAt)}</b>s</div>
        <div class="chaos-actions">
          <button type="button" data-chaos-accept>ACCEPT THE WAGER</button>
          <button type="button" class="ghost" data-chaos-reject>REJECT</button>
        </div>`;
      card.querySelector('[data-chaos-accept]').addEventListener('click', () => answer(true));
      card.querySelector('[data-chaos-reject]').addEventListener('click', () => answer(false));
      return;
    }
    if (entry.status === 'rolling') {
      card.innerHTML = `
        <div class="chaos-kicker">WAGER ACCEPTED</div>
        <h2>NOW ROLL</h2>
        <p>Type <b>/roll</b> or press the button. One roll. No rerolls. You need <b>${entry.target}+</b> to win ${coinText(entry.coins)}.</p>
        <div class="chaos-clock">UNROLLED IN <b data-chaos-clock>${secondsLeft(entry.rollEndsAt)}</b>s FORFEITS THE WAGER</div>
        <div class="chaos-actions"><button type="button" data-chaos-roll>ROLL /roll</button></div>`;
      card.querySelector('[data-chaos-roll]').addEventListener('click', () => {
        window.PlayerApp?.send?.({ type: 'chat:guess', text: '/roll' });
      });
      return;
    }
    // A player can upload or replace a pending offering even if a stale judging state persists.
    // owes or judging
    const rolled = entry.roll ? `YOUR ROLL: <b>${entry.roll}</b> // ${entry.target}+ REQUIRED` : 'YOUR UNROLLED WAGER WAS FORFEITED';
    card.innerHTML = `
      <div class="chaos-kicker">${entry.dark ? 'DARK BLOOD TRIBUTE OWED' : 'BLOOD TRIBUTE OWED'}</div>
      <h2>${entry.dark ? 'THE DARK DEBT' : 'CHAOS COLLECTS'}</h2>
      <p>${rolled}</p>
      <p>${entry.status === 'judging' ? 'YOUR PREVIOUS OFFERING IS AWAITING JUDGMENT. UPLOAD A NEW PICTURE TO REPLACE IT.' : 'THE SHADOW BROKER DEMANDS YOUR BLOOD TRIBUTE.'}</p>
      <label class="chaos-upload chaos-upload-primary">UPLOAD BLOOD TRIBUTE<input data-chaos-file type="file" accept="image/png,image/jpeg,image/webp"></label>
      <p class="chaos-small" data-chaos-note role="status">${esc(tributeNote || 'CHOOSE A PICTURE // PNG, JPG OR WEBP // MAX 2 MB')}</p>`;
    const file = card.querySelector('[data-chaos-file]');
    file.addEventListener('change', () => {
      if (file.files?.length) submitTribute();
    });
  }

  function answer(accept) {
    window.PlayerApp?.send?.({ type: 'chaos:respond', accept });
    const card = document.getElementById('chaos-player-card');
    card?.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }

  function submitTribute() {
    const card = document.getElementById('chaos-player-card');
    const note = card?.querySelector('[data-chaos-note]');
    const file = card?.querySelector('[data-chaos-file]')?.files?.[0];
    const say = t => { if (note) note.textContent = t; };
    if (!file) return say('NO IMAGE SELECTED');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return say('PNG, JPG OR WEBP ONLY');
    if (file.size > 2 * 1024 * 1024) return say('IMAGE TOO LARGE // 2 MB MAX');
    say('TRANSMITTING BLOOD TRIBUTE...');
    const reader = new FileReader();
    reader.onload = () => {
      const imageData = String(reader.result || '');
      if (!imageData.startsWith('data:image/')) return say('IMAGE COULD NOT BE READ');
      window.PlayerApp?.send?.({ type: 'chaos:tributeSubmit', imageData, retentionAcknowledged: true });
    };
    reader.onerror = () => say('IMAGE COULD NOT BE READ');
    reader.readAsDataURL(file);
  }

  function showResult(message) {
    if (String(message.playerId) !== me()) return;
    let layer = document.getElementById('chaos-result');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'chaos-result';
      document.body.appendChild(layer);
    }
    const kind = message.perfect ? 'perfect' : message.won ? 'won' : message.dark ? 'dark' : 'lost';
    const label = {
      perfect: `PERFECT 100 // DOUBLE // +${coinText(message.payout)}`,
      won: `CHAOS WON // +${coinText(message.payout)}`,
      dark: 'CRITICAL FAILURE // DARK BLOOD TRIBUTE',
      lost: `CHAOS LOST // NEEDED ${message.target}+`
    }[kind];
    layer.className = `is-${kind}`;
    layer.innerHTML = `<div><span class="chaos-roll-number">${esc(message.value)}</span><span class="chaos-roll-label">${esc(label)}</span></div>`;
    layer.hidden = false;
    window.AsocAudio?.playUi?.(message.won ? 'success' : 'impact');
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => { layer.hidden = true; }, 2600);
  }

  /* ---------- Shadow Broker ---------- */

  function ensureRailButton() {
    if (!isGm() || document.getElementById('chaos-gm-button')) return;
    const poison = document.getElementById('poison-gm-button');
    if (!poison) return;
    const button = document.createElement('button');
    button.className = 'gm-global-btn';
    button.id = 'chaos-gm-button';
    button.type = 'button';
    button.title = 'Offer a roll wager: win Shadow Coins or owe a Blood Tribute';
    button.setAttribute('aria-label', 'Chaos');
    button.innerHTML = '<span>CHAOS</span><small>ROLL WAGER</small>';
    poison.insertAdjacentElement('afterend', button);
  }

  function pickerRoot() {
    let root = document.getElementById('chaos-picker');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'chaos-picker';
    root.hidden = true;
    root.innerHTML = `
      <div class="chaos-picker-head">
        <div><b>CHAOS WAGER</b><small>PICK ONE OR MANY // SET THE STAKE</small></div>
        <button type="button" class="chaos-picker-close" aria-label="Close">×</button>
      </div>
      <div class="chaos-stake">
        <label>ROLL TARGET<input type="number" data-chaos-target min="${MIN_TARGET}" max="${MAX_TARGET}" step="1" value="50" inputmode="numeric"></label>
        <label>SHADOW COINS<input type="number" data-chaos-coins min="${MIN_COINS}" max="${MAX_COINS}" step="0.1" value="5" inputmode="decimal"></label>
      </div>
      <div class="chaos-stake-note" data-chaos-preview></div>
      <input class="chaos-picker-search" type="search" placeholder="SEARCH LITTLE HERO..." autocomplete="off">
      <div class="chaos-target-list"></div>
      <div class="chaos-picker-foot">
        <div class="chaos-picker-tools"><button type="button" data-chaos-tool="online">SELECT ALL ONLINE</button><button type="button" data-chaos-tool="clear">CLEAR</button></div>
        <button type="button" class="chaos-cast-btn" data-chaos-cast disabled>SELECT A TARGET</button>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('.chaos-picker-close').addEventListener('click', closePicker);
    root.querySelector('.chaos-picker-search').addEventListener('input', renderTargets);
    root.querySelectorAll('[data-chaos-target],[data-chaos-coins]').forEach(input => input.addEventListener('input', () => { disarm(); syncFoot(); }));
    return root;
  }

  function stake() {
    const root = pickerRoot();
    const target = Number(root.querySelector('[data-chaos-target]').value);
    const coins = Math.round(Number(root.querySelector('[data-chaos-coins]').value) * 10) / 10;
    let error = '';
    if (!Number.isInteger(target) || target < MIN_TARGET || target > MAX_TARGET) error = `ROLL TARGET ${MIN_TARGET}-${MAX_TARGET}`;
    else if (!Number.isFinite(coins) || coins < MIN_COINS || coins > MAX_COINS) error = `COINS ${MIN_COINS}-${MAX_COINS}`;
    return { target, coins, error };
  }

  function positionPicker() {
    const root = pickerRoot();
    const rect = document.getElementById('chaos-gm-button')?.getBoundingClientRect?.();
    const width = Math.min(430, window.innerWidth * 0.92);
    root.style.left = (rect ? Math.min(window.innerWidth - width - 16, Math.max(16, rect.right + 12)) : Math.max(16, (window.innerWidth - width) / 2)) + 'px';
    root.style.top = (rect ? Math.min(window.innerHeight - 260, Math.max(16, rect.top - 80)) : 70) + 'px';
  }

  function openPicker() {
    if (!isGm()) return;
    const root = pickerRoot();
    gmOpen = true;
    gmTargets = [];
    gmSelected = new Set();
    disarm();
    root.hidden = false;
    document.getElementById('chaos-gm-button')?.classList.add('is-open');
    positionPicker();
    root.querySelector('.chaos-target-list').innerHTML = '<div class="chaos-empty">FETCHING LITTLE HEROES...</div>';
    window.App.send({ type: 'gm:poisonTargets' });
    syncFoot();
  }

  function closePicker() {
    gmOpen = false;
    gmSending = false;
    disarm();
    gmSelected = new Set();
    document.getElementById('chaos-gm-button')?.classList.remove('is-open');
    const root = document.getElementById('chaos-picker');
    if (root) root.hidden = true;
  }

  function disarm() {
    gmArmed = false;
    clearTimeout(gmArmTimer);
    syncFoot();
  }

  function busy(id) { return states[String(id)] || null; }

  function renderTargets() {
    const root = pickerRoot();
    const list = root.querySelector('.chaos-target-list');
    const query = String(root.querySelector('.chaos-picker-search').value || '').trim().toLocaleLowerCase();
    const filtered = gmTargets.filter(t => !query || String(t.name || '').toLocaleLowerCase().includes(query));
    if (!filtered.length) { list.innerHTML = '<div class="chaos-empty">NO LITTLE HEROES FOUND</div>'; syncFoot(); return; }
    const row = target => {
      const id = String(target.id);
      const entry = busy(id);
      const picked = gmSelected.has(id);
      const tag = entry ? `<span class="chaos-tag">${entry.status === 'offered' ? 'OFFERED' : entry.status === 'rolling' ? 'ROLLING' : 'OWES TRIBUTE'}</span>` : '';
      const note = entry ? 'ALREADY IN A WAGER // SKIPPED' : (target.online ? 'ONLINE' : 'OFFLINE');
      return `<button type="button" class="chaos-target${picked ? ' is-selected' : ''}${target.online ? '' : ' is-offline'}${entry ? ' is-busy' : ''}" data-chaos-id="${esc(id)}" aria-pressed="${picked}"${entry ? ' disabled' : ''}>
        <span class="chaos-check" aria-hidden="true">✓</span>
        <img src="${esc(target.avatarData || '')}" alt="" onerror="this.style.visibility='hidden'">
        <span><b>${esc(target.name || 'LITTLE HERO')}${tag}</b><small>${picked ? 'SELECTED' : note}</small></span>
      </button>`;
    };
    const online = filtered.filter(t => t.online);
    const offline = filtered.filter(t => !t.online);
    list.innerHTML = (online.length ? `<div class="chaos-group">ONLINE · ${online.length}</div>${online.map(row).join('')}` : '')
      + (offline.length ? `<div class="chaos-group is-offline">OFFLINE · ${offline.length}</div>${offline.map(row).join('')}` : '');
    syncFoot();
  }

  function syncFoot() {
    const root = document.getElementById('chaos-picker');
    if (!root) return;
    const btn = root.querySelector('[data-chaos-cast]');
    const preview = root.querySelector('[data-chaos-preview]');
    const s = stake();
    const n = gmSelected.size;
    if (preview) {
      preview.classList.toggle('is-bad', !!s.error);
      preview.textContent = s.error ? s.error : `ROLL ${s.target}+ WINS ${coinText(s.coins)} // 100 PAYS ${coinText(s.coins * 2)} // BELOW OWES A BLOOD TRIBUTE // 1 OWES A DARK ONE`;
    }
    btn.classList.toggle('is-armed', gmArmed);
    btn.classList.toggle('is-casting', gmSending);
    if (gmSending) { btn.disabled = true; btn.textContent = 'SENDING OFFER...'; return; }
    btn.disabled = !n || !!s.error;
    if (!n) btn.textContent = 'SELECT A TARGET';
    else if (s.error) btn.textContent = s.error;
    else btn.textContent = gmArmed ? `CONFIRM // OFFER TO ${n} HERO${n === 1 ? '' : 'ES'}` : `OFFER CHAOS TO ${n} HERO${n === 1 ? '' : 'ES'}`;
  }

  function toggleTarget(id) {
    id = String(id);
    if (busy(id)) return;
    if (gmSelected.has(id)) gmSelected.delete(id); else gmSelected.add(id);
    disarm();
    renderTargets();
  }

  function tool(kind) {
    if (kind === 'online') gmTargets.filter(t => t.online && !busy(t.id)).forEach(t => gmSelected.add(String(t.id)));
    else gmSelected.clear();
    disarm();
    renderTargets();
  }

  function pressCast() {
    const s = stake();
    if (!gmSelected.size || s.error || gmSending) return;
    if (!gmArmed) {
      gmArmed = true;
      clearTimeout(gmArmTimer);
      gmArmTimer = setTimeout(disarm, ARM_MS);
      syncFoot();
      return;
    }
    clearTimeout(gmArmTimer);
    gmArmed = false;
    gmSending = true;
    syncFoot();
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => { if (gmSending) { gmSending = false; gmToast('NO ANSWER FROM THE SERVER // TRY AGAIN', true); syncFoot(); } }, 8000);
    window.App.send({ type: 'gm:chaosCast', playerIds: [...gmSelected], target: s.target, coins: s.coins });
  }

  function gmToast(text, bad = false) {
    document.querySelector('.chaos-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'chaos-toast' + (bad ? ' is-bad' : '');
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  const LABEL = { offered: 'OFFER', rolling: 'ROLL', owes: 'OWES', judging: 'JUDGE' };

  function updateBadges() {
    if (!isGm()) return;
    document.querySelectorAll('.mp-player[data-player-id]').forEach(row => {
      const id = String(row.getAttribute('data-player-id') || '');
      const entry = states[id];
      let badge = row.querySelector(':scope > .chaos-gm-badge');
      if (!entry) { badge?.remove(); return; }
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'chaos-gm-badge';
        badge.dataset.chaosWithdraw = id;
        row.appendChild(badge);
      }
      const armed = withdrawArm && withdrawArm.id === id;
      const clock = entry.status === 'offered' ? ` ${secondsLeft(entry.expiresAt)}s` : entry.status === 'rolling' ? ` ${secondsLeft(entry.rollEndsAt)}s` : '';
      const text = armed ? 'WITHDRAW?' : `CHAOS ${entry.dark ? 'DARK ' : ''}${LABEL[entry.status] || ''}${clock}`;
      if (badge.textContent !== text) badge.textContent = text;
      badge.classList.toggle('is-dark', entry.dark === true);
      badge.classList.toggle('is-armed', !!armed);
      badge.title = `${entry.target}+ wins ${coinText(entry.coins)}. Click twice to withdraw this hero's chaos entry.`;
    });
  }

  function pressWithdraw(id) {
    if (withdrawArm && withdrawArm.id === id) {
      clearTimeout(withdrawArm.timer);
      withdrawArm = null;
      window.App.send({ type: 'gm:chaosCancel', playerId: id });
    } else {
      if (withdrawArm) clearTimeout(withdrawArm.timer);
      withdrawArm = { id, timer: setTimeout(() => { withdrawArm = null; updateBadges(); }, ARM_MS) };
    }
    updateBadges();
  }

  function offerRoot() {
    let root = document.getElementById('chaos-gm-offer');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'chaos-gm-offer';
    root.hidden = true;
    root.innerHTML = '<div class="chaos-card" id="chaos-gm-card"></div>';
    document.body.appendChild(root);
    return root;
  }

  function renderOffer() {
    const root = offerRoot();
    const offer = gmOffers[0];
    if (!offer) { root.hidden = true; return; }
    root.hidden = false;
    root.classList.toggle('is-dark', offer.dark === true);
    const card = root.querySelector('#chaos-gm-card');
    const more = gmOffers.length > 1 ? ` // ${gmOffers.length - 1} MORE WAITING` : '';
    card.innerHTML = `
      <div class="chaos-kicker">${offer.dark ? 'DARK ' : ''}BLOOD TRIBUTE // CHAOS${more}</div>
      <h2>${offer.dark ? 'A DARK OFFERING' : 'A DEBT IS PAID'}</h2>
      <p><b>${esc(offer.playerName || 'LITTLE HERO')}</b> rolled ${offer.dark ? 'a <b>1</b>' : `<b>${esc(offer.roll || 0)}</b> against ${esc(offer.target)}+`} and offers blood.</p>
      <img class="chaos-image" src="${esc(offer.imageData || '')}" alt="Chaos Blood Tribute">
      <div class="chaos-actions">
        <button type="button" data-chaos-accept-tribute>ACCEPT // CLEAR THE DEBT</button>
        <button type="button" class="ghost" data-chaos-reject-tribute>REJECT // DEBT STANDS</button>
      </div>`;
    card.querySelector('[data-chaos-accept-tribute]').addEventListener('click', () => judge(offer, true));
    card.querySelector('[data-chaos-reject-tribute]').addEventListener('click', () => judge(offer, false));
  }

  function judge(offer, accepted) {
    window.App?.send?.({ type: 'gm:chaosTributeDecision', playerId: offer.playerId, tributeId: offer.tributeId, accepted });
    gmOffers = gmOffers.filter(o => o !== offer);
    renderOffer();
  }

  /* ---------- wiring ---------- */

  function onState(message) {
    states = message?.chaos && typeof message.chaos === 'object' ? message.chaos : {};
    const sample = Object.values(states)[0];
    if (sample && Number.isFinite(Number(sample.serverNow))) clockOffset = Number(sample.serverNow) - Date.now();
    ensureRailButton();
    renderPlayer();
    updateBadges();
    gmOffers = gmOffers.filter(o => states[String(o.playerId)]?.status === 'judging');
    if (isGm()) { renderOffer(); if (gmOpen) renderTargets(); }
  }

  function onMessage(message) {
    if (!message) return;
    switch (message.type) {
      case 'gm:poisonTargets':
        gmTargets = Array.isArray(message.targets) ? message.targets : [];
        if (gmOpen) renderTargets();
        break;
      case 'gm:chaosCastResult': {
        gmSending = false;
        clearTimeout(sendTimer);
        if (message.ok) {
          const names = Array.isArray(message.created) ? message.created : [];
          const skipped = Array.isArray(message.skipped) ? message.skipped.length : 0;
          closePicker();
          gmToast(`CHAOS OFFERED // ${names.join(', ') || 'TARGETS'}${skipped ? ` // ${skipped} SKIPPED` : ''}`);
        } else {
          gmToast(message.error || 'CHAOS REJECTED', true);
          syncFoot();
        }
        break;
      }
      case 'chaos:tributeOffered':
        if (isGm()) {
          gmOffers = gmOffers.filter(o => String(o.playerId) !== String(message.playerId));
          gmOffers.push(message);
          renderOffer();
        }
        break;
      case 'chaos:tributeRejected':
        if (String(message.playerId) === me()) { tributeNote = 'TRIBUTE REJECTED // OFFER ANOTHER'; renderPlayer(); }
        break;
      case 'chaos:tributeSent':
        tributeNote = '';
        break;
      case 'chaos:result':
        showResult(message);
        break;
      default:
    }
  }

  // A bare "/chaos" (or one missing its numbers) opens the same wager menu as the rail button
  // instead of failing; any numbers already typed prefill ROLL TARGET and SHADOW COINS.
  function menuIntent(text) {
    const t = String(text || '').trim();
    if (!/^\/chaos(\s|$)/i.test(t)) return null;
    if (/^\/chaos\s+.+\s+\d{1,3}\s+\d{1,3}(?:\.\d)?$/i.test(t)) return null;
    const nums = t.replace(/^\/chaos/i, '').match(/(?:^|\s)(\d{1,3}(?:\.\d)?)(?=\s|$)/g) || [];
    const [target, coins] = nums.map(n => n.trim());
    return { target, coins };
  }

  function installCommandMenu() {
    const composer = () => document.getElementById('shadow-broker-composer');
    const model = () => document.getElementById('shadow-broker-input');
    const typed = () => (model()?.value || composer()?.textContent || '');
    const swallow = intent => {
      const c = composer();
      const m = model();
      if (m) m.value = '';
      if (c) { c.textContent = ''; c.dispatchEvent(new Event('input', { bubbles: true })); }
      if (!gmOpen) openPicker();
      const root = pickerRoot();
      const t = root.querySelector('[data-chaos-target]');
      const k = root.querySelector('[data-chaos-coins]');
      if (intent.target && t) t.value = intent.target;
      if (intent.coins && k) k.value = intent.coins;
      syncFoot();
    };
    const guard = event => {
      const intent = menuIntent(typed());
      if (!intent) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      swallow(intent);
    };
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      if (event.target !== composer() && event.target !== model()) return;
      guard(event);
    }, true);
    document.addEventListener('submit', event => {
      if (!event.target.contains?.(composer())) return;
      guard(event);
    }, true);
  }

  function start() {
    document.addEventListener('click', event => {
      if (event.target.closest?.('#chaos-gm-button')) { event.preventDefault(); gmOpen ? closePicker() : openPicker(); return; }
      const target = event.target.closest?.('[data-chaos-id]');
      if (target) { event.preventDefault(); toggleTarget(target.dataset.chaosId); return; }
      const toolButton = event.target.closest?.('[data-chaos-tool]');
      if (toolButton) { event.preventDefault(); tool(toolButton.dataset.chaosTool); return; }
      if (event.target.closest?.('[data-chaos-cast]')) { event.preventDefault(); pressCast(); return; }
      const withdraw = event.target.closest?.('[data-chaos-withdraw]');
      if (withdraw) { event.preventDefault(); pressWithdraw(withdraw.dataset.chaosWithdraw); return; }
      if (gmOpen) {
        const picker = document.getElementById('chaos-picker');
        if (picker && !picker.contains(event.target)) closePicker();
      }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && gmOpen) closePicker(); });
    window.addEventListener('resize', () => { if (gmOpen) positionPicker(); });
    if (isGm()) installCommandMenu();
    ensureRailButton();
    if (isGm()) setTimeout(() => window.App.send({ type: 'gm:chaosPending' }), 1800);
    tick = setInterval(() => {
      const entry = states[me()];
      if (entry) {
        const clock = document.querySelector('#chaos-player-card [data-chaos-clock]');
        const left = entry.status === 'offered' ? secondsLeft(entry.expiresAt) : entry.status === 'rolling' ? secondsLeft(entry.rollEndsAt) : null;
        if (clock && left !== null) clock.textContent = left;
        const bar = document.querySelector('#chaos-player-card [data-chaos-bar]');
        if (bar && entry.status === 'offered') bar.style.width = Math.max(0, Math.min(100, (Number(entry.expiresAt) - now()) / OFFER_MS * 100)) + '%';
        if (entry.status === 'offered' && left === 0) {
          document.querySelectorAll('#chaos-player-card button').forEach(b => { b.disabled = true; });
        }
      }
      updateBadges();
      ensureRailButton();
    }, 500);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, { once: true }) : start();
  window.ChaosGame = Object.freeze({ onState, onMessage, OFFER_MS, ROLL_MS });
})();
