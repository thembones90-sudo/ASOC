// GM control pass regressions:
//   1. WRONG toggles: neutral -> wrong -> neutral, with no score/ledger residue
//   2. DENY ALL: every unjudged attempt goes WRONG in one server op; a CORRECT
//      attempt, Broker lines and emotes are untouched
//   3. A timer/state tick does not replace a live GM board cell or a chat
//      adjudication control (keyed DOM patch, js/dom-patch.js)
//   4. Gold solution words: case-insensitive, whole-word, multi-word, GM +
//      BATTLE only
//   5. MUTE SOUNDS blocks the central audio engine and unmute restores it
//   6. The Final panel: open -> close -> reopen -> SHOW RESULTS
// Server parts run against a private server on throwaway data.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_GM_CONTROL_TEST_PORT) || 18795;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-gm-control-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ---------------------------------------------------------------------------
// Minimal fake DOM: just enough tree behaviour for DomPatch, plus a template
// "parser" that turns one top-level element string into one fake element.

class FakeNode {
  constructor(tag = 'div', source = '') {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.source = source;
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this._classes = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => this._classes.add(x)),
      remove: (...c) => c.forEach(x => this._classes.delete(x)),
      toggle: (c, on) => { const next = on === undefined ? !this._classes.has(c) : !!on; next ? this._classes.add(c) : this._classes.delete(c); return next; },
      contains: c => this._classes.has(c)
    };
    this._queries = new Map();
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get isConnected() { return !!this.parentNode; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = ref ? this.childNodes.indexOf(ref) : -1;
    if (index === -1) this.childNodes.push(node); else this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter(n => n !== node);
    node.parentNode = null;
    return node;
  }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelectorAll() { return []; }
  querySelector(selector) {
    if (!this._queries.has(selector)) this._queries.set(selector, new FakeNode('button'));
    return this._queries.get(selector);
  }
  set innerHTML(html) { this._html = html; this._queries.clear(); }
  get innerHTML() { return this._html || ''; }
  set textContent(value) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; this._text = value; }
}

