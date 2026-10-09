process.chdir('A:\\ASOC ENGINE');
const fs=require('fs'),path=require('path'),assert=require('assert'),{chromium}=require('playwright');
(async()=>{
 const app=fs.readFileSync('js/app.js','utf8'),player=fs.readFileSync('js/player.js','utf8');
 for(const name of ['chaos:tributeOffered','gm:chaosCastResult','chaos:result'])assert(app.includes("case '"+name+"':"));
 assert(app.includes('window.ChaosGame?.onMessage?.(message)'));
 for(const name of ['chaos:tributeSent','chaos:tributeRejected','chaos:result'])assert(player.includes("case '"+name+"':"));
 const fixture=path.resolve('.scratch/chaos-gm-pipeline-fixture.html');
 fs.writeFileSync(fixture,'<html><head><meta charset="utf-8"><link rel="stylesheet" href="../css/chaos.css"></head><body><script>window.App={send:x=>(window.sent=(window.sent||[]).concat([x]))};</script><script src="../js/chaos.js"></script></body></html>');
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1024,height:768}});
 await page.goto('file:///'+fixture.replace(/\\/g,'/'));
 const image='data:image/png;base64,iVBORw0KGgo=';
 await page.evaluate(img=>{
 window.ChaosGame.onState({chaos:{sissy:{status:'judging',playerId:'sissy',id:'chaos1',serverNow:Date.now()}}});
 window.ChaosGame.onMessage({type:'chaos:tributeOffered',tributeId:'image123',playerId:'sissy',playerName:'Sissy',roll:43,target:60,imageData:img});
 },image);
 const card=page.locator('#chaos-gm-card');
 assert(await card.isVisible(),'GM card hidden');
 assert((await card.innerText()).includes('Sissy'),'wrong player');
 assert(await card.locator('.chaos-image').getAttribute('src')===image,'image not forwarded into card');
 await card.locator('[data-chaos-accept-tribute]').click();
 const sent=await page.evaluate(()=>window.sent);
 assert(sent.some(x=>x.type==='gm:chaosTributeDecision'&&x.tributeId==='image123'&&x.playerId==='sissy'&&x.accepted),'GM accept not connected to tribute identity');
 console.log('CHAOS_GM_DELIVERY_BROWSER_PASS',JSON.stringify({imageShown:true,acceptFor:'image123',pendingRequests:sent.filter(x=>x.type==='gm:chaosPending').length}));
 await browser.close();
})().catch(e=>{console.error('CHAOS_GM_DELIVERY_FAIL',e.message);process.exit(1)});
