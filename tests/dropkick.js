'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const js = fs.readFileSync('js/dropkick.js','utf8');
const server = fs.readFileSync('server.js','utf8');
const from = server.indexOf('const DROPKICK_COOLDOWN_MS =');
const to = server.indexOf('const TICKLE_COOLDOWN_MS =',from);
assert(from > 0 && to > from);
function mockUi(id, gm, outcome) {
 const nodes = new Map();
 const create = tag => {
   const n = {tag,children:[],style:{setProperty(){}},setAttribute(){},addEventListener(){},remove(){if(n.id)nodes.delete(n.id);},append(...xs){n.children.push(...xs);},appendChild(x){n.children.push(x);return x;},set id(v){n._id=v;nodes.set(v,n);},get id(){return n._id;}};
   return n;
 };
 const document = {createElement:create,getElementById:id=>nodes.get(id),body:{appendChild(n){nodes.set(n.id,n);}}};
 const context = {window:{matchMedia:()=>({matches:false})},document,sessionStorage:{getItem:()=>id},localStorage:{getItem:()=>null},setTimeout:()=>1,clearTimeout(){}};
 vm.runInNewContext(js,context);
 context.window.AsocDropkick.onMessage({type:'dropkick:impact',actorId:gm?'shadow-broker':'p1',actorName:gm?'SHADOW BROKER':'Kicker',actorAvatarData:'data:image/png;base64,AAAA',targetId:'p2',targetName:'Target',targetAvatarData:'data:image/png;base64,BBBB',outcome},id,gm);
 const layer=nodes.get('asoc-dropkick-layer');
 assert(layer);
 const list=[];
 const walk=n=>{list.push(n);(n.children||[]).forEach(walk);};
 walk(layer);
 const victim = layer.className.includes('role-victim');
 if (victim) {
  assert(list.some(n=>n.className==='asoc-dropkick-ball'), 'target portrait ball missing');
  assert(list.filter(n=>n.tag==='img').length >= 2, 'attacker and target avatars must render');
  assert(list.some(n=>n.className==='asoc-dropkick-keeper-leg'),'keeper foot missing');
 } else assert(!list.some(n=>n.className==='asoc-dropkick-ball'), 'spectators must not get full animation');
 if(gm && victim)assert(list.some(n=>n.className==='asoc-dropkick-mech-boot'));
 context.window.AsocDropkick.clear();
 assert(!nodes.get('asoc-dropkick-layer'));
}
mockUi('p2',false,'hit');
mockUi('p2',false,'miss');
mockUi('p1',false,'reflect');
mockUi('p3',false,'hit');
mockUi('shadow-broker',true,'reflect');
function simulate(roll,isGm,twice=false) {
 let clock=100000;
 let broadcast=[];
 const room={dropkickCooldowns:{},players:new Map([['p1',{id:'p1',name:'Kicker'}],['p2',{id:'p2',name:'Target'}]])};
 const c={Date:{now:()=>clock},crypto:{randomInt:()=>roll},liveAvatarFor:(room,id)=>'avatar-'+id,publicBrokerProfile:()=>({avatarData:'gm-avatar'}),LEGACY_DEFAULT_AVATAR:'default',resolveNamedTarget:(room,actorId,id,target)=>({target:room.players.get('p2')}),buildChatCommandMessage:(room,author,type,source,text,payload)=>({success:true,message:{text,...payload}}),persistActiveRooms(){},broadcastToRoom:(room,msg)=>broadcast.push(msg)};
 vm.runInNewContext(server.slice(from,to),c);
 const call=()=>c.dropkickCommand(room,isGm?{id:null,name:'SHADOW BROKER'}:{id:'p1',name:'Kicker'},'/dropkick @Target','',isGm);
 const a=call();assert(a.success);assert.equal(a.message?.dropkick?.outcome, isGm?undefined:a.message.dropkick.outcome);
 assert.equal(broadcast[0].outcome,roll<70?'hit':roll<90?'miss':'reflect');
 assert.equal(broadcast[0].targetAvatarData,'avatar-p2');
 assert.equal(broadcast[0].actorAvatarData,isGm?'gm-avatar':'avatar-p1');
 if(twice){const b=call();assert.equal(b.success,isGm);}
}
simulate(0,false,true);simulate(70,false);simulate(90,false);simulate(99,true,true);
console.log('DROPKICK_TEST_PASS: outcomes, 90s player cooldown, unlimited GM, real-avatar payloads, spectator/attacker/victim/reversal scenes');
