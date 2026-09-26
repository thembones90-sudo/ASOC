// DIRECT MESSAGES -- Little Hero one-to-one conversations (player side).
// Opened from the HUD envelope chip, a dossier's SEND MESSAGE button, or
// "/w @Name message" in chat. The server (dm-store.js) owns identity,
// delivery, blocks, the "nobody" setting, rate limits and the Battle lock.
(function () {
  const state = {
    open: false,
    list: [],
    blocked: [],
    allow: 'everyone',
    locked: false,
    unread: 0,
    thread: null,        // { id, other, messages, otherReadAt, blocked, blockedYou }
    picking: false,
    error: '',
    notice: '',
    draft: {}
  };
  const app = () => window.PlayerApp;
  const send = m => app()?.send(m);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = t => new Date(Number(t) || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = t => new Date(Number(t) || 0).toLocaleDateString([], { month: 'short', day: '2-digit' });
  const battleLive = () => /^BATTLE/.test(String(app()?.roomMode || ''));
  const locked = () => state.locked || battleLive();

  function railRoot() {
    let rail = document.getElementById('dmx-rail');
    if (rail) return rail;
    rail = document.createElement('aside');
    rail.id = 'dmx-rail';
    rail.className = 'dmx-rail';
    rail.setAttribute('aria-label', 'Private messages');
    rail.addEventListener('click', e => {
      const person = e.target.closest?.('[data-dmx-rail-player]');
      if (person) return open(person.dataset.dmxRailPlayer);
      if (e.target.closest?.('[data-dmx-rail-new]')) { open(); state.picking = true; return render(); }
    });
    document.body.appendChild(rail);
    return rail;
  }

  function railAvatar(p) {
    const src = typeof p?.avatarData === 'string' && p.avatarData.startsWith('data:image/') ? p.avatarData : '';
    const initials = esc(String(p?.name || 'LH').trim().slice(0, 2).toUpperCase());
    return src ? `<img src="${esc(src)}" alt="">` : `<span>${initials}</span>`;
  }

  function renderRail() {
    const rail = railRoot();
    const screen = document.getElementById('game-screen');
    const casual = !!screen?.classList.contains('room-mode-casual');
    rail.classList.toggle('is-casual', casual);
    if (!casual) { rail.innerHTML = ''; return; }
    const conversations = new Map((state.list || []).map(c => [String(c.other.id), c]));
    const people = candidates();
    rail.innerHTML = `<div class="dmx-rail-head"><span>PRIVATE</span>${state.unread ? `<b>${state.unread}</b>` : ''}</div>
      <div class="dmx-rail-people">${people.map(p => {
        const c = conversations.get(String(p.id));
        const unread = Number(c?.unread || 0);
        return `<button type="button" class="dmx-rail-person${state.thread?.other?.id === p.id ? ' active' : ''}${unread ? ' unread' : ''}" data-dmx-rail-player="${esc(p.id)}" title="${esc(p.name)}${unread ? ` // ${unread} unread` : ''}">
          <i class="dmx-rail-avatar" style="--dmx-frame:${esc(p.frameColor || '#37d997')}">${railAvatar(p)}</i>
          <em class="dmx-rail-presence${p.online ? ' on' : ''}"></em>${unread ? `<b class="dmx-rail-badge">${unread}</b>` : ''}<span>${esc(p.name)}</span>
        </button>`;
      }).join('')}</div>
      <button type="button" class="dmx-rail-new" data-dmx-rail-new title="New private message">+</button>`;
  }

  function root() {
    let el = document.getElementById('direct-messages');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'direct-messages';
    el.className = 'dmx-overlay';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Direct messages');
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('input', onInput);
    document.body.appendChild(el);
    return el;
  }

  function open(playerId) {
    state.open = true;
    state.error = '';
    state.notice = '';
    const el = root();
    el.hidden = false;
    el.classList.toggle('dmx-casual-drawer', document.getElementById('game-screen')?.classList.contains('room-mode-casual'));
    document.body.classList.add('dmx-open');
    renderRail();
    send({ type: 'dm:list' });
    if (playerId) openThread(playerId);
    render();
  }

  function close() {
    state.open = false;
    state.thread = null;
    state.picking = false;
    const el = document.getElementById('direct-messages');
    if (el) el.hidden = true;
    document.body.classList.remove('dmx-open');
    renderRail();
  }

  function openThread(playerId) {
    state.picking = false;
    state.error = '';
    send({ type: 'dm:open', playerId: String(playerId) });
  }

  // ------------------------------------------------------------------ HUD
  function setUnread(n) {
    state.unread = Math.max(0, Number(n) || 0);
    const value = document.getElementById('hero-hud-dm');
    const chip = document.getElementById('hero-hud-dm-chip');
    if (value) value.textContent = String(state.unread);
    chip?.classList.toggle('has-unread', state.unread > 0);
    renderRail();
  }

  function toast(from, text) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'dmx-toast';
    el.innerHTML = `<b>✉ ${esc(from.name)}</b><span>${esc(String(text).slice(0, 90))}</span>`;
    el.addEventListener('click', () => { el.remove(); open(from.id); });
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  // --------------------------------------------------------------- render
  function candidates() {
    const me = String(app()?.playerId || '');
    const blocked = new Set(state.blocked);
    return (app()?.currentPlayers || [])
      .filter(p => String(p.id) !== me && !String(p.id).startsWith('__MASTER_TEST__:'))
      .map(p => ({ id: String(p.id), name: p.name || 'Little Hero', online: p.connected !== false, blocked: blocked.has(String(p.id)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function listHTML() {
    const rows = state.list.map(c => `
      <button type="button" class="dmx-row${state.thread?.other?.id === c.other.id ? ' on' : ''}${c.unread ? ' unread' : ''}" data-thread="${esc(c.other.id)}">
        <span class="dmx-row-top"><strong>${esc(c.other.name)}</strong>${c.last ? `<em>${esc(day(c.last.at))}</em>` : ''}</span>
        <span class="dmx-row-last">${c.blocked ? 'BLOCKED' : c.last ? `${c.last.from === String(app()?.playerId) ? 'You: ' : ''}${esc(c.last.text)}` : ''}</span>
        ${c.unread ? `<b class="dmx-badge">${c.unread}</b>` : ''}
      </button>`).join('');
    return `
      <button type="button" class="dmx-new" data-new>+ NEW MESSAGE</button>
      ${rows || '<p class="dmx-empty">NO CONVERSATIONS YET</p>'}`;
  }

  function pickerHTML() {
    const list = candidates();
    return `
      <div class="dmx-thread-head"><strong>NEW MESSAGE</strong><span class="dmx-sp"></span><button type="button" class="dmx-btn" data-cancel-pick>CANCEL</button></div>
      <div class="dmx-picker">${list.length
        ? list.map(p => `<button type="button" class="dmx-pick" data-thread="${esc(p.id)}"${p.blocked ? ' disabled' : ''}><i class="dmx-dot${p.online ? ' on' : ''}"></i>${esc(p.name)}${p.blocked ? ' <em>BLOCKED</em>' : ''}</button>`).join('')
        : '<p class="dmx-empty">NO OTHER LITTLE HEROES IN THE ROOM</p>'}</div>`;
  }

  function threadHTML() {
    if (state.picking) return pickerHTML();
    const t = state.thread;
    if (!t) return '<p class="dmx-empty dmx-empty-big">SELECT A CONVERSATION<br>OR START A NEW ONE</p>';
    const me = String(app()?.playerId || '');
    let lastDay = '';
    const mine = t.messages.filter(m => m.from === me);
    const lastMine = mine[mine.length - 1];
    const msgs = t.messages.map(m => {
      const d = day(m.at);
      const divider = d !== lastDay ? `<div class="dmx-day">${esc(d)}</div>` : '';
      lastDay = d;
      const seen = lastMine && m.id === lastMine.id && t.otherReadAt >= m.at ? '<span class="dmx-seen">SEEN</span>' : '';
      return `${divider}<div class="dmx-msg${m.from === me ? ' mine' : ''}"><p>${esc(m.text)}</p><span>${esc(time(m.at))}</span>${seen}</div>`;
    }).join('');
    const blockedNote = t.blocked
      ? '<div class="dmx-note">YOU BLOCKED THIS LITTLE HERO. UNBLOCK TO WRITE AGAIN.</div>'
      : '';
    const lockNote = locked() ? '<div class="dmx-note dmx-lock">SILENCE // THE MATCH IS LIVE. DIRECT MESSAGES REOPEN AFTER THE BATTLE.</div>' : '';
    const canWrite = !t.blocked && !locked();
    const draft = state.draft[t.other.id] || '';
    return `
      <div class="dmx-thread-head">
        <i class="dmx-dot${t.other.online ? ' on' : ''}"></i><strong>${esc(t.other.name)}</strong>
        <span class="dmx-sp"></span>
        ${t.id ? '<button type="button" class="dmx-btn" data-report>REPORT</button>' : ''}
        <button type="button" class="dmx-btn" data-block="${t.blocked ? '0' : '1'}">${t.blocked ? 'UNBLOCK' : 'BLOCK'}</button>
      </div>
      <div class="dmx-msgs" id="dmx-msgs">${msgs || '<p class="dmx-empty">NO MESSAGES YET. SAY SOMETHING.</p>'}</div>
      ${blockedNote}${lockNote}
      <form class="dmx-compose" data-compose>
        <textarea id="dmx-input" rows="2" maxlength="500" placeholder="${canWrite ? `Message ${esc(t.other.name)}…` : ''}"${canWrite ? '' : ' disabled'}>${esc(draft)}</textarea>
        <button type="submit" class="dmx-send"${canWrite ? '' : ' disabled'}>SEND</button>
      </form>`;
  }

  function render() {
    if (!state.open) return;
    const el = root();
    const input = document.getElementById('dmx-input');
    const hadFocus = document.activeElement === input;
    const caret = input ? input.selectionStart : 0;
    el.innerHTML = `
      <section class="dmx-panel${state.thread || state.picking ? ' has-thread' : ''}">
        <header class="dmx-head">
          <h2>DIRECT MESSAGES</h2>
          <label class="dmx-allow">ACCEPT FROM
            <select data-allow><option value="everyone"${state.allow === 'everyone' ? ' selected' : ''}>EVERYONE</option><option value="nobody"${state.allow === 'nobody' ? ' selected' : ''}>NOBODY</option></select>
          </label>
          <button type="button" class="dmx-btn dmx-back" data-back aria-label="Back to conversations">◂</button>
          <button type="button" class="dmx-btn" data-close aria-label="Close direct messages">CLOSE</button>
        </header>
        ${state.error ? `<div class="dmx-flash err">${esc(state.error)}</div>` : state.notice ? `<div class="dmx-flash">${esc(state.notice)}</div>` : ''}
        <div class="dmx-body">
          <aside class="dmx-list">${listHTML()}</aside>
          <div class="dmx-thread">${threadHTML()}</div>
        </div>
      </section>`;
    const box = document.getElementById('dmx-msgs');
    if (box) box.scrollTop = box.scrollHeight;
    if (hadFocus) {
      const next = document.getElementById('dmx-input');
      if (next) { next.focus(); next.setSelectionRange(caret, caret); }
    }
  }

  // --------------------------------------------------------------- events
  function submit() {
    const t = state.thread;
    const input = document.getElementById('dmx-input');
    const text = String(input?.value || '').trim();
    if (!t || !text || locked() || t.blocked) return;
    state.error = '';
    state.draft[t.other.id] = '';
    send({ type: 'dm:send', toId: t.other.id, text });
    if (input) input.value = '';
  }

  function onClick(e) {
    const t = e.target;
    if (t === e.currentTarget || t.closest('[data-close]')) return close();
    if (t.closest('[data-back]')) { state.thread = null; state.picking = false; return render(); }
    if (t.closest('[data-new]')) { state.picking = true; state.thread = null; return render(); }
    if (t.closest('[data-cancel-pick]')) { state.picking = false; return render(); }
    const row = t.closest('[data-thread]');
    if (row && !row.disabled) return openThread(row.dataset.thread);
    const block = t.closest('[data-block]');
    if (block && state.thread) {
      const blocking = block.dataset.block === '1';
      // Blocking takes a second, confirming click.
      if (blocking && !block.classList.contains('armed')) {
        block.classList.add('armed');
        block.textContent = 'CONFIRM BLOCK';
        setTimeout(() => { if (block.isConnected) { block.classList.remove('armed'); block.textContent = 'BLOCK'; } }, 3500);
        return;
      }
      return send({ type: 'dm:block', playerId: state.thread.other.id, blocked: blocking });
    }
    if (t.closest('[data-report]') && state.thread?.id) {
      const conversationId = state.thread.id;
      const name = state.thread.other.name;
      window.AsocDialog?.prompt({
        title: 'REPORT CONVERSATION',
        message: `Send this conversation with ${name} to the Shadow Broker. Add a short reason (optional).`,
        maxLength: 300,
        confirmLabel: 'REPORT'
      }).then(reason => {
        if (reason === null || reason === undefined) return;
        send({ type: 'dm:report', conversationId, reason });
      });
      return;
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.target.id === 'dmx-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  function onInput(e) {
    if (e.target.id === 'dmx-input' && state.thread) state.draft[state.thread.other.id] = e.target.value;
  }

  document.addEventListener('submit', e => {
    if (e.target.closest?.('[data-compose]')) { e.preventDefault(); submit(); }
  });
  document.addEventListener('change', e => {
    if (e.target.matches?.('#direct-messages [data-allow]')) send({ type: 'dm:setting', allow: e.target.value });
  });
  document.addEventListener('click', e => {
    if (e.target.closest?.('#hero-hud-dm-chip')) open();
    const dossierButton = e.target.closest?.('[data-dm-open]');
    if (dossierButton) { window.ShadowCosmetics?.closeDossier?.(); open(dossierButton.dataset.dmOpen); }
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target?.id === 'hero-hud-dm-chip') { e.preventDefault(); open(); }
  });

  // ------------------------------------------------------- server messages
  function onMessage(m) {
    switch (m.type) {
      case 'dm:summary':
        setUnread(m.unread);
        if (m.allow) state.allow = m.allow;
        send({ type: 'dm:list' });
        return render();
      case 'dm:list':
        state.list = m.conversations || [];
        state.blocked = m.blocked || [];
        state.allow = m.allow || 'everyone';
        state.locked = m.locked === true;
        renderRail();
        return render();
      case 'dm:thread':
        state.thread = m.thread;
        state.locked = m.locked === true;
        state.picking = false;
        send({ type: 'dm:list' });
        return render();
      case 'dm:message': {
        const me = String(app()?.playerId || '');
        const incoming = m.message.from !== me;
        if (state.thread && state.thread.other.id === m.other.id) {
          state.thread.id = m.conversationId;
          if (!state.thread.messages.some(x => x.id === m.message.id)) state.thread.messages.push(m.message);
          if (incoming && state.open) send({ type: 'dm:read', conversationId: m.conversationId });
        } else if (incoming) {
          toast(m.other, m.message.text);
        }
        if (state.open) send({ type: 'dm:list' });
        return render();
      }
      case 'dm:read':
        if (state.thread && state.thread.id === m.conversationId) { state.thread.otherReadAt = Number(m.at) || Date.now(); render(); }
        return;
      case 'dm:blocked':
        state.blocked = m.blocked || [];
        if (state.thread && state.thread.other.id === m.playerId) state.thread.blocked = m.isBlocked;
        state.notice = m.isBlocked ? 'BLOCKED. THEY CAN NO LONGER MESSAGE YOU.' : 'UNBLOCKED.';
        send({ type: 'dm:list' });
        return render();
      case 'dm:reported':
        state.notice = 'REPORT FILED WITH THE SHADOW BROKER.';
        return render();
      case 'dm:error':
        state.error = m.message || 'The channel failed.';
        if (!state.open) toast({ id: '', name: 'DIRECT MESSAGES' }, state.error);
        return render();
      default:
    }
  }

  // "/w @Name message" (or "/w Name message") from the chat composer.
  // Returns true when the text was a whisper and has been handled.
  function handleWhisper(text) {
    const match = String(text || '').match(/^\/(?:w|whisper|dm)\s+@?([\s\S]+)$/i);
    if (!match) return false;
    const rest = match[1];
    const people = candidates().sort((a, b) => b.name.length - a.name.length);
    const target = people.find(p => rest.toLowerCase().startsWith(p.name.toLowerCase() + ' ') || rest.toLowerCase() === p.name.toLowerCase());
    if (!target) {
      toast({ id: '', name: 'DIRECT MESSAGES' }, 'No Little Hero by that name is in the room.');
      return true;
    }
    const body = rest.slice(target.name.length).trim();
    open(target.id);
    if (body) {
      if (locked()) state.error = 'SILENCE // THE MATCH IS LIVE. DIRECT MESSAGES REOPEN AFTER THE BATTLE.';
      else send({ type: 'dm:send', toId: target.id, text: body });
    }
    return true;
  }

  renderRail();
  setInterval(renderRail, 1800);
  window.DirectMessages = { open, close, onMessage, handleWhisper, renderRail };
})();
