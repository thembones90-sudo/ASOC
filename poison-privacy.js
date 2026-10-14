'use strict';

function poisonView(message, playerId, isHost) {
  if (isHost || !message) return message;
  if (String(message.type || '').startsWith('poison:') && String(message.playerId || '') !== String(playerId || '')) return null;
  if (message.type === 'state:public' && message.poison) {
    const own = message.poison[String(playerId || '')];
    return { ...message, poison: own ? { [String(playerId)]: own } : {} };
  }
  return message;
}
module.exports = { poisonView };
