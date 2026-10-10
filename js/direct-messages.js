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
    draft: {}, emojiOpen: false, gifOpen: false, gifResults: [], gifLoading: false,
    attachmentOpen:false, pollOpen:false, replyTo:null, editingId:null, reactionFor:null
  };
  const EMOJIS = ['😀','😂','🥰','😍','😘','😈','😭','😡','🤡','👀','💀','🔥','❤️','💜','✨','👍','👎','🙏','🎉'];
  const emojiButton = value => `<button type="button" data-dmx-emoji-value="${esc(value)}">${window.CommanderEmojis?.has?.(value) ? window.CommanderEmojis.html(value,'commander-emoji-picker-icon') : esc(value)}</button>`;
  const app = () => window.PlayerApp;
  const send = m => app()?.send(m);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = t => new Date(Number(t) || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = t => new Date(Number(t) || 0).toLocaleDateString([], { month: 'short', day: '2-digit' });
  const battleLive = () => /^BATTLE/.test(String(app()?.roomMode || ''));
  const locked = () => state.locked || battleLive();
  const richText = value => window.CommanderEmojis?.renderText ? window.CommanderEmojis.renderText(value || '') : esc(value || '');
  function pollHTML(m) { const p=m.poll||{}; return `<div class="dmx-poll"><b>${esc(p.question||m.text)}</b>${(p.options||[]).map((o,i)=>`<button type="button" data-dmx-poll-vote="${i}" data-message-id="${esc(m.id)}">${esc(o)} <small>${(p.votes?.[i]||[]).length}</small></button>`).join('')}</div>`; }
  function reactionsHTML(m){return `<div class="dmx-reactions">${Object.entries(m.reactions||{}).map(([emoji,ids])=>`<button type="button" data-dmx-react="${esc(emoji)}" data-message-id="${esc(m.id)}">${richText(emoji)} ${ids.length}</button>`).join('')}<button type="button" data-dmx-reaction-open="${esc(m.id)}" aria-label="Add reaction">＋</button>${state.reactionFor===m.id?`<div class="dmx-reaction-picker">${EMOJIS.slice(0,14).concat(window.CommanderEmojis?.tokens||[]).map(v=>`<button type="button" data-dmx-react="${esc(v)}" data-message-id="${esc(m.id)}">${window.CommanderEmojis?.has?.(v)?window.CommanderEmojis.html(v,'commander-emoji-picker-icon'):esc(v)}</button>`).join('')}</div>`:''}</div>`;}
  function messageBody(m) {
    if(m.deleted) return '<p class="dmx-deleted">MESSAGE DELETED</p>';
    const reply=m.replyTo?`<div class="dmx-reply-context">↳ ${esc(m.replyTo.name)} // ${esc(m.replyTo.excerpt)}</div>`:'';
    let media='';
    if(m.messageType==='gifRemote'&&m.gif) media=`<img class="dmx-gif" src="${esc(m.gif.gifUrl)}" alt="${esc(m.gif.title||'GIF')}" loading="lazy">`;
    if(m.messageType==='image'&&m.imageUrl) media=`<img class="dmx-gif" src="${esc(m.imageUrl)}" alt="Private attachment" loading="lazy">`;
    if(m.messageType==='voice') media=window.AsocVoice?.messageHTML?.(m)||'';
    if(m.messageType==='sticker'&&m.stickerUrl) media=`<img class="dmx-sticker" src="${esc(m.stickerUrl)}" alt="Sticker">`;
    if(m.messageType==='poll') media=pollHTML(m);
    return reply+media+(m.text&&m.messageType!=='poll'?`<p>${richText(m.text)}</p>`:'')+(m.editedAt?'<em class="dmx-edited">EDITED</em>':'')+reactionsHTML(m)+`<div class="dmx-message-actions"><button type="button" data-dmx-reply="${esc(m.id)}" title="Reply">↩</button><button type="button" data-dmx-reaction-open="${esc(m.id)}" title="React">☺</button>${m.from===String(app()?.playerId||'')&&(!m.messageType||m.messageType==='text')?`<button type="button" data-dmx-edit="${esc(m.id)}" title="Edit">✎</button>`:''}${m.from===String(app()?.playerId||'')?`<button type="button" data-dmx-delete="${esc(m.id)}" title="Delete">⌫</button>`:''}</div>`;
  }

  const authHeaders=()=>({'x-player-token':sessionStorage.getItem('asoc_player_auth_token')||localStorage.getItem('asoc_player_auth_token')||''});
  async function uploadPrivate(file){const type=String(file?.type||'').toLowerCase();if(!['image/png','image/jpeg','image/webp','image/gif'].includes(type)||file.size>5*1024*1024)throw new Error('PNG, JPG, WEBP or GIF up to 5 MB.');const res=await fetch('/api/dm/image',{method:'POST',headers:{...authHeaders(),'Content-Type':type},body:file});const body=await res.json();if(!res.ok)throw new Error(body.error||'Upload failed');send({type:'dm:send',toId:state.thread.other.id,text:'',messageType:'image',imageUrl:body.url,replyTo:state.replyTo});state.replyTo=null;}

  async function loadGifs(query = '') {
    if (state.gifLoading) return;
    state.gifLoading = true; render();
    try {
      const q = String(query || '').trim();
      const url = '/api/gif/' + (q.length >= 2 ? 'search?q=' + encodeURIComponent(q) + '&' : 'trending?') + 'limit=12&offset=0';
      const response = await fetch(url, { credentials:'same-origin' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'GIF NETWORK OFFLINE');
      state.gifResults = Array.isArray(payload.results) ? payload.results : [];
    } catch (error) { state.error = error.message || 'GIF NETWORK OFFLINE'; }
    state.gifLoading = false; render();
  }

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
    const raw = typeof p?.avatarData === 'string' ? p.avatarData : '';
    const src = raw.startsWith('data:image/') || raw.startsWith('/avatars/') || raw.startsWith('assets/') ? raw : '';
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
    // Unread threads with heroes who are not in the room still count in the
    // PRIVATE total, so they must be reachable from the rail too.
    const listed = new Set(people.map(p => p.id));
    (state.list || []).forEach(c => {
      const id = String(c.other.id);
      if (Number(c.unread) > 0 && !c.blocked && !listed.has(id)) people.push({ id, name: c.other.name || 'Little Hero', online: false, avatarData: '', frameColor: '#37d997' });
    });
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
    el.addEventListener('paste', onPaste);
    el.addEventListener('dragover', e => { if (state.thread && !locked()) e.preventDefault(); });
    el.addEventListener('drop', onDrop);
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
    if (el) {
      el.hidden = true;
      el.classList.remove('dmx-casual-drawer');
    }
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
    const people = (app()?.currentPlayers || [])
      .filter(p => String(p.id) !== me && !String(p.id).startsWith('__MASTER_TEST__:'))
      .map(p => ({
        id: String(p.id),
        name: p.name || 'Little Hero',
        online: p.connected !== false,
        blocked: blocked.has(String(p.id)),
        avatarData: typeof p.avatarData === 'string' ? p.avatarData : '',
        frameColor: /^#[0-9A-Fa-f]{6}$/.test(p.frameColor || '') ? p.frameColor : '#37d997'
      }));
    people.unshift({ id: '__GM__', name: 'Shadow Broker', online: true, blocked: blocked.has('__GM__'), avatarData: 'assets/ui/shadow-broker.png', frameColor: '#9B5DE0' });
    return people.sort((a, b) => a.id === '__GM__' ? -1 : b.id === '__GM__' ? 1 : a.name.localeCompare(b.name));
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
      return `${divider}<div class="dmx-msg${m.from === me ? ' mine' : ''}${m.messageType && m.messageType !== 'text' ? ' media' : ''}">${messageBody(m)}<span>${esc(time(m.at))}</span>${seen}</div>`;
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
      ${state.replyTo?`<div class="dmx-reply-preview">↳ ${esc(state.replyTo.name)} // ${esc(state.replyTo.excerpt)}<button type="button" data-dmx-reply-cancel>×</button></div>`:''}${state.editingId?`<div class="dmx-edit-preview">EDITING MESSAGE<button type="button" data-dmx-edit-cancel>×</button></div>`:''}
      <div class="dmx-public-composer"><div class="dmx-attachment-wrap"><button type="button" data-dmx-attach>+</button>${state.attachmentOpen?`<div class="dmx-attachment-menu"><button type="button" data-dmx-image>▧ <span>PHOTOS<small>UPLOAD · PASTE · DROP</small></span></button><button type="button" data-dmx-gif>GIF <span>GIPHY · UPLOAD</span></button><button type="button" data-dmx-voice>◉ <span>VOICE<small>UP TO 1 MINUTE</small></span></button><button type="button" data-dmx-poll>▥ <span>POLL<small>2–8 OPTIONS</small></span></button><button type="button" data-dmx-sticker>◇ <span>STICKERS</span></button></div>`:''}</div>
        <button type="button" data-dmx-emoji aria-label="Emoji">☺</button>
        ${state.emojiOpen ? `<div class="dmx-emoji-picker">${EMOJIS.concat(window.CommanderEmojis?.tokens||[]).map(emojiButton).join('')}</div>` : ''}
        ${state.gifOpen ? `<div class="dmx-gif-picker"><form data-dmx-gif-search><input type="search" maxlength="60" placeholder="Search GIFs…"><button>SEARCH</button></form><div class="dmx-gif-grid">${state.gifLoading ? '<em>ACQUIRING…</em>' : state.gifResults.map((g,i) => `<button type="button" data-dmx-gif-index="${i}"><img src="${esc(g.previewUrl || g.gifUrl)}" alt="${esc(g.title || 'GIF')}" loading="lazy"></button>`).join('')}</div></div>` : ''}
      <form class="dmx-compose" data-compose>
        <textarea id="dmx-input" rows="2" maxlength="500" placeholder="${canWrite ? `Message ${esc(t.other.name)}…` : ''}"${canWrite ? '' : ' disabled'}>${esc(draft)}</textarea>
        <button type="submit" class="dmx-send"${canWrite ? '' : ' disabled'}>SEND</button>
      </form><button type="button" data-dmx-voice class="dmx-mic">●</button><input type="file" data-dmx-file accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>
      ${state.pollOpen?`<form class="dmx-poll-maker" data-dmx-poll-maker><input name="question" maxlength="160" placeholder="Ask privately…" required>${Array.from({length:8},(_,i)=>`<input name="option" maxlength="80" placeholder="Option ${i+1}"${i<2?' required':''}>`).join('')}<label><input type="checkbox" name="multiple"> MULTIPLE ANSWERS</label><button>CREATE POLL</button></form>`:''}`;
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
    if(state.editingId) send({type:'dm:edit',conversationId:t.id,messageId:state.editingId,text});
    else send({ type: 'dm:send', toId: t.other.id, text, replyTo:state.replyTo });
    state.editingId=null; state.replyTo=null;
    if (input) input.value = '';
  }

  function onClick(e) {
    const t = e.target;
    if(t.closest?.('[data-dmx-attach]')){state.attachmentOpen=!state.attachmentOpen;return render();}
    if(t.closest?.('[data-dmx-image]')){root().querySelector('[data-dmx-file]')?.click();return;}
    if(t.closest?.('[data-dmx-voice]')){state.attachmentOpen=false;render();return window.AsocVoice?.record?.({anchor:root().querySelector('.dmx-public-composer'),headers:authHeaders(),uploadUrl:'/api/dm/voice',onUploaded:(result,seconds)=>send({type:'dm:send',toId:state.thread.other.id,text:'',messageType:'voice',audioUrl:result.url,voiceSeconds:seconds,replyTo:state.replyTo}),onError:msg=>{state.error=msg;render();}});}
    if(t.closest?.('[data-dmx-poll]')){state.pollOpen=!state.pollOpen;state.attachmentOpen=false;return render();}
    if(t.closest?.('[data-dmx-sticker]')){state.attachmentOpen=false;render();return window.AsocStickers?.open?.({anchor:root().querySelector('.dmx-public-composer'),onSend:url=>send({type:'dm:send',toId:state.thread.other.id,text:'',messageType:'sticker',stickerUrl:url,replyTo:state.replyTo})});}
    if(t.closest?.('[data-dmx-reply-cancel]')){state.replyTo=null;return render();}
    if(t.closest?.('[data-dmx-edit-cancel]')){state.editingId=null;state.draft[state.thread.other.id]='';return render();}
    const messageId=t.closest?.('[data-message-id]')?.dataset.messageId||t.closest?.('[data-dmx-reply]')?.dataset.dmxReply||t.closest?.('[data-dmx-edit]')?.dataset.dmxEdit||t.closest?.('[data-dmx-delete]')?.dataset.dmxDelete;
    const msg=state.thread?.messages?.find(m=>m.id===messageId);
    if(t.closest?.('[data-dmx-reply]')&&msg){state.replyTo={id:msg.id,from:msg.from,name:msg.from===String(app()?.playerId||'')?'You':state.thread.other.name,excerpt:msg.text||msg.poll?.question||'Attachment'};return render();}
    if(t.closest?.('[data-dmx-edit]')&&msg){state.editingId=msg.id;state.draft[state.thread.other.id]=msg.text||'';render();document.getElementById('dmx-input')?.focus();return;}
    if(t.closest?.('[data-dmx-delete]')&&msg)return send({type:'dm:delete',conversationId:state.thread.id,messageId:msg.id});
    const reactionOpen=t.closest?.('[data-dmx-reaction-open]');if(reactionOpen){state.reactionFor=state.reactionFor===reactionOpen.dataset.dmxReactionOpen?null:reactionOpen.dataset.dmxReactionOpen;return render();}
    const reaction=t.closest?.('[data-dmx-react]');if(reaction&&msg)return send({type:'dm:react',conversationId:state.thread.id,messageId:msg.id,emoji:reaction.dataset.dmxReact});
    const vote=t.closest?.('[data-dmx-poll-vote]');if(vote&&msg)return send({type:'dm:pollVote',conversationId:state.thread.id,messageId:msg.id,optionIndex:Number(vote.dataset.dmxPollVote)});
    const emojiValue = t.closest?.('[data-dmx-emoji-value]');
    if (emojiValue) { const input = document.getElementById('dmx-input'); if (input) { input.value += emojiValue.dataset.dmxEmojiValue; state.draft[state.thread.other.id] = input.value; input.focus(); } state.emojiOpen = false; return render(); }
    if (t.closest?.('[data-dmx-emoji]')) { state.emojiOpen = !state.emojiOpen; state.gifOpen = false; return render(); }
    if (t.closest?.('[data-dmx-gif]')) { state.gifOpen = !state.gifOpen; state.emojiOpen = false; render(); if (state.gifOpen && !state.gifResults.length) loadGifs(); return; }
    const gifButton = t.closest?.('[data-dmx-gif-index]');
    if (gifButton && state.thread) { const gif = state.gifResults[Number(gifButton.dataset.dmxGifIndex)]; if (gif) send({ type:'dm:send', toId:state.thread.other.id, text:'', messageType:'gifRemote', gif }); state.gifOpen = false; state.gifResults = []; return render(); }
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

  function imageFromTransfer(items) {
    return [...(items || [])].map(item => item.kind === 'file' ? item.getAsFile() : item).find(file => /^image\//.test(file?.type || '')) || null;
  }
  function onPaste(e) {
    if (!e.target.closest?.('#dmx-input') || !state.thread || locked()) return;
    const file = imageFromTransfer(e.clipboardData?.items);
    if (!file) return;
    e.preventDefault();
    uploadPrivate(file).catch(error => { state.error=error.message; render(); });
  }
  function onDrop(e) {
    if (!state.thread || locked()) return;
    const file = imageFromTransfer(e.dataTransfer?.files);
    if (!file) return;
    e.preventDefault();
    uploadPrivate(file).catch(error => { state.error=error.message; render(); });
  }

  document.addEventListener('submit', e => {
    if (e.target.matches?.('[data-dmx-gif-search]')) { e.preventDefault(); return loadGifs(e.target.querySelector('input')?.value); }
    if(e.target.matches?.('[data-dmx-poll-maker]')){e.preventDefault();const fd=new FormData(e.target);const options=fd.getAll('option').map(String).map(x=>x.trim()).filter(Boolean);send({type:'dm:send',toId:state.thread.other.id,text:'',messageType:'poll',poll:{question:String(fd.get('question')||''),options,allowMultiple:fd.get('multiple')==='on',durationSeconds:0}});state.pollOpen=false;return render();}
    if (e.target.closest?.('[data-compose]')) { e.preventDefault(); submit(); }
  });
  document.addEventListener('change', e => {
    if(e.target.matches?.('#direct-messages [data-dmx-file]')){const file=e.target.files?.[0];e.target.value='';if(file)uploadPrivate(file).catch(error=>{state.error=error.message;render();});return;}
    if (e.target.matches?.('#direct-messages [data-allow]')) send({ type: 'dm:setting', allow: e.target.value });
  });
  document.addEventListener('click', e => {
    if (e.target.closest?.('#hero-hud-dm-chip')) open();
    const dossierButton = e.target.closest?.('[data-dm-open]');
    if (dossierButton) { window.ShadowCosmetics?.closeDossier?.(); open(dossierButton.dataset.dmOpen); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.open) {
      e.preventDefault();
      return close();
    }
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
      case 'dm:update':
        if(state.thread?.id===m.conversationId){const index=state.thread.messages.findIndex(x=>x.id===m.message.id);if(index>=0)state.thread.messages[index]=m.message;render();}return;
      case 'dm:blocked':
        state.blocked = m.blocked || [];
        if (state.thread && state.thread.other.id === m.playerId) state.thread.blocked = m.isBlocked;
        state.notice = m.isBlocked ? 'BLOCKED. THEY CAN NO LONGER MESSAGE YOU.' : 'UNBLOCKED.';
        send({ type: 'dm:list' });
        return render();
      case 'dm:reported':
        state.notice = 'REPORT FILED WITH THE SHADOW BROKER.';
        return render();
      case 'dm:purged': {
        state.list = state.list.filter(c => c.id !== m.conversationId);
        if (state.thread?.id === m.conversationId) {
          state.thread = { ...state.thread, id:null, messages:[], otherReadAt:0 };
          state.notice = 'THE SHADOW BROKER PURGED THIS PRIVATE CHANNEL.';
        }
        renderRail();
        send({ type:'dm:list' });
        return render();
      }
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
