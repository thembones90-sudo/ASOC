'use strict';
const assert=require('assert/strict');
const {createAssociationProvider,normalizeWord,normalizeMode}=require('../association-provider');
const datamuse=require('../datamuse-provider');
const H=require('./lib/browser-harness');
const fixture=[{word:'Shift',score:845,tags:['n','v','f:5']},{word:'SHIFT',score:800,tags:['adj']},{word:'black hole',score:999},{word:'phase',score:900},{word:'Diagram',tags:['u']}];
const secret='never-expose-provider-internals';
const rejectSafe=async(fn,status)=>assert.rejects(fn,e=>e.status===status&&!e.message.includes(secret));
(async()=>{
 for(const value of [null,undefined,'','   ','two words','a'.repeat(61),'phase?'])assert.throws(()=>normalizeWord(value),e=>e.status===400);
 assert.equal(normalizeWord(' Phase '),'phase');assert.equal(normalizeMode(),'associated');assert.throws(()=>normalizeMode('invalid'),e=>e.status===400);
 for(const mode of ['associated','means_like']){
  const url=datamuse.buildUrl('phase',mode);assert.equal(url.origin,'https://api.datamuse.com');assert.equal(url.pathname,'/words');assert.equal(url.searchParams.get(mode==='associated'?'rel_trg':'ml'),'phase');assert.equal(url.searchParams.get(mode==='associated'?'ml':'rel_trg'),null);assert.equal(url.searchParams.get('max'),'100');assert.equal(url.searchParams.get('md'),'p');assert.equal(url.searchParams.has('apikey'),false);
 }
 assert.deepEqual(datamuse.normalizeResponse(fixture,'phase'),[{word:'SHIFT',score:845,partsOfSpeech:['noun','verb','adjective']},{word:'DIAGRAM',score:null,partsOfSpeech:[]}]);
 assert.deepEqual(datamuse.normalizeResponse([],'phase'),[]);
 assert.deepEqual(datamuse.normalizeResponse([{word:'unknown',tags:['u','toString','__proto__']}],'phase')[0].partsOfSpeech,[]);
 for(const data of [null,{},'bad',[null],[{word:'shift',score:'845'}],[{word:'shift',tags:'n'}],[{word:'shift',tags:[5]}]])assert.throws(()=>datamuse.normalizeResponse(data,'phase'));
 let calls=0,clock=0,release;
 const service=createAssociationProvider({now:()=>clock,ttlMs:100,maxEntries:2,fetchImpl:async(url)=>{calls++;assert.equal(new URL(url).searchParams.get('md'),'p');if(calls===1)await new Promise(r=>release=r);return new Response(JSON.stringify(fixture));}});
 const first=service.fetch('PHASE'),duplicate=service.fetch(' phase ');release();assert.deepEqual(await first,await duplicate);assert.equal(calls,1);
 assert.equal((await service.fetch('phase')).cached,true);assert.equal(calls,1);
 await rejectSafe(()=>service.fetch('phase',{mode:'means_like'}),429);
 clock=10;assert.equal((await service.fetch('phase')).cached,true);
 clock=2000;assert.equal((await service.fetch('phase',{mode:'means_like'})).cached,false);assert.equal(calls,2,'mode has separate cache');
 assert.equal((await service.fetch('phase',{mode:'means_like'})).cached,true);
 clock=4000;await service.fetch('phase');assert.equal(calls,3,'expired cache refetches');
 clock=6000;await service.fetch('shift');clock=8000;await service.fetch('phase',{mode:'means_like'});assert.equal(calls,5,'bounded cache evicts');
 for(const status of [401,403,429,500])await rejectSafe(()=>createAssociationProvider({fetchImpl:async()=>new Response(secret,{status})}).fetch('phase'),status===429?429:status===500?502:503);
 for(const body of [secret,'{}','null','[{"word":"shift","score":"bad"}]'])await rejectSafe(()=>createAssociationProvider({fetchImpl:async()=>new Response(body)}).fetch('phase'),502);
 await rejectSafe(()=>createAssociationProvider({fetchImpl:async()=>{throw Error(secret);}}).fetch('phase'),502);
 await assert.rejects(()=>createAssociationProvider({timeoutMs:10,fetchImpl:async(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error(secret))))}).fetch('phase'),/timed out/);
 await rejectSafe(()=>createAssociationProvider({fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}).fetch('phase'),502);
 const empty=await createAssociationProvider({fetchImpl:async()=>new Response('[]')}).fetch('phase');assert.deepEqual(empty.items,[]);assert.equal(empty.provider,'datamuse');assert.equal(empty.mode,'associated');
 const server=await H.startServer({port:19846});
 try{
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  const request=async(query,token=login.data.token,method='GET',endpoint='/api/associations')=>{const res=await fetch(server.base+endpoint+query,{method,headers:{'x-gm-token':token}});return {status:res.status,body:await res.json(),cache:res.headers.get('cache-control')};};
  assert.equal((await request('?word=phase','')).status,401);
  const player=await H.heroToken(server,'Association Hero');assert.equal((await request('?word=phase',player)).status,401);
  for(const query of ['','?word=','?word=%20%20','?word=two%20words','?word=phase&mode=bad'])assert.equal((await request(query)).status,400);
  assert.equal((await request('?word=phase',login.data.token,'POST')).status,405);
  const alias=await request('?word=phase&mode=bad',login.data.token,'GET','/api/word-associations');assert.equal(alias.status,400);assert.equal(alias.cache,'no-store');
  for(const file of ['association-provider.js','datamuse-provider.js'])assert.equal((await fetch(server.base+'/'+file)).status,404);
 }finally{await server.stop();}
 console.log('PASS Datamuse provider: keyless queries, both modes, POS/score/unknown metadata, one-word rule, input/mode validation, cache TTL/bounds/coalescing/mode keys, rate limit, auth/quota/network/timeout/schema/size errors, secret-safe failures, GM route and player refusal');
})().catch(e=>{console.error(e);process.exitCode=1;});
