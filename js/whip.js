(() => {
'use strict';
const BROKER = 'shadow-broker';
let clearTimer = null;
let audioContext = null;
function clear() { clearTimeout(clearTimer); document.getElementById('asoc-whip-effect')?.remove(); }
function avatar(src, fallback) {
  const el=document.createElement('div'); el.className='asoc-whip-avatar';
  if (/^(data:image\/(png|jpeg|webp|gif);base64,|\/|assets\/|https?:\/\/)/i.test(String(src||''))) {
    const image=document.createElement('img'); image.src=src; image.alt='';
    image.onerror=()=>{image.remove();el.textContent=String(fallback||'?').slice(0,2).toUpperCase()};
    el.appendChild(image);
  } else el.textContent=String(fallback||'?').slice(0,2).toUpperCase();
  return el;
}
function crack() {
  try {
    const Context=window.AudioContext||window.webkitAudioContext;
    if (!Context) return;
    audioContext ||= new Context();
    if (audioContext.state==='suspended') return;
    const duration=.15, n=Math.floor(audioContext.sampleRate*duration);
    const buffer=audioContext.createBuffer(1,n,audioContext.sampleRate), data=buffer.getChannelData(0);
    for(let i=0;i<n;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/n,6);
    const noise=audioContext.createBufferSource();noise.buffer=buffer;
    const filter=audioContext.createBiquadFilter(); filter.type='highpass';filter.frequency.value=750;
    const gain=audioContext.createGain();gain.gain.value=.19;
    noise.connect(filter);filter.connect(gain);gain.connect(audioContext.destination);
    noise.start();noise.stop(audioContext.currentTime+duration);
  } catch {}
}
function onMessage(event, playerId, isGM=false) {
  if (event?.type!=='whip:impact') return;
  clear();
  const id=isGM?BROKER:String(playerId||'');
  const victim=String(event.victimId||'');
  const role=id===victim?'victim':id===String(event.actorId)?'attacker':'observer';
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const hijacked=event.hijacked===true;
  const layer=document.createElement('aside');
  layer.id='asoc-whip-effect';
  layer.className='asoc-whip-'+role+(hijacked?' is-hijacked':'')+(reduced?' reduced-motion':'');
  layer.setAttribute('role','status');
  layer.setAttribute('aria-live','polite');
  const stage=document.createElement('div');stage.className='asoc-whip-stage';
  const kicker=document.createElement('div');kicker.className='asoc-whip-kicker';
  kicker.textContent=hijacked?'WHIP HIJACK // 15% REVERSAL':'THE WHIP HAS SPOKEN';
  const combatants=document.createElement('div');combatants.className='asoc-whip-combatants';
  const left=document.createElement('div');left.className='asoc-whip-combatant asoc-whip-actor';
  const right=document.createElement('div');right.className='asoc-whip-combatant asoc-whip-target';
  const attacker=hijacked?{name:event.targetName,avatar:event.targetAvatarData}:{name:event.actorName,avatar:event.actorAvatarData};
  const receiver=hijacked?{name:event.actorName,avatar:event.actorAvatarData}:{name:event.targetName,avatar:event.targetAvatarData};
  function fighter(box,who) {
    box.appendChild(avatar(who.avatar,who.name));
    const label=document.createElement('span');label.textContent=String(who.name||'LITTLE HERO').slice(0,50);
    box.appendChild(label);
  }
  fighter(left,attacker);fighter(right,receiver);
  const whip=document.createElement('div');whip.className='asoc-whip-lash';
  whip.innerHTML='<svg viewBox="0 0 320 150" preserveAspectRatio="none" aria-hidden="true"><path d="M 10 127 Q 70 10 158 53 Q 220 93 310 32"/></svg>';
  const flash=document.createElement('span');flash.className='asoc-whip-crack';flash.textContent='CRACK!';
  combatants.append(left,whip,right,flash);
  const line=document.createElement('div');line.className='asoc-whip-line';line.textContent=String(event.line||'THE WHIP HAS SPOKEN.').slice(0,240);
  stage.append(kicker,combatants,line);layer.appendChild(stage);document.body.appendChild(layer);
  if (!reduced) setTimeout(crack,660);
  clearTimer=setTimeout(clear,reduced?1500:(role==='victim'?3600:2600));
}
// Audio begins only after a user gesture, respecting browser autoplay restrictions.
document.addEventListener('pointerdown', () => {
  try { const C=window.AudioContext||window.webkitAudioContext; if(C){ audioContext ||= new C(); if(audioContext.state==='suspended') audioContext.resume().catch(()=>{}); } } catch {}
}, { passive:true });
window.AsocWhip={onMessage};
})();