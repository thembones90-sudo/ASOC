'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const base=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-wal-crash-'));
function run(src,env={}){return execFileSync(process.execPath,['-e',src],{cwd:base,env:{...process.env,NODE_ENV:'test',ASOC_DATA_DIR:dir,...env},encoding:'utf8',timeout:12000}).trim()}
try{
 const result=JSON.parse(run(`
 const io=require('./durable-io'),path=require('node:path');
 const dir=process.env.ASOC_DATA_DIR;
 io.begin();io.writeJson(path.join(dir,'room.json'),{revision:19});
 io.writeJson(path.join(dir,'score.json'),{coins:4});
 io.commitAsync().then(()=>{console.log(JSON.stringify({bad:true}));process.exit(2)},err=>{
  console.log(JSON.stringify({rejected:true,healthy:io.healthy(),message:err.message.slice(0,70)}));
  process.exit(0);
 });
 `,{ASOC_TEST_WORKER_CRASH_AFTER_WAL:'1'}));
 assert.equal(result.rejected,true,'worker crash must not acknowledge an uncommitted transaction');
 assert.equal(result.healthy,false,'worker crash must poison live persistence');
 assert.ok(fs.existsSync(path.join(dir,'.runtime-transaction.json')),'WAL must survive worker exit');
 const recovered=JSON.parse(run(`
 const fs=require('node:fs'),path=require('node:path'),dir=process.env.ASOC_DATA_DIR;
 require('./durable-io');
 console.log(JSON.stringify({room:JSON.parse(fs.readFileSync(path.join(dir,'room.json'))),
 score:JSON.parse(fs.readFileSync(path.join(dir,'score.json'))),
 journal:fs.existsSync(path.join(dir,'.runtime-transaction.json'))}));
 `));
 assert.deepEqual(recovered,{room:{revision:19},score:{coins:4},journal:false});
 const repeat=JSON.parse(run(`
 const fs=require('node:fs'),path=require('node:path'),dir=process.env.ASOC_DATA_DIR;
 require('./durable-io');console.log(JSON.stringify({room:JSON.parse(fs.readFileSync(path.join(dir,'room.json'))),
 score:JSON.parse(fs.readFileSync(path.join(dir,'score.json')))}));
 `));
 assert.deepEqual(repeat,{room:{revision:19},score:{coins:4}});
 console.log('PASS worker WAL crash: no premature ACK, restart restores both stores, idempotent subsequent restart');
}finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50})}
