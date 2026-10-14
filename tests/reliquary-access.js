'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {hasReliquaryAccess}=require('../reliquary-access');
const now=1_000_000;
for(const ws of [null,undefined,{}, {reliquaryUnlockedUntil:undefined},{reliquaryUnlockedUntil:'garbage'},
 {reliquaryUnlockedUntil:NaN},{reliquaryUnlockedUntil:Infinity},{reliquaryUnlockedUntil:0},
 {reliquaryUnlockedUntil:now-1},{reliquaryUnlockedUntil:now}])
 assert.equal(hasReliquaryAccess(ws,now),false,'locked vault must remain locked');
assert.equal(hasReliquaryAccess({reliquaryUnlockedUntil:now+1},now),true);
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
assert.match(source,/function handleTributeVaultUpdate[\s\S]*?if \(!hasReliquaryAccess\(ws\)\)/);
assert.match(source,/function handleBloodTributeVaultClear[\s\S]*?if \(!hasReliquaryAccess\(ws\)\)/);
const from=source.indexOf('function sendTributeVaultToHost(room) {');
const to=source.indexOf('\n}',from)+2;
assert.ok(from>0&&to>from);
const sent=[];
const sendVault=vm.runInNewContext('('+source.slice(from,to)+')',{
 mirrorTributesToInfostud:()=>{},hasReliquaryAccess,
 getBloodTributeVaultState:()=>({tributes:[{id:'fixture'}]}),
 sendToWs:(ws,payload)=>sent.push(payload)
});
for(const invalid of [undefined,NaN,0,Date.now()-1]){
 sendVault({hostConnection:{reliquaryUnlockedUntil:invalid}});
}
assert.equal(sent.length,0,'reconnecting locked GM must never receive image vault');
sendVault({hostConnection:{gmAuthenticated:true,supportsTributeOnDemand:true,reliquaryUnlockedUntil:Date.now()+600000}});
assert.equal(sent.length,1);
assert.equal(sent[0].type,'tribute:vault');
console.log('PASS Reliquary: missing/expired access denies reads/updates/purge; unlocked GM receives vault');
