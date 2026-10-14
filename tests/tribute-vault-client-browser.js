'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname,'..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(),'asoc-vault-browser-'));
const PORT = Number(process.env.ASOC_VAULT_BROWSER_PORT)||18931;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const health=()=>new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${PORT}/health`,res=>{res.resume();resolve(res.statusCode);}).on('error',reject));

(async()=>{
  const server=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(PORT),ASOC_DATA_DIR:DATA,ASOC_GM_PASSWORD:'browser-pass',ASOC_EMAIL_VERIFICATION:'0',ASOC_MIN_FREE_DISK_BYTES:'0'},stdio:['ignore','ignore','pipe']});
  let browser;
  try {
    for(let i=0;i<100;i++){try{if(await health()===200)break;}catch{}await sleep(100);}
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    const testHtml=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script[\s\S]*?<\/script>/gi,'');
    await page.setContent(testHtml,{waitUntil:'domcontentloaded'});
    const appSource=fs.readFileSync(path.join(ROOT,'js','app.js'),'utf8').replace('const App = {','window.__TestApp = {');
    await page.addScriptTag({content:appSource});
    const initial=await page.evaluate(()=>{
      window.__vaultSent=[];
      window.__vaultObservers=[];
      window.IntersectionObserver=class{constructor(cb){this.cb=cb;this.targets=[];window.__vaultObservers.push(this);}observe(node){this.targets.push(node);}unobserve(node){this.targets=this.targets.filter(x=>x!==node);}disconnect(){this.targets=[];}};
      const App=window.__TestApp;
      App.send=message=>window.__vaultSent.push(message);
      App.mode='multiplayer';App.roomCode='MASTER';App._reliquaryUnlocked=true;
      App.bloodTributes=Array.from({length:20},(_,i)=>({id:'visual-'+i,playerName:'Hero '+i,submittedAt:Date.now(),imageAvailable:true,reliquary:true,viewedByGM:false}));
      document.getElementById('blood-tribute-vault-modal').hidden=false;
      App.renderBloodTributeVault();
      return {cards:document.querySelectorAll('.blood-vault-card').length,images:document.querySelectorAll('.blood-vault-image img').length,sent:window.__vaultSent.length,observed:window.__vaultObservers.at(-1).targets.length};
    });
    assert.deepEqual(initial,{cards:20,images:20,sent:0,observed:20},'vault keeps image cards and does not eagerly fetch them');
    const loaded=await page.evaluate(()=>{
      const App=window.__TestApp;
      const observer=window.__vaultObservers.at(-1);
      observer.cb(observer.targets.slice(0,3).map(target=>({target,isIntersecting:true})));
      const first=window.__vaultSent[0];
      App.handleServerMessage({type:'tribute:image',id:first.id,requestId:first.requestId,imageData:'data:image/png;base64,iVBORw0KGgo='});
      App.openBloodTributeImage(App.bloodTributes[0]);
      return {sent:window.__vaultSent.filter(x=>x.type==='gm:tributeImageGet').length,firstSrc:document.querySelector('img[data-vault-image-id="visual-0"]').src,viewerOpen:document.getElementById('blood-vault-viewer').hidden===false,cacheSize:App._tributeImageCache.size};
    });
    assert.equal(loaded.sent,2,'viewport loader keeps only one request active and advances one queued item');
    assert.match(loaded.firstSrc,/^data:image\/png;base64,/);
    assert.equal(loaded.viewerOpen,true,'loaded thumbnail remains an explicit usable viewer control');
    assert.equal(loaded.cacheSize,1);
    const bounded=await page.evaluate(()=>{
      const App=window.__TestApp;
      for(let i=1;i<14;i++){const data='data:image/png;base64,AAAA'+i;App.cacheTributeImage('visual-'+i,data);App.applyTributeImage('visual-'+i,data,'thumbnail');}
      const cache=App.tributeImageCache();
      return {cache:cache.size,loaded:[...document.querySelectorAll('img[data-vault-image-id][src]')].length};
    });
    assert.ok(bounded.cache<=12&&bounded.loaded<=12,'session and DOM retain at most twelve thumbnail images');
    const sealed=await page.evaluate(()=>{
      const App=window.__TestApp;
      const pending=App._tributeImagePending;
      App.closeBloodTributeVault();
      if(pending)App.handleServerMessage({type:'tribute:image',id:pending.id,requestId:pending.requestId,imageData:'data:image/png;base64,AAAA'});
      return {locked:App._reliquaryUnlocked,cache:App._tributeImageCache,images:document.querySelectorAll('#blood-vault-grid img').length,last:window.__vaultSent.at(-1)};
    });
    assert.equal(sealed.locked,false);assert.equal(sealed.cache,null);assert.equal(sealed.images,0);assert.equal(sealed.last.type,'gm:reliquaryLock');
    console.log('PASS tribute vault browser: visual image cards, viewport lazy loading, bounded request concurrency, viewer use, and close-time memory sealing');
  }finally{if(browser)await browser.close();await require('./lib/stop-process')(server);fs.rmSync(DATA,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
})().catch(error=>{console.error('FAIL tribute vault browser:',error);process.exit(1);});
