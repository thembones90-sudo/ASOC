'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../automation/spectral-schedule');
const A = require('../automation/spectral-adjudicator');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const at = time => Date.parse(`2026-10-17T${time}+02:00`);
function fixture() {
  return { code: 'MASTER', boardId: 'board-1', roomMode: 'CASUAL', timer: { phase: 'ready' }, revision: 0,
    players: new Map(), spectralAdjudicator: A.normalizeState({ mode: 'AUTONOMOUS', scheduleArmed: false }), chat: [] };
}
function vote(room, count) {
  room.players.clear(); room.ritual.joinedPlayerIds = [];
  for (let i = 0; i < count; i++) { const id = 'p' + i; room.players.set({ readyState: 1 }, { id, connected: true }); room.ritual.joinedPlayerIds.push(id); }
}
const frames = [], errors = [];
let writes = 0;
const context = {
  spectralSchedule: S, spectralAdjudicator: A, ROOM_MODES: { CASUAL: 'CASUAL', BATTLE_ARMED: 'BATTLE_ARMED', BATTLE: 'BATTLE' }, NUDGE_MS: 900,
  rooms: new Map(), isMatchResolved: room => !!room.resolved,
  startRitual: room => { room.ritual = { active: true, joinedPlayerIds: [], requiredVotes: 5 }; },
  endRitual: room => { room.ritual.active = false; },
  resetTimer: room => { room.timer = { phase: 'ready' }; },
  addSpectralMessage: (room, text) => { const message = { id: 'msg-' + room.chat.length, text }; room.chat.push(message); return message; },
  persistActiveRooms: () => writes++, broadcastChatUpdate: () => {},
  broadcastToRoom: (room, frame) => frames.push(frame), broadcastPlayersUpdate: () => {}, broadcastRitualState: () => {}, sendSpectralState: () => {},
  getPublicState: room => ({ roomMode: room.roomMode }), sendToWs: (ws, message) => errors.push(message),
  recomputeRitualFulfillment: () => {},
  console: { log() {} }, Date
};
vm.createContext(context);
for (const name of ['startBattleClock', 'handleTimerStart', 'handleRitualJoin', 'announceSpectralSchedule', 'advanceSpectralRitual']) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
}
const tick = (room, time) => context.advanceSpectralRitual(room, at(time));
let room = fixture();
assert.equal(room.spectralAdjudicator.scheduleArmed, true, 'existing Automatic mode enables daily schedule without another ARM click');
assert.equal(tick(room, '12:54:59'), false);
assert.equal(tick(room, '12:55:00'), true);
assert.equal(room.chat[0].text, '@all Adjudicator summons you for a game.');
assert.equal(frames.filter(f => f.type === 'nudge:shake').length, 1);
assert.equal(frames.filter(f => f.type === 'chat:mentionAll').length, 1);
const idleWrites = writes;
tick(room, '12:55:01'); assert.equal(writes, idleWrites, 'no repeated summon or idle writes');
vote(room, 5);
assert.equal(tick(room, '12:59:59'), false, 'never starts early');
room.spectralAdjudicator = A.normalizeState(JSON.parse(JSON.stringify(room.spectralAdjudicator)));
assert.equal(tick(room, '13:00:00'), true, 'starts at 13:00 after recovery');
assert.equal(room.roomMode, 'BATTLE'); assert.equal(room.timer.phase, 'running');
assert.equal(room.spectralAdjudicator.scheduleStatus, 'STARTED');
assert.equal(tick(room, '13:00:01'), false);
room = fixture(); tick(room, '12:55:00'); vote(room, 4);
room.ritual.gmOverride = true; room.ritual.tribute = { status: 'ACCEPTED' };
assert.equal(tick(room, '13:00:00'), false, 'overrides are not five actual votes');
assert.equal(tick(room, '13:04:59'), false);
room.spectralAdjudicator = A.normalizeState(JSON.parse(JSON.stringify(room.spectralAdjudicator)));
assert.equal(tick(room, '13:05:00'), true);
assert.equal(room.roomMode, 'CASUAL'); assert.equal(room.ritual.active, false);
assert.equal(room.chat.at(-1).text, '@all Adjudicator dismissed, not enough players.');
assert.equal(tick(room, '13:05:01'), false, 'cancellation never repeats');
room = fixture(); tick(room, '12:55:00'); vote(room, 4); tick(room, '13:00:00'); vote(room, 5);
assert.equal(tick(room, '13:03:00'), true, 'fifth grace-period vote starts immediately');
room = fixture(); tick(room, '12:55:00'); vote(room, 5);
[...room.players.keys()][0].readyState = 3;
assert.equal(tick(room, '13:00:00'), false, 'disconnected voter does not count');
room.ritual.joinedPlayerIds.push('p1'); assert.equal(S.votes(room), 4, 'duplicates do not count');
for (const change of [{ mode: 'ASSISTED' }, { mode: 'MANUAL' }, { mode: 'AUTONOMOUS', paused: true }, { mode: 'AUTONOMOUS', scheduleDisabled: true }]) {
  const disabled = fixture(); disabled.spectralAdjudicator = A.normalizeState(change);
  assert.equal(tick(disabled, '12:55:00'), false);
}
room = fixture(); assert.equal(tick(room, '13:06:00'), true); assert.equal(room.chat.length, 0, 'missed window never opens a late summon');
room = fixture(); room.resolved = true; tick(room, '12:55:00'); assert.equal(room.chat.length, 0, 'finished board never reused');
room = fixture(); tick(room, '12:55:00'); room.boardId = 'new-board'; tick(room, '13:00:00'); assert.equal(room.roomMode, 'BATTLE_ARMED', 'new GM board is not started or cancelled');
room = fixture(); context.rooms.set('MASTER', room);
context.handleTimerStart({ roomCode: 'MASTER' }); assert.match(errors.at(-1).message, /Only host/, 'wire start remains GM-only');
room = fixture(); tick(room, '12:55:00'); vote(room, 4);
const lateVoter = { roomCode: 'MASTER', readyState: 1 };
room.players.set(lateVoter, { id: 'late-voter', connected: true }); context.rooms.set('MASTER', room);
context.Date = { now: () => at('13:05:00') };
context.handleRitualJoin(lateVoter);
assert.equal(room.roomMode, 'CASUAL');
assert.equal(room.ritual.joinedPlayerIds.includes('late-voter'), false, 'late fifth vote cannot bypass cutoff between scheduler ticks');
assert.equal(S.clock(Date.parse('2026-01-17T11:55:00Z')).minute, 775, 'winter Belgrade time');
assert.equal(S.clock(Date.parse('2026-07-17T10:55:00Z')).minute, 775, 'summer Belgrade time');
console.log('PASS Spectra schedule: 12:55 summon/nudge/@all once; no early start; 13:00 start; grace fifth vote; 13:05 dismissal; connected unique votes, no override bypass; restart dedupe, disabled modes, missed window, board safety, GM wire authority, DST');
