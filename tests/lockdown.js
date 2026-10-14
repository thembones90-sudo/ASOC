'use strict';
const assert = require('assert');
const { blocksPlayerAction } = require('../lockdown');
for (const type of ['dragon:join', 'dragon:action', 'chat:gif', 'dm:send', 'shadow:buy', 'chat:react', 'unknown:newAction']) {
  assert.equal(blocksPlayerAction(true, { type }, false), true);
  assert.equal(blocksPlayerAction(true, { type }, true), false);
  assert.equal(blocksPlayerAction(false, { type }, false), false);
}
assert.equal(blocksPlayerAction(true, { type: 'chat:guess', text: 'hello' }, false), false);
assert.equal(blocksPlayerAction(true, { type: 'chat:guess', text: ' /dice' }, false), true);
assert.equal(blocksPlayerAction(true, { type: 'poison:tributeSubmit' }, false), false);
console.log('PASS lockdown: player actions sealed, chat and debt payment open, GM unrestricted');
