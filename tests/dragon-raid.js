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
(()=>{const r=bossReady('hydra');let x=d.bossAction(r,15,()=>.9);eq(x.skill,'VENOM SPIT');eq(x.damage,4);eq(r.participants[x.targets[0]].statuses.poisoned,1)})();
(()=>{const r=bossReady('hydra');r.dragonHp=80;r.boss.hp=80;let x=d.bossAction(r,20,seq([.9,.9]));eq(x.skill,'VENOM FLOOD');eq(x.healed,3);eq(r.dragonHp,83);eq(Object.values(r.participants).filter(p=>p.statuses.poisoned).length,2)})();
(()=>{const r=bossReady('hydra');r.dragonHp=40;r.boss.hp=40;let x=d.bossAction(r,20,seq([0,0]));eq(x.healed,5);eq(r.dragonHp,45)})();

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

(()=>{const r=raid('wendigo');d.startBattle(r);r.participants.p0.statuses.isolated=true;r.participants.p0.hp=10;d.heroAction(r,'p0','attack','',8);eq(r.participants.p0.statuses.isolated,false)})();

(()=>{const r=bossReady('wendigo');r.dragonHp=4;r.boss.hp=4;r.participants.p0.statuses.taunt=true;r.participants.p0.statuses.shieldNegate=true;r.participants.p0.statuses.shieldReflect=4;const x=d.bossAction(r,4,()=>0);eq(x.reflected,4);eq(r.dragonHp,0);eq(r.phase,'VICTORY')})();

(()=>{eq(d.weightedLoot(()=>.995),500);const s=d.splitLoot(307,['a','b','c','d'],()=>0);eq(Object.values(s).reduce((a,b)=>a+b,0),307);const h=d.heartRound(['a','b'],()=>.41);eq(h.winner,null);eq(h.tied.length,2)})();

(()=>{let broadcasts=0;const service=createDragonRaidService({playerStore:{applyDragonRaidResults:()=>({ok:true})},coinAccount:()=>null,triggerMegabonk:()=>({ok:true}),broadcastToRoom:()=>{broadcasts++},broadcastPlayersUpdate:()=>{},sendToWs:()=>{},randomInt:a=>a});const room={dragonRaid:raid('wendigo')};d.startBattle(room.dragonRaid);const x=service.abort(room);eq(x.ok,true);eq(room.dragonRaid.phase,'ABORTED');eq(room.dragonRaid.result.reason,'GM_CANCELLED');ok(broadcasts>0)})();

(()=>{const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8'),service=fs.readFileSync(path.join(__dirname,'..','dragon-raid-server.js'),'utf8'),client=fs.readFileSync(path.join(__dirname,'..','js','dragon-raid.js'),'utf8');ok(/case 'dragon:action'/.test(src));ok(/r\.phase==='VICTORY'\)return victory\(room\)/.test(service));ok(/r\.boss\.heroic\?'CATACLYSM':'TIME_EXPIRED'/.test(service));ok(/reason === 'CATACLYSM'/.test(client));ok(/CABINET OF CURIOSITIES/.test(client));ok(/WENDIGO/.test(client));ok(/HYM/.test(client));ok(/HYDRA/.test(client));ok(/NECROMORPH/.test(client));ok(/SHADOW BROKER OBSERVER/.test(client));ok(/data-dragon-action=\"cancel\"/.test(client));ok(/action:\s*'cancel'/.test(client));ok(/getDragonRaidService\(\)\.abort/.test(src));ok(!/AZHRAAK/.test(client));ok(!/DRAZHUL/.test(client));ok(!/VARKHUL/.test(client));ok(!/KRAEVAR/.test(client))})();

ok(checks>=70,'expected >=70 checks, got '+checks);
console.log('cabinet raid tests: OK ('+checks+' checks)');
