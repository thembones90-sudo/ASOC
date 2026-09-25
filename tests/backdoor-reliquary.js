const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('js/app.js');
const media = read('js/chat-media-preview.js');
const backdoorCss = read('css/backdoor-console.css');

// The Reliquary is a hidden GM-only mechanic: no button, no command-picker
// entry, nothing that names it in any menu. Only /reliquary <code> opens it.
assert.doesNotMatch(html, /OPEN RELIQUARY|blood-tribute-vault-open/);
assert.doesNotMatch(app, /name: 'reliquary'/);
assert.doesNotMatch(app, /label: 'OPEN RELIQUARY'/);
assert.ok(app.includes('/^\\/reliquary'), 'the /reliquary command still opens it');
assert.match(app, /gm:reliquaryAccess.*String\(code\)\.trim\(\)/s);
assert.match(app, /data-vault-preview-id/);
assert.match(app, /openBloodTributeImage\(tribute\)/);
assert.match(backdoorCss, /maintenance-open \.gm-content[\s\S]*overflow-y:auto !important/);
assert.match(backdoorCss, /width:min\(1180px,100%\)/);
assert.match(media, /looksLikeImageUrl/);
assert.match(media, /\\\.\(\?:png\|jpe\?g\|webp\|gif\)/);
assert.doesNotMatch(media, /return \^https\?:\\\/\\\//);

console.log('PASS responsive Backdoor, Reliquary entry/viewer, and normal URL paste routing');
