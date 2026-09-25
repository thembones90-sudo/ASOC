'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const join = fs.readFileSync(path.join(root, 'join.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'site.webmanifest'), 'utf8'));

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const dimensions = file => {
  const buffer = fs.readFileSync(file);
  assert(buffer.subarray(0, 8).equals(pngSignature), `${path.basename(file)} must be PNG`);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
};

const expected = {
  'favicon-16.png': 16,
  'favicon-32.png': 32,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
  'asoc-app-icon.png': 1024
};
for (const [name, size] of Object.entries(expected)) {
  assert.deepStrictEqual(dimensions(path.join(root, 'assets', 'ui', name)), [size, size], `${name} must be ${size}×${size}`);
}
assert.deepStrictEqual(dimensions(path.join(root, 'desktop', 'build', 'icon.png')), [1024, 1024], 'Electron source icon must be 1024×1024');

const ico = fs.readFileSync(path.join(root, 'assets', 'ui', 'favicon.ico'));
assert.strictEqual(ico.readUInt16LE(2), 1, 'favicon.ico must identify as an icon');
assert.strictEqual(ico.readUInt16LE(4), 7, 'favicon.ico must contain all seven Windows sizes');

for (const html of [index, join]) {
  assert(html.includes('/assets/ui/favicon.ico?v=20260924-eye-1'), 'page must reference the multi-size favicon');
  assert(html.includes('/assets/ui/apple-touch-icon.png?v=20260924-eye-1'), 'page must reference the Apple touch icon');
  assert(html.includes('/site.webmanifest?v=20260924-eye-1'), 'page must reference the web manifest');
}
assert.strictEqual(manifest.icons.length, 2, 'manifest must expose 192px and 512px app icons');
assert(server.includes("'.webmanifest': 'application/manifest+json'"), 'server must send the web manifest MIME type');

console.log('icon-assets: all checks passed');
