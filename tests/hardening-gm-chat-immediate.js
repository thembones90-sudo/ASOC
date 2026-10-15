'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');
(async()=>{
  const server=await H.startServer({port:19839,env:{NODE_ENV:'test',ASOC_TEST_ATOMIC_DELAY_MS:'800'}});
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const login=await server.api('POST','/api/auth/gm/login',{password:'browser-gm-pass'});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(token=>{sessionStorage.setItem('asoc_gm_token',token);localStorage.setItem('asoc_master_token',token);},login.data.token);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.base+'/index.html');
    await page.waitForFunction(()=>App.roomCode==='MASTER'&&App.mode==='multiplayer'&&!App._recoverPending&&!App._reconnectPending);
    await page.evaluate(()=>{
      window.gmAcks=[];
      const original=App.handleServerMessage;
      App.handleServerMessage=function(m){if(m.type==='gm:broadcast:ack')window.gmAcks.push(m);return original.call(this,m);};
    });
    const text='Instant GM message '+Date.now();
    const first=await page.evaluate(text=>{
      App.setGMComposerText(text,text.length);
      const original=App.createGMChatMessageHTML;
      App.createGMChatMessageHTML=()=>{throw Error('Pending send rebuilt authoritative history');};
      const start=performance.now();
      try {App.sendShadowBrokerBroadcast();} finally {App.createGMChatMessageHTML=original;}
      const preview=[...document.querySelectorAll('[data-gm-local-chat-id]')].find(el=>el.textContent.includes(text));
      return {ms:performance.now()-start,preview:!!preview,status:preview?.querySelector('[data-delivery]')?.dataset.delivery,
        authoritative:App.chatMessages.filter(m=>m.text===text).length};
    },text);
    assert.equal(first.preview,true,'GM text must appear before the server round trip');
    assert.equal(first.status,'sending');assert.equal(first.authoritative,0);
    assert.ok(first.ms<100,'pending card must not rebuild the complete chat history');
    const shots=path.join(__dirname,'..','.scratch','gm-immediate-chat');fs.mkdirSync(shots,{recursive:true});
    await page.screenshot({path:path.join(shots,'gm-pending.png')});
    await page.waitForFunction(text=>App.chatMessages.some(m=>m.text===text),text,{timeout:15000});
    assert.equal(await page.locator('[data-gm-local-chat-id]').count(),0);
    assert.equal(await page.evaluate(text=>App.chatMessages.filter(m=>m.text===text).length,text),1);
    const message=await page.evaluate(text=>App.chatMessages.find(m=>m.text===text),text);
    assert.ok(message.clientMsgId,'server echoes exact send identity');
    const stored=JSON.parse(fs.readFileSync(path.join(server.dataDir,'active-rooms.json'),'utf8')).rooms.find(r=>r.code==='MASTER');
    assert.ok(stored.gmChatReceipts.some(r=>r.clientMsgId===message.clientMsgId&&r.messageId===message.id),'deduplication receipt is durable independently of recent chat history');
    assert.equal(await page.locator(`[data-message-id="${message.id}"] .sb-glitch-in`).count(),0,'confirmation must not replay its entrance animation');
    await page.evaluate(m=>App.send({type:'gm:broadcast',text:m.text,clientMsgId:m.clientMsgId}),message);
    await page.waitForFunction(id=>gmAcks.some(m=>m.clientMsgId===id&&m.duplicate),message.clientMsgId,{timeout:15000});
    assert.equal(await page.evaluate(text=>App.chatMessages.filter(m=>m.text===text).length,text),1,'retry is deduplicated');
    const same='same-text-'+Date.now();
    const ids=await page.evaluate(text=>{
      for(let i=0;i<2;i++){App.setGMComposerText(text,text.length);App.sendShadowBrokerBroadcast();}
      return [...App._gmLocalChatPending.keys()];
    },same);
    assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
    await page.waitForFunction(text=>App.chatMessages.filter(m=>m.text===text).length===2,same,{timeout:15000});
    assert.equal(await page.locator('[data-gm-local-chat-id]').count(),0,'identical text reconciles by ID, not text');
    const queued='queued-during-reconnect-'+Date.now();
    const state=await page.evaluate(text=>{
      App.ws.close();App.setGMComposerText(text,text.length);App.sendShadowBrokerBroadcast();
      return [...App._gmLocalChatPending.values()].find(m=>m.text===text)?.state;
    },queued);
    assert.equal(state,'queued');
    await page.waitForFunction(text=>App.chatMessages.some(m=>m.text===text),queued,{timeout:20000});
    assert.equal(await page.evaluate(text=>App.chatMessages.filter(m=>m.text===text).length,queued),1);
    const refusedId='refused_gm_fixture';
    await page.evaluate(id=>{
      App._gmLocalChatPending.set(id,{text:'rejected-draft-fixture',state:'sending',at:Date.now()});App.renderGMPendingChat();
      App.send({type:'gm:broadcast',text:'\u0000',clientMsgId:id});
    },refusedId);
    const refused=page.locator(`[data-gm-local-chat-id="${refusedId}"]`);
    await refused.locator('[data-delivery="failed"]').waitFor({timeout:15000});
    assert.equal(await page.evaluate(()=>App.chatMessages.some(m=>m.text==='rejected-draft-fixture')),false);
    await refused.locator('[data-gm-local-chat-retry]').click();
    await page.waitForFunction(()=>App.chatMessages.some(m=>m.text==='rejected-draft-fixture'),null,{timeout:15000});
    assert.equal(await page.locator('[data-gm-local-chat-id]').count(),0);
    const slashCount=await page.evaluate(()=>{
      App.setGMComposerText('/commands',9);App.sendShadowBrokerBroadcast();return App._gmLocalChatPending.size;
    });
    assert.equal(slashCount,0,'private slash commands never become local public messages');
    assert.deepEqual(errors,[]);
    console.log('PASS GM immediate chat: local preview '+first.ms.toFixed(2)+'ms, no history rebuild, exact-ID reconciliation, identical text, reconnect, deduplicated retry, real refusal/retry, no confirmation animation');
  }finally{if(browser)await browser.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
