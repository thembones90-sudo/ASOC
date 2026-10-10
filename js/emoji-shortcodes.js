/* :shortcode: emoji suggestions for the GM chat bar and the player chat.
   Type ":wo" and a list of matching emojis appears above the input; Up/Down + Enter/Tab
   (or a click) insert one, Escape closes. Needs js/emoji-data.js. */
(() => {
  'use strict';
  let INDEX = null;

  function build() {
    INDEX = String(window.ASOC_EMOJI_DATA || '').split('\n').map(line => {
      const bar = line.indexOf('|');
      const main = (bar < 0 ? line : line.slice(0, bar)).trim().split(' ');
      const tags = bar < 0 ? [] : line.slice(bar + 1).trim().split(' ').filter(Boolean);
      return { emoji: main[0], names: main.slice(1), tags };
    }).filter(e => e.emoji && e.names.length);
  }

  function scoreEntry(e, q) {
    let best = 0;
    for (const n of e.names) {
      if (n === q) best = Math.max(best, 100);
      else if (n.startsWith(q)) best = Math.max(best, 80 - Math.min(n.length - q.length, 30) / 3);
      else if (n.includes(q)) best = Math.max(best, 50);
    }
    if (best < 60) {
      for (const t of e.tags) {
        if (t === q) best = Math.max(best, 60);
        else if (t.startsWith(q)) best = Math.max(best, 40);
      }
    }
    return best;
  }

  function search(q, opts = {}) {
    if (!INDEX) build();
    q = String(q || '').toLowerCase();
    if (!q) return [];
    const boost = opts.boost || new Set();
    const out = [];
    for (const e of INDEX) {
      let s = scoreEntry(e, q);
      if (!s) continue;
      if (boost.has(e.emoji)) s += 6;
      out.push({ s, insert: e.emoji, glyph: e.emoji, name: e.names[0] });
    }
    for (const x of (opts.extra ? opts.extra(q) : [])) out.push({ s: 90, ...x });
    out.sort((a, b) => b.s - a.s || a.name.length - b.name.length);
    return out.slice(0, opts.limit || 8);
  }

  function attach(cfg) {
    const { input, host } = cfg;
    if (!input || !host || input._emojiShortcodes) return;
    input._emojiShortcodes = true;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const picker = document.createElement('div');
    picker.className = 'esc-picker';
    picker.hidden = true;
    picker.setAttribute('role', 'listbox');
    host.appendChild(picker);

    let ctx = null, results = [], active = 0, sig = '';

    const close = () => { picker.hidden = true; picker.innerHTML = ''; ctx = null; results = []; sig = ''; };

    function render() {
      picker.innerHTML = '<div class="esc-head">EMOJI <b>:' + ctx.query + '</b></div>' +
        results.map((r, i) =>
          '<button type="button" class="esc-row' + (i === active ? ' active' : '') + '" role="option" data-i="' + i + '">' +
          '<span class="esc-glyph">' + (r.html || r.glyph) + '</span><span class="esc-name">:' + r.name + ':</span></button>').join('') +
        '<div class="esc-foot">↑↓ SELECT &nbsp;·&nbsp; ENTER INSERT &nbsp;·&nbsp; ESC CLOSE</div>';
      picker.hidden = false;
      picker.querySelector('.esc-row.active')?.scrollIntoView({ block: 'nearest' });
    }

    function update() {
      const st = cfg.getState();
      if (!st || !st.collapsed) return close();
      const before = st.text.slice(0, st.caret);
      const m = /(^|\s):([a-z0-9_+\-]{2,})$/i.exec(before);
      if (!m) return close();
      const query = m[2].toLowerCase();
      const start = st.caret - query.length - 1;
      const nextSig = query + '@' + start;
      if (nextSig === sig && !picker.hidden) return;
      sig = nextSig;
      results = search(query, { boost: cfg.boost ? cfg.boost() : null, extra: cfg.extra, limit: 8 });
      if (!results.length) return close();
      ctx = { query, start, end: st.caret };
      active = 0;
      render();
    }

    function choose(i) {
      const r = results[i];
      if (!r || !ctx) return;
      const c = ctx;
      close();
      cfg.apply(c.start, c.end, r.insert);
    }

    input.addEventListener('input', update);
    input.addEventListener('keyup', e => { if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) update(); });
    input.addEventListener('click', update);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', e => {
      if (picker.hidden || !results.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopImmediatePropagation();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        render();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopImmediatePropagation();
        choose(active);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation();
        close();
      }
    }, true);
    picker.addEventListener('mousedown', e => e.preventDefault());
    picker.addEventListener('click', e => {
      const row = e.target.closest('.esc-row');
      if (row) choose(Number(row.dataset.i));
    });
  }

  function init() {
    // GM chat bar (contenteditable composer; handles Commander emoji tokens)
    const gm = document.getElementById('shadow-broker-composer');
    if (gm && typeof App !== 'undefined' && App.getGMComposerText) {
      attach({
        input: gm,
        host: gm.closest('.gm-composer-shell') || gm.parentElement,
        getState() {
          const sel = App.getGMComposerSelectionRange();
          return { text: App.getGMComposerText(), caret: sel.end, collapsed: sel.start === sel.end };
        },
        apply(start, end, ins) {
          const text = App.getGMComposerText();
          App.setGMComposerText(text.slice(0, start) + ins + text.slice(end), start + ins.length);
          gm.focus();
          App.placeGMComposerCaret(start + ins.length);
        },
        boost: () => new Set(App.chatReactionEmojis || []),
        extra(q) {
          const ce = window.CommanderEmojis;
          if (!ce) return [];
          return ce.tokens.filter(t => t.slice(1, -1).includes(q) || ce.label(t).toLowerCase().includes(q))
            .map(t => ({ insert: t, name: t.slice(1, -1), html: ce.html(t, 'esc-commander') }));
        }
      });
    }
    // Player chat (plain text input)
    const pl = document.getElementById('chat-input');
    if (pl && pl.tagName === 'INPUT') {
      attach({
        input: pl,
        host: pl.closest('.chat-composer-shell') || pl.parentElement,
        getState() {
          const c = pl.selectionStart;
          return { text: pl.value, caret: c, collapsed: c === pl.selectionEnd };
        },
        apply(start, end, ins) {
          const max = Number(pl.maxLength) > 0 ? pl.maxLength : 100;
          if (pl.value.length - (end - start) + ins.length > max) return;
          pl.focus();
          pl.setRangeText(ins, start, end, 'end');
          pl.dispatchEvent(new Event('input', { bubbles: true }));
        },
        boost: () => new Set((window.PlayerApp && PlayerApp.chatReactionEmojis) || [])
      });
    }
  }

  window.EmojiShortcodes = { search, attach };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
