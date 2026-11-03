"use strict";
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {createChatUploadGuard}=require('../chat-upload-guard');
const {storeImage}=require('../upload-io');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-async-media-'));
 try {
  const guard=createChatUploadGuard({dir,budgetBytes:1024,minFreeBytes:0,graceMs:0});
  const release=await guard.claimCapacity(1024);
  await assert.rejects(guard.claimCapacity(1),/storage is full/);release();
  const original=fs.writeFileSync;
  fs.writeFileSync=()=>{throw Error('synchronous disk write on main thread');};
  let url;
  try {url=await storeImage(dir,guard,Buffer.alloc(1024),'image/png',null,true);}finally{fs.writeFileSync=original;}
  const name=path.basename(url);assert.ok(fs.existsSync(path.join(dir,name+'.private')));
  assert.equal(guard.usedBytes(),1024);
  const kept=await guard.sweepAsync({texts:[url]});assert.equal(kept.removed.length,0);
  const removed=await guard.sweepAsync({now:Date.now()+100});assert.deepEqual(removed.removed,[name]);assert.equal(guard.usedBytes(),0);
  const open=fs.promises.open;
  fs.promises.open=async(file,...args)=>{
   const h=await open.call(fs.promises,file,...args);
   if(!String(file).endsWith('.private'))h.writeFile=async()=>{throw Error('simulated write failure');};
   return h;
  };
  try {await assert.rejects(storeImage(dir,guard,Buffer.alloc(1024),'image/png',null,true),/simulated write failure/);}finally{fs.promises.open=open;}
  assert.equal(guard.usedBytes(),0,'failed writes never consume durable capacity');
  const retry=await storeImage(dir,guard,Buffer.alloc(1024),'image/png',null,true);assert.ok(retry);
  console.log('PASS async image IO: bounded concurrent capacity, no synchronous writes, private marker, worker cleanup/accounting, failed-write recovery');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
