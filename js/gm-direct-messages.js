// SHADOW BROKER DIRECT MESSAGES // compact GM console for Amusement Park.
(function () {
  const state = { list: [], thread: null, error: '', notice: '', open: false, emojiOpen:false, gifOpen:false, gifResults:[], gifLoading:false, attachmentOpen:false, pollOpen:false, replyTo:null, editingId:null, reactionFor:null };
  const EMOJIS = ['😀','😂','🥰','😍','😘','😈','😭','😡','🤡','👀','💀','🔥','❤️','💜','✨','👍','👎','🙏','🎉'];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const time = t => new Date(Number(t) || 0).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const send = m => window.App?.send?.(m);
  const root = () => document.getElementById('gm-dm-console');
  const richText=v=>window.CommanderEmojis?.renderText?window.CommanderEmojis.renderText(v||''):esc(v||'');
  const authHeaders=()=>({'x-gm-token':window.GameData?.gmToken||sessionStorage.getItem('asoc_gm_token')||''});
  function messageBody(m){if(m.deleted)return '<p class="gm-dm-deleted">MESSAGE DELETED</p>';let out=m.replyTo?'<div class="gm-dm-reply-context">↳ '+esc(m.replyTo.name)+' // '+esc(m.replyTo.excerpt)+'</div>':'';if(m.messageType==='gifRemote'&&m.gif)out+='<img class="gm-dm-gif" src="'+esc(m.gif.gifUrl)+'" alt="GIF">';if(m.messageType==='image')out+='<img class="gm-dm-gif" src="'+esc(m.imageUrl)+'" alt="Private attachment">';if(m.messageType==='voice')out+=window.AsocVoice?.messageHTML?.(m)||'';if(m.messageType==='sticker')out+='<img class="gm-dm-sticker" src="'+esc(m.stickerUrl)+'" alt="Sticker">';if(m.messageType==='poll'){const p=m.poll||{};out+='<div class="gm-dm-poll"><b>'+esc(p.question||m.text)+'</b>'+(p.options||[]).map((o,i)=>'<button type="button" data-gm-dm-poll-vote="'+i+'" data-message-id="'+esc(m.id)+'">'+esc(o)+' <small>'+((p.votes?.[i]||[]).length)+'</small></button>').join('')+'</div>';}if(m.text&&m.messageType!=='poll')out+='<p>'+richText(m.text)+'</p>';out+='<div class="gm-dm-reactions">'+Object.entries(m.reactions||{}).map(([e,ids])=>'<button type="button" data-gm-dm-react="'+esc(e)+'" data-message-id="'+esc(m.id)+'">'+richText(e)+' '+ids.length+'</button>').join('')+(state.reactionFor===m.id?'<div class="gm-dm-reaction-picker">'+EMOJIS.slice(0,14).concat(window.CommanderEmojis?.tokens||[]).map(e=>'<button type="button" data-gm-dm-react="'+esc(e)+'" data-message-id="'+esc(m.id)+'">'+(window.CommanderEmojis?.has?.(e)?window.CommanderEmojis.html(e,'commander-emoji-picker-icon'):esc(e))+'</button>').join('')+'</div>':'')+'</div><div class="gm-dm-actions"><button type="button" data-gm-dm-reply="'+esc(m.id)+'">↩</button><button type="button" data-gm-dm-reaction-open="'+esc(m.id)+'">☺</button>'+(m.from==='__GM__'&&(!m.messageType||m.messageType==='text')?'<button type="button" data-gm-dm-edit="'+esc(m.id)+'">✎</button>':'')+'<button type="button" data-gm-dm-delete="'+esc(m.id)+'">⌫</button></div>';return out;}
  async function uploadPrivate(file){const type=String(file?.type||'').toLowerCase();if(!['image/png','image/jpeg','image/webp','image/gif'].includes(type)||file.size>5*1024*1024)throw new Error('PNG, JPG, WEBP or GIF up to 5 MB.');const res=await fetch('/api/dm/image',{method:'POST',headers:{...authHeaders(),'Content-Type':type},body:file});const body=await res.json();if(!res.ok)throw new Error(body.error||'Upload failed');send({type:'gm:privateSend',toId:state.thread.other.id,text:'',messageType:'image',imageUrl:body.url,replyTo:state.replyTo});state.replyTo=null;}
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
      return '<div class="gm-dm-msg' + (mine ? ' mine' : '') + (m.messageType && m.messageType !== 'text' ? ' media' : '') + '">' + messageBody(m) + '<span>' + esc(time(m.at)) + '</span></div>';
    }).join('') || '<div class="gm-dm-empty thread">NO MESSAGES YET</div>';
    return '<div class="gm-dm-thread-head"><button type="button" data-gm-dm-back aria-label="Back">‹</button>' + avatar(player) + '<div><b>' + esc(player.name || 'Little Hero') + '</b><small>PRIVATE CHANNEL</small></div>' + (t.id ? '<button type="button" class="gm-dm-purge" data-gm-dm-purge>PURGE</button>' : '') + '</div>' +
      '<div class="gm-dm-messages" id="gm-dm-messages">' + msgs + '</div>' +
      (state.replyTo?'<div class="gm-dm-reply-preview">↳ '+esc(state.replyTo.name)+' // '+esc(state.replyTo.excerpt)+'<button type="button" data-gm-dm-reply-cancel>×</button></div>':'')+(state.editingId?'<div class="gm-dm-edit-preview">EDITING MESSAGE<button type="button" data-gm-dm-edit-cancel>×</button></div>':'')+'<div class="gm-dm-public-composer"><div class="gm-dm-attachment-wrap"><button type="button" data-gm-dm-attach>+</button>'+(state.attachmentOpen?'<div class="gm-dm-attachment-menu"><button type="button" data-gm-dm-image>▧ <span>PHOTOS<small>UPLOAD · PASTE · DROP</small></span></button><button type="button" data-gm-dm-gif>GIF <span>GIPHY · UPLOAD</span></button><button type="button" data-gm-dm-voice>◉ <span>VOICE<small>UP TO 1 MINUTE</small></span></button><button type="button" data-gm-dm-poll>▥ <span>POLL<small>2–8 OPTIONS</small></span></button><button type="button" data-gm-dm-sticker>◇ <span>STICKERS</span></button></div>':'')+'</div><button type="button" data-gm-dm-emoji>☺</button>' +
      (state.emojiOpen ? '<div class="gm-dm-emoji-picker">' + EMOJIS.concat(window.CommanderEmojis?.tokens||[]).map(x=>'<button type="button" data-gm-dm-emoji-value="'+esc(x)+'">'+(window.CommanderEmojis?.has?.(x)?window.CommanderEmojis.html(x,'commander-emoji-picker-icon'):esc(x))+'</button>').join('') + '</div>' : '') +
      (state.gifOpen ? '<div class="gm-dm-gif-picker"><form data-gm-dm-gif-search><input type="search" maxlength="60" placeholder="Search GIFs…"><button>SEARCH</button></form><div class="gm-dm-gif-grid">' + (state.gifLoading ? '<em>ACQUIRING…</em>' : state.gifResults.map((g,i)=>'<button type="button" data-gm-dm-gif-index="'+i+'"><img src="'+esc(g.previewUrl||g.gifUrl)+'" alt="'+esc(g.title||'GIF')+'"></button>').join('')) + '</div></div>' : '') +
      '<form class="gm-dm-compose" data-gm-dm-compose><div class="gm-dm-compose-shell"><textarea rows="1" maxlength="500" placeholder="Message ' + esc(player.name || 'Little Hero') + '..."></textarea><button type="submit">SEND</button></div></form><button type="button" data-gm-dm-voice class="gm-dm-mic">●</button><input type="file" data-gm-dm-file accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>'+(state.pollOpen?'<form class="gm-dm-poll-maker" data-gm-dm-poll-maker><input name="question" maxlength="160" placeholder="Ask privately…" required>'+Array.from({length:8},(_,i)=>'<input name="option" maxlength="80" placeholder="Option '+(i+1)+'"'+(i<2?' required':'')+'>').join('')+'<label><input type="checkbox" name="multiple"> MULTIPLE ANSWERS</label><button>CREATE POLL</button></form>':'');
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
    if(m.type==='gm:privateUpdate'&&state.thread?.id===m.conversationId){const index=state.thread.messages.findIndex(x=>x.id===m.message.id);if(index>=0)state.thread.messages[index]=m.message;return render();}
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
    if(e.target.closest?.('[data-gm-dm-attach]')){state.attachmentOpen=!state.attachmentOpen;return render();}
    if(e.target.closest?.('[data-gm-dm-image]')){root()?.querySelector('[data-gm-dm-file]')?.click();return;}
    if(e.target.closest?.('[data-gm-dm-voice]')){state.attachmentOpen=false;render();return window.AsocVoice?.record?.({anchor:root()?.querySelector('.gm-dm-public-composer'),headers:authHeaders(),uploadUrl:'/api/dm/voice',onUploaded:(result,seconds)=>send({type:'gm:privateSend',toId:state.thread.other.id,text:'',messageType:'voice',audioUrl:result.url,voiceSeconds:seconds,replyTo:state.replyTo}),onError:msg=>{state.error=msg;render();}});}
    if(e.target.closest?.('[data-gm-dm-poll]')){state.pollOpen=!state.pollOpen;state.attachmentOpen=false;return render();}
    if(e.target.closest?.('[data-gm-dm-sticker]')){state.attachmentOpen=false;render();return window.AsocStickers?.open?.({anchor:root()?.querySelector('.gm-dm-public-composer'),onSend:url=>send({type:'gm:privateSend',toId:state.thread.other.id,text:'',messageType:'sticker',stickerUrl:url,replyTo:state.replyTo})});}
    if(e.target.closest?.('[data-gm-dm-reply-cancel]')){state.replyTo=null;return render();}
    if(e.target.closest?.('[data-gm-dm-edit-cancel]')){state.editingId=null;return render();}
    const id=e.target.closest?.('[data-message-id]')?.dataset.messageId||e.target.closest?.('[data-gm-dm-reply]')?.dataset.gmDmReply||e.target.closest?.('[data-gm-dm-edit]')?.dataset.gmDmEdit||e.target.closest?.('[data-gm-dm-delete]')?.dataset.gmDmDelete;const msg=state.thread?.messages?.find(m=>m.id===id);
    if(e.target.closest?.('[data-gm-dm-reply]')&&msg){state.replyTo={id:msg.id,from:msg.from,name:msg.from==='__GM__'?'You':state.thread.other.name,excerpt:msg.text||msg.poll?.question||'Attachment'};return render();}
    if(e.target.closest?.('[data-gm-dm-edit]')&&msg){state.editingId=msg.id;render();const input=root()?.querySelector('.gm-dm-compose textarea');if(input){input.value=msg.text||'';input.focus();}return;}
    if(e.target.closest?.('[data-gm-dm-delete]')&&msg)return send({type:'gm:privateDelete',conversationId:state.thread.id,messageId:msg.id});
    const reactionOpen=e.target.closest?.('[data-gm-dm-reaction-open]');if(reactionOpen){state.reactionFor=state.reactionFor===reactionOpen.dataset.gmDmReactionOpen?null:reactionOpen.dataset.gmDmReactionOpen;return render();}
    const reaction=e.target.closest?.('[data-gm-dm-react]');if(reaction&&msg)return send({type:'gm:privateReact',conversationId:state.thread.id,messageId:msg.id,emoji:reaction.dataset.gmDmReact});
    const vote=e.target.closest?.('[data-gm-dm-poll-vote]');if(vote&&msg)return send({type:'gm:privatePollVote',conversationId:state.thread.id,messageId:msg.id,optionIndex:Number(vote.dataset.gmDmPollVote)});
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
    if(e.target.matches?.('[data-gm-dm-poll-maker]')){e.preventDefault();const fd=new FormData(e.target),options=fd.getAll('option').map(String).map(x=>x.trim()).filter(Boolean);send({type:'gm:privateSend',toId:state.thread.other.id,text:'',messageType:'poll',poll:{question:String(fd.get('question')||''),options,allowMultiple:fd.get('multiple')==='on',durationSeconds:0}});state.pollOpen=false;return render();}
    const form = e.target.closest?.('[data-gm-dm-compose]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('textarea');
    const text = String(input?.value || '').trim();
    if (!text || !state.thread?.other?.id) return;
    if(state.editingId)send({type:'gm:privateEdit',conversationId:state.thread.id,messageId:state.editingId,text});else send({ type:'gm:privateSend', toId:state.thread.other.id, text,replyTo:state.replyTo });
    state.editingId=null;state.replyTo=null;
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
  document.addEventListener('change',e=>{if(e.target.matches?.('#gm-dm-console [data-gm-dm-file]')){const file=e.target.files?.[0];e.target.value='';if(file)uploadPrivate(file).catch(error=>{state.error=error.message;render();});}});
  const transferImage = items => [...(items || [])].map(item => item.kind === 'file' ? item.getAsFile() : item).find(file => /^image\//.test(file?.type || '')) || null;
  document.addEventListener('paste', e => {
    if (!e.target.closest?.('#gm-dm-console .gm-dm-compose textarea') || !state.thread) return;
    const file=transferImage(e.clipboardData?.items); if(!file)return; e.preventDefault();
    uploadPrivate(file).catch(error=>{state.error=error.message;render();});
  });
  document.addEventListener('dragover', e => { if(state.open&&state.thread&&e.target.closest?.('#gm-dm-console'))e.preventDefault(); });
  document.addEventListener('drop', e => {
    if(!state.open||!state.thread||!e.target.closest?.('#gm-dm-console'))return;
    const file=transferImage(e.dataTransfer?.files); if(!file)return; e.preventDefault();
    uploadPrivate(file).catch(error=>{state.error=error.message;render();});
  });

  window.GMDirectMessages = { sync, render, onMessage, open, back, setOpen };
  document.addEventListener('DOMContentLoaded', render);
})();
