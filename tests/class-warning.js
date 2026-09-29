// CLASS WARNING BANNER // "DON'T BE LATE FOR THE CLASS, LITTLE HERO".
// The timetable, the 5s life of the banner, and the wiring that puts a
// server-scheduled warning in front of every connected client.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const schedule = require(path.join(ROOT, 'class-schedule.js'));
const server = read('server.js');
const clockJs = read('js', 'class-clock.js');
const playerJs = read('js', 'player.js');
const appJs = read('js', 'app.js');
const css = read('css', 'asoc.css');

// ---------------------------------------------------------------- timetable
// Classes run 08:00 through 15:30 on the half hour: 16 starts.
assert.equal(schedule.classStartsOnDay(new Date(2026, 8, 29, 6, 0)).length, 16, '16 class starts a day');
assert.equal(schedule.WARNING_LEAD_MS, 60 * 1000, 'warning leads a start by one minute');

const at = (h, m, s) => new Date(2026, 8, 29, h, m, s, 0);

assert.deepEqual(schedule.classWarningFor(at(7, 59, 0))?.label, '08:00', 'warns before the first class');
assert.deepEqual(schedule.classWarningFor(at(15, 29, 0))?.label, '15:30', 'warns before the last class');
assert.deepEqual(schedule.classWarningFor(at(8, 29, 0))?.label, '08:30', 'warns before a mid-morning class');

// Nothing outside the window. A tick AFTER a start must not re-warn: the
// "don't be late" framing would be wrong once the class has begun.
for (const [h, m] of [[6, 59], [7, 30], [8, 0], [8, 1], [10, 15], [12, 0], [15, 30], [15, 59], [16, 0], [23, 59]]) {
  assert.equal(schedule.classWarningFor(at(h, m, 0)), null, `no warning at ${h}:${String(m).padStart(2, '0')}`);
}

// The bug this design exists to prevent: a loop that only asks "is the current
// minute 29 or 59" loses the warning entirely when it ticks late. Keying on the
// class means a single sample anywhere inside the 60s window is enough, so a
// throttled tab, a suspended tab or a closed laptop lid still gets the alert.
const seenKeys = new Set();
for (let minute = 0; minute < 24 * 60; minute += 1) {
  const warning = schedule.classWarningFor(at(Math.floor(minute / 60), minute % 60, 30));
  if (warning) seenKeys.add(warning.key);
}
assert.equal(seenKeys.size, 16, 'exactly 16 distinct classes, one warning each');

const lateSamples = new Set();
for (const second of [0, 20, 40, 59]) {
  for (let hour = 7; hour <= 15; hour += 1) {
    for (const minute of [29, 59]) {
      const warning = schedule.classWarningFor(at(hour, minute, second));
      if (warning) lateSamples.add(warning.key);
    }
  }
}
assert.equal(lateSamples.size, 16, 'every class is still caught however late the loop wakes');

assert.equal(schedule.nextClassStart(at(15, 30, 0)), null, 'no class after the last start');
assert.equal(schedule.formatClock(schedule.nextClassStart(at(9, 5, 0))), '09:30', 'next start from mid-morning');

// ------------------------------------------------------------------ server
// Server-driven on purpose: a client-side tick is per-tab and a backgrounded tab
// silently misses the minute, which is exactly when the banner matters.
assert.match(server, /require\('\.\/class-schedule'\)/, 'server loads the shared timetable');
assert.match(server, /type: 'class:warning'/, 'server emits class:warning');
assert.match(server, /DON'T BE LATE FOR THE CLASS, LITTLE HERO/, 'server carries the banner copy');
assert.match(server, /function announceClassWarning\(\)/, 'server has a class-warning announcer');
assert.match(server, /setInterval\(\(\) => announceClassWarning\(\), 1000\)\.unref\(\)/, 'announcer runs on a timer');
assert.match(server, /lastAnnouncedClassKey/, 'announcements are deduped per class');
// Everyone in the room: players and the host, not just one socket.
const announcer = server.slice(server.indexOf('function announceClassWarning'), server.indexOf('function announceClassWarning') + 1200);
assert.match(announcer, /room\.players\.forEach/, 'warning reaches every player');
assert.match(announcer, /room\.hostConnection/, 'warning reaches the GM view');

for (const [name, src] of [['player.js', playerJs], ['app.js', appJs]]) {
  assert.match(src, /case 'class:warning':\s*\n\s*window\.AsocClassClock\?\.warn\(message\);/, `${name} renders the server warning`);
}

// ------------------------------------------------------------- banner (DOM)
// Runs the real js/class-clock.js against a minimal fake DOM so the "appears
// and disperses after 5 seconds" requirement is measured, not asserted by grep.
function loadClock(fake) {
  const source = read('js', 'class-clock.js');
  const run = new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', 'Date', source);
  run(fake.window, fake.document, fake.localStorage, fake.window.setTimeout, fake.window.clearTimeout, fake.Date);
  return fake.window.AsocClassClock;
}

function makeFakeDom() {
  const timers = [];
  const attached = new Map();
  const makeEl = (tag) => ({
    tagName: tag, id: '', className: '', textContent: '', children: [], attrs: {}, parent: null,
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild(child) { child.parent = this; this.children.push(child); attached.set(child.id, child); },
    // Detach for real: a real remove() also pulls the node out of its parent's
    // child list, and the "only one banner at a time" check depends on that.
    remove() {
      attached.delete(this.id);
      if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);
      this.parent = null;
    }
  });
  const document = {
    body: makeEl('body'),
    documentElement: { classList: { add() {}, remove() {} } },
    createElement: makeEl,
    // No clock chip on this surface: the banner API must still be published.
    querySelectorAll: () => [],
    getElementById: (id) => attached.get(id) || null
  };
  const fake = {
    document,
    localStorage: { getItem: () => null, setItem: () => {} },
    Date,
    window: {
      setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
      clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; },
      addEventListener: () => {}
    },
    timers
  };
  return fake;
}

