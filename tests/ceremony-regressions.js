const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
let overlay=null;const keys=new Set();let calls=[];
function makeOverlay(){const classes=new Set();return {classList:{add:c=>classes.add(c),contains:c=>classes.has(c)},remove(){if(overlay===this)overlay=null},addEventListener(type,fn){this[type]=fn}}}
const context={window:{},GameData:{currentGame:{}},document:{body:{classList:{toggle(){}}},getElementById(){return null},querySelector(sel){return sel.includes(':not')&&overlay?.classList.contains('is-test-preview')?null:overlay},addEventListener(type,fn){if(type==='keydown')keys.add(fn)},removeEventListener(type,fn){keys.delete(fn)}},Skeleton:{playGameLost(result,options){calls.push(options);overlay=makeOverlay();return overlay}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../js/app.js'),'utf8'),context);
const app=context.window.App;app.mode='multiplayer';app.roomCode='MASTER';app.send=()=>assert.fail('preview sent authoritative command');
app.applyLossState(null);app.testGameLost();const preview=overlay;
for(let i=0;i<5;i++)app.applyLossState(null);
assert.equal(overlay,preview);assert.equal(app.gameLost,false);
for(const fn of keys)fn({key:'Escape'});
assert.equal(overlay,null);assert.equal(keys.size,0);
app.testGameLost();overlay.click();assert.equal(overlay,null);
app.testGameLost();app.testGameLost();assert.equal(keys.size,1);
app.applyLossState({outcome:'LOST',occurredAt:1});assert.equal(keys.size,0);assert.equal(app.gameLost,true);assert.equal(overlay.classList.contains('is-test-preview'),false);assert.equal(calls.at(-1).live,true);
const real=overlay;app.testGameLost();assert.equal(overlay,real);app.applyLossState(null);assert.equal(overlay,null);
// Initial loss hydration must also supersede a local preview, without live replay.
app._lossBaselined=false;app.testGameLost();app.applyLossState({outcome:'LOST',occurredAt:2});assert.equal(calls.at(-1).live,false);
const css=fs.readFileSync(require.resolve('../css/asoc.css'),'utf8');
const correction=css.slice(css.indexOf('/* GAME WON viewport'));
assert.match(correction,/\.victory-overlay \{[^}]*safe-area-inset-top[^}]*safe-area-inset-right[^}]*safe-area-inset-bottom[^}]*safe-area-inset-left/);
assert.match(correction,/\.victory-overlay\.is-neural-prelude \{\s*padding: 0 !important/);
assert.match(correction,/\.victory-overlay\.is-neural-prelude \.victory-ceremony \*,[\s\S]*?animation: none !important/);
assert.match(correction,/\.victory-overlay \.victory-dim \{\s*inset: 0 !important/);
console.log('PASS local loss preview isolation, dismissal, authoritative supersession and victory CSS guards');

// Run the actual shared renderer with deterministic DOM/timers and board targets.
function victory(reduce){
  const timers=[],stages=[],animations=[];
  function element(){
    return {style:{},isConnected:true,className:'',
      classList:{remove(){},add(){}},appendChild(){},
      querySelector(){return element()},
      addEventListener(type,fn){this[type]=fn},
      remove(){this.isConnected=false},
      animate(...args){animations.push(args)}};
  }
  const board={querySelector(){return null},getBoundingClientRect(){return {left:10,top:20,width:100,height:30}}};
  const ctx={window:{matchMedia(query){assert.equal(query,'(prefers-reduced-motion: reduce)');return {matches:reduce}}},
    document:{querySelector(){return null},querySelectorAll(){return [board]},createElement:element,body:{appendChild(){}}},
    setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/skeleton.js'),'utf8'),ctx);
  const result=ctx.window.Skeleton.playGameWon({finalSolution:'TEST'},{onStage:s=>stages.push(s),afterMatch:false});
  return {result,timers,stages,animations};
}
const reduced=victory(true);
assert.match(reduced.result.className,/is-static/);
assert.doesNotMatch(reduced.result.className,/is-neural-prelude/);
assert.equal(reduced.animations.length,0);
assert.equal(reduced.timers.length,0,'no blank prelude or delayed ceremony');
assert.deepEqual(reduced.stages,['won']);
reduced.result.click();
assert.equal(reduced.result.isConnected,false);
assert.deepEqual(reduced.stages,['won','done']);
const ordinary=victory(false);
assert.match(ordinary.result.className,/is-live is-neural-prelude/);
assert.equal(ordinary.animations.length,4);
assert.deepEqual(ordinary.timers.map(t=>t.ms),[900,2200,4500,5500]);
assert.deepEqual(ordinary.stages,['verifying']);
ordinary.timers[1].fn();
assert.deepEqual(ordinary.stages,['verifying','won']);
const motionRule=css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
assert.match(motionRule,/\.victory-overlay \*::before,[\s\S]*?\.victory-overlay \*::after \{ animation: none !important; transition: none !important/);
console.log('PASS reduced-motion immediate dismissible victory, no JS sparks, pseudo-element suppression and unchanged normal timing');
