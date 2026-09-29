// ASOC CLASS CLOCK
// Shared local clock telemetry for Shadow Broker and Little Hero surfaces. Class warnings fire
// once, one minute before each half-hour start from 08:00 through 16:00.
(() => {
  const nodes = [...document.querySelectorAll('[data-class-clock]')];
  if (!nodes.length) return;
  const ALERT_STORAGE_KEY = 'asoc_class_clock_last_alert';
  let tickTimer = 0;
  let shakeTimer = 0;

  const pad = value => String(value).padStart(2, '0');

  function nextClassStart(now) {
    const candidates = [];
    for (let hour = 8; hour <= 15; hour += 1) {
      candidates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0));
      candidates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 30, 0, 0));
    }
    return candidates.find(candidate => candidate > now) || null;
  }

  function isWarningMinute(now) {
    const hour = now.getHours();
    const minute = now.getMinutes();
    return (minute === 59 && hour >= 7 && hour <= 14) || (minute === 29 && hour >= 8 && hour <= 15);
  }

  function warningKey(now) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function classNudge(now) {
    const key = warningKey(now);
    let previous = '';
    try { previous = localStorage.getItem(ALERT_STORAGE_KEY) || ''; } catch (_) {}
    if (previous === key) return;
    try { localStorage.setItem(ALERT_STORAGE_KEY, key); } catch (_) {}

    const upcoming = nextClassStart(now);
    const label = upcoming ? `${pad(upcoming.getHours())}:${pad(upcoming.getMinutes())}` : 'CLASS';
    nodes.forEach(node => node.classList.remove('is-warning'));
    document.documentElement.classList.remove('class-clock-nudge');
    void nodes[0].offsetWidth;
    nodes.forEach(node => node.classList.add('is-warning'));
    document.documentElement.classList.add('class-clock-nudge');
    clearTimeout(shakeTimer);
    shakeTimer = window.setTimeout(() => {
      nodes.forEach(node => node.classList.remove('is-warning'));
      document.documentElement.classList.remove('class-clock-nudge');
    }, 1250);

    window.AsocAudio?.countdown?.(1);
    window.AsocAlerts?.signal?.({
      popup: {
        title: `CLASS IN ONE MINUTE // ${label}`,
        body: document.getElementById('player-atomic-clock') ? 'Little Hero, prepare for the next lesson.' : 'Shadow Broker, prepare for the next lesson.',
        tag: `class-clock-${key}`
      }
    });
  }

  function render() {
    const now = new Date();
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    nodes.forEach(node => {
      node.querySelector('[data-clock-hours]').textContent = hours;
      node.querySelector('[data-clock-minutes]').textContent = minutes;
      node.querySelector('[data-clock-seconds]').textContent = seconds;
      node.querySelector('time').dateTime = `${hours}:${minutes}:${seconds}`;
      node.setAttribute('aria-label', `Current time ${hours}:${minutes}:${seconds}`);
    });

    if (isWarningMinute(now)) classNudge(now);
    clearTimeout(tickTimer);
    tickTimer = window.setTimeout(render, Math.max(50, 1000 - (Date.now() % 1000) + 8));
  }

  render();
  window.addEventListener('pagehide', () => {
    clearTimeout(tickTimer);
    clearTimeout(shakeTimer);
  }, { once: true });
})();
