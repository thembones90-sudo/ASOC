// SHADOW BROKER TRANSMOG -- the Broker's appearance on every page, and the
// IDENTITY VAULT wardrobe on the Shadow Broker console.
//
// Three states, never mixed:
//   LIVE     what the room sees; comes only from the server (state:public).
//   PREVIEW  a set (or the CUSTOM forge) shown inside the vault only.
//   EQUIP    gm:brokerTransmog / gm:brokerProfile -> server -> everyone.
// Cancelling or closing the vault discards the preview; nothing local changes
// until the server confirms an equip.
//
// Appearance only. This file paints avatars, frames, auras and message
// styles; it never touches game state.
(() => {
  'use strict';
  const C = window.BrokerTransmogCatalog;
  if (!C) return;
  const isGM = () => !!window.App && !window.PlayerApp;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AVATAR_SEL = 'img.shadow-broker-avatar, img[src*="shadow-broker.png"], img[data-broker-avatar]';
  const MESSAGE_SEL = '.gm-shadow-broker-entry, .chat-broker-entry, .broker-media-message, .shadow-broker-transmission';
  const VAULT_SEL = '#broker-transmog-overlay, .btm-entrance';
  const RARITY = { common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY', mythic: 'MYTHIC' };

  let live = C.resolveProfile(C.DEFAULT_ID);
  let liveSeq = null;          // null until the first server state (no entrance on load)
  let owned = new Set();
  let previewId = null;        // set id or C.CUSTOM_ID while the vault is open
  let customDraft = null;      // the CUSTOM forge's unsaved settings
  let note = '';

  // ---------------------------------------------------------------- LIVE --
  function paintAvatar(img, p) {
    img.dataset.brokerAvatar = '1';
    if (img.getAttribute('src') !== p.avatarData) img.setAttribute('src', p.avatarData);
    img.dataset.brokerEffect = p.avatarEffect;
    img.style.setProperty('--broker-frame', p.frameColor);
    img.style.setProperty('--broker-accent', p.accent);
  }
  function paintMessage(node, p) {
    node.dataset.brokerMessageEffect = p.messageEffect;
    node.style.setProperty('--broker-frame', p.frameColor);
    node.style.setProperty('--broker-accent', p.accent);
  }
  function decorate(root = document) {
    const html = document.documentElement;
    html.dataset.brokerAura = live.aura;
    html.dataset.brokerSet = live.transmogId;
    html.dataset.brokerSystem = live.systemStyle;
    html.style.setProperty('--broker-frame', live.frameColor);
    html.style.setProperty('--broker-accent', live.accent);
    const scope = root.nodeType === 1 || root === document ? root : document;
    const each = (sel, fn) => {
      if (scope.nodeType === 1 && scope.matches?.(sel) && !scope.closest(VAULT_SEL)) fn(scope);
      scope.querySelectorAll?.(sel).forEach(el => { if (!el.closest(VAULT_SEL)) fn(el); });
    };
    each(AVATAR_SEL, img => paintAvatar(img, live));
    each(MESSAGE_SEL, node => paintMessage(node, live));
  }

  // Called with every state:public. `meta` is the whole message.
  function setProfile(next, meta = {}) {
    const profile = C.cleanProfile(next || {}, next?.transmogId);
    const seq = Number(meta.brokerTransmogSeq);
    if (Array.isArray(meta.brokerWardrobe?.owned)) owned = new Set(meta.brokerWardrobe.owned.map(String));
    const changed = profile.transmogId !== live.transmogId || profile.avatarData !== live.avatarData || profile.messageEffect !== live.messageEffect || profile.avatarEffect !== live.avatarEffect || profile.frameColor !== live.frameColor || profile.aura !== live.aura;
    const equipped = Number.isFinite(seq) && liveSeq !== null && seq > liveSeq;
    live = profile;
    if (Number.isFinite(seq)) liveSeq = liveSeq === null ? seq : Math.max(liveSeq, seq);
    if (changed || equipped) decorate();
    if (equipped) entrance(profile);
    if (vaultOpen()) renderVault();
  }

  // ------------------------------------------------------------ ENTRANCE --
  function entrance(p) {
    const set = C.get(p.transmogId);
    document.querySelector('.btm-entrance')?.remove();
    const el = document.createElement('div');
    el.className = 'btm-entrance';
    el.dataset.entrance = p.entrance || 'fade';
    el.setAttribute('role', 'status');
    el.style.setProperty('--set-frame', p.frameColor);
    el.style.setProperty('--set-accent', p.accent);
    el.innerHTML = `<div class="btm-entrance-card"><img src="${esc(p.avatarData)}" alt="" data-broker-effect="${esc(p.avatarEffect)}" data-broker-aura="${esc(p.aura)}"><div><small>THE SHADOW BROKER HAS CHANGED</small><b>${esc(set ? set.name : 'CUSTOM IDENTITY')}</b></div></div>`;
    document.body.appendChild(el);
    sting(p.sound);
    setTimeout(() => el.classList.add('is-leaving'), 2100);
    setTimeout(() => el.remove(), 2600);
  }

  // A short synthesized sting per set; silent when sound is off or the page
  // has not been interacted with yet.
  let audioCtx = null;
  function sting(kind) {
    if (!kind || kind === 'none') return;
    try { if (localStorage.getItem('asoc_audio_enabled') === '0') return; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audioCtx = audioCtx || new AC(); } catch { return; }
    if (audioCtx.state === 'suspended') { audioCtx.resume().catch(() => {}); if (audioCtx.state === 'suspended') return; }
    const t = audioCtx.currentTime;
    const out = audioCtx.createGain(); out.gain.value = 0.14; out.connect(audioCtx.destination);
    const tone = (type, f0, f1, start, dur, vol = 1) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t + start); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + start + dur);
      g.gain.setValueAtTime(0.0001, t + start); g.gain.exponentialRampToValueAtTime(vol, t + start + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g); g.connect(out); o.start(t + start); o.stop(t + start + dur + 0.05);
    };
    const S = {
      hum: () => tone('sine', 110, 104, 0, 0.9, 0.8),
      drone: () => { tone('sawtooth', 55, 48, 0, 1.4, 0.5); tone('sine', 82, 70, 0.1, 1.3, 0.6); },
      chime: () => { tone('sine', 1320, 1300, 0, 0.9, 0.5); tone('sine', 1760, 1740, 0.12, 0.8, 0.35); },
      horn: () => { tone('sawtooth', 98, 110, 0, 0.7, 0.7); tone('sawtooth', 147, 165, 0.05, 0.7, 0.5); },
      fanfare: () => { [523, 659, 784].forEach((f, i) => tone('triangle', f, f, i * 0.11, 0.45, 0.5)); },
      static: () => { for (let i = 0; i < 6; i++) tone('square', 200 + Math.random() * 1800, 100, i * 0.05, 0.05, 0.25); },
      toll: () => { tone('sine', 196, 190, 0, 1.6, 0.8); tone('sine', 392, 385, 0, 1.2, 0.3); },
      blade: () => { tone('sawtooth', 2400, 600, 0, 0.18, 0.4); tone('sine', 140, 60, 0.14, 0.5, 0.7); },
      fel: () => { tone('sawtooth', 70, 140, 0, 0.9, 0.6); tone('square', 210, 420, 0.2, 0.7, 0.25); tone('sine', 55, 40, 0, 1.4, 0.7); }
    };
    S[kind]?.();
  }

  // --------------------------------------------------------------- VAULT --
  const vault = () => document.getElementById('broker-transmog-overlay');
  const vaultOpen = () => !!vault() && !vault().hidden;

  function ensureButton() {
    if (!isGM() || document.getElementById('broker-transmog-btn')) return;
    const row = document.querySelector('.battle-controls-utility-row');
    if (!row) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'broker-transmog-btn';
    btn.className = 'toolbar-btn transmog-utility-btn';
    btn.textContent = 'TRANSMOG';
    btn.title = 'Shadow Broker Identity Vault';
    row.insertBefore(btn, row.children[1] || null);
  }

  function ensureVault() {
    if (vault()) return vault();
    const el = document.createElement('div');
    el.id = 'broker-transmog-overlay';
    el.className = 'btm-overlay';
    el.hidden = true;
    el.innerHTML = `
      <div class="btm-vault" role="dialog" aria-modal="true" aria-label="Shadow Broker Identity Vault">
        <header class="btm-head">
          <div class="btm-title"><b>IDENTITY VAULT</b><small>SHADOW BROKER // TRANSMOG WARDROBE</small></div>
          <span class="btm-count" id="btm-count"></span>
          <button type="button" class="btm-x" data-btm="close" aria-label="Close">×</button>
        </header>
        <div class="btm-body">
          <section class="btm-stage" id="btm-stage" aria-live="polite"></section>
          <section class="btm-collection">
            <div class="btm-collection-head"><b>COLLECTION</b><small>SELECT TO PREVIEW // NOTHING CHANGES UNTIL YOU EQUIP</small></div>
            <div class="btm-grid" id="btm-grid"></div>
          </section>
        </div>
        <footer class="btm-foot">
          <button type="button" data-btm="default">EQUIP DEFAULT</button>
          <span class="btm-note" id="btm-note"></span>
          <button type="button" data-btm="cancel">CANCEL</button>
          <button type="button" class="is-primary" data-btm="equip" id="btm-equip">EQUIP</button>
        </footer>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onVaultClick);
    el.addEventListener('input', onForgeInput);
    el.addEventListener('change', onForgeChange);
    return el;
  }

  function openVault() {
    ensureVault().hidden = false;
    previewId = live.transmogId;
    customDraft = live.transmogId === C.CUSTOM_ID ? { ...live } : { ...C.resolveProfile(C.DEFAULT_ID), transmogId: C.CUSTOM_ID };
    note = '';
    renderVault();
    document.getElementById('btm-grid')?.querySelector('[aria-pressed="true"]')?.focus();
  }
  function closeVault() {
    if (!vault()) return;
    vault().hidden = true;
    previewId = null;
    customDraft = null;
    note = '';
  }

  const previewProfile = () => (previewId === C.CUSTOM_ID ? C.cleanProfile({ ...customDraft, transmogId: C.CUSTOM_ID }) : C.resolveProfile(previewId));
  // The Shadow Broker has no limits: every set is open in the vault.
  const unlocked = () => true;

  function renderVault() {
    const el = ensureVault();
    if (!previewId) previewId = live.transmogId;
    const sets = C.SETS;
    const have = sets.filter(s => unlocked(s.id)).length;
    el.querySelector('#btm-count').textContent = `${have}/${sets.length} COLLECTED`;
    el.querySelector('#btm-grid').innerHTML = sets.map(tileHTML).join('') + customTileHTML();
    renderStage();
  }

  function tileHTML(set) {
    const isLive = live.transmogId === set.id;
    const isPreview = previewId === set.id;
    const locked = !unlocked(set.id);
    return `<button type="button" class="btm-tile rarity-${esc(set.rarity)}${locked ? ' is-locked' : ''}${isLive ? ' is-equipped' : ''}" data-btm-set="${esc(set.id)}" aria-pressed="${isPreview}" style="--set-frame:${esc(set.frameColor)};--set-accent:${esc(set.accent)}">
      <span class="btm-thumb"><img src="${esc(set.thumb)}" alt="" loading="lazy"></span>
      <b>${esc(set.name)}</b>
      <small>${locked ? 'LOCKED' : esc(RARITY[set.rarity] || set.rarity.toUpperCase())}</small>
      ${isLive ? '<i class="btm-badge is-equipped" title="Equipped">✓</i>' : ''}${locked ? '<i class="btm-badge is-locked" title="Locked">🔒</i>' : ''}
    </button>`;
  }
  function customTileHTML() {
    const isLive = live.transmogId === C.CUSTOM_ID;
    const thumb = isLive ? live.avatarData : (customDraft?.avatarData || C.resolveProfile(C.DEFAULT_ID).avatarData);
    return `<button type="button" class="btm-tile is-custom${isLive ? ' is-equipped' : ''}" data-btm-set="${C.CUSTOM_ID}" aria-pressed="${previewId === C.CUSTOM_ID}" style="--set-frame:${esc(customDraft?.frameColor || '#9b5de0')};--set-accent:${esc(customDraft?.accent || '#c486ef')}">
      <span class="btm-thumb"><img src="${esc(thumb)}" alt=""></span>
      <b>CUSTOM</b><small>IDENTITY FORGE</small>
      ${isLive ? '<i class="btm-badge is-equipped" title="Equipped">✓</i>' : ''}
    </button>`;
  }

  function sampleHTML(text) {
    return window.Skeleton?.shadowBrokerTransmissionHTML ? Skeleton.shadowBrokerTransmissionHTML(text) : `<div class="shadow-broker-transmission"><div class="shadow-broker-body"><span class="shadow-broker-name">SHADOW BROKER</span><span class="shadow-broker-text">${esc(text)}</span></div></div>`;
  }

  function renderStage() {
    const stage = document.getElementById('btm-stage');
    if (!stage) return;
    const custom = previewId === C.CUSTOM_ID;
    const set = custom ? null : C.get(previewId);
    const p = previewProfile();
    const locked = !custom && !unlocked(previewId);
    const isLive = custom ? live.transmogId === C.CUSTOM_ID && JSON.stringify(C.cleanProfile(customDraft)) === JSON.stringify(C.cleanProfile({ ...live })) : live.transmogId === previewId;
    const status = locked ? `<span class="btm-status is-locked">LOCKED // ${esc(set?.unlock?.hint || 'NOT YET EARNED')}</span>` : isLive ? '<span class="btm-status is-equipped">EQUIPPED</span>' : '<span class="btm-status is-preview">PREVIEW // NOT EQUIPPED</span>';
    stage.dataset.previewSet = p.transmogId;
    stage.style.setProperty('--set-frame', p.frameColor);
    stage.style.setProperty('--set-accent', p.accent);
    stage.dataset.aura = p.aura;
    stage.innerHTML = `
      <div class="btm-stage-glow" data-aura="${esc(p.aura)}"></div>
      <div class="btm-stage-avatar"><img class="btm-avatar" src="${esc(p.avatarData)}" alt="" data-broker-effect="${esc(p.avatarEffect)}" data-broker-aura="${esc(p.aura)}"></div>
      <div class="btm-stage-meta">
        <span class="btm-rarity">${custom ? 'CUSTOM // IDENTITY FORGE' : `${esc(RARITY[set.rarity] || '')} · ${esc(set.category.toUpperCase())}`}</span>
        <h2>${custom ? 'CUSTOM IDENTITY' : esc(set.name)}</h2>
        <p>${custom ? 'Your own avatar, frame and effects.' : esc(set.tagline)}</p>
        ${status}
      </div>
      <div class="btm-sample">${sampleHTML(custom ? 'CUSTOM TRANSMISSION. THE BROKER WEARS WHAT THE BROKER WANTS.' : set.sample)}</div>
      ${custom ? forgeHTML(p) : ''}`;
    // The sample sits inside the vault, so live painting skips it; paint it
    // with the PREVIEW profile instead.
    stage.querySelectorAll('.btm-sample img.shadow-broker-avatar').forEach(img => { img.src = p.avatarData; img.dataset.brokerEffect = p.avatarEffect; img.dataset.brokerAura = p.aura; img.style.setProperty('--broker-frame', p.frameColor); });
    stage.querySelectorAll('.btm-sample .shadow-broker-transmission').forEach(node => paintMessage(node, p));
    const equip = document.getElementById('btm-equip');
    if (equip) {
      equip.disabled = locked || isLive;
      equip.textContent = locked ? 'LOCKED' : isLive ? 'EQUIPPED' : 'EQUIP';
    }
    const n = document.getElementById('btm-note');
    if (n) n.textContent = note;
  }

  const option = (list, value) => list.map(v => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(v.toUpperCase())}</option>`).join('');
  function forgeHTML(p) {
    return `<div class="btm-forge">
      <label class="btm-upload">AVATAR<input type="file" id="btm-file" accept="image/png,image/jpeg,image/webp"><span>UPLOAD IMAGE</span></label>
      <label>FRAME<input type="color" id="btm-color" value="${esc(p.frameColor)}"></label>
      <label>AVATAR EFFECT<select id="btm-avatar-effect">${option(C.AVATAR_EFFECTS, p.avatarEffect)}</select></label>
      <label>MESSAGE STYLE<select id="btm-message-effect">${option(C.MESSAGE_EFFECTS, p.messageEffect)}</select></label>
      <label>AURA<select id="btm-aura">${option(C.AURAS, p.aura)}</select></label>
    </div>`;
  }

  function onForgeInput(event) {
    if (!customDraft) return;
    if (event.target.id === 'btm-color') { customDraft.frameColor = event.target.value; customDraft.accent = event.target.value; refreshStageKeepFocus(); }
  }
  function onForgeChange(event) {
    if (!customDraft) return;
    const id = event.target.id;
    if (id === 'btm-avatar-effect') customDraft.avatarEffect = event.target.value;
    else if (id === 'btm-message-effect') customDraft.messageEffect = event.target.value;
    else if (id === 'btm-aura') customDraft.aura = event.target.value;
    else if (id === 'btm-file') return loadUpload(event.target.files?.[0]);
    else return;
    refreshStageKeepFocus();
  }
  function refreshStageKeepFocus() {
    const focused = document.activeElement?.id;
    renderStage();
    if (focused) document.getElementById(focused)?.focus();
  }

  // Custom uploads are squared and re-encoded to a 512px WebP in the browser,
  // so any reasonable photo fits the server's limit comfortably.
  function loadUpload(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) { note = 'TRANSMOG REJECTED // PNG, JPEG OR WEBP // MAX 12 MB'; return renderStage(); }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/webp', 0.9);
      if (data.length > C.MAX_AVATAR_CHARS) { note = 'TRANSMOG REJECTED // IMAGE TOO LARGE'; return renderStage(); }
      customDraft.avatarData = data;
      note = '';
      renderVault();
    };
    img.onerror = () => { URL.revokeObjectURL(url); note = 'TRANSMOG REJECTED // UNREADABLE IMAGE'; renderStage(); };
    img.src = url;
  }

  function equip(id) {
    note = 'EQUIPPING…';
    if (id === C.CUSTOM_ID) window.App?.send?.({ type: 'gm:brokerProfile', profile: C.cleanProfile({ ...customDraft, transmogId: C.CUSTOM_ID }) });
    else window.App?.send?.({ type: 'gm:brokerTransmog', transmogId: id });
    renderStage();
  }

  function onVaultClick(event) {
    if (event.target.id === 'broker-transmog-overlay') return closeVault();
    const tile = event.target.closest('[data-btm-set]');
    if (tile) { previewId = tile.dataset.btmSet; note = ''; return renderVault(); }
    const action = event.target.closest('[data-btm]')?.dataset.btm;
    if (action === 'close' || action === 'cancel') return closeVault();
    if (action === 'default') { previewId = C.DEFAULT_ID; renderVault(); if (live.transmogId !== C.DEFAULT_ID) equip(C.DEFAULT_ID); return; }
    if (action === 'equip') { const btn = document.getElementById('btm-equip'); if (btn?.disabled) return; return equip(previewId); }
  }

  function onError(message) {
    if (!vaultOpen()) return;
    note = String(message || 'TRANSMOG FAILED');
    renderStage();
  }

  function init() {
    ensureButton();
    document.addEventListener('click', event => {
      if (event.target.closest('#broker-transmog-btn')) { event.preventDefault(); openVault(); }
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && vaultOpen()) { event.preventDefault(); closeVault(); } });
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === 1) decorate(node); }))).observe(document.body, { childList: true, subtree: true });
    decorate();
  }

  window.BrokerTransmog = {
    setProfile, decorate, onError,
    open: openVault, close: closeVault,
    getProfile: () => ({ ...live }),
    get previewId() { return previewId; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
