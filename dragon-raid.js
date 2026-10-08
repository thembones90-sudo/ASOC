'use strict';
const crypto=require('crypto');
const MIN_RAIDERS=3,MAX_RAIDERS=5,RECRUIT_MS=120000,BATTLE_MS=600000;
const BOSSES=Object.freeze({wendigo:{id:'wendigo',name:'Wendigo',hp:100,passive:'HUNGER'},hym:{id:'hym',name:'Hym',hp:100,passive:'FEED ON REMORSE'},hydra:{id:'hydra',name:'Hydra',hp:120,passive:'SWAMP VIGOR'},necromorph:{id:'necromorph',name:'Necromorph',hp:100,passive:'MUTATED FURY'},deathwing:{id:'deathwing',name:'Deathwing',hp:150,passive:'THE DESTROYER',heroic:true}});
const NORMAL_BOSSES=['wendigo','hym','hydra','necromorph'];
const uid=()=>crypto.randomUUID?crypto.randomUUID():crypto.randomBytes(16).toString('hex');
const d20=v=>Math.max(1,Math.min(20,Math.floor(Number(v)||1)));
const tier=r=>r===1?'fumble':r<=7?'failure':r<=17?'success':r<=19?'critical':'natural20';
const livingIds=raid=>raid.order.filter(id=>raid.participants[id]?.alive);

