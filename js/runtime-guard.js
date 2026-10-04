// ASOC runtime reinforcement: stale-state rejection, effect serialization,
// safe mode, and a compact diagnostics buffer shared by GM and player pages.
(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.AsocRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const SAFE_MODE_KEY = 'asoc_safe_mode';
  const MAX_EVENTS = 60;
  const events = [];
  const revisions = new Map();
  let activeEffect = null;
  const effectQueue = [];

  function safeMode() {
    try { return root.localStorage?.getItem(SAFE_MODE_KEY) === '1'; }
    catch (_) { return false; }
  }

  function setSafeMode(enabled) {
    try { root.localStorage?.setItem(SAFE_MODE_KEY, enabled ? '1' : '0'); } catch (_) {}
    root.document?.documentElement?.classList.toggle('asoc-safe-mode', !!enabled);
    record('safe-mode', enabled ? 'ENABLED' : 'DISABLED');
    return !!enabled;
  }

  function record(kind, message, detail) {
    const entry = {
      at: Date.now(),
      kind: String(kind || 'runtime').slice(0, 40),
      message: String(message || '').slice(0, 240),
      detail: detail == null ? '' : String(detail).slice(0, 500)
    };
    events.unshift(entry);
    events.length = Math.min(events.length, MAX_EVENTS);
    try { root.dispatchEvent?.(new root.CustomEvent('asoc:diagnostic', { detail: entry })); } catch (_) {}
    return entry;
  }

  function acceptRevision(channel, revision) {
    const next = Number(revision);
    if (!Number.isFinite(next)) return true;
    const key = String(channel || 'public');
    const prior = revisions.get(key);
    if (Number.isFinite(prior) && next < prior) {
      record('stale-state', `${key} revision ${next} ignored`, `current=${prior}`);
      return false;
    }
    revisions.set(key, next);
    return true;
  }

  function finishEffect(token) {
    if (activeEffect?.token !== token) return;
    activeEffect = null;
    runNextEffect();
  }

  function runNextEffect() {
    if (activeEffect || !effectQueue.length) return;
    const job = effectQueue.shift();
    if (safeMode()) {
      record('effect-skipped', job.name, 'safe mode');
      job.resolve(false);
      return runNextEffect();
    }
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    activeEffect = { token, name: job.name, startedAt: Date.now(), resolve: job.resolve };
    record('effect-start', job.name);
    try { job.play(); }
    catch (error) { record('effect-error', job.name, error?.message || error); }
    root.setTimeout?.(() => {
      record('effect-end', job.name);
      job.resolve(true);
      finishEffect(token);
    }, Math.max(100, Number(job.durationMs) || 1000));
  }

  function enqueueEffect(name, durationMs, play) {
    return new Promise(resolve => {
      // Repeated network delivery of the same named effect should replace a
      // queued duplicate instead of producing a long visual backlog.
      const duplicate = effectQueue.find(job => job.name === String(name));
      if (duplicate) { duplicate.resolve(false); effectQueue.splice(effectQueue.indexOf(duplicate), 1); }
      effectQueue.push({ name: String(name || 'effect'), durationMs, play: typeof play === 'function' ? play : () => {}, resolve });
      runNextEffect();
    });
  }

  function clearEffects() {
    effectQueue.splice(0).forEach(job => job.resolve(false));
    activeEffect?.resolve?.(false);
    activeEffect = null;
    root.document?.querySelectorAll?.('[data-asoc-effect-layer], #warsong-alert-layer, #c4-alert-layer, #b3-alert-layer, .avada-cast, .shadow-fx-layer')
      .forEach(node => node.remove());
    root.document?.documentElement?.classList.remove('warsong-alert-active', 'c4-alert-active', 'b3-alert-active', 'avada-shake');
    record('effects', 'QUEUE CLEARED');
  }

  function socket(state, detail) { record('socket', state, detail); }
  function snapshot() {
    return {
      safeMode: safeMode(),
      online: root.navigator?.onLine !== false,
      activeEffect: activeEffect ? { name: activeEffect.name, startedAt: activeEffect.startedAt } : null,
      queuedEffects: effectQueue.map(job => job.name),
      revisions: Object.fromEntries(revisions),
      events: events.slice()
    };
  }

  if (root.document) {
    root.document.documentElement.classList.toggle('asoc-safe-mode', safeMode());
    root.addEventListener?.('error', event => record('client-error', event.message || 'Script error', `${event.filename || ''}:${event.lineno || 0}`));
    root.addEventListener?.('unhandledrejection', event => record('promise-error', event.reason?.message || event.reason || 'Unhandled rejection'));
    root.addEventListener?.('online', () => record('network', 'ONLINE'));
    root.addEventListener?.('offline', () => record('network', 'OFFLINE'));
  }

  return {
    SAFE_MODE_KEY,
    record,
    socket,
    snapshot,
    safeMode,
    setSafeMode,
    acceptRevision,
    effects: { enqueue: enqueueEffect, clear: clearEffects, snapshot }
  };
});
