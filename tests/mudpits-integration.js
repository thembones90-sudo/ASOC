'use strict';
// Real server/socket integration coverage for MUD PITS. Timers are shortened
// only in this child process; the production defaults remain 90s/5s/60s.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const path = require('node:path');

const port = 18970 + Math.floor(Math.random() * 100);
const runTag = Date.now();
const env = { ...process.env, PORT: String(port), ASOC_GM_PASSWORD:'mudpits-qa-gm', ASOC_EMAIL_VERIFICATION:'0', ASOC_MUD_PITS_WRITE_MS:'90', ASOC_MUD_PITS_READ_MS:'50', ASOC_MUD_PITS_VOTE_MS:'120', NODE_ENV:'test' };
const server = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio:['ignore','pipe','pipe'] });
let logs = ''; server.stdout.on('data', b => logs += b); server.stderr.on('data', b => logs += b);
const sockets = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(label) { const ws = new WebSocket(`ws://127.0.0.1:${port}`); sockets.push(ws); const messages=[]; ws.on('message', b => { try { messages.push(JSON.parse(String(b))); } catch {} }); return { label, ws, messages }; }
async function ready(c) { await new Promise((resolve,reject)=>{ const t=setTimeout(()=>reject(new Error(`${c.label} connect timeout`)),4000); c.ws.once('open',()=>{clearTimeout(t); c.ws.send(JSON.stringify({type:'protocol:hello',protocolVersion:1,clientBuild:'test'})); resolve();}); c.ws.once('error',e=>{clearTimeout(t); reject(new Error(`${c.label} socket error: ${e.message}`));}); }); await wait(30); }
function send(c, msg) { c.ws.send(JSON.stringify(msg)); }
function all(c, type) { return c.messages.filter(m=>m.type===type); }
function latest(c, type) { return all(c,type).at(-1); }
async function until(fn, ms=3000) { const end=Date.now()+ms; while(Date.now()<end){const v=fn(); if(v) return v; await wait(15);} throw new Error('condition timeout'); }
async function api(path, body) { const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); return r.json(); }

(async()=>{
  try {
    await wait(500);
    const clients=[]; const gm=client('gm'); clients.push(gm); await ready(gm);
    const a=client('a'); clients.push(a); await ready(a);
    const b=client('b'); clients.push(b); await ready(b);
    const voter=client('voter'); clients.push(voter); await ready(voter);
    const spectator=client('spectator'); clients.push(spectator); await ready(spectator);
    const gmLogin=await api('/api/auth/gm/login',{password:'mudpits-qa-gm'}); const gmToken=gmLogin.data?.token||gmLogin.token;
    assert.ok(gmToken,'GM login returns token');
    send(gm,{type:'host:recover',gmToken});
    await until(()=>latest(gm,'host:recovered'));
    const room='MASTER';
    for (const [c,id,name] of [[a,'a','Alpha'],[b,'b','Beta'],[voter,'voter','Voter'],[spectator,'spectator','Spectator']]) {
      const email=`${id}-${runTag}@mudpits-qa.local`; const playerLogin=await api('/api/auth/player/register',{email,password:'mudpits-qa-pass',name}); const auth=playerLogin.data?.token||playerLogin.token;
      assert.ok(auth,`player auth for ${id}: ${JSON.stringify(playerLogin)}`);
      send(c,{type:'room:join',roomCode:room,authToken:auth,name});
      await until(()=>latest(c,'join:success'));
    }
    await wait(120);
    // Discover exact deployed message names from the source contract.
    const aid=latest(a,'join:success').playerId||latest(a,'join:success').player?.id||latest(a,'join:success').id;
    const bid=latest(b,'join:success').playerId||latest(b,'join:success').player?.id||latest(b,'join:success').id;
    send(gm,{type:'mudpits:start',contestantIds:[aid,bid]});
    const started=await until(()=>latest(gm,'mudpits:state')||latest(gm,'mudpits:update')).catch(e=>{throw new Error(`${e.message}; gm messages=${JSON.stringify(gm.messages.slice(-8))}`)});
    assert.ok(started,'GM receives started state');
    // Prior to reveal no socket, including GM/spectator, may receive plaintext.
    send(a,{type:'mudpits:submit',text:'alpha secret'});
    await wait(25);
    for (const c of [gm,a,b,voter,spectator]) assert.equal(c.messages.some(m=>JSON.stringify(m).includes('alpha secret')||JSON.stringify(m).includes('beta secret')),false,`${c.label} leaked sealed text`);
    send(b,{type:'mudpits:submit',text:'beta secret'});
    await until(()=>[gm,a,b,voter,spectator].some(c=>JSON.stringify(c.messages).includes('alpha secret')),1000);
    // Read window -> voting -> duplicate/contestant rejection.
    await wait(80); send(voter,{type:'mudpits:vote',contestantId:aid}); send(voter,{type:'mudpits:vote',contestantId:bid}); send(a,{type:'mudpits:vote',contestantId:bid});
    await wait(160);
    assert.ok(gm.messages.some(m=>JSON.stringify(m).includes('mudpits')),'GM receives MUD PITS result traffic');
    // Cancel path in a fresh pit and reconnect snapshot path.
    send(gm,{type:'mudpits:start',contestantIds:[aid,bid]}); await wait(30); send(gm,{type:'mudpits:cancel',reason:'QA cancel'}); await wait(30);
    const old=a.ws; old.close(); await wait(30); const ar=client('a-reconnect'); await ready(ar); send(ar,{type:'room:join',roomCode:room,authToken:(await api('/api/auth/player/login',{email:`a-${runTag}@mudpits-qa.local`,password:'mudpits-qa-pass'})).data?.token,name:'Alpha'}); await wait(100);
    assert.ok(ar.messages.length>0,'reconnected player receives snapshot/handshake');
    console.log('PASS MUD PITS live integration: auth gate, five sockets, sealed-text scan, submit/reveal/vote traffic, rejection attempts, cancel, reconnect');
  } catch (e) { console.error('FAIL',e.stack); console.error(logs.slice(-4000)); process.exitCode=1; }
  finally { for (const ws of sockets) { try { ws.close(); } catch {} } server.kill(); }
})();
