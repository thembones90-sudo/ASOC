'use strict';

// Little Hero authentication throttling (Shadow Broker auth is separate and
// keeps its own lockout in server.js). In-memory by design: a restart clears
// counters, which is acceptable for rate limiting and avoids a disk write per
// attempt.

// Sliding-window counter: at most `limit` hits per `windowMs` per key.
function createWindowLimiter({ limit, windowMs, maxKeys = 50000 }) {
  const hits = new Map(); // key -> timestamps (ascending)
  function fresh(key, now) {
    const list = (hits.get(key) || []).filter(at => now - at < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  }
  return {
    limit,
    windowMs,
    // Remaining wait in ms if the key is at its limit, else 0.
    blockedFor(key, now = Date.now()) {
      const list = fresh(key, now);
      return list.length >= limit ? Math.max(1, windowMs - (now - list[0])) : 0;
    },
    hit(key, now = Date.now()) {
      const list = fresh(key, now);
      list.push(now);
      hits.set(key, list);
      if (hits.size > maxKeys) {
        // Bounded memory under a spray of distinct keys: drop the oldest.
        const oldest = hits.keys().next().value;
        hits.delete(oldest);
      }
      return list.length;
    },
    reset(key) { hits.delete(key); },
    size() { return hits.size; }
  };
}

// Caps concurrent password hashes so a login flood cannot monopolise libuv's
// small thread pool (shared with fs reads and DNS). Excess waits in a bounded
// queue; beyond that the caller is told to retry.
function createConcurrencyGate({ concurrency = 2, maxQueue = 32 } = {}) {
  let active = 0;
  const queue = [];
  function next() {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; next(); });
  }
  return {
    run(task) {
      if (queue.length >= maxQueue) {
        return Promise.reject(Object.assign(new Error('Authentication is busy. Try again shortly.'), { code: 'AUTH_BUSY' }));
      }
      return new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
    },
    stats() { return { active, queued: queue.length }; }
  };
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createPlayerAuthThrottle() {
  const MIN = 60 * 1000;
  return {
    // Failed logins against one account (keyed by normalized identity).
    accountFailures: createWindowLimiter({ limit: envNumber('ASOC_AUTH_ACCOUNT_FAILURES', 5), windowMs: envNumber('ASOC_AUTH_ACCOUNT_WINDOW_MS', 15 * MIN) }),
    // Failed logins from one client address, across all accounts.
    ipFailures: createWindowLimiter({ limit: envNumber('ASOC_AUTH_IP_FAILURES', 30), windowMs: envNumber('ASOC_AUTH_IP_WINDOW_MS', 15 * MIN) }),
    // Account creation per client address.
    ipRegistrations: createWindowLimiter({ limit: envNumber('ASOC_AUTH_IP_REGISTRATIONS', 40), windowMs: envNumber('ASOC_AUTH_REGISTER_WINDOW_MS', 60 * MIN) }),
    gate: createConcurrencyGate({ concurrency: envNumber('ASOC_AUTH_HASH_CONCURRENCY', 2), maxQueue: envNumber('ASOC_AUTH_HASH_QUEUE', 32) })
  };
}

module.exports = { createWindowLimiter, createConcurrencyGate, createPlayerAuthThrottle };
