/* CHAT LINKS -- clickable addresses and link previews in Battle Comms.
 *
 * Two jobs, one file, because they are two halves of the same feature:
 *   1. split() turns a raw chat line into text/URL segments so a posted
 *      address renders as a real <a> instead of grey mush.
 *   2. previewHTML() draws the server's unfurled card (site, title, summary,
 *      image) under the message.
 *
 * The URL regex is the shared, deliberately strict one: no quotes, angle
 * brackets or backticks can be part of a match, so a link can never swallow
 * the punctuation after it and can never break out of the attribute we build.
 * Everything that reaches innerHTML goes through esc() first, and the only
 * hrefs this file emits are ones re-validated as plain http/https -- the
 * server does the same check, and this is the second lock on the same door.
 */
(() => {
  'use strict';

  const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
  const MAX_PREVIEW_IMAGE = 400;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHttpUrl(rawValue) {
    let parsed;
    try {
      parsed = new URL(String(rawValue || '').trim());
    } catch (_) {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  }

  // Sentence punctuation after an address is almost never part of it, and a
  // link that eats the closing bracket reads as broken.
  function trimUrlTail(rawValue) {
    let value = String(rawValue || '');
    for (;;) {
      const last = value.slice(-1);
      if ('.,;:!?'.includes(last)) { value = value.slice(0, -1); continue; }
      if (last === ')' && (value.match(/\)/g) || []).length > (value.match(/\(/g) || []).length) {
        value = value.slice(0, -1);
        continue;
      }
      break;
    }
    return value;
  }

  function isUrlSegment(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  /* Splits a raw chat line into { type: 'text' | 'url' } segments.
   * An address we would refuse to link (javascript:, a bad port) stays plain
   * text rather than becoming a dead or dangerous anchor. */
  function split(text) {
    const source = String(text == null ? '' : text);
    const segments = [];
    let cursor = 0;
    URL_PATTERN.lastIndex = 0;
    let match;
    while ((match = URL_PATTERN.exec(source)) !== null) {
      const raw = match[0];
      const tailTrimmed = trimUrlTail(raw);
      const start = match.index;
      const end = start + tailTrimmed.length;
      const safe = tailTrimmed ? safeHttpUrl(tailTrimmed) : null;
      if (!safe) continue; // leave it in the next text run, unlinked
      if (start > cursor) segments.push({ type: 'text', value: source.slice(cursor, start) });
      segments.push({ type: 'url', value: safe, label: tailTrimmed });
      cursor = end;
      URL_PATTERN.lastIndex = end;
    }
    if (cursor < source.length) segments.push({ type: 'text', value: source.slice(cursor) });
    if (!segments.length) segments.push({ type: 'text', value: source });
    return segments;
  }

  function urlHTML(segment) {
    return `<a class="chat-link" href="${esc(segment.value)}" target="_blank" rel="noopener noreferrer nofollow external" title="${esc(segment.label || segment.value)}">${esc(segment.label || segment.value)}</a>`;
  }

  /* Renders a chat line with every address clickable.
   * `decorateText` is the escape/render function the host already uses for
   * plain text (the GM console passes its solution highlighter), so links
   * compose with the existing highlighting instead of replacing it. */
  function textHTML(text, decorateText) {
    const decorate = typeof decorateText === 'function' ? decorateText : value => esc(value);
    return split(text)
      .map(segment => (segment.type === 'url' ? urlHTML(segment) : decorate(segment.value)))
      .join('');
  }

  function previewImage(preview) {
    const source = safeHttpUrl(preview.image);
    if (!source) return '';
    return `<img class="chat-link-preview-image" src="${esc(source)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async">`;
  }

  function hostLabel(url) {
    try {
      return new URL(String(url || '')).hostname.replace(/^www\./i, '');
    } catch (_) {
      return '';
    }
  }

  /* The unfurled card. Server-supplied and already sanitized there; every
   * field is escaped again here because this is the last stop before the DOM. */
  function previewHTML(preview) {
    if (!preview || typeof preview !== 'object') return '';
    const href = safeHttpUrl(preview.url);
    if (!href) return '';
    const title = String(preview.title || '').trim();
    const description = String(preview.description || '').trim();
    const site = String(preview.siteName || '').trim() || hostLabel(href);
    const image = previewImage(preview);
    if (!title && !description && !image) return '';
    return `<a class="chat-link-preview" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow external" title="${esc(href)}">${image}<span class="chat-link-preview-body"><small class="chat-link-preview-site">${esc(site || 'LINK')}</small>${title ? `<b class="chat-link-preview-title">${esc(title)}</b>` : ''}${description ? `<span class="chat-link-preview-description">${esc(description)}</span>` : ''}<span class="chat-link-preview-open">OPEN LINK ↗</span></span></a>`;
  }

  function messageHTML(message, decorateText) {
    if (!message) return '';
    return previewHTML(message.linkPreview);
  }

  window.ChatLinks = {
    split,
    textHTML,
    urlHTML,
    previewHTML,
    messageHTML,
    safeHttpUrl,
    isUrlSegment,
    esc
  };
})();
