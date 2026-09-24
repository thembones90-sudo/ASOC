const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gm = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const player = fs.readFileSync(path.join(root, 'js', 'player.js'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'js', 'chat-media-preview.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'css', 'asoc.css'), 'utf8');

for (const source of [gm, player]) {
  assert.match(source, /avatarData \? ' avatar-preview-trigger' : ''/);
  assert.match(source, /role="button" tabindex="0"/);
  assert.match(source, /data-preview-label=/);
  assert.match(source, /alt="\$\{avatarName\} avatar"/);
}

assert.match(preview, /TRIGGER_SELECTOR[^\n]+\.avatar-preview-trigger/);
assert.match(preview, /event\.key !== 'Enter' && event\.key !== ' '/);
assert.match(preview, /overlay\.classList\.toggle\('is-avatar-preview', isAvatar\)/);
assert.match(preview, /returnFocus\.focus/);
assert.match(styles, /\.little-hero-avatar\.avatar-preview-trigger/);
assert.match(styles, /\.chat-media-lightbox\.is-avatar-preview \.chat-media-lightbox-stage/);

console.log('PASS clickable avatar preview: GM/player markup, keyboard access, enlarged lightbox and focus restoration');
