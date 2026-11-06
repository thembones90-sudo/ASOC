'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const os=require('os');const http=require('http');
const {chromium,_electron}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'asoc-recovery-'));let electron,browser;
 const source=fs.readFileSync(path.join(ROOT,'desktop/offline.html'),'utf8').replace('let seconds = 10;','let seconds = 1;');
 const old=source.replace('clearInterval(timer);','').replace('if (retrying) return;','');
 let baseline=0,recovery=0;let base;
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/old')){res.writeHead(200,{'content-type':'text/html'});return res.end(old.replace("params.get('target') || 'https://asocengine.com'",`'${base}/baseline-slow'`));}
  if(req.url.startsWith('/baseline-slow')){baseline++;return setTimeout(()=>{if(!res.destroyed)res.end('<title>Loaded</title>');},2500);}
  if(req.url.startsWith('/join.html')){recovery++;if(recovery===1)return req.socket.destroy();return setTimeout(()=>{if(!res.destroyed){res.setHeader('content-type','text/html');res.end('<title>ASOC recovered</title><h1>GAME RESTORED</h1>');}},2500);}
  res.end('ok');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(base+'/old');await sleep(4400);
  assert.ok(baseline>=3,'old repeated interval interrupts pending slow navigation');await browser.close();browser=null;
  console.log(`REPRODUCED old recovery loop: ${baseline} navigation attempts in 4.4s`);
  fs.writeFileSync(path.join(data,'offline.html'),source);
  const fixture=path.join(data,'main.js');
  fs.writeFileSync(fixture,`const {app,BrowserWindow}=require('electron');const {attachRecovery}=require(${JSON.stringify(path.join(ROOT,'desktop/recovery.js'))});app.setPath('userData',${JSON.stringify(path.join(data,'profile'))});app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});attachRecovery(win,{origin:${JSON.stringify(base)},startUrl:${JSON.stringify(base)},offlinePage:${JSON.stringify(path.join(data,'offline.html'))}});global.testWindow=win;win.loadURL(${JSON.stringify(base+'/join.html?keep=1')}).catch(()=>{});});`);
  electron=await _electron.launch({executablePath:process.env.ASOC_TEST_ELECTRON || 'A:\\ASOC ENGINE\\desktop\\node_modules\\electron\\dist\\electron.exe',args:[fixture]});
  const win=await electron.firstWindow();await win.waitForURL(/offline\.html/);
  assert.equal(new URL(win.url()).searchParams.get('target'),base+'/join.html?keep=1','failed player URL preserved');
  await win.waitForURL(base+'/join.html?keep=1',{timeout:12000});await win.locator('h1').waitFor();assert.equal(recovery,2,'single automatic retry waits for slow navigation to complete');
  await electron.evaluate(()=>{testWindow.webContents.emit('did-fail-load',{},-118,'ERR_CONNECTION_TIMED_OUT','https://other.example/',true);testWindow.webContents.emit('did-fail-load',{},-118,'ERR_CONNECTION_TIMED_OUT',testWindow.webContents.getURL(),false);testWindow.webContents.emit('did-fail-load',{},-3,'ERR_ABORTED',testWindow.webContents.getURL(),true);});
  await sleep(200);assert.equal(await win.locator('h1').textContent(),'GAME RESTORED','subresource, external and aborted loads never replace game');
  await electron.evaluate(()=>testWindow.webContents.emit('did-fail-load',{},-118,'ERR_CONNECTION_TIMED_OUT',testWindow.webContents.getURL(),true));
  await win.waitForURL(/offline\.html/);await win.locator('#retry').evaluate(button=>{button.click();button.click();window.dispatchEvent(new Event('online'));});
  await win.waitForURL(base+'/join.html?keep=1',{timeout:10000});assert.equal(recovery,3,'manual/online events cannot duplicate an in-flight attempt');
  console.log('PASS real Electron recovery: automatic and manual reconnect, slow navigation survives, route preserved, pending attempts deduplicated, safe failure guards');
 }finally{if(electron)await electron.close();if(browser)await browser.close();await new Promise(r=>server.close(r));fs.rmSync(data,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
})().catch(e=>{console.error(e);process.exitCode=1;});
