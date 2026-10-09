'use strict';

// CHAOS service: connects the pure wager engine (chaos.js) to a live room.
// Everything it needs from server.js arrives through `deps`, so the engine rules stay
// testable on their own and server.js only needs a handful of hook lines.

const chaos = require('./chaos');
const { chaosLine } = require('./chaos-dialogue');

function createChaosService(deps) {
  const {
    crypto, broadcastToRoom, sendToWs, getPublicState, persistActiveRooms, playerStore,
    buildChatCommandMessage, broadcastChatUpdate, broadcastPlayersUpdate, brokerDisplayName,
    sanitizeTributeImageData, sendTributeVaultToHost, requireGmRoom, resolveTarget,
    accountById, connectedPlayers, addRollMessage
  } = deps;

  const announce = (room, text, payload) => {
    const result = buildChatCommandMessage(room, { id: null, name: brokerDisplayName(room) }, 'chaos', 'shadowBroker', text, { chaos: payload || {} });
    if (result?.success) result.message.source = 'shadowBroker';
    return result;
  };

  const broadcastState = room => {
    room.revision++;
    persistActiveRooms();
    broadcastToRoom(room, { type: 'state:public', ...getPublicState(room) });
  };

  const flushChat = room => {
    persistActiveRooms();
    broadcastChatUpdate(room);
  };

  const names = list => list.map(item => item.playerName || item.name).join(', ');
  const coinText = coins => `${coins} SC`;

  const dialogue = (kind, params) => chaosLine(kind, params, n => crypto.randomInt(n));

  // The one place a wager is opened: used by the /chaos command and the Shadow Broker's picker.
  function open(room, targets, stake) {
    const result = chaos.cast(room, targets, stake, Date.now(), brokerDisplayName(room));
    if (!result.ok) return result;
    const first = result.created[0];
    const who = names(result.created);
    const text = dialogue('open', { who, target: first.target, coins: first.coins, seconds: chaos.OFFER_MS / 1000 });
    // Private mechanic: never publish a wager or its stakes into Battle Comms.
    // Targeted players receive their offer through their existing CHAOS modal.
    broadcastState(room);
    return result;
  }

  // "/chaos @Ana @Bea 50 5" or "/chaos all 50 5", typed in the Shadow Broker's chat.
  function gmSlash(room, author, raw) {
    const parsed = chaos.parseCommand(raw);
    if (parsed.error) return { success: false, error: parsed.error };
    let targets = [];
    if (parsed.all) {
      targets = connectedPlayers(room).map(player => ({ id: String(player.id), name: String(player.name) }));
      if (!targets.length) return { success: false, error: 'CHAOS HAS NO TARGETS // NOBODY IS ONLINE' };
    } else {
      for (const name of parsed.names) {
        const resolved = resolveTarget(room, name);
        if (resolved.error) return { success: false, error: resolved.error.replace(/^[A-Z]+ TARGET/, 'CHAOS TARGET') };
        targets.push({ id: String(resolved.target.id), name: String(resolved.target.name) });
      }
    }
    const result = open(room, targets, { target: parsed.target, coins: parsed.coins });
    if (!result.ok) return { success: false, error: result.error };
    // The announcement card was already posted and broadcast; nothing further for the dispatcher to add.
    return { success: true, broadcast: false, handled: true };
  }

  // The Shadow Broker's picker: account ids plus the stake.
  function handleGmCast(ws, message) {
    const room = requireGmRoom(ws);
    if (!room) return;
    const ids = Array.isArray(message?.playerIds) ? message.playerIds.map(String) : [];
    const targets = ids.map(id => accountById(id)).filter(Boolean).map(account => ({ id: String(account.id), name: String(account.name).trim() }));
    if (!targets.length) return sendToWs(ws, { type: 'gm:chaosCastResult', ok: false, error: 'CHAOS TARGETS NOT FOUND' });
    const result = open(room, targets, { target: message?.target, coins: message?.coins });
    if (!result.ok) return sendToWs(ws, { type: 'gm:chaosCastResult', ok: false, error: result.error, skipped: result.skipped || [] });
    sendToWs(ws, { type: 'gm:chaosCastResult', ok: true, created: result.created.map(e => e.playerName), skipped: result.skipped });
  }

  function handleRespond(ws, message) {
    const room = deps.roomOf(ws);
    if (!room || !ws.playerId) return sendToWs(ws, { type: 'error', message: 'CHAOS REQUIRES A LINKED LITTLE HERO' });
    const current = chaos.entryFor(room, ws.playerId);
    const requestId = String(message?.chaosEntryId || '');
    if (requestId && current && String(current.id) !== requestId) return sendToWs(ws, { type: 'chaos:responseError', error: 'CHAOS OFFER HAS CHANGED // REFRESH', chaosEntryId: requestId });
    if (current?.status === 'rolling' && message?.accept === true && (!requestId || String(current.id) === requestId)) {
      return sendToWs(ws, { type: 'chaos:response', playerId: current.playerId, chaosEntryId: current.id, accepted: true, rollEndsAt: current.rollEndsAt });
    }
    const result = chaos.respond(room, ws.playerId, message?.accept === true, Date.now());
    if (!result.ok) return sendToWs(ws, { type: 'chaos:responseError', error: result.error, chaosEntryId: requestId });
    const entry = result.entry;
    sendToWs(ws, { type: 'chaos:response', playerId: entry.playerId, chaosEntryId: entry.id, accepted: result.accepted, rollEndsAt: entry.rollEndsAt });
    // The target has a private response acknowledgment. No public Broker transcript.
    broadcastState(room);
  }

  // A /roll typed (or sent by the ROLL button) by a hero whose wager is live. Returns a chat result, or null if none is owed.
  function onRoll(room, ws, raw) {
    if (!chaos.isRolling(room, ws.playerId)) return null;
    if (!/^\/roll\s*$/i.test(String(raw || ''))) return { success: false, error: 'CHAOS ROLL IS FORCED // USE /roll' };
    const posted = addRollMessage(room, ws.playerId, ws.playerName, { min: 1, max: 100 }, { suppressTribute: true });
    if (!posted.success) return posted;
    const value = Number(posted.message?.roll?.value) || 0;
    const outcome = chaos.resolveRoll(room, ws.playerId, value);
    if (!outcome.ok) return posted;
    const entry = outcome.entry;
    if (outcome.won) {
      const paid = playerStore.awardShadowCoins({ id: entry.playerId, name: entry.playerName }, outcome.payout, `chaos:${entry.id}:win`, { reason: outcome.perfect ? 'CHAOS wager won with a perfect 100 (double)' : 'CHAOS wager won' });
      if (!paid || paid.ok !== false) broadcastPlayersUpdate(room);
      if (paid?.ok === false) sendToWs(ws, { type: 'error', message: 'CHAOS PAYOUT FAILED // CONTACT THE SHADOW BROKER' });
    }
    // Keep only the numerical /roll in public chat. Debt and payout information
    // belong to the target's private CHAOS UI, never the chat message or metadata.
    posted.poisonStateChanged = true; // makes the roll handler re-broadcast state:public
    const resultNotice = { type: 'chaos:result', playerId: entry.playerId, playerName: entry.playerName, value, target: entry.target, coins: entry.coins, won: outcome.won, perfect: !!outcome.perfect, dark: !!outcome.dark, payout: outcome.won ? outcome.payout : 0, timestamp: Date.now() };
    sendToWs(ws, resultNotice);
    if (room.hostConnection?.readyState === 1) sendToWs(room.hostConnection, resultNotice);
    room.revision++;
    persistActiveRooms();
    return posted;
  }

  // Called from the room clock: lapsed offers decline themselves, unrolled wagers forfeit.
  function sweep(room) {
    const events = chaos.sweep(room, Date.now());
    if (!events.length) return false;
    // Timeout changes private state only; no public chat announcement.
    broadcastState(room);
    return true;
  }

  function handleTributeSubmit(ws, message) {
    const room = deps.roomOf(ws);
    if (!room || !ws.playerId) return sendToWs(ws, { type: 'error', message: 'CHAOS TRIBUTE REQUIRES A LITTLE HERO' });
    const entry = chaos.entryFor(room, ws.playerId);
    if (!entry || !['owes', 'judging'].includes(entry.status)) return sendToWs(ws, { type: 'error', message: 'NO CHAOS TRIBUTE IS OWED' });
    if (message?.retentionAcknowledged !== true) return sendToWs(ws, { type: 'error', message: 'Tribute archive notice must be acknowledged' });
    const imageData = sanitizeTributeImageData(message?.imageData);
    if (!imageData) return sendToWs(ws, { type: 'error', message: 'Invalid tribute image or file too large' });
    const now = Date.now();
    const tribute = {
      id: 'tribute-' + crypto.randomBytes(8).toString('hex'),
      playerId: entry.playerId,
      playerName: entry.playerName,
      source: 'chaos',
      dark: entry.dark === true,
      chaosEntryId: entry.id,
      imageData,
      submittedAt: now,
      publicUntil: 0,
      pendingJudgment: true
    };
    room.bloodTributes ||= [];
    if (entry.status === 'judging') {
      const previous = room.bloodTributes.find(item => item.id === entry.pendingTributeId);
      if (previous) { previous.pendingJudgment = false; previous.supersededBy = tribute.id; }
      entry.pendingTributeId = tribute.id;
    } else {
      const moved = chaos.submitTribute(room, ws.playerId, tribute.id);
      if (!moved.ok) return sendToWs(ws, { type: 'error', message: moved.error });
    }
    room.bloodTributes.push(tribute);
    broadcastState(room);
    if (room.hostConnection?.readyState === 1) {
      sendToWs(room.hostConnection, { type: 'chaos:tributeOffered', tributeId: tribute.id, playerId: entry.playerId, playerName: entry.playerName, target: entry.target, roll: entry.roll, dark: entry.dark === true, imageData, timestamp: now });
    }
    sendToWs(ws, { type: 'chaos:tributeSent', tributeId: tribute.id });
    sendTributeVaultToHost(room);
  }

  function handleTributeDecision(ws, message) {
    const room = requireGmRoom(ws);
    if (!room) return;
    const playerId = String(message?.playerId || '');
    const entry = chaos.entryFor(room, playerId);
    if (!entry || entry.status !== 'judging') return sendToWs(ws, { type: 'error', message: 'NO CHAOS TRIBUTE AWAITS JUDGMENT' });
    if (message?.tributeId && String(message.tributeId) !== String(entry.pendingTributeId)) return sendToWs(ws, { type: 'error', message: 'TRIBUTE HAS BEEN REPLACED // REFRESH THE OFFER' });
    const tribute = (room.bloodTributes || []).find(item => item.id === entry.pendingTributeId);
    const accepted = message?.accepted === true;
    const judged = chaos.judge(room, playerId, accepted);
    if (!judged.ok) return sendToWs(ws, { type: 'error', message: judged.error });
    if (tribute) {
      tribute.pendingJudgment = false;
      tribute.judgedAt = Date.now();
      tribute.accepted = accepted;
    }
    // A blood tribute judgment is PRIVATE. Never create a public chat card or broadcast the decision.
    const decision = { type: 'chaos:tributeDecision', playerId, accepted, tributeId: tribute?.id || entry.pendingTributeId };
    sendToWs(ws, decision); // GM confirmation
    for (const [playerSocket, player] of room.players || []) {
      if (String(player?.id) === playerId) sendToWs(playerSocket, decision);
    }
    broadcastState(room);
    sendTributeVaultToHost(room);
  }

  // The Shadow Broker can withdraw an offer or forgive a debt.
  function handleGmCancel(ws, message) {
    const room = requireGmRoom(ws);
    if (!room) return;
    const result = chaos.cancel(room, String(message?.playerId || ''));
    if (!result.ok) return sendToWs(ws, { type: 'error', message: result.error });
    announce(room, `${brokerDisplayName(room)} WITHDRAWS ${result.entry.playerName}'S CHAOS ENTRY.`, { playerId: result.entry.playerId, withdrawn: true });
    broadcastState(room);
    flushChat(room);
  }

  // A Shadow Broker who reconnects (or opens late) asks for any tributes still awaiting judgment.
  function handleGmPending(ws) {
    const room = requireGmRoom(ws);
    if (!room) return;
    for (const entry of Object.values(chaos.ensure(room).entries)) {
      if (entry.status !== 'judging') continue;
      const tribute = (room.bloodTributes || []).find(item => item.id === entry.pendingTributeId);
      if (!tribute?.imageData) continue;
      sendToWs(ws, { type: 'chaos:tributeOffered', tributeId: tribute.id, playerId: entry.playerId, playerName: entry.playerName, target: entry.target, roll: entry.roll, dark: entry.dark === true, imageData: tribute.imageData, timestamp: tribute.submittedAt || Date.now(), replayed: true });
    }
  }

  return {
    publicState: room => chaos.publicState(room),
    gmSlash, handleGmCast, handleRespond, onRoll, sweep,
    handleTributeSubmit, handleTributeDecision, handleGmCancel, handleGmPending,
    hasEntries: room => !!room?.chaos && Object.keys(room.chaos.entries || {}).length > 0
  };
}

module.exports = { createChaosService };
