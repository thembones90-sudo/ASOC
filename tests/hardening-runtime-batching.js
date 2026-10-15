'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const queue = source.slice(source.indexOf('function resolveRuntimeDrain('), source.indexOf('function makeOfflinePlayerSocket('));
const persistence = source.slice(source.indexOf('function persistActiveRooms('), source.indexOf('function restoreActiveRooms('));
let serializations = 0, commits = 0;
const delivered = [], writes = [], metrics = [];
const room = { code:'TEST', messages:[] };
const sandbox = {
  process, console, setImmediate, setTimeout, Promise,
  runtimeQueueActive:false, runtimeQueue:[], runtimeDrainWaiters:[], runtimeActionExecuting:false,
  roomRecoveryDirty:false, outbound:null, persistenceFailed:false, recoveryStoreLocked:false, shuttingDown:false,
  lastRuntimeBacklogWarning:0, lastRoomPersistenceWarning:0, RUNTIME_BATCH_MAX:32,
  rooms:new Map([['TEST',room]]), ACTIVE_ROOMS_FILE:'test-only.json', RECOVERY_STORE_FORMAT:'asoc-recovery-store', CURRENT_STORE_VERSION:2,
  playerStore:{storageHealthy:()=>true}, matchStore:{storageHealthy:()=>true},
  serializeRoomForRecovery:r=>{serializations++;return {messages:[...r.messages]};},
  failPersistence:e=>{throw e;},
  sendDurableFrame:(_,data)=>delivered.push(data),
  realtimeMetrics:{isMeasured:()=>true,record:(_,sample)=>metrics.push(sample)},
  durableIO:{
    begin(){},abort(){},writeJson:(_,data)=>writes.push(data),
    async commitAsync(){ commits++;assert.equal(delivered.length,0,'no frames before durable commit');await new Promise(r=>setTimeout(r,10)); }
  }
};
vm.createContext(sandbox);
vm.runInContext(queue+'\n'+persistence, sandbox);
(async()=>{
  for(let i=0;i<32;i++) sandbox.runtimeAction(()=>{
    room.messages.push(i); sandbox.persistActiveRooms();
    sandbox.outbound.push([{readyState:1},i]);
  },'chat:guess');
  await sandbox.drainRuntimeActions();
  assert.equal(serializations,1,'one recovery serialization per burst, not per message');
  assert.equal(commits,1);
  assert.equal(writes.length,1);
  assert.deepEqual(Array.from(writes[0].rooms[0].messages),Array.from({length:32},(_,i)=>i));
  assert.deepEqual(delivered,Array.from({length:32},(_,i)=>i),'all durable frames preserve mutation order');
  assert.equal(metrics.length,32);
  assert.ok(metrics.every(x=>x.queueToBroadcastMs>=x.persistenceMs));
  console.log('PASS runtime batching: 32 ordered actions, one serialization/commit, no early delivery, queue-inclusive metrics');
})().catch(e=>{console.error(e);process.exitCode=1;});
