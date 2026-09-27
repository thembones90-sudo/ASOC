'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const join = fs.readFileSync(path.join(root, 'join.html'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'desktop-release.yml'), 'utf8');
const desktop = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'));

assert(join.includes('id="desktop-download-panel"'), 'public access gate exposes the desktop download panel');
assert(join.includes('id="signed-desktop-download"'), 'signed-in browser interface exposes a persistent desktop download control');
assert(join.includes('DOWNLOAD ASOC DESKTOP APP') && join.includes('signed-desktop-download-action">GET APP'), 'signed-in download is a prominent labeled action, not a small utility chip');
assert(join.includes('@keyframes desktop-app-gold-pulse') && join.includes('@keyframes desktop-app-gold-sweep'), 'prominent desktop download has gold pulse and highlight animations');
assert(join.includes('@media(prefers-reduced-motion:reduce){.signed-desktop-download'), 'desktop download animation respects reduced-motion preferences');
assert(join.includes(`VERSION ${desktop.version}`), 'download panel version matches the Electron package');
assert(join.includes('/releases/latest/download/ASOC-Engine-Setup.exe'), 'installer uses a stable latest-release URL');
assert(join.includes('/releases/latest/download/ASOC-Engine-Portable.exe'), 'portable build remains available as a secondary option');
assert(join.includes('/releases/latest/download/SHA256SUMS.txt'), 'release checksums are exposed');
assert(join.includes('if(window.asocDesktop){') && join.includes('signedDesktopDownload.hidden=true'), 'desktop shell does not advertise downloading itself');
assert(workflow.includes("tags:\n      - 'desktop-v*'"), 'desktop version tags trigger packaging');
assert(workflow.includes('ASOC-Engine-Setup.exe') && workflow.includes('SHA256SUMS.txt'), 'release pipeline publishes stable installer and checksum assets');

console.log('desktop-download: all checks passed');
