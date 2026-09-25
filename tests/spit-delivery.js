'use strict';

// /spit stuck on SENDING: the server rejects a spit at an offline player
// ("SPIT TARGET MUST BE A CONNECTED PLAYER"), but the picker offered offline
// roster identities and the client only ever left SENDING on a successful
// chat:update. Pin both halves of the fix.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const player = fs.readFileSync(path.join(__dirname, '..', 'js', 'player.js'), 'utf8');

const errorCase = player.slice(player.indexOf("case 'error':"), player.indexOf("case 'error':") + 900);
assert.match(errorCase, /dataset\?\.state === 'sending'/, 'a server error must end an optimistic SENDING state');
assert.match(errorCase, /setChatDeliveryState\('NOT SENT', 'error'/, 'a rejected transmission reads NOT SENT');

const candidates = player.slice(player.indexOf('getChatMentionCandidates('), player.indexOf('refreshChatMentionRoster('));
assert.match(candidates, /!context\?\.spit \|\| player\.connected !== false/, 'the /spit picker only offers connected players');

console.log('PASS /spit delivery: rejected sends end SENDING, picker offers only connected targets');
