// DESKTOP LAYOUT BASELINE -- guards the canonical desktop Little Hero page
// while mobile work lands. For each scenario it records a fingerprint of every
// rendered element (computed display/position/typography/colour/box/flex/grid
// values, with animations frozen) plus the horizontal geometry of the main
// containers, and compares it with the committed baseline in
// tests/baselines/. The fingerprint is independent of font rasterisation, so
// it is stable across machines; pixel screenshots are not used.
//
//   node tests/desktop-layout-baseline.js                 # compare
//   ASOC_UPDATE_BASELINES=1 node tests/desktop-layout-baseline.js   # re-record
//
// Re-record ONLY for an intentional desktop change, and say so in the PR.
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { chromium } = require('playwright');
const h = require('./lib/browser-harness');

const PORT = Number(process.env.ASOC_DESKTOP_BASELINE_PORT) || 18951;
const BASELINE_FILE = path.join(__dirname, 'baselines', 'desktop-layout.json');
const UPDATE = process.env.ASOC_UPDATE_BASELINES === '1';

const STYLE_PROPS = [
  'display', 'position', 'visibility', 'float', 'box-sizing',
  'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
  'color', 'background-color', 'opacity',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-top-style', 'border-radius',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'overflow-x', 'overflow-y', 'z-index', 'cursor'
];
// Containers whose horizontal geometry is CSS-determined (not text-driven).
const GEOMETRY = [
  '#game-screen', '#player-battle-layout', '#casual-minigames-dock', '#board-layer',
  '#little-hero-hud', '#chat-panel', '#chat-messages', '#chat-form', '#chat-input'
];

// Runs in the page: freeze motion, then fingerprint every rendered element.
function fingerprint({ props, geometry }) {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.appendChild(style);
  const pathOf = el => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + node.id); break; }
      const parent = node.parentElement;
      const same = parent ? Array.from(parent.children).filter(c => c.tagName === node.tagName) : [node];
      const cls = Array.from(node.classList).filter(c => !/^(is-|has-)?(active|visible|open|hover|focus|selected|new|fresh|pulse|flash)/.test(c)).sort().join('.');
      parts.unshift(node.tagName.toLowerCase() + (cls ? '.' + cls : '') + (same.length > 1 ? `:${same.indexOf(node) + 1}` : ''));
    }
    return parts.join('>');
  };
  const out = { elements: {}, geometry: {} };
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('script,style,svg,template')) continue;
    // Wall-clock UI (the class-schedule warning) comes and goes with the time of day.
    if (el.closest('#class-warning-banner')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const key = pathOf(el);
    const entry = {};
    for (const prop of props) entry[prop] = cs.getPropertyValue(prop);
    // The ritual pentagon is centred with margin:auto; its used margin depends
    // on the machine's fonts (CI vs local) while the pentagon itself does not move.
    if (el.classList.contains('ritual-pentagon')) { entry['margin-left'] = 'auto'; entry['margin-right'] = 'auto'; }
    out.elements[key] = entry;
  }
  for (const selector of geometry) {
    const el = document.querySelector(selector);
    if (!el) { out.geometry[selector] = null; continue; }
    const r = el.getBoundingClientRect();
    out.geometry[selector] = { x: Math.round(r.x), width: Math.round(r.width), display: getComputedStyle(el).display };
  }
  style.remove();
  return out;
}

async function stableFingerprint(page) {
  let previous = null;
  for (let i = 0; i < 12; i++) {
    const current = JSON.stringify(await page.evaluate(fingerprint, { props: STYLE_PROPS, geometry: GEOMETRY }));
    if (current === previous) return JSON.parse(current);
    previous = current;
    await h.sleep(500);
  }
  throw new Error('page never settled for a stable fingerprint');
}

function diff(expected, actual, label) {
  const problems = [];
  for (const [selector, geo] of Object.entries(expected.geometry)) {
    if (JSON.stringify(geo) !== JSON.stringify(actual.geometry[selector])) {
      problems.push(`${label} geometry ${selector}: ${JSON.stringify(geo)} -> ${JSON.stringify(actual.geometry[selector])}`);
    }
  }
  const keys = new Set([...Object.keys(expected.elements), ...Object.keys(actual.elements)]);
  for (const key of keys) {
    const a = expected.elements[key];
    const b = actual.elements[key];
    if (!a) { problems.push(`${label} NEW rendered element ${key}`); continue; }
    if (!b) { problems.push(`${label} MISSING rendered element ${key}`); continue; }
    for (const prop of STYLE_PROPS) {
      if (a[prop] !== b[prop]) problems.push(`${label} ${key} { ${prop}: ${a[prop]} -> ${b[prop]} }`);
    }
  }
  return problems;
}

