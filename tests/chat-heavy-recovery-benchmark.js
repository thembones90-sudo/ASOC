'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');const H=require('./lib/browser-harness');
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-latency-heavy-')),PORT=19048,URL='http://127.0.0.1:'+PORT;
let child=null,browser=null;
function server(){return{base:URL,api:(verb,url,body)=>H.request(PORT,verb,url,body)}}
async function start(){child=spawn(process.execPath,['server.js'],{cwd:H.ROOT,env:{...process.env,PORT:String(PORT),ASOC_DATA_DIR:DIR,ASOC_GM_PASSWORD:'synthetic-only',ASOC_EMAIL_VERIFICATION:'0',NODE_ENV:'test',ASOC_TEST_ATOMIC_DELAY_MS:'200',ASOC_RUNTIME_BATCH_MAX:'32'},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',x=>err+=x);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('test server died '+err.slice(-800));try{const r=await server().api('GET','/health');if(r.status===200)return;}catch{}await H.sleep(140)}throw Error('test server failed health '+err.slice(-800));}
async function stop(){if(!child||child.exitCode!==null)return;let done;const p=new Promise(r=>done=r);child.once('exit',done);child.kill('SIGTERM');await Promise.race([p,H.sleep(7000)]);if(child.exitCode===null)child.kill();}
function percentile(v,q){v=v.slice().sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.ceil(v.length*q)-1)]}
(async()=>{try{
await start();browser=await chromium.launch(H.launchOptions());let ctx=await browser.newContext();const token=await H.heroToken(server(),'Heavy Fixture 0');await H.openHeroPage(ctx,server(),token);await browser.close();browser=null;await stop();
const snapshot=path.join(DIR,'active-rooms.json');if(!fs.existsSync(snapshot))throw Error('No room recovery snapshot created');
let state=JSON.parse(fs.readFileSync(snapshot,'utf8'));if(!state.rooms?.length)throw Error('No rooms');
const img='data:image/png;base64,'+'A'.repeat(350*1024);
state.rooms[0].bloodTributes=Array.from({length:72},(_,i)=>({id:'synthetic-archive-'+i,source:'ritual',playerName:'Synthetic player',playerId:'synthetic-player',imageData:img,submittedAt:1700000000000+i,pendingReview:false,reliquary:true,viewedByGM:true,infostudId:'synthetic-ref'}));
fs.writeFileSync(snapshot,JSON.stringify(state));console.log('MEDIA_FIXTURE '+JSON.stringify({bytes:fs.statSync(snapshot).size,tribs:72}));
await start();browser=await chromium.launch(H.launchOptions());const pages=[];
for(let i=0;i<12;i++){const c=await browser.newContext({viewport:{width:1100,height:760}});const t=await H.heroToken(server(),'Heavy Fixture '+i);pages.push(await H.openHeroPage(c,server(),t));}
const stamp='heavy-test-'+Date.now();const texts=pages.map((_,i)=>stamp+'-'+i);const st=Date.now();await Promise.all(pages.map((page,i)=>page.evaluate(text=>PlayerApp.send({type:'chat:guess',text}),texts[i])));const started=Date.now()-st;
const startProbe=performance.now();const health=await server().api('GET','/health');const probeMs=performance.now()-startProbe;
const received=await Promise.all(pages.map(async(page,i)=>{await page.waitForFunction(text=>(PlayerApp.chatMessages||[]).some(x=>x.text===text),texts[i],{timeout:20000});return Date.now()-st;}));
const total=Date.now()-st;
const errors=pages.flatMap(page=>page.pageErrors||[]);
console.log('MEDIA_LATENCY '+JSON.stringify({clients:12,messages:12,storageDelayMs:200,snapshotMB:+(fs.statSync(snapshot).size/1048576).toFixed(2),sentMs:started,deliveryMs:{p50:percentile(received,.5),p95:percentile(received,.95),max:percentile(received,1)},allDeliveredMs:total,firstHealthMs:+probeMs.toFixed(2),healthStatus:health.status,pageErrors:errors}));
await browser.close();browser=null;await stop();
const committed=JSON.parse(fs.readFileSync(snapshot,'utf8'));
const saved=committed.rooms[0].bloodTributes;
if(saved.length!==72 || saved.some(t=>!t.mediaRef || Object.hasOwn(t,'imageData')))throw Error('Private recovery not compact or not reference-based');
const mediaStore=require('../tribute-media-store').create(DIR);
for(const t of saved)if(mediaStore.read(t.mediaRef)?.dataUrl!==img)throw Error('Private tribute missing or changed after committed server shutdown');
await start();if((await server().api('GET','/health')).status!==200)throw Error('Restored server health failed');await stop();
const after=JSON.parse(fs.readFileSync(snapshot,'utf8')).rooms[0].bloodTributes;
if(after.length!==72 || after.some(t=>!t.mediaRef))throw Error('Second-process recovery dropped an archive');
console.log('MEDIA_RESTART_VERIFIED '+JSON.stringify({archives:72,bytes:fs.statSync(snapshot).size,verifiedBytesAllMatch:true,restarted:true}));
}finally{if(browser)await browser.close();await stop();fs.rmSync(DIR,{recursive:true,force:true,maxRetries:15,retryDelay:100});}})().catch(err=>{console.error('MEDIA_LATENCY_FAIL',err.stack||err);process.exitCode=1});
