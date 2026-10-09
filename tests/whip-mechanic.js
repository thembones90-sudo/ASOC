'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
process.chdir('A:\\ASOC ENGINE');
const market=require('../shadow-market');
const item=market.getItem('cmd-whip');
assert(item&&item.consumable===true&&item.price===6);
assert.equal(market.nextPrice(item,0),6);
assert.equal(market.nextPrice(item,4),6);
const temp=path.resolve('.scratch/whip-test-'+process.pid+'.json');
process.env.ASOC_PLAYERS_FILE=temp;
const store=require('../player-store');
const identity={id:'test-whip-user',name:'Tester'};
try {
 const funded=store.awardShadowCoins(identity,24,'whip-test-fund');
 assert(funded.ok,JSON.stringify(funded));
 const a=store.purchaseCommandCharge(identity,'cmd-whip',6,'charge-1');
 const b=store.purchaseCommandCharge(identity,'cmd-whip',6,'charge-2');
 assert(a.ok&&b.ok);
 assert.equal(store.getShadowProfile(identity).cosmetics.owned['cmd-whip'],2);
 assert.equal(store.getShadowCoins(identity),12);
 assert(store.consumeCommandCharge(identity,'cmd-whip').ok);
 assert(store.consumeCommandCharge(identity,'cmd-whip').ok);
 assert.equal(Number(store.getShadowProfile(identity).cosmetics.owned['cmd-whip'])||0,0);
 assert.equal(store.consumeCommandCharge(identity,'cmd-whip').ok,false);
 assert.equal(store.getShadowCoins(identity),12,'using charge never charges money again');
 assert.equal(store.purchaseCommandCharge(identity,'cmd-whip',6,'charge-1').duplicate,true,'idempotent payment');
 const input=fs.readFileSync('server.js','utf8');
 const from=input.indexOf('const WHIP_HIT_LINES = [');
 const to=input.indexOf('const DROPKICK_COOLDOWN_MS',from);
 assert(from>=0&&to>from,'server whip function present');
 const snippet=input.slice(from,to);
 let accepted=0, consumed=0, sent=[];
 const dice={roll:0};
 const context={
   crypto:{randomInt:(max)=>{const result=dice.roll;dice.roll=0;return result;}},
   resolveNamedTarget:(room, actor, id, query)=>query==='Missing'?{error:'NOT FOUND'}:{target:{id:'target',name:'TARGET'}},
   coinAccount:()=>identity,
   playerStore:{consumeCommandCharge:()=>{consumed++;return {ok:true}}},
   brokerDisplayName:()=> 'SHADOW BROKER',
   publicBrokerProfile:()=>({avatarData:''}),LEGACY_DEFAULT_AVATAR:'missing',
   liveAvatarFor:()=>'',buildChatCommandMessage:(room,author,verb,source,text,meta)=>({success:true,message:{source,text,...meta}}),
   persistActiveRooms:()=>{},broadcastToRoom:(room,event)=>{sent.push(event);}
 };
 vm.createContext(context);
 vm.runInContext(snippet,context);
 for(let i=0;i<100;i++){
  dice.roll=i;
  const result=context.whipCommand({}, {id:'a',name:'ATTACKER'},'/whip @Target','',false);
  assert(result.success);
  const event=sent.pop();
  assert.equal(event.hijacked,i<15,'correct roll split at '+i);
  assert.equal(event.victimId,i<15?'a':'target');
 }
 assert.equal(consumed,100,'one charge per normal or reverse execution');
 assert.equal(context.whipCommand({}, {id:'a',name:'ATTACKER'},'/whip @Missing','',false).success,false);
 assert.equal(consumed,100,'invalid targets do not spend charges');
 console.log('WHIP_MECHANICS_PASS: 15/100 hijacks, no nested counter, one charge per hit, no double charge, no invalid-target debit');
} finally {
 for(const name of [temp,temp+'.bak']){try{fs.unlinkSync(name)}catch{}}
}