// Compact storage: each distinct style set is stored once; elements point at it.
function pack(results) {
  const styles = [];
  const index = new Map();
  const scenarios = {};
  for (const [name, fp] of Object.entries(results)) {
    const elements = {};
    for (const [key, entry] of Object.entries(fp.elements)) {
      const row = JSON.stringify(STYLE_PROPS.map(prop => entry[prop]));
      if (!index.has(row)) { index.set(row, styles.length); styles.push(JSON.parse(row)); }
      elements[key] = index.get(row);
    }
    scenarios[name] = { geometry: fp.geometry, elements };
  }
  return { props: STYLE_PROPS, styles, scenarios };
}
function unpack(stored) {
  const out = {};
  for (const [name, fp] of Object.entries(stored.scenarios)) {
    const elements = {};
    for (const [key, i] of Object.entries(fp.elements)) {
      elements[key] = Object.fromEntries(stored.props.map((prop, n) => [prop, stored.styles[i][n]]));
    }
    out[name] = { geometry: fp.geometry, elements };
  }
  return out;
}

function gmSocket(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('error', reject);
    ws.on('message', data => {
      const m = JSON.parse(data.toString());
      if (m.type === 'protocol:hello') ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
      else if (m.type === 'protocol:ready') ws.send(JSON.stringify({ type: 'host:recover', gmToken: token }));
      else if (m.type === 'host:recovered') resolve(ws);
    });
  });
}

(async () => {
  const server = await h.startServer({ port: PORT });
  const browser = await chromium.launch(h.launchOptions());
  const results = {};
  let gm = null;
  try {
    const token = await h.heroToken(server, 'Baseline Hero');
    const scenarios = [
      { name: 'casual-1920', viewport: { width: 1920, height: 1080 } },
      { name: 'casual-1366', viewport: { width: 1366, height: 768 } },
      { name: 'battle-armed-1920', viewport: { width: 1920, height: 1080 }, armed: true }
    ];
    for (const scenario of scenarios) {
      if (scenario.armed && !gm) {
        const gmToken = (await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token;
        gm = await gmSocket(server.port, gmToken);
        gm.send(JSON.stringify({ type: 'gm:setRoomMode', mode: 'BATTLE' }));
        await h.sleep(500);
      }
      const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
      const page = await h.openHeroPage(context, server, token);
      if (scenario.armed) await page.waitForSelector('#game-screen.room-mode-battle-armed', { timeout: 10000 });
      await h.sleep(1500);
      results[scenario.name] = await stableFingerprint(page);
      assert.deepEqual(page.pageErrors, [], `${scenario.name}: no page errors`);
      await context.close();
    }
    if (UPDATE || !fs.existsSync(BASELINE_FILE)) {
      if (!UPDATE) throw new Error(`No baseline at ${path.relative(h.ROOT, BASELINE_FILE)}; record one with ASOC_UPDATE_BASELINES=1`);
      fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
      fs.writeFileSync(BASELINE_FILE, JSON.stringify(pack(results)) + '\n');
      console.log(`RECORDED desktop layout baseline (${Object.keys(results).map(k => `${k}: ${Object.keys(results[k].elements).length} elements`).join(', ')})`);
      return;
    }
    const baseline = unpack(JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')));
    const problems = [];
    for (const name of Object.keys(baseline)) {
      if (!results[name]) { problems.push(`scenario ${name} not produced`); continue; }
      problems.push(...diff(baseline[name], results[name], name));
    }
    if (problems.length) {
      console.error(problems.slice(0, 40).join('\n'));
      if (problems.length > 40) console.error(`... and ${problems.length - 40} more`);
      throw new Error(`${problems.length} desktop layout difference(s) from the committed baseline`);
    }
    assert.equal(server.errors().trim(), '', 'no server errors');
    console.log(`PASS desktop layout baseline: ${Object.keys(baseline).length} scenarios identical to the committed desktop fingerprint`);
  } finally {
    try { gm?.close(); } catch {}
    await browser.close();
    await server.stop();
  }
})().catch(error => {
  console.error('FAIL desktop layout baseline:', error.message || error);
  process.exit(1);
});
