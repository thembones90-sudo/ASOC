'use strict';
// Deterministic end-to-end socket comparison: 12 accepted public GM posts,
// one concurrent liveness probe, and a deliberately slow durable volume.
const assert = require('assert/strict');
const WebSocket = require('ws');
const H = require('./lib/browser-harness');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const wait = async predicate => {
  const until = Date.now()+7000;
  while(Date.now()<until){const value=predicate();if(value)return value;await delay(5);}
  throw Error('Timed out waiting for complete public chat burst');
};
(async()=>{
  const server = await H.startServer({port:19837,env:{NODE_ENV:'test',ASOC_TEST_ATOMIC_DELAY_MS:'120'}});
  let ws;
  try {
    const login = await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
    assert.ok(login.data.token);
    const received = new Map(); const prefix='latency-fixture-'+Date.now()+'-';
    let ready=false,recovered=false,pongAt=0;
    ws = new WebSocket(server.base.replace('http:','ws:'));
    ws.on('message',raw=>{
      const m=JSON.parse(raw.toString());
      if(m.type==='protocol:hello')ws.send(JSON.stringify({type:'protocol:hello',protocolVersion:1,capabilities:['chat:delta']}));
      if(m.type==='protocol:ready')ready=true;
      if(m.type==='host:recovered')recovered=true;
      if(m.type==='server:pong'&&m.id==='benchmark-ping')pongAt=Date.now();
      if(m.type==='chat:update'||m.type==='chat:delta')for(const entry of m.messages||[]){
        if(entry.text?.startsWith(prefix)&&!received.has(entry.id))received.set(entry.id,Date.now());
      }
    });
    await wait(()=>ready);
    ws.send(JSON.stringify({type:'host:recover',gmToken:login.data.token}));
    await wait(()=>recovered); await delay(200);
    const started=Date.now();
    for(let i=0;i<12;i++)ws.send(JSON.stringify({type:'gm:broadcast',text:prefix+i}));
    await delay(25);
    const pingAt=Date.now();ws.send(JSON.stringify({type:'client:ping',id:'benchmark-ping'}));
    await wait(()=>received.size===12&&pongAt);
    const samples=[...received.values()].map(at=>at-started).sort((a,b)=>a-b);
    const at=p=>samples[Math.ceil(samples.length*p)-1];
    const result={simulatedStorageMs:120,messages:12,sendToReceiveMs:{p50:at(.5),p95:at(.95),p99:at(.99),worst:samples.at(-1)},livenessMs:pongAt-pingAt};
    console.log('Public chat burst benchmark '+JSON.stringify(result));
    assert.ok(result.livenessMs<80,'main thread must serve liveness during a slow commit');
    assert.ok(result.sendToReceiveMs.worst<900,'12-message burst must batch rather than pay 12 separate disk waits');
    console.log('PASS public chat latency benchmark');
  } finally {if(ws)ws.terminate();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
