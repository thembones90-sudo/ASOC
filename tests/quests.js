// SHADOW CONTRACTS: transition rules plus server-authoritative, private live flow.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const engine = require('../quest-engine');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.ASOC_QUEST_TEST_PORT) || 18831;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-quests-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function unitChecks() {
  const target={id:'acct-target',name:'Target'};
  assert.ok(engine.validateCreate({directive:'',rewardCoins:1,durationMs:30000,visibility:'PRIVATE'}).error);
  assert.ok(engine.validateCreate({directive:'x',rewardCoins:0,durationMs:30000,visibility:'PRIVATE'}).error);
  assert.ok(engine.validateCreate({directive:'x',rewardCoins:50.1,durationMs:30000,visibility:'PRIVATE'}).error);
  assert.ok(engine.validateCreate({directive:'x',rewardCoins:1.11,durationMs:30000,visibility:'PRIVATE'}).error);
  assert.ok(engine.validateCreate({directive:'x',rewardCoins:1,durationMs:29999,visibility:'PRIVATE'}).error);
  assert.ok(engine.validateCreate({directive:'x',rewardCoins:1,durationMs:86400001,visibility:'PRIVATE'}).error);
  const made=engine.create({directive:'Do the thing',rewardCoins:3,durationMs:60000,visibility:'PRIVATE'},target,1000).quest;
  assert.equal(made.status,'OFFERED'); assert.equal(made.deadline,null); assert.equal(made.acceptedAt,null);
  const state={active:{[made.id]:made},history:[]};
  assert.equal(engine.transition(state,made.id,'CLAIMED',1100).error.startsWith('INVALID'),true);
  engine.transition(state,made.id,'ACTIVE',2000); assert.equal(made.deadline,62000);
  engine.transition(state,made.id,'CLAIMED',3000); const deadline=made.deadline;
  engine.transition(state,made.id,'ACTIVE',4000); assert.equal(made.deadline,deadline,'rejected claim never resets timer');
  engine.transition(state,made.id,'CLAIMED',5000);
  assert.deepEqual(engine.expire(state,62000).map(q=>q.status),['EXPIRED']);
  assert.equal(state.history[0].rewardReceipt,null,'expired quests pay nothing');
  const restored=engine.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.history[0].deadline,62000,'absolute deadline survives serialization');
}

function api(route, body) { return new Promise((resolve,reject)=>{ const req=http.request({host:'127.0.0.1',port:PORT,path:route,method:body?'POST':'GET',headers:{'content-type':'application/json'}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(text)})}catch{resolve({status:res.statusCode,data:text})}})});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end(); }); }

class Client {
  constructor(name){this.name=name;this.msgs=[];this.chat=[];this.players=[];}
  async open(){await new Promise((resolve,reject)=>{this.ws=new WebSocket(`ws://127.0.0.1:${PORT}`);this.ws.once('error',reject);this.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='protocol:hello')return this.send({type:'protocol:hello',protocolVersion:1});if(m.type==='protocol:ready')return resolve();this.msgs.push(m);if(m.type==='chat:update')this.chat=m.messages||[];if(m.type==='players:update')this.players=m.players||[];if(m.type==='join:success')this.playerId=m.playerId;});});return this;}
  send(m){this.ws.send(JSON.stringify(m));}
  async wait(predicate,label,since=0,timeout=6000){const start=Date.now();while(Date.now()-start<timeout){const hit=this.msgs.slice(since).find(predicate);if(hit)return hit;await sleep(20);}throw new Error(`${this.name}: timed out waiting for ${label}`);}
  close(){try{this.ws.close()}catch{}}
}

function startServer(){const s=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),ASOC_DATA_DIR:DATA,ASOC_GM_PASSWORD:'quest-pass',ASOC_EMAIL_VERIFICATION:'0'},stdio:['ignore','ignore','pipe']});s.errors='';s.stderr.on('data',c=>s.errors+=c);return s;}
async function healthy(){for(let i=0;i<80;i++){try{if((await api('/health')).status===200)return}catch{}await sleep(125)}throw new Error('quest server did not become healthy');}
async function stopServer(server){if(!server||server.exitCode!=null)return;server.kill();await Promise.race([new Promise(r=>server.once('exit',r)),sleep(3000)]);}

