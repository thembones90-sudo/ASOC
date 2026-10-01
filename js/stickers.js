// STICKERS -- WhatsApp-style stickers for the Little Hero chat.
//
//   AsocStickers.open()          sticker tray: MY STICKERS + the ASOC PACK
//   AsocStickers.messageHTML(m)  bubble-less sticker in a chat message
//   Sticker maker                pick / paste / drop an image, frame it
//                                (pan + zoom), cut it out (shape or
//                                background removal), add a white sticker
//                                outline and captions, save as a 512 px WEBP.
//
// Server: GET/POST /api/stickers, POST /api/stickers/save,
// DELETE /api/stickers/item/:id, WS chat:sticker { url }.
(function () {
  'use strict';

  const SIZE = 512;
  const MAX_BYTES = 1024 * 1024;
  const state = { pack: [], mine: [], max: 120, loaded: false, tab: 'mine', tray: null, maker: null };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Works on both pages: the Little Hero chat (PlayerApp) and the Shadow
  // Broker console (App, index.html), which keeps its own sticker library.
  const isGM = () => !window.PlayerApp && !!window.App;
  const authHeaders = () => isGM()
    ? { 'x-gm-token': window.GameData?.gmToken || sessionStorage.getItem('asoc_gm_token') || '' }
    : { 'x-player-token': sessionStorage.getItem('asoc_player_auth_token') || localStorage.getItem('asoc_player_auth_token') || '' };
  const app = () => (isGM() ? window.App : window.PlayerApp);
  const toast = (text) => {
    const message = String(text).toUpperCase();
    if (isGM() && window.App?.setGMDeliveryState) window.App.setGMDeliveryState(message, 'queued', 3600);
    else if (window.PlayerApp?.setChatDeliveryState) window.PlayerApp.setChatDeliveryState(message, 'queued', 3600);
    else console.warn(text);
  };

  async function api(path, options = {}) {
    const res = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || 'Sticker request failed');
    return body;
  }

  async function load(force = false) {
    if (state.loaded && !force) return;
    const body = await api('/api/stickers');
    state.pack = Array.isArray(body.pack) ? body.pack : [];
    state.mine = Array.isArray(body.mine) ? body.mine : [];
    state.max = Number(body.max) || 120;
    state.loaded = true;
  }

  function send(url) {
    const target = app();
    if (!target?.ws || target.ws.readyState !== WebSocket.OPEN) return toast('Chat is not connected.');
    target.send({ type: 'chat:sticker', url });
    close();
  }

  // ---------- Tray ----------
  function trayHTML() {
    const mine = state.mine.map(s => `
      <div class="stk-cell" data-stk-url="${esc(s.url)}">
        <button type="button" class="stk-pick" data-stk-send="${esc(s.url)}" title="Send"><img src="${esc(s.url)}" alt="Sticker"></button>
        <button type="button" class="stk-remove" data-stk-remove="${esc(s.id)}" title="Remove from my stickers" aria-label="Remove sticker">×</button>
      </div>`).join('');
    const pack = state.pack.map(url => `
      <div class="stk-cell"><button type="button" class="stk-pick" data-stk-send="${esc(url)}" title="Send"><img src="${esc(url)}" alt="Sticker"></button></div>`).join('');
    const create = '<div class="stk-cell"><button type="button" class="stk-create" data-stk-create title="Make a sticker"><b>+</b><small>CREATE</small></button></div>';
    return `
      <div class="stk-tray-head">
        <div class="stk-tabs" role="tablist">
          <button type="button" role="tab" data-stk-tab="mine" aria-selected="${state.tab === 'mine'}">MY STICKERS <small>${state.mine.length}/${state.max}</small></button>
          <button type="button" role="tab" data-stk-tab="pack" aria-selected="${state.tab === 'pack'}">ASOC PACK</button>
        </div>
        <button type="button" class="stk-close" data-stk-close aria-label="Close stickers">×</button>
      </div>
      <div class="stk-grid">${state.tab === 'mine' ? create + mine : pack}</div>
      ${state.tab === 'mine' && !state.mine.length ? '<p class="stk-empty">No stickers yet. CREATE one from any image, or tap a sticker in chat to save it.</p>' : ''}`;
  }

  function renderTray() { if (state.tray) state.tray.innerHTML = trayHTML(); }

  async function open() {
    close();
    const anchor = isGM()
      ? document.querySelector('#shadow-broker-form .gm-composer-shell') || document.getElementById('shadow-broker-form')
      : document.querySelector('#chat-form .chat-composer-shell') || document.getElementById('chat-form');
    if (!anchor) return;
    const tray = document.createElement('div');
    tray.className = 'stk-tray';
    tray.innerHTML = '<div class="stk-loading">LOADING STICKERS…</div>';
    // Fixed to the viewport just above the composer, so no ancestor's
    // overflow or positioning can clip it.
    const r = anchor.getBoundingClientRect();
    tray.style.left = Math.max(8, r.left) + 'px';
    tray.style.width = Math.min(r.width, window.innerWidth - 16) + 'px';
    tray.style.bottom = Math.max(8, window.innerHeight - r.top + 10) + 'px';
    document.body.appendChild(tray);
    state.tray = tray;
    tray.addEventListener('click', onTrayClick);
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    try { await load(); renderTray(); } catch (error) { tray.innerHTML = `<div class="stk-loading">${esc(error.message)}</div>`; }
  }

  function outside(event) {
    if (state.tray && !state.tray.contains(event.target) && !event.target.closest('.stk-maker')) close();
  }

  function close() {
    document.removeEventListener('pointerdown', outside, true);
    state.tray?.remove();
    state.tray = null;
  }

  async function onTrayClick(event) {
    const t = event.target;
    const tab = t.closest('[data-stk-tab]')?.dataset.stkTab;
    if (tab) { state.tab = tab; return renderTray(); }
    if (t.closest('[data-stk-close]')) return close();
    if (t.closest('[data-stk-create]')) { close(); return openMaker(); }
    const removeId = t.closest('[data-stk-remove]')?.dataset.stkRemove;
    if (removeId) {
      try { await api('/api/stickers/item/' + encodeURIComponent(removeId), { method: 'DELETE' }); state.mine = state.mine.filter(s => s.id !== removeId); renderTray(); }
      catch (error) { toast(error.message); }
      return;
    }
    const url = t.closest('[data-stk-send]')?.dataset.stkSend;
    if (url) send(url);
  }

  // ---------- Chat rendering ----------
  function messageHTML(msg) {
    return `<button type="button" class="chat-sticker" data-stk-msg="${esc(msg.imageUrl)}" aria-label="Sticker"><img src="${esc(msg.imageUrl)}" alt="Sticker" loading="lazy" draggable="false"></button>`;
  }

  // Tapping someone's sticker offers ADD TO MY STICKERS (WhatsApp style).
  document.addEventListener('click', event => {
    const sticker = event.target.closest('.chat-sticker[data-stk-msg]');
    if (!sticker) { if (!event.target.closest('.stk-save-pop')) document.querySelector('.stk-save-pop')?.remove(); return; }
    event.preventDefault();
    event.stopPropagation();
    document.querySelector('.stk-save-pop')?.remove();
    const url = sticker.dataset.stkMsg;
    const pop = document.createElement('div');
    pop.className = 'stk-save-pop';
    const saved = state.loaded && state.mine.some(s => s.url === url);
    pop.innerHTML = saved ? '<span>IN MY STICKERS</span>' : '<button type="button">+ ADD TO MY STICKERS</button>';
    const r = sticker.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 220, r.left)) + 'px';
    pop.style.top = Math.max(8, r.top - 44) + 'px';
    document.body.appendChild(pop);
    pop.querySelector('button')?.addEventListener('click', async () => {
      try {
        const body = await api('/api/stickers/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        if (state.loaded) state.mine = [body.sticker, ...state.mine.filter(s => s.url !== url)];
        pop.innerHTML = '<span>SAVED ✓</span>';
        setTimeout(() => pop.remove(), 1100);
      } catch (error) { pop.innerHTML = `<span>${esc(error.message)}</span>`; }
    });
  }, true);

  // ---------- Maker ----------
  const SHAPES = [['free', 'FREE'], ['rounded', 'ROUNDED'], ['circle', 'CIRCLE']];

  function openMaker(file) {
    closeMaker();
    const m = {
      img: null, zoom: 1, x: 0, y: 0, shape: 'rounded', outline: true, cutout: false, tolerance: 38,
      top: '', bottom: '', drag: null
    };
    const el = document.createElement('div');
    el.className = 'stk-maker';
    el.innerHTML = `
      <div class="stk-maker-card" role="dialog" aria-label="Sticker maker">
        <div class="stk-maker-head"><b>STICKER FORGE</b><small>MAKE YOUR OWN</small><button type="button" data-mk-close aria-label="Close">×</button></div>
        <div class="stk-maker-body">
          <div class="stk-stage">
            <canvas width="${SIZE}" height="${SIZE}"></canvas>
            <label class="stk-drop" data-mk-drop>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
              <b>CHOOSE AN IMAGE</b><small>or paste / drop it here</small>
            </label>
          </div>
          <div class="stk-controls">
            <label class="stk-row">ZOOM<input type="range" data-mk="zoom" min="0.2" max="4" step="0.01" value="1"></label>
            <div class="stk-row">SHAPE<span class="stk-seg">${SHAPES.map(([id, label]) => `<button type="button" data-mk-shape="${id}">${label}</button>`).join('')}</span></div>
            <label class="stk-row stk-check"><input type="checkbox" data-mk="cutout"> REMOVE BACKGROUND <small>plain backgrounds</small></label>
            <label class="stk-row" data-mk-tol hidden>STRENGTH<input type="range" data-mk="tolerance" min="5" max="120" step="1" value="38"></label>
            <label class="stk-row stk-check"><input type="checkbox" data-mk="outline" checked> WHITE OUTLINE</label>
            <label class="stk-row">TOP TEXT<input type="text" data-mk="top" maxlength="24" placeholder="optional"></label>
            <label class="stk-row">BOTTOM TEXT<input type="text" data-mk="bottom" maxlength="24" placeholder="optional"></label>
            <p class="stk-hint">Drag the image to frame it.</p>
            <div class="stk-actions">
              <button type="button" data-mk-change>CHANGE IMAGE</button>
              <button type="button" data-mk-save>SAVE</button>
              <button type="button" class="stk-primary" data-mk-send>SAVE &amp; SEND</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
    m.el = el;
    m.canvas = el.querySelector('canvas');
    m.ctx = m.canvas.getContext('2d');
    state.maker = m;
    const fileInput = el.querySelector('input[type=file]');

    const syncShape = () => el.querySelectorAll('[data-mk-shape]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mkShape === m.shape)));
    syncShape();

    el.addEventListener('click', event => {
      const t = event.target;
      if (t === el || t.closest('[data-mk-close]')) return closeMaker();
      if (t.closest('[data-mk-change]')) return fileInput.click();
      const shape = t.closest('[data-mk-shape]')?.dataset.mkShape;
      if (shape) { m.shape = shape; syncShape(); return draw(); }
      if (t.closest('[data-mk-save]')) return save(false);
      if (t.closest('[data-mk-send]')) return save(true);
    });
    el.addEventListener('input', event => {
      const key = event.target.dataset.mk;
      if (!key) return;
      m[key] = event.target.type === 'checkbox' ? event.target.checked : (event.target.type === 'range' ? Number(event.target.value) : event.target.value);
      if (key === 'cutout') {
        el.querySelector('[data-mk-tol]').hidden = !m.cutout;
        // A cut-out reads as a sticker when the outline hugs the subject.
        if (m.cutout) { m.shape = 'free'; syncShape(); }
      }
      draw();
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });
    el.addEventListener('dragover', event => event.preventDefault());
    el.addEventListener('drop', event => { event.preventDefault(); const f = event.dataTransfer?.files?.[0]; if (f) loadFile(f); });
    m.onPaste = event => { const f = Array.from(event.clipboardData?.files || []).find(x => /^image\//.test(x.type)); if (f) { event.preventDefault(); loadFile(f); } };
    document.addEventListener('paste', m.onPaste);
    m.onKey = event => { if (event.key === 'Escape') closeMaker(); };
    document.addEventListener('keydown', m.onKey);

    const point = event => { const r = m.canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * SIZE / r.width, y: (event.clientY - r.top) * SIZE / r.height }; };
    m.canvas.addEventListener('pointerdown', event => { if (!m.img) return; m.canvas.setPointerCapture(event.pointerId); const p = point(event); m.drag = { px: p.x, py: p.y, x: m.x, y: m.y }; });
    m.canvas.addEventListener('pointermove', event => { if (!m.drag) return; const p = point(event); m.x = m.drag.x + p.x - m.drag.px; m.y = m.drag.y + p.y - m.drag.py; draw(); });
    m.canvas.addEventListener('pointerup', () => { m.drag = null; });
    m.canvas.addEventListener('wheel', event => {
      if (!m.img) return;
      event.preventDefault();
      m.zoom = Math.max(0.2, Math.min(4, m.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08)));
      el.querySelector('[data-mk=zoom]').value = m.zoom;
      draw();
    }, { passive: false });

    if (file) loadFile(file);
    draw();
  }

  function closeMaker() {
    const m = state.maker;
    if (!m) return;
    document.removeEventListener('paste', m.onPaste);
    document.removeEventListener('keydown', m.onKey);
    m.el.remove();
    state.maker = null;
  }

  function loadFile(file) {
    const m = state.maker;
    if (!m) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('PNG, JPG, WEBP or GIF images only.');
    if (file.size > 15 * 1024 * 1024) return toast('Image is too large (15 MB max).');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      m.img = img;
      // Fit the image to cover the sticker, centred.
      m.zoom = Math.max(SIZE / img.width, SIZE / img.height);
      m.x = 0; m.y = 0;
      const zoomInput = m.el.querySelector('[data-mk=zoom]');
      zoomInput.min = String(Math.min(0.2, m.zoom / 3));
      zoomInput.max = String(Math.max(4, m.zoom * 4));
      zoomInput.value = m.zoom;
      m.el.classList.add('has-image');
      draw();
    };
    img.onerror = () => toast('That image could not be read.');
    img.src = url;
  }

  function shapePath(ctx, shape, inset) {
    const s = SIZE - inset * 2;
    ctx.beginPath();
    if (shape === 'circle') ctx.arc(SIZE / 2, SIZE / 2, s / 2, 0, Math.PI * 2);
    else if (shape === 'rounded') ctx.roundRect ? ctx.roundRect(inset, inset, s, s, s * 0.16) : ctx.rect(inset, inset, s, s);
    else ctx.rect(inset, inset, s, s);
  }

  // Flood-fills away the background from the outside in. The background
  // colour is sampled from the first opaque pixels met coming in from the
  // edges (median per channel); every edge-connected pixel within
  // `tolerance` of it becomes transparent.
  function removeBackground(ctx, tolerance) {
    const data = ctx.getImageData(0, 0, SIZE, SIZE);
    const px = data.data;
    const N = SIZE * SIZE;
    const seen = new Uint8Array(N);
    const ring = [];
    let queue = [];
    for (let i = 0; i < SIZE; i++) queue.push(i, (SIZE - 1) * SIZE + i, i * SIZE, i * SIZE + SIZE - 1);
    // Pass 1: walk the transparent outside, collecting the opaque ring.
    const ringSeen = new Uint8Array(N);
    while (queue.length) {
      const k = queue.pop();
      if (seen[k]) continue;
      if (px[k * 4 + 3] > 8) { if (!ringSeen[k]) { ringSeen[k] = 1; ring.push(k); } continue; }
      seen[k] = 1;
      const x = k % SIZE, y = (k - x) / SIZE;
      if (x > 0) queue.push(k - 1); if (x < SIZE - 1) queue.push(k + 1);
      if (y > 0) queue.push(k - SIZE); if (y < SIZE - 1) queue.push(k + SIZE);
    }
    if (!ring.length) return;
    const median = c => { const v = ring.map(k => px[k * 4 + c]).sort((m, n) => m - n); return v[v.length >> 1]; };
    const ref = [median(0), median(1), median(2)];
    const t2 = tolerance * tolerance * 3;
    const near = k => { const o = k * 4, dr = px[o] - ref[0], dg = px[o + 1] - ref[1], db = px[o + 2] - ref[2]; return dr * dr + dg * dg + db * db <= t2; };
    // Pass 2: eat inward from the ring while pixels match the background.
    queue = ring.slice();
    while (queue.length) {
      const k = queue.pop();
      if (px[k * 4 + 3] === 0 && seen[k] === 2) continue;
      if (px[k * 4 + 3] > 8 && !near(k)) continue;
      px[k * 4 + 3] = 0;
      seen[k] = 2;
      const x = k % SIZE, y = (k - x) / SIZE;
      if (x > 0 && seen[k - 1] !== 2) queue.push(k - 1); if (x < SIZE - 1 && seen[k + 1] !== 2) queue.push(k + 1);
      if (y > 0 && seen[k - SIZE] !== 2) queue.push(k - SIZE); if (y < SIZE - 1 && seen[k + SIZE] !== 2) queue.push(k + SIZE);
    }
    ctx.putImageData(data, 0, 0);
  }

  function caption(ctx, text, y) {
    if (!text) return;
    const t = text.toUpperCase();
    let size = 64;
    ctx.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    while (ctx.measureText(t).width > SIZE - 56 && size > 22) { size -= 2; ctx.font = `900 ${size}px Impact, 'Arial Black', sans-serif`; }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = '#000';
    ctx.strokeText(t, SIZE / 2, y);
    ctx.fillStyle = '#fff';
    ctx.fillText(t, SIZE / 2, y);
  }

  // Renders the finished sticker onto the maker canvas.
  function draw() {
    const m = state.maker;
    if (!m) return;
    const { ctx } = m;
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!m.img) return;
    const pad = m.outline ? 22 : 6;
    const art = document.createElement('canvas');
    art.width = art.height = SIZE;
    const a = art.getContext('2d');
    const w = m.img.width * m.zoom, h = m.img.height * m.zoom;
    a.drawImage(m.img, SIZE / 2 - w / 2 + m.x, SIZE / 2 - h / 2 + m.y, w, h);
    // Cut the background out of the whole picture first, then apply the shape.
    if (m.cutout) removeBackground(a, m.tolerance);
    a.globalCompositeOperation = 'destination-in';
    shapePath(a, m.shape, pad);
    a.fill();
    a.globalCompositeOperation = 'source-over';
    if (m.outline) {
      // White sticker border that follows the art's silhouette.
      const ring = document.createElement('canvas');
      ring.width = ring.height = SIZE;
      const r = ring.getContext('2d');
      const radius = 12;
      for (let deg = 0; deg < 360; deg += 15) {
        const rad = deg * Math.PI / 180;
        r.drawImage(art, Math.cos(rad) * radius, Math.sin(rad) * radius);
      }
      r.globalCompositeOperation = 'source-in';
      r.fillStyle = '#fff';
      r.fillRect(0, 0, SIZE, SIZE);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.drawImage(ring, 0, 0);
      ctx.restore();
    }
    ctx.drawImage(art, 0, 0);
    caption(ctx, m.top, 72);
    caption(ctx, m.bottom, SIZE - 72);
  }

  function toBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  async function save(andSend) {
    const m = state.maker;
    if (!m?.img) return toast('Choose an image first.');
    const buttons = m.el.querySelectorAll('.stk-actions button');
    buttons.forEach(b => { b.disabled = true; });
    try {
      let blob = await toBlob(m.canvas, 'image/webp', 0.9);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(m.canvas, 'image/png');
      for (let q = 0.8; blob && blob.size > MAX_BYTES && blob.type === 'image/webp' && q > 0.3; q -= 0.15) blob = await toBlob(m.canvas, 'image/webp', q);
      if (!blob || blob.size > MAX_BYTES) throw new Error('Sticker is too large. Try a simpler image.');
      const body = await api('/api/stickers', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
      state.mine = [body.sticker, ...state.mine.filter(s => s.url !== body.sticker.url)];
      closeMaker();
      if (andSend) send(body.sticker.url);
      else { state.tab = 'mine'; open(); }
    } catch (error) {
      toast(error.message);
      buttons.forEach(b => { b.disabled = false; });
    }
  }

  window.AsocStickers = { open, close, openMaker, messageHTML, _state: state };
})();
