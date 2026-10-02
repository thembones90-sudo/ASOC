'use strict';
// INFOSTUD on R2: files and the tree live in the bucket (a fake, signature-
// checking S3 server here), survive a wiped data volume, and respect the cap.
const assert = require('assert/strict');
const http = require('http');
const crypto = require('crypto');
const { startServer, sleep } = require('./lib/browser-harness');
const { sign } = require('../r2-client');

const KEY_ID = 'test-key-id';
const SECRET = 'test-secret';

function fakeR2() {
  const objects = new Map();
  const bad = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const auth = String(req.headers.authorization || '');
      const signed = (auth.match(/SignedHeaders=([^,]+)/) || [])[1] || '';
      const headers = Object.fromEntries(signed.split(';').map(h => [h, req.headers[h]]));
      const expected = headers['x-amz-date'] ? sign({ method: req.method, path: req.url, headers, accessKeyId: KEY_ID, secretAccessKey: SECRET, region: 'auto' }) : '';
      const payloadOk = headers['x-amz-content-sha256'] === 'UNSIGNED-PAYLOAD' || headers['x-amz-content-sha256'] === crypto.createHash('sha256').update(body).digest('hex');
      if (!auth || auth !== expected || !payloadOk) {
        bad.push(`${req.method} ${req.url}`);
        res.writeHead(403); return res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
      }
      const key = decodeURIComponent(req.url.replace(/^\/asoc-infostud\//, ''));
      if (req.method === 'PUT') {
        const source = req.headers['x-amz-copy-source'];
        if (source) {
          const from = objects.get(decodeURIComponent(source.replace(/^\/asoc-infostud\//, '')));
          if (!from) { res.writeHead(404); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
          objects.set(key, from);
        } else objects.set(key, body);
        res.writeHead(200); return res.end();
      }
      if (req.method === 'GET') {
        if (!objects.has(key)) { res.writeHead(404); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
        res.writeHead(200, { 'content-length': objects.get(key).length }); return res.end(objects.get(key));
      }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      res.writeHead(405); res.end();
    });
  });
  return { server, objects, bad, files: () => [...objects.keys()].filter(k => k.startsWith('files/')) };
}

function call(port, method, urlPath, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: { ...(token ? { 'x-gm-token': token } : {}), ...(data ? { 'content-length': data.length } : {}), ...(data && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, raw, json });
      });
    });
    req.on('error', reject);
    req.end(data || undefined);
  });
}

(async () => {
  const r2 = fakeR2();
  await new Promise(resolve => r2.server.listen(0, '127.0.0.1', resolve));
  const env = {
    ASOC_R2_ENDPOINT: `http://127.0.0.1:${r2.server.address().port}`,
    ASOC_R2_ACCESS_KEY_ID: KEY_ID,
    ASOC_R2_SECRET_ACCESS_KEY: SECRET,
    ASOC_INFOSTUD_MAX_TOTAL_BYTES: '1000000'
  };
  const login = async server => (await call(server.port, 'POST', '/api/auth/gm/login', { body: { password: 'browser-gm-pass' } })).json.token;
  let server = await startServer({ port: 4870, env });
  try {
    let token = await login(server);
    assert.equal((await call(server.port, 'GET', '/api/infostud')).status, 404, 'still hidden without the GM token');

    const folder = (await call(server.port, 'POST', '/api/infostud/folder', { token, body: { name: 'Trip' } })).json.item;
    const bytes = crypto.randomBytes(300000);
    const up = await call(server.port, 'POST', '/api/infostud', { token, body: bytes, headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('beach.png'), 'x-parent-id': folder.id } });
    assert.equal(up.status, 200, up.raw.toString());
    const file = up.json.item;
    assert.equal(file.size, bytes.length);
    assert.deepEqual(r2.files(), [`files/${file.id}`], 'the bytes live in R2');

    const got = await call(server.port, 'GET', `/api/infostud/${file.id}`, { token });
    assert.equal(got.status, 200);
    assert.ok(got.raw.equals(bytes), 'download returns the same bytes');

    const copied = await call(server.port, 'POST', `/api/infostud/${file.id}/copy`, { token, body: { parentId: null } });
    assert.equal(copied.status, 200, copied.raw.toString());
    assert.equal(r2.files().length, 2);
    assert.ok(r2.objects.get(`files/${copied.json.item.id}`).equals(bytes));

    const zip = await call(server.port, 'GET', `/api/infostud/${folder.id}`, { token });
    assert.equal(zip.raw.readUInt32LE(0), 0x04034b50, 'folder downloads as a ZIP');
    assert.ok(zip.raw.includes(bytes.subarray(0, 64)));

    const full = await call(server.port, 'POST', '/api/infostud', { token, body: crypto.randomBytes(500000), headers: { 'x-file-name': 'big.bin' } });
    assert.equal(full.status, 507, 'the cap holds');
    assert.equal(r2.files().length, 2);

    assert.equal((await call(server.port, 'DELETE', `/api/infostud/${copied.json.item.id}`, { token })).status, 200);
    assert.equal((await call(server.port, 'PATCH', `/api/infostud/${file.id}`, { token, body: { rating: 'gold' } })).status, 200);
    for (let i = 0; i < 40 && r2.files().length !== 1; i++) await sleep(50);
    assert.deepEqual(r2.files(), [`files/${file.id}`], 'deleting removes the R2 object');
    await sleep(300);

    // A brand-new data volume: everything comes back from R2.
    await server.stop();
    server = await startServer({ port: 4871, env });
    token = await login(server);
    const list = (await call(server.port, 'GET', '/api/infostud', { token })).json;
    const back = list.items.find(i => i.id === file.id);
    assert.ok(back && back.parentId === folder.id && back.rating === 'gold', 'tree and rating survive a wiped volume');
    assert.ok(list.items.some(i => i.id === folder.id));
    assert.ok((await call(server.port, 'GET', `/api/infostud/${file.id}`, { token })).raw.equals(bytes));

    const purge = await call(server.port, 'DELETE', '/api/infostud', { token, headers: { 'x-confirm': 'PURGE' } });
    assert.equal(purge.status, 200);
    for (let i = 0; i < 40 && r2.files().length; i++) await sleep(50);
    assert.deepEqual(r2.files(), [], 'PURGE empties the bucket');
    assert.deepEqual(r2.bad, [], 'every R2 request was correctly signed');
    console.log('infostud-r2: ok');
  } finally {
    await server.stop();
    r2.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
