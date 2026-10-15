'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {execFileSync}=require('child_process');
const {chromium}=require('playwright');
const H=require('./lib/browser-harness');
const shots=path.join(__dirname,'..','.scratch','comms-polish');
(async()=>{
 const server=await H.startServer({port:19845});let browser;
 try{
  fs.mkdirSync(shots,{recursive:true});
  browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
  await ctx.addInitScript(token=>{sessionStorage.setItem('asoc_gm_token',token);localStorage.setItem('asoc_master_token',token);},login.data.token);
  const gm=await ctx.newPage(),errors=[];gm.on('pageerror',e=>errors.push(e.message));
  await gm.goto(server.base+'/index.html');
  await gm.waitForFunction(()=>App.roomCode==='MASTER'&&App.mode==='multiplayer');
  // Scheduled class warnings are unrelated to these visual fixtures.
  await gm.addStyleTag({content:'#class-warning-banner{display:none !important} #battle-controls-panel button{animation:none !important;transition:none !important}'});
  const geometry=()=>gm.locator('#battle-controls-panel button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{id:n.id,width:+r.width.toFixed(2),height:+r.height.toFixed(2),art:getComputedStyle(n).backgroundImage};}));
  const current=await geometry();
  const baseline=execFileSync('git',['show','HEAD:css/asoc.css'],{cwd:H.ROOT,encoding:'utf8',maxBuffer:3000000});
  await gm.route('**/css/asoc.css?polish-baseline',r=>r.fulfill({contentType:'text/css',body:baseline}));
  await gm.evaluate(()=>new Promise(resolve=>{const link=document.querySelector('link[href^="css/asoc.css"]');link.onload=resolve;link.href='css/asoc.css?polish-baseline';}));
  assert.deepEqual(await geometry(),current,'battle button geometry and background artwork are untouched');
  await gm.evaluate(()=>new Promise(resolve=>{const link=document.querySelector('link[href^="css/asoc.css"]');link.onload=resolve;link.href='css/asoc.css?v=20261015-comms-polish-1';}));
  await gm.evaluate(()=>{document.getElementById('shadow-broker-composer').focus();window.dialogResult=null;AsocDialog.prompt({title:'NAME YOUR SHELL',message:'Prepare the forthcoming game.',required:true,maxLength:20}).then(v=>window.dialogResult={v});});
  const input=gm.locator('.asoc-dialog-input');await input.focus();
  await gm.keyboard.press('Shift+Tab');assert.equal(await gm.locator('.asoc-dialog-confirm').evaluate(n=>n===document.activeElement),true);
  await gm.keyboard.press('Tab');assert.equal(await input.evaluate(n=>n===document.activeElement),true);
  await gm.locator('.asoc-dialog-confirm').click();assert.equal(await input.getAttribute('aria-invalid'),'true');
  await input.fill('NEXT BATTLE');
  await gm.screenshot({path:path.join(shots,'desktop-dialog.png')});
  await gm.keyboard.press('Enter');await gm.waitForFunction(()=>window.dialogResult?.v==='NEXT BATTLE');
  assert.equal(await gm.locator('#shadow-broker-composer').evaluate(n=>n===document.activeElement),true);
  // Mock only the upload outcome; use the actual shipping composer and DOM.
  await gm.evaluate(()=>{
    window.uploadAttempt=0;window.uploadCaption='a caption to keep';window.uploadResolve=null;
    const form=document.createElement('form');form.id='polish-upload-fixture';form.innerHTML='<div class="chat-composer-shell"></div>';document.body.appendChild(form);
    Object.assign(form.style,{position:'fixed',left:'30px',bottom:'30px',width:'480px',zIndex:22000});
    window.polishComposer=ChatMediaComposer.create({form,getCaption:()=>window.uploadCaption,clearCaption:()=>window.uploadCaption='',uploadFile:async(file,caption,{onProgress})=>{
      window.uploadAttempt++;window.sentFile=file;onProgress(45);await new Promise(resolve=>window.uploadResolve=resolve);if(window.uploadAttempt===1)throw Error('Test upload refused');
    }});
    polishComposer.stageFile(new File([new Uint8Array(128)],'ritual.png',{type:'image/png'}));
    window.uploadPromise=polishComposer.submit();
  });
  assert.equal(await gm.locator('#polish-upload-fixture progress').evaluate(n=>n.value),45);
  assert.equal(await gm.evaluate(()=>polishComposer.stageFile(new File(['x'],'replacement.png',{type:'image/png'}))),false,'cannot replace in-flight attachment');
  await gm.evaluate(()=>uploadResolve());
  await gm.locator('#polish-upload-fixture [data-state="failed"]').waitFor();
  assert.equal(await gm.evaluate(()=>uploadCaption),'a caption to keep');assert.equal(await gm.evaluate(()=>polishComposer.hasPending()),true);
  await gm.screenshot({path:path.join(shots,'attachment-retry.png')});
  await gm.locator('#polish-upload-fixture .chat-pending-media-retry').click();
  await gm.evaluate(()=>uploadResolve());await gm.waitForFunction(()=>!polishComposer.hasPending());
  assert.equal(await gm.evaluate(()=>uploadAttempt),2);assert.equal(await gm.evaluate(()=>uploadCaption),'');
  await gm.evaluate(()=>document.getElementById('polish-upload-fixture').remove());
  // Real authenticated upload through the actual GM composer/XHR transport.
  const png=fs.readFileSync(path.join(H.ROOT,'assets','tombola','vault-numberless.png'));
  await gm.locator('#gm-image-upload-input').setInputFiles({name:'vault.png',mimeType:'image/png',buffer:png});
  await gm.evaluate(()=>App._gmMediaComposer.submit());
  await gm.waitForFunction(()=>App.chatMessages.some(m=>m.source==='shadowBroker'&&m.imageUrl));
  assert.equal(await gm.evaluate(()=>App._gmMediaComposer.hasPending()),false);
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await phone.grantPermissions(['microphone'],{origin:server.base});
  const hero=await H.openHeroPage(phone,server,await H.heroToken(server,'Polish Hero'));hero.on('pageerror',e=>errors.push(e.message));
  await hero.addStyleTag({content:'#class-warning-banner{display:none !important}'});
  await hero.evaluate(()=>{window.phoneResult=null;AsocDialog.prompt({title:'TRIBUTE REASON',message:'Explain your decision.',required:true}).then(v=>window.phoneResult={v});});
  const bounds=await hero.locator('.asoc-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
  await hero.screenshot({path:path.join(shots,'mobile-dialog.png')});
  await hero.keyboard.press('Escape');assert.equal(await hero.locator('.asoc-dialog').count(),0);
  // A player URL import refusal must keep its pending image and caption.
  await hero.route('**/api/chat/image-url',r=>r.fulfill({status:415,contentType:'application/json',body:JSON.stringify({error:'Test image unavailable'})}));
  await hero.evaluate(()=>{PlayerApp._chatMediaComposer.stageUrl('https://example.com/missing.png');document.getElementById('chat-input').value='keep my caption';window.playerUrlAttempt=PlayerApp._chatMediaComposer.submit();});
  await hero.locator('.chat-pending-media[data-state="failed"]').waitFor();
  assert.equal(await hero.locator('#chat-input').inputValue(),'keep my caption');assert.equal(await hero.evaluate(()=>PlayerApp._chatMediaComposer.hasPending()),true);
  await hero.locator('.chat-pending-media-remove').click();
  // A real recording survives a refused request and can be retried unchanged.
  let voiceAttempts=0;
  await hero.route('**/api/chat/voice?*',async route=>{voiceAttempts++;if(voiceAttempts===1)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Test storage unavailable"}'});return route.continue();});
  await hero.locator('#chat-voice-btn').click();await H.sleep(1300);await hero.locator('.voice-recorder-send').click();
  await hero.locator('.voice-recorder.is-failed').waitFor();assert.equal(await hero.locator('.voice-recorder-send').isEnabled(),true);
  await hero.locator('.voice-recorder-send').click();await hero.locator('.chat-voice').first().waitFor();assert.equal(await hero.locator('.voice-recorder').count(),0);assert.equal(voiceAttempts,2);
  assert.deepEqual(errors,[]);
  console.log('PASS comms polish: unchanged battle artwork/sizes, dialog focus/validation/return/mobile, upload progress/retained draft/retry, real authenticated image, URL refusal, voice recording retry');
 }finally{if(browser)await browser.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
