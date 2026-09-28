'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const server=read('server.js');
const gm=read('index.html');
const player=read('join.html');
const gmClient=read('js/app.js');
const playerClient=read('js/player.js');
const shared=read('js/roulette-carnage-ui.js');

for(const action of ['openTable','openBetting','lockBets','spin','abort','closeTable']){
  assert.match(server,new RegExp(`gm:rouletteCarnage:${action}`),`server must route ${action}`);
}
assert.match(server,/spendShadowCoins[\s\S]*roulette-carnage:[^`]*:stake:/,'stakes must use the persistent Shadow Coin store');
assert.match(server,/awardShadowCoins[\s\S]*roulette-carnage:[^`]*:payout:/,'payouts must use idempotent persistent receipts');
assert.match(server,/armBloodTributeForPlayer\(room,chosen,round\.spinToken,'rouletteCarnage'\)/,'zero carnage must reuse Blood Tribute');
assert.match(server,/crypto\.randomInt\(0,37\)/,'winning number must be selected server-side');
assert.match(server,/rouletteCarnage\.view\(room\.rouletteCarnage/,'network projections must pass through role-aware privacy view');
assert.match(gm,/data-gm-minigame="rouletteCarnage"/);
assert.match(player,/id="minigames-roulette-carnage"/);
assert.match(gm,/css\/roulette-carnage\.css/);
assert.match(player,/css\/roulette-carnage\.css/);
assert.match(gmClient,/rouletteCarnage:state/);
assert.match(playerClient,/rouletteCarnage:state/);
assert.match(shared,/THE HOUSE HAS SPOKEN/);
assert.match(shared,/THE HOUSE REMEMBERS/);
console.log('PASS Roulette Carnage server authority, persistent economy, tribute pipeline and both arcade entry points');
