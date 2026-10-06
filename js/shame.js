(function () {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const state = { roster: [], shame: {}, modal: null, busy: false };

  function css() {
    if (document.getElementById('asoc-shame-css')) return;
    const style = document.createElement('style');
    style.id = 'asoc-shame-css';
    style.textContent = `
      .shame-control-btn{border-color:#8e1f2d!important;background:linear-gradient(180deg,#3b1118,#18090c)!important;color:#ffd7d7!important}
      .shame-control-btn:hover{box-shadow:0 0 22px rgba(190,35,55,.42)!important}
      .shame-modal{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;background:rgba(4,3,5,.86);backdrop-filter:blur(8px)}
      .shame-modal[hidden]{display:none}.shame-card{width:min(620px,92vw);max-height:86vh;overflow:auto;background:linear-gradient(160deg,#190c10,#090709 68%);border:1px solid #7f2632;box-shadow:0 30px 100px #000;padding:24px;color:#eee;font-family:inherit}
      .shame-card small{letter-spacing:.18em;color:#a56b73}.shame-card h2{margin:5px 0 18px;font-size:26px;letter-spacing:.08em;color:#f0d9dc}.shame-targets{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 16px}
      .shame-target{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #352127;background:#100b0d;cursor:pointer}.shame-target input{accent-color:#b72e42}.shame-target.is-shamed{border-color:#772636}
      .shame-reason{width:100%;min-height:92px;box-sizing:border-box;resize:vertical;background:#080708;color:#f4e9ea;border:1px solid #4d2930;padding:12px;font:inherit}.shame-reason:focus{outline:1px solid #a73546}
      .shame-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}.shame-actions button{padding:11px 16px;border:1px solid #543038;background:#130d0f;color:#ddd;font-weight:800;letter-spacing:.06em;cursor:pointer}.shame-actions .deliver{background:#761c2b;border-color:#c24a5b;color:#fff}.shame-actions .deliver:disabled{opacity:.35;cursor:not-allowed}
      .shame-select-all{margin-bottom:6px;background:none;border:0;color:#d5828e;font-weight:800;cursor:pointer}
      .shame-stage{position:fixed;inset:0;z-index:2147483000;background:radial-gradient(circle at 50% 42%,rgba(115,18,29,.18),rgba(0,0,0,.96) 56%);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;overflow:hidden;pointer-events:auto;font-family:inherit}
      .shame-stage .attention{font-size:clamp(18px,2vw,32px);letter-spacing:.22em;color:#d8c4c7;animation:shameFade .7s both}.shame-stage .accused{margin-top:18px;font-size:clamp(26px,4vw,58px);font-weight:900;letter-spacing:.08em;text-align:center}
      .shame-stage .charge{max-width:min(900px,86vw);margin:14px auto 20px;text-align:center;font-size:clamp(17px,2vw,28px);color:#e6dadd}.shame-avatars{display:flex;flex-wrap:wrap;justify-content:center;gap:20px;max-width:90vw}
      .shame-avatar{position:relative;width:112px;text-align:center;animation:shameDrag .7s cubic-bezier(.2,.9,.2,1) both}.shame-avatar img,.shame-avatar .fallback{width:92px;height:92px;border-radius:50%;object-fit:cover;border:3px solid #702331;box-shadow:0 0 30px rgba(160,35,52,.35)}
      .shame-avatar .fallback{display:grid;place-items:center;background:#191116;font-size:34px;font-weight:900}.shame-avatar b{display:block;margin-top:8px}.shame-hat{position:absolute;top:-38px;left:34px;font-size:52px;transform:rotate(-8deg);filter:drop-shadow(0 5px 3px #000);animation:hatDrop .55s .8s both}
      .shame-word{position:absolute;font-weight:1000;font-size:clamp(72px,15vw,220px);letter-spacing:.04em;color:#a82034;text-shadow:0 8px 0 #360811,0 0 40px rgba(210,30,60,.3);opacity:0}.shame-word.one{animation:shameSlam .45s 2.4s both;left:3%;top:17%;transform:rotate(-8deg)}.shame-word.two{animation:shameSlam .45s 3.25s both;right:3%;bottom:17%;transform:rotate(7deg)}.shame-word.three{animation:shameSlam .5s 4.1s both;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-3deg)}
      .shame-guilty{margin:15px 0 4px;font-size:clamp(24px,3vw,46px);font-weight:1000;color:#c52c42;letter-spacing:.14em;animation:shameFade .5s 1.7s both}.shame-final{position:absolute;inset:auto 0 9%;text-align:center;font-size:clamp(22px,3vw,42px);font-weight:1000;letter-spacing:.1em;opacity:0;animation:shameFade .6s 4.7s forwards}
      .shame-final span{display:block;font-size:.48em;color:#d7aab1;margin-top:8px}.shame-mark{position:absolute;left:50%;top:48%;transform:translate(-50%,-50%) rotate(-11deg) scale(2.5);border:7px solid #b42238;color:#c52a41;padding:.08em .24em;font-size:clamp(50px,10vw,140px);font-weight:1000;letter-spacing:.08em;opacity:0;animation:stamp .42s 4.55s forwards}
      .asoc-shamed-name::after{content:'SHAMED';display:inline-block;margin-left:6px;padding:1px 5px;border:1px solid #a72a3c;color:#d94a60;font-size:.7em;font-weight:900;letter-spacing:.08em;transform:rotate(-3deg)}
      .asoc-shamed-avatar{position:relative}.asoc-shamed-avatar::after{content:'SHAMED';position:absolute;left:50%;top:52%;transform:translate(-50%,-50%) rotate(-14deg);z-index:5;border:2px solid #b2293e;color:#d83c54;background:rgba(20,0,4,.56);padding:1px 4px;font-size:10px;font-weight:1000;letter-spacing:.05em;pointer-events:none}
      @keyframes shameFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes shameDrag{from{opacity:0;transform:translateY(90px) scale(.5)}to{opacity:1;transform:none}}@keyframes hatDrop{from{opacity:0;transform:translateY(-120px) rotate(25deg)}70%{opacity:1;transform:translateY(8px) rotate(-12deg)}to{opacity:1;transform:rotate(-8deg)}}@keyframes shameSlam{0%{opacity:0;filter:blur(8px);scale:2.2}70%{opacity:1;filter:none;scale:.92}100%{opacity:.78;scale:1}}@keyframes stamp{0%{opacity:0;transform:translate(-50%,-50%) rotate(-11deg) scale(2.5)}70%{opacity:1;transform:translate(-50%,-50%) rotate(-11deg) scale(.92)}100%{opacity:1;transform:translate(-50%,-50%) rotate(-11deg) scale(1)}}
      @media(max-width:600px){.shame-targets{grid-template-columns:1fr}.shame-avatar{width:78px}.shame-avatar img,.shame-avatar .fallback{width:66px;height:66px}.shame-hat{left:22px;font-size:38px;top:-29px}}
      @media(prefers-reduced-motion:reduce){.shame-stage *{animation-duration:.01ms!important;animation-delay:0ms!important}}
    `;
    document.head.appendChild(style);
  }

  function button() {
    const grid = document.querySelector('.battle-controls-grid');
    if (!grid || document.getElementById('shame-gm-button')) return;
    const btn = document.createElement('button');
    btn.id = 'shame-gm-button'; btn.type = 'button'; btn.className = 'gm-global-btn shame-control-btn';
    btn.innerHTML = '<span>SHAME</span><small>PUBLIC TRIBUNAL</small>';
    btn.addEventListener('click', open);
    grid.appendChild(btn);
  }

  function open() {
    if (!state.modal) buildModal();
    renderModal();
    state.modal.hidden = false;
  }

  function buildModal() {
    const root = document.createElement('div'); root.className = 'shame-modal'; root.hidden = true;
    root.innerHTML = '<section class="shame-card" role="dialog" aria-modal="true"><small>SHADOW BROKER AUTHORITY</small><h2 data-shame-title>PUBLIC SHAMING</h2><button class="shame-select-all" type="button">SELECT ALL</button><div class="shame-targets"></div><label><small>REASON FOR SHAME // REQUIRED</small><textarea class="shame-reason" maxlength="280" placeholder="State the charge..."></textarea></label><div class="shame-actions"><button type="button" data-shame-cancel>CANCEL</button><button type="button" data-shame-pardon>PARDON SELECTED</button><button type="button" class="deliver" data-shame-deliver disabled>DELIVER VERDICT</button></div></section>';
    document.body.appendChild(root); state.modal = root;
    root.querySelector('[data-shame-cancel]').onclick = () => root.hidden = true;
    root.querySelector('.shame-select-all').onclick = () => { root.querySelectorAll('.shame-target input').forEach(i => i.checked = true); updateModal(); };
    root.querySelector('.shame-reason').addEventListener('input', updateModal);
    root.addEventListener('change', updateModal);
    root.querySelector('[data-shame-deliver]').onclick = deliver;
    root.querySelector('[data-shame-pardon]').onclick = pardon;
  }

  function selected() { return [...state.modal.querySelectorAll('.shame-target input:checked')].map(i => i.value); }
  function updateModal() {
    const ids = selected(), reason = state.modal.querySelector('.shame-reason').value.trim();
    state.modal.querySelector('[data-shame-title]').textContent = ids.length > 1 ? 'MASS SHAMING' : 'PUBLIC SHAMING';
    state.modal.querySelector('[data-shame-deliver]').disabled = !ids.length || !reason || state.busy;
    state.modal.querySelector('[data-shame-pardon]').disabled = !ids.some(id => state.shame[id]) || state.busy;
  }
  function renderModal() {
    const box = state.modal.querySelector('.shame-targets');
    const people = state.roster.filter(p => p && p.id && p.connected !== false && String(p.id) !== 'DENNIS_AI');
    box.innerHTML = people.map(p => '<label class="shame-target '+(state.shame[String(p.id)]?'is-shamed':'')+'"><input type="checkbox" value="'+esc(p.id)+'"><span>'+esc(p.name)+(state.shame[String(p.id)]?' · SHAMED':'')+'</span></label>').join('') || '<small>NO LITTLE HEROES ONLINE</small>';
    state.modal.querySelector('.shame-reason').value = '';
    updateModal();
  }
  function send(payload) {
    const app = window.App;
    if (!app?.ws || app.ws.readyState !== 1) return false;
    app.send(payload); return true;
  }
  function deliver() {
    const targetIds = selected(), reason = state.modal.querySelector('.shame-reason').value.trim();
    if (!targetIds.length || !reason) return;
    state.busy = true; updateModal();
    if (!send({type:'gm:shame', targetIds, reason})) state.busy = false;
    state.modal.hidden = true;
  }
  function pardon() {
    const targetIds = selected().filter(id => state.shame[id]);
    if (!targetIds.length) return;
    state.busy = true; updateModal();
    if (!send({type:'gm:unshame', targetIds})) state.busy = false;
    state.modal.hidden = true;
  }

  function avatar(target) {
    const src = target.avatarData || '';
    const image = src ? '<img src="'+esc(src)+'" alt="">' : '<div class="fallback">'+esc((target.name||'?')[0])+'</div>';
    return '<div class="shame-avatar">'+image+'<i class="shame-hat">🔻</i><b>'+esc(target.name)+'</b></div>';
  }
  function play(message) {
    const targets = Array.isArray(message.targets) ? message.targets : [];
    if (!targets.length) return;
    document.querySelector('.shame-stage')?.remove();
    const stage = document.createElement('div'); stage.className = 'shame-stage';
    const names = targets.map(t=>t.name).join(' • ');
    stage.innerHTML = '<div class="attention">THE SHADOW BROKER DEMANDS ATTENTION</div><div class="accused">'+esc(targets.length > 1 ? 'THE FOLLOWING LITTLE HEROES STAND ACCUSED' : names+' STANDS ACCUSED')+'</div><div class="charge">CHARGE: '+esc(message.reason||'Unspecified disappointment.')+'</div><div class="shame-guilty">GUILTY.</div><div class="shame-avatars">'+targets.map(avatar).join('')+'</div><div class="shame-word one">SHAME</div><div class="shame-word two">SHAME</div><div class="shame-word three">SHAME</div><div class="shame-mark">SHAMED</div><div class="shame-final">'+esc(names)+' '+(targets.length>1?'HAVE':'HAS')+' BEEN PUBLICLY SHAMED<span>THE GAME WILL REMEMBER.</span></div>';
    document.body.appendChild(stage);
    [2450,3300,4150].forEach((ms,i)=>setTimeout(()=>{ try{ window.AsocAudio?.playUi?.('impact'); }catch{} if(i===2) document.body.animate([{transform:'translate(0)'},{transform:'translate(-5px,2px)'},{transform:'translate(4px,-1px)'},{transform:'translate(0)'}],{duration:260}); },ms));
    setTimeout(()=>stage.remove(), 6800);
  }

  function applyMarks() {
    document.querySelectorAll('.asoc-shamed-name').forEach(el=>el.classList.remove('asoc-shamed-name'));
    document.querySelectorAll('.asoc-shamed-avatar').forEach(el=>el.classList.remove('asoc-shamed-avatar'));
    Object.keys(state.shame).forEach(id => {
      document.querySelectorAll('[data-player-id="'+CSS.escape(String(id))+'"]').forEach(root => {
        const name = root.querySelector('.player-name,.leaderboard-name,.gm-player-name,.name,[data-player-name]') || root;
        name.classList.add('asoc-shamed-name');
        const av = root.querySelector('.avatar,.player-avatar,.leaderboard-avatar,.avatar-frame,[data-avatar]');
        if (av) av.classList.add('asoc-shamed-avatar');
      });
    });
  }
  function onPlayers(players) { state.roster = Array.isArray(players) ? players : []; applyMarks(); }
  function onState(publicState) { state.shame = publicState?.shame || {}; state.busy = false; applyMarks(); }
  function onMessage(message) {
    if (message.type === 'shame:verdict') play(message);
    if (message.type === 'shame:pardon') { state.busy = false; }
  }

  function init(){ css(); button(); }
  window.Shame = { init, open, onPlayers, onState, onMessage, play };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();