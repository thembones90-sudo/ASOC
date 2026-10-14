'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const WebSocket=require('ws');
const ROOT=path.join(__dirname,'..');
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-mudpits-live-'));
const PORT=19171;
const delay=n=>new Promise(r=>setTimeout(r,n));
const server=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),ASOC_DATA_DIR:DATA,ASOC_GM_PASSWORD:'mudpits-pass',ASOC_EMAIL_VERIFICATION:'0',ASOC_MUD_PITS_WRITE_MS:'1200',ASOC_MUD_PITS_READ_MS:'200',ASOC_MUD_PITS_VOTE_MS:'700',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
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
  const gmMark=gm.mark();gm.send({type:'mudpits:start',contestantIds:['__GM__',b.id]});
  const gmRound=(await gm.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='WRITING',gmMark)).state;
  assert.ok(gmRound.viewer.canSubmit,'GM can be fighter');
  gm.send({type:'mudpits:cancel'});
  await gm.wait(m=>m.type==='mudpits:state'&&m.state?.phase==='CANCELLED',gmMark);
  console.log('PASS real sockets, auth, 4 players, privacy, reveal, voting, duplicate, result, reward and GM entry');
 } catch(err){console.error('FAIL MUD PITS INTEGRATION',err.stack);console.error(logs.slice(-1200));process.exitCode=1}
 finally {for(const c of clients)c.close();server.kill();setTimeout(()=>{try{server.kill('SIGKILL')}catch{}},1500).unref();try{fs.rmSync(DATA,{recursive:true,force:true,maxRetries:5,retryDelay:100})}catch{}}
})();
