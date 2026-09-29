const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js', 'class-clock.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'asoc.css'), 'utf8');

assert.match(html, /id="gm-atomic-clock"[^>]*role="timer"/);
assert.match(html, /data-clock-hours>[\s\S]*data-clock-minutes>[\s\S]*data-clock-seconds>/);
assert.doesNotMatch(html, /ATOMIC \/\/ BELGRADE|NEXT CLASS \/\//);
assert.match(html, /js\/class-clock\.js/);
assert.match(js, /minute === 59 && hour >= 7 && hour <= 14/);
assert.match(js, /minute === 29 && hour >= 8 && hour <= 15/);
assert.match(js, /asoc_class_clock_last_alert/);
assert.match(js, /class-clock-nudge/);
assert.match(js, /Math\.max\(50, 1000 - \(Date\.now\(\) % 1000\) \+ 8\)/);
assert.match(css, /@keyframes class-clock-screen-nudge/);
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*class-clock-nudge/);
assert.match(css, /grid-template-columns:max-content max-content minmax\(180px,1fr\) max-content/);
assert.match(css, /\.gm-atomic-clock \{[\s\S]*grid-column:3;[\s\S]*justify-self:center/);

console.log('PASS class clock: HH:MM:SS telemetry and one-minute half-hour school warnings');
