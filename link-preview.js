'use strict';

// CHAT LINK PREVIEW -- server-side unfurl for links posted in Battle Comms.
//
// Design contract, and it is the whole point of this file living on the
// server: the client never fetches a stranger's URL. Browsers give a page no
// way to read a third-party page's metadata, and a client-side "preview" would
// leak every reader's IP to whatever host a player pasted. So the host does the
// fetch, once, and ships a small sanitized object to the room.
//
// Everything here is built to make that fetch harmless, because an open
// metadata fetcher on a game server is a textbook SSRF and a DDoS amplifier:
//   - http/https only, no credentials in the URL, standard ports only
//   - the hostname is DNS-resolved and EVERY answer is checked against the
//     caller's private/reserved-address predicate before a socket opens
//   - every redirect hop is re-validated from scratch (the classic bypass is a
//     public URL that 302s to 169.254.169.254)
//   - the body is capped, the clock is capped, and in-flight work is capped
//   - only text/html is parsed, and the derived image URL is scheme-checked
//     before it is ever handed to a client
//
// The address predicate is INJECTED (isBlockedAddress) rather than duplicated
// so this module and the chat image importer can never drift apart on what
// counts as a private address.

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const MAX_HTML_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
const MAX_INFLIGHT = 4;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 250;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 400;
const MAX_LINKS_PER_MESSAGE = 4;

// A URL as it appears in a chat line. Deliberately strict: no quotes, angle
// brackets or backticks can be part of a match, so a link can never eat the
// punctuation around it or reach into an attribute we build later.
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const ALLOWED_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const JSON_CONTENT_TYPES = new Set(['application/json', 'text/json']);

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'"
};

function decodeEntities(value) {
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    const key = body.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ENTITIES, key)) return ENTITIES[key];
    if (key[0] === '#') {
      const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch (_) { return match; }
    }
    return match;
  });
}

