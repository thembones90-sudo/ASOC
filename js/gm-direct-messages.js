// SHADOW BROKER DIRECT MESSAGES // compact GM console for Amusement Park.
(function () {
  const state = { list: [], thread: null, error: '', notice: '' };
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const time = t => new Date(Number(t) || 0).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const send = m => window.App?.send?.(m);
  const root = () => document.getElementById('gm-dm-console');

  function playerById(id) {
    return (window.App?.currentPlayers || []).find(p => String(p.id) === String(id)) || null;
  }

  function avatar(player = {}) {
    const src = typeof player.avatarData === 'string' && player.avatarData.startsWith('data:image/') ? player.avatarData : '';
    const initials = esc(String(player.name || 'LH').trim().slice(0, 2).toUpperCase());
    const frame = /^#[0-9A-Fa-f]{6}$/.test(player.frameColor || '') ? player.frameColor : '#37d997';
    return '<i class="gm-dm-avatar" style="--gm-dm-frame:' + esc(frame) + '">' + (src ? '<img src="' + esc(src) + '" alt="">' : '<span>' + initials + '</span>') + '</i>';
  }

  function conversationFor(id) {
    return state.list.find(c => String(c.other?.id) === String(id));
  }
  function rosterHTML() {
    const players = [...(window.App?.currentPlayers || [])].sort((a,b) => {
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
      return '<div class="gm-dm-msg' + (mine ? ' mine' : '') + '"><p>' + esc(m.text) + '</p><span>' + esc(time(m.at)) + '</span></div>';
    }).join('') || '<div class="gm-dm-empty thread">NO MESSAGES YET</div>';
    return '<div class="gm-dm-thread-head"><button type="button" data-gm-dm-back aria-label="Back">‹</button>' + avatar(player) + '<div><b>' + esc(player.name || 'Little Hero') + '</b><small>PRIVATE CHANNEL</small></div></div>' +
      '<div class="gm-dm-messages" id="gm-dm-messages">' + msgs + '</div>' +
      '<form class="gm-dm-compose" data-gm-dm-compose><textarea rows="2" maxlength="500" placeholder="Message ' + esc(player.name || 'Little Hero') + '..."></textarea><button type="submit">SEND</button></form>';
  }
  function render() {
    const el = root();
    if (!el) return;
    el.hidden = false;
    const unread = state.list.reduce((n,c) => n + Number(c.unread || 0), 0);
    el.innerHTML = '<header><span>PRIVATE CHANNELS</span>' + (unread ? '<b>' + unread + '</b>' : '') + '<small>SHADOW BROKER // DIRECT</small></header>' +
      (state.error ? '<div class="gm-dm-flash error">' + esc(state.error) + '</div>' : state.notice ? '<div class="gm-dm-flash">' + esc(state.notice) + '</div>' : '') +
      (state.thread ? threadHTML() : '<div class="gm-dm-roster">' + rosterHTML() + '</div>');
    const box = document.getElementById('gm-dm-messages');
    if (box) box.scrollTop = box.scrollHeight;
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
    if (window.App?.roomCode && window.App?.ws?.readyState === 1) send({ type:'gm:privateList' });
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
    if ((m.type === 'gm:privateRead' || m.type === 'dm:read') && state.thread?.id === m.conversationId) {
      state.thread.otherReadAt = Number(m.at) || Date.now();
      return render();
    }
  }
  document.addEventListener('click', e => {
    const person = e.target.closest?.('[data-gm-dm-player]');
    if (person) return open(person.dataset.gmDmPlayer);
    if (e.target.closest?.('[data-gm-dm-back]')) return back();
  });
  document.addEventListener('submit', e => {
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
    if (e.key === 'Escape' && state.thread) { e.preventDefault(); back(); }
  });

  window.GMDirectMessages = { sync, render, onMessage, open, back };
  document.addEventListener('DOMContentLoaded', render);
})();
