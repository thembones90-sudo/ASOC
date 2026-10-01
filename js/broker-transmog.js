(() => {
  'use strict';
  const DEFAULT = Object.freeze({ avatarData:'assets/ui/shadow-broker.png', frameColor:'#9b5de0', avatarEffect:'none', messageEffect:'none' });
  const effects = new Set(['none','pulse','eclipse','glitch','inferno','frost','crown']);
  const messages = new Set(['none','void','blood','royal','static']);
  let profile = { ...DEFAULT }, pendingAvatar = '';
  function clean(next) {
    const avatarData = String(next?.avatarData || DEFAULT.avatarData);
    return { avatarData:/^(data:image\/(?:png|jpeg|webp);base64,|\/|assets\/)/i.test(avatarData)?avatarData:DEFAULT.avatarData, frameColor:/^#[0-9a-f]{6}$/i.test(String(next?.frameColor||''))?String(next.frameColor):DEFAULT.frameColor, avatarEffect:effects.has(next?.avatarEffect)?next.avatarEffect:'none', messageEffect:messages.has(next?.messageEffect)?next.messageEffect:'none' };
  }
  function decorate(root=document) {
    document.documentElement.style.setProperty('--broker-frame', profile.frameColor);
    root.querySelectorAll?.('img.shadow-broker-avatar,img[src*="shadow-broker.png"],#broker-transmog-preview-image').forEach(img=>{ if(img.id!=='broker-transmog-preview-image'||!pendingAvatar)img.src=profile.avatarData; img.dataset.brokerEffect=profile.avatarEffect; img.style.setProperty('--broker-frame',profile.frameColor); img.closest('.chat-avatar-rail,.gm-chat-avatar-rail,.shadow-broker-identity,.broker-transmog-avatar-shell')?.setAttribute('data-broker-effect',profile.avatarEffect); });
    root.querySelectorAll?.('.gm-shadow-broker-entry,.chat-broker-entry,.broker-media-message').forEach(node=>{node.dataset.brokerMessageEffect=profile.messageEffect;node.style.setProperty('--broker-frame',profile.frameColor);});
  }
  function fill(){const image=document.getElementById('broker-transmog-preview-image'),color=document.getElementById('broker-transmog-color'),effect=document.getElementById('broker-transmog-effect'),message=document.getElementById('broker-transmog-message');if(image){image.src=pendingAvatar||profile.avatarData;image.dataset.brokerEffect=effect?.value||profile.avatarEffect;}if(color)color.value=profile.frameColor;if(effect)effect.value=profile.avatarEffect;if(message)message.value=profile.messageEffect;}
  function setProfile(next){profile=clean(next);pendingAvatar='';decorate();fill();}
  function close(){const el=document.getElementById('broker-transmog-overlay');if(el)el.hidden=true;}
  function save(){const next=clean({avatarData:pendingAvatar||profile.avatarData,frameColor:document.getElementById('broker-transmog-color')?.value,avatarEffect:document.getElementById('broker-transmog-effect')?.value,messageEffect:document.getElementById('broker-transmog-message')?.value});window.App?.send?.({type:'gm:brokerProfile',profile:next});setProfile(next);close();}
  function init(){
    document.getElementById('broker-transmog-btn')?.addEventListener('click',()=>{fill();document.getElementById('broker-transmog-overlay').hidden=false;});document.querySelector('[data-transmog-close]')?.addEventListener('click',close);document.querySelector('[data-transmog-save]')?.addEventListener('click',save);document.querySelector('[data-transmog-reset]')?.addEventListener('click',()=>{pendingAvatar=DEFAULT.avatarData;profile={...DEFAULT};fill();});
    document.getElementById('broker-transmog-file')?.addEventListener('change',event=>{const file=event.target.files?.[0];if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>1500000){window.AsocDialog?.alert?.('TRANSMOG REJECTED // PNG, JPEG OR WEBP // MAX 1.5 MB');return;}const reader=new FileReader();reader.onload=()=>{pendingAvatar=String(reader.result||'');fill();};reader.readAsDataURL(file);});
    document.getElementById('broker-transmog-overlay')?.addEventListener('click',event=>{if(event.target.id==='broker-transmog-overlay')close();});new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)decorate(node);}))).observe(document.body,{childList:true,subtree:true});decorate();
  }
  window.BrokerTransmog={setProfile,decorate,getProfile:()=>({...profile})};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();
