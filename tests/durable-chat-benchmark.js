// Compares the former one-file-via-WAL path with the optimized atomic target
// path under deterministic storage latency. Emits aggregate timings only.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const RUNS = 30;
const worker = `
 const fs=require('fs'),path=require('path');
 const io=require(${JSON.stringify(path.join(ROOT,'durable-io.js'))});
 const file=path.join(process.env.ASOC_DATA_DIR,'active-rooms.json'),samples=[];
 for(let i=0;i<${RUNS};i++){const s=process.hrtime.bigint();io.begin();io.writeJson(file,{revision:i,chat:{messages:[{id:String(i),text:'redacted benchmark'}]}});io.commit();samples.push(Number(process.hrtime.bigint()-s)/1e6);}
 samples.sort((a,b)=>a-b);const at=p=>samples[Math.min(samples.length-1,Math.ceil(samples.length*p)-1)];
 process.stdout.write(JSON.stringify({p50:at(.5),p95:at(.95),p99:at(.99),worst:samples.at(-1)}));
`;
function run(forceWal){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-durable-bench-'));try{return JSON.parse(execFileSync(process.execPath,['-e',worker],{cwd:ROOT,env:{...process.env,NODE_ENV:'test',ASOC_DATA_DIR:dir,ASOC_TEST_ATOMIC_DELAY_MS:'25',ASOC_TEST_FORCE_TRANSACTION_WAL:forceWal?'1':'0'},encoding:'utf8'}));}finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}}
const before=run(true),after=run(false);
assert.ok(after.p95 < before.p95 * .7, `expected material p95 reduction: ${JSON.stringify({before,after})}`);
console.log('PASS durable chat benchmark ' + JSON.stringify({runs:RUNS,simulatedAtomicLatencyMs:25,beforeWal:before,afterSingleAtomic:after}));
