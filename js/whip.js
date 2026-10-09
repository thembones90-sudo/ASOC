(() => {
'use strict';
// ASOC /whip // full-stage punishment. A braided leather whip is wound up, cracked across the
// screen and lands on the target with comic-book violence. Everything is time-driven from one
// clock so a fake clock can step it frame by frame (see tests/whip-browser.js).
//
//   normal   left hand cracks the whip, right avatar takes it.
//   hijack   right hand cracks first, the target CATCHES the tip, snatches the whip away
//            (YOINK) and gives the attacker a worse one back.
const BROKER = 'shadow-broker';
let clearTimer = null;
let rafId = 0;
let fx = null;
let audioContext = null;
let tickTimers = [];

function clear() {
  clearTimeout(clearTimer);
  tickTimers.forEach(clearTimeout);
  tickTimers = [];
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (fx) { try { fx.destroy(); } catch {} fx = null; }
  document.getElementById('asoc-whip-effect')?.remove();
}

function avatar(src, fallback) {
  const el = document.createElement('div'); el.className = 'asoc-whip-avatar';
  if (/^(data:image\/(png|jpeg|webp|gif);base64,|\/|assets\/|https?:\/\/)/i.test(String(src || ''))) {
    const image = document.createElement('img'); image.src = src; image.alt = '';
    image.onerror = () => { image.remove(); el.textContent = String(fallback || '?').slice(0, 2).toUpperCase(); };
    el.appendChild(image);
  } else el.textContent = String(fallback || '?').slice(0, 2).toUpperCase();
  return el;
}

function crack() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    audioContext ||= new Context();
    if (audioContext.state === 'suspended') return;
    const duration = .15, n = Math.floor(audioContext.sampleRate * duration);
    const buffer = audioContext.createBuffer(1, n, audioContext.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
    const noise = audioContext.createBufferSource(); noise.buffer = buffer;
    const filter = audioContext.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 750;
    const gain = audioContext.createGain(); gain.gain.value = .19;
    noise.connect(filter); filter.connect(gain); gain.connect(audioContext.destination);
    noise.start(); noise.stop(audioContext.currentTime + duration);
  } catch {}
}

// ---------------------------------------------------------------------------------------------
// Whip choreography. Keyframes are in "whip time" (seconds) in the holder's local frame:
//   a, b  = tip position as a fraction of whip length, along (a) and above (b) the hand->target line
//   hx,hy = hand offset in avatar radii (hx forward, hy up)
const K_BASE = [
  { t: 0,    a: .04,  b: -.42, hx: 0,    hy: 0 },
  { t: .35,  a: .04,  b: -.42, hx: 0,    hy: 0,    e: 'io' },
  { t: .55,  a: -.35, b: .35,  hx: -.12, hy: -.12, e: 'out' },
  { t: .85,  a: -.88, b: .78,  hx: -.30, hy: -.40, e: 'io' },
  { t: 1.00, a: -.95, b: .62,  hx: -.34, hy: -.42, e: 'io' },
  { t: 1.12, a: -.15, b: 1.0,  hx: -.05, hy: -.50, e: 'in' },
  { t: 1.22, a: .60,  b: .55,  hx: .20,  hy: -.30, e: 'lin' },
  { t: 1.30, a: 1,    b: 0,    hx: .38,  hy: -.08, e: 'lin' }
];
const K_TAIL = [
  { t: 1.55, a: .86, b: -.22, hx: .25, hy: 0,   e: 'out' },
  { t: 2.00, a: .30, b: -.42, hx: .05, hy: .05, e: 'io' },
  { t: 2.60, a: .05, b: -.40, hx: 0,   hy: 0,   e: 'io' },
  { t: 3.40, a: .04, b: -.40, hx: 0,   hy: 0,   e: 'io' }
];
const K_CATCH = [
  { t: 1.45, a: 1, b: 0, hx: .40, hy: -.06, e: 'lin' },
  { t: 1.80, a: 1, b: 0, hx: .42, hy: -.05, e: 'lin' }
];
const ease = {
  io: f => f * f * (3 - 2 * f),
  in: f => f * f * f,
  out: f => 1 - Math.pow(1 - f, 2),
  lin: f => f
};
function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const f = (ease[k1.e] || ease.io)((t - k0.t) / (k1.t - k0.t));
  return { a: k0.a + (k1.a - k0.a) * f, b: k0.b + (k1.b - k0.b) * f, hx: k0.hx + (k1.hx - k0.hx) * f, hy: k0.hy + (k1.hy - k0.hy) * f };
}