function fakeDocument(byId = {}) {
  return {
    createElement(tag) {
      if (tag !== 'template') return new FakeNode(tag);
      const content = new FakeNode('fragment');
      return {
        content,
        set innerHTML(html) {
          const tagName = (html.match(/^<([a-z0-9-]+)/i) || [, 'div'])[1];
          content.appendChild(new FakeNode(tagName, html));
        }
      };
    },
    getElementById: id => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
}

function loadScripts(files, context) {
  vm.createContext(context);
  files.forEach(file => vm.runInContext(read(file), context, { filename: file }));
  return context;
}

// ---------------------------------------------------------------------------
// Client checks (no server needed).

function checkDomPatchAndBoardStability() {
  const document = fakeDocument();
  const ctx = loadScripts(['js/dom-patch.js'], { window: {}, document, module: undefined });
  const DomPatch = ctx.window.DomPatch;

  // Keyed patch keeps unchanged nodes, rebuilds changed ones, honours invalidate().
  const container = new FakeNode();
  DomPatch.patch(container, [{ key: 'a', html: '<p>1</p>' }, { key: 'b', html: '<p>2</p>' }]);
  const [a, b] = container.children;
  let result = DomPatch.patch(container, [{ key: 'a', html: '<p>1</p>' }, { key: 'b', html: '<p>2</p>' }]);
  assert.equal(result.changed, false, 'identical render is a no-op');
  assert.equal(container.children[0], a);
  assert.equal(container.children[1], b);
  result = DomPatch.patch(container, [{ key: 'a', html: '<p>1</p>' }, { key: 'b', html: '<p>2!</p>' }, { key: 'c', html: '<p>3</p>' }]);
  assert.equal(container.children[0], a, 'unchanged sibling survives');
  assert.notEqual(container.children[1], b, 'changed entry is rebuilt');
  assert.equal(result.inserted.length, 2);
  DomPatch.invalidate(a);
  DomPatch.patch(container, [{ key: 'a', html: '<p>1</p>' }, { key: 'b', html: '<p>2!</p>' }, { key: 'c', html: '<p>3</p>' }]);
  assert.notEqual(container.children[0], a, 'an invalidated node is rebuilt');
  DomPatch.patch(container, [{ key: 'c', html: '<p>3</p>' }]);
  assert.equal(container.children.length, 1, 'dropped entries are removed');

  // The GM board: a state tick with nothing changed must keep every cell node.
  const boardCtx = loadScripts(['js/dom-patch.js', 'js/board.js'], {
    window: {},
    document,
    module: undefined,
    GameData: { currentGame: { difficulty: 'GREEN', finalSolution: 'COUNT', columns: {} }, getCellData: (col, row) => `${col}${row}` },
    Skeleton: {
      cellStyle: label => `--slot:${label};`,
      skeletonHTML: () => '<img class="skeleton-img">',
      attach() {}, fit() {},
      shadowBrokerLineState: text => ({ visibleText: text, opacity: 1 }),
      shadowBrokerLineStyle: () => ''
    },
    setInterval: () => 0, clearInterval() {}
  });
  vm.runInContext('this.Board = Board; window.GameData = GameData;', boardCtx);
  const Board = boardCtx.Board;
  Board.escapeHtml = value => String(value);
  Board.container = new FakeNode();
  Board.container.classList.add = () => {};
  Board.resetSessionState();
  Board.render();
  const cellNode = key => Board.container.children.find(n => n.__asocPatchKey === `cell:${key}`);
  const before = { A1: cellNode('A1'), B2: cellNode('B2'), A5: cellNode('A5'), FINAL: cellNode('FINAL') };
  assert.ok(before.A1 && before.FINAL, 'board cells rendered');
  Board.render(); // a timer tick: same state
  Object.entries(before).forEach(([key, node]) => assert.equal(cellNode(key), node, `${key} survives an unchanged tick`));
  Board._brokerLineText = 'THE BROKER SPEAKS';
  Board._brokerLineStartedAt = Date.now();
  Board.render(); // a Broker line frame
  Object.entries(before).forEach(([key, node]) => assert.equal(cellNode(key), node, `${key} survives a Broker line frame`));
  Board.sessionState.cells.A1 = true;
  Board.render();
  assert.notEqual(cellNode('A1'), before.A1, 'a revealed cell is rebuilt');
  assert.equal(cellNode('B2'), before.B2, 'its neighbours are not');
}

function loadApp(extra = {}) {
  const ctx = loadScripts(['js/app.js'], {
    window: {}, console, GameData: {}, Board: {}, CSS: { escape: v => v }, setTimeout: () => 0, clearTimeout() {},
    document: fakeDocument(extra.byId || {}),
    ...extra.globals
  });
  vm.runInContext('this.App = App;', ctx);
  const App = ctx.App;
  App.escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return { App, ctx };
}

function checkAdjudicationControlStability() {
  const { App } = loadApp({ globals: {
    ASOCThemes: { messageStyle: () => '', get: () => ({ id: 'gunmetal' }) },
    Skeleton: { shadowBrokerTransmissionHTML: () => '' }
  } });
  App.littleHeroAvatarHTML = () => '';
  App.createGMReactionSummaryHTML = () => '';
  App.roomMode = 'BATTLE';
  App.currentPlayers = [];
  const msg = { id: 'm1', playerId: 'p1', playerName: 'Hero', text: 'is it ruler', timestamp: 1700000000000, verdict: null, adjudicable: true };
  const first = App.createGMChatMessageHTML(msg, false, 1700000005000);
  const tick = App.createGMChatMessageHTML(msg, false, 1700000006000);
  assert.equal(tick, first, 'an unjudged attempt renders identically across ticks, so its X / heart survive');
  assert.match(first, /class="gm-verdict-btn wrong"/);
  const wrong = App.createGMChatMessageHTML({ ...msg, verdict: 'wrong' }, false, 1700000006000);
  assert.match(wrong, /gm-verdict-btn wrong is-active/, 'a WRONG verdict marks the X as a pressed toggle');
  assert.match(wrong, /aria-pressed="true"/);

  // state:public handling must never rebuild chat (only a real mode change).
  const applyServerState = read('js/app.js').split('  applyServerState(state) {')[1].split('\n  applyGMRevealFlash() {')[0];
  assert.ok(!applyServerState.includes('renderGMChat'), 'state:public must not re-render Battle Comms');
  assert.ok(read('js/board.js').split('  render() {')[1].split('\n  renderInto(')[0].includes('DomPatch.patch(this.container'), 'Board.render must patch, not rebuild');
  assert.ok(/<script src="js\/dom-patch\.js[^"]*"><\/script>\s*<script src="js\/board\.js/.test(read('index.html')), 'the GM page loads DomPatch before the board');

  // WRONG toggle client contract: X on a WRONG message sends 'clear'.
  const sent = [];
  App.mode = 'multiplayer';
  App.send = message => sent.push(message);
  App.chatMessages = [{ id: 'm1', verdict: 'wrong' }, { id: 'm2', verdict: null }];
  App.judgeGuess('m1', 'wrong');
  App.judgeGuess('m2', 'wrong');
  assert.deepEqual(sent.map(m => m.verdict), ['clear', 'wrong']);
}

