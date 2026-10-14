'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const WebSocket=require('ws');
const ROOT=path.join(__dirname,'..');
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-mudpits-live-'));
const PORT=19171;
const delay=n=>new Promise(r=>setTimeout(r,n));
let logs='';
function boot(){ const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),ASOC_DATA_DIR:DATA,ASOC_GM_PASSWORD:'mudpits-pass',ASOC_EMAIL_VERIFICATION:'0',ASOC_MUD_PITS_WRITE_MS:'5000',ASOC_MUD_PITS_READ_MS:'200',ASOC_MUD_PITS_VOTE_MS:'700',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']}); child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);return child; }
let server=boot();
async function restart(){await new Promise(resolve=>{server.once('exit',resolve);server.kill();});server=boot();for(let i=0;i<60;i++){try{if((await api('/health')).status===200)return;}catch{}await delay(100);}throw Error('restart failed');}
function api(url,body){return new Promise((ok,no)=>{const req=http.request({host:'127.0.0.1',port:PORT,path:url,method:body?'POST':'GET',headers:{'content-type':'application/json'}},res=>{let txt='';res.on('data',c=>txt+=c);res.on('end',()=>{try{ok({status:res.statusCode,data:JSON.parse(txt)})}catch{ok({status:res.statusCode,data:txt})}})});req.on('error',no);if(body)req.write(JSON.stringify(body));req.end()})}
class Client{
  constructor(name){this.name=name;this.msgs=[]}
  async open(){return new Promise((resolve,reject)=>{this.ws=new WebSocket('ws://127.0.0.1:'+PORT);const timeout=setTimeout(()=>reject(Error(this.name+' socket timeout')),5000);this.ws.on('error',reject);this.ws.on('message',x=>{let m;try{m=JSON.parse(x.toString())}catch{return}if(m.type==='protocol:hello'){this.send({type:'protocol:hello',protocolVersion:1});return}if(m.type==='protocol:ready'){clearTimeout(timeout);resolve(this);return}this.msgs.push(m);if(m.type==='join:success')this.id=m.playerId});})}
  send(x){this.ws.send(JSON.stringify(x))}
  mark(){return this.msgs.length}
  async wait(type,from=0,timeout=3500){const end=Date.now()+timeout;while(Date.now()<end){let m=this.msgs.slice(from).find(x=>typeof type==='function'?type(x):x.type===type);if(m)return m;await delay(15)}throw Error(this.name+' timed out on '+type+' recent='+JSON.stringify(this.msgs.slice(-5)).slice(0,600))}
  close(){try{this.ws.terminate()}catch{}}
}
(async()=>{
 const clients=[];
 try {
  let ready=false;
  for(let i=0;i<60;i++){try{if((await api('/health')).status===200){ready=true;break}}catch{}await delay(100)}
  assert.ok(ready,'Server health ready');
  const login=await api('/api/auth/gm/login',{password:'mudpits-pass'});
  assert.ok(login.data.token,'GM login token');
  const gm=await new Client('gm').open();clients.push(gm);
  gm.send({type:'host:recover',gmToken:login.data.token});
  await gm.wait('host:recovered');
  const players=[];
  for(const name of ['Alpha','Beta','Voter','Watcher']){
   const registration=await api('/api/auth/player/register',{email:name.toLowerCase()+'@mudpits.test',password:'strong-test-password',name});
   assert.ok(registration.data.token,'register '+name);
   const p=await new Client(name).open();clients.push(p);
   p.send({type:'room:join',authToken:registration.data.token,roomCode:'MASTER',name});
   await p.wait('join:success');players.push(p);
  }
  const [a,b,v,w]=players;
  const startMark=gm.mark();gm.send({type:'mudpits:start',contestantIds:[a.id,b.id]});
  const state=(await gm.wait('mudpits:state',startMark)).state;
  assert.equal(state.phase,'WRITING');assert.equal(state.entries,null);
  let specMark=w.mark(),oneMark=gm.mark();
  a.send({type:'mudpits:submit',text:'A secret dagger'});
  await gm.wait('mudpits:state',oneMark);
  for(const c of clients) assert.ok(!JSON.stringify(c.msgs).includes('A secret dagger'),c.name+' leaked sealed text');
  const revealMark=w.mark();b.send({type:'mudpits:submit',text:'B secret insult'});
  const reveal=(await w.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='REVEAL',revealMark)).state;
  assert.ok(reveal.entries.some(x=>x.text==='A secret dagger'));
  const voteMark=v.mark();
  await v.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='VOTING',voteMark);
  const vMark=v.mark();v.send({type:'mudpits:vote',contestantId:a.id});
  await v.wait('mudpits:state',vMark);
  const duplicateMark=v.mark();v.send({type:'mudpits:vote',contestantId:b.id});
  await v.wait('mudpits:error',duplicateMark);
  const invalidMark=a.mark();a.send({type:'mudpits:vote',contestantId:a.id});await a.wait('mudpits:error',invalidMark);
  const result=(await gm.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='RESULT',startMark)).state;
  assert.equal(result.winnerId,a.id);assert.equal(result.awarded,true);
  const profiles=()=>JSON.parse(fs.readFileSync(path.join(DATA,'players.json'),'utf8'));
  assert.equal(profiles()[a.id].shadowCoins,1,'winner gets exactly one persisted coin');
  gm.send({type:'mudpits:sync'});await delay(50);
  assert.equal(profiles()[a.id].shadowCoins,1,'sync cannot duplicate payout');
  const gmMark=gm.mark();gm.send({type:'mudpits:start',contestantIds:['__GM__',b.id]});
  const gmRound=(await gm.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='WRITING',gmMark)).state;
  assert.ok(gmRound.viewer.canSubmit,'GM can be fighter');
  gm.send({type:'mudpits:submit',text:'The house strikes first'});b.send({type:'mudpits:submit',text:'The challenger stands tall'});
  await v.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='VOTING'&&m.state?.id===gmRound.id);
  v.send({type:'mudpits:vote',contestantId:'__GM__'});
  await gm.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='RESULT'&&m.state?.id===gmRound.id);
  assert.equal(profiles().__GM__.shadowCoins,1,'GM duel victory also pays exactly one coin');
  // Simulate a restart between durable payout and saved awarded flag.
  for(const c of clients)c.close();
  await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
  const snapshotFile=path.join(DATA,'active-rooms.json');const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));
  snapshot.rooms[0].mudpits.awarded=false;snapshot.rooms[0].mudpits.awardedTo=null;
  fs.writeFileSync(snapshotFile,JSON.stringify(snapshot));server=boot();
  for(let i=0;i<60;i++){try{if((await api('/health')).status===200)break;}catch{}await delay(100);}
  const login2=await api('/api/auth/gm/login',{password:'mudpits-pass'});
  const gm2=await new Client('gm-restart').open();clients.push(gm2);gm2.send({type:'host:recover',gmToken:login2.data.token});await gm2.wait('host:recovered');
  gm2.send({type:'mudpits:sync'});await gm2.wait(m=>m.type==='mudpits:state'&&m.state?.awarded);
  assert.equal(profiles().__GM__.shadowCoins,1,'restart retry cannot duplicate reward receipt');
  const bLogin=await api('/api/auth/player/login',{email:'beta@mudpits.test',password:'strong-test-password'});
  const b2=await new Client('beta-restart').open();clients.push(b2);b2.send({type:'room:join',authToken:bLogin.data.token,roomCode:'MASTER',name:'Beta'});await b2.wait('join:success');
  gm2.send({type:'mudpits:start',contestantIds:['__GM__',b2.id]});
  const active=(await gm2.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='WRITING')).state;
  b2.send({type:'mudpits:draft',duelId:active.id,text:'A recoverable private draft'});await delay(100);
  gm2.close();b2.close();await restart();
  const b3=await new Client('beta-active-restart').open();clients.push(b3);b3.send({type:'room:join',authToken:bLogin.data.token,roomCode:'MASTER',name:'Beta'});await b3.wait('join:success');
  const recovered=(await b3.wait(m=>m.type==='mudpits:state'&&m.state?.id===active.id)).state;
  assert.equal(recovered.viewer.myDraft,'A recoverable private draft');assert.equal(recovered.entries,null);
  const login3=await api('/api/auth/gm/login',{password:'mudpits-pass'});const gm3=await new Client('gm-active-restart').open();clients.push(gm3);gm3.send({type:'host:recover',gmToken:login3.data.token});await gm3.wait('host:recovered');
  gm3.send({type:'mudpits:cancel',duelId:active.id});await gm3.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='CANCELLED');
  console.log('PASS real sockets: privacy, voting, exact payout, GM duel, reconnect, draft recovery, restart-safe duplicate award, cancel');
 } catch(err){console.error('FAIL MUD PITS INTEGRATION',err.stack);console.error(logs.slice(-1200));process.exitCode=1}
 finally {for(const c of clients)c.close();server.kill();setTimeout(()=>{try{server.kill('SIGKILL')}catch{}},1500).unref();try{fs.rmSync(DATA,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch{}}
})();
