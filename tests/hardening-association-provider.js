'use strict';
const assert = require('assert/strict');
const { createAssociationProvider, normalizeWord, normalizeResponse } = require('../association-provider');
const H = require('./lib/browser-harness');
const secret = 'test-secret-never-return';
const fixture = { code:200, response:[{text:'phase',items:[{item:'Shift',weight:90,pos:'noun'},{item:'SHIFT',weight:87,pos:'verb'},{item:'black hole',weight:99,pos:'noun'},{item:'phase',weight:100,pos:'noun'},{item:'Diagram',pos:'noun'}]}] };
const rejectSafe = async (fn,status) => assert.rejects(fn,error=>error.status===status && !error.message.includes(secret));
(async()=>{
 for (const value of [null,undefined,'','   ','two words','a'.repeat(61),'phase?']) assert.throws(()=>normalizeWord(value),e=>e.status===400);
 assert.equal(normalizeWord(' Phase '),'phase');
 const items=normalizeResponse(fixture,'phase');
 assert.deepEqual(items,[{word:'SHIFT',weight:90,partsOfSpeech:['noun','verb']},{word:'DIAGRAM',weight:null,partsOfSpeech:['noun']}]);
 for(const value of [null,{}, {code:200,response:[]},{code:200,response:[{text:'other',items:[]}]},{code:200,response:[{text:'phase',items:[{item:'SHIFT',weight:'99'}]}]}]) assert.throws(()=>normalizeResponse(value,'phase'),e=>e.status===502);
 await rejectSafe(()=>createAssociationProvider({getKey:()=>''}).fetch('phase'),503);
 let calls=0,clock=0,release;
 const provider=createAssociationProvider({getKey:()=>secret,now:()=>clock,ttlMs:100,maxEntries:2,fetchImpl:async(url)=>{
   calls++;const parsed=new URL(url);assert.equal(parsed.origin,'https://api.wordassociations.net');assert.equal(parsed.searchParams.get('type'),'stimulus');assert.equal(parsed.searchParams.get('apikey'),secret);
   if(calls===1)await new Promise(r=>release=r);
   return new Response(JSON.stringify({...fixture,response:[{...fixture.response[0],text:parsed.searchParams.get('text')}]}));
 }});
 const first=provider.fetch('PHASE'),duplicate=provider.fetch(' phase ');release();
 assert.deepEqual(await first,await duplicate);assert.equal(calls,1);
 assert.equal((await provider.fetch('phase')).cached,true);assert.equal(calls,1);
 await rejectSafe(()=>provider.fetch('other'),429);
 clock=2000;await provider.fetch('phase');assert.equal(calls,2,'expired cache refetches');
 clock=4000;await provider.fetch('shift');clock=6000;await provider.fetch('diagram');clock=8000;await provider.fetch('phase');assert.equal(calls,5,'cache bounded');
 for(const status of [401,403,429,500]) await rejectSafe(()=>createAssociationProvider({getKey:()=>secret,fetchImpl:async()=>new Response(secret,{status})}).fetch('phase'),status===429?429:status===500?502:503);
 for(const body of [secret,JSON.stringify({code:401,error:secret}),JSON.stringify({code:429}),JSON.stringify({code:200,response:'bad'})]) await assert.rejects(()=>createAssociationProvider({getKey:()=>secret,fetchImpl:async()=>new Response(body)}).fetch('phase'),e=>!e.message.includes(secret));
 await rejectSafe(()=>createAssociationProvider({getKey:()=>secret,fetchImpl:async()=>{throw Error(secret);}}).fetch('phase'),502);
 await assert.rejects(()=>createAssociationProvider({getKey:()=>secret,timeoutMs:10,fetchImpl:async(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error(secret))))}).fetch('phase'),/timed out/);
 await rejectSafe(()=>createAssociationProvider({getKey:()=>secret,fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}).fetch('phase'),502);
 assert.deepEqual(normalizeResponse({code:200,response:[{text:'phase',items:[]}]},'phase'),[]);
 const server=await H.startServer({port:19846,env:{WORD_ASSOCIATIONS_API_KEY:''}});
 try {
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  async function request(query,token=login.data.token,method='GET') { const res=await fetch(server.base+'/api/word-associations'+query,{method,headers:{'x-gm-token':token}});return {status:res.status,body:await res.json(),cache:res.headers.get('cache-control')}; }
  assert.equal((await request('?word=phase','')).status,401);
  const player=await H.heroToken(server,'Association Hero');assert.equal((await request('?word=phase',player)).status,401);
  for(const query of ['','?word=','?word=%20%20','?word=two%20words'])assert.equal((await request(query)).status,400);
  const missing=await request('?word=phase');assert.equal(missing.status,503);assert.match(missing.body.error,/WORD_ASSOCIATIONS_API_KEY/);assert.equal(missing.cache,'no-store');
  assert.equal((await request('?word=phase',login.data.token,'POST')).status,405);
  assert.equal((await fetch(server.base+'/association-provider.js')).status,404,'server implementation not public');
 }finally{await server.stop();}
 console.log('PASS association provider: input, real schema/POS/weight normalization, single-word rule, missing key, cache TTL/bounds/coalescing, rate limit, upstream auth/quota/network/timeout/malformed/size failures, secret-safe messages, GM-only route, player refusal');
})().catch(e=>{console.error(e);process.exitCode=1;});
