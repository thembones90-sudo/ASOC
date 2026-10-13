// Live adversarial boundary test: an ordinary authenticated player forges every
// Reliquary command and knows the exact private upload URL. None may disclose or
// mutate the vault; the authenticated GM can still inspect it after unlocking.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-reliquary-attack-'));
const PORT = Number(process.env.ASOC_RELIQUARY_TEST_PORT) || 18917;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PNG = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(64, 7)]);

function request(method, urlPath, body, headers={}) { return new Promise((resolve,reject)=>{ const req=http.request({host:'127.0.0.1',port:PORT,path:urlPath,method,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const raw=Buffer.concat(chunks);let data=raw.toString();try{data=JSON.parse(data);}catch{}resolve({status:res.statusCode,data});});});req.on('error',reject);if(body)req.write(body);req.end();}); }
const json=(p,b,h={})=>request('POST',p,Buffer.from(JSON.stringify(b)),{'content-type':'application/json',...h});
class Client { constructor(name){this.name=name;this.msgs=[];} open(){return new Promise((resolve,reject)=>{this.ws=new WebSocket(`ws://127.0.0.1:${PORT}`);this.ws.once('error',reject);this.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='protocol:hello')return this.send({type:'protocol:hello',protocolVersion:1});if(m.type==='protocol:ready')return resolve(this);this.msgs.push(m);});});} send(m){this.ws.send(JSON.stringify(m));} mark(){return this.msgs.length;} async next(fn,label,from=0){for(let i=0;i<400;i++){const hit=this.msgs.slice(from).find(fn);if(hit)return hit;await sleep(20);}throw Error(`${this.name}: ${label}`);} close(){try{this.ws.close();}catch{}} }

(async()=>{
  const server=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),ASOC_DATA_DIR:DATA,ASOC_GM_PASSWORD:'vault-pass',ASOC_EMAIL_VERIFICATION:'0',ASOC_MIN_FREE_DISK_BYTES:'0'},stdio:['ignore','ignore','pipe']});
  let stderr='';server.stderr.on('data',c=>stderr+=c);const clients=[];
  try {
    for(let i=0;i<100;i++){try{if((await request('GET','/health')).status===200)break;}catch{}await sleep(100);}
    const gmToken=(await json('/api/auth/gm/login',{password:'vault-pass'})).data.token;
    const creds={email:'attacker@vault.test',password:'player-password',name:'Attacker'};
    await json('/api/auth/player/register',creds);const playerToken=(await json('/api/auth/player/login',creds)).data.token;
    const gm=await new Client('GM').open();clients.push(gm);gm.send({type:'host:recover',gmToken});await gm.next(m=>m.type==='host:recovered','recover');
    const player=await new Client('player').open();clients.push(player);player.send({type:'room:join',authToken:playerToken,roomCode:'MASTER',name:'Attacker'});await player.next(m=>m.type==='join:success','join');

    let mark=player.mark();player.send({type:'blackMarket:petition',title:'PRIVATE TEST',category:'CUSTOM',request:'test'});
    const petition=await player.next(m=>m.type==='blackMarket:state'&&m.pacts?.length,'petition',mark);const pactId=petition.pacts[0].id;
    mark=gm.mark();gm.send({type:'blackMarket:gmDecision',pactId,action:'accept',terms:'',tributeRequired:true});await gm.next(m=>m.type==='blackMarket:gmState'&&m.pacts?.find(p=>p.id===pactId)?.state==='APPROVED_PENDING_TRIBUTE','approve',mark);
    const uploaded=await request('POST',`/api/black-market/tribute-image?pactId=${encodeURIComponent(pactId)}`,PNG,{'content-type':'image/png','x-player-token':playerToken});
    assert.equal(uploaded.status,201);const privateUrl=uploaded.data.imageUrl;
    assert.equal((await request('GET',privateUrl)).status,404,'known private URL is not fetchable');
    mark=player.mark();player.send({type:'blackMarket:tributeSubmit',pactId,imageUrl:privateUrl,consent:true});await player.next(m=>m.type==='blackMarket:state'&&m.pacts?.find(p=>p.id===pactId)?.state==='TRIBUTE_SUBMITTED','submit',mark);
    mark=gm.mark();gm.send({type:'blackMarket:tributeJudge',pactId,accepted:true,comment:'Accepted for boundary test'});await gm.next(m=>m.type==='blackMarket:gmState'&&m.pacts?.find(p=>p.id===pactId)?.state==='OWED','judge',mark);

    const attackStart=player.mark();
    for(const payload of [
      {type:'gm:reliquaryAccess',code:'112018'},
      {type:'gm:tributeVaultUpdate',id:'anything',action:'reliquary',value:false},
      {type:'gm:tributeVaultClear'},
      {type:'gm:reliquaryLock'},
      {type:'host:recover',gmToken:'forged-player-token'}
    ]) player.send(payload);
    await sleep(400);
    assert.equal(player.msgs.slice(attackStart).some(m=>m.type==='tribute:vault'||m.type==='tribute:vaultAccess'&&m.granted),false,'forged player commands disclose no vault');
    assert.equal((await request('GET',privateUrl)).status,404,'private URL remains sealed after judgment');

    mark=gm.mark();gm.send({type:'gm:reliquaryAccess',code:'112018'});
    await gm.next(m=>m.type==='tribute:vaultAccess'&&m.granted===true,'unlock',mark);
    const vault=await gm.next(m=>m.type==='tribute:vault'&&m.tributes?.length===1,'vault',mark);
    assert.match(vault.tributes[0].imageData,/^data:image\/png;base64,/,'GM receives private bytes over authorized socket');
    assert.equal(player.msgs.some(m=>m.type==='tribute:vault'),false,'player never receives vault hydration');
    console.log('PASS Reliquary adversarial boundary: forged player commands denied, known private URL returns 404, only unlocked authenticated GM receives vault bytes');
  } finally {clients.forEach(c=>c.close());await require('./lib/stop-process')(server);fs.rmSync(DATA,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
})().catch(e=>{console.error('FAIL Reliquary adversarial boundary:',e);process.exit(1);});
