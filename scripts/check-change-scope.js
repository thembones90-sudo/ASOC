#!/usr/bin/env node
'use strict';

// Focused-diff guardrail. Central runtime changes must arrive with a test;
// this catches the exact failure mode where a small UI request accidentally
// rewrites core chat/server files without a regression contract.
const { execFileSync } = require('child_process');

const base = process.argv[2] || process.env.ASOC_DIFF_BASE || 'HEAD~1';
let files;
try {
  files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
} catch (error) {
  console.error(`CHANGE SCOPE CHECK FAILED // could not compare ${base}...HEAD`);
  process.exit(1);
}

const central = files.filter(file => /^(server\.js|js\/(?:app|player|black-market|shadow-cosmetics|runtime-guard)\.js|index\.html|join\.html)$/.test(file));
const tests = files.filter(file => /^tests\/.*\.js$/.test(file));
if (central.length && !tests.length) {
  console.error('CHANGE SCOPE REJECTED // central runtime files changed without a tests/*.js regression contract');
  console.error(central.join('\n'));
  process.exit(1);
}
if (files.includes('server.js') && !files.some(file => /^tests\/(?:hardening|run|reinforcement|chat-acts|black-market).*\.js$/.test(file))) {
  console.error('CHANGE SCOPE REJECTED // server.js changed without an integration/hardening test');
  process.exit(1);
}
console.log(`PASS change scope: ${files.length} file(s), ${central.length} central, ${tests.length} test contract(s)`);
