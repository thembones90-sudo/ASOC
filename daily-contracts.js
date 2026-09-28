'use strict';

// DAILY CONTRACTS // account-level, server-authoritative objectives.
// Calendar ownership is Europe/Belgrade; clients only display server output.
const TIME_ZONE = 'Europe/Belgrade';
const HISTORY_LIMIT = 30;
const RECEIPT_LIMIT = 512;
const ATTENDANCE_TARGET_MS = Math.max(1000, Number(process.env.ASOC_DAILY_ATTENDANCE_MS) || 300000);
const DEFINITIONS = Object.freeze([
  { id:'attendance', title:'ANSWER THE SUMMONS', description:'Attend an ASOC session for five minutes.', target:ATTENDANCE_TARGET_MS, unit:'ms', reward:1 },
  { id:'iks-five', title:'THREEFOLD CONTENDER', description:'Complete five IKS OKS matches.', target:5, unit:'matches', reward:1 },
  { id:'kaladont', title:'LAST WORD', description:'Play a valid word in a completed KALADONT match.', target:1, unit:'matches', reward:1 }
]);
const BONUS = Object.freeze({ id:'all-complete', title:'DAILY PURGE', reward:2 });

function dayKey(now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const get=t=>parts.find(p=>p.type===t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nextResetAt(now=Date.now()) {
  const key=dayKey(now); let low=now, high=now+36*60*60*1000;
  while(dayKey(high)===key) high+=12*60*60*1000;
  while(high-low>1000){const mid=Math.floor((low+high)/2);if(dayKey(mid)===key)low=mid;else high=mid;}
  return high;
}

function blankDay(key=dayKey()) {
  return { dayKey:key, progress:{attendance:0,'iks-five':0,kaladont:0}, receipts:[], rewards:{}, updatedAt:Date.now() };
}

function normalize(raw, now=Date.now()) {
  const today=dayKey(now); const history=Array.isArray(raw?.history)?raw.history.filter(Boolean).slice(0,HISTORY_LIMIT):[];
  let current=raw?.current&&typeof raw.current==='object'?raw.current:blankDay(today);
  if(current.dayKey!==today){if(current.dayKey)history.unshift({...current,receipts:undefined});current=blankDay(today);}
  current={...blankDay(today),...current,dayKey:today};
  current.progress=current.progress&&typeof current.progress==='object'?current.progress:{};
  DEFINITIONS.forEach(d=>{current.progress[d.id]=Math.max(0,Math.min(d.target,Number(current.progress[d.id])||0));});
  current.receipts=Array.isArray(current.receipts)?current.receipts.filter(x=>typeof x==='string').slice(-RECEIPT_LIMIT):[];
  current.rewards=current.rewards&&typeof current.rewards==='object'?current.rewards:{};
  return {current,history:history.slice(0,HISTORY_LIMIT)};
}

function view(raw, now=Date.now()) {
  const state=normalize(raw,now), c=state.current;
  const contracts=DEFINITIONS.map(d=>({...d,progress:c.progress[d.id],complete:c.progress[d.id]>=d.target,rewarded:c.rewards[d.id]===true}));
  const completed=contracts.filter(x=>x.complete).length;
  return {dayKey:c.dayKey,serverNow:now,resetAt:nextResetAt(now),contracts,completed,total:contracts.length,bonus:{...BONUS,complete:completed===contracts.length,rewarded:c.rewards[BONUS.id]===true}};
}

function advance(raw, type, amount, eventReceipt, now=Date.now()) {
  const state=normalize(raw,now), def=DEFINITIONS.find(d=>d.id===type);
  if(!def)return {state,error:'UNKNOWN DAILY CONTRACT'};
  const receipt=`${type}:${String(eventReceipt||'').slice(0,160)}`;
  if(!eventReceipt)return {state,error:'DAILY EVENT RECEIPT REQUIRED'};
  if(state.current.receipts.includes(receipt))return {state,duplicate:true,changed:false};
  state.current.receipts.push(receipt);if(state.current.receipts.length>RECEIPT_LIMIT)state.current.receipts.splice(0,state.current.receipts.length-RECEIPT_LIMIT);
  const before=state.current.progress[type];
  state.current.progress[type]=Math.min(def.target,before+Math.max(0,Number(amount)||0));
  state.current.updatedAt=now;
  return {state,changed:state.current.progress[type]!==before,completed:before<def.target&&state.current.progress[type]>=def.target};
}

function pendingRewards(raw, now=Date.now()) {
  const state=normalize(raw,now), v=view(state,now), due=[];
  v.contracts.forEach(c=>{if(c.complete&&!state.current.rewards[c.id])due.push({id:c.id,amount:c.reward,title:c.title});});
  if(v.bonus.complete&&!state.current.rewards[BONUS.id])due.push({id:BONUS.id,amount:BONUS.reward,title:BONUS.title});
  return {state,due};
}

module.exports={TIME_ZONE,HISTORY_LIMIT,ATTENDANCE_TARGET_MS,DEFINITIONS,BONUS,dayKey,nextResetAt,blankDay,normalize,view,advance,pendingRewards};
