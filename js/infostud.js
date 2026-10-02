// INFOSTUD -- the Shadow Broker's hidden personal file manager. Opened only by
// typing /infostud in the GM composer; listed nowhere. Any file type, whole
// folders, sort, multi-select and a Windows-style right-click menu. Files are
// fetched with the GM token header (never a public URL) and shown through
// object URLs that are revoked when the window closes.
(() => {
  'use strict';
  const token = () => (window.GameData && GameData.gmToken) || sessionStorage.getItem('asoc_gm_token') || '';
  const api = (p, opts = {}) => fetch('/api/infostud' + p, { ...opts, headers: { ...(opts.headers || {}), 'x-gm-token': token() } });
  const json = (p, method, body) => api(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const size = n => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  const when = ms => new Date(ms).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const nameExt = i => { const d = i.name.lastIndexOf('.'); return d > 0 ? i.name.slice(d + 1).toLowerCase() : ''; };
  const isImage = i => i.kind === 'file' && ((/^image\//.test(i.type) && !/heic|heif|svg/.test(i.type)) || ['gif', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp'].includes(nameExt(i)));
  const isVideo = i => i.kind === 'file' && (/^video\//.test(i.type) || ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv'].includes(nameExt(i)));
  const isPdf = i => i.kind === 'file' && i.type === 'application/pdf';
  // Opened in the built-in notepad instead of downloaded.
  const TEXT_EXT = new Set(['txt', 'md', 'log', 'csv', 'tsv', 'json', 'xml', 'ini', 'cfg', 'conf', 'yml', 'yaml', 'srt', 'vtt', 'nfo', 'html', 'htm', 'css', 'js', 'ts', 'py', 'sh', 'bat', 'ps1', 'sql', 'lua', 'rtf']);
  const extOf = name => { const d = name.lastIndexOf('.'); return d > 0 ? name.slice(d + 1).toLowerCase() : ''; };
  const isText = i => i.kind === 'file' && (/^text\//.test(i.type) || /json|xml|javascript|yaml|x-subrip|x-sh/.test(i.type) || TEXT_EXT.has(extOf(i.name)));
  // No extension at all (e.g. "notes"): try the notepad if it is small.
  const maybeText = i => i.kind === 'file' && !extOf(i.name) && i.size <= 2 * 1024 * 1024;
  const ext = name => { const d = name.lastIndexOf('.'); return d > 0 ? name.slice(d + 1).toUpperCase().slice(0, 4) : 'FILE'; };
  const SORTS = { name: 'NAME', created: 'DATE UPLOADED', modified: 'DATE MODIFIED', rating: 'RATING' };
  // Panini-style sticker tiers, lowest to highest.
  const TIERS = ['bronze', 'silver', 'gold', 'platinum'];
  const TIER_LABEL = { bronze: 'BRONZE', silver: 'SILVER', gold: 'GOLD', platinum: 'PLATINUM' };
  const ask = async (title, value) => {
    if (window.AsocDialog?.prompt) return window.AsocDialog.prompt({ title, message: '', defaultValue: value, value, maxLength: 180, required: true, confirmLabel: 'OK' });
    return prompt(title, value || '');
  };

  const F = {
    items: [],
    cwd: null,
    selected: new Set(),
    anchor: null,
    clipboard: null,       // { mode: 'cut' | 'copy', ids: [] }
    urls: new Map(),
    sort: (() => { try { return JSON.parse(localStorage.getItem('asoc_infostud_sort')) || { key: 'name', dir: 1 }; } catch { return { key: 'name', dir: 1 }; } })(),

    // ------------------------------------------------------------- open --
    async open() {
      this.build();
      this.root.hidden = false;
      document.body.classList.add('infostud-open');
      await this.refresh();
    },
    close() {
      if (!this.root) return;
      this.closeViewer();
      this.closeMenu();
      this.root.hidden = true;
      document.body.classList.remove('infostud-open');
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
      this.urls.clear();
      this.$('.ifs-grid').innerHTML = '';
    },
    $(sel) { return this.root.querySelector(sel); },

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
            <div class="ifs-title"><b>INFOSTUD</b><small class="ifs-usage">PRIVATE STORAGE</small></div>
            <button type="button" class="ifs-close" aria-label="Close">×</button>
          </header>
          <nav class="ifs-bar">
            <button type="button" class="ifs-btn ifs-up" data-act="up" title="Up one level (Backspace)">↑</button>
            <div class="ifs-crumbs"></div>
            <label class="ifs-sort">SORT
              <select class="ifs-sort-key">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
            </label>
            <button type="button" class="ifs-btn ifs-sort-dir" data-act="sortdir" title="Ascending / descending">↑</button>
            <button type="button" class="ifs-btn" data-act="newfolder">+ NEW FOLDER</button>
            <button type="button" class="ifs-btn" data-act="upfiles">UPLOAD FILES</button>
            <button type="button" class="ifs-btn" data-act="upfolder">UPLOAD FOLDER</button>
            <button type="button" class="ifs-btn is-danger" data-act="purge" title="Delete everything in Infostud">PURGE</button>
            <input type="file" class="ifs-in-files" multiple hidden>
            <input type="file" class="ifs-in-folder" webkitdirectory directory multiple hidden>
          </nav>
          <p class="ifs-status" hidden></p>
          <div class="ifs-grid" tabindex="0"></div>
          <footer class="ifs-foot"><span class="ifs-count"></span><span>RIGHT-CLICK FOR OPTIONS · DRAG FILES OR FOLDERS IN TO UPLOAD</span></footer>
        </section>
        <div class="ifs-menu" hidden></div>
        <div class="ifs-props" hidden></div>
        <div class="ifs-viewer" hidden>
          <button type="button" class="ifs-v-close" aria-label="Close">×</button>
          <div class="ifs-v-stage"></div>
          <div class="ifs-v-bar"><span class="ifs-v-name"></span><button type="button" class="ifs-btn is-save" data-v="save" hidden>SAVE</button><button type="button" class="ifs-btn" data-v="download">DOWNLOAD</button><button type="button" class="ifs-btn is-danger" data-v="delete">DELETE</button></div>
        </div>`;
      document.body.appendChild(el);
      this.root = el;
      this.$('.ifs-sort-key').value = this.sort.key;
      this.bind();
    },

    bind() {
      const el = this.root;
      const grid = this.$('.ifs-grid');
      this.$('.ifs-close').addEventListener('click', () => this.close());
      this.$('.ifs-bar').addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        const crumb = e.target.closest('[data-crumb]');
        if (crumb) return this.go(crumb.dataset.crumb || null);
        if (act) this.action(act);
      });
      this.$('.ifs-sort-key').addEventListener('change', e => this.setSort(e.target.value, this.sort.dir));
      this.$('.ifs-in-files').addEventListener('change', e => { this.uploadList([...e.target.files].map(f => ({ file: f, rel: f.name })), this.cwd); e.target.value = ''; });
      this.$('.ifs-in-folder').addEventListener('change', e => { this.uploadList([...e.target.files].map(f => ({ file: f, rel: f.webkitRelativePath || f.name })), this.cwd); e.target.value = ''; });

      grid.addEventListener('click', e => {
        const card = e.target.closest('[data-id]');
        if (!card) { if (!e.ctrlKey && !e.shiftKey) this.select([]); return; }
        this.clickSelect(card.dataset.id, e);
      });
      grid.addEventListener('mouseover', e => {
        const v = e.target.closest?.('.ifs-thumb.is-video')?.querySelector('video');
        if (v && v.paused) v.play().catch(() => {});
      });
      grid.addEventListener('mouseout', e => {
        const slot = e.target.closest?.('.ifs-thumb.is-video');
        if (!slot || slot.contains(e.relatedTarget)) return;
        const v = slot.querySelector('video');
        if (v) { v.pause(); try { v.currentTime = 0.5; } catch {} }
      });
      grid.addEventListener('dblclick', e => { const card = e.target.closest('[data-id]'); if (card) this.openItem(card.dataset.id); });
      grid.addEventListener('contextmenu', e => {
        e.preventDefault();
        const card = e.target.closest('[data-id]');
        if (card && !this.selected.has(card.dataset.id)) this.select([card.dataset.id]);
        if (!card) this.select([]);
        this.showMenu(e.clientX, e.clientY, card ? 'item' : 'blank');
      });
      // Internal drag: move selection onto a folder card (or a crumb).
      grid.addEventListener('dragstart', e => {
        const card = e.target.closest('[data-id]');
        if (!card) return;
        if (!this.selected.has(card.dataset.id)) this.select([card.dataset.id]);
        e.dataTransfer.setData('application/x-infostud', JSON.stringify([...this.selected]));
        e.dataTransfer.effectAllowed = 'move';
      });
      const dropTarget = e => e.target.closest('.ifs-card.is-folder[data-id], [data-crumb]');
      el.addEventListener('dragover', e => {
        e.preventDefault();
        el.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop'));
        (dropTarget(e) || this.$('.ifs-window')).classList.add('is-drop');
      });
      el.addEventListener('dragleave', e => { if (e.target === el) el.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop')); });
      el.addEventListener('drop', async e => {
        e.preventDefault();
        el.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop'));
        const target = dropTarget(e);
        const into = target ? (target.dataset.id || target.dataset.crumb || null) : this.cwd;
        const internal = e.dataTransfer.getData('application/x-infostud');
        if (internal) {
          const ids = JSON.parse(internal).filter(id => id !== into);
          if (ids.length && (target || into !== this.cwd)) await this.move(ids, into);
          return;
        }
        this.uploadList(await this.readDrop(e.dataTransfer), into);
      });
      document.addEventListener('click', e => { if (!e.target.closest('.ifs-menu')) this.closeMenu(); });
      document.addEventListener('keydown', e => this.key(e));
      this.$('.ifs-props').addEventListener('click', e => { if (e.target.closest('[data-props-close]') || e.target === this.$('.ifs-props')) this.$('.ifs-props').hidden = true; });

      // Viewer: scroll-to-zoom + drag for pictures.
      this.$('.ifs-v-close').addEventListener('click', () => this.closeViewer());
      this.$('.ifs-v-bar').addEventListener('click', e => {
        const v = e.target.closest('[data-v]')?.dataset.v;
        if (v === 'save') this.saveText();
        if (v === 'download') this.download([this.viewing]);
        if (v === 'delete') this.remove([this.viewing]).then(ok => ok && this.closeViewer(true));
      });
      const stage = this.$('.ifs-v-stage');
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
      stage.addEventListener('pointerdown', e => { if (e.target.tagName === 'IMG') { drag = { x: e.clientX - this.zoom.x, y: e.clientY - this.zoom.y }; e.preventDefault(); } });
      window.addEventListener('pointermove', e => { if (drag) { this.zoom.x = e.clientX - drag.x; this.zoom.y = e.clientY - drag.y; this.applyZoom(); } });
      window.addEventListener('pointerup', () => { drag = null; });
      stage.addEventListener('dblclick', () => { this.zoom = { s: 1, x: 0, y: 0 }; this.applyZoom(); });
    },

    // ------------------------------------------------------------- data --
    async refresh() {
      const res = await api('').catch(() => null);
      if (!res || !res.ok) return this.status('INFOSTUD IS LOCKED // LOG IN AS THE SHADOW BROKER', true);
      const data = await res.json();
      this.items = data.items || [];
      this.usage(data.usage);
      if (this.cwd && !this.get(this.cwd)) this.cwd = null;
      this.render();
    },
    get(id) { return this.items.find(i => i.id === id) || null; },
    kids(id) { return this.items.filter(i => i.parentId === (id || null)); },
    tree(id) { const out = []; const walk = p => this.kids(p).forEach(k => { out.push(k); if (k.kind === 'folder') walk(k.id); }); walk(id); return out; },
    usage(u) { if (u) this.$('.ifs-usage').textContent = `PRIVATE STORAGE // ${size(u.used)} OF ${size(u.max)} // UP TO ${size(u.maxFile)} PER FILE`; },
    status(text, isError) { const p = this.$('.ifs-status'); p.textContent = text || ''; p.hidden = !text; p.classList.toggle('is-error', !!isError); },

    sorted() {
      const { key, dir } = this.sort;
      const val = i => (key === 'name' ? i.name.toLowerCase() : key === 'created' ? i.createdAt : key === 'rating' ? TIERS.indexOf(i.rating) : i.modifiedAt);
      return this.kids(this.cwd).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        const x = val(a), y = val(b);
        if (key === 'name') return dir * x.localeCompare(y, undefined, { numeric: true });
        return dir * (x - y) || a.name.localeCompare(b.name);
      });
    },
    setSort(key, dir) {
      this.sort = { key: SORTS[key] ? key : 'name', dir: dir === -1 ? -1 : 1 };
      try { localStorage.setItem('asoc_infostud_sort', JSON.stringify(this.sort)); } catch {}
      this.$('.ifs-sort-key').value = this.sort.key;
      this.render();
    },

    // ----------------------------------------------------------- render --
    render() {
      const list = this.sorted();
      this.visible = list.map(i => i.id);
      [...this.selected].forEach(id => { if (!this.visible.includes(id)) this.selected.delete(id); });
      const crumbs = [];
      for (let cur = this.cwd && this.get(this.cwd); cur; cur = cur.parentId && this.get(cur.parentId)) crumbs.unshift(cur);
      this.$('.ifs-crumbs').innerHTML = `<button type="button" data-crumb="">INFOSTUD</button>` + crumbs.map(c => `<span>›</span><button type="button" data-crumb="${esc(c.id)}">${esc(c.name)}</button>`).join('');
      this.$('.ifs-up').disabled = !this.cwd;
      this.$('.ifs-sort-dir').textContent = this.sort.dir === 1 ? '↑' : '↓';
      const grid = this.$('.ifs-grid');
      const cut = this.clipboard?.mode === 'cut' ? new Set(this.clipboard.ids) : new Set();
      const dateKey = this.sort.key === 'created' ? 'createdAt' : 'modifiedAt';
      this.$('.ifs-sort-key').value = this.sort.key;
      grid.innerHTML = list.length ? list.map(i => {
        const meta = i.kind === 'folder' ? `${this.kids(i.id).length} ITEMS` : size(i.size);
        return `<button type="button" draggable="true" class="ifs-card${i.kind === 'folder' ? ' is-folder' : ''}${this.selected.has(i.id) ? ' is-selected' : ''}${cut.has(i.id) ? ' is-cut' : ''}${i.rating ? ` is-rated tier-${esc(i.rating)}` : ''}" data-id="${esc(i.id)}" title="${esc(i.name)}">
          ${i.rating ? `<em class="ifs-ribbon">${TIER_LABEL[i.rating]}</em><span class="ifs-holo"></span>` : ''}
          <span class="ifs-thumb">${i.kind === 'folder' ? '<i class="ifs-folder-ico"></i>' : isImage(i) ? '<i class="ifs-file-ico" data-ext="IMG"></i>' : isVideo(i) ? '<i class="ifs-file-ico is-video">▶</i>' : `<i class="ifs-file-ico" data-ext="${esc(ext(i.name))}"></i>`}</span>
          <b>${esc(i.name)}</b><small>${esc(when(i[dateKey]))} · ${esc(meta)}</small>
        </button>`;
      }).join('') : '<p class="ifs-empty">THIS FOLDER IS EMPTY // DROP FILES OR FOLDERS HERE</p>';
      this.$('.ifs-count').textContent = `${list.length} ITEM${list.length === 1 ? '' : 'S'}${this.selected.size ? ` // ${this.selected.size} SELECTED` : ''}`;
      this.loadThumbs(list.filter(i => isImage(i) || isVideo(i)));
    },
    // Pictures, GIFs and videos preview in their cards, loaded only when the
    // card scrolls into view. Videos show a frame and play muted on hover.
    loadThumbs(items) {
      this.thumbObserver?.disconnect();
      const byId = new Map(items.map(i => [i.id, i]));
      this.thumbObserver = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        this.thumbObserver.unobserve(entry.target);
        const item = byId.get(entry.target.closest('[data-id]')?.dataset.id);
        if (item) this.fillThumb(entry.target, item);
      }), { root: this.$('.ifs-grid'), rootMargin: '300px' });
      items.forEach(item => {
        const slot = this.root.querySelector(`[data-id="${CSS.escape(item.id)}"] .ifs-thumb`);
        if (slot) this.thumbObserver.observe(slot);
      });
    },
    async fillThumb(slot, item) {
      try {
        const url = await this.link(item);
        if (isVideo(item)) {
          slot.innerHTML = `<video src="${esc(url)}#t=0.5" muted loop playsinline preload="metadata" draggable="false"></video><i class="ifs-play">▶</i>`;
          slot.classList.add('is-video');
        } else slot.innerHTML = `<img src="${esc(url)}" alt="" draggable="false" decoding="async">`;
      } catch {}
    },
    // Signed, expiring media URL (cached for 5 h; the server allows 6 h).
    async link(item) {
      this.links = this.links || new Map();
      const hit = this.links.get(item.id);
      if (hit && hit.until > Date.now()) return hit.url;
      const res = await api('/' + encodeURIComponent(item.id) + '/link');
      if (!res.ok) throw new Error('link failed');
      const { url } = await res.json();
      this.links.set(item.id, { url, until: Date.now() + 5 * 3600 * 1000 });
      return url;
    },
    async blobUrl(item) {
      if (this.urls.has(item.id)) return this.urls.get(item.id);
      const res = await api('/' + encodeURIComponent(item.id));
      if (!res.ok) throw new Error('load failed');
      const url = URL.createObjectURL(await res.blob());
      this.urls.set(item.id, url);
      return url;
    },

    // -------------------------------------------------------- selection --
    select(ids) { this.selected = new Set(ids); this.anchor = ids[ids.length - 1] || null; this.paintSelection(); },
    paintSelection() {
      this.root.querySelectorAll('.ifs-card').forEach(c => c.classList.toggle('is-selected', this.selected.has(c.dataset.id)));
      const n = this.visible?.length || 0;
      this.$('.ifs-count').textContent = `${n} ITEM${n === 1 ? '' : 'S'}${this.selected.size ? ` // ${this.selected.size} SELECTED` : ''}`;
    },
    clickSelect(id, e) {
      if (e.shiftKey && this.anchor && this.visible.includes(this.anchor)) {
        const [a, b] = [this.visible.indexOf(this.anchor), this.visible.indexOf(id)].sort((x, y) => x - y);
        const range = this.visible.slice(a, b + 1);
        this.selected = new Set(e.ctrlKey ? [...this.selected, ...range] : range);
        return this.paintSelection();
      }
      if (e.ctrlKey || e.metaKey) {
        this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
        this.anchor = id;
        return this.paintSelection();
      }
      this.select([id]);
    },

    // ----------------------------------------------------------- actions --
    go(id) { this.cwd = id || null; this.select([]); this.render(); },
    openItem(id) {
      const item = this.get(id);
      if (!item) return;
      if (item.kind === 'folder') return this.go(item.id);
      if (isImage(item) || isVideo(item) || isPdf(item)) return this.view(item.id);
      if (isText(item) || maybeText(item)) return this.editText(item.id);
      this.download([item.id]);
    },
    action(act) {
      const sel = [...this.selected];
      switch (act) {
        case 'up': return this.cwd && this.go(this.get(this.cwd)?.parentId || null);
        case 'sortdir': return this.setSort(this.sort.key, -this.sort.dir);
        case 'newfolder': return this.newFolder();
        case 'newtext': return this.newText();
        case 'upfiles': return this.$('.ifs-in-files').click();
        case 'upfolder': return this.$('.ifs-in-folder').click();
        case 'open': return sel[0] && this.openItem(sel[0]);
        case 'download': return this.download(sel);
        case 'cut': this.clipboard = { mode: 'cut', ids: sel }; this.status(`${sel.length} CUT // PASTE INTO ANY FOLDER`); return this.render();
        case 'copy': this.clipboard = { mode: 'copy', ids: sel }; return this.status(`${sel.length} COPIED // PASTE INTO ANY FOLDER`);
        case 'paste': return this.paste(sel.length === 1 && this.get(sel[0])?.kind === 'folder' ? sel[0] : this.cwd);
        case 'rename': return sel.length === 1 && this.rename(sel[0]);
        case 'delete': return this.remove(sel);
        case 'props': return this.properties(sel.length ? sel : null);
        case 'selectall': return this.select(this.visible.slice());
        case 'refresh': return this.refresh();
        case 'purge': return this.purge();
        case 'sort-name': return this.setSort('name', this.sort.dir);
        case 'sort-created': return this.setSort('created', this.sort.dir);
        case 'sort-modified': return this.setSort('modified', this.sort.dir);
        case 'sort-rating': return this.setSort('rating', this.sort.dir);
        case 'rate-bronze': case 'rate-silver': case 'rate-gold': case 'rate-platinum': case 'rate-none':
          return this.rate(sel, act.slice(5) === 'none' ? null : act.slice(5));
      }
    },

    showMenu(x, y, mode) {
      const sel = [...this.selected];
      const one = sel.length === 1 ? this.get(sel[0]) : null;
      const canPaste = !!this.clipboard?.ids?.length;
      const rows = mode === 'item' ? [
        ['open', one?.kind === 'folder' ? 'Open' : 'Open', 'Enter', !one],
        ['download', sel.length > 1 ? `Download ${sel.length} items` : one?.kind === 'folder' ? 'Download as ZIP' : 'Download', '', false],
        null,
        ['cut', 'Cut', 'Ctrl+X'], ['copy', 'Copy', 'Ctrl+C'],
        ['paste', one?.kind === 'folder' ? 'Paste into folder' : 'Paste', 'Ctrl+V', !canPaste],
        null,
        ['rename', 'Rename', 'F2', !one], ['delete', 'Delete', 'Del'],
        null,
        ['rate-platinum', '◆ Rate Platinum', '4'], ['rate-gold', '● Rate Gold', '3'], ['rate-silver', '● Rate Silver', '2'], ['rate-bronze', '● Rate Bronze', '1'], ['rate-none', 'Remove rating', '0', !sel.some(id => this.get(id)?.rating)],
        null,
        ['props', 'Properties', 'Alt+Enter']
      ] : [
        ['sort-name', `Sort by name${this.sort.key === 'name' ? '  ✓' : ''}`], ['sort-created', `Sort by date uploaded${this.sort.key === 'created' ? '  ✓' : ''}`], ['sort-modified', `Sort by date modified${this.sort.key === 'modified' ? '  ✓' : ''}`], ['sort-rating', `Sort by rating${this.sort.key === 'rating' ? '  ✓' : ''}`],
        null,
        ['newfolder', 'New folder', 'Ctrl+Shift+N'], ['newtext', 'New text document'], ['paste', 'Paste', 'Ctrl+V', !canPaste],
        null,
        ['upfiles', 'Upload files…'], ['upfolder', 'Upload folder…'],
        null,
        ['selectall', 'Select all', 'Ctrl+A'], ['refresh', 'Refresh', 'F5'], ['props', 'Properties']
      ];
      const menu = this.$('.ifs-menu');
      menu.innerHTML = rows.map(r => r ? `<button type="button" data-menu="${r[0]}"${r[3] ? ' disabled' : ''}><span>${esc(r[1])}</span><kbd>${esc(r[2] || '')}</kbd></button>` : '<hr>').join('');
      menu.hidden = false;
      const w = menu.offsetWidth, h = menu.offsetHeight;
      menu.style.left = Math.min(x, innerWidth - w - 6) + 'px';
      menu.style.top = Math.min(y, innerHeight - h - 6) + 'px';
      menu.onclick = e => {
        const b = e.target.closest('[data-menu]');
        if (!b || b.disabled) return;
        this.closeMenu();
        this.action(b.dataset.menu);
      };
    },
    closeMenu() { const m = this.root?.querySelector('.ifs-menu'); if (m) m.hidden = true; },

    key(e) {
      if (!this.root || this.root.hidden) return;
      if (e.key === 'Escape') {
        if (!this.$('.ifs-menu').hidden) return this.closeMenu();
        if (!this.$('.ifs-props').hidden) { this.$('.ifs-props').hidden = true; return; }
        if (!this.$('.ifs-viewer').hidden) return this.closeViewer();
        return this.close();
      }
      if (!this.$('.ifs-viewer').hidden || e.target.closest?.('input, select, textarea, [contenteditable]') || document.querySelector('.asoc-dialog:not([hidden]), [role="alertdialog"]:not([hidden])')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const map = {
        Delete: 'delete', F2: 'rename', Enter: e.altKey ? 'props' : 'open', Backspace: 'up', F5: 'refresh'
      };
      let act = map[e.key];
      if (!ctrl && !e.altKey && /^[0-4]$/.test(e.key) && this.selected.size) act = 'rate-' + (['none', ...TIERS][Number(e.key)]);
      if (ctrl && !e.shiftKey) act = { a: 'selectall', x: 'cut', c: 'copy', v: 'paste' }[e.key.toLowerCase()] || act;
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') act = 'newfolder';
      if (!act) return;
      e.preventDefault();
      this.action(act);
    },

    async newFolder() {
      const name = await ask('NEW FOLDER', 'New folder');
      if (!name) return;
      const res = await json('/folder', 'POST', { name, parentId: this.cwd });
      if (!res.ok) return this.status((await res.json().catch(() => ({}))).error || 'COULD NOT CREATE FOLDER', true);
      const { item } = await res.json();
      this.items.push(item);
      this.render();
      this.select([item.id]);
    },
    async newText() {
      const name = await ask('NEW TEXT DOCUMENT', 'New Text Document.txt');
      if (!name) return;
      const res = await api('', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent(name), ...(this.cwd ? { 'x-parent-id': this.cwd } : {}) }, body: '' });
      if (!res.ok) return this.status((await res.json().catch(() => ({}))).error || 'COULD NOT CREATE FILE', true);
      const data = await res.json();
      this.items.push(data.item);
      this.usage(data.usage);
      this.render();
      this.select([data.item.id]);
      this.editText(data.item.id);
    },
    async rename(id) {
      const item = this.get(id);
      if (!item) return;
      const name = await ask('RENAME', item.name);
      if (!name || name === item.name) return;
      const res = await json('/' + encodeURIComponent(id), 'PATCH', { name });
      if (!res.ok) return this.status((await res.json().catch(() => ({}))).error || 'RENAME FAILED', true);
      Object.assign(item, (await res.json()).item);
      this.render();
    },
    async rate(ids, rating) {
      for (const id of ids) {
        const res = await json('/' + encodeURIComponent(id), 'PATCH', { rating });
        if (!res.ok) { this.status('RATING FAILED', true); continue; }
        Object.assign(this.get(id), (await res.json()).item);
      }
      this.render();
      this.paintSelection();
    },
    async move(ids, into) {
      for (const id of ids) {
        const res = await json('/' + encodeURIComponent(id), 'PATCH', { parentId: into || null });
        if (!res.ok) { this.status(`${this.get(id)?.name || 'ITEM'} // ${(await res.json().catch(() => ({}))).error || 'MOVE FAILED'}`, true); continue; }
        Object.assign(this.get(id), (await res.json()).item);
      }
      this.render();
    },
    async paste(into) {
      const clip = this.clipboard;
      if (!clip?.ids?.length) return;
      if (clip.mode === 'cut') {
        await this.move(clip.ids.filter(id => this.get(id) && id !== into), into);
        this.clipboard = null;
        this.status('');
        return this.render();
      }
      this.status(`PASTING ${clip.ids.length}…`);
      for (const id of clip.ids) {
        const res = await json('/' + encodeURIComponent(id) + '/copy', 'POST', { parentId: into || null });
        if (!res.ok) { this.status(`${this.get(id)?.name || 'ITEM'} // ${(await res.json().catch(() => ({}))).error || 'COPY FAILED'}`, true); continue; }
        const data = await res.json();
        this.items = data.items;
        this.usage(data.usage);
      }
      if (!this.$('.ifs-status').classList.contains('is-error')) this.status('');
      this.render();
    },
    async remove(ids) {
      const items = ids.map(id => this.get(id)).filter(Boolean);
      if (!items.length) return false;
      const what = items.length === 1 ? `"${items[0].name}"${items[0].kind === 'folder' ? ' and everything inside it' : ''}` : `these ${items.length} items`;
      if (!confirm(`Delete ${what} for good?`)) return false;
      for (const item of items) {
        const res = await api('/' + encodeURIComponent(item.id), { method: 'DELETE' }).catch(() => null);
        if (!res || !res.ok) { this.status(`${item.name} // DELETE FAILED`, true); continue; }
        this.usage((await res.json()).usage);
        const gone = new Set([item.id, ...this.tree(item.id).map(i => i.id)]);
        gone.forEach(id => { const u = this.urls.get(id); if (u) { URL.revokeObjectURL(u); this.urls.delete(id); } });
        this.items = this.items.filter(i => !gone.has(i.id));
      }
      this.select([]);
      this.render();
      return true;
    },
    async purge() {
      const files = this.items.filter(i => i.kind === 'file').length;
      const folders = this.items.length - files;
      if (!this.items.length) return this.status('INFOSTUD IS ALREADY EMPTY');
      const typed = await ask(`PURGE EVERYTHING? ${files} files and ${folders} folders will be gone for good. Type PURGE to confirm.`, '');
      if (String(typed || '').trim().toUpperCase() !== 'PURGE') return this.status('PURGE CANCELLED');
      const res = await api('', { method: 'DELETE', headers: { 'x-confirm': 'PURGE' } }).catch(() => null);
      if (!res || !res.ok) return this.status('PURGE FAILED', true);
      this.usage((await res.json()).usage);
      for (const url of this.urls.values()) URL.revokeObjectURL(url);
      this.urls.clear();
      this.items = [];
      this.clipboard = null;
      this.cwd = null;
      this.select([]);
      this.render();
      this.status('INFOSTUD PURGED');
    },
    async download(ids) {
      for (const id of ids) {
        const item = this.get(id);
        if (!item) continue;
        this.status(`PREPARING ${item.name}${item.kind === 'folder' ? '.zip' : ''}…`);
        const res = await api('/' + encodeURIComponent(id)).catch(() => null);
        if (!res || !res.ok) { this.status(`${item.name} // DOWNLOAD FAILED`, true); continue; }
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = item.kind === 'folder' ? `${item.name}.zip` : item.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      if (!this.$('.ifs-status').classList.contains('is-error')) this.status('');
    },
    properties(ids) {
      const panel = this.$('.ifs-props');
      const rows = [];
      if (!ids) {
        const here = this.cwd ? this.get(this.cwd) : null;
        const all = this.tree(this.cwd);
        rows.push(['Name', here ? here.name : 'INFOSTUD'], ['Contains', `${all.filter(i => i.kind === 'file').length} files, ${all.filter(i => i.kind === 'folder').length} folders`], ['Size', size(all.reduce((s, i) => s + (i.kind === 'file' ? i.size : 0), 0))]);
        if (here) rows.push(['Created', when(here.createdAt)], ['Modified', when(here.modifiedAt)]);
      } else if (ids.length === 1) {
        const i = this.get(ids[0]);
        const loc = []; for (let c = i.parentId && this.get(i.parentId); c; c = c.parentId && this.get(c.parentId)) loc.unshift(c.name);
        rows.push(['Name', i.name], ['Type', i.kind === 'folder' ? 'Folder' : `${ext(i.name)} file (${i.type})`], ['Location', ['INFOSTUD', ...loc].join(' › ')]);
        if (i.kind === 'folder') {
          const all = this.tree(i.id);
          rows.push(['Size', size(all.reduce((s, x) => s + (x.kind === 'file' ? x.size : 0), 0))], ['Contains', `${all.filter(x => x.kind === 'file').length} files, ${all.filter(x => x.kind === 'folder').length} folders`]);
        } else rows.push(['Size', `${size(i.size)} (${i.size.toLocaleString()} bytes)`]);
        rows.push(['Rating', i.rating ? TIER_LABEL[i.rating] : 'Not rated'], ['Uploaded', when(i.createdAt)], ['Modified', when(i.modifiedAt)]);
      } else {
        const items = ids.map(id => this.get(id)).filter(Boolean);
        const files = items.flatMap(i => i.kind === 'folder' ? this.tree(i.id).concat(i) : [i]).filter(i => i.kind === 'file');
        rows.push(['Selected', `${items.length} items`], ['Size', size(files.reduce((s, i) => s + i.size, 0))]);
      }
      panel.innerHTML = `<div class="ifs-props-card"><header><b>PROPERTIES</b><button type="button" data-props-close aria-label="Close">×</button></header><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
      panel.hidden = false;
    },

    // ---------------------------------------------------------- uploads --
    // DataTransfer -> [{file, rel}] including whole dropped folders.
    async readDrop(dt) {
      const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
      if (!entries.length) return [...(dt.files || [])].map(f => ({ file: f, rel: f.name }));
      const out = [];
      const walk = async (entry, prefix) => {
        if (entry.isFile) {
          const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
          if (file) out.push({ file, rel: prefix + file.name });
        } else if (entry.isDirectory) {
          out.push({ dir: true, rel: prefix + entry.name });
          const reader = entry.createReader();
          for (;;) {
            const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
            if (!batch.length) break;
            for (const child of batch) await walk(child, prefix + entry.name + '/');
          }
        }
      };
      for (const entry of entries) await walk(entry, '');
      return out;
    },
    async ensureFolder(baseId, parts, cache) {
      let parent = baseId || null;
      let key = String(parent);
      for (const name of parts) {
        key += '/' + name;
        if (cache.has(key)) { parent = cache.get(key); continue; }
        const res = await this.resilient(name, () => json('/folder', 'POST', { name, parentId: parent }));
        if (!res) throw new Error('SERVER UNREACHABLE');
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'FOLDER FAILED');
        const { item } = await res.json();
        this.items.push(item);
        cache.set(key, item.id);
        parent = item.id;
      }
      return parent;
    },
    // Busy = uploading or unsaved notepad text; app.js holds patch reloads.
    busy() { return this.uploading > 0 || !!this.textDirty; },
    idle() { if (!this.busy()) window.dispatchEvent(new Event('infostud:idle')); },
    // A deploy restarts the server mid-upload: wait until it answers again
    // (up to ~15 min), then the caller retries the same file.
    async waitForServer() {
      for (let i = 0; i < 300; i++) {
        try { if ((await fetch('/health', { cache: 'no-store' })).ok) return true; } catch {}
        await new Promise(r => setTimeout(r, 3000));
      }
      return false;
    },
    async resilient(label, fn) {
      for (let attempt = 0; ; attempt++) {
        let res;
        try { res = await fn(); } catch { res = null; }
        const restarting = !res || res.status === 502 || res.status === 503 || res.status === 504;
        if (!restarting || attempt >= 6) return res;
        this.status(`SERVER RESTARTING (NEW PATCH) // WILL RESUME: ${label}`);
        if (!(await this.waitForServer())) return res;
        if (!res) await this.refresh().catch(() => {});
      }
    },

    async uploadList(list, baseId) {
      if (!list.length) return;
      this.uploading = (this.uploading || 0) + 1;
      try { await this.uploadListInner(list, baseId); }
      finally { this.uploading--; this.idle(); }
    },
    async uploadListInner(list, baseId) {
      const cache = new Map();
      const files = list.filter(x => x.file);
      let done = 0, failed = 0;
      try {
        for (const d of list.filter(x => x.dir)) await this.ensureFolder(baseId, d.rel.split('/'), cache);
      } catch (e) { return this.status(e.message, true); }
      for (const { file, rel } of files) {
        done++;
        this.status(`UPLOADING ${done}/${files.length} // ${rel}`);
        try {
          const parts = rel.split('/');
          parts.pop();
          const parentId = await this.ensureFolder(baseId, parts, cache);
          const res = await this.resilient(rel, () => api('', { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-parent-id': parentId || '', 'x-last-modified': String(file.lastModified || '') }, body: file }));
          if (!res) throw new Error('SERVER UNREACHABLE');
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'UPLOAD FAILED');
          const data = await res.json();
          this.items.push(data.item);
          this.usage(data.usage);
        } catch (e) {
          failed++;
          this.status(`${rel} // ${e.message}`, true);
        }
        if (done % 5 === 0 || done === files.length) this.render();
      }
      this.render();
      if (!failed) this.status(`UPLOADED ${files.length} FILE${files.length === 1 ? '' : 'S'}`);
    },

    // ----------------------------------------------------------- viewer --
    async view(id) {
      const item = this.get(id);
      if (!item) return;
      this.viewing = id;
      const viewer = this.$('.ifs-viewer');
      const stage = viewer.querySelector('.ifs-v-stage');
      stage.innerHTML = '<p class="ifs-loading">LOADING…</p>';
      viewer.querySelector('.ifs-v-name').textContent = item.name;
      viewer.querySelector('[data-v="save"]').hidden = true;
      viewer.hidden = false;
      try {
        // Videos and pictures stream from a signed link (instant start, seeking);
        // PDFs keep the blob so the browser's PDF viewer is not sandboxed.
        const url = isPdf(item) ? await this.blobUrl(item) : await this.link(item);
        if (this.viewing !== id) return;
        stage.innerHTML = isVideo(item) ? `<video src="${esc(url)}" controls autoplay playsinline></video>`
          : isPdf(item) ? `<iframe src="${esc(url)}" title="${esc(item.name)}"></iframe>`
          : `<img src="${esc(url)}" alt="" draggable="false">`;
        this.zoom = { s: 1, x: 0, y: 0 };
        this.applyZoom();
      } catch { stage.innerHTML = '<p class="ifs-loading">COULD NOT LOAD THIS FILE</p>'; }
    },
    // ---------------------------------------------------------- notepad --
    async editText(id) {
      const item = this.get(id);
      if (!item) return;
      this.viewing = id;
      this.textDirty = false;
      const viewer = this.$('.ifs-viewer');
      const stage = viewer.querySelector('.ifs-v-stage');
      stage.innerHTML = '<p class="ifs-loading">LOADING…</p>';
      viewer.querySelector('.ifs-v-name').textContent = item.name;
      viewer.hidden = false;
      let text;
      try {
        const res = await api('/' + encodeURIComponent(item.id));
        if (!res.ok) throw new Error('load failed');
        const bytes = new Uint8Array(await res.arrayBuffer());
        // Binary after all (an extension-less image, say): download it instead.
        if (bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 8192).includes(0)) { this.closeViewer(true); return this.download([item.id]); }
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { text = new TextDecoder('windows-1250').decode(bytes); }
        text = text.replace(/^\uFEFF/, '');
      } catch { stage.innerHTML = '<p class="ifs-loading">COULD NOT LOAD THIS FILE</p>'; return; }
      if (this.viewing !== id) return;
      stage.innerHTML = '<textarea class="ifs-notepad" spellcheck="false" wrap="soft"></textarea>';
      const area = stage.querySelector('textarea');
      area.value = text;
      viewer.querySelector('[data-v="save"]').hidden = false;
      area.addEventListener('input', () => this.markText(true));
      area.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveText(); }
        if (e.key === 'Tab') { e.preventDefault(); area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end'); this.markText(true); }
      });
      area.focus();
      area.setSelectionRange(0, 0);
    },
    markText(dirty) {
      this.textDirty = dirty;
      const item = this.get(this.viewing);
      this.$('.ifs-v-name').textContent = (dirty ? '● ' : '') + (item?.name || '');
      this.$('[data-v="save"]').classList.toggle('is-dirty', dirty);
      if (!dirty) this.idle();
    },
    async saveText() {
      const area = this.root?.querySelector('.ifs-notepad');
      const id = this.viewing;
      if (!area || !id || this.textSaving) return;
      this.textSaving = true;
      const value = area.value;
      try {
        const res = await this.resilient('save', () => api('/' + encodeURIComponent(id), { method: 'PUT', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: value }));
        if (!res) throw new Error('unreachable');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return this.status(data.error || 'COULD NOT SAVE', true);
        const item = this.get(id);
        if (item) Object.assign(item, data.item);
        if (this.urls.has(id)) { URL.revokeObjectURL(this.urls.get(id)); this.urls.delete(id); }
        this.usage(data.usage);
        if (area.value === value) this.markText(false);
        this.render();
        this.status('SAVED');
      } catch { this.status('COULD NOT SAVE', true); }
      finally { this.textSaving = false; }
    },
    applyZoom() { const img = this.root?.querySelector('.ifs-v-stage img'); if (img) img.style.transform = `translate(${this.zoom.x}px, ${this.zoom.y}px) scale(${this.zoom.s})`; },
    closeViewer(force) {
      const v = this.root?.querySelector('.ifs-viewer');
      if (!v) return;
      if (!force && this.textDirty && !window.confirm('Close without saving your changes?')) return;
      this.textDirty = false;
      v.querySelector('.ifs-v-stage').innerHTML = '';
      v.querySelector('[data-v="save"]').hidden = true;
      v.querySelector('[data-v="save"]').classList.remove('is-dirty');
      v.hidden = true;
      this.viewing = null;
      this.idle();
    }
  };

  window.Infostud = F;
})();
