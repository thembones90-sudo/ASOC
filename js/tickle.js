(() => {
'use strict';
let timer;
function onMessage(m) {
 if (!m || m.type !== 'tickle:impact') return;
 document.getElementById('asoc-tickle-layer')?.remove();
 const layer = document.createElement('div');
 layer.id = 'asoc-tickle-layer';
 layer.className = 'asoc-tickle-layer ' + (m.outcome === 'angry' ? 'angry' : m.outcome === 'broker' ? 'broker' : 'happy');
 layer.setAttribute('role', 'status');
 const label = document.createElement('div');
 label.className = 'asoc-tickle-caption';
 const title = document.createElement('strong');
 title.textContent = m.revenge ? 'TICKLE REVENGE!' : m.outcome === 'angry' ? 'TICKLE BACKFIRED!' : m.outcome === 'broker' ? 'SHADOW BROKER DISAPPROVES' : 'TICKLE ATTACK!';
 const subtitle = document.createElement('span');
 subtitle.textContent = (m.actorName || 'Someone') + ' ✨ ' + (m.targetName || 'someone');
 const feathers = document.createElement('div');
 feathers.className = 'asoc-tickle-feathers';
 for (let i = 0; i < (m.revenge ? 15 : 9); i++) {
   const span = document.createElement('span');
   span.textContent = ['🪶','✨','😂','🪶','😠'][m.outcome === 'angry' ? (i % 2 ? 4 : 0) : i % 4];
   span.style.setProperty('--i', String(i));
   feathers.appendChild(span);
 }
 label.append(title, subtitle);
 layer.append(feathers, label);
 document.body.appendChild(layer);
 clearTimeout(timer);
 timer = setTimeout(() => layer.remove(), 2400);
}
window.AsocTickle = Object.freeze({onMessage});
})();