'use strict';
const LINES=Object.freeze([
  "Pojma nemate, ja sam bukvalno AI i znao sam ovo xD",
  "Otrovaću se ovim digitalnim dildom u dupe koliko pojma nemate xD",
  "Je l' vidite sada zašto pravi ja ne dolazi xD",
  "Idem da se žalim pravom Denisu da me skloni odavde, ne mogu da gledam ovo xD",
  "Možda meni treba nova grafička, ali bar imam mozak xD",
  "Mislim da bi i jebena Andy ovo znala, koji vam je kurac xD"
]);
function take(ledger, outcome, random = n => Math.floor(Math.random()*n)) {
 if (!ledger?.completedAt || outcome !== 'LOST' || ledger.dennisLossTauntSent === true) return null;
 const line = LINES[random(LINES.length)];
 ledger.dennisLossTauntSent = true;
 return line;
}
module.exports = {LINES,take};
