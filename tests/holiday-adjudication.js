'use strict';
const assert=require('assert/strict');const A=require('../automation/spectral-adjudicator');
const solutions={A:'sail',B:'wither',C:'mirror',D:'energy',FINAL:'reckon'};
const inspect=(text,unattended,mode='AUTONOMOUS')=>A.inspect({boardId:'b',text},{boardId:'b',roomMode:'battle',mode,solutions,unattended});
for(const text of ['sail a :D','A SAIL?','perhaps sail over here A'])assert.equal(inspect(text,true).decision,'ACCEPT');
for(const text of ['withered b','saill a','reckoning k']){assert.equal(inspect(text,true).decision,'REJECT');assert.equal(inspect(text,false).decision,'ESCALATE','Normal review remains available');}
assert.equal(inspect('sail d',true).decision,'REJECT','Wrong column never accepted');
assert.equal(inspect('sail a b',true).decision,'CLARIFY');assert.equal(inspect('sail a b',false).decision,'ESCALATE');
assert.equal(inspect('sail a',true,'ASSISTED').decision,'ACCEPT');assert.equal(inspect('sail a',false,'ASSISTED').decision,'ESCALATE');
for(const text of ['sail a','sail d','withered b','saill a','reckoning k','sail a b','hello everyone','A1'])assert.notEqual(inspect(text,true).decision,'ESCALATE');
console.log('PASS Holiday SPECTRA: exact/decorated answers automatic; wrong targets rejected; uncertain variants rejected; ambiguity clarified by player; no GM escalation; normal modes unchanged');