function plan(hijacked) {
  if (!hijacked) {
    return {
      segs: [{ holder: 'L', off: 0, from: 0, to: 99, keys: K_BASE.concat(K_TAIL), fadeEnd: [2.5, 3.1], pal: 'leather' }],
      holds: [{ w: 1.30, d: .08 }],
      events: [{ w: 1.30, type: 'hit', holder: 'L' }],
      sweat: [{ side: 'R', from: .55, to: 1.28 }],
      lean: [{ side: 'L', w: .35 }],
      endW: 3.15,
      lineW: .75
    };
  }
  return {
    segs: [
      { holder: 'R', off: 0, from: 0, to: 1.78, keys: K_BASE.concat(K_CATCH), fadeEnd: [1.70, 1.78], pal: 'leather' },
      { holder: 'L', off: 1.55, from: 1.78, to: 99, keys: K_BASE.concat(K_TAIL), fadeEnd: [4.05, 4.65], pal: 'hijack' }
    ],
    holds: [{ w: 1.30, d: .07 }, { w: 2.85, d: .09 }],
    events: [
      { w: 1.30, type: 'catch', holder: 'R' },
      { w: 1.77, type: 'yoink', holder: 'R' },
      { w: 2.85, type: 'hit', holder: 'L' }
    ],
    sweat: [{ side: 'L', from: .55, to: 1.28 }, { side: 'R', from: 2.10, to: 2.83 }],
    lean: [{ side: 'R', w: .35 }, { side: 'L', w: 1.90 }],
    endW: 4.7,
    lineW: 1.95
  };
}
// Whip time -> real time (holds freeze the whip for a few frames on every impact).
function realOf(P, w) { let t = w; for (const h of P.holds) if (h.w < w) t += h.d; return t; }
function warpOf(P, t) { let w = t; for (const h of P.holds) { const r = realOf(P, h.w); if (t > r) w -= Math.min(h.d, t - r); } return w; }

const PALETTE = {
  leather: { body: '#6b3822', dark: '#1d0c07', hi: '#e0a36c', tick: '#2a120a', glow: 'rgba(255,190,110,', grip: '#14090a' },
  hijack: { body: '#8e1330', dark: '#26040c', hi: '#ff8aa0', tick: '#3a0614', glow: 'rgba(255,70,120,', grip: '#10040a' }
};

// ---------------------------------------------------------------------------------------------
function starburst() {
  const spikes = 20, cx = 100, cy = 100;
  let d = '';
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? 62 : 98 + (i % 4 === 0 ? 0 : -14);
    const ang = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    d += (i ? 'L' : 'M') + (cx + Math.cos(ang) * r).toFixed(1) + ' ' + (cy + Math.sin(ang) * r).toFixed(1);
  }
  return d + 'Z';
}