const fake = makeFakeDom();
const api = loadClock(fake);
assert.ok(api && typeof api.warn === 'function', 'warn() is published even with no clock chip on the page');

api.warn({ message: "DON'T BE LATE FOR THE CLASS, LITTLE HERO", label: '08:00' });
const banner = fake.document.getElementById('class-warning-banner');
assert.ok(banner, 'banner is attached to the screen');
assert.equal(banner.children[0].textContent, "DON'T BE LATE FOR THE CLASS, LITTLE HERO", 'banner shows the exact copy');
assert.equal(banner.children[1].textContent, 'CLASS BEGINS 08:00', 'banner shows the class time');
assert.equal(banner.attrs.role, 'alert', 'banner interrupts a screen reader as a deadline alert');
assert.equal(banner.attrs['aria-live'], 'assertive', 'banner is announced assertively');

const bannerTimer = fake.timers.find(t => t.delay === 5000);
assert.ok(bannerTimer, 'banner is torn down on a 5000ms timer');
fake.document.getElementById('class-warning-banner');
assert.ok(fake.document.getElementById('class-warning-banner'), 'banner stays on screen until that timer runs');
bannerTimer.fn();
assert.equal(fake.document.getElementById('class-warning-banner'), null, 'banner is gone after 5 seconds');

// A second class while the first banner is still up must replace it, not stack
// two full-screen overlays.
const fake2 = makeFakeDom();
const api2 = loadClock(fake2);
api2.warn({ message: 'FIRST', label: '08:00' });
api2.warn({ message: 'SECOND', label: '08:30' });
assert.equal(api2 && fake2.document.body.children.filter(c => c.id === 'class-warning-banner').length, 1, 'only one banner at a time');
assert.equal(fake2.document.getElementById('class-warning-banner').children[0].textContent, 'SECOND', 'the newest warning wins');

// Missing copy from the server must not produce an empty banner.
const fake3 = makeFakeDom();
loadClock(fake3).warn({});
assert.equal(fake3.document.getElementById('class-warning-banner').children[0].textContent, "DON'T BE LATE FOR THE CLASS, LITTLE HERO", 'falls back to the copy when the server sends none');

// --------------------------------------------------------------------- css
assert.match(css, /\.class-warning-banner \{[\s\S]*position:fixed[\s\S]*pointer-events:none/, 'banner covers the screen without blocking input');
assert.match(css, /\.class-warning-banner \{[\s\S]*animation:class-warning-banner-life 5s/, 'banner animation is 5 seconds');
assert.match(css, /@keyframes class-warning-banner-life \{[\s\S]*0%\s*\{[\s\S]*opacity:0[\s\S]*9%\s*\{[\s\S]*opacity:1[\s\S]*78%\s*\{[\s\S]*opacity:1[\s\S]*100%\s*\{[\s\S]*opacity:0/, 'banner appears, holds, then disperses');
assert.match(css, /@media \(prefers-reduced-motion:reduce\)\s*\{[\s\S]*\.class-warning-banner \{ animation:class-warning-banner-fade 5s linear both; \}/, 'reduced motion fades instead of animating');

console.log('PASS class warning: shared 08:00-15:30 timetable, server broadcasts once per class to players and GM, 5s appear-and-disperse banner for everyone');
