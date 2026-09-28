// Shared harness for browser-level tests (Playwright + a real ASOC server).
// Lives in tests/lib/ so scripts/run-all-tests.js does not run it as a test.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: body ? { 'content-type': 'application/json' } : {} }, res => {
      let text = ''; res.on('data', c => { text += c; });
      res.on('end', () => { let data = text; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, data }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Starts an isolated ASOC server. Returns { port, base, api, stop, errors() }.
async function startServer({ port, env = {} } = {}) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-browser-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'browser-gm-pass', ASOC_EMAIL_VERIFICATION: '0', ...env },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = '';
  child.stderr.on('data', c => { errors += c; });
  for (let i = 0; i < 100; i++) {
    try { if ((await request(port, 'GET', '/health')).status === 200) break; } catch {}
    await sleep(150);
  }
  const api = (method, urlPath, body) => request(port, method, urlPath, body);
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    api,
    errors: () => errors,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000); });
      }
      fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  };
}

// Registers (or logs in) a Little Hero and returns its auth token.
async function heroToken(server, name) {
  const creds = { email: `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@browser.test`, password: 'browser-password', name };
  await server.api('POST', '/api/auth/player/register', creds);
  const login = await server.api('POST', '/api/auth/player/login', creds);
  if (!login.data?.token) throw new Error(`login failed for ${name}: ${JSON.stringify(login.data)}`);
  return login.data.token;
}

// Opens join.html as a returning, signed-in Little Hero (the same saved-login
// path a real returning player takes) and waits until the game screen is live.
async function openHeroPage(context, server, token) {
  await context.addInitScript(t => {
    try {
      localStorage.setItem('asoc_player_auth_token', t);
      sessionStorage.setItem('asoc_player_auth_token', t);
      localStorage.setItem('asoc_player_in_master', '1');
    } catch {}
  }, token);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${server.base}/join.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#game-screen.active', { timeout: 15000 });
  page.pageErrors = pageErrors;
  return page;
}

function launchOptions() {
  // CI installs Playwright's own Chromium; this container ships one at
  // /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH), which Playwright finds itself.
  return { headless: true };
}

module.exports = { ROOT, sleep, request, startServer, heroToken, openHeroPage, launchOptions };
