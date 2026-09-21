// ASOC AUDIO ENGINE
// Procedural Web Audio cues for the ten critical game-state events.
// No external audio assets: every cue is synthesized client-side so GM and
// player surfaces stay in sync without adding network-loaded media files.
const AsocAudio = (() => {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = true;
  let unlocked = false;
  const boardSnapshots = new Map();
  let lastWomfCharge;
  let lastTimerPhase;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  function ensureContext() {
    if (!AudioCtx || !enabled) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.34;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function unlock() {
    const c = ensureContext();
    if (!c) return;
    unlocked = true;
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.value = 0.00001;
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(c.currentTime + 0.01);
  }

  ['pointerdown', 'touchstart', 'keydown'].forEach(type => {
    window.addEventListener(type, unlock, { once: true, passive: true });
  });

  function makeNoiseBuffer() {
    const c = ensureContext();
    if (!c) return null;
    if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function envelope(gain, start, attack, peak, end) {
    gain.gain.cancelScheduledValues(start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.max(0.005, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  function tone({ frequency = 440, endFrequency = null, start = 0, duration = 0.2, gain = 0.12, type = 'sine', detune = 0, filter = null }) {
    const c = ensureContext();
    if (!c || !unlocked) return;
    const t = c.currentTime + start;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), t);
    osc.detune.value = detune;
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), t + duration);
    if (filter) {
      const biquad = c.createBiquadFilter();
      biquad.type = filter.type || 'lowpass';
      biquad.frequency.value = filter.frequency || 1200;
      biquad.Q.value = filter.q || 0.7;
      osc.connect(biquad);
      biquad.connect(amp);
    } else {
      osc.connect(amp);
    }
    amp.connect(master);
    envelope(amp, t, Math.min(0.018, duration * 0.18), gain, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  function noise({ start = 0, duration = 0.16, gain = 0.07, type = 'bandpass', frequency = 1800, q = 0.8 }) {
    const c = ensureContext();
    const buffer = makeNoiseBuffer();
    if (!c || !buffer || !unlocked) return;
    const t = c.currentTime + start;
    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const amp = c.createGain();
    src.buffer = buffer;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    envelope(amp, t, 0.005, gain, t + duration);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  function metallicClick(start = 0, gain = 0.08) {
    noise({ start, duration: 0.045, gain, type: 'highpass', frequency: 2600, q: 0.5 });
    tone({ frequency: 145, endFrequency: 110, start, duration: 0.075, gain: gain * 0.8, type: 'square' });
  }

  function gameStart() {
    metallicClick(0, 0.11);
    tone({ frequency: 62, endFrequency: 43, start: 0.02, duration: 0.72, gain: 0.23, type: 'sine' });
    tone({ frequency: 310, endFrequency: 980, start: 0.08, duration: 0.62, gain: 0.065, type: 'sawtooth', filter: { type: 'bandpass', frequency: 1100, q: 1.1 } });
    metallicClick(0.74, 0.13);
    tone({ frequency: 92, start: 0.76, duration: 0.42, gain: 0.15, type: 'triangle' });
  }

  function countdown(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n > 5 || n < 1) return;
    const step = 5 - n;
    const base = 220 - step * 24;
    metallicClick(0, 0.045 + step * 0.008);
    tone({ frequency: base, endFrequency: base * 0.83, duration: 0.14 + step * 0.018, gain: 0.075 + step * 0.012, type: 'triangle' });
    if (n === 1) {
      tone({ frequency: 58, endFrequency: 42, start: 0.025, duration: 0.28, gain: 0.18, type: 'sine' });
      metallicClick(0.17, 0.11);
    }
  }

  function clueReveal() {
    noise({ duration: 0.12, gain: 0.045, type: 'bandpass', frequency: 3300, q: 1.6 });
    tone({ frequency: 720, endFrequency: 1180, start: 0.015, duration: 0.2, gain: 0.055, type: 'triangle' });
    metallicClick(0.17, 0.045);
  }

  function correct() {
    tone({ frequency: 610, endFrequency: 850, duration: 0.18, gain: 0.07, type: 'triangle' });
    tone({ frequency: 1220, start: 0.07, duration: 0.16, gain: 0.045, type: 'sine' });
  }

  function columnSolved() {
    correct();
    [330, 495, 660].forEach((f, i) => tone({ frequency: f, endFrequency: f * 1.08, start: 0.12 + i * 0.085, duration: 0.23, gain: 0.055, type: 'triangle' }));
    tone({ frequency: 880, start: 0.36, duration: 0.48, gain: 0.075, type: 'sine' });
    noise({ start: 0.1, duration: 0.22, gain: 0.025, type: 'highpass', frequency: 2400 });
  }

  function finalSolved() {
    [220, 330, 440, 660].forEach((f, i) => tone({ frequency: f, endFrequency: f * 1.1, start: i * 0.075, duration: 0.34, gain: 0.06, type: i < 2 ? 'triangle' : 'sine' }));
    tone({ frequency: 55, endFrequency: 42, start: 0.18, duration: 0.9, gain: 0.22, type: 'sine' });
    tone({ frequency: 520, endFrequency: 1480, start: 0.28, duration: 0.72, gain: 0.07, type: 'sawtooth', filter: { type: 'bandpass', frequency: 1400, q: 1.2 } });
    noise({ start: 0.32, duration: 0.45, gain: 0.055, type: 'highpass', frequency: 1700, q: 0.8 });
    metallicClick(0.95, 0.12);
  }

  function womfIncrease(charge = 1) {
    const c = Math.max(1, Math.min(9, Number(charge) || 1));
    const severity = c / 10;
    noise({ duration: 0.11 + severity * 0.08, gain: 0.03 + severity * 0.045, type: 'bandpass', frequency: 1450 - severity * 700, q: 1.5 });
    tone({ frequency: 112 - severity * 34, endFrequency: 72 - severity * 18, duration: 0.28 + severity * 0.16, gain: 0.08 + severity * 0.075, type: 'sawtooth', filter: { type: 'lowpass', frequency: 520, q: 0.8 } });
    if (c >= 8) {
      tone({ frequency: 177, start: 0.04, duration: 0.24, gain: 0.045 + severity * 0.02, type: 'square', detune: c === 9 ? -19 : 13 });
      noise({ start: 0.18, duration: 0.09, gain: 0.05, type: 'highpass', frequency: 3000 });
    }
  }

  function womfCritical() {
    tone({ frequency: 49, endFrequency: 33, duration: 1.65, gain: 0.24, type: 'sine' });
    tone({ frequency: 73, endFrequency: 54, start: 0.04, duration: 1.25, gain: 0.09, type: 'sawtooth', filter: { type: 'lowpass', frequency: 420, q: 1 } });
    tone({ frequency: 91, endFrequency: 66, start: 0.08, duration: 1.15, gain: 0.07, type: 'square', detune: 17, filter: { type: 'lowpass', frequency: 360, q: 0.8 } });
    noise({ start: 0.12, duration: 0.85, gain: 0.075, type: 'bandpass', frequency: 760, q: 1.7 });
    [0.22, 0.46, 0.7].forEach((s, i) => metallicClick(s, 0.075 + i * 0.016));
    tone({ frequency: 182, endFrequency: 121, start: 0.95, duration: 0.72, gain: 0.08, type: 'triangle' });
  }

  function borrowedTime() {
    [0, 0.09, 0.18, 0.27].forEach((s, i) => metallicClick(s, 0.035 + i * 0.012));
    tone({ frequency: 130, endFrequency: 620, start: 0.03, duration: 0.62, gain: 0.075, type: 'sawtooth', filter: { type: 'bandpass', frequency: 920, q: 1.2 } });
    tone({ frequency: 74, endFrequency: 98, start: 0.18, duration: 0.56, gain: 0.15, type: 'sine' });
    metallicClick(0.72, 0.12);
    tone({ frequency: 196, start: 0.74, duration: 0.36, gain: 0.075, type: 'triangle' });
  }

  function gameWon() {
    tone({ frequency: 55, endFrequency: 73, duration: 1.35, gain: 0.17, type: 'sine' });
    [220, 330, 440].forEach((f, i) => tone({ frequency: f, endFrequency: f * 1.24, start: 0.12 + i * 0.16, duration: 0.86, gain: 0.055, type: 'triangle' }));
    noise({ start: 0.08, duration: 0.34, gain: 0.03, type: 'highpass', frequency: 2200 });
    metallicClick(1.02, 0.08);
    tone({ frequency: 660, start: 0.94, duration: 0.7, gain: 0.07, type: 'sine' });
  }

  function gameLost() {
    tone({ frequency: 92, endFrequency: 37, duration: 1.75, gain: 0.2, type: 'sawtooth', filter: { type: 'lowpass', frequency: 540, q: 0.9 } });
    tone({ frequency: 86, endFrequency: 34, start: 0.03, duration: 1.55, gain: 0.1, type: 'square', detune: -31, filter: { type: 'lowpass', frequency: 420, q: 0.7 } });
    noise({ start: 0.12, duration: 1.15, gain: 0.065, type: 'bandpass', frequency: 880, q: 0.9 });
    [0.3, 0.58, 0.92].forEach((s, i) => noise({ start: s, duration: 0.08 + i * 0.025, gain: 0.05, type: 'highpass', frequency: 2500 + i * 450 }));
    metallicClick(1.38, 0.11);
  }

  function syncBoard(scope, state) {
    if (!state || !state.cells) return;
    const current = new Set();
    Object.entries(state.cells).forEach(([key, cell]) => {
      if (/^[A-D][1-4]$/.test(key) && cell?.revealed === true) current.add(key);
    });
    const previous = boardSnapshots.get(scope);
    boardSnapshots.set(scope, current);
    if (!previous) return;
    for (const key of current) {
      if (!previous.has(key)) {
        clueReveal();
        break;
      }
    }
  }

  function syncWomf(charge) {
    const next = Math.max(0, Math.min(10, Number(charge) || 0));
    if (lastWomfCharge === undefined) {
      lastWomfCharge = next;
      return;
    }
    const previous = lastWomfCharge;
    lastWomfCharge = next;
    if (next <= previous) return;
    if (next >= 10) womfCritical();
    else womfIncrease(next);
  }

  function syncTimerPhase(phase) {
    const next = phase || 'ready';
    if (lastTimerPhase === undefined) {
      lastTimerPhase = next;
      return;
    }
    const previous = lastTimerPhase;
    lastTimerPhase = next;
    if (next === 'borrowed' && previous !== 'borrowed' && previous !== 'borrowed_paused') borrowedTime();
  }

  function resetObservers() {
    boardSnapshots.clear();
    lastWomfCharge = undefined;
    lastTimerPhase = undefined;
  }

  function setEnabled(value) {
    enabled = value !== false;
    try { localStorage.setItem('asoc_audio_enabled', enabled ? '1' : '0'); } catch (_) {}
    if (enabled) unlock();
  }

  try {
    if (localStorage.getItem('asoc_audio_enabled') === '0') enabled = false;
  } catch (_) {}

  return {
    gameStart,
    countdown,
    clueReveal,
    correct,
    columnSolved,
    finalSolved,
    womfIncrease,
    womfCritical,
    borrowedTime,
    gameWon,
    gameLost,
    syncBoard,
    syncWomf,
    syncTimerPhase,
    resetObservers,
    setEnabled,
    isEnabled: () => enabled,
    unlock
  };
})();

window.AsocAudio = AsocAudio;
