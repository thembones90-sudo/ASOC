'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const nodes = [];
const classes = () => ({ add(){}, remove(){}, contains(){ return false; } });
const document = {
  documentElement:{ classList:classes() }, body:{ classList:classes(), appendChild(node){ nodes.push(node); node.isConnected=true; } },
  querySelectorAll(){ return []; }, querySelector(){ return null; }, createElement(){ return { className:'', dataset:{}, classList:classes(), setAttribute(){}, remove(){ this.isConnected=false; }, querySelector(){ return { textContent:'' }; }, innerHTML:'' }; }
};
const window = {};
vm.runInNewContext(read('js/battle-animations.js'), { window, document, setTimeout, clearTimeout, matchMedia:()=>({matches:true}), console, Math });
const registry = window.BattleAnimations;
assert.deepEqual(Array.from(registry.list(), item => item.id), ['default','glitch-world']);
registry.register({ id:'future-theme', name:'FUTURE THEME', play(){}, cleanup(){} });
assert.equal(registry.select('future-theme'), 'future-theme', 'future presets register without Battle core changes');
assert.equal(registry.select('missing'), 'default', 'unknown preset safely falls back to DEFAULT');

const server = read('server.js'), gm = read('js/backdoor.js'), app = read('js/app.js'), player = read('js/player.js');
assert.match(server, /battleAnimationId: room\.battleAnimationId/);
assert.match(server, /battleAnimationId: saved\.battleAnimationId/);
assert.match(server, /gm:setBattleAnimation/);
assert.match(gm, /BATTLE MODE ANIMATION/);
assert.match(app, /BattleAnimations\?\.handleTransition/);
assert.match(player, /BattleAnimations\?\.handleTransition/);
assert.match(read('css/battle-animations.css'), /prefers-reduced-motion/);
console.log('PASS Battle animation registry, safe fallback, persistent server selection, shared clients and reduced-motion support');
