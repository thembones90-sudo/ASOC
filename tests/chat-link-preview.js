// CHAT LINKS -- clickable addresses and unfurled previews.
//
// Two halves, because there are two halves: link-preview.js is the host-side
// unfurler (pure extraction plus the guards that make an open metadata fetcher
// safe), and js/chat-links.js is the renderer. The renderer half runs in a real
// Chromium because the whole risk there is what actually lands in the DOM, and
// a fake DOM cannot tell you whether an <img onerror> was neutralised.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createLinkPreviewService, extractMetadata } = require('../link-preview');

const ROOT = path.resolve(__dirname, '..');
const CLIENT = fs.readFileSync(path.join(ROOT, 'js', 'chat-links.js'), 'utf8');

// =========================================================== host-side unfurl

// --- address extraction ----------------------------------------------------

// The predicate the server injects in production answers "blocked" for the
// private and reserved ranges. The test stands in a real one for it, because
// an allow-everything stub would make every private-address assertion below
// meaningless.
const blocksPrivate = address => {
  const value = String(address || '');
  return value === '::1'
    || value.startsWith('127.')
    || value.startsWith('10.')
    || value.startsWith('192.168.')
    || value.startsWith('169.254.')
    || value.startsWith('172.16.');
};
const service = createLinkPreviewService({ isBlockedAddress: blocksPrivate });

assert.equal(service.extractFirstUrl('look at https://example.com/page?a=1 now'), 'https://example.com/page?a=1');
assert.equal(service.extractFirstUrl('no link here at all'), null);
assert.equal(service.extractFirstUrl(''), null);

// Sentence punctuation belongs to the sentence, not the address.
assert.equal(service.extractFirstUrl('see https://example.com/page.'), 'https://example.com/page');
assert.equal(service.extractFirstUrl('see https://example.com/page, then'), 'https://example.com/page');
assert.equal(service.extractFirstUrl('https://example.com/a(b)'), 'https://example.com/a(b)');
// A paren INSIDE the address is kept; only an unbalanced trailing one is cut.
assert.equal(service.extractFirstUrl('https://example.com/a)b'), 'https://example.com/a)b');
assert.equal(service.extractFirstUrl('(https://example.com/a)'), 'https://example.com/a');

// Schemes a chat client must never turn into a link.
assert.equal(service.extractFirstUrl('javascript:alert(1)'), null);
assert.equal(service.extractFirstUrl('data:text/html,<script>alert(1)</script>'), null);
assert.equal(service.extractFirstUrl('ftp://example.com/file'), null);
assert.equal(service.extractFirstUrl('https://user:pass@example.com/'), null);
assert.equal(service.extractFirstUrl('https://example.com:8443/'), null);
assert.equal(service.extractFirstUrl('http://localhost:3000/admin'), null);
assert.equal(service.extractFirstUrl('http://127.0.0.1:80/'), null);
assert.equal(service.extractFirstUrl('https://box.local/thing'), null);

// A refused first address must not hide a valid second one.
assert.equal(
  service.extractFirstUrl('http://127.0.0.1:80/x and https://example.com/ok'),
  'https://example.com/ok'
);
assert.equal(
  service.extractFirstUrl('http://169.254.169.254/latest/meta-data/ and https://example.com/ok'),
  'https://example.com/ok',
  'the cloud metadata address is refused before it is ever queued'
);
assert.equal(service.extractFirstUrl('http://10.0.0.5/internal'), null);

// --- metadata extraction ---------------------------------------------------

const page = extractMetadata(`<!doctype html><html><head>
  <title>  Plain &amp; Simple &mdash; Example  </title>
  <meta property="og:site_name" content="Example News">
  <meta property="og:title" content="The Headline &quot;quoted&quot;">
  <meta property="og:description" content="A summary of the page.">
  <meta property="og:image" content="/media/cover.png">
</head><body>ignored</body></html>`, 'https://example.com/story/1');
assert.ok(page, 'a page with metadata unfurls');
assert.equal(page.title, 'The Headline "quoted"');
assert.equal(page.description, 'A summary of the page.');
assert.equal(page.siteName, 'Example News');
assert.equal(page.image, 'https://example.com/media/cover.png', 'a relative og:image resolves against the page URL');
assert.equal(page.url, 'https://example.com/story/1');

// <title> is the fallback when Open Graph is absent.
const plain = extractMetadata('<html><head><title>Only A Title</title></head></html>', 'https://example.com/');
assert.equal(plain.title, 'Only A Title');
assert.equal(plain.siteName, 'example.com', 'the site name falls back to the hostname');
assert.equal(plain.image, null);