function onMessage(event, playerId, isGM = false) {
  if (event?.type !== 'whip:impact') return;
  clear();
  const id = isGM ? BROKER : String(playerId || '');
  const victim = String(event.victimId || '');
  const role = id === victim ? 'victim' : id === String(event.actorId) ? 'attacker' : 'observer';
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const hijacked = event.hijacked === true;
  const P = plan(hijacked);
  const vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
  const narrow = vw < 600;
  const D = Math.max(88, Math.min(vw * .15, vh * .30, 220));
  const R = D / 2;
  const lx = vw * (narrow ? .22 : .25), rx = vw * (narrow ? .78 : .75), cy = vh * .46;
  const R2 = n => Math.round(n * 1000) / 1000;

  const layer = document.createElement('aside');
  layer.id = 'asoc-whip-effect';
  layer.className = 'asoc-whip-' + role + (hijacked ? ' is-hijacked' : '') + (reduced ? ' reduced-motion' : '');
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');
  const hitEv = P.events[P.events.length - 1];
  const hitReal = realOf(P, hitEv.w);
  const catchEv = P.events.find(e => e.type === 'catch');
  const vars = {
    '--D': D + 'px', '--lx': lx + 'px', '--rx': rx + 'px', '--cy': cy + 'px',
    '--t-hit': R2(hitReal) + 's',
    '--t-line': R2(realOf(P, P.lineW)) + 's',
    '--t-end': R2(realOf(P, P.endW)) + 's',
    '--t-catch': catchEv ? R2(realOf(P, catchEv.w)) + 's' : '999s',
    '--t-yoink': hijacked ? R2(realOf(P, 1.77)) + 's' : '999s',
    '--lean-L': '999s', '--lean-R': '999s',
    '--hit-L': '999s', '--hit-R': hijacked ? R2(hitReal) + 's' : R2(hitReal) + 's',
    '--pop-L': catchEv ? R2(realOf(P, catchEv.w)) + 's' : '999s'
  };
  P.lean.forEach(l => { vars['--lean-' + l.side] = R2(realOf(P, l.w)) + 's'; });
  // The receiver of the final blow is always the right-hand fighter.
  Object.entries(vars).forEach(([k, v]) => layer.style.setProperty(k, v));

  const vignette = document.createElement('div'); vignette.className = 'asoc-whip-vignette';
  const stage = document.createElement('div'); stage.className = 'asoc-whip-stage';
  const kicker = document.createElement('div'); kicker.className = 'asoc-whip-kicker';
  kicker.textContent = hijacked ? 'WHIP HIJACK // 15% REVERSAL' : 'THE WHIP HAS SPOKEN';
  const combatants = document.createElement('div'); combatants.className = 'asoc-whip-combatants';
  const left = document.createElement('div'); left.className = 'asoc-whip-combatant asoc-whip-actor';
  const right = document.createElement('div'); right.className = 'asoc-whip-combatant asoc-whip-target';
  const attacker = hijacked ? { name: event.targetName, avatar: event.targetAvatarData } : { name: event.actorName, avatar: event.actorAvatarData };
  const receiver = hijacked ? { name: event.actorName, avatar: event.actorAvatarData } : { name: event.targetName, avatar: event.targetAvatarData };
  function fighter(box, who, side) {
    const f = document.createElement('div'); f.className = 'asoc-whip-fighter asoc-whip-fighter-' + side;
    f.appendChild(avatar(who.avatar, who.name));
    const welts = document.createElement('div'); welts.className = 'asoc-whip-welts';
    welts.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M 8 18 L 92 58"/><path d="M 4 42 L 96 86"/><path d="M 30 8 L 86 36"/></svg>';
    f.appendChild(welts);
    box.appendChild(f);
    const label = document.createElement('span'); label.className = 'asoc-whip-name';
    label.textContent = String(who.name || 'LITTLE HERO').slice(0, 50);
    box.appendChild(label);
  }
  fighter(left, attacker, 'L'); fighter(right, receiver, 'R');
  combatants.append(left, right);

  // Static whip, shown only for reduced motion (the canvas draws the real one).
  const lash = document.createElement('div'); lash.className = 'asoc-whip-lash';
  lash.innerHTML = '<svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true"><path d="M 8 70 C 90 -10, 210 110, 392 40"/></svg>';

  const canvas = document.createElement('canvas'); canvas.className = 'asoc-whip-canvas'; canvas.setAttribute('aria-hidden', 'true');

  const burst = document.createElement('div'); burst.className = 'asoc-whip-burst';
  burst.style.left = ((lx + rx) / 2 - (rx - lx) * .01) + 'px';
  burst.style.top = (cy - R * 1.02) + 'px';
  burst.innerHTML = '<svg viewBox="0 0 200 200" aria-hidden="true"><path class="asoc-whip-star-back" d="' + starburst() + '"/><path class="asoc-whip-star-front" transform="translate(100 100) scale(.82) translate(-100 -100)" d="' + starburst() + '"/></svg>';
  const crackWord = document.createElement('span'); crackWord.className = 'asoc-whip-crack'; crackWord.textContent = 'CRACK!';
  burst.appendChild(crackWord);
  const aside = [];
  if (hijacked) {
    const caught = document.createElement('span'); caught.className = 'asoc-whip-word asoc-whip-caught'; caught.textContent = 'CAUGHT!';
    const yoink = document.createElement('span'); yoink.className = 'asoc-whip-word asoc-whip-yoink'; yoink.textContent = 'YOINK!';
    caught.style.left = (lx + R * 1.55) + 'px'; caught.style.top = (cy - R * 1.45) + 'px';
    yoink.style.left = ((lx + rx) / 2) + 'px'; yoink.style.top = (cy - R * .15) + 'px';
    aside.push(caught, yoink);
  }

  const line = document.createElement('div'); line.className = 'asoc-whip-line';
  line.textContent = String(event.line || 'THE WHIP HAS SPOKEN.').slice(0, 240);
  const flash = document.createElement('div'); flash.className = 'asoc-whip-flash';

  stage.append(kicker, combatants, lash, canvas, burst, ...aside, line);
  layer.append(vignette, stage, flash);
  document.body.appendChild(layer);

  const totalReal = realOf(P, P.endW) + (role === 'victim' ? .5 : .25);
  clearTimer = setTimeout(clear, (reduced ? 2200 : totalReal * 1000));
  if (reduced) return;
  setTimeout(() => layer.classList.add('is-leaving'), Math.max(0, (totalReal - .4) * 1000));

  // ------------------------------------------------------------------------------------------
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const lib = window.AsocFx;
  fx = lib?.create ? lib.create(layer, { zIndex: 7, speed: 1 }) : null;

  const sc = R / 78;
  const N = 46;
  const holderGeom = holder => {
    const dir = holder === 'L' ? 1 : -1;
    const hx0 = (holder === 'L' ? lx : rx) + dir * R * 1.16;
    const hy0 = cy + R * .12;
    const tx = (holder === 'L' ? rx : lx) - dir * R * .62;
    const ty = cy - R * .04;
    return { dir, hx0, hy0, tx, ty, len: Math.hypot(tx - hx0, ty - hy0) };
  };
  const geom = { L: holderGeom('L'), R: holderGeom('R') };

  function tipAt(seg, lt) {
    const g = geom[seg.holder];
    const k = sampleKeys(seg.keys, lt);
    let a = k.a, b = k.b;
    const mag = Math.hypot(a, b);
    let slack = 0;
    if (mag > 1) { a /= mag; b /= mag; } else slack = 1 - mag;
    const hx = g.hx0 + g.dir * k.hx * R, hy = g.hy0 - k.hy * R;
    // Tip is placed relative to the (fixed) hand-to-target frame so a=1,b=0 lands exactly on the target.
    const tx = g.hx0 + g.dir * a * g.len, ty = g.hy0 - b * g.len * .62;
    return { x: tx + (hx - g.hx0), y: ty + (hy - g.hy0), hx, hy, slack, dir: g.dir };
  }

  const body = Array.from({ length: N }, () => ({ x: 0, y: 0, w: 0, nx: 0, ny: 1 }));
  function tension(t) {
    let k = 0;
    for (const ev of P.events) {
      if (ev.type === 'yoink') continue;
      const d = t - realOf(P, ev.w);
      if (d < 0) continue;
      k = Math.max(k, d < .10 ? d / .10 : d < .45 ? 1 - (d - .10) / .35 : 0);
    }
    return k;
  }
  let curT = 0;
  function solve(seg, wt, out) {
    const lt = wt - seg.off;
    const lag = .14 - .115 * tension(curT);
    const now = tipAt(seg, lt);
    const prev = tipAt(seg, lt - .012);
    const speed = Math.hypot(now.x - prev.x, now.y - prev.y) / .012;
    const amp = Math.min(16 * sc, speed * .011 * sc);
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const ts = lt - (1 - s) * lag;
      const q = tipAt(seg, ts);
      const x = now.hx + (q.x - now.hx) * s;
      const y = now.hy + (q.y - now.hy) * s;
      const bulge = q.slack * .5 * geom[seg.holder].len * 4 * s * (1 - s);
      const chordX = q.x - now.hx, chordY = q.y - now.hy;
      const cl = Math.hypot(chordX, chordY) || 1;
      const px = -chordY / cl, py = chordX / cl;
      const wob = Math.sin(s * 15 - wt * 36) * amp * 4 * s * (1 - s) * (.35 + .65 * Math.min(1, speed / 1800));
      const o = out[i];
      o.x = x + px * wob;
      o.y = y + py * wob + bulge;
      o.w = (14 - 11.6 * Math.pow(s, .85)) * sc;
    }
    for (let i = 0; i < N; i++) {
      const a = body[Math.max(0, i - 1)], b = body[Math.min(N - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      body[i].nx = -dy / l; body[i].ny = dx / l;
    }
    return { now, speed };
  }

  function stroke(pts, widthScale, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let i = 0; i < N - 1; i++) {
      ctx.lineWidth = Math.max(.8, pts[i].w * widthScale);
      ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); ctx.stroke();
    }
  }

  function drawWhip(seg, wt, alpha) {
    const pal = PALETTE[seg.pal] || PALETTE.leather;
    const { now, speed } = solve(seg, wt, body);
    // motion-blur ghosts while the lash is fast
    if (speed > 900) {
      const ghost = Array.from({ length: N }, () => ({ x: 0, y: 0, w: 0 }));
      for (let g = 1; g <= 2; g++) {
        const sv = body.map(p => ({ ...p }));
        solve(seg, wt - g * .014, ghost);
        ctx.globalAlpha = alpha * (.26 - g * .07);
        ctx.strokeStyle = pal.hi; ctx.lineCap = 'round';
        for (let i = 0; i < N - 1; i++) { ctx.lineWidth = Math.max(.8, ghost[i].w * .8); ctx.beginPath(); ctx.moveTo(ghost[i].x, ghost[i].y); ctx.lineTo(ghost[i + 1].x, ghost[i + 1].y); ctx.stroke(); }
        sv.forEach((p, i) => { Object.assign(body[i], p); });
      }
    }
    stroke(body, 1.45, pal.dark, alpha);
    stroke(body, 1, pal.body, alpha);
    // braid: alternating light/dark ticks across the body
    ctx.lineCap = 'butt';
    for (let i = 1; i < N - 2; i += 2) {
      const p = body[i], w = p.w * .55;
      ctx.globalAlpha = alpha * .55;
      ctx.strokeStyle = (i % 4 === 1) ? pal.hi : pal.tick;
      ctx.lineWidth = Math.max(.8, 1.4 * sc);
      ctx.beginPath(); ctx.moveTo(p.x - p.nx * w + p.ny * w * .5, p.y - p.ny * w - p.nx * w * .5); ctx.lineTo(p.x + p.nx * w - p.ny * w * .5, p.y + p.ny * w + p.nx * w * .5); ctx.stroke();
    }
    // specular line
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha * .35; ctx.strokeStyle = pal.hi;
    for (let i = 0; i < N - 1; i++) {
      ctx.lineWidth = Math.max(.6, body[i].w * .22);
      ctx.beginPath(); ctx.moveTo(body[i].x - body[i].nx * body[i].w * .22, body[i].y - body[i].ny * body[i].w * .22);
      ctx.lineTo(body[i + 1].x - body[i + 1].nx * body[i + 1].w * .22, body[i + 1].y - body[i + 1].ny * body[i + 1].w * .22); ctx.stroke();
    }
    // grip, extending back from the hand
    const p0 = body[0], p1 = body[3];
    let gx = p0.x - p1.x, gy = p0.y - p1.y; const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    const glen = 84 * sc;
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha; ctx.strokeStyle = '#000'; ctx.lineWidth = 16 * sc;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p0.x + gx * glen, p0.y + gy * glen); ctx.stroke();
    ctx.strokeStyle = pal.grip; ctx.lineWidth = 12.5 * sc;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p0.x + gx * glen, p0.y + gy * glen); ctx.stroke();
    ctx.strokeStyle = '#e2b84a'; ctx.lineWidth = 3 * sc; ctx.lineCap = 'butt';
    for (const f of [.12, .5, .86]) {
      const cx = p0.x + gx * glen * f, cyy = p0.y + gy * glen * f;
      ctx.beginPath(); ctx.moveTo(cx - gy * 7 * sc, cyy + gx * 7 * sc); ctx.lineTo(cx + gy * 7 * sc, cyy - gx * 7 * sc); ctx.stroke();
    }
    ctx.fillStyle = '#d4202a'; ctx.beginPath(); ctx.arc(p0.x + gx * (glen + 3 * sc), p0.y + gy * (glen + 3 * sc), 8 * sc, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd7b0'; ctx.globalAlpha = alpha * .8; ctx.beginPath(); ctx.arc(p0.x + gx * (glen + 1 * sc), p0.y + gy * (glen + 3 * sc) - 2 * sc, 2.6 * sc, 0, Math.PI * 2); ctx.fill();
    // popper + comet glow at the tip, hot when the lash is moving
    const tip = body[N - 1];
    const heat = Math.min(1, speed / 2200);
    const gr = (14 + 60 * heat) * sc;
    const grad = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, gr);
    grad.addColorStop(0, 'rgba(255,255,255,' + (.55 + .4 * heat) + ')');
    grad.addColorStop(.35, pal.glow + (.5 * heat + .12) + ')');
    grad.addColorStop(1, pal.glow + '0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha; ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(tip.x, tip.y, gr, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---- impact effects ---------------------------------------------------------------------
  const pointOf = holder => { const g = geom[holder]; return { x: g.tx, y: g.ty, dir: g.dir }; };
  function impactFx(ev) {
    const p = pointOf(ev.holder);
    if (!fx || !lib) return;
    if (ev.type === 'hit') {
      const ang = ev.holder === 'L' ? 0 : Math.PI;
      fx.burst(p.x, p.y, 90, { ramp: 'ember', angle: ang, spread: 1.6, speed: [200, 980], ay: 520, life: [.4, 1.15], size: [6, 17], size1: 2, drag: .75 });
      fx.burst(p.x, p.y, 16, { ramp: 'fire', angle: ang, spread: 1.9, speed: [60, 340], life: [.22, .5], size: [60, 130], size1: 14, drag: 1.5 });
      fx.burst(p.x, p.y, 14, { ramp: 'smoke', angle: ang, spread: 1.9, speed: [30, 170], ay: -30, life: [.6, 1.3], size: [50, 100], size1: 140, drag: 1.2, alpha: .65 });
      fx.burst(p.x, p.y - R * .35, 30, { ramp: 'ice', angle: ang - .5 * p.dir, spread: 1.1, speed: [160, 560], ay: 960, life: [.5, 1.05], size: [8, 17], size1: 4, drag: .5 });
      fx.ring(p.x, p.y, { radius: 400, life: .55, width: 11, color: 'rgba(255,214,120,.95)' });
      fx.ring(p.x, p.y, { radius: 250, life: .42, width: 6, color: 'rgba(235,40,45,.95)' });
    } else if (ev.type === 'catch') {
      fx.burst(p.x, p.y, 44, { ramp: 'ember', angle: ev.holder === 'L' ? 0 : Math.PI, spread: 3.14, speed: [120, 520], ay: 300, life: [.3, .8], size: [5, 12], size1: 2, drag: .9 });
      fx.ring(p.x, p.y, { radius: 220, life: .45, width: 7, color: 'rgba(255,224,130,.95)' });
    } else if (ev.type === 'yoink') {
      const x = (lx + rx) / 2, y = cy;
      fx.burst(x, y, 52, { ramp: 'acid', spread: 3.14, angle: 0, speed: [140, 640], life: [.35, .9], size: [10, 26], size1: 3, drag: 1 });
      fx.ring(x, y, { radius: 300, life: .5, width: 8, color: 'rgba(255,90,150,.95)' });
    }
  }
  const sweatState = P.sweat.map(s => ({ ...s, carry: 0 }));
  function sweat(t, dt) {
    if (!fx || !lib) return;
    for (const s of sweatState) {
      const a = realOf(P, s.from), b = realOf(P, s.to);
      if (t < a || t > b) continue;
      s.carry += 48 * dt;
      const x = (s.side === 'L' ? lx : rx), dir = s.side === 'L' ? -1 : 1;
      for (; s.carry >= 1; s.carry -= 1) {
        fx.spawn(x + lib.rand(-R * .45, R * .45), cy - R * .95 + lib.rand(-6, 6), { ramp: 'ice', vx: dir * lib.rand(20, 130), vy: lib.rand(-210, -70), ay: 820, life: [.55, 1.0], size: [11, 22], size1: 6, drag: .4, alpha: .95 });
      }
    }
  }
  function streaks(t) {
    // speed lines along the strike direction, drawn only while the lash is flying
    for (const ev of P.events) {
      if (ev.type === 'yoink') continue;
      const hr = realOf(P, ev.w);
      const f = (t - (hr - .20)) / .20;
      if (f <= 0 || f >= 1) continue;
      const g = geom[ev.holder];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const k = i / 8, yy = g.ty + (k - .5) * R * 2.2, len = (120 + 220 * ((i * 37) % 7) / 7) * sc;
        const x0 = g.hx0 + g.dir * (R * .6 + ((i * 53) % 11) * 11 * sc) + g.dir * f * g.len * .9;
        ctx.globalAlpha = (1 - Math.abs(f - .5) * 2) * .5;
        ctx.strokeStyle = i % 2 ? '#ffe0b8' : '#ffffff';
        ctx.lineWidth = (1.2 + (i % 3)) * sc;
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 - g.dir * len, yy); ctx.stroke();
      }
      ctx.restore();
    }
  }

  const fired = new Set();
  let start = null, lastT = 0;
  function frame(ts) {
    rafId = 0;
    if (!document.body.contains(layer)) return;
    if (start === null) start = ts;
    const t = Math.max(0, (ts - start) / 1000);
    const dt = Math.min(.05, t - lastT); lastT = t;
    ctx.clearRect(0, 0, vw, vh);
    const wt = warpOf(P, t);
    curT = t;
    // events (real-time)
    for (const ev of P.events) {
      const r = realOf(P, ev.w);
      if (t >= r && !fired.has(ev)) { fired.add(ev); impactFx(ev); if (ev.type !== 'yoink') crack(); }
    }
    sweat(t, dt);
    streaks(t);
    for (const seg of P.segs) {
      if (wt < seg.from || wt > seg.to + (seg.fadeEnd ? 0 : 0)) continue;
      let alpha = Math.min(1, (wt - seg.from) / .12 + (seg.from === 0 ? 1 : 0));
      if (seg.fadeEnd) {
        const [f0, f1] = seg.fadeEnd;
        if (wt > f0) alpha *= Math.max(0, 1 - (wt - f0) / (f1 - f0));
      }
      if (alpha > .01) drawWhip(seg, wt, alpha);
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}
// Audio begins only after a user gesture, respecting browser autoplay restrictions.
document.addEventListener('pointerdown', () => {
  try { const C = window.AudioContext || window.webkitAudioContext; if (C) { audioContext ||= new C(); if (audioContext.state === 'suspended') audioContext.resume().catch(() => {}); } } catch {}
}, { passive: true });
window.AsocWhip = { onMessage };
})();