async function runLive(){
  let server=startServer(); const clients=[];
  const connectGM=async()=>{const token=(await api('/api/auth/gm/login',{password:'quest-pass'})).data.token;const c=await new Client('GM').open();clients.push(c);c.send({type:'host:recover',gmToken:token});await c.wait(m=>m.type==='host:recovered','host recovery');return c;};
  const connectPlayer=async(name,creds)=>{const token=(await api('/api/auth/player/login',creds)).data.token;const c=await new Client(name).open();clients.push(c);c.send({type:'room:join',authToken:token,roomCode:'MASTER',name});await c.wait(m=>m.type==='join:success','join');return c;};
  try {
    await healthy();
    const targetCreds={email:'target@quest.test',password:'quest-password'};
    const otherCreds={email:'other@quest.test',password:'quest-password'};
    await api('/api/auth/player/register',{...targetCreds,name:'Target'});
    await api('/api/auth/player/register',{...otherCreds,name:'Other'});
    let gm=await connectGM(), target=await connectPlayer('Target',targetCreds), other=await connectPlayer('Other',otherCreds);
    await sleep(200);

    let mark=gm.msgs.length;
    gm.send({type:'gm:questCreate',targetPlayerId:'missing',directive:'No target',rewardCoins:1,durationMs:30000,visibility:'PRIVATE'});
    assert.match((await gm.wait(m=>m.type==='quest:error','missing target',mark)).message,/ONLINE AUTHENTICATED/);

    const createMark={gm:gm.msgs.length,target:target.msgs.length,other:other.msgs.length};
    gm.send({type:'gm:questCreate',targetPlayerId:target.playerId,directive:'PRIVATE SECRET DIRECTIVE',rewardCoins:3,durationMs:60000,visibility:'PRIVATE'});
    const gmOffer=await gm.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.directive==='PRIVATE SECRET DIRECTIVE'),'GM private offer',createMark.gm);
    const quest=gmOffer.active.find(q=>q.directive==='PRIVATE SECRET DIRECTIVE');
    const targetOffer=await target.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===quest.id),'target private offer',createMark.target);
    assert.equal(targetOffer.active[0].deadline,null,'timer is absent before accept');
    const unrelated=await other.wait(m=>m.type==='quest:update','unrelated filtered update',createMark.other);
    assert.deepEqual(unrelated.active,[]);assert.doesNotMatch(JSON.stringify(unrelated),/PRIVATE SECRET DIRECTIVE/);

    mark=other.msgs.length;other.send({type:'player:questAccept',questId:quest.id});
    assert.match((await other.wait(m=>m.type==='quest:error','foreign accept rejected',mark)).message,/OWN SHADOW CONTRACT/);
    const acceptedAt=Date.now();mark=target.msgs.length;target.send({type:'player:questAccept',questId:quest.id});
    const active=(await target.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===quest.id&&q.status==='ACTIVE'),'accepted',mark)).active.find(q=>q.id===quest.id);
    assert.ok(active.deadline>=acceptedAt+59000&&active.deadline<=Date.now()+60500,'accept starts an absolute duration');
    assert.equal(target.chat.some(m=>/PRIVATE SECRET DIRECTIVE|QUEST ACCEPTED/.test(m.text||'')),false,'private acceptance makes no public card');

    mark=target.msgs.length;target.send({type:'player:questClaim',questId:quest.id});
    await target.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===quest.id&&q.status==='CLAIMED'),'claim',mark);
    mark=gm.msgs.length;gm.send({type:'gm:questRejectClaim',questId:quest.id});
    const rejected=(await gm.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===quest.id&&q.status==='ACTIVE'),'claim rejection',mark)).active.find(q=>q.id===quest.id);
    assert.equal(rejected.deadline,active.deadline,'server preserves deadline after rejected claim');

    const coinsBefore=target.players.find(p=>p.id===target.playerId)?.shadowCoins||0;
    target.send({type:'player:questClaim',questId:quest.id});await target.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===quest.id&&q.status==='CLAIMED'),'second claim');
    mark=gm.msgs.length;gm.send({type:'gm:questComplete',questId:quest.id});
    await gm.wait(m=>m.type==='quest:update'&&m.history.some(q=>q.id===quest.id&&q.status==='COMPLETED'),'completion',mark);
    await gm.wait(m=>m.type==='players:update'&&m.players.some(p=>p.id===target.playerId&&p.shadowCoins===coinsBefore+3),'exact reward',mark);
    mark=gm.msgs.length;gm.send({type:'gm:questComplete',questId:quest.id});
    assert.match((await gm.wait(m=>m.type==='quest:error','repeat complete rejected',mark)).message,/ALREADY RESOLVED/);

    // A public contract exposes player + reward, never directive; a classified one exposes neither.
    const issueAccept=async(visibility,directive)=>{const start=gm.msgs.length;gm.send({type:'gm:questCreate',targetPlayerId:target.playerId,directive,rewardCoins:1,durationMs:60000,visibility});const u=await gm.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.directive===directive),'offer '+visibility,start);const q=u.active.find(x=>x.directive===directive);const tm=target.msgs.length;target.send({type:'player:questAccept',questId:q.id});await target.wait(m=>m.type==='quest:update'&&m.active.some(x=>x.id===q.id&&x.status==='ACTIVE'),'accept '+visibility,tm);return q;};
    const publicQ=await issueAccept('PUBLIC','PUBLIC HIDDEN DIRECTIVE');await sleep(150);const publicCard=other.chat.find(m=>/QUEST ACCEPTED/.test(m.text||'')&&/Target/.test(m.text||''));assert.ok(publicCard);assert.match(publicCard.text,/1 SC/);assert.doesNotMatch(publicCard.text,/PUBLIC HIDDEN DIRECTIVE/);
    const classifiedQ=await issueAccept('CLASSIFIED','CLASSIFIED HIDDEN DIRECTIVE');await sleep(150);const classified=other.chat.find(m=>/CLASSIFIED QUEST ACCEPTED/.test(m.text||''));assert.ok(classified);assert.doesNotMatch(classified.text,/Target|1 SC|CLASSIFIED HIDDEN DIRECTIVE/);

    // Cancel pays nothing; leave the public quest active for reconnect/restart checks.
    const beforeCancel=gm.players.find(p=>p.id===target.playerId)?.shadowCoins;
    mark=gm.msgs.length;gm.send({type:'gm:questCancel',questId:classifiedQ.id});await gm.wait(m=>m.type==='quest:update'&&m.history.some(q=>q.id===classifiedQ.id&&q.status==='CANCELLED'),'cancel',mark);assert.equal(gm.players.find(p=>p.id===target.playerId)?.shadowCoins,beforeCancel);
    mark=gm.msgs.length;gm.send({type:'quest:sync'});const originalDeadline=(await gm.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===publicQ.id&&q.status==='ACTIVE'),'active before reconnect',mark)).active.find(q=>q.id===publicQ.id).deadline;

    target.close();await sleep(150);target=await connectPlayer('Target',targetCreds);const reconnect=await target.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===publicQ.id),'reconnect restore');assert.equal(reconnect.active.find(q=>q.id===publicQ.id).deadline,originalDeadline);

    clients.forEach(c=>c.close());await sleep(100);await stopServer(server);server=startServer();await healthy();gm=await connectGM();target=await connectPlayer('Target',targetCreds);
    const restarted=await gm.wait(m=>m.type==='quest:update'&&m.active.some(q=>q.id===publicQ.id),'restart restore');assert.equal(restarted.active.find(q=>q.id===publicQ.id).deadline,originalDeadline,'restart never refreshes deadline');assert.ok(restarted.history.some(q=>q.id===quest.id&&q.status==='COMPLETED'),'history survives restart');
    assert.equal(server.errors.trim(),'','no server errors');
  } finally { clients.forEach(c=>c.close()); await stopServer(server); fs.rmSync(DATA,{recursive:true,force:true}); }
}

(async()=>{unitChecks();await runLive();console.log('QUESTS tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