// A hostile og:image never survives, whatever the page claims. With nothing
// else on the page there is no card at all; with a real title the card appears
// but carries no picture.
assert.equal(
  extractMetadata('<html><head><meta property="og:image" content="javascript:alert(1)"></head><body>x</body></html>', 'https://example.com/'),
  null,
  'a page whose only metadata is a hostile image unfurls to nothing'
);
const hostile = extractMetadata(
  '<html><head><title>Real Story</title><meta property="og:image" content="javascript:alert(1)"></head><body>x</body></html>',
  'https://example.com/'
);
assert.ok(hostile, 'the card still renders on its title');
assert.equal(hostile.image, null, 'a javascript: og:image is dropped');
const dataUrl = extractMetadata(
  '<html><head><title>Real Story</title><meta property="og:image" content="data:image/png;base64,AAAA"></head><body>x</body></html>',
  'https://example.com/'
);
assert.equal(dataUrl.image, null, 'a data: og:image is dropped');

// Nothing worth rendering means no card at all, not an empty one.
assert.equal(extractMetadata('<html><body><p>hello</p></body></html>', 'https://example.com/'), null);
assert.equal(extractMetadata('', 'https://example.com/'), null);

// Lengths are capped so a hostile <title> cannot flood the room log.
const huge = extractMetadata(
  `<html><head><meta property="og:title" content="${'T'.repeat(5000)}"></head></html>`,
  'https://example.com/'
);
assert.ok(huge.title.length <= 200, 'the title is capped');
const hugeDesc = extractMetadata(
  `<html><head><meta property="og:description" content="${'D'.repeat(5000)}"></head></html>`,
  'https://example.com/'
);
assert.ok(hugeDesc.description.length <= 400, 'the description is capped');

// --- the private-address guard actually gates the socket ------------------

// A predicate that blocks the loopback stands in for the real
// private/reserved range check the server injects. If the guard were not wired
// into the request path, this resolve would succeed and the promise below
// would resolve instead of rejecting. The port is 80 on purpose: a
// non-standard port is refused by an earlier gate and would never reach the
// address check this test is about.
let addressGuardCalled = false;
const guarded = createLinkPreviewService({
  isBlockedAddress: address => {
    addressGuardCalled = true;
    return String(address) === '127.0.0.1';
  }
});
assert.equal(guarded.normalizeUrl('http://127.0.0.1/').hostname, '127.0.0.1');
assert.equal(service.extractFirstUrl('http://[::1]/x'), null, 'an IPv6 loopback literal is refused before any fetch');
assert.equal(service.extractFirstUrl('http://[::1]/x and https://example.com/ok'), 'https://example.com/ok');

