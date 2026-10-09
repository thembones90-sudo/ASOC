process.chdir('A:\\ASOC ENGINE');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const html='<html><head><meta charset="utf-8"><link rel="stylesheet" href="file:///'+path.resolve('css/dropkick.css').replace(/\\/g,'/')+'"></head><body style="background:#0e1020;color:white"><main style="margin:3rem">ASOC GAME BOARD - VISUAL TEST</main><script src="file:///'+path.resolve('js/dropkick.js').replace(/\\/g,'/')+'"></script></body></html>';
  const file=path.resolve('.scratch/dropkick-render-test.html');fs.writeFileSync(file,html);
  await page.goto('file:///'+file.replace(/\\/g,'/'));
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;const c=canvas.getContext('2d');c.fillStyle='#884add';c.fillRect(0,0,100,100);c.font='bold 54px sans-serif';c.fillStyle='#fff';c.fillText('D',25,70);window.testAvatar=canvas.toDataURL('image/png');
    window.AsocDropkick.onMessage({type:'dropkick:impact',outcome:'hit',actorId:'shadow-broker',actorName:'SHADOW BROKER',actorAvatarData:window.testAvatar,targetId:'p2',targetName:'Dennis',targetAvatarData:window.testAvatar},'p2',false);
  });
  const initial=await page.locator('.asoc-dropkick-ball').evaluate(el=>({animation:getComputedStyle(el).animationName,image:el.querySelector('img')?.complete,transform:getComputedStyle(el).transform}));
  await page.waitForTimeout(1000);
  const middle=await page.locator('.asoc-dropkick-ball').evaluate(el=>({animation:getComputedStyle(el).animationName,image:el.querySelector('img')?.complete,transform:getComputedStyle(el).transform}));
  await page.screenshot({path:path.resolve('.scratch/dropkick-frame.png')});
  await page.waitForTimeout(700);
  const later=await page.locator('.asoc-dropkick-ball').evaluate(el=>({transform:getComputedStyle(el).transform}));
  if(initial.transform===middle.transform || middle.transform===later.transform)throw Error('Ball did not move');
  console.log('BROWSER_ANIMATION_PASS',JSON.stringify({initial,middle,later,keeper:await page.locator('.asoc-dropkick-keeper').count()}));
  await browser.close();
})().catch(e=>{console.error('BROWSER_TEST_ERROR',e.message);process.exit(1)});
