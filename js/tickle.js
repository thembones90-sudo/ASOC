(() => {
'use strict';
let expiry = null, audioContext = null;
const BROKER = 'shadow-broker';
const make = (tag, cls, content) => { const e=document.createElement(tag); e.className=cls||''; if(content!==undefined)e.textContent=content; return e; };
const soundOn = () => { try { return localStorage.getItem('asoc_tickle_sound')==='on'; } catch { return false; } };
function squeak(){
 if(!soundOn())return;
 try{
  const C=window.AudioContext||window.webkitAudioContext; if(!C)return;
  audioContext ||= new C(); if(audioContext.state!=='running')return;
  const o=audioContext.createOscillator(),g=audioContext.createGain(),t=audioContext.currentTime;
  o.type='sine';o.frequency.setValueAtTime(610,t);o.frequency.exponentialRampToValueAtTime(960,t+.09);o.frequency.exponentialRampToValueAtTime(430,t+.20);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.04,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+.21);
  o.connect(g).connect(audioContext.destination);o.start(t);o.stop(t+.22);
 }catch{}
}
function clear(){clearTimeout(expiry); expiry=null; document.getElementById('asoc-tickle-layer')?.remove();}
function onMessage(m, playerId, isGm=false){
 if(m?.type!=='tickle:impact')return;
 clear();
 const me=isGm?BROKER:String(playerId||sessionStorage.getItem('asoc_player_id')||'');
 const role=me===String(m.targetId)?'victim':me===String(m.actorId)?'attacker':'observer';
 const result=['happy','angry','broker'].includes(m.outcome)?m.outcome:'happy';
 const cursed=String(m.actorId)===BROKER;
 const reduced=!!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
 const layer=make('div',['asoc-tickle-layer','is-'+role,'is-'+result,cursed?'is-cursed':'',m.revenge?'is-revenge':'',reduced?'is-reduced':''].filter(Boolean).join(' '));
 layer.id='asoc-tickle-layer';layer.setAttribute('aria-live','polite');
 const stage=make('div','asoc-tickle-stage');
 if(role==='victim'){
  stage.appendChild(make('div','asoc-tickle-intro',m.revenge?'REVENGE!':cursed?'THE BROKER HAS CHOSEN':'TICKLE AMBUSH'));
  const face=make('div','asoc-tickle-face');
  face.append(make('div','asoc-tickle-face-icon',result==='angry'?'😤':result==='broker'?'👁️':'😂'),make('div','asoc-tickle-face-name',String(m.targetName||'Little Hero').slice(0,70)));
  stage.appendChild(face);
  if(!reduced){
   stage.append(make('div','asoc-tickle-feather feather-left','🪶'),make('div','asoc-tickle-feather feather-right','🪶'));
   const particles=make('div','asoc-tickle-particles');
   const signs=result==='angry'?['💢','😠','🪶']:result==='broker'?['👁️','✦','🪶']:['😂','✨','🪶'];
   for(let i=0;i<(m.revenge?16:10);i++){const item=make('span','asoc-tickle-particle',signs[i%3]);item.style.setProperty('--i',i);item.style.left=(5+i*6)+'%';particles.appendChild(item);}
   stage.appendChild(particles);
  }
 }
 const caption=make('div','asoc-tickle-caption');
 caption.append(make('strong','',m.revenge?'DOUBLE TICKLE REVENGE':result==='angry'?'TICKLE BACKFIRED':result==='broker'?'SHADOW BROKER DISAPPROVES':'TICKLE ATTACK'),make('span','',String(m.actorName||'Someone').slice(0,70)+' 🪶 '+String(m.targetName||'someone').slice(0,70)));
 stage.appendChild(caption);
 if(role!=='observer'){
  const toggle=make('button','asoc-tickle-sound',soundOn()?'♪ Sound on':'♪ Sound off');
  toggle.type='button';toggle.setAttribute('aria-label','Toggle tickle sound');
  toggle.addEventListener('click',()=>{
   const next=!soundOn();try{localStorage.setItem('asoc_tickle_sound',next?'on':'off');}catch{}
   toggle.textContent=next?'♪ Sound on':'♪ Sound off';
   if(next){try{const C=window.AudioContext||window.webkitAudioContext;if(C){audioContext ||= new C();audioContext.resume().then(squeak).catch(()=>{});}}catch{}}
  });
  stage.appendChild(toggle);
 }
 layer.appendChild(stage);document.body.appendChild(layer);
 if(role==='victim')squeak();
 expiry=setTimeout(clear,reduced?1800:role==='victim'?3550:1900);
}
window.AsocTickle=Object.freeze({onMessage,clear});
})();