(async () => {
  // Blocked host: refused, and nothing was fetched.
  const blockedResult = await guarded.unfurl('http://127.0.0.1/never');
  assert.equal(blockedResult, null, 'a private literal address is refused, not fetched');
  assert.equal(addressGuardCalled, true, 'the injected predicate was consulted');

  // A link that cannot be parsed never becomes a fetch at all.
  assert.equal(await service.unfurl('not a url'), null);
  assert.equal(await service.unfurl('javascript:alert(1)'), null);

  // ======================================================= client rendering
  const browser = await chromium.launch();
  try {
    const page2 = await browser.newPage();
    await page2.setContent('<!doctype html><html><body><div id="out"></div></body></html>');
    await page2.addScriptTag({ content: CLIENT });

    const render = (text, decorate) => page2.evaluate(
      ([value, useDecorator]) => {
        const decorateFn = useDecorator
          ? segment => `<em class="decorated">${segment.toUpperCase()}</em>`
          : undefined;
        document.getElementById('out').innerHTML = window.ChatLinks.textHTML(value, decorateFn);
        const links = [...document.querySelectorAll('#out a.chat-link')].map(a => ({
          href: a.getAttribute('href'),
          target: a.getAttribute('target'),
          rel: a.getAttribute('rel'),
          label: a.textContent
        }));
        return { html: document.getElementById('out').innerHTML, links, text: document.getElementById('out').textContent };
      },
      [text, Boolean(decorate)]
    );

    // ---- a plain address becomes a real, safely-opened link
    let out = await render('look at https://example.com/page now');
    assert.equal(out.links.length, 1, 'one address, one link');
    assert.equal(out.links[0].href, 'https://example.com/page');
    assert.equal(out.links[0].target, '_blank');
    assert.match(out.links[0].rel, /noopener/, 'a new tab cannot reach back via window.opener');
    assert.match(out.links[0].rel, /noreferrer/);
    assert.match(out.links[0].rel, /nofollow/);
    assert.equal(out.text, 'look at https://example.com/page now', 'surrounding words are preserved');

    // ---- punctuation is not swallowed
    out = await render('see https://example.com/page.');
    assert.equal(out.links[0].href, 'https://example.com/page', 'the trailing period is not part of the href');
    assert.equal(out.text, 'see https://example.com/page.', 'the period is still shown');

    // ---- several addresses
    out = await render('https://a.example/1 and https://b.example/2');
    assert.equal(out.links.length, 2, 'every address in the line is linked');

    // ---- hostile text cannot become markup
    out = await render('<img src=x onerror="window.__pwned=1"> https://example.com/ <script>window.__pwned=1</script>');
    assert.equal(out.links.length, 1, 'the real address is still linked');
    assert.equal(await page2.evaluate(() => document.querySelectorAll('#out img').length), 0, 'no img element was injected');
    assert.equal(await page2.evaluate(() => document.querySelectorAll('#out script').length), 0, 'no script element was injected');
    assert.equal(await page2.evaluate(() => window.__pwned), undefined, 'nothing executed');

    // ---- a dangerous scheme is never turned into an anchor
    out = await render('javascript:alert(1)');
    assert.equal(out.links.length, 0, 'javascript: is not linkified');
    assert.equal(out.text, 'javascript:alert(1)', 'it is still shown as plain text');

    // ---- quotes in an address cannot break out of the href attribute
    out = await render('https://example.com/?a="onmouseover=alert(1)"');
    const escaped = await page2.evaluate(() => document.getElementById('out').innerHTML);
    assert.ok(!/href="https:\/\/example\.com\/\?a="onmouseover/.test(escaped), 'the quote is escaped inside the attribute');

    // ---- the host's own text renderer is still used for plain segments
    out = await render('shout https://example.com/', true);
    assert.match(out.html, /<em class="decorated">SHOUT <\/em>/, 'the host decorator is applied to text segments');
    assert.match(out.html, /<a class="chat-link"/, 'the address bypasses the decorator');
    assert.equal(out.links.length, 1);

    // ---- the preview card
    const card = await page2.evaluate(() => {
      document.getElementById('out').innerHTML = window.ChatLinks.previewHTML({
        url: 'https://example.com/story',
        title: 'Headline <script>window.__pwned=1</script>',
        description: 'Summary & "quoted"',
        siteName: 'Example News',
        image: 'https://example.com/cover.png'
      });
      const anchor = document.querySelector('#out a.chat-link-preview');
      return {
        href: anchor?.getAttribute('href'),
        rel: anchor?.getAttribute('rel'),
        target: anchor?.getAttribute('target'),
        site: anchor?.querySelector('.chat-link-preview-site')?.textContent,
        title: anchor?.querySelector('.chat-link-preview-title')?.textContent,
        description: anchor?.querySelector('.chat-link-preview-description')?.textContent,
        image: anchor?.querySelector('img')?.getAttribute('src'),
        scripts: document.querySelectorAll('#out script').length,
        pwned: window.__pwned
      };
    });
    assert.equal(card.href, 'https://example.com/story');
    assert.equal(card.target, '_blank');
    assert.match(card.rel, /noopener/);
    assert.equal(card.site, 'Example News');
    assert.equal(card.title, 'Headline <script>window.__pwned=1</script>', 'the title is shown as text, not markup');
    assert.equal(card.description, 'Summary & "quoted"');
    assert.equal(card.image, 'https://example.com/cover.png');
    assert.equal(card.scripts, 0, 'the card cannot inject a script');
    assert.equal(card.pwned, undefined, 'nothing executed');

    // A hostile image URL in a stored card is dropped rather than fetched.
    const hostileCard = await page2.evaluate(() => {
      document.getElementById('out').innerHTML = window.ChatLinks.previewHTML({
        url: 'https://example.com/story',
        title: 'x',
        image: 'javascript:alert(1)'
      });
      return document.querySelectorAll('#out img').length;
    });
    assert.equal(hostileCard, 0, 'a javascript: preview image is not rendered');

    // No preview on the message means no card markup at all.
    const none = await page2.evaluate(() => [
      window.ChatLinks.previewHTML(undefined),
      window.ChatLinks.previewHTML(null),
      window.ChatLinks.previewHTML({}),
      window.ChatLinks.previewHTML({ url: 'https://example.com/' })
    ].join(''));
    assert.equal(none, '', 'a bare address with no metadata renders no empty card');

    await page2.close();
    console.log('PASS chat links: addresses are linkified safely (escaped, rel-hardened, punctuation preserved, javascript:/data: refused), the GM text decorator still composes, og/title metadata unfurls with a capped and escaped card, and the private-address guard refuses before any socket opens');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
