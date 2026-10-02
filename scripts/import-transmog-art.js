#!/usr/bin/env node
// Imports finished Shadow Broker TRANSMOG art into the catalog's asset slots.
//
//   node scripts/import-transmog-art.js <folder-with-pngs>
//
// Each source is a square transparent PNG (any size, 1024+ recommended)
// named NN_<name>.png; MAP below says which set folder it fills. Writes
// assets/transmog/<folder>/avatar.webp (512px) and thumb.webp (192px),
// alpha preserved. Uses the Playwright Chromium the browser tests install.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/transmog');
const MAP = {
  '01_default_broker': 'default', '02_void_broker': 'void', '03_blood_broker': 'blood', '04_whiteout_broker': 'whiteout',
  '05_warsong_broker': 'warsong', '06_sovereign_broker': 'sovereign', '07_glitch_broker': 'glitch', '08_omen_broker': 'omen',
  '09_bloodfang': 'bloodfang', '10_the_betrayer': 'illidan'
};

(async () => {
  const src = process.argv[2];
  if (!src || !fs.existsSync(src)) { console.error('usage: node scripts/import-transmog-art.js <folder>'); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, folder] of Object.entries(MAP)) {
    const input = path.join(src, `${file}.png`);
    if (!fs.existsSync(input)) { console.warn(`skip ${folder}: ${file}.png not found`); continue; }
    const data = 'data:image/png;base64,' + fs.readFileSync(input).toString('base64');
    const out = await page.evaluate(async d => {
      const img = new Image(); img.src = d; await img.decode();
      const size = n => { const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, n, n); return c; };
      const a = size(512);
      return { avatar: a.toDataURL('image/webp', 0.9), thumb: size(192).toDataURL('image/webp', 0.88), cornerAlpha: a.getContext('2d').getImageData(2, 2, 1, 1).data[3] };
    }, data);
    fs.mkdirSync(path.join(OUT, folder), { recursive: true });
    fs.writeFileSync(path.join(OUT, folder, 'avatar.webp'), Buffer.from(out.avatar.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, folder, 'thumb.webp'), Buffer.from(out.thumb.split(',')[1], 'base64'));
    console.log(`${folder}: avatar ${fs.statSync(path.join(OUT, folder, 'avatar.webp')).size} B, thumb ${fs.statSync(path.join(OUT, folder, 'thumb.webp')).size} B, corner alpha ${out.cornerAlpha}`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
