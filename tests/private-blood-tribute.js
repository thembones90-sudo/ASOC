'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('server.js', 'utf8');
const player = fs.readFileSync('js/player.js', 'utf8');
const handler = source.slice(source.indexOf('function handleBloodTributeSubmit('), source.indexOf('function blackMarketRoom(', source.indexOf('function handleBloodTributeSubmit(')));
assert(handler.includes('sendPendingBloodTributeReview(room)'), 'private pending review must reach the GM');
assert(!handler.includes('room.chat.messages.push('), 'no public chat entry on upload');
assert(!handler.includes('broadcastChatUpdate(room)'), 'no public chat broadcast on upload');
assert(handler.includes("private: true"), 'private upload confirmation');
assert(!handler.includes('publicUntil'), 'no public image lifetime');
assert(player.includes('DELIVERED // AWAITING SHADOW BROKER VERDICT'));
const begin = source.indexOf('function getChatState(room) {');
const end = source.indexOf('// Monotonic per-room chat sequence.', begin);
assert(begin >= 0 && end > begin);
const code = source.slice(begin,end);
const context = { createChatSerializer: () => m => ({...m}), CHAT_SNAPSHOT_LIMIT: 200 };
vm.runInNewContext(code, context);
const messages = [
  {id:'public-1', text:'ordinary chat', source:null},
  {id:'private-1',source:'bloodTribute',imageData:'SENSITIVE-IMAGE-DATA'},
  {id:'public-2',text:'ordinary next chat',source:null}
];
const room = {chat:{messages,solvedTargets:{}}};
const result=context.getChatState(room);
assert.equal(result.messages.length,2,'snapshot must exclude tribute card');
assert(!JSON.stringify(result).includes('SENSITIVE-IMAGE-DATA'),'snapshot leaked tribute image');
assert(source.includes("if (message.source !== 'bloodTribute' && message.messageType !== 'chaos' && wanted.has(String(message.id)))"),'delta route must exclude historical tribute cards');
assert(source.includes("const visibleMessages = room.chat.messages.filter(m => m.source !== 'bloodTribute' && m.messageType !== 'chaos');"),'history route must exclude historical tribute cards');
assert(source.includes("messages: room.chat.messages.filter(m => m.source !== 'bloodTribute' && m.messageType !== 'chaos').slice(-CHAT_RECOVERY_LIMIT)"),'durable recovery must purge legacy public tribute cards');
assert(source.includes("messages: (Array.isArray(saved.chat.messages) ? saved.chat.messages : []).filter(m => m?.source !== 'bloodTribute' && m?.messageType !== 'chaos')"),'restored room must purge legacy public tribute cards');
console.log('PRIVATE_BLOOD_TRIBUTE_PASS: upload, vault, receipt, history, snapshot, delta, persisted recovery, restart purge');