// Text between tags, collapsed to a single line.
function textContent(fragment) {
  return decodeEntities(String(fragment || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function attributeValue(tag, name) {
  const match = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i')
    .exec(tag);
  if (!match) return '';
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').trim();
}

function metaTags(html) {
  const out = [];
  const pattern = /<meta\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    const key = (attributeValue(tag, 'property') || attributeValue(tag, 'name') || '').toLowerCase();
    if (!key) continue;
    out.push({ key, content: attributeValue(tag, 'content') });
    if (out.length >= 400) break;
  }
  return out;
}

function firstMeta(metas, keys) {
  for (const key of keys) {
    const hit = metas.find(entry => entry.key === key && entry.content);
    if (hit) return hit.content;
  }
  return '';
}

function truncate(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// Only a plain web address may ever leave this module. `javascript:` and
// `data:` in particular must never reach a client that will put them in an
// href or an img src.
function safeWebUrl(rawValue, baseUrl) {
  let parsed;
  try {
    parsed = baseUrl ? new URL(String(rawValue || '').trim(), baseUrl) : new URL(String(rawValue || '').trim());
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  parsed.hash = '';
  return parsed.toString();
}

function literalHostIsPrivate(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '' || host.endsWith('.local')) return true;
  if (net.isIP(host)) return true; // caller decides via its own predicate
  return false;
}

// Pulls a title/description/image out of a fetched HTML document. Pure, so the
// extraction rules are testable without a socket.
function extractMetadata(html, pageUrl) {
  const source = String(html || '');
  if (!source) return null;
  const metas = metaTags(source);
  const head = source.slice(0, 200000);

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = truncate(firstMeta(metas, ['og:title', 'twitter:title']) || textContent(titleTag?.[1] || ''), MAX_TITLE);
  const description = truncate(
    firstMeta(metas, ['og:description', 'twitter:description', 'description']) || '',
    MAX_DESCRIPTION
  );
  const siteName = truncate(firstMeta(metas, ['og:site_name', 'application-name']) || '', 80);

  // NOTE: an empty string is never resolved. new URL('', base) is the base
  // itself, so passing a missing attribute through here would hand every page
  // without an og:image its own address as the card picture.
  const rawImage = firstMeta(metas, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
  let image = rawImage ? safeWebUrl(rawImage, pageUrl) : null;
  if (!image) {
    const icon = /<link\b[^>]*>/i.exec(head);
    const iconRel = icon && /(?:^|\s)rel\s*=\s*(?:"([^"]*icon[^"]*)"|'([^']*icon[^']*)'|([^\s"'>]*icon[^\s"'>]*))/i.exec(icon[0]);
    if (iconRel) {
      const href = attributeValue(icon[0], 'href');
      if (href) image = safeWebUrl(href, pageUrl);
    }
  }

  // Every valid link gets a card, even if the page is blank. The hostname is
  // always shown so the preview is never an empty box.
  return {
    url: safeWebUrl(pageUrl) || String(pageUrl || ''),
    title: title || truncate(new URL(pageUrl).hostname, MAX_TITLE),
    description,
    image: image || null,
    siteName: siteName || (() => { try { return new URL(pageUrl).hostname; } catch (_) { return ''; } })(),
    fetchedAt: Date.now()
  };
}

function extractYoutubeOEmbedMetadata(payload, pageUrl) {
  if (!payload || typeof payload !== 'object') return null;
  const url = safeWebUrl(pageUrl);
  const title = truncate(payload.title || '', MAX_TITLE);
  if (!url || !title) return null;
  const author = truncate(payload.author_name || '', 80);
  const image = safeWebUrl(payload.thumbnail_url || '') || null;
  return {
    url,
    title,
    description: author ? `Video by ${author}` : '',
    image,
    siteName: author ? `YouTube · ${author}` : 'YouTube',
    fetchedAt: Date.now()
  };
}

function createLinkPreviewService(options = {}) {
  const isBlockedAddress = typeof options.isBlockedAddress === 'function'
    ? options.isBlockedAddress
    : () => true;
  const maxHtmlBytes = Number(options.maxHtmlBytes) > 0 ? Number(options.maxHtmlBytes) : MAX_HTML_BYTES;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : REQUEST_TIMEOUT_MS;
  const cacheTtlMs = Number(options.cacheTtlMs) >= 0 ? Number(options.cacheTtlMs) : CACHE_TTL_MS;
  const maxInflight = Number(options.maxInflight) > 0 ? Number(options.maxInflight) : MAX_INFLIGHT;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  const cache = new Map();
  const inflight = new Map();

  // ---- guards -------------------------------------------------------------

  function normalizeUrl(rawValue) {
    let parsed;
    try {
      parsed = new URL(String(rawValue || '').trim());
    } catch (_) {
      throw new Error('That does not look like a link');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Links must use HTTP or HTTPS');
    if (parsed.username || parsed.password) throw new Error('Link credentials are not allowed');
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    if ((parsed.protocol === 'https:' && port !== 443) || (parsed.protocol === 'http:' && port !== 80)) {
      throw new Error('Non-standard link ports are not allowed');
    }
    if (!parsed.hostname || parsed.hostname.length > 253) throw new Error('Invalid link host');
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      throw new Error('Private links are not allowed');
    }
    return parsed;
  }

  // Trailing sentence punctuation is almost never part of the address, and a
  // link that swallows ")" reads as broken.
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

  // A target the host must never touch, judged before any name resolution:
  // localhost-ish names, and any IP literal the caller's predicate calls
  // private or reserved. Checked with net.isIP() first because the production
  // predicate answers "blocked" for anything that is not a literal address,
  // and passing a hostname to it would refuse every site on the internet.
  function isRefusedTarget(parsed) {
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (net.isIP(host) && isBlockedAddress(host)) return true;
    return false;
  }

  // The first address in a chat line, validated. Returns null when the line
  // holds no link or holds one we would refuse to fetch anyway.
  function extractFirstUrl(text) {
    const urls = extractAllUrls(text, 1);
    return urls[0] || null;
  }

  // Every address in a chat line, validated and deduplicated, in the order they
  // appear. Capped so a wall of pasted links cannot turn the chat server into a
  // DDoS cannon.
  function extractAllUrls(text, max = MAX_LINKS_PER_MESSAGE) {
    const matches = String(text || '').match(URL_PATTERN);
    if (!matches || !matches.length) return [];
    const seen = new Set();
    const out = [];
    for (const match of matches) {
      if (out.length >= max) break;
      const candidate = trimUrlTail(match);
      if (!candidate) continue;
      try {
        const parsed = normalizeUrl(candidate);
        if (isRefusedTarget(parsed)) continue;
        const url = parsed.toString();
        if (seen.has(url)) continue;
        seen.add(url);
        out.push(url);
      } catch (_) {
        // Keep looking: a refused link must not suppress a valid one.
      }
    }
    return out;
  }

  async function resolvePublicAddress(hostname) {
    const cleanHost = String(hostname || '').replace(/^\[|\]$/g, '');
    const literalFamily = net.isIP(cleanHost);
    if (literalFamily) {
      if (isBlockedAddress(cleanHost)) throw new Error('Private or reserved links are not allowed');
      return { address: cleanHost, family: literalFamily, servername: cleanHost };
    }
    const records = await dns.promises.lookup(cleanHost, { all: true, verbatim: true });
    if (!records.length) throw new Error('Link host could not be resolved');
    // EVERY answer, not just the one we happen to connect to: a host with a
    // public A record and a private AAAA record must not be reachable.
    if (records.some(record => isBlockedAddress(record.address))) {
      throw new Error('Private or reserved links are not allowed');
    }
    return { ...records[0], servername: cleanHost };
  }

  function fetchResource(rawUrl, redirectCount = 0, options = {}) {
    if (redirectCount > MAX_REDIRECTS) return Promise.reject(new Error('Link redirected too many times'));
    let target;
    try {
      target = normalizeUrl(rawUrl);
    } catch (error) {
      return Promise.reject(error);
    }
    return resolvePublicAddress(target.hostname).then(resolved => new Promise((resolve, reject) => {
      const client = target.protocol === 'https:' ? https : http;
      let settled = false;
      const done = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      const fail = error => done(reject, error instanceof Error ? error : new Error(String(error || 'Link could not be read')));

      const request = client.request({
        host: resolved.address,
        family: resolved.family,
        port: target.protocol === 'https:' ? 443 : 80,
        method: 'GET',
        path: target.pathname + target.search,
        servername: target.protocol === 'https:' ? resolved.servername : undefined,
        rejectUnauthorized: true,
        headers: {
          Host: target.host,
          Accept: options.accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'User-Agent': 'ASOC-Link-Preview/1.0',
          'Accept-Language': 'en',
          Connection: 'close'
        }
      }, response => {
        const status = Number(response.statusCode || 0);
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          settled = true;
          let redirected;
          try {
            redirected = new URL(location, target).toString();
          } catch (_) {
            reject(new Error('Link returned an invalid redirect'));
            return;
          }
          // Re-validated from the top: normalizeUrl + resolvePublicAddress run
          // again for the new host.
          fetchResource(redirected, redirectCount + 1, options).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          fail(new Error('Link returned HTTP ' + status));
          return;
        }
        const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const allowedTypes = options.allowedContentTypes || ALLOWED_CONTENT_TYPES;
        if (contentType && !allowedTypes.has(contentType)) {
          response.resume();
          fail(new Error('Link is not a web page'));
          return;
        }
        const declaredLength = Number(response.headers['content-length'] || 0);
        if (declaredLength > maxHtmlBytes) {
          response.resume();
          fail(new Error('Link page is too large to preview'));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          if (settled) return;
          size += chunk.length;
          if (size > maxHtmlBytes) {
            response.destroy();
            fail(new Error('Link page is too large to preview'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          done(resolve, { body: Buffer.concat(chunks).toString('utf8'), finalUrl: target.toString() });
        });
        response.on('error', fail);
      });

      request.setTimeout(timeoutMs, () => request.destroy(new Error('Link timed out')));
      request.on('error', fail);
      request.end();
    }));
  }

  function fetchDocument(rawUrl) {
    return fetchResource(rawUrl).then(({ body, finalUrl }) => ({ html: body, finalUrl }));
  }

  function youtubeVideoId(rawUrl) {
    try {
      const url = normalizeUrl(rawUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      let id = '';
      if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
        else {
          const parts = url.pathname.split('/').filter(Boolean);
          if (['shorts', 'embed', 'live'].includes(parts[0])) id = parts[1] || '';
        }
      }
      return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
    } catch (_) {
      return '';
    }
  }

  function fetchYoutubeOEmbed(rawUrl) {
    if (!youtubeVideoId(rawUrl)) return Promise.reject(new Error('Not a YouTube video'));
    const original = normalizeUrl(rawUrl).toString();
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(original)}&format=json`;
    return fetchResource(endpoint, 0, { allowedContentTypes: JSON_CONTENT_TYPES, accept: 'application/json' })
      .then(({ body }) => {
        let payload;
        try { payload = JSON.parse(body); } catch (_) { throw new Error('YouTube returned invalid metadata'); }
        const preview = extractYoutubeOEmbedMetadata(payload, original);
        if (!preview) throw new Error('YouTube metadata was incomplete');
        return preview;
      });
  }

  function readCache(key) {
    if (!key) return null;
    const hit = cache.get(key);
    if (!hit) return null;
    if (cacheTtlMs >= 0 && now() - hit.at > cacheTtlMs) {
      cache.delete(key);
      return null;
    }
    return hit.preview;
  }

  function minimalPreview(rawUrl) {
    try {
      const url = normalizeUrl(rawUrl);
      if (isRefusedTarget(url)) return null;
      const host = url.hostname;
      const safeYoutubeId = youtubeVideoId(url.toString());
      return {
        url: url.toString(),
        title: safeYoutubeId ? 'YouTube video' : truncate(host, MAX_TITLE),
        description: safeYoutubeId ? 'Open this video on YouTube.' : '',
        image: safeYoutubeId ? `https://i.ytimg.com/vi/${safeYoutubeId}/hqdefault.jpg` : null,
        siteName: safeYoutubeId ? 'YouTube' : host,
        fetchedAt: Date.now()
      };
    } catch (_) {
      return null;
    }
  }

  // Returns a cached preview immediately, or null while a fetch is started in
  // the background. Chat must never wait on a stranger's web server: the
  // message posts first and the room is updated again when the preview lands.
  function prime(rawUrl) {
    let key;
    try {
      const parsed = normalizeUrl(rawUrl);
      if (isRefusedTarget(parsed)) return null;
      key = parsed.toString();
    } catch (_) {
      return null;
    }
    const cached = readCache(key);
    if (cached) return cached;
    if (inflight.has(key)) return null;
    if (inflight.size >= maxInflight) return null;

    const fetchPreview = youtubeVideoId(key)
      ? fetchYoutubeOEmbed(key).catch(() => fetchDocument(key).then(({ html, finalUrl }) => extractMetadata(html, finalUrl)))
      : fetchDocument(key).then(({ html, finalUrl }) => extractMetadata(html, finalUrl));
    const task = fetchPreview
      .then(result => {
        const preview = result || minimalPreview(key);
        if (preview && preview.image && literalHostIsPrivate(safeHost(preview.image))) preview.image = null;
        if (preview) {
          cache.set(key, { at: now(), preview });
          while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
        }
        return preview;
      })
      .catch(() => minimalPreview(key))
      .then(preview => {
        inflight.delete(key);
        return preview;
      });
    inflight.set(key, task);
    return null;
  }

  // Await the background fetch started by prime(). Used by tests and by any
  // caller that genuinely wants to block.
  function unfurl(rawUrl) {
    const key = (() => {
      try { return normalizeUrl(rawUrl).toString(); } catch (_) { return null; }
    })();
    if (!key) return Promise.resolve(null);
    const cached = readCache(key);
    if (cached) return Promise.resolve(cached);
    if (inflight.has(key)) return inflight.get(key);
    prime(key);
    return inflight.get(key) || Promise.resolve(null);
  }

  // Prime every URL in a chat line. Returns the cached previews that were
  // already available; the rest are fetched in the background and the caller
  // is notified via the returned promise when each one lands.
  function primeAll(rawUrls, onEach) {
    const urls = (rawUrls || []).slice(0, MAX_LINKS_PER_MESSAGE);
    const immediate = [];
    const pending = [];
    for (const raw of urls) {
      const cached = prime(raw);
      if (cached) {
        immediate.push(cached);
      } else {
        const promise = unfurl(raw).then(preview => {
          if (onEach && preview) onEach(preview);
          return preview;
        }).catch(() => null);
        pending.push(promise);
      }
    }
    return { immediate, pending };
  }

  function safeHost(rawUrl) {
    try { return new URL(String(rawUrl || '')).hostname.toLowerCase(); } catch (_) { return ''; }
  }

  return {
    extractFirstUrl,
    extractAllUrls,
    normalizeUrl,
    extractMetadata,
    minimalPreview,
    prime,
    primeAll,
    unfurl,
    cached: readCache,
    pending: () => inflight.size,
    clearCache: () => cache.clear()
  };
}

module.exports = {
  createLinkPreviewService,
  extractMetadata,
  extractYoutubeOEmbedMetadata,
  safeWebUrl,
  URL_PATTERN
};
