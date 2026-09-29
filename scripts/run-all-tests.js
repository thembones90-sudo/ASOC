#!/usr/bin/env node
// Runs EVERY tests/*.js file, one at a time (several suites bind fixed ports),
// and reports every failure instead of stopping at the first one. New test
// files are picked up automatically, so a test can never be orphaned again.
//   node scripts/run-all-tests.js                 # all files
//   node scripts/run-all-tests.js battle-flow ... # only the named files
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'tests');
const PER_FILE_TIMEOUT_MS = Number(process.env.ASOC_TEST_FILE_TIMEOUT_MS) || 10 * 60 * 1000;

// Suites keep their scratch dirs under os.tmpdir(), which is the user profile
// (C:) on Windows. Every test that boots a server writes a data dir there, so a
// run litters the system drive and leaves it behind on failure. Redirecting the
// temp env for the child processes keeps all of it beside the repo instead.
// Overridable for anyone who wants the scratch somewhere else.
const SCRATCH = process.env.ASOC_SCRATCH_DIR || path.join(ROOT, '.scratch');
fs.mkdirSync(SCRATCH, { recursive: true });
const CHILD_ENV = { ...process.env, ASOC_SCRATCH_DIR: SCRATCH, TMPDIR: SCRATCH, TMP: SCRATCH, TEMP: SCRATCH };

const only = process.argv.slice(2).map(name => name.replace(/\.js$/, ''));
const files = fs.readdirSync(TEST_DIR)
  .filter(name => name.endsWith('.js'))
  .filter(name => !only.length || only.includes(name.replace(/\.js$/, '')))
  .sort();

if (!files.length) {
  console.error('No test files matched.');
  process.exit(1);
}

function runFile(name) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join('tests', name)], { cwd: ROOT, env: CHILD_ENV });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => {
      output += `\n[run-all-tests] TIMEOUT after ${PER_FILE_TIMEOUT_MS} ms`;
      child.kill('SIGKILL');
    }, PER_FILE_TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ name, ok: code === 0, code, signal, ms: Date.now() - started, output });
    });
  });
}

(async () => {
  const results = [];
  for (const name of files) {
    const result = await runFile(name);
    results.push(result);
    const secs = (result.ms / 1000).toFixed(1);
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${name}  (${secs}s)`);
    if (!result.ok) {
      const tail = result.output.trim().split('\n').slice(-25).join('\n');
      console.log(tail.replace(/^/gm, '      | '));
    }
  }
  const failed = results.filter(r => !r.ok);
  console.log('');
  console.log(`TEST FILES: ${results.length} run, ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map(r => r.name).join(', '));
    process.exit(1);
  }
})();
