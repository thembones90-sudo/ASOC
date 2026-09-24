'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const source = process.argv[2];

if (!source || !fs.existsSync(source)) {
  console.error('Usage: node scripts/build-icon-assets.js <source-png>');
  process.exit(1);
}

const uiDir = path.join(root, 'assets', 'ui');
const desktopDir = path.join(root, 'desktop', 'build');
fs.mkdirSync(uiDir, { recursive: true });
fs.mkdirSync(desktopDir, { recursive: true });

async function renderIcon(size, inset = 0.06) {
  const artSize = Math.max(1, Math.round(size * (1 - inset * 2)));
  const art = await sharp(source)
    .resize(artSize, artSize, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const edge = Math.floor((size - artSize) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: edge, top: edge }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function makeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  images.forEach(({ size, buffer }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });
  return Buffer.concat([header, ...images.map(image => image.buffer)]);
}

(async () => {
  const metadata = await sharp(source).metadata();
  if (metadata.format !== 'png') throw new Error('Icon source must be a PNG');
  if ((metadata.width || 0) < 512 || (metadata.height || 0) < 512) throw new Error('Icon source must be at least 512 × 512');

  const outputs = [
    ['asoc-app-icon.png', 1024],
    ['favicon-16.png', 16],
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512]
  ];
  for (const [name, size] of outputs) {
    fs.writeFileSync(path.join(uiDir, name), await renderIcon(size));
  }

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = [];
  for (const size of icoSizes) icoImages.push({ size, buffer: await renderIcon(size) });
  fs.writeFileSync(path.join(uiDir, 'favicon.ico'), makeIco(icoImages));

  fs.copyFileSync(path.join(uiDir, 'asoc-app-icon.png'), path.join(desktopDir, 'icon.png'));
  console.log(`Built ASOC icons from ${metadata.width}×${metadata.height} ${metadata.hasAlpha ? 'RGBA' : 'RGB'} source.`);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
