'use strict';
// HTTP acceptance from an authoritative action must obey the same durable
// outbox as WebSocket chat/verdict frames, including failed/aborted commits.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('function sendJson(');
const end = source.indexOf('\nfunction readJsonBody(', start);
assert.ok(start > 0 && end > start);
const sandbox = { Buffer, runtimeActionExecuting: true, outbound: [] };
vm.runInNewContext(source.slice(start, end) + '\nthis.sendJson=sendJson;', sandbox);
const replies = [];
const res = { writeHead: (status, headers) => replies.push({status, headers}), end: body => replies.push(JSON.parse(body)) };
const payload = {ok:true, tributeId:'test-only'};
sandbox.sendJson(res,201,payload);
payload.ok = false;
assert.equal(replies.length,0,'no successful HTTP response before durable commit');
assert.equal(sandbox.outbound.length,1);
const [ws, deliver] = sandbox.outbound[0];
assert.equal(ws,null);
sandbox.outbound=null; sandbox.runtimeActionExecuting=false;
deliver();
assert.equal(replies[0].status,201);
assert.deepEqual(replies[1],{ok:true,tributeId:'test-only'},'response freezes action-time result');
sandbox.runtimeActionExecuting=true; sandbox.outbound=[];
sandbox.sendJson(res,201,{uncommitted:true});
sandbox.outbound=null; // failed commit discards its entire outbox
assert.equal(replies.length,2,'aborted commit never sends successful upload acknowledgment');
sandbox.runtimeActionExecuting=false;
sandbox.sendJson({destroyed:true},201,{});
assert.equal(replies.length,2,'disconnected HTTP client is ignored safely');
console.log('PASS HTTP durable acceptance: queued response, immutable snapshot, failure suppression, disconnected client');
