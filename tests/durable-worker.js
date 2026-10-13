'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

function run(source, env = {}) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: 'test', ...env }, encoding: 'utf8'
  }).trim();
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-worker-durable-'));
try {
  const result = JSON.parse(run(`
    const fs=require('fs'),path=require('path'),io=require('./durable-io');
    const root=process.env.ASOC_DATA_DIR,file=path.join(root,'ordered.json');
    let ticks=0,maxGap=0,last=Date.now();
    const timer=setInterval(()=>{const now=Date.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},5);
    io.begin();io.writeJson(file,{revision:1});const first=io.commitAsync();
    io.begin();io.writeJson(file,{revision:2});const second=io.commitAsync();
    Promise.all([first,second]).then(async()=>{clearInterval(timer);const value=JSON.parse(fs.readFileSync(file,'utf8'));
      await io.closeWorker();console.log(JSON.stringify({ticks,maxGap,revision:value.revision,wal:fs.existsSync(path.join(root,'.runtime-transaction.json'))}));
    }).catch(error=>{console.error(error);process.exit(1)});
  `, { ASOC_DATA_DIR: data, ASOC_TEST_ATOMIC_DELAY_MS: '120' }));
  assert.equal(result.revision, 2, 'worker commits preserve submission order');
  assert.equal(result.wal, false, 'successful worker commit leaves no WAL');
  assert.ok(result.ticks >= 5, 'main event loop continued ticking during slow durable writes');
  assert.ok(result.maxGap < 80, `slow storage blocked the event loop for ${result.maxGap}ms`);

  const trigger = path.join(data, 'fail.trigger');
  fs.writeFileSync(trigger, 'fail');
  const failure = JSON.parse(run(`
    const path=require('path'),io=require('./durable-io');
    io.begin();io.writeJson(path.join(process.env.ASOC_DATA_DIR,'failure.json'),{mustNotLand:true});
    io.commitAsync().then(()=>process.exit(2)).catch(async error=>{const out={rejected:true,healthy:io.healthy(),code:error.code||''};await io.closeWorker();console.log(JSON.stringify(out));});
  `, { ASOC_DATA_DIR: data, ASOC_TEST_DURABILITY_FAIL_TRIGGER: trigger }));
  assert.deepEqual(failure, { rejected: true, healthy: false, code: 'EIO' }, 'worker storage failure is surfaced and poisons durability');
  fs.unlinkSync(trigger);

  const interrupted = JSON.parse(run(`
    const path=require('path'),io=require('./durable-io');
    io.begin();
    io.writeJson(path.join(process.env.ASOC_DATA_DIR,'interrupted.json'),{revision:4});
    const commit=io.commitAsync().then(()=>({resolved:true}),error=>({rejected:true,message:error.message}));
    io.closeWorker().then(async()=>{const result=await commit; console.log(JSON.stringify(result));})
      .catch(error=>{console.error(error);process.exitCode=1});
  `, { ASOC_DATA_DIR: data, ASOC_TEST_ATOMIC_DELAY_MS: '120' }));
  assert.equal(interrupted.rejected,true,'closed worker cannot leave an unacknowledged request hanging');

  const recoveryTarget = path.join(data, 'recovered.json');
  fs.writeFileSync(path.join(data, '.runtime-transaction.json'), JSON.stringify({version:1,writes:[[recoveryTarget,JSON.stringify({recovered:true})]]}));
  const recovery = JSON.parse(run(`
    const fs=require('fs'),path=require('path');require('./durable-io');const root=process.env.ASOC_DATA_DIR;
    console.log(JSON.stringify({value:JSON.parse(fs.readFileSync(path.join(root,'recovered.json'),'utf8')),wal:fs.existsSync(path.join(root,'.runtime-transaction.json'))}));
  `, { ASOC_DATA_DIR: data }));
  assert.deepEqual(recovery, { value: { recovered: true }, wal: false }, 'startup replays a committed partial WAL');
  console.log('PASS durable worker: ordered commits, responsive event loop, failure propagation, partial-WAL recovery');
} finally {
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
