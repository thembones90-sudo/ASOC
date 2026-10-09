'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const d=require('../dragon-raid');const {createDragonRaidService}=require('../dragon-raid-server');let checks=0;
const eq=(a,b,m)=>{checks++;assert.equal(a,b,m)};const ok=(v,m)=>{checks++;assert.ok(v,m)};
const seq=values=>{let i=0;return()=>values[Math.min(i++,values.length-1)]};
function raid(boss='wendigo',roles=['tank','heal','dps']){const r=d.createRaid(1000,boss);roles.forEach((role,i)=>d.join(r,{id:'p'+i,name:'P'+i},role));return r}
function bossReady(boss='wendigo',roles=['tank','heal','dps']){const r=raid(boss,roles);d.startBattle(r,2000);r.phase='BOSS_TURN';r.activePlayerId=null;return r}

(()=>{const ids=['wendigo','hym','hydra','necromorph','deathwing'];ids.forEach(id=>ok(d.BOSSES[id],id));eq(d.NORMAL_BOSSES.join(','),'wendigo,hym,hydra,necromorph');const r=d.createRaid(1000);eq(r.boss.id,'wendigo');eq(r.dragonHp,100);eq(r.recruitEndsAt,121000)})();

(()=>{const r=raid();eq(r.participants.p0.maxHp,15);eq(r.participants.p1.resurrectionCharges,2);eq(d.canStart(r),true);eq(d.startBattle(r,2000).ok,true);eq(r.phase,'HERO_TURN');eq(r.activePlayerId,'p0');eq(r.battleEndsAt,602000);let x=d.heroAction(r,'p1','attack','',20);eq(x.ok,false);x=d.heroAction(r,'p0','attack','',8);eq(x.damage,4);eq(r.activePlayerId,'p1')})();

(()=>{const r=d.createRaid(0,'deathwing');eq(r.dragonHp,150);['tank','heal','dps','dps'].forEach((role,i)=>d.join(r,{id:'x'+i,name:'X'},role));eq(d.canStart(r),false);ok(/EXACTLY FIVE/.test(d.startBattle(r).error));d.join(r,{id:'x4',name:'X'},'dps');eq(d.canStart(r),true)})();

(()=>{const r=bossReady('wendigo');r.participants.p2.hp=4;let x=d.bossAction(r,4,()=>0);eq(x.skill,'FERAL LUNGE');eq(x.damage,5);eq(r.participants.p2.hp,0);eq(r.participants.p2.alive,false)})();
(()=>{const r=bossReady('wendigo');let x=d.bossAction(r,15,()=>.9);eq(x.skill,'DRAG INTO THE DARK');eq(x.damage,3);const q=r.participants[x.targets[0]];eq(q.statuses.isolated,true)})();
(()=>{const r=bossReady('wendigo');r.participants.p2.hp=4;let x=d.bossAction(r,20,seq([0,0]));eq(x.skill,'WHITE SILENCE');eq(x.damage,3);eq(r.participants.p2.statuses.isolated,true);eq(r.participants.p2.statuses.prey,true)})();

(()=>{const r=bossReady('hydra');let x=d.bossAction(r,4,()=>0);eq(x.skill,'MANY-HEADED BITE');eq(x.targets.length,2);eq(x.damage,3);/* tank armor trims one bite */})();
(()=>{const r=bossReady('hydra');let x=d.bossAction(r,15,()=>.9);eq(x.skill,'VENOM SPIT');eq(x.damage,4);eq(r.participants[x.targets[0]].statuses.poisoned,2)})();
(()=>{const r=bossReady('hydra');r.dragonHp=80;r.boss.hp=80;let x=d.bossAction(r,20,seq([.9,.9]));eq(x.skill,'VENOM FLOOD');eq(x.healed,4);eq(r.dragonHp,84);eq(Object.values(r.participants).filter(p=>p.statuses.poisoned).length,2)})();
(()=>{const r=bossReady('hydra');r.dragonHp=40;r.boss.hp=40;let x=d.bossAction(r,20,seq([0,0]));eq(x.healed,7);eq(r.dragonHp,47)})();

