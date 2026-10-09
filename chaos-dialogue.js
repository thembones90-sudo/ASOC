'use strict';
// All events are text only; wager arithmetic remains in chaos.js.
const pick = (list, random) => list[random(list.length)];
const hero = value => String(value || 'LITTLE HERO').trim();
const coin = value => String(value) + ' SC';
const lines = {
 open: [
 p => 'THE BLOOD BROKER HAS GROWN BORED. ' + p.who + ', YOUR NAMES HAVE BEEN DRAWN FROM THE ABYSS. ROLL ' + p.target + '+ TO CLAIM ' + coin(p.coins) + '. FAIL AND THE RELIQUARY EXPECTS A BLOOD TRIBUTE. ROLL 100 TO DOUBLE THE REWARD; ROLL 1 AND OWE A DARK BLOOD TRIBUTE. ' + p.seconds + ' SECONDS TO ACCEPT YOUR FATE.',
 p => 'THE ABYSS HAS SELECTED ' + p.who + '. REACH ' + p.target + '+ FOR ' + coin(p.coins) + '; FALL SHORT AND PAY A BLOOD TRIBUTE. A PERFECT 100 PAYS DOUBLE. A MISERABLE 1 DEMANDS A DARK BLOOD TRIBUTE. ACCEPT OR REFUSE IN ' + p.seconds + ' SECONDS.',
 p => 'THE RELIQUARY IS HUNGRY, AND ' + p.who + ' HAVE BEEN NOMINATED. THE PRICE OF SURVIVAL: ROLL ' + p.target + '+ FOR ' + coin(p.coins) + '. FAIL AND OWE BLOOD. 100 DOUBLES THE PRIZE; 1 DEMANDS DARK BLOOD. ' + p.seconds + ' SECONDS TO DECIDE.'
 ],
 accept: [
 p => hero(p.name) + ' ACCEPTS THE WAGER. THE BLOOD BROKER SMILES. THE DICE AWAIT THEIR NEXT VICTIM. USE /roll, LITTLE HERO. LET US SEE WHAT YOUR COURAGE IS WORTH.',
 p => hero(p.name) + ' HAS SIGNED THE CONTRACT. TOO LATE TO DEVELOP COMMON SENSE NOW. TYPE /roll AND LEARN WHETHER THE ABYSS FAVORS YOU.',
 p => 'A BOLD MOVE FROM ' + hero(p.name) + '. THE WAGER IS SEALED. /roll, LITTLE HERO. ENTERTAIN ME.'
 ],
 decline: [
 p => hero(p.name) + ' HAS REFUSED THE WAGER. HOW DISAPPOINTING. THE ABYSS WAS EXPECTING A MEAL. YOUR COWARDICE HAS BEEN NOTED.',
 p => hero(p.name) + ' HAS CHOSEN SELF-PRESERVATION. TEDIOUS, BUT EFFECTIVE. THE BLOOD BROKER WILL REMEMBER THIS INSULT.',
 p => hero(p.name) + ' DECLINES THE CONTRACT. THE RELIQUARY SIGHED. SOMEWHERE, A DEMON HAS WASTED A PERFECTLY GOOD NAPKIN.'
 ],
 win: [
 p => p.value + '. AGAINST ALL REASONABLE EXPECTATIONS, ' + hero(p.name) + ' HAS SURVIVED THE WAGER. ' + coin(p.payout) + ' AWARDED. TRY NOT TO SPEND IT ALL ON STUPIDITY.',
 p => p.value + '. THE DICE HAVE SPARED ' + hero(p.name) + '. ' + coin(p.payout) + ' NOW BELONG TO YOU. EVEN THE ABYSS MAKES TERRIBLE DECISIONS.',
 p => p.value + '. ' + hero(p.name) + ' WALKS AWAY ' + coin(p.payout) + ' RICHER. THE BLOOD BROKER DEMANDS A RECOUNT.'
 ],
 lose: [
 p => p.value + '. ' + hero(p.name) + ' HAS FAILED. THE CONTRACT IS SEALED. THE BLOOD TRIBUTE IS NOW DUE. THE RELIQUARY AWAITS ITS OFFERING.',
 p => p.value + '. NOT ENOUGH, ' + hero(p.name) + '. THE DICE HAVE SPOKEN AND THE ABYSS HAS OPENED ITS MOUTH. BLOOD TRIBUTE REQUIRED.',
 p => p.value + '. THE BLOOD BROKER THANKS ' + hero(p.name) + ' FOR THIS GENEROUS DISPLAY OF MISFORTUNE. ONE BLOOD TRIBUTE IS NOW OWED.'
 ],
 perfect: [
 p => '100. IMPOSSIBLE. INFURIATING. MAGNIFICENT. ' + hero(p.name) + ' HAS WON ' + coin(p.payout) + '. DOUBLE THE REWARD. THE BLOOD BROKER DEMANDS AN AUDIT OF REALITY ITSELF.',
 p => 'ONE HUNDRED. THE ABYSS IS SPEECHLESS. ' + hero(p.name) + ' CLAIMS A PERFECT ROLL AND ' + coin(p.payout) + '. EVEN THE DICE HAVE BETRAYED ME.',
 p => '100. ' + hero(p.name) + ' HAS INSULTED PROBABILITY AND ESCAPED WITH ' + coin(p.payout) + '. THE HOUSE WOULD LIKE TO FILE A COMPLAINT.'
 ],
 dark: [
 p => 'ONE. ONE MISERABLE, PATHETIC LITTLE ONE. ' + hero(p.name) + ', THE ABYSS HAS STOPPED LAUGHING. A DARK BLOOD TRIBUTE IS OWED.',
 p => 'A NATURAL ONE. ' + hero(p.name) + ' HAS FOUND THE VERY BOTTOM OF FATE. THE RELIQUARY DEMANDS A DARK BLOOD TRIBUTE.',
 p => 'ONE. THE DICE HAVE DECLARED WAR ON ' + hero(p.name) + '. THIS IS NO ORDINARY DEBT. DARK BLOOD TRIBUTE REQUIRED.'
 ],
 payoutFailure: [p => p.value + '. ' + hero(p.name) + ' WON ' + coin(p.payout) + ', BUT THE TREASURY REFUSED TO PAY. PAYOUT FAILED: ' + p.error + '.']
};
function chaosLine(kind, values, randomInt) {
 if (!lines[kind]) throw new Error('UNKNOWN CHAOS DIALOGUE: ' + kind);
 const rand = typeof randomInt === 'function' ? randomInt : n => require('crypto').randomInt(n);
 return pick(lines[kind], rand)(values || {});
}
module.exports = { chaosLine, lines };
