'use strict';
const crypto = require('crypto');
const game = require('./tombola');

function createTombolaService(deps) {
  function actor(room, ws) {
    if (ws === room.hostConnection && ws.gmAuthenticated === true) return { isGm: true, id: '__GM__', name: 'SHADOW BROKER' };
    const player = room.players.get(ws);
    if (!player || player.connected === false || player.id !== ws.playerId || player.isBot || player.isSynthetic) return null;
    return { id: String(player.id), name: player.name, isGm: false };
  }
  function sendState(room, ws, live = false) {
    const who = actor(room, ws);
    if (!who) return;
    const state = game.view(room.tombola, who.id, who.isGm, room.tombolaHistory || []);
    state.serverNow = Date.now();
    const due = requiredTribute(room, who);
    state.requiredTribute = due ? { pactId: due.id } : null;
    if (due) { state.viewer.canJoin = false; state.viewer.canPick = false; }
    deps.sendToWs(ws, { type: 'tombola:state', live, state });
  }
  function requiredTribute(room, who) {
    if (who.isGm) return null;
    return deps.blackMarket.playerView(deps.blackMarket.normalizeState(room.blackMarket), who.id).pacts.find(p => p.id.startsWith('pact-tombola-') && ['APPROVED_PENDING_TRIBUTE', 'TRIBUTE_REJECTED'].includes(p.state));
  }
  function sendPlayerState(room, playerId) {
    for (const [socket, player] of room.players) if (String(player.id) === String(playerId) && socket.readyState === 1) sendState(room, socket);
  }
  function publish(room) {
    if (room.hostConnection) sendState(room, room.hostConnection, true);
    for (const socket of room.players.keys()) if (socket.readyState === 1) sendState(room, socket, true);
  }
  function commit(room) { room.revision++; deps.persist(); publish(room); }
  function tick(room, now = Date.now()) {
    const state = room.tombola;
    if (state?.phase !== 'PLAYING') return false;
    // Grandfather live rounds created before turn clocks existed.
    if (!Number.isFinite(state.turnEndsAt)) {
      state.turnNumber ||= state.reveals.length + 1;
      state.turnEndsAt = now + game.TURN_MS; commit(room); return true;
    }
    if (now < state.turnEndsAt) return false;
    const player = game.current(state);
    if (!player) throw new Error('FATEBREAKER expired turn has no current player');
    const receipt = `${state.id}:${player.id}:timeout-${state.turnNumber}`;
    const paid = deps.playerStore.deductShadowCoins(player, 1, receipt, { reason: 'FATEBREAKER missed 20-second turn -1 SC' });
    if (!paid.ok) throw new Error('FATEBREAKER timeout ledger write failed: ' + (paid.error || 'storage unavailable'));
    const result = game.expire(state, -Number(paid.deducted || 0), now);
    if (!result.ok) throw new Error('FATEBREAKER timeout rejected after ledger validation');
    deps.addDennisMessage(room, `@${player.name} — FATEBREAKER TURN MISSED // −1 SC // ${player.missedTurns}/2 MISSED TURNS${player.kicked ? ' // REMOVED FROM FATEBREAKER' : ''}.`);
    if (state.endReason === 'ALL_PLAYERS_REMOVED') deps.addDennisMessage(room, 'FATEBREAKER CLOSED // ALL PLAYERS MISSED TWO TURNS.');
    if (state.endReason === 'NO_PLAYERS_REMAIN') deps.addDennisMessage(room, 'FATEBREAKER CLOSED // NO ACTIVE PLAYERS REMAIN.');
    deps.broadcastChatUpdate(room); deps.broadcastPlayersUpdate(room);
    commit(room); return true;
  }
  function handle(ws, message) {
    const room = deps.roomOf(ws);
    if (!room) return deps.sendToWs(ws, { type: 'tombola:error', error: 'JOIN THE MASTER ROOM FIRST' });
    const who = actor(room, ws);
    const fail = error => deps.sendToWs(ws, { type: 'tombola:error', error });
    if (!who) return fail('AUTHENTICATED ACTIVE PLAYER REQUIRED');
    // Resolve an expired turn before considering a late selection, even if
    // the periodic clock check has not run yet. Client timestamps are ignored.
    const expiredPlayerId = room.tombola?.phase === 'PLAYING' && Number.isFinite(room.tombola.turnEndsAt) && Date.now() >= room.tombola.turnEndsAt
      ? game.current(room.tombola)?.id : null;
    tick(room);
    if (message.type === 'tombola:pick' && expiredPlayerId === who.id) return fail('YOUR FATEBREAKER TURN HAS EXPIRED');
    if (message.type === 'tombola:sync') return sendState(room, ws);
    if (requiredTribute(room, who) && ['tombola:join', 'tombola:pick'].includes(message.type)) return fail('SUBMIT YOUR REQUIRED FATEBREAKER BLOOD TRIBUTE FIRST');
    if (['tombola:activate', 'tombola:create', 'tombola:start', 'tombola:skip', 'tombola:cancel'].includes(message.type) && !who.isGm) return fail('FATEBREAKER CONTROL BELONGS TO THE SHADOW BROKER');
    // The GM arcade card opens signup in one click. Reopening an active round
    // must not replace it or reset the two-minute deadline.
    if (message.type === 'tombola:activate' && room.tombola && ['LOBBY', 'PLAYING'].includes(room.tombola.phase)) return sendState(room, ws);
    if (message.type === 'tombola:create' || message.type === 'tombola:activate') {
      if (room.tombola && ['LOBBY', 'PLAYING'].includes(room.tombola.phase)) return fail('A FATEBREAKER ROUND IS ALREADY OPEN');
      if (room.tombola) room.tombolaHistory = [...(room.tombolaHistory || []), game.summary(room.tombola)].slice(-20);
      room.tombola = game.create('tombola-' + crypto.randomBytes(12).toString('hex'));
      deps.addDennisMessage(room, 'FATEBREAKER LOBBY IS OPEN // SIGNUP 02:00 // UP TO 10 PLAYERS. JOIN THROUGH THE SUMMON PROMPT OR FATEBREAKER IN MINI GAMES.');
      commit(room); deps.broadcastChatUpdate(room); return;
    }
    const state = room.tombola;
    if (!state || message.roundId !== state.id) return fail('THIS FATEBREAKER ROUND IS NO LONGER CURRENT');
    let result;
    if (message.type === 'tombola:toggle') {
      if (!who.isGm) return fail('ONLY THE SHADOW BROKER MAY TOGGLE FATEBREAKER VISIBILITY');
      state.visible = state.visible === false;
      commit(room);
      return;
    }
    if (message.type === 'tombola:join') result = who.isGm ? { error: 'THE GM WATCHES FATEBREAKER' } : game.join(state, who);
    else if (message.type === 'tombola:leave') {
      result = game.leave(state, who.id);
      if (result.playerLeft) {
        deps.addDennisMessage(room, `@${who.name} — LEFT FATEBREAKER. ${state.phase === 'PLAYING' ? 'THE ROUND CONTINUES WITHOUT THEM.' : 'NO PLAYERS REMAIN // ROUND CLOSED.'}`);
        deps.broadcastChatUpdate(room);
      }
    }
    else if (message.type === 'tombola:start') {
      const active = [...room.players.entries()].filter(([socket, p]) => socket.readyState === 1 && p.connected !== false && !p.isBot && !p.isSynthetic).map(([, p]) => String(p.id));
      result = game.start(state, active);
    } else if (message.type === 'tombola:skip') result = game.skip(state);
    else if (message.type === 'tombola:cancel') result = game.cancel(state);
    else if (message.type === 'tombola:pick') {
      if (message.turnNumber !== undefined && message.turnNumber !== state.turnNumber) return fail('THIS FATEBREAKER TURN HAS ALREADY PASSED');
      const check = game.validatePick(state, who.id, message.field, message.roundId);
      if (!check.ok) return fail(check.error);
      const outcome = check.outcome;
      // No await: validation, wallet change, reveal and obligation all execute
      // in the caller's existing durable transaction before any frame is sent.
      const receipt = `${state.id}:${who.id}:field-${message.field}:${outcome.kind}`;
      let actualAmount = 0;
      if (outcome.kind !== 'BLOOD_TRIBUTE') {
        const reward = outcome.kind === 'BLESSING' || outcome.kind === 'GRAIL';
        const paid = reward
          ? deps.playerStore.awardShadowCoins(who, outcome.amount, receipt, { reason: `FATEBREAKER ${state.id} field ${message.field} ${outcome.kind === 'GRAIL' ? 'THE GRAIL' : 'blessing'} +${outcome.amount}` })
          : deps.playerStore.deductShadowCoins(who, outcome.amount, receipt, { reason: `FATEBREAKER ${state.id} field ${message.field} curse -${outcome.amount}` });
        if (!paid.ok) throw new Error('FATEBREAKER ledger write failed: ' + (paid.error || 'storage unavailable'));
        actualAmount = reward ? outcome.amount : -Number(paid.deducted || 0);
      }
      result = game.reveal(state, who.id, message.field, actualAmount);
      if (!result.ok) throw new Error('FATEBREAKER reveal rejected after ledger validation');
      if (state.phase === 'ENDED') {
        const debtor = state.participants.find(p => p.id === state.tributePlayerId);
        const bloodField = state.reveals.find(r => r.kind === 'BLOOD_TRIBUTE').field;
        room.blackMarket = deps.blackMarket.normalizeState(room.blackMarket);
        const pactId = `pact-${state.id}`;
        let pact = deps.blackMarket.findPact(room.blackMarket, pactId);
        if (!pact) {
          const debt = deps.blackMarket.createGmTributeDebt(room.blackMarket, debtor, { reason: `ASOC FATEBREAKER // FIELD ${bloodField} // ${state.id}`, tributeLevel: 1 });
          if (debt.error || !debt.pact) throw new Error('FATEBREAKER tribute creation failed');
          pact = debt.pact; pact.id = pactId;
        }
        state.tributePactId = pact.id;
        deps.addDennisMessage(room, `@${debtor.name} — BLOOD TRIBUTE REQUIRED. FIELD ${bloodField} HAS ENDED FATEBREAKER. THE BOARD IS SEALED. THE BLACK MARKET AWAITS.`);
        deps.syncBlackMarket(room, debtor.id);
        for (const [socket, player] of room.players) if (String(player.id) === debtor.id && socket.readyState === 1) deps.sendToWs(socket, { type: 'blackMarket:tributeDemanded', pact: deps.blackMarket.playerView(room.blackMarket, debtor.id).pacts.find(p => p.id === pact.id) });
        deps.broadcastChatUpdate(room);
      }
      deps.broadcastPlayersUpdate(room);
    } else return fail('UNKNOWN FATEBREAKER ACTION');
    if (!result?.ok) return fail(result?.error || 'FATEBREAKER ACTION REFUSED');
    commit(room);
  }
  return { handle, sendState, sendPlayerState, publish, tick };
}
module.exports = { createTombolaService };
