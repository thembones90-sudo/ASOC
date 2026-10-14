'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create } = require('../tribute-media-store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-tribute-media-'));
try {
  const store = create(root);
  const bytes = crypto.randomBytes(360000);
  const original = 'data:image/png;base64,' + bytes.toString('base64');
  const refs = Array.from({ length: 72 }, () => store.putDataUrl(original));
  assert.equal(new Set(refs).size, 1, 'content-addressed duplicates share one durable blob');
  assert.deepEqual(store.read(refs[0]).buffer, bytes, 'media round-trips byte-for-byte');
  assert.deepEqual(create(root).read(refs[0]).buffer, bytes, 'a fresh store instance recovers media byte-for-byte');
  const file = path.join(store.dir, refs[0].split(':')[1] + '.blob');
  fs.writeFileSync(file, Buffer.from('corrupt'));
  assert.equal(store.read(refs[0]), null, 'corruption is detected and never served');
  fs.unlinkSync(file);
  assert.equal(store.read(refs[0]), null, 'missing media is reported unavailable');
  assert.throws(() => store.putDataUrl('data:text/plain;base64,QQ=='), /invalid/);
  console.log('PASS tribute media store: 72 synthetic objects, byte identity, corruption and missing handling');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
