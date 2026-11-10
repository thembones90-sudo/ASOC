'use strict';
const schedule=require('./automation/spectral-schedule');
function createHolidayService({store,room,loadBoard,finish,openRating,recount,returnToMenu,persist,notify,validateAssets=()=>[],now=()=>Date.now()}={}){
 const plan=()=>store.load().plan;
 const active=()=>plan().slots.find(s=>['LOADED','RUNNING','RESULT','AFTERMATH','RATING','RECOUNT'].includes(s.stage));
 function allowed(r){const s=active();return plan().enabled&&s&&s.boardId===r.boardId&&['LOADED','RUNNING'].includes(s.stage);}
 function due(at=now()){
  if(!plan().enabled)return false;const r=room();if(!r||r.lockdown)return false;const s=active();
  if(s){if(s.boardId!==r.boardId)return true;if(s.stage==='LOADED')return r.timer?.phase!=='ready'||['CANCELLED','SKIPPED'].includes(r.spectralAdjudicator?.scheduleStatus)||schedule.clock(at).date>s.date;
   if(s.stage==='RUNNING')return !!r.match?.completedAt;return at>=s.nextAt;
  }const t=schedule.clock(at);return plan().slots.some(s=>s.stage==='PLANNED'&&(s.date<t.date||(s.date===t.date&&t.minute>=770)))||plan().slots.every(s=>['DONE','CANCELLED','SKIPPED'].includes(s.stage));
 }
 function tick(at=now()){
  if(!due(at))return false;const r=room(),p=plan();let s=active();
  if(s){
   if(s.boardId!==r.boardId){store.update(s,{stage:'SKIPPED',reason:'Board was changed outside Holiday mode'});notify();return true;}
   if(s.stage==='LOADED'){
    if(r.match?.completedAt){store.update(s,{stage:'RUNNING'});}
    else if(r.timer?.phase!=='ready'&&r.roomMode==='BATTLE'){store.update(s,{stage:'RUNNING',startedAt:at});}
    else {store.update(s,{stage:'CANCELLED',reason:'Not enough players or signup cancelled'});notify();return true;}
   }
   if(s.stage==='RUNNING'&&r.match?.completedAt){store.update(s,{stage:'RESULT',nextAt:at+8000});}
   else if(s.stage==='RESULT'){finish(r);if(!r.match.aftermathStartedAt)throw Error('Holiday story could not start');store.update(s,{stage:'AFTERMATH',nextAt:at+Math.min(180000,Math.max(20000,String(r.gameData?.story||'').length*28+15000))});}
   else if(s.stage==='AFTERMATH'){openRating(r);store.update(s,{stage:'RATING',nextAt:at+60000});}
   else if(s.stage==='RATING'){recount(r);if(!r.match?.resultsShownAt)throw Error('Holiday recount could not start');store.update(s,{stage:'RECOUNT',nextAt:at+45000});}
   else if(s.stage==='RECOUNT'){returnToMenu(r);store.update(s,{stage:'DONE',finishedAt:at});}
   persist();notify();return true;
  }
  const t=schedule.clock(at);
  for(const slot of p.slots){if(slot.stage!=='PLANNED')continue;
   if(slot.date<t.date||(slot.date===t.date&&t.minute>=785)){store.update(slot,{stage:'SKIPPED',reason:'Signup window was missed'});continue;}
   if(slot.date!==t.date||t.minute<770)continue;
   if(r.roomMode==='BATTLE'&&!r.match?.completedAt){store.update(slot,{stage:'SKIPPED',reason:'Another game is still running'});continue;}
   const game=store.catalog().find(g=>g.id===slot.gameId);
   const errors=!game?['Game was removed']:['COMPLETED','RUNNING','UNKNOWN'].includes(store.status(slot.gameId))?['Game is no longer unplayed']:game.errors.concat(validateAssets(slot.gameId));
   if(errors.length){store.update(slot,{stage:'SKIPPED',reason:errors.join('; ')});continue;}
   loadBoard(r,slot.gameId);store.update(slot,{stage:'LOADED',boardId:r.boardId,loadedAt:at});
   r.spectralAdjudicator={...r.spectralAdjudicator,mode:'AUTONOMOUS',paused:false,scheduleArmed:true,scheduleDisabled:false,lastScheduledDate:null,scheduleStatus:null,scheduleBoardId:null};persist();break;
  }
  if(p.slots.length&&p.slots.every(s=>['DONE','CANCELLED','SKIPPED'].includes(s.stage))){p.enabled=false;r.spectralAdjudicator={...r.spectralAdjudicator,scheduleArmed:false,scheduleDisabled:true};store.save();persist();}
  notify();return true;
 }
 function preview(at=now()){return {errors:store.check(plan().slots,at).concat(plan().slots.flatMap(s=>validateAssets(s.gameId))),days:plan().slots.map(s=>({date:s.date,gameId:s.gameId,load:'12:50',signup:'12:55',start:'13:00',cutoff:'13:05',minimumPlayers:5})),timeZone:'Europe/Belgrade'};}
 return {due,tick,allowed,preview};
}
module.exports={createHolidayService};
