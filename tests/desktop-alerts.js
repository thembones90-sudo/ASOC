const assert = require('assert/strict');

// Fake desktop bridge + a backgrounded window. Set before requiring the
// module, which resolves its root to globalThis outside a browser.
const calls = [];
globalThis.asocDesktop = {
  attention: count => calls.push(['attention', count]),
  notify: payload => calls.push(['notify', payload])
};
let persona = null;
globalThis.sessionStorage = { getItem: key => (key === 'asoc_master_persona' ? persona : null) };
globalThis.document = { visibilityState: 'hidden', hasFocus: () => false };

const alerts = require('../js/asoc-alerts.js');
const notifications = () => calls.filter(([kind]) => kind === 'notify').map(([, payload]) => payload);
const reset = () => { calls.length = 0; alerts.unread = 0; };

// Mentions: full names with spaces, case-insensitive, whole-name only.
assert.equal(alerts.mentionsName('hey @Test Subject look', 'TEST SUBJECT'), true);
assert.equal(alerts.mentionsName('@Ann?', 'Ann'), true);
assert.equal(alerts.mentionsName('@Anna', 'Ann'), false);
assert.equal(alerts.mentionsName('mail me at bob@ann.com', 'ann'), false);
assert.equal(alerts.mentionsName('@a.b', 'a.b'), true, 'regex characters in names are escaped');
assert.equal(alerts.mentionsName('@axb', 'a.b'), false);

// Replies are recognised from the "↳ @Name // excerpt: text" prefix.
assert.equal(alerts.isReplyTo('↳ @Hero42 // is it fire: no, water', 'hero42'), true);
assert.equal(alerts.isReplyTo('↳ @Hero42: sure', 'Hero42'), true);
assert.equal(alerts.isReplyTo('↳ @Other: sure', 'Hero42'), false);
assert.equal(alerts.stripReplyPrefix('↳ @Hero42 // q: answer'), 'answer');

// Little Hero chat: own messages ignored, plain chat only flashes, a mention
// or reply raises one notification, and a burst is summarised.
reset();
alerts.playerChat([{ id: 1, playerId: 'me', playerName: 'Hero42', text: '@Hero42 talking to myself' }], { selfId: 'me', selfName: 'Hero42' });
assert.deepEqual(calls, [], 'own messages never alert');

alerts.playerChat([{ id: 2, playerId: 'p2', playerName: 'Zed', text: 'anyone there?' }], { selfId: 'me', selfName: 'Hero42' });
assert.deepEqual(calls, [['attention', 1]], 'plain chat flashes and badges without a popup');

reset();
alerts.playerChat([
  { id: 3, playerId: 'p2', playerName: 'Zed', text: 'lol' },
  { id: 4, playerId: 'p2', playerName: 'Zed', text: '↳ @Hero42 // fire: it is WATER' }
], { selfId: 'me', selfName: 'Hero42' });
assert.deepEqual(calls[0], ['attention', 2]);
assert.deepEqual(notifications(), [{ title: 'Zed replied to you', body: 'it is WATER', tag: 'chat' }]);

reset();
alerts.playerChat([
  { id: 5, playerId: 'p2', playerName: 'Zed', text: '@Hero42 one' },
  { id: 6, playerId: 'p3', playerName: 'Amy', text: '@hero42 two' }
], { selfId: 'me', selfName: 'Hero42' });
assert.equal(notifications().length, 1, 'a burst becomes one notification');
assert.equal(notifications()[0].title, '2 new mentions and replies');

// @all only counts from the Shadow Broker (it is a host-only command).
reset();
alerts.playerChat([{ id: 7, playerId: 'p2', playerName: 'Zed', text: '@all wake up' }], { selfId: 'me', selfName: 'Hero42' });
assert.equal(notifications().length, 0);
alerts.playerChat([{ id: 8, playerId: null, playerName: 'SHADOW BROKER', source: 'shadowBroker', text: '@all focus' }], { selfId: 'me', selfName: 'Hero42' });
assert.equal(notifications()[0].title, 'SHADOW BROKER mentioned you');

// Game state: the first state is a baseline, then transitions alert once.
reset();
const battle = { roomMode: 'BATTLE', gameWon: false, matchResult: null, wheel: { phase: 'idle', segments: [] } };
alerts.playerState({ ...battle, gameWon: true }, { selfName: 'Hero42' });
assert.deepEqual(calls, [], 'hydrating an already-won game does not alert');
alerts._playerState = null;
alerts.playerState(battle, { selfName: 'Hero42' });
alerts.playerState({ ...battle, gameWon: true }, { selfName: 'Hero42' });
alerts.playerState({ ...battle, gameWon: true }, { selfName: 'Hero42' });
assert.deepEqual(notifications().map(n => n.title), ['GAME WON'], 'GAME WON alerts exactly once');

