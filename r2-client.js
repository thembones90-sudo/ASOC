'use strict';
// Minimal S3-compatible client for Cloudflare R2 (AWS Signature V4), no SDK.
// Used by INFOSTUD so the Shadow Broker's files live off the game volume.
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const EMPTY_SHA = crypto.createHash('sha256').update('').digest('hex');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const encodeKey = key => String(key).split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');

// Returns the Authorization header for a request. `headers` must already hold
// host, x-amz-date and x-amz-content-sha256; every header given is signed.
function sign({ method, path, query = '', headers, accessKeyId, secretAccessKey, region, service = 's3' }) {
  const amzDate = headers['x-amz-date'];
  const day = amzDate.slice(0, 8);
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, path, query, names.map(n => `${n}:${lower[n]}\n`).join(''), names.join(';'), lower['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

function create({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto', prefix = '' }) {
  const base = new URL(endpoint);
  const agent = base.protocol === 'http:' ? http : https;
  const objectPath = key => `${base.pathname.replace(/\/$/, '')}/${encodeURIComponent(bucket)}/${encodeKey(prefix + key)}`;

  // body: undefined | Buffer | readable stream (then `length` is required).
  function request(method, key, { body, length, headers: extra = {} } = {}) {
    const path = objectPath(key);
    const isStream = body && typeof body.pipe === 'function';
    const headers = {
      host: base.host,
      'x-amz-date': new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''),
      'x-amz-content-sha256': isStream ? 'UNSIGNED-PAYLOAD' : sha256(body || ''),
      ...extra
    };
    const authorization = sign({ method, path, headers, accessKeyId, secretAccessKey, region });
    const size = isStream ? length : body ? body.length : 0;
    return new Promise((resolve, reject) => {
      const req = agent.request({
        method, hostname: base.hostname, port: base.port || undefined, path,
        headers: { ...headers, authorization, 'content-length': size }
      }, resolve);
      req.on('error', reject);
      if (isStream) {
        body.on('error', error => req.destroy(error));
        body.pipe(req);
      } else req.end(body);
    });
  }
  const drain = res => new Promise(resolve => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', () => resolve(Buffer.concat(chunks)));
  });
  const expectOk = async (res, what) => {
    const text = (await drain(res)).toString('utf8');
    if (res.statusCode >= 200 && res.statusCode < 300) return text;
    const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1] || res.statusCode;
    throw Object.assign(new Error(`R2 ${what} failed: ${code}`), { status: 502 });
  };

  return {
    async put(key, stream, length, type = 'application/octet-stream') {
      await expectOk(await request('PUT', key, { body: stream, length, headers: { 'content-type': type } }), 'upload');
    },
    async putBuffer(key, buffer, type = 'application/octet-stream') {
      await expectOk(await request('PUT', key, { body: buffer, headers: { 'content-type': type } }), 'write');
    },
    // Resolves the raw response (status 200/206) or throws.
    async get(key, range) {
      const res = await request('GET', key, { headers: range ? { range } : {} });
      if (res.statusCode === 200 || res.statusCode === 206) return res;
      await expectOk(res, 'read');
      return res;
    },
    async getBuffer(key) {
      const res = await request('GET', key);
      if (res.statusCode === 404) { res.resume(); return null; }
      if (res.statusCode !== 200) { await expectOk(res, 'read'); return null; }
      return drain(res);
    },
    async copy(fromKey, toKey) {
      const source = `/${encodeURIComponent(bucket)}/${encodeKey(prefix + fromKey)}`;
      await expectOk(await request('PUT', toKey, { headers: { 'x-amz-copy-source': source } }), 'copy');
    },
    async remove(key) {
      const res = await request('DELETE', key);
      if (res.statusCode === 404) { res.resume(); return; }
      await expectOk(res, 'delete');
    }
  };
}

// Builds a client from ASOC_R2_* environment variables, or null when unset.
function fromEnv(env = process.env) {
  const accessKeyId = env.ASOC_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.ASOC_R2_SECRET_ACCESS_KEY;
  const endpoint = env.ASOC_R2_ENDPOINT || (env.ASOC_R2_ACCOUNT_ID ? `https://${env.ASOC_R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
  if (!accessKeyId || !secretAccessKey || !endpoint) return null;
  return create({ endpoint, bucket: env.ASOC_R2_BUCKET || 'asoc-infostud', accessKeyId, secretAccessKey, prefix: env.ASOC_R2_PREFIX || '' });
}

module.exports = { create, fromEnv, sign };
