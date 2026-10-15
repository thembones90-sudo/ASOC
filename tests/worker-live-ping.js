'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http'),{spawn}=require('node:child_process'),WebSocket=require('ws');
const ROOT=path.resolve(__dirname,'..'),PORT=18932;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,body) {
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:PORT,path:route,method:body?'POST':'GET',
   headers:{'content-type':'application/json'}},res=>{
    let content='';res.on('data',d=>content+=d);res.on('end',()=>{try{resolve(JSON.parse(content))}catch{resolve(content)}});
   });
  req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
 });
}
async function waitFor(predicate,timeout=10000){
 const start=Date.now();
 while(Date.now()-start<timeout){const val=predicate();if(val)return val;await delay(10)}
 throw new Error('Timed out waiting for expected response');
}
(async()=>{
 const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-ping-worker-'));
 const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{
  ...process.env,NODE_ENV:'test',PORT:String(PORT),ASOC_DATA_DIR:DATA,
  ASOC_GM_PASSWORD:'test-only-gm',ASOC_EMAIL_VERIFICATION:'0',ASOC_TEST_ATOMIC_DELAY_MS:'600'
 },stdio:['ignore','pipe','pipe']});
 let socket;let logs='';
 child.stderr.on('data',v=>logs+=v.toString());
 try{
  await waitFor(async()=>false,1).catch(()=>{});
  let health=false;
  for(let i=0;i<120;i++){try{const r=await api('/health');if(r?.status==='ready'){health=true;break}}catch{} await delay(100)}
  assert.ok(health,'test server ready');
  const login=await api('/api/auth/gm/login',{password:'test-only-gm'});
  assert.ok(login.token,'GM authentication succeeded');
  const events=[];
  socket=new WebSocket('ws://127.0.0.1:'+PORT);
  socket.on('message',d=>{const m=JSON.parse(d.toString());if(m.type==='protocol:hello')socket.send(JSON.stringify({type:'protocol:hello',protocolVersion:1}));events.push({m,at:Date.now()})});
  await waitFor(()=>events.some(e=>e.m.type==='protocol:ready'));
  socket.send(JSON.stringify({type:'host:recover',gmToken:login.token}));
  await waitFor(()=>events.some(e=>e.m.type==='host:recovered'));
  await delay(200);
  const before=Date.now();
  socket.send(JSON.stringify({type:'gm:broadcast',text:'Latency worker fixture message'}));
  await delay(100);
  const pingAt=Date.now();
  socket.send(JSON.stringify({type:'client:ping',id:'latency-check'}));
  const pong=await waitFor(()=>events.find(e=>e.m.type==='server:pong'&&e.m.id==='latency-check'),1800);
  const secondAt=Date.now();
  socket.send(JSON.stringify({type:'gm:broadcast',text:'Second ordered worker message'}));
  const chat=await waitFor(()=>events.find(e=>e.m.type==='chat:update'&&e.m.messages?.some(m=>m.text==='Latency worker fixture message')),4500);
  const secondChat=await waitFor(()=>events.find(e=>e.m.type==='chat:update'&&e.m.messages?.some(m=>m.text==='Second ordered worker message')),5500);
  assert.ok(secondChat.at>=chat.at,'new socket action overtook an in-flight durable commit');
  assert.ok(secondChat.at-secondAt>=350,'second action was sent before its own slow durable commit');
  assert.ok(pong.at-pingAt<350,'pong waited behind slow durable commit ('+(pong.at-pingAt)+'ms)');
  assert.ok(chat.at>=before,'chat was not emitted before its send');
  const burstSent=Date.now();
  const burst=Array.from({length:12},(_,i)=>'Worker burst '+i);
  for (const text of burst) socket.send(JSON.stringify({type:'gm:broadcast',text}));
  const burstReplies=await Promise.all(burst.map(text=>waitFor(()=>events.find(e=>e.m.type==='chat:update'&&e.m.messages?.some(m=>m.text===text)),7000)));
  const latencies=burstReplies.map(e=>e.at-burstSent).sort((a,b)=>a-b);
  assert.ok(latencies[latencies.length-1]<4000,'bounded burst exceeded 4s under slow durable writes');
  console.log('PASS async durable protocol response:',JSON.stringify({pongMs:pong.at-pingAt,chatMs:chat.at-before,burst12P95Ms:latencies[Math.ceil(latencies.length*.95)-1],burst12MaxMs:latencies[latencies.length-1]}));
 }finally{
  try{socket?.terminate()}catch{}child.kill('SIGTERM');
  await delay(500);if(child.exitCode===null)child.kill('SIGKILL');
  fs.rmSync(DATA,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
})().catch(e=>{console.error('FAIL async durable protocol response',e);process.exitCode=1});
