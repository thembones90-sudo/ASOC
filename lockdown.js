'use strict';
const ALLOWED = new Set(['room:join', 'chat:guess', 'chat:seen', 'chat:history', 'chat:resync',
  'tribute:submit', 'poison:tributeSubmit', 'blackMarket:tributeSubmit', 'blackMarket:tributeSeen', 'blackMarket:sync']);
function blocksPlayerAction(active, message, isHost) {
  if (!active || isHost) return false;
  if (!ALLOWED.has(message.type)) return true;
  return message.type === 'chat:guess' && (typeof message.text !== 'string' || message.text.trimStart().startsWith('/'));
}
module.exports = { blocksPlayerAction };
