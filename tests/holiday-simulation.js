'use strict';
const vm=require('vm');const assert=require('assert/strict');const fs=require('fs');const os=require('os');const path=require('path');
const {createHolidayStore,validDate}=require('../holiday-store');const {createHolidayService}=require('../holiday-server');const schedule=require('../automation/spectral-schedule');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-holiday-'));const file=path.join(dir,'state.json');
const games=Array.from({length:20},(_,i)=>({id:'game-'+i,title:'Prepared '+i,story:'The evidence is ready.',finalSolution:'FINAL',columns:Object.fromEntries(['A','B','C','D'].map(c=>[c,{solution:c,clues:['one','two','three','four']}]))}));
let archives=[];const args={file,readGame:id=>games.find(g=>g.id===id),listGames:()=>games,listMatches:()=>archives};let store=createHolidayStore(args),r={code:'MASTER',roomMode:'CASUAL',boardId:'old',timer:{phase:'ready'},players:new Map(),spectralAdjudicator:{}},loaded=[],failures=0;
const at=(date,time)=>Date.parse(date+'T'+time+':00+01:00');
function service(){return createHolidayService({store,room:()=>r,loadBoard:(r,id)=>{loaded.push(id);r.boardId='board-'+id;r.gameData=games.find(g=>g.id===id);r.match={};r.roomMode='CASUAL';r.timer={phase:'ready'};},finish:r=>r.match.aftermathStartedAt=1,openRating:r=>r.match.ratingOpenedAt=1,recount:r=>r.match.resultsShownAt=1,returnToMenu:r=>r.roomMode='CASUAL',persist(){},notify(){}});}
let svc=service();
try{
 const serverSource=fs.readFileSync(require.resolve('../server'),'utf8');let enabled=true;const ctx={MASTER_ROOM_CODE:'MASTER',getHolidayStore:()=>({load:()=>({plan:{enabled}})})};vm.createContext(ctx);for(const name of ['holidayWomfPaused','addWomfCharge','getWomfPublicState']){const start=serverSource.indexOf('function '+name+'(');const end=serverSource.indexOf('\n}',start)+2;vm.runInContext(serverSource.slice(start,end),ctx);}const meter={code:'MASTER',womf:{charge:7,failedColumns:{}}};ctx.addWomfCharge(meter,3);assert.equal(meter.womf.charge,7);assert.equal(ctx.getWomfPublicState(meter).paused,true);enabled=false;assert.equal(ctx.getWomfPublicState(meter).charge,7);ctx.addWomfCharge(meter,1);assert.equal(meter.womf.charge,8);
 assert.equal(validDate('2026-99-99'),false);assert.equal(validDate('2026-02-30'),false);
 const slots=games.slice(0,17).map((g,i)=>({gameId:g.id,date:new Date(Date.UTC(2026,10,11+i,12)).toISOString().slice(0,10)}));
 store.configure(slots,at('2026-11-10','12:00'));store.enable(at('2026-11-10','12:00'));
 for(const [i,s] of slots.entries()){
  assert.equal(svc.tick(at(s.date,'12:49')),false);
  assert.equal(svc.tick(at(s.date,'12:50')),true);assert.equal(loaded.at(-1),s.gameId);
  assert.equal(svc.tick(at(s.date,'12:50')),false,'duplicate load tick ignored');
  assert.equal(schedule.decide(r,at(s.date,'12:55')), 'SUMMON');r.roomMode='BATTLE_ARMED';r.ritual={active:true,joinedPlayerIds:['1','2','3','4','5']};r.spectralAdjudicator.lastScheduledDate=s.date;r.spectralAdjudicator.scheduleStatus='SUMMONING';r.spectralAdjudicator.scheduleBoardId=r.boardId;
  r.players=new Map(['1','2','3','4','5'].map(id=>[{readyState:1},{id,connected:true}]));
  assert.equal(schedule.decide(r,at(s.date,'13:00')),'START');r.roomMode='BATTLE';r.timer.phase='running';store.mark(s.gameId,'RUNNING',{matchId:r.boardId});svc.tick(at(s.date,'13:00'));
  if(i===8){store=createHolidayStore(args);svc=service();assert.equal(store.status(s.gameId),'RUNNING','restart keeps reservation');assert.equal(svc.tick(at(s.date,'13:01')),false,'restart never loads a new game');}
  r.match.completedAt=at(s.date,'13:20');store.mark(s.gameId,'COMPLETED',{lastPlayedAt:r.match.completedAt,outcome:i%2?'LOST':'WON'});svc.tick(at(s.date,'13:20'));
  for(const stage of ['RESULT','AFTERMATH','RATING','RECOUNT']){const active=store.load().plan.slots[i];assert.equal(active.stage,stage);svc.tick(active.nextAt);}
  assert.equal(store.load().plan.slots[i].stage,'DONE');assert.equal(store.status(s.gameId),'COMPLETED');
 }
 svc.tick(at('2026-11-28','12:50'));assert.equal(store.load().plan.enabled,false);assert.equal(new Set(loaded).size,17);assert.equal(loaded.length,17);
 store=createHolidayStore(args);assert.equal(store.status('game-0'),'COMPLETED','completion persists without archive');games[0].title='Renamed';assert.equal(store.status(games[0].id),'COMPLETED');
 assert.throws(()=>store.configure([{date:'2026-11-29',gameId:'game-0'}],at('2026-11-28','12:00')),/completed/);
 assert.throws(()=>store.configure([{date:'2026-11-29',gameId:'game-17'},{date:'2026-11-30',gameId:'game-17'}],at('2026-11-28','12:00')),/more than once/);
 store.configure([{date:'2026-11-29',gameId:'game-17'}],at('2026-11-28','12:00'));store.enable(at('2026-11-28','12:00'));svc=service();svc.tick(at('2026-11-29','12:50'));r.spectralAdjudicator.scheduleStatus='CANCELLED';svc.tick(at('2026-11-29','13:05'));assert.equal(store.status('game-17'),'UNPLAYED','failed signup never completes a game');svc.tick(at('2026-11-29','13:06'));
 store.configure([{date:'2026-11-30',gameId:'game-18'}],at('2026-11-29','12:00'));store.enable(at('2026-11-29','12:00'));svc.tick(at('2026-11-30','13:06'));assert.equal(store.load().plan.slots[0].stage,'SKIPPED','missed window never starts late');assert.equal(store.status('game-18'),'UNPLAYED');
 archives=[{gameId:'game-19',matchId:'legacy',completedAt:1,outcome:'WON'}];store.reconcile();assert.equal(store.status('game-19'),'COMPLETED');store.mark('game-19','RUNNING');assert.equal(store.status('game-19'),'COMPLETED','history cannot be downgraded');
 const bad=games[18];bad.columns.A.clues=[];assert.ok(store.validation(bad).length);bad.columns.A.clues=['one','two','three','four'];
 const baseline=createHolidayStore({...args,file:path.join(dir,'baseline.json')});baseline.completeExisting();assert.ok(baseline.catalog().every(g=>g.status==='COMPLETED'));assert.equal(baseline.record('game-0').lastPlayedAt,null,'GM baseline never invents a played date');games.push({...games[0],id:'new-after-baseline',title:'New holiday game'});baseline.completeExisting();assert.equal(baseline.status('new-after-baseline'),'UNPLAYED','future uploads are never swept into the old baseline');assert.equal(baseline.load().plan.enabled,false);
 fs.writeFileSync(path.join(dir,'broken.json'),'{invalid');assert.throws(()=>createHolidayStore({...args,file:path.join(dir,'broken.json')}).load());assert.equal(fs.readFileSync(path.join(dir,'broken.json'),'utf8'),'{invalid','corrupt history is never reset to unplayed');
 console.log('PASS 17-day holiday rehearsal: 17 distinct games, wins/losses, no-host flow, persistent completion/reservation, restart, exact signup window, cancellation, missed days, no downgrade or repeat, validation');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
