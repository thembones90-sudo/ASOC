/* Shadow Broker command rail: guarded theatrical commands, mode switch and live raid status.
   Self-contained on purpose. It listens in the capture phase, so the original handlers in app.js
   stay untouched and only run once the Shadow Broker has confirmed. */
(() => {
  'use strict';
  if (window.__gmControlsLoaded) return;
  window.__gmControlsLoaded = true;

  const ARM_MS = 3500;
  const COOL_MS = 3000;
  const DEAD_RAID = ['FAILED', 'ABORTED', 'COMPLETE'];
  const isCasual = () => document.body.classList.contains('room-mode-casual');

  // id -> how the guard behaves. `applies` lets a button pass straight through when a click is harmless.
  const GUARDS = {
    'nema-asoc-btn': { veil: 'TAP AGAIN TO FIRE', done: 'NEMA ASOC SENT TO THE ROOM', cool: COOL_MS },
    'bice-asoc-btn': { veil: 'TAP AGAIN TO FIRE', done: 'BIĆE ASOC SENT TO THE ROOM', cool: COOL_MS },
    'room-mode-battle-btn': { veil: 'SURE?', hint: 'Click again to start the battle', applies: () => isCasual() },
    'room-mode-casual-btn': { veil: 'SURE?', hint: 'Click again to end the battle', applies: () => !isCasual() }
  };

  let armed = null; // { btn, timer, restorePosition }
  let toastTimer = null;

  function toast(text) {
    let node = document.getElementById('gm-ctl-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'gm-ctl-toast';
      node.className = 'gm-ctl-toast';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      document.body.appendChild(node);
    }
    node.textContent = text;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2200);
  }

  function disarm() {
    if (!armed) return;
    clearTimeout(armed.timer);
    armed.btn.classList.remove('gm-confirm-armed');
    armed.btn.querySelector(':scope > .gm-confirm-veil')?.remove();
    if (armed.restorePosition) armed.btn.style.position = '';
    armed = null;
  }

  function arm(btn, guard) {
    disarm();
    let restorePosition = false;
    if (getComputedStyle(btn).position === 'static') {
      btn.style.position = 'relative';
      restorePosition = true;
    }
    const veil = document.createElement('span');
    veil.className = 'gm-confirm-veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.textContent = guard.veil;
    btn.appendChild(veil);
    btn.classList.add('gm-confirm-armed');
    armed = { btn, restorePosition, timer: setTimeout(disarm, ARM_MS) };
    if (guard.hint) toast(guard.hint.toUpperCase());
  }

  function cooldown(btn, ms) {
    btn.classList.add('gm-cooling');
    btn.setAttribute('aria-disabled', 'true');
    setTimeout(() => {
      btn.classList.remove('gm-cooling');
      btn.removeAttribute('aria-disabled');
    }, ms);
  }

  document.addEventListener('click', event => {
    const btn = event.target.closest?.('button');
    if (armed && btn !== armed.btn) disarm();
    const guard = btn && GUARDS[btn.id];
    if (!guard || (guard.applies && !guard.applies())) return;
    if (btn.classList.contains('gm-cooling')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (armed && armed.btn === btn) {
      disarm();
      if (guard.cool) cooldown(btn, guard.cool);
      if (guard.done) toast(guard.done);
      return; // second click: let the original handler run
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    arm(btn, guard);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') disarm();
  });

  // RAID SETUP shows whether an encounter is running, so the Shadow Broker does not hunt for it.
  function syncRaidButton() {
    const btn = document.getElementById('dragon-raid-setup-btn');
    if (!btn) return;
    const raid = window.DragonRaid?.raid;
    const live = !!raid && !DEAD_RAID.includes(raid.phase);
    let text = 'RAID SETUP';
    if (live) text = raid.phase === 'RECRUITING' ? 'RAID RECRUITING' : 'RAID LIVE';
    if (btn.textContent !== text) btn.textContent = text;
    btn.classList.toggle('is-live', live);
    const title = live ? `${String(raid.boss?.name || 'Encounter')} is running. Cancel it from the raid screen first.` : 'Open the Cabinet and choose a specimen';
    if (btn.title !== title) btn.title = title;
  }
  setInterval(syncRaidButton, 1000);
  syncRaidButton();
})();
