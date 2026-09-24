const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gmStyles = fs.readFileSync(path.join(root, 'css', 'asoc.css'), 'utf8');
const playerPage = fs.readFileSync(path.join(root, 'join.html'), 'utf8');

const gmRule = gmStyles.slice(gmStyles.lastIndexOf('/* REPLY READABILITY'));
const playerRule = playerPage.slice(playerPage.lastIndexOf('/* REPLY READABILITY'));

assert.match(gmRule, /\.gm-module-chat \.gm-chat-reply-context[\s\S]*font-size:\s*\.7rem !important/);
assert.match(gmRule, /-webkit-line-clamp:\s*2/);
assert.match(gmRule, /text-transform:\s*none !important/);

assert.match(playerRule, /\.chat-reply-context[\s\S]*font-size:\s*\.72rem !important/);
assert.match(playerRule, /#chat-reply-preview-text[\s\S]*font-size:\s*\.7rem !important/);
assert.match(playerRule, /-webkit-line-clamp:\s*2 !important/);

console.log('PASS readable reply context and composer preview on GM/player chat');
