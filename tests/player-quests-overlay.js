// PLAYER CONTRACT OVERLAYS -- the 1 s tick must not rebuild the overlay
// markup (which swapped ACCEPT / CLAIM buttons out from under a click); it may
// only refresh the countdown text. A real change (status / progress) rebuilds.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'player-quests.js'), 'utf8');

function fakeElement() {
  const clockNode = () => ({ textContent: '' });
  return {
    id: '', className: '', hidden: false, dataset: {}, textContent: '', onclick: null,
    rebuilds: 0, _html: '', _clock: clockNode(),
    set innerHTML(value) { this._html = value; this.rebuilds++; this._clock = clockNode(); },
    get innerHTML() { return this._html; },
    querySelector(selector) { return selector === '[data-q-time]' || selector === '[data-daily-reset]' ? this._clock : null; },
    matches() { return false; }
  };
}

const byId = new Map();
const document = {
  readyState: 'complete',
  body: { appendChild(el) { if (el.id) byId.set(el.id, el); } },
  createElement: () => fakeElement(),
  getElementById: id => byId.get(id) || null,
  addEventListener() {}
};
const sent = [];
const window = { PlayerApp: { send: m => sent.push(m) }, AsocDialog: { alert() {} } };
const context = { window, document, setInterval: () => 0, setTimeout: () => 0, Date, JSON, Math, String, Number, Map, Set };
vm.createContext(context);
vm.runInContext(source, context);

const api = window.PlayerQuests;
assert.ok(api, 'PlayerQuests loads');

// Manual Shadow Contract.
const quest = { id: 'q1', status: 'ACTIVE', directive: 'Hold the line', rewardCoins: 3, durationMs: 600000, deadline: Date.now() + 120000 };
api.update({ active: [quest], history: [] });
api.open(quest);
const overlay = byId.get('player-quest-overlay');
assert.equal(overlay.hidden, false);
const built = overlay.rebuilds;
assert.match(overlay.innerHTML, /CLAIM COMPLETION/);
for (let i = 0; i < 5; i++) api.render();
assert.equal(overlay.rebuilds, built, 'the per-second tick does not rebuild the contract markup');
assert.match(overlay._clock.textContent, /^\d+:\d{2}$/, 'the countdown still updates');

api.update({ active: [{ ...quest, status: 'CLAIMED' }], history: [] });
assert.equal(overlay.rebuilds, built + 1, 'a status change rebuilds once');
assert.match(overlay.innerHTML, /AWAITING SHADOW BROKER/);

// Daily Contracts.
const daily = {
  dayKey: '2026-09-29', resetAt: Date.now() + 3600000, completed: 0, total: 3,
  contracts: [{ id: 'attendance', title: 'ANSWER THE SUMMONS', description: 'x', progress: 1000, target: 300000, unit: 'ms', reward: 1, complete: false }],
  bonus: { complete: false, reward: 2 }
};
api.updateDaily(daily);
api.openDaily();
const dailyOverlay = byId.get('daily-contract-overlay');
const dailyBuilt = dailyOverlay.rebuilds;
for (let i = 0; i < 5; i++) api.renderDaily();
assert.equal(dailyOverlay.rebuilds, dailyBuilt, 'the daily tick does not rebuild unchanged contracts');
assert.match(dailyOverlay._clock.textContent, /^\d{2}:\d{2}:\d{2}$/);
api.updateDaily({ ...daily, contracts: [{ ...daily.contracts[0], progress: 11000 }] });
assert.equal(dailyOverlay.rebuilds, dailyBuilt + 1, 'new progress rebuilds once');

console.log('PASS player contract overlays: countdown ticks update text only; markup rebuilds only on real changes');
