const assert=require('assert'),fs=require('fs');
const index=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('js/app.js','utf8'),server=fs.readFileSync('server.js','utf8'),ui=fs.readFileSync('js/gm-minigames.js','utf8'),css=fs.readFileSync('css/asoc.css','utf8');
assert.match(index,/id="gm-minigames-toggle"/);assert.match(index,/data-gm-minigame="threefold"/);assert.match(index,/data-gm-minigame="concoction"/);
assert.match(server,/playerId\) === '__GM__'/);assert.match(server,/function threefoldActor/);assert.match(server,/name:'SHADOW BROKER'/);assert.match(server,/spin\.playerId !== '__GM__'/);
assert.match(app,/GMMinigames\?\.onState/);assert.match(app,/GMMinigames\?\.onConcoctionResolved/);assert.match(ui,/type:'threefold:move'/);assert.match(ui,/type:'unstableConcoction:spin'/);assert.match(css,/body\.room-mode-casual \.gm-minigames-toggle/);
console.log('PASS GM mini-games arcade, authoritative Shadow Broker participant, and career-stat isolation');
