/* BOARD SOLVE CORONATIONS // transient, server-authoritative verdict theatre. */
(() => {
  const seen=new Set();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function show(message,board){
    if(!board||!message?.id||seen.has(message.id))return;
    seen.add(message.id);if(seen.size>100)seen.delete(seen.values().next().value);
    const final=message.kind==='final'||message.target==='FINAL';
    board.querySelectorAll('.board-solve-coronation').forEach(node=>node.remove());
    const stage=document.createElement('div');
    stage.className=`board-solve-coronation ${final?'final-coronation':'column-coronation'}`;
    stage.setAttribute('role','status');
    stage.setAttribute('aria-live','assertive');
    const sparks=Array.from({length:final?30:18},(_,i)=>`<i style="--i:${i};--x:${((i*47)%101)-50};--y:${((i*71)%91)-45};--d:${(i%7)*.045}s"></i>`).join('');
    stage.innerHTML=`<div class="solve-light-burst">${sparks}<div class="solve-orbit one"></div><div class="solve-orbit two"></div></div><div class="solve-crown" aria-hidden="true">${final?'♛':'♕'}</div><div class="solve-nameplate"><small>${final?'THE FINAL THRONE CLAIMED':'COLUMN '+esc(message.target)+' CONQUERED'}</small><b>${esc(message.playerName||'LITTLE HERO')}</b><span>${final?'MASTER SOLUTION CORRECT':'ANSWER CORRECT'}</span></div>`;
    board.appendChild(stage);
    window.setTimeout(()=>stage.remove(),final?4600:3300);
  }
  window.BoardCelebrations={show};
})();
