#!/usr/bin/env node
// Builds the Shadow Broker TRANSMOG set art from the base Broker avatar.
// Every set's avatar is the canonical Broker (assets/ui/shadow-broker.png)
// recoloured and dressed with drawn set pieces, so all skins read as the same
// figure in different armour. Output: assets/transmog/<set>/avatar.webp
// (512px) and thumb.webp (192px).
//
//   node scripts/build-transmog-art.js            # all sets
//   node scripts/build-transmog-art.js illidan    # one set
//
// Uses the Playwright Chromium already installed for the browser tests.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'assets/ui/shadow-broker.png');
const OUT = path.join(ROOT, 'assets/transmog');
const ONLY = process.argv.slice(2);

// Runs in the browser. `S` is 512; the Broker's lit eye sits near (300,179),
// the head's crown near (245,70); the frame ring has radius ~250.
const RECIPES = String.raw`
const S = 512, CX = 256, CY = 256, EYE = [300, 179];
const ring = (ctx, color, width, glow) => { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.shadowColor = glow || color; ctx.shadowBlur = 18; ctx.beginPath(); ctx.arc(CX, CY, 238, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); };
const clipCircle = (ctx, r = 246) => { ctx.beginPath(); ctx.arc(CX, CY, r, 0, Math.PI * 2); ctx.clip(); };
const glowDot = (ctx, x, y, r, color, core = '#fff') => { ctx.save(); const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, core); g.addColorStop(0.18, color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
const tint = (ctx, color, mode, alpha = 1) => { ctx.save(); clipCircle(ctx, 250); ctx.globalCompositeOperation = mode; ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(0, 0, S, S); ctx.restore(); };
const vignette = (ctx, color, inner = 120, alpha = 0.75) => { ctx.save(); clipCircle(ctx, 250); const g = ctx.createRadialGradient(CX, CY - 20, inner, CX, CY, 250); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, color); ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); ctx.restore(); };
const wisps = (ctx, color, n, seed, yMin = 260, alpha = 0.5) => { let s = seed; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280; ctx.save(); clipCircle(ctx, 240); ctx.globalCompositeOperation = 'lighter'; for (let i = 0; i < n; i++) { const x = 60 + r() * 392, y = yMin + r() * (470 - yMin), h = 40 + r() * 90; const g = ctx.createLinearGradient(x, y, x, y - h); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = alpha * (0.4 + r() * 0.6); ctx.strokeStyle = g; ctx.lineWidth = 2 + r() * 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + (r() - .5) * 40, y - h * .35, x + (r() - .5) * 50, y - h * .7, x + (r() - .5) * 30, y - h); ctx.stroke(); } ctx.restore(); };
const base = (ctx, img, filter) => { ctx.save(); ctx.filter = filter || 'none'; ctx.drawImage(img, 0, 0, S, S); ctx.restore(); };

const R = {
  default(ctx, img) { base(ctx, img); },
  void(ctx, img) {
    base(ctx, img, 'hue-rotate(-12deg) saturate(1.5) brightness(1.12) contrast(1.1)');
    vignette(ctx, 'rgba(8,0,20,1)', 120, .5);
    wisps(ctx, 'rgba(150,70,255,.9)', 26, 7, 300, .45);
    glowDot(ctx, EYE[0], EYE[1], 26, 'rgba(190,110,255,.9)');
    ring(ctx, 'rgba(120,40,220,.9)', 5, '#7a2cff');
  },
  blood(ctx, img) {
    base(ctx, img, 'hue-rotate(72deg) saturate(1.5) brightness(.85) contrast(1.15)');
    vignette(ctx, 'rgba(30,0,4,1)', 110, .55);
    glowDot(ctx, EYE[0], EYE[1], 26, 'rgba(255,30,50,.95)');
    ring(ctx, 'rgba(220,20,40,.95)', 5, '#ff1a33');
  },
  whiteout(ctx, img) {
    base(ctx, img, 'grayscale(.9) brightness(1.35) contrast(1.05)');
    tint(ctx, '#9fd8ff', 'color', .55);
    tint(ctx, 'rgba(230,245,255,1)', 'soft-light', .35);
    let s = 3; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    ctx.save(); clipCircle(ctx, 244); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) { const x = r() * S, y = r() * S, z = r() * 2.2 + .4; ctx.globalAlpha = .35 + r() * .5; ctx.fillStyle = '#eaf6ff'; ctx.beginPath(); ctx.arc(x, y, z, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    glowDot(ctx, EYE[0], EYE[1], 24, 'rgba(160,225,255,.95)');
    ring(ctx, 'rgba(200,235,255,.95)', 5, '#9fe0ff');
  },
  warsong(ctx, img) {
    base(ctx, img, 'hue-rotate(78deg) saturate(1.9) contrast(1.4) brightness(.82)');
    vignette(ctx, 'rgba(0,0,0,1)', 100, .6);
    // Three torn claw slashes across the frame.
    ctx.save(); clipCircle(ctx, 244); ctx.globalCompositeOperation = 'lighter';
    [[-34, 0], [0, 0], [34, 0]].forEach(([dx]) => { const g = ctx.createLinearGradient(330 + dx, 250, 180 + dx, 470); g.addColorStop(0, 'rgba(255,110,30,0)'); g.addColorStop(.5, 'rgba(255,90,20,.85)'); g.addColorStop(1, 'rgba(255,40,20,0)'); ctx.strokeStyle = g; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(350 + dx, 250); ctx.quadraticCurveTo(300 + dx, 360, 200 + dx, 470); ctx.stroke(); });
    ctx.restore();
    glowDot(ctx, EYE[0], EYE[1], 28, 'rgba(255,90,20,.95)');
    ring(ctx, 'rgba(200,20,10,.95)', 6, '#ff3b14');
  },
  sovereign(ctx, img) {
    base(ctx, img, 'saturate(1.2) brightness(.95)');
    tint(ctx, 'rgba(255,200,80,1)', 'soft-light', .18);
    // Crown of the Broker: a gilded, five-point mechanical diadem.
    ctx.save(); ctx.translate(244, 52);
    const g = ctx.createLinearGradient(0, -40, 0, 30); g.addColorStop(0, '#fff3b0'); g.addColorStop(.45, '#f2b62f'); g.addColorStop(1, '#7a4a07');
    ctx.fillStyle = g; ctx.strokeStyle = '#3a2203'; ctx.lineWidth = 2.5; ctx.shadowColor = 'rgba(255,190,60,.9)'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.moveTo(-70, 26); ctx.lineTo(-78, -18); ctx.lineTo(-45, 4); ctx.lineTo(-26, -38); ctx.lineTo(0, 0); ctx.lineTo(26, -38); ctx.lineTo(45, 4); ctx.lineTo(78, -18); ctx.lineTo(70, 26); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; [[-78, -18], [-26, -38], [26, -38], [78, -18]].forEach(([x, y]) => { ctx.fillStyle = '#b86cff'; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#9b5de0'; ctx.beginPath(); ctx.arc(0, 12, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    glowDot(ctx, EYE[0], EYE[1], 24, 'rgba(255,200,90,.95)');
    ring(ctx, 'rgba(240,180,50,.95)', 6, '#ffcc4d');
    ctx.save(); ctx.strokeStyle = 'rgba(155,93,224,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(CX, CY, 230, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  },
  glitch(ctx, img) {
    // RGB split + torn horizontal slices + scanlines.
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = S; const t = tmp.getContext('2d'); t.drawImage(img, 0, 0, S, S);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    [['rgba(255,0,60,1)', -6], ['rgba(0,255,220,1)', 6], ['rgba(140,80,255,1)', 0]].forEach(([c, dx]) => { const l = document.createElement('canvas'); l.width = l.height = S; const lc = l.getContext('2d'); lc.drawImage(tmp, 0, 0); lc.globalCompositeOperation = 'multiply'; lc.fillStyle = c; lc.fillRect(0, 0, S, S); lc.globalCompositeOperation = 'destination-in'; lc.drawImage(tmp, 0, 0); ctx.drawImage(l, dx, 0); });
    ctx.restore();
    let s = 11; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 9; i++) { const y = 60 + r() * 380, h = 4 + r() * 14, dx = (r() - .5) * 46; ctx.drawImage(tmp, 0, y, S, h, dx, y, S, h); }
    ctx.save(); clipCircle(ctx, 248); ctx.globalAlpha = .18; ctx.fillStyle = '#000'; for (let y = 0; y < S; y += 3) ctx.fillRect(0, y, S, 1); ctx.restore();
    glowDot(ctx, EYE[0], EYE[1], 22, 'rgba(0,255,220,.9)');
  },
  omen(ctx, img) {
    base(ctx, img, 'grayscale(1) brightness(1.15) contrast(1.15)');
    tint(ctx, '#c9a050', 'color', .5);
    // The Omen: a vast mechanical eye opening behind the Broker.
    ctx.save(); clipCircle(ctx, 244); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .55; ctx.translate(150, 150);
    ctx.strokeStyle = '#e8c372'; ctx.lineWidth = 2.5; ctx.shadowColor = '#ffcf6a'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(-95, 0); ctx.quadraticCurveTo(0, -62, 95, 0); ctx.quadraticCurveTo(0, 62, -95, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffe2a0'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 22, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 38, Math.sin(a) * 38); ctx.lineTo(Math.cos(a) * 50, Math.sin(a) * 50); ctx.stroke(); }
    ctx.restore();
    vignette(ctx, 'rgba(10,6,0,1)', 130, .45);
    glowDot(ctx, EYE[0], EYE[1], 26, 'rgba(255,200,100,.95)');
    ring(ctx, 'rgba(200,160,80,.9)', 5, '#ffcf6a');
  },
  bloodfang(ctx, img) {
    // Elite assassin: near-black leathers, controlled crimson, twin eye glints.
    base(ctx, img, 'grayscale(.4) hue-rotate(72deg) saturate(1.4) brightness(1.05) contrast(1.25)');
    vignette(ctx, 'rgba(0,0,0,1)', 120, .55);
    // Assassin's half-mask across the lower face.
    ctx.save(); clipCircle(ctx, 244);
    const m = ctx.createLinearGradient(200, 190, 340, 250); m.addColorStop(0, '#0a0204'); m.addColorStop(1, '#1d0408');
    ctx.globalAlpha = .82; ctx.fillStyle = m; ctx.beginPath(); ctx.moveTo(222, 200); ctx.quadraticCurveTo(275, 192, 330, 196); ctx.quadraticCurveTo(326, 226, 300, 240); ctx.quadraticCurveTo(262, 252, 232, 232); ctx.quadraticCurveTo(220, 218, 222, 200); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(200,16,40,.9)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(222, 200); ctx.quadraticCurveTo(275, 192, 330, 196); ctx.stroke();
    ctx.restore();
    // Red mist low in the frame.
    wisps(ctx, 'rgba(160,0,20,.9)', 22, 5, 330, .5);
    // Twin dagger crest at the foot of the ring.
    ctx.save(); ctx.translate(256, 470); ctx.shadowColor = '#ff1f3d'; ctx.shadowBlur = 10;
    [-1, 1].forEach(sg => { ctx.save(); ctx.rotate(sg * 0.55); const g = ctx.createLinearGradient(0, -44, 0, 10); g.addColorStop(0, '#ffd2d8'); g.addColorStop(.4, '#c4122c'); g.addColorStop(1, '#3a0008'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(5, -6); ctx.lineTo(-5, -6); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#2a0006'; ctx.fillRect(-9, -6, 18, 3); ctx.fillRect(-2.5, -3, 5, 12); ctx.restore(); });
    ctx.restore();
    glowDot(ctx, EYE[0], EYE[1], 20, 'rgba(255,20,45,.95)');
    glowDot(ctx, EYE[0] - 40, EYE[1] + 3, 13, 'rgba(230,10,35,.85)', '#ffb3bf');
    ring(ctx, 'rgba(140,0,20,.95)', 6, '#c4122c');
    ctx.save(); ctx.strokeStyle = 'rgba(20,0,4,.95)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(CX, CY, 232, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  },
  illidan(ctx, img) {
    // The Betrayer: fel-scarred, blindfolded, horned, burning green.
    base(ctx, img, 'hue-rotate(178deg) saturate(1.6) brightness(1.08) contrast(1.2)');
    vignette(ctx, 'rgba(0,6,0,1)', 120, .5);
    // Great curved horns sweeping up and back from the brow.
    const horn = sg => { ctx.save(); ctx.translate(250 + sg * 30, 132); const g = ctx.createLinearGradient(0, 10, sg * 110, -110); g.addColorStop(0, '#231a12'); g.addColorStop(.45, '#5a4a36'); g.addColorStop(.85, '#cbbb98'); g.addColorStop(1, '#efe4c8'); ctx.fillStyle = g; ctx.strokeStyle = 'rgba(90,255,50,.7)'; ctx.shadowColor = '#3dff2a'; ctx.shadowBlur = 12; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-sg * 12, 10); ctx.bezierCurveTo(sg * 14, -30, sg * 40, -70, sg * 102, -84); ctx.bezierCurveTo(sg * 64, -60, sg * 44, -26, sg * 24, 16); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(20,12,6,.55)'; ctx.lineWidth = 1.6; for (let k = 1; k < 7; k++) { const t = k / 7; const x0 = sg * (2 + 60 * t * t + 18 * t), y0 = 8 - 80 * t; ctx.beginPath(); ctx.moveTo(x0 - sg * 6, y0 + 4); ctx.lineTo(x0 + sg * 16 * (1 - t) + sg * 6, y0 + 10 * (1 - t)); ctx.stroke(); } ctx.restore(); };
    ctx.save(); clipCircle(ctx, 244); horn(-1); horn(1); ctx.restore();
    // Blindfold, curving with the face; fel light bleeds through at the eyes.
    ctx.save(); clipCircle(ctx, 244);
    const b = ctx.createLinearGradient(0, 166, 0, 196); b.addColorStop(0, '#16140f'); b.addColorStop(.5, '#2e2a22'); b.addColorStop(1, '#0c0b08');
    ctx.fillStyle = b; ctx.beginPath(); ctx.moveTo(208, 176); ctx.quadraticCurveTo(268, 160, 334, 170); ctx.lineTo(338, 190); ctx.quadraticCurveTo(268, 182, 212, 198); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(90,255,50,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
    glowDot(ctx, EYE[0], EYE[1], 30, 'rgba(90,255,40,.95)', '#eaffd0');
    glowDot(ctx, EYE[0] - 46, EYE[1] + 5, 27, 'rgba(90,255,40,.9)', '#eaffd0');
    // Fel tattoo lines down the shoulder and fel fire rising.
    ctx.save(); clipCircle(ctx, 240); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(80,255,50,.75)'; ctx.shadowColor = '#4dff2e'; ctx.shadowBlur = 10; ctx.lineWidth = 2.2;
    [[120, 330, 170, 300, 150, 380], [140, 370, 190, 350, 175, 420], [360, 330, 330, 300, 350, 390]].forEach(([a, b2, c, d, e, f]) => { ctx.beginPath(); ctx.moveTo(a, b2); ctx.quadraticCurveTo(c, d, e, f); ctx.stroke(); });
    ctx.restore();
    wisps(ctx, 'rgba(70,255,40,.95)', 30, 13, 320, .55);
    ring(ctx, 'rgba(60,220,30,.95)', 6, '#4dff2e');
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(CX, CY, 231, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
};
`;

