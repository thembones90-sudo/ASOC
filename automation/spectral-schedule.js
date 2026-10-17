'use strict';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function clock(at) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function votes(room) {
  const joined = new Set((room.ritual?.joinedPlayerIds || []).map(String));
  const connected = new Set();
  for (const [socket, player] of room.players || []) {
    if (socket.readyState === 1 && player.connected !== false && !player.isBot && !player.isSynthetic && !player.isTestPersona && joined.has(String(player.id))) connected.add(String(player.id));
  }
  return connected.size;
}
function decide(room, at, resolved = false) {
  const state = room.spectralAdjudicator;
  if (!state || state.mode !== 'AUTONOMOUS' || state.paused || !state.scheduleArmed || room.lockdown) return null;
  const time = clock(at);
  const pending = state.scheduleStatus === 'SUMMONING';
  if (pending && state.lastScheduledDate !== time.date) return state.scheduleBoardId === room.boardId && room.roomMode === 'BATTLE_ARMED' ? 'CANCEL' : 'ABORT';
  if (state.lastScheduledDate !== time.date) {
    if (time.minute < 775) return null;
    if (time.minute >= 785 || resolved || (room.timer && room.timer.phase !== 'ready') || room.roomMode === 'BATTLE') return 'SKIP';
    return 'SUMMON';
  }
  if (!pending) return null;
  if (state.scheduleBoardId !== room.boardId || resolved || room.roomMode !== 'BATTLE_ARMED' || !room.ritual?.active || room.timer?.phase !== 'ready') return 'ABORT';
  if (time.minute >= 780 && votes(room) >= 5) return 'START';
  if (time.minute >= 785) return 'CANCEL';
  return null;
}
module.exports = { clock, votes, decide };