reset();
alerts.playerState({ ...battle, matchResult: { outcome: 'LOST', occurredAt: 99, message: 'Time exhausted.' } }, { selfName: 'Hero42' });
assert.equal(notifications()[0].title, 'GAME LOST');

reset();
const spin = { phase: 'spinning', segments: ['Zed', 'Hero42'], winnerIndex: 1, spinToken: 't1' };
alerts.playerState({ ...battle, wheel: spin }, { selfName: 'Hero42' });
assert.deepEqual(calls, [], 'no spoiler while the wheel is still spinning');
alerts.playerState({ ...battle, wheel: { ...spin, phase: 'result' } }, { selfName: 'hero42' });
assert.equal(notifications()[0].title, 'THE WHEEL CHOSE YOU');
reset();
alerts.playerState({ ...battle, wheel: { ...spin, phase: 'result', winnerIndex: 0, spinToken: 't2' } }, { selfName: 'Hero42' });
assert.deepEqual(calls, [], 'the wheel landing on someone else does not alert');

reset();
alerts.battleStarting();
assert.equal(notifications()[0].title, 'BATTLE STARTING');

// Shadow Broker: guesses awaiting a verdict win the popup; plain chat only
// flashes; players joining alert after the first roster baseline.
reset();
alerts.gmChat([{ id: 9, playerId: null, source: 'shadowBroker', text: 'my own transmission' }]);
assert.deepEqual(calls, [], 'the GM never alerts on the Broker\'s own messages');
alerts.gmChat([{ id: 10, playerId: 'p2', playerName: 'Zed', text: 'nice', adjudicable: false }]);
assert.deepEqual(calls, [['attention', 1]]);
reset();
alerts.gmChat([
  { id: 11, playerId: 'p2', playerName: 'Zed', text: 'FIRE', adjudicable: true, verdict: null },
  { id: 12, playerId: 'p3', playerName: 'Amy', text: '@broker hurry', adjudicable: false }
]);
assert.deepEqual(notifications(), [{ title: 'Zed is waiting for a verdict', body: 'FIRE', tag: 'verdict' }]);
reset();
alerts.gmChat([{ id: 13, playerId: 'p3', playerName: 'Amy', text: '↳ @SHADOW BROKER // clue: which one?' }]);
assert.equal(notifications()[0].title, 'Amy replied to you');

reset();
alerts.gmPlayers([{ id: 'p2', name: 'Zed' }]);
assert.deepEqual(calls, [], 'the first roster is a baseline');
alerts.gmPlayers([{ id: 'p2', name: 'Zed' }, { id: 'p3', name: 'Amy' }, { id: 'p4', name: 'Off', connected: false }]);
assert.equal(notifications()[0].title, 'Amy joined');
reset();
alerts.gmPlayers([{ id: 'p2', name: 'Zed' }, { id: 'p3', name: 'Amy' }, { id: '__MASTER_TEST__:abc', name: 'TEST SUBJECT' }]);
alerts.gmChat([{ id: 14, playerId: '__MASTER_TEST__:abc', playerName: 'TEST SUBJECT', text: '@broker testing', adjudicable: true }]);
assert.deepEqual(calls, [], 'the GM\'s own Master Mirror persona never alerts the GM');

// Suppression: a focused window or a Master Mirror tab never alerts.
reset();
globalThis.document = { visibilityState: 'visible', hasFocus: () => true };
alerts.battleStarting();
assert.deepEqual(calls, [], 'no alerts while the window is in front');
globalThis.document = { visibilityState: 'hidden', hasFocus: () => false };
persona = 'PLAYER_TEST';
alerts.battleStarting();
assert.deepEqual(calls, [], 'no alerts from a Master Mirror tab');
persona = null;

// clear() resets the badge; no bridge means a silent no-op.
reset();
alerts.battleStarting();
alerts.clear();
assert.deepEqual(calls.at(-1), ['attention', 0]);
delete globalThis.asocDesktop;
reset();
alerts.battleStarting();
assert.deepEqual(calls, [], 'browsers without the desktop bridge are unaffected');

console.log('PASS desktop alerts: mentions, replies, summaries, result/wheel/battle transitions, GM verdicts and joins, suppression');
