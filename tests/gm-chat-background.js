const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const styles = fs.readFileSync(path.join(root, 'css', 'asoc.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const section = styles.slice(styles.lastIndexOf('/* GM TACTICAL COMMS BACKPLANE'));

assert.match(section, /\.gm-module-chat \.gm-chat-messages[\s\S]*radial-gradient[\s\S]*linear-gradient/);
assert.match(section, /asoc-favicon\.svg/);
assert.match(section, /@keyframes gm-comms-scan/);
assert.match(section, /\.gm-flow-message:not\(:has\(~ \.gm-flow-message\)\)/);
assert.match(section, /\.gm-chat-panel\.is-reconnecting/);
assert.match(section, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(section, /pointer-events:\s*none/);
assert.match(app, /onopen[\s\S]*classList\.remove\('is-reconnecting'\)/);
assert.match(app, /onclose[\s\S]*classList\.add\('is-reconnecting'\)/);

console.log('PASS GM tactical comms background, reconnect interference, latest emphasis and reduced-motion safety');
