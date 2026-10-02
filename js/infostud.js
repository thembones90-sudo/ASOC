// INFOSTUD -- the Shadow Broker's hidden personal storage for pictures and
// videos. Opened only by typing /infostud in the GM composer; listed nowhere.
// Files are fetched with the GM token header (never a public URL) and shown
// through object URLs that are revoked when the vault closes.
(() => {
  'use strict';
  const token = () => (window.GameData && GameData.gmToken) || sessionStorage.getItem('asoc_gm_token') || '';
  const api = (path, opts = {}) => fetch('/api/infostud' + path, { ...opts, headers: { ...(opts.headers || {}), 'x-gm-token': token() } });
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = n => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  const Infostud = {
    items: [],
    urls: new Map(),
    root: null,

    async open() {
      this.build();
      this.root.hidden = false;
      document.body.classList.add('infostud-open');
      await this.refresh();
    },

    close() {
      if (!this.root) return;
      this.root.hidden = true;
      this.closeViewer();
      document.body.classList.remove('infostud-open');
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
      this.urls.clear();
      this.root.querySelector('.ifs-grid').innerHTML = '';
    },

    build() {
      if (this.root) return;
      const el = document.createElement('div');
      el.className = 'ifs-overlay';
      el.hidden = true;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Infostud');
      el.innerHTML = `
        <section class="ifs-window">
          <header>
            <div><b>INFOSTUD</b><small class="ifs-usage">PRIVATE STORAGE</small></div>
            <label class="ifs-upload">UPLOAD<input type="file" accept="image/*,video/*" multiple hidden></label>
            <button type="button" class="ifs-close" aria-label="Close">×</button>
          </header>
          <p class="ifs-status" hidden></p>
          <div class="ifs-grid"></div>
          <p class="ifs-drop">DROP PICTURES OR VIDEOS ANYWHERE HERE</p>
        </section>
        <div class="ifs-viewer" hidden>
          <button type="button" class="ifs-v-close" aria-label="Close">×</button>
          <div class="ifs-v-stage"></div>
          <div class="ifs-v-bar"><span class="ifs-v-name"></span><a class="ifs-v-download" download>DOWNLOAD</a><button type="button" class="ifs-v-delete">DELETE</button></div>
        </div>`;
      document.body.appendChild(el);
      this.root = el;
      el.querySelector('.ifs-close').addEventListener('click', () => this.close());
      el.querySelector('.ifs-v-close').addEventListener('click', () => this.closeViewer());
      el.querySelector('input[type=file]').addEventListener('change', e => { this.upload([...e.target.files]); e.target.value = ''; });
      el.querySelector('.ifs-grid').addEventListener('click', e => {
        const card = e.target.closest('[data-ifs-id]');
        if (card) this.view(card.dataset.ifsId);
      });
      el.querySelector('.ifs-v-delete').addEventListener('click', () => this.remove(this.current));
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('is-drag'); });
      el.addEventListener('dragleave', e => { if (e.target === el) el.classList.remove('is-drag'); });
      el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('is-drag'); this.upload([...(e.dataTransfer?.files || [])]); });
      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || el.hidden) return;
        if (!el.querySelector('.ifs-viewer').hidden) this.closeViewer(); else this.close();
      });
      // Scroll-to-zoom + drag for pictures, like the Reliquary viewer.
      const stage = el.querySelector('.ifs-v-stage');
      stage.addEventListener('wheel', e => {
        const img = stage.querySelector('img');
        if (!img) return;
        e.preventDefault();
        const z = this.zoom;
        const next = Math.min(8, Math.max(.25, z.s * Math.exp(-e.deltaY * 0.0015)));
        const r = img.getBoundingClientRect();
        const px = (e.clientX - r.left) / z.s, py = (e.clientY - r.top) / z.s;
        z.x += px * (z.s - next); z.y += py * (z.s - next); z.s = next;
        this.applyZoom();
      }, { passive: false });
      let drag = null;
      stage.addEventListener('pointerdown', e => { if (stage.querySelector('img')) { drag = { x: e.clientX - this.zoom.x, y: e.clientY - this.zoom.y }; e.preventDefault(); } });
      window.addEventListener('pointermove', e => { if (drag) { this.zoom.x = e.clientX - drag.x; this.zoom.y = e.clientY - drag.y; this.applyZoom(); } });
      window.addEventListener('pointerup', () => { drag = null; });
      stage.addEventListener('dblclick', () => { this.zoom = { s: 1, x: 0, y: 0 }; this.applyZoom(); });
    },

    status(text, isError) {
      const p = this.root.querySelector('.ifs-status');
      p.textContent = text || '';
      p.hidden = !text;
      p.classList.toggle('is-error', !!isError);
    },

    async refresh() {
      const res = await api('').catch(() => null);
      if (!res || !res.ok) return this.status('INFOSTUD IS LOCKED // LOG IN AS THE SHADOW BROKER', true);
      const data = await res.json();
      this.items = data.items || [];
      this.usage(data.usage);
      this.render();
    },

    usage(u) {
      if (!u) return;
      this.root.querySelector('.ifs-usage').textContent = `PRIVATE STORAGE // ${size(u.used)} OF ${size(u.max)} // UP TO ${size(u.maxFile)} PER FILE`;
    },

    render() {
      const grid = this.root.querySelector('.ifs-grid');
      if (!this.items.length) { grid.innerHTML = '<p class="ifs-empty">NOTHING STORED YET</p>'; return; }
      grid.innerHTML = this.items.map(item => `
        <button type="button" class="ifs-card" data-ifs-id="${esc(item.id)}" title="${esc(item.name)}">
          <span class="ifs-thumb" data-kind="${item.type.startsWith('video/') ? 'video' : 'image'}"></span>
          <b>${esc(item.name)}</b><small>${esc(new Date(item.at).toLocaleDateString())} · ${esc(size(item.size))}</small>
        </button>`).join('');
      this.items.forEach(item => this.thumb(item));
    },

    async blobUrl(item) {
      if (this.urls.has(item.id)) return this.urls.get(item.id);
      const res = await api('/' + encodeURIComponent(item.id));
      if (!res.ok) throw new Error('load failed');
      const url = URL.createObjectURL(await res.blob());
      this.urls.set(item.id, url);
      return url;
    },

    async thumb(item) {
      const slot = this.root.querySelector(`[data-ifs-id="${CSS.escape(item.id)}"] .ifs-thumb`);
      if (!slot) return;
      if (item.type.startsWith('video/')) { slot.innerHTML = '<i>▶</i>'; return; }
      try { slot.innerHTML = `<img src="${await this.blobUrl(item)}" alt="">`; } catch { slot.innerHTML = '<i>!</i>'; }
    },

    async view(id) {
      const item = this.items.find(i => i.id === id);
      if (!item) return;
      this.current = id;
      const viewer = this.root.querySelector('.ifs-viewer');
      const stage = viewer.querySelector('.ifs-v-stage');
      stage.innerHTML = '<p class="ifs-loading">LOADING…</p>';
      viewer.querySelector('.ifs-v-name').textContent = item.name;
      viewer.hidden = false;
      try {
        const url = await this.blobUrl(item);
        stage.innerHTML = item.type.startsWith('video/') ? `<video src="${url}" controls autoplay playsinline></video>` : `<img src="${url}" alt="" draggable="false">`;
        const dl = viewer.querySelector('.ifs-v-download');
        dl.href = url;
        dl.download = item.name;
        this.zoom = { s: 1, x: 0, y: 0 };
        this.applyZoom();
      } catch { stage.innerHTML = '<p class="ifs-loading">COULD NOT LOAD THIS FILE</p>'; }
    },

    applyZoom() {
      const img = this.root?.querySelector('.ifs-v-stage img');
      if (img) img.style.transform = `translate(${this.zoom.x}px, ${this.zoom.y}px) scale(${this.zoom.s})`;
    },

    closeViewer() {
      const viewer = this.root?.querySelector('.ifs-viewer');
      if (!viewer) return;
      viewer.querySelector('.ifs-v-stage').innerHTML = '';
      viewer.hidden = true;
      this.current = null;
    },

    async remove(id) {
      const item = this.items.find(i => i.id === id);
      if (!item || !confirm(`DELETE "${item.name}" FROM INFOSTUD FOR GOOD?`)) return;
      const res = await api('/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => null);
      if (!res || !res.ok) return this.status('DELETE FAILED', true);
      const url = this.urls.get(id);
      if (url) { URL.revokeObjectURL(url); this.urls.delete(id); }
      this.closeViewer();
      this.usage((await res.json()).usage);
      this.items = this.items.filter(i => i.id !== id);
      this.render();
    },

    async upload(files) {
      const list = files.filter(f => /^(image|video)\//.test(f.type));
      if (!list.length) return this.status('ONLY PICTURES AND VIDEOS', true);
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        this.status(`UPLOADING ${i + 1}/${list.length} // ${f.name}`);
        const res = await api('', { method: 'POST', headers: { 'content-type': f.type, 'x-file-name': encodeURIComponent(f.name) }, body: f }).catch(() => null);
        if (!res || !res.ok) {
          const msg = res ? (await res.json().catch(() => ({}))).error : 'NETWORK ERROR';
          this.status(`${f.name} // ${msg || 'UPLOAD FAILED'}`, true);
          continue;
        }
        const data = await res.json();
        this.items.unshift(data.item);
        this.usage(data.usage);
        this.render();
      }
      if (!this.root.querySelector('.ifs-status').classList.contains('is-error')) this.status('');
    }
  };

  window.Infostud = Infostud;
})();
