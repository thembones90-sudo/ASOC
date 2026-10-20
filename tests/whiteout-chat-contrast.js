// Regression: sender WHITEOUT must never impose pale bubbles on a dark viewer.
// Run: node tests/whiteout-chat-contrast.js (requires Playwright + Chromium)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const join = read('join.html');
const inline = join.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1];
assert.ok(inline, 'The player chat stylesheet must be available');
assert.doesNotMatch(inline, /chat-message\[data-theme-id=["']whiteout["']\][^{]*\{[^}]*background:\s*linear-gradient\(135deg,\s*#e7ecef/i,
  'Dark viewers must not receive sender-owned pale WHITEOUT bubbles');

const css = [
  read('css/asoc.css'),
  inline,
  read('css/chat-polish.css'),
  read('css/mobile.css'),
  read('css/player-polish.css'),
  read('css/visual-upgrade.css')
].join('\n');

const player = (theme, label) => `<div class="chat-message" data-theme-id="${theme}"
  style="--little-hero-theme:#343A42;--little-hero-accent:#7b93a4;--theme-message-top:#151A20;--theme-message-bottom:#0C0F13">
  <div class="chat-message-main">
    <div class="chat-message-header"><span class="chat-player-name">${label}</span></div>
    <div class="chat-reply-context">↳ @Maxine // quoted message from another player</div>
    <div class="chat-message-line"><div class="chat-message-text">Can everyone read this?</div><span class="chat-time">02:10 PM</span></div>
  </div>
</div>`;

const gm = (theme, label) => `<div class="gm-chat-message gm-flow-message" data-theme-id="${theme}"
  style="--little-hero-theme:#343A42;--little-hero-accent:#7b93a4;--theme-message-top:#151A20;--theme-message-bottom:#0C0F13">
  <div class="gm-chat-bubble-cluster"><div class="gm-chat-message-main">
    <div class="gm-chat-flow-header"><span class="gm-chat-player-name">${label}</span></div>
    <div class="gm-chat-reply-context">↳ @Maxine // quoted message</div>
    <div class="gm-chat-message-line"><div class="gm-chat-message-text">Can everyone read this?</div><span class="gm-chat-time">02:10 PM</span></div>
  </div></div>
</div>`;

const snapshot = async page => page.evaluate(() => {
  const get = (scope, theme, selector, prop) => {
    const el = document.querySelector(`${scope} [data-theme-id="${theme}"] ${selector}`);
    if (!el) throw new Error('Missing ' + scope + ' ' + theme + ' ' + selector);
    return getComputedStyle(el)[prop];
  };
  const collect = (scope, prefix) => Object.fromEntries(['gunmetal','whiteout'].map(theme => [
    theme, {
      background: get(scope, theme, `.${prefix}-message-main`, 'backgroundImage'),
      text: get(scope, theme, `.${prefix}-message-text`, 'color'),
      quote: get(scope, theme, `.${prefix}-reply-context`, 'color'),
      time: get(scope, theme, `.${prefix}-time`, 'color')
    }
  ]));
  return {
    rootFilter: getComputedStyle(document.documentElement).filter,
    player: collect('#chat-messages', 'chat'),
    gm: collect('#gm-chat-messages', 'gm-chat')
  };
});

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    // Fixture uses the real authored CSS, not simplified stand-in colors.
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head>
      <body class="room-mode-casual">
        <div id="game-screen" class="room-mode-casual">
          <div class="battle-comms-lobby"><div id="chat-messages">
            ${player('gunmetal','DARK PLAYER')}${player('whiteout','WHITEOUT PLAYER')}
          </div></div>
        </div>
        <div class="gm-module-chat"><div id="gm-chat-messages">
          ${gm('gunmetal','DARK PLAYER')}${gm('whiteout','WHITEOUT PLAYER')}
        </div></div>
      </body></html>`);
    const dark = await snapshot(page);
    assert.equal(dark.rootFilter, 'none', 'Dark viewer must stay dark');
    for (const scope of ['player','gm']) {
      for (const field of ['background', 'text', 'quote', 'time']) {
        assert.equal(dark[scope].whiteout[field], dark[scope].gunmetal[field],
          `${scope}: WHITEOUT sender must not override ${field} for a dark viewer`);
      }
      assert.ok(!dark[scope].whiteout.background.includes('231, 236, 239'),
        `${scope}: no pale WHITEOUT gradient`);
    }

    await page.evaluate(() => document.documentElement.setAttribute('data-asoc-light',''));
    const light = await snapshot(page);
    assert.match(light.rootFilter, /invert\(1\).*hue-rotate\(180deg\)/,
      'WHITEOUT viewer must keep their own full light interface');
    console.log('PASS: player + GM chat WHITEOUT sender parity in dark viewer; quotes, timestamps, text; WHITEOUT viewer unaffected.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
