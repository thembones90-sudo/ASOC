(() => {
  'use strict';

  // ASOC FX // tiny canvas particle layer for skills and spells. No dependencies.
  // One instance owns one full-viewport canvas inside a parent element. Everything is
  // driven by a single requestAnimationFrame loop that stops when nothing is alive.
  //
  //   const fx = AsocFx.create(parentElement, { speed: 1 });
  //   fx.burst(x, y, 120, { ramp: 'fire', speed: [150, 700], life: [0.5, 1.1], size: [18, 46] });
  //   fx.emitter(0.65, (p, dt, t) => { ... fx.spawn(...) });   // p = 0..1 progress, t = seconds
  //   fx.ring(x, y, { radius: 420, life: 0.6, color: 'rgba(255,170,60,.9)' });
  //   fx.destroy();
  //
  // Coordinates are CSS pixels relative to the viewport. `speed` scales simulation time so a
  // faster cut of an animation can run the particles at the same pace.

  const RAMPS = {
    // Hot core to dying ember. Drawn additively so overlapping flames bloom white.
    fire: { blend: 'lighter', colors: ['255,250,215', '255,214,96', '255,150,44', '255,92,22', '206,42,12', '110,22,8'] },
    ember: { blend: 'lighter', colors: ['255,236,160', '255,176,58', '255,110,30', '210,60,16', '120,28,10'] },
    smoke: { blend: 'source-over', colors: ['70,60,58', '58,50,50', '46,40,42', '36,32,34', '28,26,28'] },
    ice: { blend: 'lighter', colors: ['255,255,255', '214,248,255', '132,222,255', '70,170,255', '40,110,230'] },
    acid: { blend: 'lighter', colors: ['240,255,176', '168,255,76', '110,232,44', '60,170,28', '30,110,16'] }
  };

  const STEPS = 12;
  const spriteCache = {};

  function makeSprite(rgb, softness) {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(softness, `rgba(${rgb},.55)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  // Interpolate the ramp colours into STEPS pre-rendered sprites, hot to cold.
  function rampSprites(name) {
    if (spriteCache[name]) return spriteCache[name];
    const def = RAMPS[name] || RAMPS.fire;
    const stops = def.colors.map(s => s.split(',').map(Number));
    const out = [];
    for (let i = 0; i < STEPS; i += 1) {
      const f = (i / (STEPS - 1)) * (stops.length - 1);
      const a = Math.floor(f);
      const b = Math.min(stops.length - 1, a + 1);
      const m = f - a;
      const rgb = stops[a].map((v, k) => Math.round(v + (stops[b][k] - v) * m)).join(',');
      out.push(makeSprite(rgb, name === 'smoke' ? 0.45 : 0.3));
    }
    spriteCache[name] = out;
    return out;
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = v => (Array.isArray(v) ? rand(v[0], v[1]) : v);
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function budget() {
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const cores = Number(navigator.hardwareConcurrency) || 4;
    if (small || cores <= 4) return 420;
    return 1100;
  }

  function create(parent, options = {}) {
    if (reduced() || !parent) return null;
    const canvas = document.createElement('canvas');
    canvas.className = 'asoc-fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:' + (options.zIndex || 6);
    parent.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return null; }

    const inst = { speed: Number(options.speed) || 1, canvas };
    const max = options.max || budget();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let parts = [];
    let rings = [];
    let emitters = [];
    let raf = 0;
    let last = 0;
    let dead = false;
    let w = 0;
    let h = 0;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    inst.spawn = (x, y, o = {}) => {
      // Detonation bursts (o.force) may run over budget so the big moment is never the thing that gets dropped.
      if (dead || parts.length >= (o.force ? max * 1.6 : max)) return;
      const ramp = o.ramp || 'fire';
      parts.push({
        x, y,
        vx: pick(o.vx ?? 0), vy: pick(o.vy ?? 0),
        ax: o.ax || 0, ay: o.ay || 0,
        drag: o.drag ?? 0.6,
        life: pick(o.life ?? 0.8), t: 0,
        s0: pick(o.size0 ?? o.size ?? 30), s1: o.size1 ?? null,
        grow: o.grow ?? 0.5,
        alpha: o.alpha ?? 1,
        ramp, sprites: rampSprites(ramp), blend: (RAMPS[ramp] || RAMPS.fire).blend,
        jitter: o.jitter || 0
      });
      start();
    };

    // Radial burst of `n` particles. Speed, life and size accept a number or [min, max].
    inst.burst = (x, y, n, o = {}) => {
      for (let i = 0; i < n; i += 1) {
        const ang = o.angle !== undefined ? o.angle + rand(-(o.spread ?? Math.PI), (o.spread ?? Math.PI)) : rand(0, Math.PI * 2);
        const sp = pick(o.speed ?? [120, 420]);
        inst.spawn(x + rand(-(o.radius || 0), (o.radius || 0)), y + rand(-(o.radius || 0), (o.radius || 0)), {
          force: true,
          ...o,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp
        });
      }
    };

    inst.ring = (x, y, o = {}) => {
      if (dead) return;
      rings.push({ x, y, t: 0, life: o.life ?? 0.6, r0: o.r0 ?? 10, r1: o.radius ?? 380, width: o.width ?? 6, color: o.color || 'rgba(255,170,60,.9)', blend: o.blend || 'lighter' });
    };

    // Run `fn(progress, dt, elapsed)` each frame for `duration` seconds of simulated time.
    inst.emitter = (duration, fn) => {
      if (dead) return;
      emitters.push({ duration: Math.max(0.01, duration), fn, t: 0 });
      start();
    };

    // `running` stays true for the whole life of the loop, including while a frame is being
    // processed, so spawns made from inside a frame can never queue a second parallel loop.
    let running = false;
    function start() {
      if (!running && !dead) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    }

    function frame(now) {
      raf = 0;
      if (dead) { running = false; return; }
      const realDt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const dt = realDt * inst.speed;

      for (const e of emitters) {
        e.t += dt;
        e.fn(Math.min(1, e.t / e.duration), dt, e.t);
      }
      emitters = emitters.filter(e => e.t < e.duration);

      ctx.clearRect(0, 0, w, h);
      // Smoke first so flames are drawn over it.
      for (const pass of ['source-over', 'lighter']) {
        ctx.globalCompositeOperation = pass;
        for (const p of parts) {
          if (p.blend !== pass) continue;
          const f = p.t / p.life;
          if (f >= 1) continue;
          const fade = Math.min(1, f * 8) * Math.pow(1 - f, p.ramp === 'smoke' ? 1.2 : 0.8);
          const idx = Math.min(STEPS - 1, Math.floor(f * STEPS));
          const size = p.s0 + ((p.s1 ?? p.s0 * (1 + p.grow)) - p.s0) * f;
          ctx.globalAlpha = Math.max(0, Math.min(1, fade * p.alpha));
          ctx.drawImage(p.sprites[idx], p.x - size / 2, p.y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;

      for (const r of rings) {
        const f = r.t / r.life;
        if (f >= 1) continue;
        ctx.globalCompositeOperation = r.blend;
        ctx.globalAlpha = (1 - f) * (1 - f);
        ctx.lineWidth = r.width * (1 - f * 0.7);
        ctx.strokeStyle = r.color;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - f, 3)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      for (const p of parts) {
        p.t += dt;
        const damp = Math.max(0, 1 - p.drag * dt);
        p.vx = (p.vx + p.ax * dt) * damp;
        p.vy = (p.vy + p.ay * dt) * damp;
        p.x += p.vx * dt + (p.jitter ? rand(-p.jitter, p.jitter) : 0);
        p.y += p.vy * dt;
      }
      for (const r of rings) r.t += dt;
      parts = parts.filter(p => p.t < p.life);
      rings = rings.filter(r => r.t < r.life);

      if (parts.length || rings.length || emitters.length) raf = requestAnimationFrame(frame);
      else running = false;
    }

    inst.destroy = () => {
      dead = true;
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      parts = [];
      rings = [];
      emitters = [];
      window.removeEventListener('resize', onResize);
      canvas.remove();
    };
    inst.count = () => parts.length;
    return inst;
  }

  window.AsocFx = Object.freeze({ create, rand, reduced });
})();