function checkGoldSolutionMatching() {
  const { App, ctx } = loadApp();
  App.escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const terms = [{ slot: 'A5', term: 'Ruler' }, { slot: 'B5', term: 'ice cream' }, { slot: 'FINAL', term: 'COUNT' }];
  const hits = text => [...App.splitSolutionMatches(text, terms)].filter(s => s.slots).map(s => `${s.text}=${[...s.slots].join('+')}`);
  assert.deepEqual(hits('Could it be ruler?'), ['ruler=A5'], 'case-insensitive, punctuation preserved outside');
  assert.deepEqual(hits('I think the answer is count'), ['count=FINAL']);
  assert.deepEqual(hits('rulers accounting'), [], 'never inside a longer word');
  assert.deepEqual(hits('ICE   CREAM!'), ['ICE   CREAM=B5'], 'multi-word solutions match across spacing');
  assert.deepEqual(hits('https://x.test/ruler @Ruler'), [], 'URLs and @mentions stay intact');
  assert.equal(App.splitSolutionMatches('a <b> ruler', terms).map(s => s.text).join(''), 'a <b> ruler', 'text itself is never altered');

  // gmSolutionTerms reads the GM's loaded board (window.GameData.currentGame).
  ctx.window.GameData = { currentGame: { finalSolution: 'COUNT', columns: { A: { solution: 'RULER' }, B: { solution: '' } } } };
  const html = (mode, text) => {
    App.roomMode = mode;
    return App.gmSolutionHighlightHTML(text);
  };
  assert.equal(html('BATTLE', 'is it <ruler>?'), 'is it &lt;<span class="gm-solution-hit" data-solution="A5">ruler</span>&gt;?', 'escaped first, only the match wrapped');
  assert.equal(html('BATTLE', 'the COUNT'), 'the <span class="gm-solution-hit" data-solution="FINAL">COUNT</span>');
  assert.equal(html('CASUAL', 'is it ruler?'), 'is it ruler?', 'no highlight in AMUSEMENT PARK');
  assert.equal(html('BATTLE_ARMED', 'ruler'), 'ruler', 'no highlight before the battle is live');
  assert.equal(html('RECOUNT', 'count'), 'count', 'no highlight in RECOUNT');

  // GM only: the player client has no highlighter and never sees answers.
  const player = read('js/player.js');
  assert.ok(!player.includes('gm-solution-hit') && !player.includes('splitSolutionMatches'), 'player renderer has no solution highlight');
}

function checkMute() {
  const store = {};
  const created = [];
  function FakeAudioContext() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = {};
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
    const node = () => ({ connect() {}, start() {}, stop() {}, gain: param(), frequency: param(), detune: param(), Q: param(), pan: param() });
    this.createGain = () => node();
    this.createOscillator = () => { created.push('osc'); return node(); };
    this.createBiquadFilter = () => node();
    this.createBufferSource = () => node();
    this.createBuffer = () => ({ sampleRate: 8000, getChannelData: () => new Float32Array(16) });
    this.resume = () => Promise.resolve();
    this.suspend = () => Promise.resolve();
  }
  const makeWindow = () => ({
    AudioContext: FakeAudioContext,
    addEventListener() {},
    dispatchEvent() {}
  });
  const load = () => {
    const ctx = loadScripts(['js/audio.js'], {
      window: makeWindow(),
      localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
      CustomEvent: function (type, init) { this.type = type; this.detail = init?.detail; },
      Math, Float32Array, Promise
    });
    return ctx.window.AsocAudio;
  };
  let audio = load();
  audio.unlock();
  const baseline = created.length;
  audio.correct();
  assert.ok(created.length > baseline, 'sounds play while unmuted');
  audio.setEnabled(false);
  assert.equal(audio.isMuted(), true);
  assert.equal(store.asoc_audio_enabled, '0', 'mute persists');
  let mark = created.length;
  ['gameStart', 'correct', 'columnSolved', 'finalSolved', 'womfCritical', 'borrowedTime', 'omen', 'gameWon', 'gameLost'].forEach(cue => audio[cue]());
  audio.countdown(3);
  assert.equal(created.length, mark, 'muted: no cue creates audio');
  audio = load();
  assert.equal(audio.isMuted(), true, 'mute survives a reload');
  audio.toggleMuted();
  assert.equal(audio.isMuted(), false);
  assert.equal(store.asoc_audio_enabled, '1');
  mark = created.length;
  audio.correct();
  assert.ok(created.length > mark, 'unmute restores sound');
}

