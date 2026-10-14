'use strict';
const assert = require('assert');
const fs = require('fs');
const server = fs.readFileSync(require.resolve('../server'), 'utf8');
const app = fs.readFileSync(require.resolve('../js/app'), 'utf8');

const vault = server.slice(server.indexOf('function getBloodTributeVaultState'), server.indexOf('function getTributeImageData'));
assert(!vault.includes('getTributeImageData'), 'vault metadata update must not read or encode images');
assert(!/imageData\s*:/.test(vault), 'vault metadata update carries no image bytes');
assert.match(server, /function handleTributeImageGet[\s\S]*?requireGmRoom\(ws\)[\s\S]*?hasReliquaryAccess\(ws\)/, 'individual retrieval requires GM and Reliquary authorization');
assert.match(server, /bloodTributes: \(room\.bloodTributes \|\| \[\]\)\.map\(tributeForRecovery\)/);
assert.match(server, /delete projected\.imageData/);
assert.match(app, /gm:tributeImageGet/);
assert.match(app, /case 'tribute:image'/);
console.log('PASS tribute media contract: small vault metadata, private on-demand retrieval, compact recovery');
