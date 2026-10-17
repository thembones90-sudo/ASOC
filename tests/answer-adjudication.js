'use strict';
const assert = require('assert');
const { explicitTarget, coordinateIntent, classifyMessage } = require('../automation/answer-classifier');
const spectral = require('../automation/spectral-adjudicator');
let checks=0; const eq=(a,b,m)=>{checks++;assert.deepStrictEqual(a,b,m)};
eq(explicitTarget('A spite'),{target:'A',answer:'spite'},'marker first');
eq(explicitTarget('spite A'),{target:'A',answer:'spite'},'marker last');
eq(explicitTarget('K bug'),{target:'FINAL',answer:'bug'},'K first');
eq(explicitTarget('bug k'),{target:'FINAL',answer:'bug'},'K last');
eq(explicitTarget('property a?'),{target:'A',answer:'property'},'terminal question mark ignored');
eq(explicitTarget('D sail!'),{target:'D',answer:'sail'},'terminal exclamation mark ignored');
eq(explicitTarget('A black hole'),null,'multiword ignored');
eq(explicitTarget('normal chat'),null,'chat ignored');
eq(coordinateIntent('a1'),{cell:'A1',valid:true},'compact coordinate');
eq(coordinateIntent('A 1'),{cell:'A1',valid:true},'spaced coordinate');
eq(coordinateIntent('E1'),{cell:'E1',valid:false},'invalid column intent');
eq(coordinateIntent('A5'),{cell:'A5',valid:false},'invalid row intent');
const msg=text=>({id:'m1',playerId:'p1',playerName:'Hero',boardId:'b1',text,verdict:null});
const context={roomMode:'battle',boardId:'b1',mode:'AUTONOMOUS',solutions:{A:'spite',B:'moon',C:'fire',D:'water',FINAL:'bug'}};
eq(classifyMessage(msg('we should try spite maybe'),context).kind,'IGNORE','ordinary discussion ignored');
eq(spectral.inspect(msg('spite A'),context).decision,'ACCEPT','automatic exact column accepted');
eq(spectral.inspect(msg('spite A'),{...context,mode:'ASSISTED'}).decision,'ESCALATE','assisted exact column consults GM');
eq(spectral.inspect(msg('bug K'),context).decision,'ACCEPT','automatic exact final accepted');
eq(spectral.inspect(msg('K BUG?!'),context).decision,'ACCEPT','automatic exact final ignores case and terminal punctuation');
eq(spectral.inspect(msg('bug K'),{...context,mode:'ASSISTED'}).decision,'ESCALATE','assisted exact final consults GM');
eq(spectral.inspect(msg('spite A'),{...context,mode:undefined}).decision,'ESCALATE','missing mode cannot auto-accept');
eq(spectral.inspect(msg('A spiteful'),context).decision,'ESCALATE','derivation requires GM consultation');
eq(spectral.inspect(msg('A spiteful'),{...context,mode:'ASSISTED'}).decision,'ESCALATE','derivation escalates assisted');
eq(spectral.inspect(msg('A banana'),context).decision,'REJECT','clear wrong rejected');
eq(spectral.inspect(msg('A spit'),context).decision,'ESCALATE','possible typo requires GM judgment');
eq(spectral.inspect(msg('bug K'),context).target,'FINAL','final always targetable');
const strictColumns={...context,solutions:{...context.solutions,A:'sail',D:'stone'}};
for (const text of ['A banana 😂', 'banana A 🍺', '(A): banana!!! 😂']) {
  eq(spectral.inspect(msg(text),strictColumns).decision,'REJECT',`decorated wrong guess: ${text}`);
}
for (const text of ['A saill 😂', 'A sail-ing 😂']) {
  eq(spectral.inspect(msg(text),strictColumns).decision,spectral.inspect(msg(text.replace(' 😂','')),strictColumns).decision,`emoji cannot change judgment: ${text}`);
}
eq(spectral.inspect(msg('sail A'),strictColumns).decision,'ACCEPT','right answer and column accepted automatically');
eq(spectral.inspect(msg('sail D'),strictColumns).decision,'REJECT','right word on wrong column is a mistake');
eq(spectral.inspect(msg('D sail?'),strictColumns).decision,'REJECT','punctuated wrong-column answer is a mistake');
eq(spectral.inspect(msg('K sail'),strictColumns).decision,'REJECT','column solution cannot be credited to final');
for (const text of ['sail A :D', 'A sail 😂', 'I saw a sail', 'maybe (A): sail!!!', 'sail, somewhere around here, A', 'sail A xD', 'sail A :-D', 'sail A:D', 'sail A :d😂']) {
  eq(spectral.inspect(msg(text),strictColumns).decision,'ACCEPT',`broad whole-word match: ${text}`);
  eq(spectral.inspect(msg(text),{...strictColumns,mode:'ASSISTED'}).decision,'ESCALATE',`assisted broad match consults GM: ${text}`);
}
for (const text of ['I saw a sailboat', 'a sailed past', 'sailboat A 😂']) eq(spectral.inspect(msg(text),strictColumns).decision === 'ACCEPT',false,'substrings never accepted');
eq(spectral.inspect(msg('sail A or D'),strictColumns).decision,'ESCALATE','multiple markers require review');
eq(spectral.inspect(msg('sail A and moon B'),strictColumns).decision,'ESCALATE','multiple matching targets require review');
eq(spectral.inspect(msg('maybe sail D 😂'),strictColumns).decision,'REJECT','broad guess still uses named wrong column');
eq(spectral.inspect(msg('A saill :D'),strictColumns).decision,'ESCALATE','decorated typo still requires review');
eq(spectral.inspect(msg('perhaps black hole C 😂'),{...strictColumns,solutions:{...strictColumns.solutions,C:'black hole'}}).decision,'ACCEPT','complete multiword phrase accepted');
eq(spectral.inspect(msg('perhaps C black big hole'),{...strictColumns,solutions:{...strictColumns.solutions,C:'black hole'}}).decision === 'ACCEPT',false,'partial multiword phrase not accepted');
eq(spectral.inspect(msg('A sail'),{...strictColumns,solutions:{}}).decision,'ESCALATE','missing solution never auto-accepts');
eq(spectral.normalizeState(null).mode,'MANUAL','safe default is manual');
eq(spectral.normalizeState({scheduleArmed:true}).scheduleArmed,true,'schedule arm persists');
eq(spectral.publicState({scheduleArmed:true}).nextRitualTime,'12:55 Europe/Belgrade','schedule is explicit');
assert.ok(checks>=20); console.log(`answer adjudication tests: OK (${checks} checks)`);
