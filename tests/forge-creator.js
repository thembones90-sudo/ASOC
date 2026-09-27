const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const forge = fs.readFileSync(path.join(root, 'js', 'forge.js'), 'utf8');
const board = fs.readFileSync(path.join(root, 'js', 'board.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'forge-creator.css'), 'utf8');

assert.doesNotMatch(forge, /data-creator-field="title"/, 'creator no longer asks for a redundant title');
assert.match(forge, /d\.title = this\.isNew \? d\.theme/, 'new games derive their library title from the theme');
assert.match(forge, /FIELD_ORDER: \['A1'.*'finalSolution'\]/s, 'creator has a deterministic keyboard and paste order');
assert.match(forge, /click the preview board to jump to a field/, 'creator explains click-to-focus navigation');
assert.match(forge, /data-creator-test/, 'creator exposes private test play');
assert.match(forge, /_testRevealed = new Set\(\)/, 'test play uses isolated reveal state');
assert.match(forge, /DRAFT_PREFIX: 'asoc_forge_draft:'/, 'creator autosaves browser-local drafts');
assert.match(forge, /PASTE WHOLE BOARD/, 'creator supports bulk board entry');
assert.match(forge, /creator-progress/, 'creator reports board completion');
assert.match(forge, /is-missing/, 'save validation visibly marks missing fields');
assert.match(forge, /is-long/, 'creator warns when board text has to shrink too far');
assert.match(forge, /cellHints/, 'unified editor retains prepared per-cell hints');
assert.match(board, /options\.revealed instanceof Set/, 'preview supports covered test-play cells');
assert.match(app, /PREPARED HINT \/\//, 'GM hint requests surface the prepared hint');
assert.match(index, /forge-creator\.css\?v=/, 'creator-specific styling is loaded and cache-busted');
assert.match(css, /#creator-board \.board-cell\.creator-focus/, 'focused field is visibly linked to its preview cell');
assert.match(css, /\.creator-paste-card/, 'bulk paste has a dedicated readable dialog');

console.log('PASS ASOC Creator: theme identity, unified editor, guided entry, drafts, test play, fit warnings and prepared hints');