(()=>{const r=bossReady('hym');let x=d.bossAction(r,4,seq([0,0]));eq(x.skill,'WHISPER OF GUILT');const id=x.targets[0];eq(r.participants[id].statuses.guilt,true);r.phase='HERO_TURN';r.activePlayerId=id;r.turnIndex=r.order.indexOf(id);r.dragonHp=90;r.boss.hp=90;const before=r.participants[id].hp;x=d.heroAction(r,id,'attack','',2);eq(r.participants[id].hp,before-2);eq(r.dragonHp,93);eq(r.participants[id].statuses.guilt,false)})();
(()=>{const r=bossReady('hym');let x=d.bossAction(r,15,seq([.9,.9]));eq(x.skill,'SHADOW GRASP');const id=x.targets[0];eq(r.participants[id].statuses.haunted,true)})();
(()=>{const r=raid('hym',['dps','heal','dps']);d.startBattle(r);r.dragonHp=90;r.boss.hp=90;let x=d.heroAction(r,'p0','attack','',1);eq(r.dragonHp,92);eq(x.result,'fumble')})();
(()=>{const r=bossReady('hym');r.dragonHp=80;r.boss.hp=80;let x=d.bossAction(r,20,seq([0,.9]));eq(x.skill,'THE SHADOW WITHIN');eq(x.damage,3);eq(x.healed,2);eq(r.dragonHp,82);eq(Object.values(r.participants).filter(p=>p.statuses.guilt).length,1);eq(Object.values(r.participants).filter(p=>p.statuses.haunted).length,1)})();

(()=>{const r=bossReady('necromorph');let x=d.bossAction(r,4,()=>0);eq(x.skill,'SCYTHE REND');eq(x.damage,3);/* tank armor */})();
(()=>{const r=bossReady('necromorph');let x=d.bossAction(r,15,()=>0);eq(x.skill,'SCYTHE REND');eq(x.damage,5);eq(r.participants[x.targets[0]].statuses.shredded,true)})();
(()=>{const r=bossReady('necromorph');let x=d.bossAction(r,15,()=>.9);eq(x.skill,'VENT AMBUSH');eq(x.targets.length,2);eq(x.damage,6);eq(Object.values(r.participants).filter(p=>p.statuses.shredded).length,1)})();
(()=>{const r=bossReady('necromorph',['dps','dps','dps']);let x=d.bossAction(r,20,()=>0);eq(x.skill,'ABERRANT FRENZY');eq(x.damage,6);eq(r.boss.frenzy,true);r.phase='BOSS_TURN';x=d.bossAction(r,4,()=>0);eq(x.skill,'SCYTHE REND');eq(x.damage,5);eq(r.boss.frenzy,false)})();
(()=>{const r=bossReady('necromorph',['dps','dps','dps']);r.dragonHp=49;r.boss.hp=49;let x=d.bossAction(r,4,seq([0,0]));eq(x.skill,'SCYTHE REND');eq(x.damage,5);ok(x.targets.length>=2);})();

(()=>{const r=raid('hydra');d.startBattle(r);r.participants.p2.statuses.poisoned=1;d.heroAction(r,'p0','attack','',1);d.heroAction(r,'p1','attack','',1);eq(r.activePlayerId,'p2');eq(r.participants.p2.hp,9);eq(r.participants.p2.statuses.poisoned,0)})();
(()=>{const r=raid('hydra');d.startBattle(r);r.participants.p2.statuses.poisoned=2;d.heroAction(r,'p0','attack','',1);d.heroAction(r,'p1','attack','',1);eq(r.activePlayerId,'p2');eq(r.participants.p2.hp,8);eq(r.participants.p2.statuses.poisoned,0)})();

(()=>{const r=raid('wendigo');d.startBattle(r);r.participants.p0.statuses.isolated=true;r.participants.p0.hp=10;d.heroAction(r,'p0','attack','',8);eq(r.participants.p0.statuses.isolated,false)})();

(()=>{const r=bossReady('wendigo');r.dragonHp=4;r.boss.hp=4;r.participants.p0.statuses.taunt=true;r.participants.p0.statuses.shieldNegate=true;r.participants.p0.statuses.shieldReflect=4;const x=d.bossAction(r,4,()=>0);eq(x.reflected,4);eq(r.dragonHp,0);eq(r.phase,'VICTORY')})();