function checkFinalPanel() {
  const layer = new FakeNode();
  const reopen = new FakeNode('button');
  const { App } = loadApp({ byId: { 'score-announcement-layer': layer, 'final-panel-reopen-btn': reopen } });
  const sent = [];
  App.send = message => sent.push(message);
  App.updateFailFinalButtonVisibility = () => {};
  App.updateTimerUI = () => {};

  // Hydration (e.g. GM reconnect): results pending, no panel -> END GAME shows.
  App.syncFinalPanelState({ finalResultsPending: true, finalResultsOutcome: 'success' }, true);
  assert.equal(reopen.style.display, '', 'END GAME visible while results are pending');

  App.showFinalReveal({ outcome: 'success' });
  const panel = App._activeFinalBanner;
  assert.ok(panel?.isConnected, 'panel opens on the Final');
  assert.equal(reopen.style.display, 'none', 'END GAME hidden while the panel is open');

  panel.querySelector('.fo-close-btn').click();
  assert.equal(panel.isConnected, false, 'CLOSE hides the panel');
  assert.equal(reopen.style.display, '', 'CLOSE is not a trapdoor: END GAME appears');
  App.syncFinalPanelState({ finalResultsPending: true, finalResultsOutcome: 'success' }, true);
  assert.equal(reopen.style.display, '', 'a later state tick keeps END GAME');

  const reopened = App.openFinalPanel();
  assert.ok(reopened?.isConnected, 'END GAME reopens the panel');
  assert.match(reopened.innerHTML, /SOLUTION CONFIRMED/);
  assert.equal(App.openFinalPanel(), reopened, 'reopening twice never stacks panels');
  reopened.querySelector('.fo-continue-btn').click();
  assert.equal(JSON.stringify(sent), JSON.stringify([{ type: 'gm:revealResults' }]), 'SHOW RESULTS continues the same flow, once');

  App.revealFinalResults({ outcome: 'success', columnsKnownAtSolve: 2, points: 10, playerName: 'Hero' });
  assert.equal(reopen.style.display, 'none', 'released results retire END GAME');
  App.syncFinalPanelState({ finalResultsPending: false }, true);
  assert.equal(App.openFinalPanel(), null, 'nothing to reopen once results are shown');
  App.syncFinalPanelState({ finalResultsPending: true, finalResultsOutcome: 'failed' }, false);
  assert.equal(reopen.style.display, 'none', 'never in CASUAL');
}

// ---------------------------------------------------------------------------
// Server checks.

