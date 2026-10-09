'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('server.js','utf8');
const start=source.indexOf('function isRetiredRageAnnouncement(');
const end=source.indexOf('function getChatState(',start);
assert(start>0&&end>start);
const mocks={};vm.runInNewContext(source.slice(start,end)+'\nthis.isVisibleChatMessage=isVisibleChatMessage;',mocks);
const allowed=mocks.isVisibleChatMessage;
const messages=[
 {source:'shadowBroker',text:'THY SHALL NOT RAGE // A SENT B BACK TO THE YARD.'},
 {source:'shadowBroker',text:'THY SHALL NOT RAGE // A TAKES THE POT: +10 SHADOW COINS.'},
 {source:'shadowBroker',text:'THY SHALL NOT RAGE // A OPENED A TABLE.'},
 {source:'shadowBroker',text:'THY SHALL NOT RAGE // A BROUGHT ALL FOUR HOME AND WINS.'},
 {source:'shadowBroker',text:'IKS OKS // SOMEONE WINS'},
 {source:null,text:'THY SHALL NOT RAGE // player-typed chat'},
 {source:'shadowBroker',text:'Just a normal broker message'},
 {source:'bloodTribute',text:'Secret upload'},
 {source:'shadowBroker',messageType:'chaos',text:'some chaos event'}
];
assert.deepEqual(messages.map(allowed),[false,false,false,false,true,true,true,false,false]);
assert(/function rageCommit\(room, announce = \[\]\)\s*\{\s*\/\/ The RAGE board\/state owns its activity feed\./.test(source));
const body=source.slice(source.indexOf('function rageCommit('),source.indexOf('function rageClose(',source.indexOf('function rageCommit(')));
assert(!body.includes('iksAnnounce'),'RAGE must not create public chat messages');
let settled=false,persisted=false,broadcast=false;
const sandbox={rageSettle:(r,arr)=>{settled=true;arr.push('RAGE WIN')},persistActiveRooms:()=>{persisted=true},broadcastRage:()=>{broadcast=true}};
vm.runInNewContext(body+'\nthis.rageCommit=rageCommit;',sandbox);
sandbox.rageCommit({},['THY SHALL NOT RAGE // CAPTURE']);
assert(settled&&persisted&&broadcast,'state, payout settlement and board updates remain');
for(const pattern of [
 'messages: room.chat.messages.filter(isVisibleChatMessage).slice(-CHAT_RECOVERY_LIMIT)',
 '(Array.isArray(saved.chat.messages) ? saved.chat.messages : []).filter(isVisibleChatMessage)',
 'const all = room.chat.messages.filter(isVisibleChatMessage)',
 'if (isVisibleChatMessage(message) && wanted.has(String(message.id)))',
 'const visibleMessages = room.chat.messages.filter(isVisibleChatMessage)'
])assert(source.includes(pattern),'missing chat path '+pattern);
console.log('RAGE_CHAT_SILENCE_PASS: no new Broker spam, legacy filter across all five paths, payouts and state preserved');
