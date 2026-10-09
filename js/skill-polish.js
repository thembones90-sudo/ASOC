(() => {
  'use strict';

  // ASOC SKILL POLISH // one shared layer over every player-facing Shadow Broker skill.
  //  1. FEEDBACK  - a lasting "skill feed" chip says what happened and to whom after the
  //                 full-screen effect is gone, plus a hit flash and phone haptics for the victim.
  //  2. PERFORMANCE - auto "lite" mode on weak devices (saved), animations pause in a hidden tab.
  // It never edits the skill scripts: it watches for their overlay layers appearing in <body>.

  const root = document.documentElement;
  const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* private mode */ } }
  };

  // ---------------------------------------------------------------- performance
  function detectLite() {
    const flag = store.get('asoc_lite');
    if (flag === 'on') return true;
    if (flag === 'off') return false;
    if (flag === 'auto') return true;
    if (/[?&]lite=1\b/.test(location.search)) return true;
    const nav = navigator;
    if (nav.connection?.saveData) return true;
    if (nav.deviceMemory && nav.deviceMemory <= 3) return true;
    if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 3) return true;
    return false;
  }
  if (detectLite()) root.classList.add('asoc-lite');

  document.addEventListener('visibilitychange', () => {
    root.classList.toggle('asoc-tab-hidden', document.hidden);
  });

  // Measure real frame times while an effect is on screen; if the device struggles, drop to
  // lite for good (until the player clears the flag). Only judged while the tab is visible.
  let probing = false;
  function probeFrames(layer) {
    if (probing || root.classList.contains('asoc-lite') || store.get('asoc_lite') === 'off') return;
    probing = true;
    const gaps = [];
    let last = 0;
    const tick = now => {
      if (document.hidden || !layer.isConnected || gaps.length >= 40) return finish();
      if (last) gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    const finish = () => {
      probing = false;
      if (gaps.length < 20) return;
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      const p90 = gaps[Math.floor(gaps.length * 0.9)];
      if (median > 30 || p90 > 55) {
        root.classList.add('asoc-lite');
        store.set('asoc_lite', 'auto');
      }
    };
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------- registry
  // role(): 'victim' | 'attacker' | 'observer' | 'neutral'. text(): the line shown in the feed.
  const clsRole = (el, re) => (re.exec(el.className)?.[1]) || 'neutral';
  const pair = (el, a, b) => {
    const head = el.querySelector(a)?.textContent?.trim() || '';
    const line = el.querySelector(b)?.textContent?.trim() || '';
    return [head, line].filter(Boolean).join(' // ');
  };
  const SKILLS = [
    { match: el => el.id === 'asoc-whip-effect', key: 'whip', name: 'WHIP', icon: '\u{1FAA2}', tint: '#d9653b',
      role: el => clsRole(el, /asoc-whip-(victim|attacker|observer)/), heavy: false,
      text: el => (el.classList.contains('is-hijacked') ? 'HIJACKED! ' : '') + (el.querySelector('.asoc-whip-line')?.textContent || '').trim() },
    { match: el => el.id === 'asoc-tickle-layer', key: 'tickle', name: 'TICKLE', icon: '\u{1FAB6}', tint: '#a96bff',
      role: el => clsRole(el, /\bis-(victim|attacker|observer)\b/), heavy: false,
      text: el => pair(el, '.asoc-tickle-caption strong', '.asoc-tickle-caption span') },
    { match: el => el.id === 'asoc-dropkick-layer', key: 'dropkick', name: 'DROPKICK', icon: '\u{1F9B5}', tint: '#ff8a3d',
      role: el => clsRole(el, /\brole-(victim|attacker|observer)\b/), heavy: true,
      text: el => pair(el, '.asoc-dropkick-banner strong', '.asoc-dropkick-banner span') },
    { match: el => el.id === 'backstab-effect-layer', key: 'backstab', name: 'BACKSTAB', icon: '\u{1F5E1}️', tint: '#d0202e',
      role: el => (el.classList.contains('is-victim') ? 'victim' : el.classList.contains('is-actor') ? 'attacker' : 'observer'), heavy: true,
      text: el => pair(el, 'strong', 'strong + span') },
    { match: el => el.id === 'fistbump-effect-layer', key: 'fistbump', name: 'FISTBUMP', icon: '\u{1F91C}', tint: '#58c4ff',
      role: () => 'neutral', heavy: false,
      text: el => pair(el, '.fistbump-caption strong', '.fistbump-caption span') },
    { match: el => el.id === 'goat-event-layer', key: 'goat', name: 'GOAT', icon: '\u{1F410}', tint: '#8cc152',
      role: () => 'neutral', heavy: false,
      text: el => pair(el, '.goat-event-title', '.goat-event-subtitle') },
    { match: el => el.id === 'ass-kick-effect-layer', key: 'asskick', name: 'ASS KICK', icon: '\u{1F97E}', tint: '#c9a24a',
      role: () => 'neutral', heavy: false,
      text: el => 'DISCIPLINARY FOOTWORK // ' + (el.querySelector('.ass-kick-target b')?.textContent || '').trim() },
    { match: el => el.id === 'asoc-coffee-layer', key: 'coffee', name: 'COFFEE', icon: '☕', tint: '#d2a05a',
      role: () => 'neutral', heavy: false,
      text: () => 'HOSTILITIES SUSPENDED // TAP THE CUP FOR A 30s BADGE' }
  ];

  // --------------------------------------------------------------------- feedback
  const MAX_CHIPS = 3;
  const CHIP_MS = 9000;
  const recent = new Map();
  let feed = null;

  function ensureFeed() {
    if (feed && feed.isConnected) return feed;
    feed = document.createElement('div');
    feed.id = 'asoc-skill-feed';
    feed.setAttribute('role', 'log');
    feed.setAttribute('aria-live', 'polite');
    document.body.appendChild(feed);
    return feed;
  }

  const ROLE_TAG = { victim: 'YOU WERE HIT', attacker: 'YOUR MOVE', neutral: '', observer: '' };
  const VICTIM_TAG = { whip: 'YOU WERE WHIPPED', tickle: 'YOU WERE TICKLED', dropkick: 'YOU WERE KICKED', backstab: 'YOU WERE STABBED' };

  function addChip(skill, role, text) {
    const host = ensureFeed();
    const dedupeKey = skill.key + '|' + role + '|' + text;
    const now = Date.now();
    if (now - (recent.get(dedupeKey) || 0) < 2500) return;
    recent.set(dedupeKey, now);
    if (recent.size > 40) recent.delete(recent.keys().next().value);

    while (host.children.length >= MAX_CHIPS) host.firstElementChild.remove();
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'asoc-skill-chip is-' + role;
    chip.style.setProperty('--tint', skill.tint);
    chip.setAttribute('aria-label', skill.name + ' ' + text + ' (tap to dismiss)');
    const icon = document.createElement('span');
    icon.className = 'asoc-skill-chip-icon';
    icon.textContent = skill.icon;
    const body = document.createElement('span');
    body.className = 'asoc-skill-chip-body';
    const head = document.createElement('b');
    const tag = role === 'victim' ? (VICTIM_TAG[skill.key] || ROLE_TAG.victim) : ROLE_TAG[role];
    head.textContent = skill.name + (tag ? ' // ' + tag : '');
    const line = document.createElement('span');
    line.textContent = text.slice(0, 160);
    body.append(head, line);
    const bar = document.createElement('i');
    bar.className = 'asoc-skill-chip-bar';
    bar.style.animationDuration = CHIP_MS + 'ms';
    chip.append(icon, body, bar);
    const drop = () => {
      chip.classList.add('is-leaving');
      setTimeout(() => chip.remove(), 220);
    };
    chip.addEventListener('click', drop);
    host.appendChild(chip);
    setTimeout(drop, CHIP_MS);
  }

  function flash(skill, role) {
    if (reducedMotion() || role !== 'victim') return;
    const el = document.createElement('div');
    el.className = 'asoc-skill-flash is-' + skill.key + (skill.heavy ? ' is-heavy' : '');
    el.style.setProperty('--tint', skill.tint);
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), skill.heavy ? 1500 : 1000);
  }

  function haptic(skill, role) {
    if (reducedMotion() || store.get('asoc_haptics') === 'off') return;
    const pattern = role === 'victim' ? (skill.heavy ? [70, 40, 120, 40, 70] : [35, 35, 70])
      : role === 'attacker' ? [18] : null;
    if (!pattern) return;
    try { navigator.vibrate?.(pattern); } catch (_) { /* unsupported or blocked */ }
  }

  function handle(layer) {
    const skill = SKILLS.find(s => s.match(layer));
    if (!skill) return;
    probeFrames(layer);
    // Skill scripts fill their text right after appending; read it a beat later.
    setTimeout(() => {
      if (!layer.isConnected) return;
      const role = skill.role(layer);
      if (role === 'observer') return;
      flash(skill, role);
      haptic(skill, role);
      const text = (skill.text(layer) || '').replace(/\s+/g, ' ').trim();
      if (text) addChip(skill, role, text);
    }, 80);
  }

  function start() {
    if (!document.body) return;
    new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => { if (node.nodeType === 1) handle(node); });
      }
    }).observe(document.body, { childList: true });
    root.classList.toggle('asoc-tab-hidden', document.hidden);
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  window.AsocSkillPolish = Object.freeze({
    lite: on => {
      store.set('asoc_lite', on ? 'on' : 'off');
      root.classList.toggle('asoc-lite', !!on);
    },
    haptics: on => store.set('asoc_haptics', on ? 'on' : 'off')
  });
})();
