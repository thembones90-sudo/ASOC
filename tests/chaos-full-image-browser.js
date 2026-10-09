process.chdir('A:\\ASOC ENGINE');
const { chromium }=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
const fixture=path.resolve('.scratch/chaos-image-full-fixture.html');
fs.writeFileSync(fixture,'<html><head><meta charset="utf-8"><link rel="stylesheet" href="../css/chaos.css"></head><body><script>window.App={send:x=>window.lastSent=x};</script><script src="../js/chaos.js"></script></body></html>');
const browser=await chromium.launch({headless:true});
for (const [w,h] of [[1280,800],[390,720],[800,440]]) {
const page=await browser.newPage({viewport:{width:w,height:h}});
await page.goto('file:///'+fixture.replace(/\\/g,'/'));
await page.evaluate(()=>{
const c=document.createElement('canvas');c.width=720;c.height=1240;const ctx=c.getContext('2d');ctx.fillStyle='#312044';ctx.fillRect(0,0,720,1240);ctx.fillStyle='#eebaff';ctx.fillRect(0,0,100,80);ctx.fillRect(620,1160,100,80);
window.ChaosGame.onState({chaos:{sissy:{status:'judging',playerId:'sissy',id:'c1',serverNow:Date.now()}}});
window.ChaosGame.onMessage({type:'chaos:tributeOffered',tributeId:'image-full',playerId:'sissy',playerName:'Sissy',roll:43,target:60,imageData:c.toDataURL()});
});
await page.locator('[data-chaos-enlarge]').click();
const modal=page.locator('#chaos-full-tribute'),image=modal.locator('img');
assert(await modal.isVisible());
const geom=await image.evaluate(img=>({width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,clientWidth:innerWidth,clientHeight:innerHeight,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,fit:getComputedStyle(img).objectFit}));
assert(geom.width<=w-20&&geom.height<=h-80&&geom.naturalWidth===720&&geom.naturalHeight===1240&&geom.fit==='contain',JSON.stringify(geom));
await page.keyboard.press('Escape');
assert(await modal.count()===0,'Escape must close viewer');
await page.locator('[data-chaos-enlarge]').click();
await page.locator('#chaos-full-tribute button').click();
assert(await page.locator('#chaos-full-tribute').count()===0,'button must close viewer');
console.log('FULL_TRIBUTE_IMAGE_PASS',w,h,JSON.stringify(geom));
await page.close();
}
await browser.close();
})().catch(e=>{console.error('FULL_TRIBUTE_IMAGE_FAIL',e.message);process.exit(1)});