(()=>{eq(d.weightedLoot(()=>.995),500);const s=d.splitLoot(307,['a','b','c','d'],()=>0);eq(Object.values(s).reduce((a,b)=>a+b,0),307);const h=d.heartRound(['a','b'],()=>.41);eq(h.winner,null);eq(h.tied.length,2)})();

(()=>{let broadcasts=0;const service=createDragonRaidService({playerStore:{applyDragonRaidResults:()=>({ok:true})},coinAccount:()=>null,triggerMegabonk:()=>({ok:true}),broadcastToRoom:()=>{broadcasts++},broadcastPlayersUpdate:()=>{},sendToWs:()=>{},randomInt:a=>a});const room={dragonRaid:raid('wendigo')};d.startBattle(room.dragonRaid);const x=service.abort(room);eq(x.ok,true);eq(room.dragonRaid.phase,'ABORTED');eq(room.dragonRaid.result.reason,'GM_CANCELLED');ok(broadcasts>0)})();

(()=>{const service=createDragonRaidService({playerStore:{applyDragonRaidResults:()=>({ok:true})},coinAccount:()=>null,triggerMegabonk:()=>({ok:true}),broadcastToRoom:()=>{},broadcastPlayersUpdate:()=>{},sendToWs:()=>{},randomInt:a=>a});const room={dragonRaid:d.createRaid(1000,'hydra')};['tank','heal','dps','dps','dps'].forEach((role,i)=>service.handle(room,{playerId:'m'+i},{id:'m'+i,name:'M'+i},{type:'dragon:join',role}));eq(room.dragonRaid.phase,'RECRUITING');eq(room.dragonRaid.order.length,5);eq(service.begin(room),true);eq(room.dragonRaid.phase,'HERO_TURN')})();

(()=>{const service=createDragonRaidService({playerStore:{applyDragonRaidResults:()=>({ok:true})},coinAccount:()=>null,triggerMegabonk:()=>({ok:true}),broadcastToRoom:()=>{},broadcastPlayersUpdate:()=>{},sendToWs:()=>{},randomInt:a=>a});const room={dragonRaid:d.createRaid(1000,'deathwing')};['tank','heal','dps','dps'].forEach((role,i)=>d.join(room.dragonRaid,{id:'d'+i,name:'D'+i},role));eq(service.begin(room),false);eq(room.dragonRaid.phase,'RECRUITING');d.join(room.dragonRaid,{id:'d4',name:'D4'},'dps');eq(service.begin(room),true);eq(room.dragonRaid.phase,'HERO_TURN')})();

(()=>{let heartAwards=0;const service=createDragonRaidService({playerStore:{applyDragonRaidResults:entries=>{heartAwards+=entries.some(x=>x.heart===1)?1:0;return{ok:true}}},coinAccount:id=>({id}),triggerMegabonk:()=>({ok:true}),broadcastToRoom:()=>{},broadcastPlayersUpdate:()=>{},sendToWs:()=>{},randomInt:a=>a});const room={dragonRaid:raid('hydra')};const r=room.dragonRaid;r.phase='HEART';r.heart={round:1,contenders:['p0','p1','p2'],rolls:{p0:56,p1:73},history:[],invalidated:[],winnerId:null,winnerName:null,forfeited:false,endsAt:Date.now()+30000};service.resolveHeartRound(room,true);eq(r.phase,'COMPLETE');eq(r.heart.winnerId,'p1');ok(r.heart.invalidated.includes('p2'));eq(heartAwards,1)})();

(()=>{const service=createDragonRaidService({playerStore:{applyDragonRaidResults:()=>({ok:true})},coinAccount:()=>null,triggerMegabonk:()=>({ok:true}),broadcastToRoom:()=>{},broadcastPlayersUpdate:()=>{},sendToWs:()=>{},randomInt:a=>a});const room={dragonRaid:raid('hydra')};const r=room.dragonRaid;r.phase='HEART';r.heart={round:1,contenders:['p0','p1','p2'],rolls:{},history:[],invalidated:[],winnerId:null,winnerName:null,forfeited:false,endsAt:Date.now()+30000};service.resolveHeartRound(room,true);eq(r.phase,'COMPLETE');eq(r.heart.winnerId,null);eq(r.heart.winnerName,'UNCLAIMED');eq(r.heart.forfeited,true);eq(r.heart.invalidated.length,3)})();

