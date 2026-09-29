#!/usr/bin/env node
// Builds lighter WebP copies of the large PNG artwork for phones.
//
//   assets/**/<name>.png  (> 150 KB)  ->  assets/.webp/**/<name>.png.webp
//
// Longest side capped at 1024 px (the UI never shows these larger), quality
// 0.85, alpha kept. The server serves the copy in place of the PNG to any
// browser that accepts image/webp (same URL, `Vary: Accept`), so no CSS/JS/
// HTML reference changes and the originals stay the source of truth.
//
// Encoding uses Playwright's Chromium (already a dev dependency), so there
// is no native image toolchain to install. Re-run after changing artwork:
//   node scripts/optimize-images.js
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const OUT = path.join(ASSETS, '.webp');
const MIN_BYTES = 150 * 1024;
const MAX_SIDE = 1024;
const QUALITY = 0.85;

function pngs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pngs(full));
    else if (/\.png$/i.test(entry.name) && fs.statSync(full).size > MIN_BYTES) out.push(full);
  }
  return out;
}

(async () => {
  const files = pngs(ASSETS);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let before = 0, after = 0, written = 0;
  for (const file of files) {
    const rel = path.relative(ASSETS, file);
    const target = path.join(OUT, rel + '.webp');
    const src = fs.statSync(file);
    before += src.size;
    if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= src.mtimeMs) { after += fs.statSync(target).size; continue; }
    const dataUrl = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    const webp = await page.evaluate(async ({ dataUrl, maxSide, quality }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', quality);
    }, { dataUrl, maxSide: MAX_SIDE, quality: QUALITY });
    const bytes = Buffer.from(webp.split(',')[1], 'base64');
    if (bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('WebP encoding unavailable for ' + rel);
    // Never serve a "lighter" copy that is not actually lighter.
    if (bytes.length >= src.size) { try { fs.unlinkSync(target); } catch {} continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    after += bytes.length;
    written++;
  }
  await browser.close();
  console.log(`optimize-images: ${files.length} large PNGs, ${written} (re)encoded; ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB as WebP`);
})().catch(error => { console.error(error); process.exit(1); });
