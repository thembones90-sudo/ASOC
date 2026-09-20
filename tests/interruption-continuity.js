const assert=require('assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {spawn}=require('child_process'),{once}=require('events');
const WebSocket=require('ws');
const ROOT=path.resolve(__dirname,'..'),PORT=18460;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-continuity-'));
let server=null;
async function start(){
  server=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),ASOC_DATA_DIR:dir,ASOC_GM_PASSWORD:'continuity-test',ASOC_EMAIL_VERIFICATION:'0'},stdio:['ignore','pipe','pipe']});
  let err='';server.stderr.on('data',c=>err+=c);
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error(err||'startup timeout')),10000);server.stdout.on('data',c=>{if(c.toString().includes('ASOC Engine server running')){clearTimeout(t);resolve();}})});
}
async function stop(){if(server&&server.exitCode===null){const p=once(server,'exit');server.kill('SIGTERM');await p;}server=null;}
async function api(url,method='GET',body){
  const r=await fetch('http://127.0.0.1:'+PORT+url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json()};
}
function wait(ws,pred,ms=5000){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.off('message',on);reject(Error('timeout'));},ms);const on=raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(pred(m)){clearTimeout(t);ws.off('message',on);resolve(m)}};ws.on('message',on);});}
async function open(){const ws=new WebSocket('ws://127.0.0.1:'+PORT);await once(ws,'open');await wait(ws,m=>m.type==='protocol:hello');ws.send(JSON.stringify({type:'protocol:hello',protocolVersion:1}));await wait(ws,m=>m.type==='protocol:ready');return ws;}async function createHost(gm){
  const ws=await open(),createdP=wait(ws,m=>m.type==='room:created'),stateP=wait(ws,m=>m.type==='state:public');
  ws.send(JSON.stringify({type:'room:create',gameId:'sample-game',gmToken:gm}));
  const created=await createdP,state=await stateP;return {ws,hostToken:created.hostToken,state};
}
async function recoverHost(gm){
  const ws=await open(),stateP=wait(ws,m=>m.type==='state:public'),okP=wait(ws,m=>m.type==='host:recovered');
  ws.send(JSON.stringify({type:'host:recover',gmToken:gm}));
  const state=await stateP,ok=await okP;return {ws,state,hostToken:ok.hostToken};
}
async function joinPlayer(token,name='CONTINUITY PLAYER'){
  const ws=await open(),stateP=wait(ws,m=>m.type==='state:public'),joinP=wait(ws,m=>m.type==='join:success');
  ws.send(JSON.stringify({type:'room:join',authToken:token,name}));
  return {ws,state:await stateP,joined:await joinP};
}
(async()=>{
  try{
    await start();
    let gm=(await api('/api/auth/gm/login','POST',{password:'continuity-test'})).data.token;
    const reg=await api('/api/auth/player/register','POST',{email:'continuity_player',password:'secret1',name:'CONTINUITY PLAYER'});
    const playerToken=reg.data.token;
    let host=await createHost(gm);
    const markedP=wait(host.ws,m=>m.type==='state:public'&&m.cells?.A3?.revealed===true);
    host.ws.send(JSON.stringify({type:'gm:command',command:'revealCell',payload:{cell:'A3',reveal:true},cmdId:1}));
    const marked=await markedP,revision=marked.revision;
    let player=await joinPlayer(playerToken),playerId=player.joined.playerId;
    assert.equal(player.state.cells.A3.revealed,true);    player.ws.close();await once(player.ws,'close');
    player=await joinPlayer(playerToken);
    assert.equal(player.joined.playerId,playerId);
    assert.equal(player.state.cells.A3.revealed,true);

    host.ws.close();await once(host.ws,'close');
    gm=(await api('/api/auth/gm/login','POST',{password:'continuity-test'})).data.token;
    host=await recoverHost(gm);
    assert.equal(host.state.cells.A3.revealed,true);
    assert.equal(host.state.revision,revision);
    assert.ok(host.hostToken);

    host.ws.close();await once(host.ws,'close');
    player.ws.close();await once(player.ws,'close');
    await stop();await start();
    gm=(await api('/api/auth/gm/login','POST',{password:'continuity-test'})).data.token;
    host=await recoverHost(gm);
    assert.equal(host.state.cells.A3.revealed,true);
    player=await joinPlayer(playerToken);
    assert.equal(player.joined.playerId,playerId);
    assert.equal(player.state.cells.A3.revealed,true);

    const playerSource=fs.readFileSync(path.join(ROOT,'js','player.js'),'utf8');
    const joinSource=fs.readFileSync(path.join(ROOT,'join.html'),'utf8');
    assert.match(playerSource,/asoc_player_in_master/);
    assert.match(playerSource,/resumeStoredMasterSession/);
    assert.match(joinSource,/asoc:player-session-restored/);
    console.log('PASS interruption continuity: player reconnect, GM token-loss recovery, process restart, browser auto-resume hooks');
    host.ws.close();player.ws.close();
  }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});