const assert=require('assert'),fs=require('fs');
const index=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('js/app.js','utf8'),server=fs.readFileSync('server.js','utf8'),ui=fs.readFileSync('js/gm-minigames.js','utf8'),css=fs.readFileSync('css/asoc.css','utf8');
assert.match(index,/id="gm-minigames-toggle"/);assert.match(index,/data-gm-minigame="threefold"/);assert.match(index,/data-gm-minigame="concoction"/);
assert.match(server,/playerId\) === '__GM__'/);assert.match(server,/function threefoldActor/);assert.match(server,/name:'SHADOW BROKER'/);assert.match(server,/spin\.playerId !== '__GM__'/);
assert.match(app,/GMMinigames\?\.onState/);assert.match(app,/GMMinigames\?\.onConcoctionResolved/);assert.match(ui,/type:'threefold:move'/);assert.match(ui,/type:'unstableConcoction:spin'/);assert.match(css,/body\.room-mode-casual \.gm-minigames-toggle/);
assert.match(ui,/toggleLibrary\(force\)/);assert.match(ui,/minigames-library-open/);assert.match(css,/\.gm-minigames-menu\{position:absolute;z-index:146;inset:49px 10px 76px;display:grid/);assert.match(index,/gm-minigames\.js\?v=20260925-gm-arcade-tab-1/);
console.log('PASS GM mini-games arcade, authoritative Shadow Broker participant, and career-stat isolation');
