'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-tombola-live-'));
const port = 19853;
const root = path.join(__dirname, '..');
let logs = '', server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function boot() {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ASOC_DATA_DIR: data, ASOC_GM_PASSWORD: 'tombola-test-password', ASOC_EMAIL_VERIFICATION: '0', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => logs += b); server.stderr.on('data', b => logs += b);
}
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {} await wait(100); } throw Error('server did not boot'); }
async function api(url, body) { const response = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return response.json(); }
class Client {
  constructor(name) { this.name = name; this.messages = []; }
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', bytes => { const m = JSON.parse(String(bytes)); if (m.type === 'protocol:hello') this.send({ type: 'protocol:hello', protocolVersion: 1 }); else this.messages.push(m); });
    await this.next(m => m.type === 'protocol:ready'); return this;
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  mark() { return this.messages.length; }
  async next(predicate, from = 0) { for (let i = 0; i < 200; i++) { const m = this.messages.slice(from).find(predicate); if (m) return m; await wait(20); } throw Error(`${this.name} timed out: ${this.messages.slice(-3).map(m => m.type).join(',')}`); }
  close() { this.ws?.terminate(); }
}
const clients = [];
const snapshot = () => JSON.parse(fs.readFileSync(path.join(data, 'active-rooms.json'), 'utf8')).rooms[0];
const profiles = () => JSON.parse(fs.readFileSync(path.join(data, 'players.json'), 'utf8'));
(async () => {
 try {
  boot(); await ready();
  const login = await api('/api/auth/gm/login', { password: 'tombola-test-password' });
  let gm = await new Client('GM').open(); clients.push(gm);
  gm.send({type:'host:recover',gmToken:login.token}); await gm.next(m=>m.type==='host:recovered');
  const heroes=[];
  for(const name of ['Victim','Bystander']) {
   const auth=await api('/api/auth/player/register',{email:name+'@audit.test',name,password:'audit-test-password'});
   const c=await new Client(name).open();clients.push(c);c.token=auth.token;
   c.send({type:'room:join',roomCode:'MASTER',authToken:c.token,name});c.id=(await c.next(m=>m.type==='join:success')).playerId;heroes.push(c);
  }
  const [victim,bystander]=heroes;
  const innocentMark=bystander.mark();
  for(let i=0;i<25;i++) {
   let from=victim.mark();gm.send({type:'gm:poisonCast',playerId:victim.id});
   await victim.next(m=>m.type==='poison:applied',from);
   from=victim.mark();victim.send({type:'chat:guess',text:'/roll'});
   await victim.next(m=>['poison:failed','poison:cured'].includes(m.type),from);
   if(snapshot().poison[victim.id]?.status==='bleeding')break;
   await wait(1100);
  }
  assert.equal(snapshot().poison[victim.id].status,'bleeding');
  // A 20 MB PNG goes through actual authenticated HTTP and durable storage.
  const image=Buffer.alloc(20*1024*1024);Buffer.from('89504e470d0a1a0a','hex').copy(image);
  let from=gm.mark();let done=false;const pings=[];
  const upload=fetch(`http://127.0.0.1:${port}/api/poison/tribute-image`,{method:'POST',headers:{'content-type':'image/png','x-player-token':victim.token},body:image}).then(async r=>({status:r.status,body:await r.json()})).finally(()=>{done=true;});
  while(!done) {const start=Date.now(),mark=bystander.mark(),id='audit-'+start;bystander.send({type:'client:ping',id});await bystander.next(m=>m.type==='server:pong'&&m.id===id,mark);pings.push(Date.now()-start);await wait(10);}
  const uploaded=await upload;assert.equal(uploaded.status,201,JSON.stringify(uploaded));
  const offered=await gm.next(m=>m.type==='poison:tributeOffered',from);
  assert.ok(offered.imageData.startsWith('data:image/png;base64,'));
  let saved=snapshot(),tribute=saved.bloodTributes.find(t=>t.id===uploaded.body.tributeId);
  assert.ok(tribute.imageUrlOrStoragePath);assert.equal(tribute.imageData,undefined);
  assert.ok(fs.statSync(path.join(data,'active-rooms.json')).size<200000,'20 MB upload never bloats room snapshot');
  assert.equal((await fetch(`http://127.0.0.1:${port}${tribute.imageUrlOrStoragePath}`)).status,404,'private media never has a public URL');
  assert.ok(Math.max(...pings)<1000,'uploads keep socket liveness responsive');
  from=victim.mark();gm.send({type:'gm:poisonTributeDecision',playerId:victim.id,accepted:false});
  await victim.next(m=>m.type==='poison:tributeRejected',from);
  const retry=await fetch(`http://127.0.0.1:${port}/api/poison/tribute-image`,{method:'POST',headers:{'content-type':'image/png','x-player-token':victim.token},body:image.subarray(0,32)});
  assert.equal(retry.status,201,await retry.text());
  assert.equal(snapshot().chat.messages.some(m=>m.poisonSave || /SURVIVAL CHECK FAILED|VENOM RESISTED/.test(m.text)),false,'poison save never becomes public chat');
  assert.equal(bystander.messages.slice(innocentMark).filter(m=>m.type.startsWith('poison:')).length,0,'bystanders receive no poison events');
  for(const m of bystander.messages.slice(innocentMark).filter(m=>m.type==='state:public'))assert.deepEqual(m.poison,{},'bystanders never receive another player poison state');
  // Seed the old inline shape and reboot: migration preserves pending review.
  clients.forEach(c=>c.close());server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));
  const recovery=JSON.parse(fs.readFileSync(path.join(data,'active-rooms.json'),'utf8'));
  const old=recovery.rooms[0].bloodTributes.find(t=>t.id===uploaded.body.tributeId);
  old.imageData='data:image/png;base64,'+image.subarray(0,32).toString('base64');delete old.imageUrlOrStoragePath;
  fs.writeFileSync(path.join(data,'active-rooms.json'),JSON.stringify(recovery));
  boot();await ready();tribute=snapshot().bloodTributes.find(t=>t.id===old.id);
  assert.equal(tribute.imageData,undefined);assert.ok(tribute.imageUrlOrStoragePath,'legacy offering migrates before HTTP readiness');
  gm=await new Client('Recovered GM').open();clients.push(gm);
  gm.send({type:'host:recover',gmToken:login.token});await gm.next(m=>m.type==='host:recovered');
  const recovered=await gm.next(m=>m.type==='poison:tributeOffered');
  assert.ok(recovered.imageData.startsWith('data:image/png;base64,'),'pending offering remains reviewable after reboot');
  console.log('PASS audit media: real poison privacy, 20 MB private file upload, small recovery snapshot, replacement/restart migration, liveness pings max='+Math.max(...pings)+'ms');
 } finally {clients.forEach(c=>c.close());if(server?.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}}
})().catch(error=>{console.error(error);console.error(logs.slice(-2500));process.exitCode=1;});
