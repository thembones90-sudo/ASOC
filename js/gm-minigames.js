(() => {
  'use strict';
  const GM_ID = '__GM__';
  const Arcade = {
    challenge:null, game:null, lastOpponentId:null, concoction:{ cooldownUntil:0, spinning:false },
    init() {
      if (this.initialized) return;
      const toggle = document.getElementById('gm-minigames-toggle');
      const menu = document.getElementById('gm-minigames-menu');
      if (!toggle || !menu) return;
      this.initialized=true;
      toggle.addEventListener('click', e => {
        e.stopPropagation();
        if (App.roomMode !== 'CASUAL' && !document.body.classList.contains('room-mode-casual')) return;
        this.toggleLibrary();
      });
      document.getElementById('gm-chat-tab')?.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleLibrary(false);
        this.close();
      });
      document.addEventListener('click', e => this.click(e));
      this.renderConcoctionStatus();
    },
    toggleLibrary(force) {
      const menu=document.getElementById('gm-minigames-menu');
      const toggle=document.getElementById('gm-minigames-toggle');
      const panel=document.querySelector('.gm-module-chat .gm-chat-panel');
      if(!menu||!toggle||!panel)return;
      const open=typeof force==='boolean'?force:menu.hidden;
      menu.hidden=!open;
      panel.classList.toggle('minigames-library-open',open);
      toggle.classList.toggle('is-active',open);
      toggle.setAttribute('aria-expanded',String(open));
      toggle.setAttribute('aria-selected',String(open));
      const chatTab=document.getElementById('gm-chat-tab');
      chatTab?.classList.toggle('is-active',!open);
      chatTab?.setAttribute('aria-selected',String(!open));
    },
    click(e) {
      const launch = e.target.closest('[data-gm-minigame]');
      if (launch) {
        this.toggleLibrary(false);
        if (launch.dataset.gmMinigame === 'threefold') this.openChooser();
        else this.spinConcoction();
        return;
      }
      if (e.target.closest('[data-gm-minigame-close]')) return this.close();
      const opponent = e.target.closest('[data-gm-opponent]');
      if (opponent) { App.send({type:'threefold:challenge',opponentId:opponent.dataset.gmOpponent}); this.lastOpponentId=opponent.dataset.gmOpponent; this.status('CHALLENGE SENT','Waiting for the Little Hero.'); return; }
      const action = e.target.closest('[data-gm-threefold]')?.dataset.gmThreefold;
      if (action === 'accept' && this.challenge) App.send({type:'threefold:accept',challengeId:this.challenge.id});
      if (action === 'decline' && this.challenge) App.send({type:'threefold:decline',challengeId:this.challenge.id});
      if (action === 'rematch' && this.lastOpponentId) App.send({type:'threefold:challenge',opponentId:this.lastOpponentId});
      const cell = e.target.closest('[data-gm-cell]');
      if (cell && this.game && !this.game.complete) App.send({type:'threefold:move',gameId:this.game.id,cell:Number(cell.dataset.gmCell)});
    },
    openChooser() {
      if (App.roomMode !== 'CASUAL') return;
      const players=(App.currentPlayers||[]).filter(p=>p.connected!==false);
      this.title('IKS OKS');
      this.content(players.length ? `<div class="gm-arcade-kicker">SELECT OPPONENT</div><div class="gm-arcade-opponents">${players.map(p=>`<button data-gm-opponent="${this.esc(p.id)}"><span>${p.avatarData?`<img src="${this.esc(p.avatarData)}" alt="">`:'◆'}</span><b>${this.esc(p.name)}</b><i>CHALLENGE</i></button>`).join('')}</div>`:'<div class="gm-arcade-status">NO LITTLE HEROES ONLINE</div>');
      this.show();
    },
    onChallenge(m) { this.challenge=m.challenge; if (!this.challenge) return; if (this.challenge.challengerId===GM_ID) return this.status('CHALLENGE SENT',`Waiting for ${this.esc(this.challenge.opponentName)}.`); this.lastOpponentId=this.challenge.challengerId; this.content(`<div class="gm-arcade-kicker">DUEL REQUEST</div><h3>${this.esc(this.challenge.challengerName)}</h3><div class="gm-arcade-actions"><button data-gm-threefold="accept">ACCEPT</button><button data-gm-threefold="decline">DECLINE</button></div>`); this.show(); },
    onDeclined(m) { this.challenge=null; this.status('CHALLENGE DECLINED',this.esc(m.byName||'Little Hero')); },
    onState(m) { this.challenge=null; this.game=m.game; if (!this.game) return; const meX=this.game.xId===GM_ID; this.lastOpponentId=meX?this.game.oId:this.game.xId; const myTurn=this.game.turnId===GM_ID&&!this.game.complete; const status=this.game.complete?(this.game.winnerId?(this.game.winnerId===GM_ID?'YOU WIN':`${this.esc(this.game.winnerName)} WINS`):'STALEMATE'):(myTurn?'YOUR MOVE':`${this.esc(this.game.turnName)} IS THINKING`); const winLine=Array.isArray(this.game.winningLine)&&this.game.winningLine.length===3?`<i class="threefold-win-line" data-line="${this.game.winningLine.join('-')}" aria-hidden="true"></i>`:''; this.content(`<div class="gm-arcade-versus"><span><b>X</b>${this.esc(this.game.xName)}</span><i>VS</i><span><b>O</b>${this.esc(this.game.oName)}</span></div><div class="gm-arcade-turn">${status}</div><div class="gm-arcade-board">${this.game.board.map((mark,i)=>`<button data-gm-cell="${i}" ${mark||this.game.complete||!myTurn?'disabled':''}>${mark||''}</button>`).join('')}${winLine}</div>${this.game.complete?'<button class="gm-arcade-rematch" data-gm-threefold="rematch">REMATCH</button>':''}`); this.show(); },
    onClosed(m) { this.game=null;this.challenge=null;if(m?.reason)this.status('DUEL CLOSED',this.esc(m.reason));else this.close(); },
    spinConcoction() { if(App.roomMode!=='CASUAL'||this.concoction.spinning||this.concoction.cooldownUntil>Date.now())return;if(!confirm('TRIGGER UNSTABLE CONCOCTION?\n\nThis burns the room-wide dose for 24 hours.'))return;App.send({type:'unstableConcoction:spin'}); },
    updateConcoction(state){this.concoction=state&&typeof state==='object'?{cooldownUntil:0,...state}:{cooldownUntil:0,spinning:false};this.renderConcoctionStatus();},
    onConcoctionStarted(m){this.concoction={...this.concoction,spinning:true,cooldownUntil:Number(m.cooldownUntil)||0};if(m.playerId===GM_ID){this.title('UNSTABLE CONCOCTION');this.content('<img class="gm-concoction-drop" src="assets/ui/unstable-concoction-toxic-drop.png" alt=""><div class="gm-arcade-turn">REACTION IN PROGRESS</div>');this.show();}this.renderConcoctionStatus();},
    onConcoctionResolved(m){this.concoction={...this.concoction,spinning:false,cooldownUntil:Number(m.cooldownUntil)||0};if(m.playerId===GM_ID){this.content(`<img class="gm-concoction-drop" src="assets/ui/unstable-concoction-toxic-drop.png" alt=""><div class="gm-arcade-result">${this.esc(m.outcome)}</div>`);setTimeout(()=>this.close(),2200);}this.renderConcoctionStatus();},
    renderConcoctionStatus(){const el=document.getElementById('gm-concoction-status');if(!el)return;const n=Math.max(0,Number(this.concoction.cooldownUntil)-Date.now());el.textContent=this.concoction.spinning?'REACTING':n?`${Math.ceil(n/3600000)}H`:'READY';},
    status(a,b){this.title('IKS OKS');this.content(`<div class="gm-arcade-status"><b>${a}</b><span>${b}</span></div>`);this.show();}, title(t){document.getElementById('gm-minigames-title').textContent=t;},content(h){document.getElementById('gm-minigames-content').innerHTML=h;},show(){this.toggleLibrary(false);document.getElementById('gm-minigames-panel').hidden=false;},close(){document.getElementById('gm-minigames-panel').hidden=true;},esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  };
  window.GMMinigames=Arcade;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>Arcade.init(),{once:true});
  else Arcade.init();
})();
