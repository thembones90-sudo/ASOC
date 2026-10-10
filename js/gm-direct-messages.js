// SHADOW BROKER DIRECT MESSAGES // compact GM console for Amusement Park.
(function () {
  const state = { list: [], thread: null, error: '', notice: '', open: false, emojiOpen:false, gifOpen:false, gifResults:[], gifLoading:false };
  const EMOJIS = ['😀','😂','🥰','😍','😘','😈','😭','😡','🤡','👀','💀','🔥','❤️','💜','✨','👍','👎','🙏','🎉'];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const time = t => new Date(Number(t) || 0).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const send = m => window.App?.send?.(m);
  const root = () => document.getElementById('gm-dm-console');
  const messageBody = m => m.messageType === 'gifRemote' && m.gif ? '<img class="gm-dm-gif" src="' + esc(m.gif.gifUrl) + '" alt="' + esc(m.gif.title || 'GIF') + '" loading="lazy">' + (m.text ? '<p>' + esc(m.text) + '</p>' : '') : '<p>' + esc(m.text) + '</p>';
  async function loadGifs(query='') {
    if (state.gifLoading) return;
    state.gifLoading=true; render();
    try { const q=String(query).trim(); const response=await fetch('/api/gif/'+(q.length>=2?'search?q='+encodeURIComponent(q)+'&':'trending?')+'limit=12&offset=0',{credentials:'same-origin'}); const payload=await response.json(); if(!response.ok) throw new Error(payload.message||'GIF NETWORK OFFLINE'); state.gifResults=Array.isArray(payload.results)?payload.results:[]; }
    catch(error){ state.error=error.message||'GIF NETWORK OFFLINE'; }
    state.gifLoading=false; render();
  }

  function playerById(id) {
    return (window.App?.currentPlayers || []).find(p => String(p.id) === String(id)) || null;
  }

  function avatar(player = {}) {
    const src = typeof player.avatarData === 'string' && (player.avatarData.startsWith('data:image/') || player.avatarData.startsWith('/avatars/')) ? player.avatarData : '';
    const initials = esc(String(player.name || 'LH').trim().slice(0, 2).toUpperCase());
    const frame = /^#[0-9A-Fa-f]{6}$/.test(player.frameColor || '') ? player.frameColor : '#37d997';
    return '<i class="gm-dm-avatar" style="--gm-dm-frame:' + esc(frame) + '">' + (src ? '<img src="' + esc(src) + '" alt="">' : '<span>' + initials + '</span>') + '</i>';
  }

  function conversationFor(id) {
    return state.list.find(c => String(c.other?.id) === String(id));
  }
  function rosterHTML() {
    const players = [...(window.App?.currentPlayers || [])].filter(p => !p.isSynthetic).sort((a,b) => {
      if (!!a.connected !== !!b.connected) return a.connected ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    if (!players.length) return '<div class="gm-dm-empty">NO LITTLE HEROES DETECTED</div>';
    return players.map(p => {
      const c = conversationFor(p.id);
      const unread = Number(c?.unread || 0);
      return '<button type="button" class="gm-dm-person' + (unread ? ' unread' : '') + '" data-gm-dm-player="' + esc(p.id) + '">' +
        avatar(p) + '<span class="gm-dm-person-copy"><b>' + esc(p.name || 'Little Hero') + '</b><small>' + (p.connected ? 'ONLINE' : 'OFFLINE') + '</small></span>' +
        '<em class="gm-dm-presence' + (p.connected ? ' on' : '') + '"></em>' + (unread ? '<strong class="gm-dm-badge">' + unread + '</strong>' : '') + '</button>';
    }).join('');
  }

  function threadHTML() {
    const t = state.thread;
    if (!t) return '';
    const player = playerById(t.other?.id) || t.other || {};
    const msgs = (t.messages || []).map(m => {
      const mine = String(m.from) === '__GM__';
      return '<div class="gm-dm-msg' + (mine ? ' mine' : '') + (m.messageType === 'gifRemote' ? ' media' : '') + '">' + messageBody(m) + '<span>' + esc(time(m.at)) + '</span></div>';
    }).join('') || '<div class="gm-dm-empty thread">NO MESSAGES YET</div>';
    return '<div class="gm-dm-thread-head"><button type="button" data-gm-dm-back aria-label="Back">‹</button>' + avatar(player) + '<div><b>' + esc(player.name || 'Little Hero') + '</b><small>PRIVATE CHANNEL</small></div>' + (t.id ? '<button type="button" class="gm-dm-purge" data-gm-dm-purge>PURGE</button>' : '') + '</div>' +
      '<div class="gm-dm-messages" id="gm-dm-messages">' + msgs + '</div>' +
      '<div class="gm-dm-media-tools"><button type="button" data-gm-dm-emoji>☺</button><button type="button" data-gm-dm-gif>GIF</button>' +
      (state.emojiOpen ? '<div class="gm-dm-emoji-picker">' + EMOJIS.map(x=>'<button type="button" data-gm-dm-emoji-value="'+x+'">'+x+'</button>').join('') + '</div>' : '') +
      (state.gifOpen ? '<div class="gm-dm-gif-picker"><form data-gm-dm-gif-search><input type="search" maxlength="60" placeholder="Search GIFs…"><button>SEARCH</button></form><div class="gm-dm-gif-grid">' + (state.gifLoading ? '<em>ACQUIRING…</em>' : state.gifResults.map((g,i)=>'<button type="button" data-gm-dm-gif-index="'+i+'"><img src="'+esc(g.previewUrl||g.gifUrl)+'" alt="'+esc(g.title||'GIF')+'"></button>').join('')) + '</div></div>' : '') + '</div>' +
      '<form class="gm-dm-compose" data-gm-dm-compose><div class="gm-dm-compose-shell"><textarea rows="1" maxlength="500" placeholder="Message ' + esc(player.name || 'Little Hero') + '..."></textarea><button type="submit">SEND</button></div></form>';
  }
  function render() {
    const el = root();
    if (!el) return;
    // Re-rendering must never eat a half-typed message.
    const draftBox = el.querySelector('.gm-dm-compose textarea');
    const draft = draftBox ? { value: draftBox.value, focused: document.activeElement === draftBox, start: draftBox.selectionStart, end: draftBox.selectionEnd, thread: state.thread?.other?.id } : null;
    el.hidden = !state.open;
    const unread = state.list.reduce((n,c) => n + Number(c.unread || 0), 0);
    const toggle = document.getElementById('gm-dm-toggle');
    const alerting = unread > 0 && !state.open;
    if (toggle) {
      toggle.classList.toggle('has-unread', alerting);
      toggle.dataset.unread = unread ? String(unread) : '';
      toggle.setAttribute('aria-label', unread ? `Private channels, ${unread} unread message${unread === 1 ? '' : 's'}` : 'Private channels');
    }
    el.innerHTML = '<header><span>PRIVATE CHANNELS</span>' + (unread ? '<b>' + unread + '</b>' : '') + '<small>SHADOW BROKER // DIRECT</small></header>' +
      (state.error ? '<div class="gm-dm-flash error">' + esc(state.error) + '</div>' : state.notice ? '<div class="gm-dm-flash">' + esc(state.notice) + '</div>' : '') +
      (state.thread ? threadHTML() : '<div class="gm-dm-roster">' + rosterHTML() + '</div>');
    const box = document.getElementById('gm-dm-messages');
    if (box) box.scrollTop = box.scrollHeight;
    const nextBox = el.querySelector('.gm-dm-compose textarea');
    if (draft && nextBox && draft.thread === state.thread?.other?.id) {
      nextBox.value = draft.value;
      if (draft.focused) { nextBox.focus(); try { nextBox.setSelectionRange(draft.start, draft.end); } catch {} }
    }
  }

  function open(playerId) {
    state.error = '';
    state.notice = '';
    send({ type:'gm:privateOpen', playerId:String(playerId) });
  }

  function back() {
    state.thread = null;
    state.error = '';
    render();
  }

  function sync() {
    render();
    if (state.open && window.App?.roomCode && window.App?.ws?.readyState === 1) send({ type:'gm:privateList' });
  }

  function setOpen(open) {
    const panel = document.querySelector('.gm-module-chat .gm-chat-panel');
    const toggle = document.getElementById('gm-dm-toggle');
    const chatTab = document.getElementById('gm-chat-tab');
    const next = open === true && (window.App?.roomMode === 'CASUAL' || document.body.classList.contains('room-mode-casual'));
    state.open = next;
    panel?.classList.toggle('gm-dm-open', next);
    toggle?.classList.toggle('is-active', next);
    toggle?.setAttribute('aria-expanded', String(next));
    toggle?.setAttribute('aria-selected', String(next));
    if (next) {
      window.GMMinigames?.toggleLibrary?.(false);
      window.GMMinigames?.close?.();
      chatTab?.classList.remove('is-active');
      chatTab?.setAttribute('aria-selected', 'false');
      if (window.App?.roomCode && window.App?.ws?.readyState === 1) send({ type:'gm:privateList' });
    } else {
      chatTab?.classList.add('is-active');
      chatTab?.setAttribute('aria-selected', 'true');
    }
    render();
  }
  function onMessage(m) {
    if (m.type === 'gm:privateList') {
      state.list = m.conversations || [];
      return render();
    }
    if (m.type === 'gm:privateThread') {
      state.thread = m.thread || null;
      state.error = '';
      render();
      return send({ type:'gm:privateList' });
    }
    if (m.type === 'gm:privateMessage' || m.type === 'dm:message') {
      if (state.thread && String(state.thread.other?.id) === String(m.other?.id)) {
        state.thread.id = m.conversationId;
        if (!state.thread.messages.some(x => x.id === m.message.id)) state.thread.messages.push(m.message);
        if (String(m.message.from) !== '__GM__') send({ type:'gm:privateRead', conversationId:m.conversationId });
      }
      render();
      return send({ type:'gm:privateList' });
    }
    if (m.type === 'gm:privateError') {
      state.error = m.message || 'PRIVATE CHANNEL FAILED';
      return render();
    }
    if (m.type === 'gm:privatePurged') {
      const current = state.thread && state.thread.id === m.conversationId ? state.thread : null;
      state.list = state.list.filter(c => c.id !== m.conversationId);
      if (current) {
        state.thread = { ...current, id:null, messages:[], otherReadAt:0 };
        state.notice = `PURGED PRIVATE CHANNEL WITH ${current.other?.name || 'LITTLE HERO'}.`;
      }
      render();
      return send({ type:'gm:privateList' });
    }
    if ((m.type === 'gm:privateRead' || m.type === 'dm:read') && state.thread?.id === m.conversationId) {
      state.thread.otherReadAt = Number(m.at) || Date.now();
      return render();
    }
  }
  document.addEventListener('click', e => {
    const emoji=e.target.closest?.('[data-gm-dm-emoji-value]');
    if(emoji){const input=root()?.querySelector('.gm-dm-compose textarea');if(input){input.value+=emoji.dataset.gmDmEmojiValue;input.focus();}state.emojiOpen=false;return render();}
    if(e.target.closest?.('[data-gm-dm-emoji]')){state.emojiOpen=!state.emojiOpen;state.gifOpen=false;return render();}
    if(e.target.closest?.('[data-gm-dm-gif]')){state.gifOpen=!state.gifOpen;state.emojiOpen=false;render();if(state.gifOpen&&!state.gifResults.length)loadGifs();return;}
    const gifButton=e.target.closest?.('[data-gm-dm-gif-index]');
    if(gifButton&&state.thread?.other?.id){const gif=state.gifResults[Number(gifButton.dataset.gmDmGifIndex)];if(gif)send({type:'gm:privateSend',toId:state.thread.other.id,text:'',messageType:'gifRemote',gif});state.gifOpen=false;state.gifResults=[];return render();}
    if (e.target.closest?.('#gm-dm-toggle')) {
      e.preventDefault();
      e.stopPropagation();
      return setOpen(!state.open);
    }
    if (e.target.closest?.('#gm-chat-tab') && state.open) {
      state.thread = null;
      return setOpen(false);
    }
    const purge = e.target.closest?.('[data-gm-dm-purge]');
    if (purge && state.thread?.id) {
      const conversationId = state.thread.id;
      const name = state.thread.other?.name || 'Little Hero';
      const confirmPurge = window.AsocDialog?.confirm
        ? window.AsocDialog.confirm({ title:'PURGE PRIVATE CHANNEL', message:`Permanently delete every private message between the Shadow Broker and ${name}?`, confirmLabel:'PURGE' })
        : Promise.resolve(confirm(`Permanently delete every private message with ${name}?`));
      Promise.resolve(confirmPurge).then(ok => {
        if (!ok || state.thread?.id !== conversationId) return;
        state.error = '';
        state.notice = '';
        send({ type:'gm:privatePurge', conversationId });
      });
      return;
    }
    const person = e.target.closest?.('[data-gm-dm-player]');
    if (person) return open(person.dataset.gmDmPlayer);
    if (e.target.closest?.('[data-gm-dm-back]')) return back();
  });
  document.addEventListener('submit', e => {
    if(e.target.matches?.('[data-gm-dm-gif-search]')){e.preventDefault();return loadGifs(e.target.querySelector('input')?.value);}
    const form = e.target.closest?.('[data-gm-dm-compose]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('textarea');
    const text = String(input?.value || '').trim();
    if (!text || !state.thread?.other?.id) return;
    send({ type:'gm:privateSend', toId:state.thread.other.id, text });
    if (input) input.value = '';
  });
  document.addEventListener('keydown', e => {
    // Enter sends, Shift+Enter breaks the line -- same as Battle Comms.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.closest?.('.gm-dm-compose textarea')) {
      e.preventDefault();
      e.target.closest('form').requestSubmit();
      return;
    }
    if (e.key === 'Escape' && state.thread) { e.preventDefault(); back(); }
  });

  window.GMDirectMessages = { sync, render, onMessage, open, back, setOpen };
  document.addEventListener('DOMContentLoaded', render);
})();