function createRaid(now=Date.now(),bossId='wendigo'){
 const b=BOSSES[bossId]||BOSSES.wendigo;
 return{id:uid(),phase:'RECRUITING',createdAt:now,recruitEndsAt:now+RECRUIT_MS,battleStartedAt:null,battleEndsAt:null,boss:{...b,maxHp:b.hp,wrath:0,armor:0},dragonHp:b.hp,round:0,participants:{},order:[],turnIndex:0,activePlayerId:null,result:null,loot:null,heart:null,lastAction:null,log:[],worldBreaker:false,sunder:0,critSuppression:false};
}
function join(raid,player,role){
 if(!raid||raid.phase!=='RECRUITING')return{ok:false,error:'THE RAID GATES ARE CLOSED'};
 role=role==='warrior'?'tank':role==='healer'?'heal':role;
 if(!['dps','tank','heal'].includes(role))return{ok:false,error:'CHOOSE DPS, WARRIOR OR HEAL'};
 const id=String(player?.id||'');if(!id)return{ok:false,error:'A LITTLE HERO IDENTITY IS REQUIRED'};
 if(raid.participants[id])return{ok:true,already:true,full:raid.order.length===MAX_RAIDERS};
 if(raid.order.length>=MAX_RAIDERS)return{ok:false,error:'RAID FULL // YOU SNOOZE, YOU LOSE'};
 const maxHp=role==='tank'?15:10;
 raid.participants[id]={id,name:String(player.name||'Little Hero').slice(0,40),role,hp:maxHp,maxHp,alive:true,resurrectionCharges:role==='heal'?2:0,shieldWall:role==='tank'?1:0,cooldowns:{execute:0,rapid:0},statuses:{guard:0,block:0,taunt:false,burning:0,bleeding:0,poisoned:0,weakened:false,bloodlust:false,shieldWall:0,shieldNegate:false,shieldReflect:0,isolated:false,guilt:false,haunted:false,shredded:false},damage:0,healing:0,deaths:0,resurrectionsCast:0,timesResurrected:0};
 raid.order.push(id);return{ok:true,full:raid.order.length===MAX_RAIDERS};
}
function canStart(r){return!!r&&r.phase==='RECRUITING'&&(r.boss.heroic?r.order.length===5:r.order.length>=MIN_RAIDERS)}
function startBattle(r,now=Date.now()){if(!canStart(r))return{ok:false,error:r?.boss?.heroic?'DEATHWING DEMANDS EXACTLY FIVE RAIDERS':`AT LEAST ${MIN_RAIDERS} RAIDERS ARE REQUIRED`};r.phase='HERO_TURN';r.battleStartedAt=now;r.battleEndsAt=now+BATTLE_MS;r.round=1;r.turnIndex=0;r.activePlayerId=livingIds(r)[0];return{ok:true}}
function applyTurnStart(r,p){const dot=(p.statuses.burning?1:0)+(p.statuses.bleeding?1:0)+Math.max(0,Number(p.statuses.poisoned)||0);p.statuses.burning=0;p.statuses.bleeding=0;p.statuses.poisoned=0;if(dot){p.hp=Math.max(0,p.hp-dot);if(!p.hp&&p.alive){p.alive=false;p.deaths++}}return dot}
function advance(r){let i=r.turnIndex+1;while(i<r.order.length){const p=r.participants[r.order[i]];if(p?.alive){applyTurnStart(r,p);if(p.alive)break}i++}if(i<r.order.length){r.turnIndex=i;r.activePlayerId=r.order[i];r.phase='HERO_TURN'}else{r.turnIndex=r.order.length;r.activePlayerId=null;r.phase='BOSS_TURN'}}
function baseDamage(role,t){if(role==='tank')return t==='success'?4:t==='critical'?7:t==='natural20'?8:0;if(role==='heal')return t==='success'?3:t==='critical'?5:t==='natural20'?6:0;return t==='success'?5:t==='critical'?9:t==='natural20'?13:0}
function hitBoss(r,p,n){if(!n)return 0;let dealt=n;if(p.statuses.weakened){dealt=Math.max(0,dealt-1);p.statuses.weakened=false}if(p.statuses.bloodlust){dealt++;p.statuses.bloodlust=false}if(r.sunder){dealt+=2;r.sunder=0}if(r.boss.armor){dealt=Math.max(0,dealt-r.boss.armor);r.boss.armor=0}r.dragonHp=Math.max(0,r.dragonHp-dealt);r.boss.hp=r.dragonHp;p.damage+=dealt;return dealt}
function heroAction(r,playerId,action='attack',targetId,rawRoll){
 if(!r||r.phase!=='HERO_TURN')return{ok:false,error:'IT IS NOT A HERO TURN'};const p=r.participants[String(playerId)];if(!p||r.activePlayerId!==p.id)return{ok:false,error:'WAIT FOR YOUR TURN'};if(!p.alive)return{ok:false,error:'THE DEAD CANNOT ACT'};
 const allowed={tank:['attack','taunt','shieldWall'],heal:['attack','heal','resurrect'],dps:['attack','execute','rapid']}[p.role];if(!allowed.includes(action))return{ok:false,error:'THAT ROLE CANNOT USE THIS ACTION'};let roll=d20(rawRoll),result=tier(roll);if(r.critSuppression&&['critical','natural20'].includes(result)){result='success';r.critSuppression=false}
 const target=r.participants[String(targetId||'')];let damage=0,healing=0,revived=false,refunded=false,secondaryTargetId=null;
 if(action==='shieldWall'&&p.shieldWall<1)return{ok:false,error:'SHIELD WALL ALREADY SPENT'};if(action==='execute'&&p.cooldowns.execute)return{ok:false,error:'EXECUTE IS ON COOLDOWN'};if(action==='rapid'&&p.cooldowns.rapid)return{ok:false,error:'RAPID STRIKE IS ON COOLDOWN'};if(action==='resurrect'&&p.resurrectionCharges<1)return{ok:false,error:'NO RESURRECTION CHARGES REMAIN'};if(['heal','resurrect'].includes(action)&&!target)return{ok:false,error:'CHOOSE A RAID TARGET'};const guiltActive=!!p.statuses.guilt;if(guiltActive){p.statuses.guilt=false;if(['fumble','failure'].includes(result)){p.hp=Math.max(0,p.hp-2);if(!p.hp&&p.alive){p.alive=false;p.deaths++}r.dragonHp=Math.min(r.boss.maxHp,r.dragonHp+3);r.boss.hp=r.dragonHp}}
 if(action==='shieldWall'){p.shieldWall--;if(result==='failure')p.statuses.shieldWall=2;else if(result==='success')p.statuses.shieldWall=4;else if(result==='critical')p.statuses.shieldNegate=true;else if(result==='natural20'){p.statuses.shieldNegate=true;p.statuses.shieldReflect=4}}
 else if(action==='taunt'){if(!['fumble','failure'].includes(result)){p.statuses.taunt=true;p.statuses.block=result==='critical'?2:result==='natural20'?3:0;if(result==='natural20')damage=hitBoss(r,p,3)}}
 else if(action==='heal'){if(!target.alive)return{ok:false,error:'USE RESURRECTION ON THE FALLEN'};healing=result==='success'?3:['critical','natural20'].includes(result)?target.maxHp-target.hp:0;if(p.statuses.haunted&&healing>0){healing=Math.max(0,healing-2);p.statuses.haunted=false}if(target.statuses.isolated&&healing>0)healing=Math.max(0,healing-2);target.hp=Math.min(target.maxHp,target.hp+healing);p.healing+=healing;if(result==='natural20'){const other=livingIds(r).map(id=>r.participants[id]).filter(q=>q.id!==target.id&&q.hp<q.maxHp).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];if(other){const h=Math.min(3,other.maxHp-other.hp);other.hp+=h;p.healing+=h;secondaryTargetId=other.id}}}
 else if(action==='resurrect'){if(target.id===p.id)return{ok:false,error:'NO SELF RESURRECTION'};if(target.alive)return{ok:false,error:'TARGET MUST BE FALLEN'};p.resurrectionCharges--;p.resurrectionsCast++;if(!['fumble','failure'].includes(result)){target.alive=true;target.hp=3;target.statuses.burning=0;target.statuses.bleeding=0;target.timesResurrected++;revived=true}if(['critical','natural20'].includes(result)){p.resurrectionCharges=Math.min(2,p.resurrectionCharges+1);refunded=true}}
 else{if(action==='execute'){p.cooldowns.execute=3;const low=r.dragonHp<r.boss.maxHp*.25;damage=result==='success'?(low?9:7):result==='critical'?(low?14:12):result==='natural20'?(low?18:16):0}else if(action==='rapid'){p.cooldowns.rapid=2;damage=result==='failure'?3:result==='success'?6:result==='critical'?8:result==='natural20'?10:0}else damage=baseDamage(p.role,result);if(p.statuses.haunted&&damage>0){damage=Math.max(0,damage-2);p.statuses.haunted=false}damage=hitBoss(r,p,damage);if(p.role==='dps'&&['critical','natural20'].includes(result))p.statuses.bloodlust=true;if(p.role==='dps'&&result==='natural20')r.sunder=1;if(p.role==='tank'&&action==='attack'&&result==='natural20')p.statuses.guard=2}
 if(r.boss.id==='hym'&&roll===1){r.dragonHp=Math.min(r.boss.maxHp,r.dragonHp+2);r.boss.hp=r.dragonHp}p.statuses.isolated=false;r.lastAction={side:'hero',playerId:p.id,name:p.name,action,targetId:target?.id||null,secondaryTargetId,roll,result,damage,healing,revived,refunded,round:r.round};r.log.push(r.lastAction);if(r.log.length>30)r.log.shift();if(r.dragonHp<=0){r.phase='VICTORY';r.activePlayerId=null}else advance(r);return{ok:true,...r.lastAction};
}
function bossAction(r,rawRoll,rng=Math.random){
 if(!r||r.phase!=='BOSS_TURN')return{ok:false,error:'IT IS NOT THE BOSS TURN'};const roll=Math.max(2,d20(rawRoll)),dw=r.boss.id==='deathwing',result=roll===2||(!dw&&roll===3)?'miss':roll===20?'catastrophic':roll>=15?'empowered':'standard';if(dw)r.boss.wrath=r.dragonHp<=50?2:r.dragonHp<=100?1:0;let alive=livingIds(r);if(!alive.length)return{ok:false,wiped:true};
 const pick=(ids=alive)=>ids[Math.floor(Math.max(0,Math.min(.999999,rng()))*ids.length)],pickMany=n=>{const pool=[...alive],out=[];while(pool.length&&out.length<n)out.push(pool.splice(Math.floor(Math.max(0,Math.min(.999999,rng()))*pool.length),1)[0]);return out};
 const singleTarget=()=>{const taunts=alive.filter(id=>r.participants[id].statuses.taunt);return pick(taunts.length?taunts:alive)};
 const dealt={};let reflected=0;const frenzyActive=r.boss.id==='necromorph'&&!!r.boss.frenzy&&result!=='miss';if(frenzyActive)r.boss.frenzy=false;
 const hurt=(id,amount,single=false)=>{const p=r.participants[id];if(!p?.alive)return 0;let n=amount;if(single){if(dw)n+=r.boss.wrath;if(p.role==='tank')n=Math.max(0,n-1);if(p.statuses.guard){n=Math.max(0,n-p.statuses.guard);p.statuses.guard=0}if(p.statuses.block){n=Math.max(0,n-p.statuses.block);p.statuses.block=0}if(p.statuses.shieldNegate){n=0;p.statuses.shieldNegate=false;reflected+=p.statuses.shieldReflect;p.statuses.shieldReflect=0}if(p.statuses.shieldWall){n=Math.max(0,n-p.statuses.shieldWall);p.statuses.shieldWall=0}p.statuses.taunt=false}if(p.statuses.shredded&&n>0){n+=1;p.statuses.shredded=false}if(r.boss.id==='wendigo'&&single&&p.statuses.prey&&n>0){n=Math.min(6,n+1);p.statuses.prey=false}if(frenzyActive&&n>0)n+=1;if(dw&&r.worldBreaker)n+=1;p.hp=Math.max(0,p.hp-n);dealt[id]=(dealt[id]||0)+n;if(!p.hp&&p.alive){p.alive=false;p.deaths++}return n};
 let skill='MISS',targets=[],healed=0;const empowered=result==='empowered';
 if(result!=='miss'){
  if(r.boss.id==='wendigo'){
   if(result==='catastrophic'){skill='WHITE SILENCE';targets=[...alive];targets.forEach(id=>hurt(id,1));const low=alive.map(id=>r.participants[id]).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];if(low){low.statuses.isolated=true;low.statuses.prey=true}}
   else if(Math.floor(rng()*2)===0){skill='FERAL LUNGE';const low=alive.map(id=>r.participants[id]).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];targets=[low.id];const bonus=low.hp<low.maxHp*.5?1:0;hurt(low.id,(empowered?5:4)+bonus,true)}
   else{skill='DRAG INTO THE DARK';const q=singleTarget();targets=[q];hurt(q,empowered?3:2,true);r.participants[q].statuses.isolated=true}
  }else if(r.boss.id==='hym'){
   if(result==='catastrophic'){skill='THE SHADOW WITHIN';targets=[...alive];targets.forEach(id=>hurt(id,1));const a=pick(),rest=alive.filter(id=>id!==a),b=pick(rest.length?rest:alive);r.participants[a].statuses.guilt=true;r.participants[b].statuses.haunted=true;healed=2;r.dragonHp=Math.min(r.boss.maxHp,r.dragonHp+healed);r.boss.hp=r.dragonHp}
   else if(Math.floor(rng()*2)===0){skill='WHISPER OF GUILT';const q=singleTarget();targets=[q];hurt(q,empowered?2:1,true);r.participants[q].statuses.guilt=true}
   else{skill='SHADOW GRASP';const q=singleTarget();targets=[q];hurt(q,empowered?4:3,true);if(empowered)r.participants[q].statuses.haunted=true}
  }else if(r.boss.id==='hydra'){
   if(result==='catastrophic'){skill='VENOM FLOOD';targets=[...alive];targets.forEach(id=>hurt(id,1));pickMany(2).forEach(id=>r.participants[id].statuses.poisoned=2);healed=r.dragonHp<r.boss.maxHp*.5?7:4;r.dragonHp=Math.min(r.boss.maxHp,r.dragonHp+healed);r.boss.hp=r.dragonHp}
   else if(Math.floor(rng()*2)===0){skill='MANY-HEADED BITE';targets=pickMany(empowered?3:2);targets.forEach(id=>hurt(id,empowered?3:2,true))}
   else{skill='VENOM SPIT';const q=singleTarget();targets=[q];hurt(q,empowered?4:3,true);r.participants[q].statuses.poisoned=2}
  }else if(r.boss.id==='necromorph'){
   if(result==='catastrophic'){skill='ABERRANT FRENZY';for(let i=0;i<3;i++){const q=pick(livingIds(r));if(q){targets.push(q);hurt(q,2,true)}}r.boss.frenzy=true}
   else if(Math.floor(rng()*2)===0){skill='SCYTHE REND';const q=singleTarget();targets=[q];hurt(q,empowered?6:4,true);if(empowered&&r.participants[q]?.alive)r.participants[q].statuses.shredded=true}
   else{skill='VENT AMBUSH';targets=pickMany(2);targets.forEach(id=>hurt(id,empowered?3:2,true));if(empowered&&targets.length){const q=targets[Math.floor(rng()*targets.length)];if(r.participants[q]?.alive)r.participants[q].statuses.shredded=true}}
   if(r.dragonHp<r.boss.maxHp*.5&&Object.values(dealt).some(n=>n>0)){const candidates=livingIds(r);if(candidates.length){const q=pick(candidates);targets.push(q);hurt(q,1,false)}}
  }else{
   const variant=Math.floor(rng()*4);if(result==='catastrophic'){skill='CATACLYSMIC BREATH';targets=[...alive];targets.forEach(id=>hurt(id,3));r.worldBreaker=true}
   else if(variant===0){skill='ELEMENTIUM CLAW';targets=[singleTarget()];hurt(targets[0],empowered?6:4,true)}
   else if(variant===1){skill='TAIL SWEEP';targets=[...alive];targets.forEach(id=>hurt(id,empowered?2:1))}
   else if(variant===2){skill='FIRESTORM';targets=pickMany(3);targets.forEach(id=>hurt(id,empowered?3:2))}
   else{skill='BURNING BLOOD';targets=[singleTarget()];hurt(targets[0],empowered?3:2,true);r.participants[targets[0]].statuses.burning=1}
  }
 }
 if(r.boss.id==='hym'&&result==='fumble'){}
 if(reflected)r.dragonHp=Math.max(0,r.dragonHp-reflected);if(dw)r.boss.wrath=r.dragonHp<=50?2:r.dragonHp<=100?1:0;if(r.worldBreaker&&skill!=='CATACLYSMIC BREATH'&&result!=='miss')r.worldBreaker=false;
 r.lastAction={side:'boss',bossId:r.boss.id,name:r.boss.name,skill,targets,roll,result,damage:Object.values(dealt).reduce((a,b)=>a+b,0),dealt,reflected,healed,round:r.round};r.log.push(r.lastAction);if(!livingIds(r).length){r.phase='FAILED';r.activePlayerId=null}else if(r.dragonHp<=0){r.phase='VICTORY'}else{r.round++;r.turnIndex=0;Object.values(r.participants).forEach(p=>{Object.keys(p.cooldowns).forEach(k=>p.cooldowns[k]=Math.max(0,p.cooldowns[k]-1))});while(r.turnIndex<r.order.length){const p=r.participants[r.order[r.turnIndex]];if(p?.alive){applyTurnStart(r,p);if(p.alive)break}r.turnIndex++}r.activePlayerId=r.order[r.turnIndex]||null;r.phase=r.activePlayerId?'HERO_TURN':'FAILED'}return{ok:true,...r.lastAction,wiped:r.phase==='FAILED'};
}
function weightedLoot(rng=Math.random){const x=rng();if(x>=.995)return 500;const b=x<.4?[50,100]:x<.7?[101,200]:x<.88?[201,300]:x<.97?[301,400]:[401,499];return b[0]+Math.floor(rng()*(b[1]-b[0]+1))}
function splitLoot(total,ids,rng=Math.random){if(!ids.length)return{};const out=Object.fromEntries(ids.map(id=>[id,Math.floor(total/ids.length)]));let rem=total%ids.length,pool=[...ids];while(rem--)out[pool.splice(Math.floor(rng()*pool.length),1)[0]]++;return out}
function heartRound(ids,rng=Math.random){const rolls=Object.fromEntries(ids.map(id=>[id,1+Math.floor(rng()*100)])),top=Math.max(...Object.values(rolls)),tied=ids.filter(id=>rolls[id]===top);return{rolls,top,tied,winner:tied.length===1?tied[0]:null}}
function publicView(r){if(!r)return null;return{id:r.id,phase:r.phase,createdAt:r.createdAt,recruitEndsAt:r.recruitEndsAt,battleStartedAt:r.battleStartedAt,battleEndsAt:r.battleEndsAt,boss:{...r.boss},dragonHp:r.dragonHp,dragonMaxHp:r.boss.maxHp,round:r.round,minRaiders:MIN_RAIDERS,maxRaiders:MAX_RAIDERS,activePlayerId:r.activePlayerId,turnIndex:r.turnIndex,participants:r.order.map(id=>({...r.participants[id],statuses:{...r.participants[id].statuses},cooldowns:{...r.participants[id].cooldowns}})),result:r.result,loot:r.loot,heart:r.heart,lastAction:r.lastAction,log:r.log,worldBreaker:r.worldBreaker}}
module.exports={BOSSES,NORMAL_BOSSES,MIN_RAIDERS,MAX_RAIDERS,RECRUIT_MS,BATTLE_MS,createRaid,join,canStart,startBattle,livingIds,tier,heroAction,bossAction,weightedLoot,splitLoot,heartRound,publicView};
