(() => {
'use strict';
let timeoutId = null;
let audio = null;
const BROKER = 'shadow-broker';
function node(tag, cls, content) {
 const el = document.createElement(tag); el.className = cls || '';
 if (content !== undefined) el.textContent = content;
 return el;
}
function clear() {
 if (timeoutId) clearTimeout(timeoutId);
 timeoutId = null;
 document.getElementById('asoc-dropkick-layer')?.remove();
}
function soundOn() {
 try { return localStorage.getItem('asoc_dropkick_sound') === 'on'; } catch { return false; }
}
function thud() {
 if (!soundOn()) return;
 try {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  audio ||= new Context();
  if (audio.state !== 'running') return;
  const t = audio.currentTime;
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(130, t);
  osc.frequency.exponentialRampToValueAtTime(43, t + .22);
  gain.gain.setValueAtTime(.0001, t);
  gain.gain.exponentialRampToValueAtTime(.1, t + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, t + .25);
  osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + .26);
 } catch {}
}
function onMessage(message, playerId, isGm = false) {
 if (message?.type !== 'dropkick:impact') return;
 clear();
 const me = isGm ? BROKER : String(playerId || sessionStorage.getItem('asoc_player_id') || '');
 const actualVictim = message.outcome === 'reflect' ? message.actorId : message.targetId;
 const role = me && String(me) === String(actualVictim) ? 'victim' : me && String(me) === String(message.actorId) ? 'attacker' : 'observer';
 const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
 const broker = String(message.actorId) === BROKER;
 const outcome = ['hit', 'miss', 'reflect'].includes(message.outcome) ? message.outcome : 'hit';
 const layer = node('div', ['asoc-dropkick-layer', 'role-' + role, 'result-' + outcome, broker ? 'broker-attack' : '', reduced ? 'reduced-motion' : ''].filter(Boolean).join(' '));
 layer.id = 'asoc-dropkick-layer';
 layer.setAttribute('aria-live', 'polite');
 const stage = node('div', 'asoc-dropkick-stage');
 const labels = {hit:'DIRECT HIT',miss:'SPECTACULAR MISS',reflect:'LEGENDARY REVERSAL'};
 function avatarGraphic(avatar, label, className) {
   const item = node('div', className);
   const src = String(avatar || '').trim();
   if (/^(data:image\/(png|jpeg|webp|gif);base64,|\/|assets\/|https?:\/\/)/i.test(src)) {
     const img = document.createElement('img');
     img.alt = '';
     img.src = src;
     img.addEventListener('error', () => {
       img.remove();
       item.appendChild(node('span', 'asoc-dropkick-initials', String(label || '?').trim().slice(0, 2).toUpperCase()));
     }, {once:true});
     item.appendChild(img);
   } else {
     item.appendChild(node('span', 'asoc-dropkick-initials', String(label || '?').trim().slice(0, 2).toUpperCase()));
   }
   return item;
 }
 const text = node('div', 'asoc-dropkick-banner');
 text.append(node('strong', '', labels[outcome]), node('span', '', String(message.actorName || 'Someone').slice(0, 70) + '  ➜  ' + String(message.targetName || 'someone').slice(0, 70)));
 if (role === 'victim' && !reduced) {
  const keeper = node('div', 'asoc-dropkick-keeper');
  keeper.appendChild(avatarGraphic(message.actorAvatarData, message.actorName, 'asoc-dropkick-keeper-head'));
  keeper.append(node('div','asoc-dropkick-keeper-torso'), node('div','asoc-dropkick-keeper-arm'), node('div','asoc-dropkick-keeper-stance'),node('div','asoc-dropkick-keeper-leg'));
  if (broker) keeper.appendChild(node('div','asoc-dropkick-mech-boot','🥾'));
  const ball = avatarGraphic(message.targetAvatarData, message.targetName, 'asoc-dropkick-ball');
  ball.appendChild(node('div','asoc-dropkick-ball-seams'));
  const impact = node('div', 'asoc-dropkick-impact', outcome === 'miss' ? 'WHOOSH!' : outcome === 'reflect' ? 'COUNTER!' : 'GOOOAL!');
  stage.append(keeper, ball, impact);
  const particles = node('div','asoc-dropkick-particles');
  for (let i = 0; i < 11; i++) {
    const p = node('span','asoc-dropkick-particle', i % 3 ? '✦' : '💥');
    p.style.setProperty('--index', i);
    p.style.left = (8 + i * 8) + '%';
    particles.appendChild(p);
  }
  stage.appendChild(particles);
 }
 stage.appendChild(text);
 if (role !== 'observer') {
  const toggle = node('button','asoc-dropkick-audio',soundOn() ? '♪ Sound on' : '♪ Sound off');
  toggle.type = 'button';
  toggle.addEventListener('click', () => {
    const next = !soundOn();
    try { localStorage.setItem('asoc_dropkick_sound',next?'on':'off'); } catch {}
    toggle.textContent = next?'♪ Sound on':'♪ Sound off';
    if (next) {
     try { const C = window.AudioContext || window.webkitAudioContext; if (C) { audio ||= new C(); audio.resume().then(thud).catch(()=>{}); } } catch {}
    }
  });
  stage.appendChild(toggle);
 }
 layer.appendChild(stage);
 document.body.appendChild(layer);
 if (role === 'victim' && outcome !== 'miss') thud();
 timeoutId = setTimeout(clear, reduced ? 1700 : role === 'victim' ? 3300 : 1700);
}
window.AsocDropkick = Object.freeze({onMessage, clear});
})();