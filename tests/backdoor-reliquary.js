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
// The panel (SEALED SYSTEMS included) never shows archived tribute images;
// they live only in the vault opened by /reliquary, and closing it wipes
// them from the page and re-seals the server side.
const renderFn = app.slice(app.indexOf('  renderBloodTributeVault() {'), app.indexOf('    if (clearBtn) clearBtn.disabled'));
assert.doesNotMatch(renderFn, /<img/, 'no tribute images in the panel list');
assert.doesNotMatch(html.slice(html.indexOf('blood-tribute-vault-section'), html.indexOf('gm-module-global')), /Vault/, 'the panel section does not advertise a vault');
const closeFn = app.slice(app.indexOf('  closeBloodTributeVault() {'), app.indexOf('  openBloodTributeImage('));
assert.match(closeFn, /this\.bloodTributes = \[\]/);
assert.match(closeFn, /grid\.innerHTML = ''/);
assert.match(closeFn, /gm:reliquaryLock/);
assert.match(app, /case 'tribute:vault':\s*\/\/ Only held while the vault is open/);
assert.match(read('server.js'), /case 'gm:reliquaryLock':[\s\S]{0,300}reliquaryUnlockedUntil = 0/);
// The Backdoor opens as a wide, readable console.
assert.match(backdoorCss, /#gm-panel\.maintenance-open \{\s*position:fixed !important;[\s\S]*width:min\(1240px, 94vw\) !important;/);
assert.match(app, /openBloodTributeImage\(tribute\)/);
assert.match(backdoorCss, /maintenance-open \.gm-content[\s\S]*overflow-y:auto !important/);
assert.match(backdoorCss, /width:min\(1180px,100%\)/);
// Library and New Game are legitimate Backdoor commands. Their Forge layer
// must sit above the fixed Backdoor instead of opening invisibly underneath.
assert.match(backdoorCss, /#forge-overlay\.active\s*\{\s*z-index:9600;/);
assert.match(html, /backdoor-console\.css\?v=20260927-forge-stack-1/);
assert.match(app, /library-btn'\)\.addEventListener\('click', \(\) => Forge\.open\(\)\)/);
assert.match(app, /new-game-btn'\)\.addEventListener\('click', \(\) => Forge\.open\(\)\.then\(\(\) => Forge\.openCreator\(null, true\)\)\)/);
assert.match(media, /looksLikeImageUrl/);
assert.match(media, /\\\.\(\?:png\|jpe\?g\|webp\|gif\)/);
assert.doesNotMatch(media, /return \^https\?:\\\/\\\//);

console.log('PASS responsive readable Backdoor, Reliquary entry/viewer (sealed everywhere else, re-sealed on close), and normal URL paste routing');
