const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-production-'));
let nextPort = 31000 + (process.pid % 2000);

function startServer(extraEnv = {}) {
  const port = nextPort++;
  const child = spawn(NODE, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      ASOC_DATA_DIR: DATA_DIR,
      ASOC_GM_PASSWORD: 'production-readiness-test',
      ASOC_SHUTDOWN_GRACE_MS: '4000',
      NODE_ENV: 'test',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return { child, port, output: () => output };
}

function waitForReady(instance, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (instance.output().includes('ASOC Engine server running')) return resolve();
      if (instance.child.exitCode !== null) return reject(new Error(`Server exited early:\n${instance.output()}`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`Server start timeout:\n${instance.output()}`));
      setTimeout(poll, 40);
    };
    poll();
  });
}

function getHealth(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 2000 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Health request timed out')));
  });
}

function waitForExit(child, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => reject(new Error('Server shutdown timed out')), timeoutMs);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
}

(async () => {
  let first;
  let restored;
  try {
    first = startServer();
    await waitForReady(first);
    const health = await getHealth(first.port);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true, service: 'asoc-engine', status: 'ready' });
    assert.ok(first.output().includes(`[persistence] Durable data directory: ${DATA_DIR}`));
    assert.equal(fs.readdirSync(DATA_DIR).some(name => name.startsWith('.asoc-write-probe-')), false);

    first.child.send({ type: 'asoc:test-shutdown' });
    first.child.send({ type: 'asoc:test-shutdown' });
    assert.equal(await waitForExit(first.child), 0, first.output());
    assert.equal((first.output().match(/persisting MASTER and closing connections/g) || []).length, 1,
      'duplicate signals must not execute shutdown twice');

    const snapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'active-rooms.json'), 'utf8'));
    assert.ok(snapshot.rooms.some(room => room.code === 'MASTER'), 'shutdown snapshot must contain MASTER');

    restored = startServer();
    await waitForReady(restored);
    assert.ok(restored.output().includes('[recovery] 1 room(s) available for reconnect'), restored.output());
    assert.equal((await getHealth(restored.port)).status, 200);
    restored.child.send({ type: 'asoc:test-shutdown' });
    assert.equal(await waitForExit(restored.child), 0, restored.output());

    const invalidRoot = path.join(DATA_DIR, 'not-a-directory');
    fs.writeFileSync(invalidRoot, 'occupied');
    const invalid = startServer({ ASOC_DATA_DIR: invalidRoot });
    const invalidCode = await waitForExit(invalid.child);
    assert.notEqual(invalidCode, 0, 'unusable ASOC_DATA_DIR must fail startup');

    console.log('PASS production readiness: health, writable data root, graceful shutdown, idempotence, recovery');
  } finally {
    if (first?.child.exitCode === null) first.child.kill('SIGKILL');
    if (restored?.child.exitCode === null) restored.child.kill('SIGKILL');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
