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
  function sendState(room, ws) {
    const who = actor(room, ws);
    if (!who) return;
    const state = game.view(room.tombola, who.id, who.isGm, room.tombolaHistory || []);
    state.serverNow = Date.now();
    const due = requiredTribute(room, who);
    state.requiredTribute = due ? { pactId: due.id } : null;
    if (due) { state.viewer.canJoin = false; state.viewer.canPick = false; }
    deps.sendToWs(ws, { type: 'tombola:state', state });
  }
  function requiredTribute(room, who) {
    if (who.isGm) return null;
    return deps.blackMarket.playerView(deps.blackMarket.normalizeState(room.blackMarket), who.id).pacts.find(p => p.id.startsWith('pact-tombola-') && ['APPROVED_PENDING_TRIBUTE', 'TRIBUTE_REJECTED'].includes(p.state));
  }
  function sendPlayerState(room, playerId) {
    for (const [socket, player] of room.players) if (String(player.id) === String(playerId) && socket.readyState === 1) sendState(room, socket);
  }
  function publish(room) {
    if (room.hostConnection) sendState(room, room.hostConnection);
    for (const socket of room.players.keys()) if (socket.readyState === 1) sendState(room, socket);
  }
  function commit(room) { room.revision++; deps.persist(); publish(room); }
  function handle(ws, message) {
    const room = deps.roomOf(ws);
    if (!room) return deps.sendToWs(ws, { type: 'tombola:error', error: 'JOIN THE MASTER ROOM FIRST' });
    const who = actor(room, ws);
    const fail = error => deps.sendToWs(ws, { type: 'tombola:error', error });
    if (!who) return fail('AUTHENTICATED ACTIVE PLAYER REQUIRED');
    if (message.type === 'tombola:sync') return sendState(room, ws);
    if (requiredTribute(room, who) && ['tombola:join', 'tombola:pick'].includes(message.type)) return fail('SUBMIT YOUR REQUIRED FATEBREAKER BLOOD TRIBUTE FIRST');
    if (['tombola:create', 'tombola:start', 'tombola:skip', 'tombola:cancel'].includes(message.type) && !who.isGm) return fail('FATEBREAKER CONTROL BELONGS TO THE SHADOW BROKER');
    if (message.type === 'tombola:create') {
      if (room.tombola && ['LOBBY', 'PLAYING'].includes(room.tombola.phase)) return fail('A FATEBREAKER ROUND IS ALREADY OPEN');
      if (room.tombola) room.tombolaHistory = [...(room.tombolaHistory || []), game.summary(room.tombola)].slice(-20);
      room.tombola = game.create('tombola-' + crypto.randomBytes(12).toString('hex'));
      commit(room); return;
    }
    const state = room.tombola;
    if (!state || message.roundId !== state.id) return fail('THIS FATEBREAKER ROUND IS NO LONGER CURRENT');
    let result;
    if (message.type === 'tombola:join') result = who.isGm ? { error: 'THE GM WATCHES FATEBREAKER' } : game.join(state, who);
    else if (message.type === 'tombola:leave') result = game.leave(state, who.id);
    else if (message.type === 'tombola:start') {
      const active = [...room.players.entries()].filter(([socket, p]) => socket.readyState === 1 && p.connected !== false && !p.isBot && !p.isSynthetic).map(([, p]) => String(p.id));
      result = game.start(state, active);
    } else if (message.type === 'tombola:skip') result = game.skip(state);
    else if (message.type === 'tombola:cancel') result = game.cancel(state);
    else if (message.type === 'tombola:pick') {
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
        deps.addDennisMessage(room, `@${debtor.name} — ALL 36 VAULTS ARE OPEN. YOUR BLOOD TRIBUTE FROM FIELD ${bloodField} IS NOW REQUIRED. THE BLACK MARKET AWAITS.`);
        deps.syncBlackMarket(room, debtor.id);
        for (const [socket, player] of room.players) if (String(player.id) === debtor.id && socket.readyState === 1) deps.sendToWs(socket, { type: 'blackMarket:tributeDemanded', pact: deps.blackMarket.playerView(room.blackMarket, debtor.id).pacts.find(p => p.id === pact.id) });
        deps.broadcastChatUpdate(room);
      }
      deps.broadcastPlayersUpdate(room);
    } else return fail('UNKNOWN FATEBREAKER ACTION');
    if (!result?.ok) return fail(result?.error || 'FATEBREAKER ACTION REFUSED');
    commit(room);
  }
  return { handle, sendState, sendPlayerState, publish };
}
module.exports = { createTombolaService };
