// /fireworks -- a room-wide fireworks show, launched from chat by any Little
// Hero or the Shadow Broker. The server only broadcasts fireworks:launch
// { byName, text, seed }; every screen plays the same show from the seed.
// Pure presentation: a full-screen canvas that ignores the pointer, removed
// when the last spark dies. Honours MUTE SOUNDS and reduced motion.
(() => {
  'use strict';
  const DURATION_MS = 7000;
  const PALETTES = [
    ['#ff3b5c', '#ff9a3c', '#ffe066'],
    ['#7cf9ff', '#3b8bff', '#ffffff'],
    ['#b46bff', '#ff5ce1', '#ffd1fb'],
    ['#46ff8e', '#d6ff5c', '#ffffff'],
    ['#ffd36a', '#fff3c4', '#ff9a3c'],
    ['#ff2e43', '#ffffff', '#3b8bff']
  ];
  const SHAPES = ['peony', 'peony', 'ring', 'willow', 'crackle', 'double', 'heart', 'palm'];

  function rng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const muted = () => { try { return localStorage.getItem('asoc_audio_enabled') === '0'; } catch { return false; } };
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- sound --
  let audio = null;
  function boom(big, delay = 0) {
    if (muted()) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime + delay;
      const len = big ? 1.4 : 0.8;
      const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * len), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, big ? 2.2 : 3.2);
      const src = audio.createBufferSource();
      src.buffer = buffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(big ? 1400 : 2600, t);
      filter.frequency.exponentialRampToValueAtTime(140, t + len);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(big ? 0.55 : 0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + len);
      src.connect(filter).connect(gain).connect(audio.destination);
      src.start(t);
    } catch {}
  }
  function whistle(delay = 0) {
    if (muted()) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(900, t);
      osc.frequency.exponentialRampToValueAtTime(2200, t + 0.7);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.035, t + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.8);
    } catch {}
  }

  // ----------------------------------------------------------------- show --
  const Fireworks = {
    active: null,

    launch(message) {
      if (!document.body) return;
      this.stop();
      const rand = rng(message?.seed || Date.now());
      const calm = reduced();
      const canvas = document.createElement('canvas');
      canvas.className = 'asoc-fireworks';
      canvas.setAttribute('aria-hidden', 'true');
      const banner = document.createElement('div');
      banner.className = 'asoc-fireworks-banner';
      banner.setAttribute('role', 'status');
      const who = String(message?.byName || 'SOMEONE').slice(0, 40);
      const line = String(message?.text || '').trim().slice(0, 80);
      banner.innerHTML = `<small>🎆 ${esc(who)} LIGHTS UP THE SKY</small>${line ? `<b>${esc(line)}</b>` : ''}`;
      document.body.append(canvas, banner);

      const ctx = canvas.getContext('2d');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let W = 0, H = 0;
      const resize = () => {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      window.addEventListener('resize', resize);

      const rockets = [];
      const sparks = [];
      const start = performance.now();
      // The schedule: a steady volley, then a finale salvo.
      const plan = [];
      const volley = calm ? 6 : 16;
      for (let i = 0; i < volley; i++) plan.push({ at: 150 + i * (calm ? 750 : 300) + rand() * 220 });
      if (!calm) for (let i = 0; i < 9; i++) plan.push({ at: 5000 + i * 90 + rand() * 120, finale: true });
      plan.sort((a, b) => a.at - b.at);

      const fire = spec => {
        const x = W * (0.15 + rand() * 0.7);
        const peak = H * (0.14 + rand() * 0.3);
        const speed = Math.sqrt(2 * 0.12 * (H - peak)) * (0.98 + rand() * 0.04);
        rockets.push({
          x, y: H + 8, vx: (rand() - 0.5) * 1.6, vy: -speed,
          palette: PALETTES[Math.floor(rand() * PALETTES.length)],
          shape: spec.finale ? (rand() < 0.5 ? 'peony' : 'ring') : SHAPES[Math.floor(rand() * SHAPES.length)],
          big: spec.finale || rand() < 0.3,
          trail: []
        });
        if (rand() < 0.5) whistle();
      };

      const spark = (x, y, vx, vy, color, o = {}) => sparks.push({
        x, y, vx, vy, color,
        life: o.life ?? 70 + rand() * 40, age: 0,
        drag: o.drag ?? 0.975, grav: o.grav ?? 0.045,
        size: o.size ?? 2.2, twinkle: o.twinkle || false, crackle: o.crackle || false,
        trail: o.trail ?? 0.35, px: x, py: y
      });

      const burst = r => {
        const [c1, c2, c3] = r.palette;
        const scale = (r.big ? 1.35 : 1) * Math.min(1.2, Math.max(0.7, Math.min(W, H) / 800));
        const count = calm ? 50 : (r.big ? 150 : 100);
        const ring = (n, power, color, o) => {
          const tilt = rand() * Math.PI;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + tilt;
            spark(r.x, r.y, Math.cos(a) * power * scale, Math.sin(a) * power * scale, color, o);
          }
        };
        switch (r.shape) {
          case 'ring': ring(count * 0.7, 4.2, c1, { drag: 0.97, life: 80 }); ring(count * 0.25, 1.6, c3, { life: 50 }); break;
          case 'double': ring(count * 0.6, 4.6, c1, { drag: 0.972 }); ring(count * 0.45, 2.6, c2, { drag: 0.972 }); break;
          case 'willow':
            for (let i = 0; i < count; i++) {
              const a = rand() * Math.PI * 2, p = rand() * 3.6;
              spark(r.x, r.y, Math.cos(a) * p * scale, Math.sin(a) * p * scale, i % 3 ? '#ffd36a' : c3, { life: 150 + rand() * 60, drag: 0.985, grav: 0.03, size: 1.7, trail: 0.7 });
            }
            break;
          case 'palm':
            for (let k = 0; k < 7; k++) {
              const a = (k / 7) * Math.PI * 2 - Math.PI / 2;
              for (let i = 0; i < 14; i++) spark(r.x, r.y, Math.cos(a) * (2 + i * 0.25) * scale, Math.sin(a) * (2 + i * 0.25) * scale, i % 2 ? c1 : c2, { life: 100, drag: 0.978, size: 2.4 });
            }
            break;
          case 'heart':
            for (let i = 0; i < count; i++) {
              const t = (i / count) * Math.PI * 2;
              const hx = 16 * Math.pow(Math.sin(t), 3);
              const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
              spark(r.x, r.y, hx * 0.24 * scale, hy * 0.24 * scale, i % 4 ? '#ff5ce1' : '#ffd1fb', { drag: 0.965, grav: 0.02, life: 90 });
            }
            break;
          case 'crackle':
            for (let i = 0; i < count; i++) {
              const a = rand() * Math.PI * 2, p = 1 + rand() * 4.2;
              spark(r.x, r.y, Math.cos(a) * p * scale, Math.sin(a) * p * scale, i % 2 ? '#ffffff' : c2, { crackle: true, twinkle: true, life: 60 + rand() * 40, size: 1.8 });
            }
            break;
          default: // peony
            for (let i = 0; i < count; i++) {
              const a = rand() * Math.PI * 2, p = Math.pow(rand(), 0.45) * 5;
              spark(r.x, r.y, Math.cos(a) * p * scale, Math.sin(a) * p * scale, [c1, c2, c3][i % 3], { twinkle: rand() < 0.3 });
            }
        }
        // White flash core.
        for (let i = 0; i < 14; i++) {
          const a = rand() * Math.PI * 2;
          spark(r.x, r.y, Math.cos(a) * 1.2, Math.sin(a) * 1.2, '#ffffff', { life: 14, size: 4, grav: 0 });
        }
        boom(r.big);
        flash = Math.max(flash, r.big ? 0.22 : 0.12);
        flashColor = c1;
      };

      let flash = 0;
      let flashColor = '#ffffff';
      let last = start;
      const frame = now => {
        const dt = Math.min(2.5, (now - last) / 16.67);
        last = now;
        const t = now - start;
        while (plan.length && plan[0].at <= t) fire(plan.shift());

        // Fade the previous frame for trails, then draw additively.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';

        if (flash > 0.005) {
          const g = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, Math.max(W, H) * 0.8);
          g.addColorStop(0, flashColor);
          g.addColorStop(1, 'transparent');
          ctx.globalAlpha = flash * 0.35;
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
          flash *= Math.pow(0.86, dt);
        }

        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i];
          r.trail.push([r.x, r.y]);
          if (r.trail.length > 6) r.trail.shift();
          r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 0.12 * dt;
          ctx.strokeStyle = 'rgba(255,214,150,.45)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          r.trail.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.lineTo(r.x, r.y);
          ctx.stroke();
          ctx.fillStyle = '#fff6d8';
          ctx.beginPath(); ctx.arc(r.x, r.y, 2.4, 0, Math.PI * 2); ctx.fill();
          if (r.vy >= -0.6) { rockets.splice(i, 1); burst(r); }
        }

        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.px = s.x; s.py = s.y;
          const drag = Math.pow(s.drag, dt);
          s.vx *= drag; s.vy = s.vy * drag + s.grav * dt;
          s.x += s.vx * dt; s.y += s.vy * dt;
          s.age += dt;
          const left = 1 - s.age / s.life;
          if (left <= 0) {
            if (s.crackle && !s.cracked) {
              s.cracked = true;
              for (let k = 0; k < 3; k++) spark(s.x, s.y, (rand() - 0.5) * 1.6, (rand() - 0.5) * 1.6, '#fff3c4', { life: 10, size: 1.4, grav: 0 });
            }
            sparks.splice(i, 1);
            continue;
          }
          let alpha = Math.min(1, left * 1.6);
          if (s.twinkle && left < 0.5) alpha *= 0.4 + 0.6 * Math.abs(Math.sin(s.age * 0.9));
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.size * Math.max(0.4, left);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.px - s.vx * s.trail * 4, s.py - s.vy * s.trail * 4);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        const done = !plan.length && !rockets.length && !sparks.length;
        if (done || t > DURATION_MS + 4000) return this.stop();
        this.active.raf = requestAnimationFrame(frame);
      };

      this.active = { canvas, banner, resize, raf: requestAnimationFrame(frame) };
      requestAnimationFrame(() => banner.classList.add('is-in'));
      this.active.bannerTimer = setTimeout(() => banner.classList.remove('is-in'), DURATION_MS - 800);
    },

    stop() {
      const a = this.active;
      if (!a) return;
      this.active = null;
      cancelAnimationFrame(a.raf);
      clearTimeout(a.bannerTimer);
      window.removeEventListener('resize', a.resize);
      a.canvas.remove();
      a.banner.remove();
    }
  };

  window.AsocFireworks = Fireworks;
})();
