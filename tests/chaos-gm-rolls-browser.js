process.chdir('A:\\ASOC ENGINE');
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
 const fixture=path.resolve('.scratch/chaos-private-roll-fixture.html');
 fs.writeFileSync(fixture,'<html><head><meta charset="utf-8"><link rel="stylesheet" href="../css/chaos.css"></head><body><script>window.App={send(x){window.sent=x}};</script><script src="../js/chaos.js"></script></body></html>');
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 await page.goto('file:///'+fixture.replace(/\\/g,'/'));
 await page.evaluate(()=>{
  window.ChaosGame.onMessage({type:'chaos:result',playerId:'sissy',playerName:'Sissy',value:17,target:50,won:false,dark:false,timestamp:123456});
  window.ChaosGame.onMessage({type:'chaos:result',playerId:'al',playerName:'al',value:87,target:50,won:true,dark:false,timestamp:123457});
 });
 const dock=page.locator('#chaos-gm-rolls');
 assert(await dock.isVisible(),'GM roll receipt is hidden');
 const words=await dock.innerText();
 assert(words.includes('Sissy')&&words.includes('17')&&words.includes('50+')&&words.includes('DEBT')&&words.includes('87')&&words.includes('WIN'),words);
 assert(await dock.locator('.chaos-gm-roll-entry').count()===2);
 assert(await page.locator('#chaos-result').count()===0,'GM should not get player overlay');
 await dock.locator('button').click();
 assert(await dock.isHidden());
 console.log('GM_CHAOS_ROLLS_BROWSER_PASS',words.replace(/\n/g,' | '));
 await browser.close();
})().catch(e=>{console.error('GM_CHAOS_ROLLS_BROWSER_FAIL',e.message);process.exit(1)});
