// VOICE MESSAGES -- record up to 60 s from the chat "+" menu, upload it as a
// chat attachment (/api/chat/voice), and play it back inline.
//
// Recording: AsocVoice.record({ anchor, headers }) shows a small recorder bar
// above `anchor` (the chat form). It stops by itself at 60 s; SEND uploads,
// CANCEL discards. Nothing leaves the device until SEND.
//
// Playback: messageHTML(msg) renders a lightweight player. One shared <audio>
// element plays everything, and the UI is re-synced by src on every tick, so
// the chat re-rendering a message never interrupts what is playing.
(function (root) {
  const MAX_SECONDS = 60;
  const VOICE_URL = /^\/uploads\/chat\/[a-f0-9]{32}\.(?:webm|ogg|m4a)$/;
  const CANDIDATE_TYPES = [
    ['audio/webm;codecs=opus', 'audio/webm'],
    ['audio/webm', 'audio/webm'],
    ['audio/ogg;codecs=opus', 'audio/ogg'],
    ['audio/mp4', 'audio/mp4']
  ];

  const fmt = seconds => {
    const s = Math.max(0, Math.round(seconds || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function pickType() {
    const MR = root.MediaRecorder;
    if (!MR) return null;
    for (const [mime, base] of CANDIDATE_TYPES) {
      try { if (MR.isTypeSupported(mime)) return { mime, base }; } catch {}
    }
    return null;
  }

  function supported() {
    return !!(root.navigator?.mediaDevices?.getUserMedia && pickType());
  }

  // ---------------------------------------------------------------- record
  let session = null;

  function record({ anchor, headers = {}, onError } = {}) {
    const fail = message => { if (typeof onError === 'function') onError(message); else root.alert?.(message); };
    if (session) return;
    if (!supported()) return fail('Voice messages are not supported in this browser.');
    const type = pickType();
    const bar = document.createElement('div');
    bar.className = 'voice-recorder';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Voice message recorder');
    bar.innerHTML = '<button type="button" class="voice-recorder-cancel" aria-label="Delete recording" title="Delete">'
      + '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg></button>'
      + '<span class="voice-recorder-dot" aria-hidden="true"></span>'
      + `<span class="voice-recorder-time">0:00</span>`
      + '<span class="voice-recorder-label">RECORDING · MAX 1:00</span>'
      + '<button type="button" class="voice-recorder-send" aria-label="Send voice message" title="Send">'
      + '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg></button>';
    document.body.appendChild(bar);
    // Like WhatsApp: the recorder takes over the composer row itself.
    const place = () => {
      const rect = anchor?.getBoundingClientRect?.();
      if (!rect || !rect.width) { bar.style.left = '50%'; bar.style.bottom = '16px'; bar.style.transform = 'translateX(-50%)'; return; }
      bar.style.left = rect.left + 'px';
      bar.style.top = rect.top + 'px';
      bar.style.width = rect.width + 'px';
      bar.style.height = Math.max(44, rect.height) + 'px';
    };
    place();

    const s = session = { bar, chunks: [], startedAt: 0, stoppedAt: 0, recorder: null, stream: null, cancelled: false, timer: null };
    const timeEl = bar.querySelector('.voice-recorder-time');
    const sendBtn = bar.querySelector('.voice-recorder-send');
    const elapsed = () => ((s.stoppedAt || Date.now()) - s.startedAt) / 1000;
    const cleanup = () => {
      clearInterval(s.timer);
      s.stream?.getTracks().forEach(track => track.stop());
      root.removeEventListener('resize', place);
      bar.remove();
      if (session === s) session = null;
    };
    const stop = () => {
      if (s.recorder && s.recorder.state !== 'inactive') {
        s.stoppedAt = Date.now();
        s.recorder.stop();
      }
    };
    root.addEventListener('resize', place);

    bar.querySelector('.voice-recorder-cancel').addEventListener('click', () => { s.cancelled = true; stop(); cleanup(); });
    sendBtn.addEventListener('click', () => {
      sendBtn.disabled = true;
      s.sendRequested = true;
      if (s.recorder?.state === 'inactive') upload(); else stop();
    });

    const upload = async () => {
      if (s.cancelled || s.uploading) return;
      s.uploading = true;
      const seconds = Math.min(MAX_SECONDS, Math.round(elapsed()));
      if (seconds < 1) { cleanup(); return fail('Voice message is too short.'); }
      const blob = new Blob(s.chunks, { type: type.base });
      bar.classList.add('is-sending');
      bar.querySelector('.voice-recorder-label').textContent = 'SENDING';
      try {
        const res = await fetch('/api/chat/voice?seconds=' + seconds, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': type.base },
          body: blob
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'Voice message upload failed');
        cleanup();
      } catch (error) {
        cleanup();
        fail(error.message || 'Voice message upload failed');
      }
    };

    root.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(stream => {
      if (s.cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
      s.stream = stream;
      const recorder = s.recorder = new MediaRecorder(stream, { mimeType: type.mime, audioBitsPerSecond: 48000 });
      recorder.addEventListener('dataavailable', event => { if (event.data?.size) s.chunks.push(event.data); });
      recorder.addEventListener('stop', () => {
        s.stream?.getTracks().forEach(track => track.stop());
        if (s.cancelled) return;
        bar.classList.add('is-stopped');
        bar.querySelector('.voice-recorder-label').textContent = 'READY';
        if (s.sendRequested) upload();
      });
      s.startedAt = Date.now();
      recorder.start(1000);
      s.timer = setInterval(() => {
        const secs = elapsed();
        timeEl.textContent = fmt(Math.min(secs, MAX_SECONDS));
        if (secs >= MAX_SECONDS) { clearInterval(s.timer); stop(); }
      }, 200);
    }).catch(error => {
      cleanup();
      fail(error?.name === 'NotAllowedError' ? 'Microphone access was denied.' : 'Microphone is not available.');
    });
  }

  // ---------------------------------------------------------------- playback
  let audio = null;
  let raf = 0;

  function sync() {
    raf = 0;
    const src = audio?.dataset.src || '';
    document.querySelectorAll('.chat-voice').forEach(el => {
      const active = el.dataset.voiceSrc === src;
      const playing = active && audio && !audio.paused;
      el.classList.toggle('is-playing', playing);
      const total = Number(el.dataset.voiceSeconds) || 0;
      const current = active && audio ? audio.currentTime : 0;
      const bar = el.querySelector('.chat-voice-progress');
      if (bar) bar.style.width = (active && total ? Math.min(100, (current / total) * 100) : 0) + '%';
      const time = el.querySelector('.chat-voice-time');
      const text = active && current > 0 ? fmt(current) : fmt(total);
      if (time && time.textContent !== text) time.textContent = text;
      const btn = el.querySelector('.chat-voice-play');
      if (btn) btn.setAttribute('aria-label', playing ? 'Pause voice message' : 'Play voice message');
    });
    if (audio && !audio.paused) raf = root.requestAnimationFrame(sync);
  }

  function toggle(src) {
    if (!VOICE_URL.test(src)) return;
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      ['play', 'pause', 'ended', 'timeupdate'].forEach(evt => audio.addEventListener(evt, () => { if (!raf) raf = root.requestAnimationFrame(sync); }));
      audio.addEventListener('ended', () => { audio.currentTime = 0; });
    }
    if (audio.dataset.src === src) {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      return;
    }
    audio.pause();
    audio.dataset.src = src;
    audio.src = src;
    audio.play().catch(() => {});
  }

  function messageHTML(msg) {
    if (!msg || msg.messageType !== 'voice' || !VOICE_URL.test(String(msg.audioUrl || ''))) return '';
    const seconds = Math.min(MAX_SECONDS, Math.max(1, Number(msg.voiceSeconds) || 1));
    return `<div class="chat-voice" data-voice-src="${esc(msg.audioUrl)}" data-voice-seconds="${seconds}">`
      + '<button type="button" class="chat-voice-play" aria-label="Play voice message"><span class="chat-voice-icon" aria-hidden="true"></span></button>'
      + '<span class="chat-voice-track"><span class="chat-voice-progress"></span></span>'
      + `<span class="chat-voice-time">${fmt(seconds)}</span></div>`;
  }

  if (root.document) {
    root.document.addEventListener('click', event => {
      const btn = event.target.closest?.('.chat-voice-play');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      toggle(btn.closest('.chat-voice')?.dataset.voiceSrc || '');
    }, true);
  }

  root.AsocVoice = { MAX_SECONDS, supported, record, messageHTML, sync };
})(typeof window !== 'undefined' ? window : globalThis);