function api(urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, data: text }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.state = null; this.chat = []; this.players = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const message = JSON.parse(data.toString());
        if (message.type === 'protocol:hello') return this.ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        if (message.type === 'protocol:ready') return resolve(this);
        this.msgs.push(message);
        if (message.type === 'state:public') this.state = message;
        if (message.type === 'chat:update') this.chat = message.messages || [];
        if (message.type === 'players:update') this.players = message.players || [];
        if (message.type === 'join:success') this.playerId = message.playerId;
      });
    });
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  mark() { return this.msgs.length; }
  errorsSince(mark) { return this.msgs.slice(mark).filter(m => m.type === 'error').map(m => m.message); }
  async waitFor(predicate, label, since = 0, timeout = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = this.msgs.slice(since).find(predicate);
      if (found) return found;
      await sleep(20);
    }
    throw new Error(`${this.name}: timed out waiting for ${label}`);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function runServerChecks() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ASOC_DATA_DIR: DATA, ASOC_GM_PASSWORD: 'gm-control-pass', ASOC_EMAIL_VERIFICATION: '0', ASOC_COLUMN_REVEAL_DELAY_MS: '200' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors += chunk; });
  const clients = [];
  try {
    for (let i = 0; i < 60; i++) { try { if ((await api('/health')).status === 200) break; } catch {} await sleep(150); }
    const gmToken = (await api('/api/auth/gm/login', { password: 'gm-control-pass' })).data.token;
    const gm = await new Client('GM').open();
    clients.push(gm);
    gm.send({ type: 'host:recover', gmToken });
    await gm.waitFor(m => m.type === 'host:recovered', 'host recovered');
    const players = [];
    for (let i = 0; i < 5; i++) {
      const token = (await api('/api/auth/player/register', { email: `gm-control-${i}@asoc.test`, password: 'gm-control-password', name: `Control Hero ${i + 1}` })).data.token;
      const player = await new Client(`P${i + 1}`).open();
      clients.push(player);
      player.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name: `Control Hero ${i + 1}` });
      await player.waitFor(m => m.type === 'join:success', `P${i + 1} join`);
      players.push(player);
    }

    // DENY ALL is refused outside a live battle.
    let mark = gm.mark();
    gm.send({ type: 'gm:denyAll' });
    await sleep(300);
    assert.match(gm.errorsSince(mark).join(' '), /only available during a live battle/);

    // Summon Ritual -> live BATTLE with the timer running.
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await sleep(350);
    players.forEach(p => p.send({ type: 'ritual:join' }));
    await gm.waitFor(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5, 'ritual 5/5');
    gm.send({ type: 'gm:timerLaunchCountdown' });
    await sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await sleep(400);
    assert.equal(gm.state.roomMode, 'BATTLE');
    assert.equal(gm.state.finalResultsPending, false);

    const say = async (player, text) => {
      player.send({ type: 'chat:guess', text });
      const update = await gm.waitFor(m => m.type === 'chat:update' && m.messages.some(x => x.text === text), `guess ${text}`);
      await sleep(400); // player chat cooldown
      return update.messages.find(x => x.text === text);
    };
    const verdictOf = id => gm.chat.find(m => m.id === id)?.verdict ?? null;
    const judge = async (messageId, verdict, extra = {}) => {
      const since = gm.mark();
      gm.send({ type: 'gm:judgeGuess', messageId, verdict, ...extra });
      await gm.waitFor(m => m.type === 'gm:judge:ack' || m.type === 'error', `judge ${verdict}`, since);
      await sleep(150);
    };
    const statsOf = async player => {
      const since = player.mark();
      player.send({ type: 'chat:guess', text: '/stats' });
      const update = await player.waitFor(m => m.type === 'chat:update' && m.messages.some(x => x.messageType === 'stats' && x.playerId === player.playerId && x.timestamp >= Date.now() - 3000), '/stats', since);
      await sleep(400);
      return [...update.messages].reverse().find(x => x.messageType === 'stats' && x.playerId === player.playerId).stats;
    };
    const scoreOf = player => gm.players.find(p => p.id === player.playerId)?.score ?? 0;
    const coinsOf = player => gm.players.find(p => p.id === player.playerId)?.shadowCoins ?? 0;
    const settle = () => sleep(300);

    // 1. WRONG toggle: neutral -> wrong -> neutral.
    const alpha = await say(players[0], 'alpha guess');
    assert.equal(alpha.adjudicable, true);
    const scoreBefore = scoreOf(players[0]);
    await judge(alpha.id, 'wrong');
    assert.equal(verdictOf(alpha.id), 'wrong');
    assert.equal((await statsOf(players[0])).failed, 1, 'a WRONG is a ledger attempt');
    await judge(alpha.id, 'clear');
    assert.equal(verdictOf(alpha.id), null, 'pressing X again clears the verdict');
    assert.equal(gm.chat.find(m => m.id === alpha.id).target ?? null, null);
    assert.equal(players[1].chat.find(m => m.id === alpha.id).verdict, null, 'every client sees the cleared verdict');
    assert.equal((await statsOf(players[0])).failed, 0, 'a cleared WRONG is no longer an attempt');
    assert.equal(scoreOf(players[0]), scoreBefore, 'clearing WRONG never awards points');
    mark = gm.mark();
    await judge(alpha.id, 'clear');
    assert.match(gm.errorsSince(mark).join(' '), /Only a WRONG verdict can be cleared/);

    // 2. DENY ALL. Column A gets one clue open first so a solve scores (and
    // pays coins: 1 clue = 1.0 Shadow Coin; an unscorable 0-clue solve pays 0).
    gm.send({ type: 'gm:command', command: 'revealCell', payload: { cell: 'A1', reveal: true }, cmdId: 'gcp-reveal-a1' });
    await sleep(300);
    const bravo = await say(players[1], 'bravo guess');
    const charlie = await say(players[2], 'charlie guess');
    const delta = await say(players[3], 'delta guess');
    await judge(delta.id, 'correct', { target: 'A' });
    assert.equal(verdictOf(delta.id), 'correct');
    // SHADOW COINS: a 1-clue column pays 1.0; correcting the verdict takes it
    // back; re-accepting pays again (never twice for one acceptance).
    await settle();
    assert.equal(coinsOf(players[3]), 1, 'a 1-clue column pays 1.0 Shadow Coin');
    assert.equal(coinsOf(players[1]), 0, 'a WRONG guess pays nothing');
    await judge(delta.id, 'wrong');
    await settle();
    assert.equal(coinsOf(players[3]), 0, 'a corrected verdict takes the coin back');
    await judge(delta.id, 'correct', { target: 'A' });
    await settle();
    assert.equal(coinsOf(players[3]), 1, 're-accepting pays once more');
    await judge(delta.id, 'correct', { target: 'A' });
    await settle();
    assert.equal(coinsOf(players[3]), 1, 'judging the same acceptance again never double-pays');
    players[4].send({ type: 'chat:guess', text: '/poke @Control Hero 1' });
    await gm.waitFor(m => m.type === 'chat:update' && m.messages.some(x => x.messageType === 'emote' && x.emote?.act === 'poke'), 'poke emote');
    await sleep(400);
    gm.send({ type: 'gm:broadcast', text: 'The Broker watches.' });
    await gm.waitFor(m => m.type === 'chat:update' && m.messages.some(x => x.text === 'The Broker watches.'), 'broker line');
    const since = gm.mark();
    gm.send({ type: 'gm:denyAll' });
    const ack = await gm.waitFor(m => m.type === 'gm:denyAll:ack', 'DENY ALL ack', since);
    await sleep(200);
    assert.equal(ack.denied, 3, 'alpha, bravo, charlie denied');
    [alpha, bravo, charlie].forEach(m => assert.equal(verdictOf(m.id), 'wrong', `${m.text} is WRONG`));
    assert.equal(verdictOf(delta.id), 'correct', 'a CORRECT attempt stays CORRECT');
    gm.chat.filter(m => m.source).forEach(m => assert.equal(m.verdict ?? null, null, `${m.source} message untouched`));
    assert.equal(players[2].chat.find(m => m.id === charlie.id).verdict, 'wrong', 'players see DENY ALL');
    const again = gm.mark();
    gm.send({ type: 'gm:denyAll' });
    assert.equal((await gm.waitFor(m => m.type === 'gm:denyAll:ack', 'second ack', again)).denied, 0, 'nothing left to deny');

    // 6. Final results pending is exposed (flag + outcome, never points), and
    // clears once SHOW RESULTS releases them.
    const omega = await say(players[0], 'omega final');
    await judge(omega.id, 'correct', { target: 'FINAL', reveal: true });
    const pendingState = await gm.waitFor(m => m.type === 'state:public' && m.finalResultsPending === true, 'results pending');
    assert.equal(pendingState.finalResultsOutcome, 'success');
    assert.equal(JSON.stringify(pendingState).includes('pendingResults'), false, 'withheld points never leave the server');
    const released = gm.mark();
    gm.send({ type: 'gm:revealResults' });
    await gm.waitFor(m => m.type === 'score:finalResults', 'final results', released);
    await gm.waitFor(m => m.type === 'state:public' && m.finalResultsPending === false, 'results released', released, 4000);
    await gm.waitFor(m => m.type === 'players:update', 'players after results', released);
    await settle();
    assert.equal(coinsOf(players[0]), 5, 'the Final pays +5 Shadow Coins');

    assert.equal(serverErrors.trim(), '', 'no server errors');
  } finally {
    clients.forEach(client => client.close());
    server.kill();
    await sleep(200);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

async function run() {
  checkDomPatchAndBoardStability();
  checkAdjudicationControlStability();
  checkGoldSolutionMatching();
  checkMute();
  checkFinalPanel();
  await runServerChecks();
  console.log('PASS GM control pass: WRONG toggle, DENY ALL, stable board/chat nodes across ticks, gold solution words, MUTE SOUNDS, reopenable Final panel');
}

run().catch(error => {
  console.error('FAIL GM control pass:', error);
  process.exit(1);
});