(async () => {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : {});
  const page = await browser.newPage();
  const baseData = 'data:image/png;base64,' + fs.readFileSync(BASE).toString('base64');
  const sets = ['default', 'void', 'blood', 'whiteout', 'warsong', 'sovereign', 'glitch', 'omen', 'bloodfang', 'illidan'].filter(s => !ONLY.length || ONLY.includes(s));
  for (const set of sets) {
    const out = await page.evaluate(async ({ src, set, recipes }) => {
      // eslint-disable-next-line no-new-func
      const R = new Function(recipes + '; return R;')();
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 512;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      R[set](ctx, img);
      // Everything outside the medallion stays transparent.
      ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(img, 0, 0, 512, 512);
      const t = document.createElement('canvas'); t.width = t.height = 192; const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(c, 0, 0, 192, 192);
      return { avatar: c.toDataURL('image/webp', 0.88), thumb: t.toDataURL('image/webp', 0.85) };
    }, { src: baseData, set, recipes: RECIPES });
    const dir = path.join(OUT, set);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'avatar.webp'), Buffer.from(out.avatar.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(dir, 'thumb.webp'), Buffer.from(out.thumb.split(',')[1], 'base64'));
    console.log(`${set}: avatar ${fs.statSync(path.join(dir, 'avatar.webp')).size} B, thumb ${fs.statSync(path.join(dir, 'thumb.webp')).size} B`);
  }
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