(()=>{const service=createDragonRaidService({playerStore:{applyDragonRaidResults:()=>({ok:true})},coinAccount:()=>null,triggerMegabonk:()=>({ok:true}),broadcastToRoom:()=>{},broadcastPlayersUpdate:()=>{},sendToWs:()=>{},randomInt:a=>a});const room={dragonRaid:raid('hydra')};const r=room.dragonRaid;r.phase='HEART';r.heart={round:1,contenders:['p0','p1','p2'],rolls:{p0:88,p1:88},history:[],invalidated:[],winnerId:null,winnerName:null,forfeited:false,endsAt:Date.now()+30000};service.resolveHeartRound(room,true);eq(r.phase,'HEART');eq(r.heart.round,2);eq(r.heart.contenders.join(','),'p0,p1');ok(r.heart.invalidated.includes('p2'));eq(Object.keys(r.heart.rolls).length,0);ok(r.heart.endsAt>Date.now());service.clearTimers(r)})();

(()=>{const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),service=fs.readFileSync(path.join(__dirname,'..','dragon-raid-server.js'),'utf8'),client=fs.readFileSync(path.join(__dirname,'..','js','dragon-raid.js'),'utf8');ok(/case 'dragon:action'/.test(src));ok(/r\.phase==='VICTORY'\)return queueVictory\(room\)/.test(service));ok(/r\.boss\.heroic\?'CATACLYSM':'TIME_EXPIRED'/.test(service));ok(/reason === 'CATACLYSM'/.test(client));ok(/CABINET OF CURIOSITIES/.test(client));ok(/WENDIGO/.test(client));ok(/HYM/.test(client));ok(/HYDRA/.test(client));ok(/NECROMORPH/.test(client));ok(/animateCombat\(result\)/.test(client));ok(/is-venom-flood/.test(client));ok(/ABERRANT FRENZY/.test(client));ok(/WHITE SILENCE/.test(client));ok(/THE SHADOW WITHIN/.test(client));ok(/dragon-attack-trail/.test(client));ok(/dragon-status-chips/.test(client));ok(/dragon-float-text/.test(client));ok(/SWAMP VIGOR AWAKENED/.test(client));ok(/is-targeted-/.test(client));ok(/dragon-passive-badge/.test(client));ok(/dragon-active-lane/.test(client));ok(/updateActiveLane/.test(client));ok(/SPECIMEN TERMINATED/.test(client));ok(/is-boss-dying/.test(client));ok(/is-hero-dying/.test(client));ok(/dragon-arena-atmosphere/.test(client));ok(/phaseCue\(skill, 'attack'\)/.test(client));ok(/SHADOW BROKER OBSERVER/.test(client));ok(/data-dragon-action=\"start\"/.test(client));ok(/START RAID NOW/.test(client));ok(/action:\s*'start'/.test(client));ok(/gmAction === 'start'/.test(src));ok(/getDragonRaidService\(\)\.begin/.test(src));ok(/data-dragon-action=\"cancel\"/.test(client));ok(/action:\s*'cancel'/.test(client));ok(/getDragonRaidService\(\)\.abort/.test(src));ok(!/AZHRAAK/.test(client));ok(!/DRAZHUL/.test(client));ok(!/VARKHUL/.test(client));ok(!/KRAEVAR/.test(client))})();


/* ===== Cabinet avatars, specimen portraits and the server-authoritative 30s hero turn ===== */
const AV='/avatars/'+'a1b2c3d4'.repeat(4)+'.webp';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function svc(sent=[]){return createDragonRaidService({playerStore:{applyDragonRaidResults:()=>({ok:true})},coinAccount:()=>null,triggerMegabonk:()=>({ok:true}),broadcastToRoom:(room,m)=>sent.push(m),broadcastPlayersUpdate:()=>{},sendToWs:(ws,m)=>{(ws.sent=ws.sent||[]).push(m)},randomInt:a=>a})}
function started(boss='wendigo',roles=['tank','heal','dps'],now=1000){const r=d.createRaid(0,boss);roles.forEach((role,i)=>d.join(r,{id:'p'+i,name:'P'+i},role));const x=d.startBattle(r,now);eq(x.ok,true);return r}

(()=>{ // avatars survive join -> publicView; hostile / oversized values never reach the public state
 const r=d.createRaid(0,'hydra');
 d.join(r,{id:'a',name:'A',avatarData:AV,frameColor:'#12ab34'},'tank');
 d.join(r,{id:'b',name:'B',avatarData:'javascript:alert(1)',frameColor:'red'},'heal');
 d.join(r,{id:'c',name:'C',avatarData:'data:image/png;base64,AAAA'},'dps');
 d.join(r,{id:'e',name:'E',avatarData:'/avatars/../../etc/passwd.png'},'dps');
 d.join(r,{id:'f',name:'F',avatarData:'assets/transmog/default/avatar.webp'},'dps');
 const v=d.publicView(r).participants;
 eq(v[0].avatarData,AV);eq(v[0].frameColor,'#12ab34');
 eq(v[1].avatarData,'');eq(v[1].frameColor,'#9B5DE0');eq(v[2].avatarData,'');eq(v[3].avatarData,'');
 eq(v[4].avatarData,'assets/transmog/default/avatar.webp');
 d.startBattle(r,5000);eq(d.publicView(r).participants[0].avatarData,AV)})();

(()=>{ // the live join path (service) hands the real player's avatar to the engine
 const room={dragonRaid:d.createRaid(0,'wendigo')},s=svc();
 s.handle(room,{playerId:'m0'},{id:'m0',name:'M0',avatarData:AV,frameColor:'#ff8800'},{type:'dragon:join',role:'tank'});
 const p=room.dragonRaid.participants.m0;eq(p.avatarData,AV);eq(p.frameColor,'#ff8800');eq(d.publicView(room.dragonRaid).participants[0].avatarData,AV)})();

(()=>{ // a 30s server deadline exists the moment HERO_TURN starts - same rule for normal bosses and Deathwing
 eq(d.HERO_TURN_MS,30000);
 [['wendigo',['tank','heal','dps']],['hydra',['tank','heal','dps','dps']],['deathwing',['tank','heal','dps','dps','dps']]].forEach(([boss,roles])=>{
  const r=d.createRaid(0,boss);eq(r.heroTurnEndsAt,null);roles.forEach((role,i)=>d.join(r,{id:'p'+i,name:'P'+i},role));eq(r.heroTurnEndsAt,null);
  d.startBattle(r,10000);eq(r.phase,'HERO_TURN');eq(r.heroTurnEndsAt,40000);const v=d.publicView(r);eq(v.heroTurnEndsAt,40000);eq(v.heroTurnMs,30000)})})();

(()=>{ // acting resets the clock for the NEXT hero; the old deadline is replaced, never extended
 const r=started('wendigo',['tank','heal','dps'],1000);eq(r.heroTurnEndsAt,31000);
 let x=d.heroAction(r,'p0','attack','',8,9000);eq(x.ok,true);eq(r.activePlayerId,'p1');eq(r.heroTurnEndsAt,39000);
 x=d.heroAction(r,'p1','attack','',8,12000);eq(r.activePlayerId,'p2');eq(r.heroTurnEndsAt,42000);
 x=d.heroAction(r,'p0','attack','',8,13000);eq(x.ok,false);eq(r.heroTurnEndsAt,42000)})();

(()=>{ // timeout advances exactly one hero and costs nothing; hero balance is untouched
 const r=started('hydra',['dps','heal','dps'],1000);r.participants.p0.cooldowns.execute=0;const hp=r.dragonHp;r.participants.p0.statuses.isolated=true;
 const x=d.forfeitTurn(r,'p0',5000);eq(x.ok,true);eq(x.action,'timeout');eq(x.result,'timeout');eq(x.damage,0);eq(x.healing,0);
 eq(r.activePlayerId,'p1');eq(r.turnIndex,1);eq(r.phase,'HERO_TURN');eq(r.heroTurnEndsAt,35000);eq(r.dragonHp,hp);eq(r.participants.p0.cooldowns.execute,0);eq(r.participants.p0.cooldowns.rapid,0);eq(r.participants.p0.statuses.isolated,false);eq(r.participants.p0.hp,10);
 eq(d.forfeitTurn(r,'p0',5000).ok,false);eq(r.activePlayerId,'p1')})();

(()=>{ // the last hero in order timing out hands the round to the boss: no deadline, BOSS_TURN
 const r=started('necromorph',['tank','heal','dps'],1000);d.forfeitTurn(r,'p0');d.forfeitTurn(r,'p1');eq(r.activePlayerId,'p2');
 const x=d.forfeitTurn(r,'p2');eq(x.ok,true);eq(r.phase,'BOSS_TURN');eq(r.activePlayerId,null);eq(r.heroTurnEndsAt,null);
 const b=d.bossAction(r,4,()=>0,50000);eq(b.ok,true);eq(r.phase,'HERO_TURN');eq(r.activePlayerId,'p0');eq(r.heroTurnEndsAt,80000)})();

(()=>{ // a hero who dies on their own forfeited-over turn start never leaves a stale deadline behind
 const r=started('hydra',['tank','heal','dps'],1000);r.participants.p1.statuses.poisoned=2;r.participants.p1.hp=2;d.forfeitTurn(r,'p0',2000);
 eq(r.participants.p1.alive,false);eq(r.activePlayerId,'p2');eq(r.heroTurnEndsAt,32000)})();

const results=(async()=>{
 // 1) the server timer really forfeits one hero and re-arms for the next
 {const room={dragonRaid:started('wendigo',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc();
  r.heroTurnEndsAt=Date.now()+40;s.armHeroTurn(room);ok(r._heroTurnTimer);await sleep(140);
  eq(r.activePlayerId,'p1');eq(r.lastAction.action,'timeout');eq(r.lastAction.playerId,'p0');ok(r.heroTurnEndsAt-Date.now()>25000);ok(r._heroTurnTimer);eq(r.participants.p0.hp,15);s.clearTimers(r);eq(r._heroTurnTimer,null)}
 // 2) last hero timeout -> the boss moves (BOSS_TURN, boss timer armed, no hero timer)
 {const room={dragonRaid:started('hym',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc();
  d.forfeitTurn(r,'p0');d.forfeitTurn(r,'p1');r.heroTurnEndsAt=Date.now()+40;s.armHeroTurn(room);await sleep(140);
  eq(r.phase,'BOSS_TURN');eq(r.heroTurnEndsAt,null);eq(r._heroTurnTimer,null);ok(r._bossTimer);s.clearTimers(r)}
 // 3) acting clears the pending timer immediately - the old deadline can never fire afterwards
 {const room={dragonRaid:started('hydra',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc(),ws={playerId:'p0'};
  r.heroTurnEndsAt=Date.now()+60;s.armHeroTurn(room);
  s.handle(room,ws,{id:'p0',name:'P0'},{type:'dragon:action',action:'attack',targetId:''});
  eq(r.activePlayerId,'p1');const next=r.heroTurnEndsAt;ok(next-Date.now()>25000);ok(r._heroTurnTimer,'next hero is armed');await sleep(180);
  eq(r.activePlayerId,'p1');eq(r.heroTurnEndsAt,next);eq(r.lastAction.action,'attack');s.clearTimers(r)}
 // 4) cancel / fail / victory: nothing fires afterwards
 {const room={dragonRaid:started('wendigo',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc();
  r.heroTurnEndsAt=Date.now()+40;s.armHeroTurn(room);eq(s.abort(room).ok,true);eq(r.heroTurnEndsAt,null);eq(r._heroTurnTimer,null);await sleep(130);
  eq(r.phase,'ABORTED');eq(r.activePlayerId,null);ok(!r.lastAction||r.lastAction.action!=='timeout')}
 {const room={dragonRaid:started('hydra',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc();
  r.heroTurnEndsAt=Date.now()+40;s.armHeroTurn(room);s.fail(room,'PARTY_WIPE');eq(r.heroTurnEndsAt,null);eq(r._heroTurnTimer,null);await sleep(130);
  eq(r.phase,'FAILED');ok(!r.lastAction||r.lastAction.action!=='timeout')}
 {const room={dragonRaid:started('necromorph',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc();
  r.heroTurnEndsAt=Date.now()+40;s.armHeroTurn(room);r.dragonHp=0;r.boss.hp=0;r.phase='VICTORY';r.activePlayerId=null;r.heroTurnEndsAt=null;await sleep(130);
  eq(r.phase,'VICTORY');eq(r.activePlayerId,null);ok(!r.lastAction||r.lastAction.action!=='timeout');s.clearTimers(r)}
 // a timer left over from an earlier turn can never act on a later one
 {const room={dragonRaid:started('wendigo',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc();
  const stale=r.heroTurnEndsAt;d.heroAction(r,'p0','attack','',8);s.expireHeroTurn(room,r,'p0',stale);eq(r.activePlayerId,'p1');ok(!r.lastAction||r.lastAction.action!=='timeout');
  s.expireHeroTurn(room,r,'p1',r.heroTurnEndsAt);eq(r.activePlayerId,'p1')/* not yet due */;s.clearTimers(r)}
 // 5) a late action (deadline passed, timer not yet delivered) is refused and the turn is forfeited, never played
 {const room={dragonRaid:started('hydra',['tank','heal','dps'],Date.now())},r=room.dragonRaid,s=svc(),ws={playerId:'p0'};
  r.heroTurnEndsAt=Date.now()-5;s.handle(room,ws,{id:'p0',name:'P0'},{type:'dragon:action',action:'attack',targetId:''});
  ok((ws.sent||[]).some(m=>m.type==='dragon:error'&&/EXPIRED/.test(m.message)));eq(r.lastAction.action,'timeout');eq(r.activePlayerId,'p1');
  const ws0={playerId:'p0'};s.handle(room,ws0,{id:'p0',name:'P0'},{type:'dragon:action',action:'attack',targetId:''});
  ok((ws0.sent||[]).some(m=>m.type==='dragon:error'&&/WAIT FOR YOUR TURN/.test(m.message)));eq(r.activePlayerId,'p1');s.clearTimers(r)}
 // 6) GM start (begin) arms the very first hero turn
 {const room={dragonRaid:d.createRaid(Date.now(),'deathwing')},r=room.dragonRaid,s=svc();['tank','heal','dps','dps','dps'].forEach((role,i)=>d.join(r,{id:'z'+i,name:'Z'+i},role));
  eq(s.begin(room),true);ok(r._heroTurnTimer);ok(r.heroTurnEndsAt-Date.now()>29000&&r.heroTurnEndsAt-Date.now()<=30000);s.clearTimers(r)}
})();

(()=>{ // wiring: specimen art, portraits and the visible clock exist on disk and in the UI
 const root=path.join(__dirname,'..'),client=fs.readFileSync(path.join(root,'js','dragon-raid.js'),'utf8'),css=fs.readFileSync(path.join(root,'css','dragon-raid.css'),'utf8'),srv=fs.readFileSync(path.join(root,'dragon-raid-server.js'),'utf8');
 ['wendigo','hym','hydra','necromorph','deathwing'].forEach(id=>{const f=path.join(root,'assets','cabinet',id+'.webp');ok(fs.existsSync(f),id+' art');ok(fs.statSync(f).size>20000,id+' art is a real image');const b=fs.readFileSync(f);eq(b.toString('ascii',0,4),'RIFF');eq(b.toString('ascii',8,12),'WEBP');ok(client.includes(`${id}: 'assets/cabinet/${id}.webp'`),id+' mapped')});
 ok(/dragon-boss-img/.test(client));ok(/dragon-portrait-img/.test(client));ok(/portraitHTML\(p, meta\)/.test(client));ok(/data-dragon-clock="turn"/.test(client));ok(/heroTurnEndsAt/.test(client));ok(/message\.turnForfeited/.test(client));ok(/TURN FORFEITED/.test(client));
 ok(/avatarData:player\.avatarData,frameColor:player\.frameColor/.test(srv));ok(/_heroTurnTimer/.test(srv));ok(/dragon-card-timer/.test(css));ok(/\.dragon-raider-portrait/.test(css));
 ok(!/DRAGON RAID|HEROIC WORLD EVENT|DRAGON HOARD/.test(client))})();

(()=>{ // arena formation: heroes sit on a regular polygon around the specimen, equal distance, never overlapping
 const vm=require('vm'),root=path.join(__dirname,'..'),ctx={window:{},document:{readyState:'loading',addEventListener(){}},console};ctx.window.window=ctx.window;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'js','dragon-raid.js'),'utf8'),ctx);
 const DR=ctx.window.DragonRaid;ok(typeof DR.formation==='function','formation exists');
 const boss={l:-155,r:155,t:-95,b:245};
 [[3,1100],[4,1100],[5,1100],[5,1400],[4,760],[3,700]].forEach(([n,width])=>{
  const f=DR.formation(n,{cx:width/2,width,cw:237,ch:176,boss,pad:14,gap:14});
  eq(f.points.length,n);ok(f.fits,n+' heroes fit at '+width);
  const dist=f.points.map(p=>Math.hypot(p.x,p.y));ok(Math.max(...dist)-Math.min(...dist)<.5,n+' equal distance from the specimen');
  const ang=f.points.map(p=>Math.atan2(p.y,p.x)*180/Math.PI),step=360/n;
  for(let i=0;i<n;i++){const da=((ang[(i+1)%n]-ang[i])%360+360)%360;ok(Math.abs(da-step)<.5,n+' equal angular spacing')}
  const rect=p=>({l:p.x-f.w/2,r:p.x+f.w/2,t:p.y-88,b:p.y+88}),hit=(a,b)=>a.l<b.r&&a.r>b.l&&a.t<b.b&&a.b>b.t;
  const rs=f.points.map(rect);rs.forEach((a,i)=>{ok(!hit(a,boss),n+' seat '+i+' clear of the specimen');rs.forEach((b,j)=>{if(j>i)ok(!hit(a,b),n+' seats '+i+'/'+j+' do not overlap')});ok(width/2+a.l>=14&&width/2+a.r<=width-14,n+' seat '+i+' inside the arena')});
 });
 const tight=DR.formation(5,{cx:325,width:650,cw:237,ch:176,boss,pad:14,gap:14});eq(tight.fits,false,'a pentagon cannot fit 650px: caller falls back to the stacked layout');
 const css=fs.readFileSync(path.join(root,'css','dragon-raid.css'),'utf8');ok(/\.dragon-arena\.is-compact/.test(css));ok(/\.dragon-arena-party\.is-polygon/.test(css));ok(/dragon-formation/.test(css))})();

(()=>{ // GM controls v2: guarded cancel, explained start, launch safety net, random specimen
 const root=path.join(__dirname,'..'),client=fs.readFileSync(path.join(root,'js','dragon-raid.js'),'utf8'),css=fs.readFileSync(path.join(root,'css','dragon-raid.css'),'utf8');
 ok(/cancelArmed\(/.test(client)&&/SURE\? CLICK AGAIN TO CANCEL/.test(client),'cancel is a two-step action');
 ok(/NEED \$\{need - n\} MORE/.test(client),'start explains why it is locked');
 ok(/data-dragon-clock=\"recruit-gm\"/.test(client)&&/recruit-gm/.test(client.slice(client.indexOf('tick() {'))),'gm recruit countdown is ticked');
 ok(/pendingLaunch/.test(client)&&/syncSetup\(\)/.test(client),'launch waits for the server');
 ok(/bossId === 'deathwing' && this\.setupArm/.test(client),'Heroic Calamity needs a second click');
 ok(/data-dragon-action=\"setup-random\"/.test(client)&&/NORMAL_SPECIMENS/.test(client)&&!/bossId: 'random'/.test(client),'random specimen picks a concrete boss on the client');
 ok(/\.dragon-gm-cancel\.is-armed/.test(css)&&/\.dragon-setup-panel\.is-locked/.test(css)&&/\.dragon-setup-random/.test(css),'gm v2 styles exist')})();
results.then(()=>{ok(checks>=70,'expected >=70 checks, got '+checks);console.log('cabinet raid tests: OK ('+checks+' checks)')}).catch(e=>{console.error(e);process.exit(1)});
