'use strict';
const assert=require('node:assert/strict');
const H=require('./lib/browser-harness');
const WebSocket=require('ws');
const PORT=Number(process.env.ASOC_P0_GM_BURST_PORT)||19029;
const PLAYERS=Math.max(5,Math.min(30,Number(process.env.ASOC_P0_GM_BURST_CLIENTS)||20));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class Client{
 constructor(name){this.name=name;this.messages=[];this.ws=null;}
 async open(){
  this.ws=new WebSocket('ws://127.0.0.1:'+PORT);
  this.ws.on('message',bytes=>{
   const msg=JSON.parse(bytes.toString());
   if(msg.type==='protocol:hello'){this.send({type:'protocol:hello',protocolVersion:1,capabilities:['chat:delta']});return;}
   this.messages.push({msg,at:Date.now()});
  });
  await this.wait(m=>m.type==='protocol:ready',8000);
  return this;
 }
 send(m){this.ws.send(JSON.stringify(m));}
 mark(){return this.messages.length;}
 async wait(pred,timeout=9000,from=0){
  const start=Date.now();
  while(Date.now()-start<timeout){
   const entry=this.messages.slice(from).find(e=>pred(e.msg));
   if(entry)return entry;
   await sleep(10);
  }
  throw Error(this.name+' timed out; recent types: '+this.messages.slice(-14).map(e=>e.msg.type).join(','));
 }
 close(){try{this.ws?.terminate()}catch{}}
}
(async()=>{
 const server=await H.startServer({port:PORT,env:{NODE_ENV:'test',ASOC_TEST_ATOMIC_DELAY_MS:process.env.ASOC_P0_SIMULATED_DISK_MS ?? '200',ASOC_RUNTIME_BATCH_MAX:'32', ASOC_REALTIME_METRICS_EVERY:'1'}});
 const connections=[];
 try{
  const gmToken=(await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'})).data.token;
  assert.ok(gmToken);
  const gm=await new Client('GM').open();connections.push(gm);
  gm.send({type:'host:recover',gmToken});
  await gm.wait(m=>m.type==='host:recovered');
  const clients=[];
  for(let i=0;i<PLAYERS;i++){
   const name='P0 Hero '+i;
   const token=await H.heroToken(server,name);
   const p=await new Client(name).open();connections.push(p);
   p.send({type:'room:join',authToken:token,roomCode:'MASTER',name});
   await p.wait(m=>m.type==='join:success');
   clients.push(p);
  }
  gm.send({type:'gm:setRoomMode',mode:'BATTLE'});
  await sleep(400); // Match scoring-audit's tested battle-mode startup sequence.
  for(let i=0;i<5;i++)clients[i].send({type:'ritual:join'});
  await gm.wait(m=>m.type==='ritual:gmUpdate'&&m.ritual?.joinedCount===5);
  gm.send({type:'gm:timerLaunchCountdown'});await sleep(200);
  gm.send({type:'gm:timerStart'});
  await gm.wait(m=>m.type==='state:public'&&m.timer?.phase==='running');
  gm.send({type:'gm:command',command:'revealCell',payload:{cell:'A1',reveal:true},cmdId:'gm-burst-reveal'});
  await gm.wait(m=>m.type==='state:public'&&m.cells?.A1?.revealed===true);
  const text='gm-burst-target-'+Date.now();
  const from=gm.mark();
  clients[0].send({type:'chat:guess',text});
  const target=await gm.wait(m=>(m.type==='chat:delta'||m.type==='chat:update')&&m.messages?.some(x=>x.text===text),8000,from);
  const message=target.msg.messages.find(x=>x.text===text);
  assert.ok(message?.id);
  const others=clients.slice(1).map((c,i)=>'gm-burst-other-'+i+'-'+Date.now());
  const start=Date.now(), index=gm.mark();
  clients.slice(1).forEach((c,i)=>c.send({type:'chat:guess',text:others[i]}));
  gm.send({type:'gm:judgeGuess',messageId:message.id,verdict:'correct',target:'A'});
  const ack=await gm.wait(m=>m.type==='gm:judge:ack'||m.type==='error',7000,index);
  assert.equal(ack.msg.type,'gm:judge:ack',JSON.stringify(ack.msg));
  const all=await gm.wait(m=>(m.type==='chat:delta'||m.type==='chat:update')&&m.messages?.some(x=>x.text===others[others.length-1]),7000,index);
  const allReceipts=others.map(text=>gm.messages.slice(index).filter(e=>(e.msg.type==='chat:delta'||e.msg.type==='chat:update')&&e.msg.messages?.some(m=>m.text===text)));
  assert.ok(allReceipts.every(r=>r.length>0),'all concurrent guesses were delivered to GM');
  const judgeMs=ack.at-start, batchMs=all.at-start;
  assert.ok(judgeMs<2500,'GM verdict delayed '+judgeMs+'ms');
  assert.ok(batchMs<2500,'concurrent guesses delayed '+batchMs+'ms');
  if (process.env.ASOC_TEST_CAPTURE_REALTIME === '1') {
    const stats=server.output().split(/\r?\n/).filter(line=>line.startsWith('[realtime-performance]'))
      .map(line=>{try{return JSON.parse(line.slice('[realtime-performance] '.length))}catch{return null}})
      .filter(x=>x?.operation==='gm:judgeGuess');
    console.log('GM_DETAILED_METRICS',JSON.stringify(stats.slice(-2)));
  }
  console.log('PASS Persistence V2 '+PLAYERS+' clients + CORRECT: GM ACK '+judgeMs+'ms; player burst '+batchMs+'ms, injected disk '+(process.env.ASOC_P0_SIMULATED_DISK_MS ?? '200')+'ms');
 }finally{connections.forEach(c=>c.close());await server.stop()}
})().catch(error=>{console.error('FAIL GM concurrent-burst regression:',error);process.exitCode=1});
