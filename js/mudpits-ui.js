'use strict';
(function(){
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const remaining=(deadline,now)=>Math.max(0,Math.ceil((Number(deadline||0)-Number(now||Date.now()))/1000));
  const send = payload => { const app=window.App||window.PlayerApp; if(typeof app?.send!=='function')return false; app.send(payload); return true; };
  function render(state,root,{gm=false}= {}){
    if(!root)return;
    root.style.pointerEvents = state?.active ? 'auto' : 'none';
    if(!state?.active){root.innerHTML='<div class="mudpits-shell"><b>THE PIT IS COLD.</b></div>';return;}
    const c=state.contestants||[], e=state.entries||[];
    const cards=c.map((x,i)=>`<article class="mudpits-card ${i?'mudpits-card--right':''}"><div class="mudpits-kicker">CONTESTANT ${i+1}</div><h3>${esc(x.name)}</h3><div class="mudpits-status">${x.submitted?'SEALED':'WRITING IN THE DARK'}</div>${state.revealed?`<p class="mudpits-entry">${esc(e?.[i]?.text||'VOID')}</p>`:''}${state.viewer?.canVote&&state.revealed&&e?.[i]?.text?`<button class="mudpits-vote" data-mudpits-vote="${esc(x.id)}">JUDGE THIS SENTENCE</button>`:''}</article>`).join('');
    root.innerHTML=`<section class="mudpits-shell" data-mudpits-id="${esc(state.id)}"><div class="mudpits-head"><div><div class="mudpits-kicker">SHADOW BROKER // GM EXCLUSIVE</div><h2>THE MUD PITS</h2></div><div class="mudpits-timer" data-mudpits-clock>${remaining(state.phase==='WRITING'?state.writeDeadline:state.phase==='REVEAL'?state.readDeadline:state.voteDeadline,state.serverNow)}s</div></div><div class="mudpits-duel">${cards||'<span>AWAITING CONTESTANTS</span>'}</div>${state.viewer?.canSubmit?`<form data-mudpits-form><textarea class="mudpits-write" maxlength="250" required placeholder="One sentence. Maximum 250 characters."></textarea><button class="mudpits-submit">SEAL MY SENTENCE</button></form>`:''}<div class="mudpits-judgment">${state.phase==='RESULT'?(state.winnerId?`VERDICT: ${esc(state.names[state.winnerId])} TAKES +1 SC`:'THE PIT DECLARES VOID'):'THE HOUSE IS WATCHING.'}</div></section>`;
    const textarea=root.querySelector('textarea');
    if(textarea) { textarea.value=root.dataset.mudpitsDraft ?? state.viewer?.myDraft ?? ''; textarea.addEventListener('input',()=>{root.dataset.mudpitsDraft=textarea.value;}); }
    root.querySelector('[data-mudpits-form]')?.addEventListener('submit',ev=>{ev.preventDefault(); if(!send({type:'mudpits:submit',duelId:state.id,text:textarea.value}))return; root.dataset.mudpitsDraft=textarea.value; textarea.disabled=true; ev.currentTarget.querySelector('button').disabled=true;});
    root.querySelectorAll('[data-mudpits-vote]').forEach(b=>b.addEventListener('click',()=>{if(send({type:'mudpits:vote',duelId:state.id,contestantId:b.dataset.mudpitsVote}))b.disabled=true;}));
  }
  window.MudPitsUI={render,remaining};
})();
