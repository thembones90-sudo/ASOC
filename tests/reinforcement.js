'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const memory = new Map();
global.localStorage = {
  getItem: key => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value))
};
const runtime = require('../js/runtime-guard');

assert.equal(runtime.acceptRevision('test', 8), true);
assert.equal(runtime.acceptRevision('test', 7), false, 'older public state must be rejected');
assert.equal(runtime.acceptRevision('test', 8), true, 'same-revision ancillary state remains valid');

runtime.setSafeMode(true);
assert.equal(runtime.safeMode(), true);
runtime.setSafeMode(false);
assert.equal(runtime.safeMode(), false);

(async () => {
  const order = [];
  const first = runtime.effects.enqueue('first', 100, () => order.push('first'));
  const second = runtime.effects.enqueue('second', 100, () => order.push('second'));
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'second'], 'full-screen effects must run serially');

  const index = read('index.html');
  const join = read('join.html');
  for (const html of [index, join]) {
    assert.match(html, /js\/runtime-guard\.js/);
    assert.ok(html.indexOf('js/runtime-guard.js') < html.indexOf('js/avada.js'), 'runtime guard loads before effects');
  }

  const app = read('js/app.js');
  const player = read('js/player.js');
  assert.match(app, /acceptRevision\?\.\('gm-public'/);
  assert.match(player, /acceptRevision\?\.\('player-public'/);
  assert.match(app, /AsocRuntime\?\.socket/);
  assert.match(player, /AsocRuntime\?\.socket/);

  for (const file of ['js/warsong.js', 'js/c4-alert.js', 'js/b3-alert.js', 'js/avada.js', 'js/shadow-cosmetics.js']) {
    assert.match(read(file), /AsocRuntime.*effects/s, `${file} must use the central effect coordinator`);
  }

  const backdoor = read('js/backdoor.js');
  assert.match(backdoor, /RUNTIME DIAGNOSTICS/);
  assert.match(backdoor, /ENABLE SAFE MODE/);
  assert.match(backdoor, /\/api\/build/);

  const server = read('server.js');
  assert.match(server, /DEPLOY_STARTED_AT/);
  assert.match(server, /type:\s*'blackMarket:ack'/);
  assert.match(server, /persisted:\s*true/);
  assert.match(server, /\[\.\.\.CHAT_SLASH_COMMANDS, \.\.\.GM_ONLY_SLASH_COMMANDS\]/,
    'GM command directory must inherit the player command registry');
  assert.match(server, /sweepChatUploads/);

  const market = read('js/black-market.js');
  assert.match(market, /transaction-persisted/);
  assert.match(market, /blackMarket:tributeSubmit[^\n]+requestId/);

  const workflow = read('.github/workflows/tests.yml');
  assert.match(workflow, /Run the complete test suite/);
  assert.match(workflow, /check-change-scope/);
  assert.ok(fs.existsSync(path.join(ROOT, 'tests', 'desktop-layout-baseline.js')), 'visual layout regression suite must remain enabled');

  console.log('PASS reinforcement: stale-state gate, diagnostics, safe mode, serialized effects, persisted transaction ACKs, command inheritance, storage sweep and CI guardrails');
})().finally(() => { delete global.localStorage; }).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
