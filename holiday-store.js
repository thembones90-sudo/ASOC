'use strict';
const path=require('path');const durable=require('./durable-io');const schedule=require('./automation/spectral-schedule');
const validDate=value=>{try{return /^\d{4}-\d{2}-\d{2}$/.test(String(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}};
function createHolidayStore({file=path.join(process.env.ASOC_DATA_DIR||__dirname,'holiday-games.json'),readGame,listGames,listMatches}={}){
 let state;
 const blank=()=>({version:1,revision:0,games:{},plan:{enabled:false,slots:[]}});
 function load(){if(state)return state;if(!durable.fs.existsSync(file))return state=blank();const parsed=JSON.parse(durable.fs.readFileSync(file,'utf8'));if(parsed.version!==1||!parsed.games||!Array.isArray(parsed.plan?.slots))throw Error('Holiday history is unreadable. Automation is blocked.');return state=parsed;}
 function save(){load().revision++;durable.writeJson(file,state);}
 function record(id){return load().games[id]||null;}
 function mark(id,status,details={}){if(!id)return;const old=record(id);if(old?.status==='COMPLETED'&&status!=='COMPLETED')return;load().games[id]={...old,...details,status};save();}
 function reconcile(){let changed=false;for(const m of listMatches()){
  if(!m.gameId||!m.completedAt)continue;const id=readGame(m.gameId)?.id||m.gameId;const old=record(id);
  const complete=['WON','LOST'].includes(m.outcome)||!!m.resultsShownAt;
  if(!complete&&old)continue;if(complete&&old?.status==='COMPLETED'&&Number(old.lastPlayedAt)>=Number(m.completedAt))continue;
  load().games[id]={...old,status:complete?'COMPLETED':'UNKNOWN',lastPlayedAt:m.completedAt,matchId:m.matchId,outcome:m.outcome||null};changed=true;
 }if(changed)save();}
 function status(id){const r=record(id);if(r)return r.status;return load().plan.slots.some(s=>s.gameId===id&&!['CANCELLED','SKIPPED','DONE'].includes(s.stage))?'SCHEDULED':'UNPLAYED';}
 function validation(game){const errors=[];if(!game)return ['Game no longer exists'];if(game.isSample||game.id==='sample-001')errors.push('Sample games cannot be automated');for(const col of ['A','B','C','D']){const c=game.columns?.[col];if(!c?.solution?.trim()||!Array.isArray(c.clues)||c.clues.length!==4||c.clues.some(x=>!String(x||'').trim()))errors.push(`${col} needs four clues and a solution`);}if(!game.finalSolution?.trim())errors.push('Final solution is missing');if(!game.story?.trim())errors.push('Story is missing');return errors;}
 function completeExisting(){if(load().baselineCompletedAt)return;const at=Date.now();const ids=[];for(const game of listGames()){ids.push(game.id);const old=record(game.id);load().games[game.id]={...old,status:'COMPLETED',lastPlayedAt:old?.lastPlayedAt||null,outcome:old?.outcome||'GM_CONFIRMED',confirmedAt:at};}load().baselineCompletedAt=at;load().baselineIds=ids;save();console.log(`[holiday] Marked ${ids.length} existing library games completed (GM-confirmed baseline)`);}
 function catalog(){return listGames().map(meta=>{const game=readGame(meta.id);return {id:meta.id,title:meta.title,status:status(meta.id),...record(meta.id),errors:validation(game)};});}
 function check(slots,now=Date.now()){
  const errors=[],seen=new Set(),dates=new Set();if(!Array.isArray(slots)||!slots.length||slots.length>31)return ['Assign between 1 and 31 daily games'];
  for(const slot of slots){if(!validDate(slot.date)){errors.push('Invalid calendar date');continue;}if(dates.has(slot.date))errors.push(`More than one game on ${slot.date}`);dates.add(slot.date);if(slot.date<schedule.clock(now).date)errors.push(`${slot.date} has already passed`);if(seen.has(slot.gameId))errors.push('A game is assigned more than once');seen.add(slot.gameId);const game=readGame(String(slot.gameId||''));if(!game||game.id!==slot.gameId){errors.push('Choose a game by its library ID');continue;}if(['RUNNING','COMPLETED','UNKNOWN'].includes(status(slot.gameId)))errors.push(`${game.title} is ${status(slot.gameId).toLowerCase()}`);errors.push(...validation(game).map(e=>`${game.title}: ${e}`));}return [...new Set(errors)];
 }
 function configure(slots,now){if(load().plan.enabled)throw Error('Disable Holiday mode before editing its queue');const errors=check(slots,now);if(errors.length)throw Error(errors.join('; '));load().plan={enabled:false,slots:slots.map(s=>({date:s.date,gameId:s.gameId,stage:'PLANNED'})).sort((a,b)=>a.date.localeCompare(b.date))};save();}
 function enable(now){const errors=check(load().plan.slots,now);if(errors.length)throw Error(errors.join('; '));load().plan.enabled=true;save();}
 function disable(){load().plan.enabled=false;save();}
 function update(slot,patch){Object.assign(slot,patch);save();}
 function review(id){if(!readGame(id)||!['UNKNOWN','CANCELLED'].includes(status(id)))throw Error('Only uncertain or cancelled games can be confirmed unplayed');load().games[id]={status:'UNPLAYED',reviewedAt:Date.now()};save();}
 return {load,save,completeExisting,record,status,mark,reconcile,validation,catalog,check,configure,enable,disable,update,review};
}
module.exports={createHolidayStore,validDate};
