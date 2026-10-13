'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const PORT=18987;
const files=http.createServer((req,res)=>{
 const p=path.resolve(ROOT,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if (!p.startsWith(ROOT+path.sep)) {res.writeHead(403);return res.end();}
 const ext=path.extname(p);
 if (!fs.existsSync(p)||!fs.statSync(p).isFile()) {res.writeHead(404);return res.end();}
 if(ext==='.js'){res.writeHead(204);return res.end();}
 res.writeHead(200,{'content-type':ext==='.css'?'text/css':ext==='.html'?'text/html':'application/octet-stream'});
 fs.createReadStream(p).pipe(res);
});
(async()=>{
 await new Promise(resolve=>files.listen(PORT,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:980},javaScriptEnabled:false});
  const response=await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForLoadState('load'); const result=await page.evaluate(()=>{
    const panel=document.getElementById('battle-controls-panel');
    if(!panel)throw new Error('battle controls panel not found');
    document.body.className='room-mode-battle';
    document.body.appendChild(panel);
    panel.style.maxWidth='900px';
    panel.style.width='900px';
    const grid=panel.querySelector('.battle-controls-grid');
    const row=panel.querySelector('.battle-controls-utility-row');
    const add=(id,parent)=>{if(!document.getElementById(id)){const b=document.createElement('button');b.id=id;b.textContent=id;parent.appendChild(b)}};
    add('shame-gm-button',grid);
    add('chaos-gm-button',row);
    add('broker-transmog-btn',row);
    const ids=['shame-gm-button','spectral-console','room-mode-toggle','bice-asoc-btn','dragon-raid-setup-btn',
      'nema-asoc-btn','black-market-gm-button','chaos-gm-button','poison-gm-button','blood-scope-gm-button',
      'quests-btn','library-btn-footer','reset-board-btn','master-access-btn','load-shell-btn'];
    const items=ids.map(id=>{const el=document.getElementById(id);const b=el?.getBoundingClientRect();return {id,x:b?.x,y:b?.y,w:b?.width,h:b?.height,display:el?getComputedStyle(el).display:'missing'};});
    const sound=document.getElementById('sound-toggle-btn');
    const transmog=document.getElementById('broker-transmog-btn');
    const hidden={sound:getComputedStyle(sound).display,transmog:getComputedStyle(transmog).display};
    const cols=getComputedStyle(panel).gridTemplateColumns;
    document.body.className='room-mode-casual';
    const casual={sound:getComputedStyle(sound).display,transmog:getComputedStyle(transmog).display};
    return {items,hidden,casual,cols};
  });
  assert.equal(result.hidden.sound,'none','sound control should be hidden in battle');
  assert.equal(result.hidden.transmog,'none','transmog should be hidden in battle');
  assert.ok(result.items.every(x=>x.w>10&&x.h>10),'missing or hidden control '+JSON.stringify(result.items));
  for(let r=0;r<3;r++){
    const row=result.items.slice(r*5,r*5+5);
    assert.ok(row.every(x=>Math.abs(x.y-row[0].y)<3),'row '+(r+1)+' not aligned '+JSON.stringify(row));
    assert.ok(row.every((x,i)=>i===0||x.x>row[i-1].x),'row '+(r+1)+' wrong order '+JSON.stringify(row));
  }
  assert.ok(result.items[5].y>result.items[0].y&&result.items[10].y>result.items[5].y,'three distinct rows');
  assert.equal(result.casual.sound==='none',false,'casual sound must remain accessible');
  console.log('PASS 3x5 GM battle controls: fifteen ordered cells, battle sound/transmog removed, casual sound preserved');
 }finally{if(browser)await browser.close();await new Promise(resolve=>files.close(resolve));}
})().catch(e=>{console.error('FAIL GM command deck',e);process.exitCode=1;});
