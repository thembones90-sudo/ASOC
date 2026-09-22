(() => {
  'use strict';

  const API = '/api/tweaks';
  const TYPES = [
    ['BUG', 'BUG', 'Something does not work as intended.'],
    ['IDEA', 'IDEA', 'A new mechanic, feature, command or improvement.'],
    ['VISUAL', 'UX / VISUAL', 'Layout, readability, animation or theme problem.'],
    ['QOL', 'QUALITY OF LIFE', 'It works, but it is awkward, slow or annoying.']
  ];
  const STATUSES = ['NEW','REVIEWED','APPROVED','IN_PROGRESS','FIXED','DECLINED','DUPLICATE'];
  let role = null;
  let launch = null;
  let overlay = null;
  let currentFile = null;
  let allTweaks = [];
  let selectedId = '';
  let filterType = 'ALL';
  let playerStatuses = null;
  let pollTimer = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const token = () => role === 'gm'
    ? (sessionStorage.getItem('asoc_gm_token') || '')
    : (localStorage.getItem('asoc_player_auth_token') || sessionStorage.getItem('asoc_player_auth_token') || '');

  const authHeaders = (json = false) => {
    const headers = {};
    if (role === 'gm') headers['x-gm-token'] = token();
    else headers['x-player-token'] = token();
    if (json) headers['content-type'] = 'application/json';
    return headers;
  };

  const api = async (path, options = {}) => {
    const response = await fetch(path, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || 'TWEAKS request failed');
    return body;
  };

  function showToast(message, id = '') {
    const old = document.querySelector('.tweaks-toast');
    if (old) old.remove();
    const toast = el('div', 'tweaks-toast');
    if (id) {
      const b = el('b', '', id + ' // ');
      toast.appendChild(b);
    }
    toast.appendChild(document.createTextNode(message));
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5200);
  }

  function statusLabel(value) {
    return String(value || '').replace(/_/g, ' ');
  }

  function formatTime(value) {
    const date = new Date(Number(value) || 0);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString([], { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  }

  function buildLaunch() {
    const existing = role === 'player' ? document.getElementById('player-tweaks-launch') : null;
    launch = existing || el('button', 'tweaks-launch');
    launch.type = 'button';
    launch.id = role === 'gm' ? 'gm-tweaks-launch' : 'player-tweaks-launch';
    if (!launch.querySelector('.tweaks-badge')) {
      launch.innerHTML = '<span aria-hidden="true">⚙</span><span>TWEAKS</span><span class="tweaks-badge">0</span>';
    }
    launch.addEventListener('click', openOverlay);

    if (role === 'gm') {
      const row = document.querySelector('.battle-controls-utility-row');
      if (row) {
        row.style.gridTemplateColumns = 'minmax(0,1.15fr) minmax(0,.72fr) minmax(0,.58fr)';
        row.appendChild(launch);
      } else {
        document.body.appendChild(launch);
      }
    } else if (!existing) {
      const anchor = document.querySelector('.hero-hud-identity-block');
      if (anchor) anchor.appendChild(launch);
      else document.body.appendChild(launch);
    }
  }

  function resolveRole() {
    if (role) return role;
    role = document.getElementById('app-layout') && sessionStorage.getItem('asoc_gm_token')
      ? 'gm'
      : (document.getElementById('game-screen') ? 'player' : null);
    return role;
  }

  function buildOverlay() {
    resolveRole();
    if (!role) return null;

    const existingOverlay = document.getElementById('asoc-tweaks-overlay');
    if (existingOverlay) {
      overlay = existingOverlay;
      return overlay;
    }

    overlay = el('div', 'tweaks-overlay');
    overlay.id = 'asoc-tweaks-overlay';
    overlay.hidden = true;
    overlay.innerHTML = role === 'gm' ? gmMarkup() : playerMarkup();
    document.body.appendChild(overlay);

    const closeButton = overlay.querySelector('.tweaks-close');
    if (closeButton) closeButton.addEventListener('click', closeOverlay);
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) closeOverlay();
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && overlay && !overlay.hidden) closeOverlay();
    });

    if (role === 'gm') bindGM();
    else bindPlayer();
    return overlay;
  }

  function playerMarkup() {
    return `
      <section class="tweaks-shell" role="dialog" aria-modal="true" aria-label="TWEAKS">
        <header class="tweaks-head">
          <div class="tweaks-head-copy">
            <div class="tweaks-kicker">LITTLE HERO → SHADOW BROKER</div>
            <div class="tweaks-title">TWEAKS // SYSTEM IMPROVEMENT CHANNEL</div>
            <div class="tweaks-subtitle">Found something broken? Unfortunately, you may be useful.</div>
          </div>
          <button type="button" class="tweaks-close" aria-label="Close TWEAKS">×</button>
        </header>
        <div class="tweaks-body">
          <div class="tweaks-pane">
            <h3 class="tweaks-section-title">WHAT HAVE YOU BROKEN?</h3>
            <form id="tweaks-player-form">
              <div class="tweaks-type-grid">
                ${TYPES.map(([value,label,copy], i) => `
                  <label class="tweaks-type">
                    <input type="radio" name="tweak-type" value="${value}" ${i === 0 ? 'checked' : ''}>
                    <strong>${label}</strong><small>${copy}</small>
                  </label>`).join('')}
              </div>
              <label class="tweaks-field"><span>TITLE</span><input id="tweaks-title-input" maxlength="80" placeholder="Short summary" required></label>
              <label class="tweaks-field"><span>WHAT HAPPENED / WHAT SHOULD CHANGE?</span><textarea id="tweaks-description-input" maxlength="2400" placeholder="Give the Shadow Broker enough detail to reproduce or understand it." required></textarea></label>
              <div id="tweaks-bug-extra" class="tweaks-bug-extra">
                <label class="tweaks-field"><span>WHAT DID YOU EXPECT?</span><textarea id="tweaks-expected-input" maxlength="1400" placeholder="What should have happened instead?"></textarea></label>
                <label class="tweaks-field"><span>CAN YOU MAKE IT HAPPEN AGAIN?</span><select id="tweaks-repro-input"><option value="">UNKNOWN</option><option value="YES">YES</option><option value="SOMETIMES">SOMETIMES</option><option value="NO">NO</option></select></label>
              </div>
              <input id="tweaks-evidence-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
              <div id="tweaks-evidence-zone" class="tweaks-evidence" tabindex="0">
                <strong>ATTACH EVIDENCE // CLICK · PASTE · DROP</strong>
                <small>PNG, JPG, WEBP or GIF · max 5 MB</small>
                <img id="tweaks-evidence-preview" class="tweaks-evidence-preview" alt="Evidence preview" hidden>
              </div>
              <button class="tweaks-submit" type="submit">SUBMIT TO SHADOW BROKER</button>
              <div id="tweaks-submit-status" class="tweaks-statusline"></div>
            </form>
          </div>
          <div class="tweaks-pane">
            <h3 class="tweaks-section-title">MY TWEAKS</h3>
            <div id="tweaks-player-stats" class="tweaks-stats"></div>
            <div id="tweaks-player-list" class="tweaks-list"><div class="tweaks-empty">NO REPORTS YET</div></div>
          </div>
        </div>
      </section>`;
  }

  function gmMarkup() {
    return `
      <section class="tweaks-shell" role="dialog" aria-modal="true" aria-label="TWEAKS Inbox">
        <header class="tweaks-head">
          <div class="tweaks-head-copy">
            <div class="tweaks-kicker">SHADOW BROKER // MAINTENANCE</div>
            <div class="tweaks-title">TWEAKS INBOX</div>
            <div class="tweaks-subtitle">Field reports from Little Heroes. Miraculously, some may be useful.</div>
          </div>
          <button type="button" class="tweaks-close" aria-label="Close TWEAKS">×</button>
        </header>
        <div class="tweaks-body">
          <div class="tweaks-pane">
            <div id="tweaks-gm-stats" class="tweaks-stats"></div>
            <div id="tweaks-filter-row" class="tweaks-list-toolbar"></div>
            <div id="tweaks-gm-list" class="tweaks-list"></div>
          </div>
          <div class="tweaks-pane">
            <div id="tweaks-gm-detail" class="tweaks-detail" hidden></div>
            <div id="tweaks-gm-empty" class="tweaks-empty">SELECT A FIELD REPORT</div>
          </div>
        </div>
      </section>`;
  }

  function openOverlay(event) {
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
    resolveRole();
    if (!role) return false;
    if (!overlay || !document.body.contains(overlay)) buildOverlay();
    if (!overlay) return false;
    overlay.hidden = false;
    overlay.removeAttribute('hidden');
    if (role === 'gm') refreshGM(true);
    else refreshPlayer(false);
    return true;
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.hidden = true;
  }

  function selectedType() {
    return overlay.querySelector('input[name="tweak-type"]:checked')?.value || 'BUG';
  }

  function updateBugFields() {
    const extra = overlay.querySelector('#tweaks-bug-extra');
    if (extra) extra.hidden = selectedType() !== 'BUG';
  }

  function setEvidence(file) {
    const status = overlay.querySelector('#tweaks-submit-status');
    if (!file) {
      currentFile = null;
      const preview = overlay.querySelector('#tweaks-evidence-preview');
      if (preview) {
        preview.hidden = true;
        preview.removeAttribute('src');
      }
      return;
    }
    const type = String(file.type || '').toLowerCase();
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(type)) {
      if (status) { status.textContent = 'Unsupported evidence format.'; status.className = 'tweaks-statusline is-error'; }
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      if (status) { status.textContent = 'Evidence must be 5 MB or smaller.'; status.className = 'tweaks-statusline is-error'; }
      return;
    }
    currentFile = file;
    const preview = overlay.querySelector('#tweaks-evidence-preview');
    if (preview) {
      const reader = new FileReader();
      reader.onload = () => { preview.src = reader.result; preview.hidden = false; };
      reader.readAsDataURL(file);
    }
    if (status) { status.textContent = 'Evidence staged: ' + file.name; status.className = 'tweaks-statusline'; }
  }

  function bindPlayer() {
    const form = overlay.querySelector('#tweaks-player-form');
    const fileInput = overlay.querySelector('#tweaks-evidence-input');
    const zone = overlay.querySelector('#tweaks-evidence-zone');

    overlay.querySelectorAll('input[name="tweak-type"]').forEach(input => input.addEventListener('change', updateBugFields));
    updateBugFields();

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
    });
    fileInput.addEventListener('change', () => {
      setEvidence(fileInput.files?.[0] || null);
      fileInput.value = '';
    });
    ['dragenter','dragover'].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.add('is-dragging');
    }));
    ['dragleave','drop'].forEach(name => zone.addEventListener(name, event => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
    }));
    zone.addEventListener('drop', event => setEvidence(event.dataTransfer?.files?.[0] || null));
    overlay.addEventListener('paste', event => {
      if (overlay.hidden) return;
      const file = Array.from(event.clipboardData?.files || []).find(item => item.type?.startsWith('image/'));
      if (file) {
        event.preventDefault();
        setEvidence(file);
      }
    });

    form.addEventListener('submit', submitPlayerTweak);
  }

  function currentContext() {
    const viewport = window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x';
    const base = {
      path: location.pathname,
      viewport,
      client: navigator.userAgent,
      build: document.querySelector('script[src*="player.js"],script[src*="app.js"]')?.src.split('?v=')[1] || ''
    };
    try {
      if (typeof PlayerApp !== 'undefined') {
        base.mode = PlayerApp.roomMode || '';
        base.roomState = PlayerApp.masterArmed ? 'ARMED' : 'CASUAL';
        base.theme = PlayerApp.themeId || '';
        base.gameId = PlayerApp.lastPublicState?.gameId || '';
        base.gameTitle = PlayerApp.lastPublicState?.gameTitle || PlayerApp.lastPublicState?.title || '';
        const timer = PlayerApp.lastPublicState?.timer || {};
        if (timer.phase) base.timer = timer.phase + ' // ' + Math.max(0, Math.round(Number(timer.remaining || 0))) + 's';
        base.location = PlayerApp.roomMode === 'CASUAL' ? 'AMUSEMENT PARK' : 'ABUSEMENT PARK';
      } else if (typeof App !== 'undefined') {
        base.mode = App.roomMode || App.lastPublicState?.roomMode || '';
        base.roomState = App.gameComplete ? 'GAME_COMPLETE' : (App.roomCode ? 'MASTER' : 'LOCAL');
        base.gameId = typeof GameData !== 'undefined' ? (GameData.currentGame?.id || '') : '';
        base.gameTitle = typeof GameData !== 'undefined' ? (GameData.currentGame?.title || '') : '';
        base.location = 'SHADOW BROKER CONSOLE';
      }
    } catch (_) {}
    return base;
  }

  async function uploadEvidence(file) {
    if (!file) return '';
    const body = await api(API + '/evidence', {
      method: 'POST',
      headers: { ...authHeaders(false), 'content-type': file.type },
      body: file
    });
    return body.evidenceUrl || '';
  }

  async function submitPlayerTweak(event) {
    event.preventDefault();
    const submit = overlay.querySelector('.tweaks-submit');
    const status = overlay.querySelector('#tweaks-submit-status');
    submit.disabled = true;
    status.className = 'tweaks-statusline';
    status.textContent = currentFile ? 'UPLOADING EVIDENCE...' : 'TRANSMITTING...';
    try {
      const evidenceUrl = await uploadEvidence(currentFile);
      status.textContent = 'TRANSMITTING FIELD REPORT...';
      const payload = {
        type: selectedType(),
        title: overlay.querySelector('#tweaks-title-input').value,
        description: overlay.querySelector('#tweaks-description-input').value,
        expected: overlay.querySelector('#tweaks-expected-input').value,
        reproducibility: overlay.querySelector('#tweaks-repro-input').value,
        evidenceUrl,
        context: currentContext()
      };
      const result = await api(API + '/player', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(payload)
      });
      status.className = 'tweaks-statusline is-ok';
      status.textContent = (result.tweak?.id || 'TWEAK') + ' RECEIVED // THE SHADOW BROKER HAS BEEN INCONVENIENCED.';
      event.currentTarget.reset();
      overlay.querySelector('input[name="tweak-type"][value="BUG"]').checked = true;
      updateBugFields();
      setEvidence(null);
      await refreshPlayer(false);
    } catch (error) {
      status.className = 'tweaks-statusline is-error';
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  }

  function playerStats(tweaks) {
    const open = tweaks.filter(t => !['FIXED','DECLINED','DUPLICATE'].includes(t.status)).length;
    const fixed = tweaks.filter(t => t.status === 'FIXED').length;
    const box = overlay.querySelector('#tweaks-player-stats');
    box.innerHTML = '';
    for (const [value,label] of [[open,'OPEN'],[fixed,'FIXED'],[tweaks.length,'TOTAL']]) {
      const stat = el('div','tweaks-stat');
      stat.append(el('b','',String(value)),el('span','',label));
      box.appendChild(stat);
    }
  }

  function renderPlayerList(tweaks) {
    playerStats(tweaks);
    const list = overlay.querySelector('#tweaks-player-list');
    list.innerHTML = '';
    if (!tweaks.length) {
      list.appendChild(el('div','tweaks-empty','NO REPORTS YET'));
      return;
    }
    for (const tweak of tweaks) {
      const card = el('div','tweaks-card');
      const id = el('div','tweaks-card-id',tweak.id);
      const main = el('div','tweaks-card-main');
      main.appendChild(el('div','tweaks-card-title',tweak.title));
      const meta = [tweak.type, formatTime(tweak.createdAt)];
      if (tweak.gmReply) meta.push('BROKER REPLIED');
      main.appendChild(el('div','tweaks-card-meta',meta.join(' // ')));
      if (tweak.gmReply) {
        const reply = el('div','tweaks-description','SHADOW BROKER: ' + tweak.gmReply);
        reply.style.marginBottom = '0';
        main.appendChild(reply);
      }
      const state = el('div','tweaks-card-status',statusLabel(tweak.status));
      state.dataset.status = tweak.status;
      card.append(id,main,state);
      list.appendChild(card);
    }
  }

  async function refreshPlayer(notify = true) {
    if (!token()) return;
    try {
      const body = await api(API + '/player', { headers: authHeaders(false) });
      const tweaks = Array.isArray(body.tweaks) ? body.tweaks : [];
      if (notify && playerStatuses) {
        for (const tweak of tweaks) {
          const previous = playerStatuses.get(tweak.id);
          if (previous && previous !== tweak.status) {
            showToast('Status changed: ' + statusLabel(previous) + ' → ' + statusLabel(tweak.status), tweak.id);
          }
        }
      }
      playerStatuses = new Map(tweaks.map(t => [t.id, t.status]));
      if (!overlay.hidden) renderPlayerList(tweaks);
    } catch (_) {}
  }

  function bindGM() {
    const row = overlay.querySelector('#tweaks-filter-row');
    for (const value of ['ALL','BUG','IDEA','VISUAL','QOL']) {
      const button = el('button','tweaks-filter', value === 'QOL' ? 'QOL' : value);
      button.type = 'button';
      button.dataset.filter = value;
      if (value === filterType) button.classList.add('is-active');
      button.addEventListener('click', () => {
        filterType = value;
        row.querySelectorAll('.tweaks-filter').forEach(btn => btn.classList.toggle('is-active', btn.dataset.filter === value));
        renderGMList();
      });
      row.appendChild(button);
    }
  }

  function setBadge(count) {
    if (!launch) return;
    const badge = launch.querySelector('.tweaks-badge');
    badge.textContent = String(count);
    launch.classList.toggle('has-badge', count > 0);
  }

  function renderGMStats() {
    const stats = overlay.querySelector('#tweaks-gm-stats');
    if (!stats) return;
    const newCount = allTweaks.filter(t => t.status === 'NEW').length;
    const openCount = allTweaks.filter(t => !['FIXED','DECLINED','DUPLICATE'].includes(t.status)).length;
    const fixedCount = allTweaks.filter(t => t.status === 'FIXED').length;
    stats.innerHTML = '';
    for (const [value,label] of [[newCount,'NEW'],[openCount,'OPEN'],[fixedCount,'FIXED'],[allTweaks.length,'TOTAL']]) {
      const stat = el('div','tweaks-stat');
      stat.append(el('b','',String(value)),el('span','',label));
      stats.appendChild(stat);
    }
    setBadge(newCount);
  }

  function renderGMList() {
    const list = overlay.querySelector('#tweaks-gm-list');
    if (!list) return;
    list.innerHTML = '';
    const rows = filterType === 'ALL' ? allTweaks : allTweaks.filter(t => t.type === filterType);
    if (!rows.length) {
      list.appendChild(el('div','tweaks-empty','NO MATCHING FIELD REPORTS'));
      return;
    }
    for (const tweak of rows) {
      const card = el('div','tweaks-card');
      card.classList.toggle('is-selected', tweak.id === selectedId);
      const id = el('div','tweaks-card-id',tweak.id);
      const main = el('div','tweaks-card-main');
      main.append(el('div','tweaks-card-title',tweak.title),el('div','tweaks-card-meta',tweak.playerName + ' // ' + tweak.type + ' // ' + formatTime(tweak.createdAt)));
      const state = el('div','tweaks-card-status',statusLabel(tweak.status));
      state.dataset.status = tweak.status;
      card.append(id,main,state);
      card.addEventListener('click', () => {
        selectedId = tweak.id;
        renderGMList();
        renderGMDetail(tweak);
      });
      list.appendChild(card);
    }
  }

  function detailBox(label, value) {
    const box = el('div','tweaks-detail-box');
    box.append(el('b','',label),el('span','',value || '—'));
    return box;
  }

  function renderGMDetail(tweak) {
    const detail = overlay.querySelector('#tweaks-gm-detail');
    const empty = overlay.querySelector('#tweaks-gm-empty');
    detail.hidden = false;
    empty.hidden = true;
    detail.innerHTML = '';
    detail.appendChild(el('div','tweaks-card-id',tweak.id + ' // ' + tweak.type));
    detail.appendChild(el('h3','',tweak.title));

    const grid = el('div','tweaks-detail-grid');
    grid.append(detailBox('SUBMITTED BY', tweak.playerName), detailBox('REPRODUCIBLE', tweak.reproducibility || 'UNSPECIFIED'));
    detail.appendChild(grid);
    detail.appendChild(el('div','tweaks-description',tweak.description));

    if (tweak.expected) detail.appendChild(detailBox('EXPECTED', tweak.expected));

    if (tweak.evidenceUrl) {
      const link = el('a','tweaks-evidence-link');
      link.href = tweak.evidenceUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      const img = document.createElement('img');
      img.src = tweak.evidenceUrl;
      img.alt = 'TWEAK evidence';
      link.appendChild(img);
      detail.appendChild(link);
    }

    const context = el('div','tweaks-context');
    for (const [key,value] of Object.entries(tweak.context || {})) {
      context.appendChild(el('span','',key.toUpperCase() + ': ' + value));
    }
    if (context.childNodes.length) detail.appendChild(context);

    const controls = el('div','tweaks-gm-controls');
    const statusField = el('label','tweaks-field');
    statusField.appendChild(el('span','','STATUS'));
    const select = document.createElement('select');
    for (const status of STATUSES) {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = statusLabel(status);
      option.selected = status === tweak.status;
      select.appendChild(option);
    }
    statusField.appendChild(select);

    const dupField = el('label','tweaks-field');
    dupField.appendChild(el('span','','DUPLICATE OF'));
    const duplicate = document.createElement('input');
    duplicate.placeholder = 'TWK-0000';
    duplicate.maxLength = 20;
    duplicate.value = tweak.duplicateOf || '';
    dupField.appendChild(duplicate);

    const replyField = el('label','tweaks-field tweaks-gm-reply');
    replyField.appendChild(el('span','','SHADOW BROKER REPLY'));
    const reply = document.createElement('textarea');
    reply.maxLength = 700;
    reply.placeholder = 'Optional response visible to the player.';
    reply.value = tweak.gmReply || '';
    replyField.appendChild(reply);

    const save = el('button','tweaks-save','SAVE TWEAK');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      save.textContent = 'SAVING...';
      try {
        const body = await api(API + '/' + encodeURIComponent(tweak.id), {
          method:'PATCH',
          headers:authHeaders(true),
          body:JSON.stringify({ status:select.value, gmReply:reply.value, duplicateOf:duplicate.value })
        });
        if (body.tweak) {
          const index = allTweaks.findIndex(item => item.id === body.tweak.id);
          if (index >= 0) allTweaks[index] = body.tweak;
          renderGMStats();
          renderGMList();
          renderGMDetail(body.tweak);
          showToast('TWEAK updated.', body.tweak.id);
        }
      } catch (error) {
        showToast(error.message, tweak.id);
      } finally {
        save.disabled = false;
        save.textContent = 'SAVE TWEAK';
      }
    });

    controls.append(statusField,dupField,replyField,save);
    detail.appendChild(controls);
  }

  async function refreshGM(render = false) {
    if (!token()) return;
    try {
      const body = await api(API, { headers: authHeaders(false) });
      allTweaks = Array.isArray(body.tweaks) ? body.tweaks : [];
      const newCount = allTweaks.filter(t => t.status === 'NEW').length;
      setBadge(newCount);
      if (render && !overlay.hidden) {
        renderGMStats();
        renderGMList();
        const selected = allTweaks.find(t => t.id === selectedId);
        if (selected) renderGMDetail(selected);
      }
    } catch (_) {}
  }

  function init() {
    resolveRole();
    if (!role) return;
    buildLaunch();
    buildOverlay();

    if (role === 'gm') {
      refreshGM(false);
      pollTimer = setInterval(() => { if (!document.hidden) refreshGM(!overlay.hidden); }, 30000);
    } else {
      refreshPlayer(false);
      pollTimer = setInterval(() => { if (!document.hidden) refreshPlayer(true); }, 60000);
    }
  }

  // HARD FAIL-SAFE // delegated click survives any HUD redraw or lost direct
  // listener. This is deliberately installed before normal init completes.
  document.addEventListener('click', event => {
    const trigger = event.target?.closest?.('#player-tweaks-launch,#gm-tweaks-launch');
    if (!trigger) return;
    openOverlay(event);
  }, true);

  document.addEventListener('asoc:tweaks-open', event => openOverlay(event));

  window.ASOCTweaks = Object.freeze({
    open: openOverlay,
    close: closeOverlay
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
