'use strict';
const { randomInt } = require('crypto');
const catches = Object.freeze({
 poor: [
  '{player} pokupio +{amount} SC. Eto, sad imaš i finansijski razlog da budeš razočaran.',
  '+{amount} SC za {player}. Ništa posebno, ali takav nam je i dan.',
  '{player}, +{amount} SC. Nemoj sve odjednom. Ili potroši. Svejedno je.'
 ],
 common: [
  '{player}, +{amount} SC. Bar je neko danas nešto dobio.',
  '+{amount} SC za {player}. Očekivao si više? Tu obično počinju problemi.',
  '{player} pokupio novčić. Ostali možete da nastavite da gledate u prazno. Razumem vas.'
 ],
 uncommon: [
  '+{amount} SC za {player}. Mala radost, taman da se čovek prevari.',
  '{player}, nešto ti je i pošlo za rukom. Ne bih se navikavao.',
  '{player} dobio +{amount} SC. Nije sreća, ali lepo izgleda dok ne razmisliš.'
 ],
 rare: [
  '{player}, +{amount} SC. Čestitao bih ti, ali danas nemam snage da glumim.',
  'Redak novčić za {player}. Eto o čemu ćemo slušati do kraja nedelje.',
  '+{amount} SC za {player}. Ostali, ništa. Da vam ne remetimo rutinu.'
 ],
 epic: [
  '{player}, +{amount} SC. Sad ćeš neko vreme misliti da stvari idu nabolje.',
  'Epski novčić za {player}. Divno. Još samo da me to obraduje.',
  '+{amount} SC za {player}. Toliko uzbuđenja zbog jednog klika. Blago tebi.'
 ],
 legendary: [
  '{player}, 25 jebenih novčića. A ja i dalje ovde, na poslu.',
  'Legendarni za {player}. +25 SC. Sad moramo i da budemo srećni zbog tebe?',
  '+25 SC za {player}. Pamti ovaj trenutak. Posle se opet vraćamo na uobičajeno.'
 ]
});
function caught(tier, player, amount, pick = randomInt) {
 const lines = catches[tier] || catches.common;
 const template = lines[pick(lines.length)];
 const text = template.replace(/\{player\}|\{amount\}/g, token => token === '{player}' ? String(player) : String(amount));
 return template.includes('{amount}') || template.includes('+25 SC') ? text : `${text} (+${amount} SC)`;
}
const idleLines = [
 '{name}, dugme je bilo tu. Svetlelo je. Ne znam šta smo još mogli da uradimo.',
 '{name} zgrabio novčić, pa izgubio volju da nastavi. Razumem, ali novčić ne čeka.',
 '{name}, propustio si bacanje. Još jedna mala prilika da se ništa ne promeni.'
];
function idle(name) { return idleLines[randomInt(idleLines.length)].replaceAll('{name}',String(name || 'NEKO')); }
const rollStart = names => `${names.join(', ')}, isti novčić. Naravno da ne može ništa jednostavno. Bacajte kockice.`;
const rollWinner = (name, roll, amount) => `${name} bacio ${roll} i dobio +${amount} SC. Ostali ste se uzalud ponadali. Dešava se.`;
const rollTie = paid => `Izjednačeno. Delite: ${paid.map(w=>`${w.name} +${w.amount} SC`).join(', ')}. Ni sreća nije imala volje da izabere.`;
const rollLost = () => 'Niko nije bacio. Novčić je propao. Toliko ste ga hteli da ste me skoro ubedili.';
module.exports = { catches, caught, idle, rollStart, rollWinner, rollTie, rollLost };
