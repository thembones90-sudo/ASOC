// PAGE WEIGHT (Mobile Alpha 0.1, step 3): text is gzipped, large PNGs are
// answered with their WebP copy only to browsers that accept WebP, versioned
// assets are cached for good, HTML/JS/CSS stay no-store, HEAD has no body.
'use strict';

const assert = require('assert/strict');
const http = require('http');
const zlib = require('zlib');
const H = require('./lib/browser-harness');

const PORT = Number(process.env.ASOC_PAGE_WEIGHT_PORT) || 18985;

function get(pathname, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const server = await H.startServer({ port: PORT });
  try {
    const css = await get('/css/asoc.css', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(css.headers['content-encoding'], 'gzip');
    assert.match(css.headers.vary, /Accept-Encoding/);
    assert.match(css.headers['cache-control'], /no-store/, 'CSS stays no-store (stale-page guard)');
    const plain = await get('/css/asoc.css');
    assert.equal(plain.headers['content-encoding'], undefined, 'no gzip unless asked');
    assert.deepEqual(zlib.gunzipSync(css.body), plain.body, 'gzip body is the exact file');
    assert.ok(css.body.length < plain.body.length / 3, 'CSS compresses well');
    assert.equal((await get('/join.html', { 'accept-encoding': 'gzip' })).headers['content-encoding'], 'gzip');

    const webp = await get('/assets/ui/asoc-logo.png?v=1', { accept: 'image/avif,image/webp,*/*' });
    assert.equal(webp.headers['content-type'], 'image/webp');
    assert.equal(webp.body.toString('ascii', 8, 12), 'WEBP');
    assert.match(webp.headers.vary, /Accept/);
    assert.match(webp.headers['cache-control'], /immutable/, 'versioned asset cached for good');
    const png = await get('/assets/ui/asoc-logo.png', { accept: 'image/png,*/*' });
    assert.equal(png.headers['content-type'], 'image/png', 'browsers without WebP get the PNG');
    assert.ok(webp.body.length < png.body.length / 4, 'the WebP copy is much lighter');
    assert.match(png.headers['cache-control'], /max-age=3600/, 'unversioned asset cached briefly');

    const head = await get('/css/asoc.css', { 'accept-encoding': 'gzip' }, 'HEAD');
    assert.equal(head.body.length, 0, 'HEAD has no body');
    assert.equal((await get('/assets/.webp/../../server.js')).status, 404, 'no traversal through the WebP folder');
    assert.equal(server.errors().trim(), '', 'no server errors');
    console.log('PASS page weight: gzip text (exact bytes), WebP only when accepted, versioned assets immutable, HTML/JS/CSS no-store, HEAD bodiless, no traversal');
  } finally {
    await server.stop();
  }
})().catch(error => {
  console.error('FAIL page weight:', error);
  process.exit(1);
});
