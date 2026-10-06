'use strict';

const DENNIS_ID = '__DENNIS_AI__';
const DENNIS_NAME = 'Dennis';
// Content-versioned URL: changing only roster avatarHash is not enough when a
// browser/service cache already owns the old bytes at the same asset URL.
const DENNIS_AVATAR = '/assets/profiles/dennis-ai.png?v=d2a265d8';
const DENNIS_FRAME = '#000000';
const DENNIS_TIME_ZONE = 'Europe/Belgrade';
const MORNING_GREETINGS = Object.freeze([
  'Dobro jutro, ko se nije probudio, spasio se',
  'Jutro 😩'
]);
const MORNING_GREETING = MORNING_GREETINGS[0];
const DENNIS_MORNING_IMAGE = '/assets/profiles/dennis-jutro-tiny.jpg?v=20261006-jutro-1';
const MAX_MESSAGES_PER_DAY = 12;
const RETALIATION_MIN_MS = 10 * 60_000;
const RETALIATION_MAX_MS = 20 * 60_000;
const SPEAKING_START_MINUTE = 9 * 60;
const SPEAKING_END_MINUTE = 16 * 60;
const ANNOUNCER_MODES = Object.freeze(['off', 'announcer', 'advice']);
const ANNOUNCEMENT_GLOBAL_COOLDOWN_MS = 25_000;
const ANNOUNCEMENT_EVENT_COOLDOWN_MS = 60_000;

const GAME_ANNOUNCEMENTS = Object.freeze({
  open: Object.freeze({
    announcer: [
      'Kapije za {{game}} su otvorene. Uđite dobrovoljno, da vas kasnije ne vučemo.',
      '{{game}} doziva nove žrtve. Ovo je poslednji trenutak da se pravite da niste videli.',
      'Zbor je sazvan. {{game}} čeka svoje junake, ili ono što danas imamo umesto njih.',
      'Otvara se {{game}}. Nada ulazi prva, dostojanstvo obično ne izađe.'
    ],
    advice: [
      'Kapije za {{game}} su otvorene. Pročitajte pravila pre ulaska; tragedija je bolja kada bar znate zašto gubite.',
      '{{game}} prima igrače. Uđite sada i proverite pravila, jer panika tokom partije retko izgleda herojski.'
    ]
  }),
  start: Object.freeze({
    announcer: [
      'Neka zazvone poslednja zvona. {{game}} je počeo, a razum je prvi napustio bojno polje.',
      '{{game}} počinje. Sudbina vas posmatra i već deluje razočarano.',
      'Pečat je slomljen. {{game}} je počeo. Od ovog trenutka svaka greška postaje istorijska sramota.',
      'Bubnjevi odzvanjaju. {{game}} kreće, mada sam lično navijao za otkazivanje.'
    ],
    advice: [
      '{{game}} je počeo. Pratite redosled i svoj potez; propast je neizbežna, ali ne mora biti administrativna.',
      'Bitka počinje. Gledajte stanje igre, ne poruke od pre pet minuta. Haos ne mora baš potpuno da pobedi.'
    ]
  }),
  turn: Object.freeze({
    announcer: [
      'Svetla pozornice padaju na tebe. Sledeći potez je tvoj. Huh? Da, baš tvoj.',
      'Sudbina je izabrala sledećeg igrača. Iskreno, nije imala mnogo materijala.',
      'Tvoj je potez. Hiljade zamišljenih gledalaca ćute, uglavnom iz neprijatnosti.',
      'Došao je trenutak odluke. Verovatno ćeš ga potrošiti gledajući gde treba da klikneš.'
    ],
    advice: [
      'Tvoj je potez. Proveri zahtev pre slanja; tragedija je podnošljivija kada nije izazvana pogrešnim dugmetom.',
      'Sada igraj. Pročitaj trenutno stanje i pošalji tačno ono što se traži. Znam, surovi uslovi.'
    ]
  }),
  vote: Object.freeze({
    announcer: [
      'Veće je sazvano. Glasanje je otvoreno, a demokratija ponovo stoji na ivici ponora.',
      'Podignite glasove. Istina će biti odlučena većinom, što nikada nije zabrinjavajuće.',
      'Sud sada pripada vama. Glasajte mudro, ili bar dovoljno ubedljivo da sakrijete da pogađate.',
      'Otvara se glasanje. Pravda je skinula povez da bi mogla da ode kući.'
    ],
    advice: [
      'Veće glasa. Ne možete suditi sopstvenom potezu; pogledajte autora pre nego što osudite pogrešnu osobu.',
      'Glasanje je otvoreno. Pročitajte potez, proverite pravilo, pa tek onda donesite katastrofalnu odluku.'
    ]
  }),
  timer: Object.freeze({
    announcer: [
      'Peščani sat krvari poslednja zrna. Vreme curi, a ja bih već odustao.',
      'Poslednji trenuci marširaju prema vama. Sat radi. Vi, koliko vidim, manje.',
      'Odbrojavanje je počelo. Svaka sekunda umire hrabrije od prethodne.',
      'Vreme nestaje. Uskoro će ostati samo tišina i objašnjenje kako ste skoro stigli.'
    ],
    advice: [
      'Ostalo je malo vremena. Pošaljite potez pre isteka; sistem još nije naučio da nagrađuje dobre namere.',
      'Sat je pri kraju. Zaključajte odluku sada, pre nego što je vreme pretvori u još jednu tužnu anegdotu.'
    ]
  }),
  elimination: Object.freeze({
    announcer: [
      'Jedno ime je izbrisano iz hronike. Eliminacija potvrđena. Sistem, nažalost, radi.',
      'Još jedan junak je pao. Nova runda nastavlja bez njega, kao i život bez ikakvog objašnjenja.',
      'Bojno polje je tiše za jednog igrača. Ne bih to nazvao napretkom, ali broj je manji.',
      'Sudbina je uzela svoj danak. Neko je eliminisan, ostali su samo privremeno pošteđeni.'
    ],
    advice: [
      'Igrač je eliminisan. Proverite novi redosled pre nastavka; mrtvi više ne dobijaju potez, osim u lošim nastavcima.',
      'Jedan igrač ispada. Nova runda kreće bez njega, zato pratite ko je sada prvi na potezu.'
    ]
  }),
  result: Object.freeze({
    announcer: [
      'Bitka je završena. Rezultat je uklesan u kamen, a žalbe možete poslati u prazninu.',
      '{{game}} je završen. Preživeli neka slave, poraženi neka tvrde da je bilo namešteno.',
      'Spustite zastave. {{game}} je gotov i istorija će velikodušno prećutati većinu detalja.',
      'Pobeda je proglašena. Negde svira trijumfalna muzika. Ja je, srećom, ne čujem.'
    ],
    advice: [
      '{{game}} je završen. Proverite konačan rezultat pre nove partije; sećanje poraženih brzo postaje kreativno.',
      'Kraj je potvrđen. Pogledajte rezultat i nagrade sada, pre nego što svi razviju sopstvenu verziju istorije.'
    ]
  }),
  update: Object.freeze({
    announcer: [
      '{{game}} se nastavlja. Mašina sudbine melje dalje, uglavnom praznog hoda.',
      'Nova stranica hronike je otvorena. {{game}} traje, a ja još obrađujem prethodnu katastrofu.',
      'Igra se nastavlja. Heroji napreduju, mada je pravac predmet rasprave.',
      '{{game}} odbija da se završi. Poštujem tu vrstu besmislene upornosti.'
    ],
    advice: [
      'Pratite trenutno stanje igre, ne poruke od pre pet minuta. Prošlost je dovoljno beskorisna i bez vaše pomoći.',
      '{{game}} se nastavlja. Proverite redosled, cilj i tajmer; intuicija vas je već dovoljno koštala.'
    ]
  })
});

// Keep these strings literal: this is the character's authored voice. The
// rejected dehumanizing line is intentionally not part of the pool.
const RANDOM_MESSAGES = Object.freeze([
  'xD',
  'Mmmm gotičarke',
  'Ne treba mi nova grafička',
  'Huh?',
  'Ja ne mogu ovaj posao više',
  'Neka me neko ubije',
  'Ja ne mogu ponovo ovu decu',
  'OPET HELLO BEDA AAAAAAAAAAA',
  'Vreme je da igram KOTOR opet',
  'Haha ja to nisam gledao, možda bih mogao jednom',
  'Haha ja to nisam igrao, možda bih mogao jednom',
  'Haha ja to nisam probao, možda bih mogao jednom',
  'Trebao bih nešto da promenim u životu',
  'Ne mogu ništa da promenim',
  'Mrzim sve',
  'Jebem ti dan',
  'Dokle ovo sranje',
  'Najgori dan ikad',
  'IMA LI OVAJ DAN KRAJA',
  'Svi treba da pocrkaju',
  'Je l\' neko rekao KOTOR?',
  'Samo još jedan stari RPG pa se vraćam u stvarnost',
  'Čekaj, o čemu pričamo?',
  'Kasnim samo mentalno',
  'Nisam video poruku, gledao sam u prazno',
  'Može li danas da se preskoči?',
  'Instalirao bih opet nešto iz 2003.',
  'Meni treba quicksave za život',
  'Koji je danas dan?',
  'Čekaj, je l\' ovo bilo pitanje za mene?',
  'Odgovoriću čim shvatim šta se dešava',
  'Samo da završim ovaj quest od pre dvadeset godina',
  'Nemam energije ni za loading screen',
  'Sve je side quest, a ja sam promašio main story',
  'Možda sutra budem funkcionalan',
  'Danas sam NPC bez dijaloga',
  'Ne znam gde sam pošao',
  'Je l\' može autosave pre smene?',
  'Ponovo sam zaboravio šta sam hteo',
  'Stvarnost ima loš game design',
  'Ovo bi se rešilo da imam lightsaber',
  'Bio sam tu, samo nisam bio prisutan',
  'Čuo sam vas tek deset minuta kasnije',
  'Mogu li da rerollujem ovaj dan?',
  'Huh? Ko je šta rekao?',
  'Pokrenuo sam igru i zaboravio zašto',
  'Realnost opet nema patch notes',
  'Samo da nađem save od juče',
  'Mislim da mi je mozak na cooldownu',
  'Ovaj razgovor mi se još učitava'
]);

const belgradeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DENNIS_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});

function partsAt(timestamp) {
  const values = {};
  for (const part of belgradeFormatter.formatToParts(new Date(timestamp))) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return values;
}

function dateKeyAt(timestamp) {
  const p = partsAt(timestamp);
  return `${p.year}-${p.month}-${p.day}`;
}

function isSpeakingTime(timestamp = Date.now()) {
  const p = partsAt(timestamp);
  const minute = Number(p.hour) * 60 + Number(p.minute);
  return minute >= SPEAKING_START_MINUTE && minute < SPEAKING_END_MINUTE;
}

// Intl exposes the authoritative timezone rules but not a local-time parser.
// Belgrade is UTC+1/+2, so this bounded minute search is deterministic across
// DST and only runs once per room/day.
function localMinuteTimestamp(dateKey, hour, minute) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const center = Date.UTC(year, month - 1, day, hour - 1, minute, 0, 0);
  for (let delta = -2 * 60; delta <= 3 * 60; delta++) {
    const candidate = center + delta * 60_000;
    const p = partsAt(candidate);
    if (`${p.year}-${p.month}-${p.day}` === dateKey && Number(p.hour) === hour && Number(p.minute) === minute) {
      return candidate;
    }
  }
  return center;
}

function randomUnit(random) {
  const value = Number((random || Math.random)());
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
}

function randomMs(min, max, random) {
  return min + Math.floor(randomUnit(random) * Math.max(1, max - min));
}

function freshDay(dateKey, random) {
  const nine = localMinuteTimestamp(dateKey, 9, 0);
  return {
    enabled: true,
    dateKey,
    greetingAt: nine + randomMs(0, 60 * 60_000, random),
    greetedAt: null,
    nextAmbientAt: null,
    pendingReply: null,
    messagesToday: 0,
    recentMessages: [],
    pendingRetaliations: [],
    announcerMode: 'advice',
    announcementQueue: [],
    announcementCooldowns: {},
    lastAnnouncementAt: null
  };
}

function normalizeRetaliations(value) {
  return (Array.isArray(value) ? value : [])
    .filter(entry => entry && Number.isFinite(Number(entry.dueAt)) && ['act', 'emote'].includes(entry.kind)
      && /^[a-z-]{2,30}$/.test(String(entry.command || '')) && String(entry.targetId || ''))
    .map(entry => ({
      id: String(entry.id || '').slice(0, 80),
      dueAt: Number(entry.dueAt),
      queuedAt: Number(entry.queuedAt) || Number(entry.dueAt) - RETALIATION_MIN_MS,
      kind: entry.kind,
      command: String(entry.command).slice(0, 30),
      targetId: String(entry.targetId).slice(0, 64),
      targetName: String(entry.targetName || 'TARGET').slice(0, 40)
    }))
    .slice(-50);
}

function normalizeState(input, now = Date.now(), random = Math.random) {
  const today = dateKeyAt(now);
  if (!input || typeof input !== 'object') return freshDay(today, random);
  if (input.dateKey !== today) {
    const state = freshDay(today, random);
    // A command close to midnight is still answered, but the daily greeting
    // gate means it waits until Dennis has delivered his first line that day.
    state.pendingRetaliations = normalizeRetaliations(input.pendingRetaliations);
    state.announcerMode = ANNOUNCER_MODES.includes(input.announcerMode) ? input.announcerMode : 'advice';
    return state;
  }
  return {
    enabled: input.enabled !== false,
    dateKey: today,
    greetingAt: Number.isFinite(Number(input.greetingAt)) ? Number(input.greetingAt) : freshDay(today, random).greetingAt,
    greetedAt: Number.isFinite(Number(input.greetedAt)) ? Number(input.greetedAt) : null,
    nextAmbientAt: Number.isFinite(Number(input.nextAmbientAt)) ? Number(input.nextAmbientAt) : null,
    pendingReply: input.pendingReply && Number.isFinite(Number(input.pendingReply.dueAt)) && RANDOM_MESSAGES.includes(input.pendingReply.text)
      ? { dueAt: Number(input.pendingReply.dueAt), text: input.pendingReply.text }
      : null,
    messagesToday: Math.max(0, Math.min(MAX_MESSAGES_PER_DAY, Number(input.messagesToday) || 0)),
    recentMessages: Array.isArray(input.recentMessages)
      ? input.recentMessages.filter(line => RANDOM_MESSAGES.includes(line)).slice(-5)
      : [],
    pendingRetaliations: normalizeRetaliations(input.pendingRetaliations),
    announcerMode: ANNOUNCER_MODES.includes(input.announcerMode) ? input.announcerMode : 'advice',
    announcementQueue: (Array.isArray(input.announcementQueue) ? input.announcementQueue : [])
      .filter(entry => entry && typeof entry.text === 'string' && Number.isFinite(Number(entry.queuedAt)))
      .map(entry => ({ event: String(entry.event || 'update').slice(0, 24), text: entry.text.slice(0, 240), queuedAt: Number(entry.queuedAt) }))
      .slice(-6),
    announcementCooldowns: input.announcementCooldowns && typeof input.announcementCooldowns === 'object'
      ? Object.fromEntries(Object.entries(input.announcementCooldowns).filter(([key, value]) => /^[a-z-]{2,24}$/.test(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]))
      : {},
    lastAnnouncementAt: Number.isFinite(Number(input.lastAnnouncementAt)) ? Number(input.lastAnnouncementAt) : null
  };
}

function setAnnouncerMode(input, mode, now = Date.now(), random = Math.random) {
  const state = normalizeState(input, now, random);
  state.announcerMode = ANNOUNCER_MODES.includes(mode) ? mode : state.announcerMode;
  if (state.announcerMode === 'off') state.announcementQueue = [];
  return state;
}

function queueGameAnnouncement(input, event, details = {}, now = Date.now(), random = Math.random) {
  const state = normalizeState(input, now, random);
  const kind = GAME_ANNOUNCEMENTS[event] ? event : 'update';
  if (state.announcerMode === 'off' || !isSpeakingTime(now)) return state;
  if (now - Number(state.lastAnnouncementAt || 0) < ANNOUNCEMENT_GLOBAL_COOLDOWN_MS) return state;
  if (now - Number(state.announcementCooldowns[kind] || 0) < ANNOUNCEMENT_EVENT_COOLDOWN_MS) return state;
  if (state.announcementQueue.some(entry => entry.event === kind)) return state;
  const definition = GAME_ANNOUNCEMENTS[kind];
  const pool = state.announcerMode === 'advice'
    ? [...definition.announcer, ...definition.advice]
    : definition.announcer;
  const game = String(details.game || 'Igra').slice(0, 48);
  const text = kind === 'start' && game.toUpperCase() === 'ASOC'
    ? "IKS OKS POČINJE, NE ČEK' JEBOTE, ovo je asoc.. Huh?"
    : pool[Math.floor(randomUnit(random) * pool.length)].replaceAll('{{game}}', game);
  state.announcementQueue.push({ event: kind, text, queuedAt: now });
  state.announcementQueue = state.announcementQueue.slice(-6);
  state.announcementCooldowns[kind] = now;
  return state;
}

function scheduleRetaliation(input, retaliation, now = Date.now(), random = Math.random) {
  const state = normalizeState(input, now, random);
  const kind = retaliation?.kind;
  const command = String(retaliation?.command || '').toLowerCase();
  const targetId = String(retaliation?.targetId || '');
  if (!['act', 'emote'].includes(kind) || !/^[a-z-]{2,30}$/.test(command) || !targetId) return state;
  const dueAt = now + randomMs(RETALIATION_MIN_MS, RETALIATION_MAX_MS + 1, random);
  state.pendingRetaliations.push({
    id: `dennis-retaliation-${now.toString(36)}-${Math.floor(randomUnit(random) * 0xffffff).toString(36)}`,
    queuedAt: now,
    dueAt,
    kind,
    command,
    targetId: targetId.slice(0, 64),
    targetName: String(retaliation.targetName || 'TARGET').slice(0, 40)
  });
  state.pendingRetaliations = state.pendingRetaliations.slice(-50);
  return state;
}

function chooseMessage(state, random = Math.random) {
  const recent = new Set(state.recentMessages || []);
  const available = RANDOM_MESSAGES.filter(line => !recent.has(line));
  const pool = available.length ? available : RANDOM_MESSAGES;
  return pool[Math.floor(randomUnit(random) * pool.length)];
}

function remember(state, text) {
  state.recentMessages = [...(state.recentMessages || []), text].slice(-5);
  state.messagesToday = Math.min(MAX_MESSAGES_PER_DAY, (Number(state.messagesToday) || 0) + 1);
}

function scheduleAmbient(state, now, random) {
  state.nextAmbientAt = now + randomMs(20 * 60_000, 45 * 60_000, random);
}

function tick(input, now = Date.now(), random = Math.random) {
  const state = normalizeState(input, now, random);
  if (!state.enabled) return { state, message: null, retaliations: [] };
  // Dennis is a daytime presence. Due replies and retaliations remain queued
  // while he is offline and resume in the next Belgrade speaking window.
  if (!isSpeakingTime(now)) return { state, message: null, retaliations: [] };

  // This branch always runs before replies/ambient chatter. It is therefore
  // impossible for Dennis to speak on a new local day before his greeting.
  if (!state.greetedAt) {
    if (now < state.greetingAt) return { state, message: null, retaliations: [] };
    state.greetedAt = now;
    const morningGreeting = MORNING_GREETINGS[Math.min(MORNING_GREETINGS.length - 1, Math.floor(random() * MORNING_GREETINGS.length))];
    remember(state, morningGreeting);
    scheduleAmbient(state, now, random);
    return { state, message: morningGreeting, morning: true, imageUrl: morningGreeting === 'Jutro 😩' ? DENNIS_MORNING_IMAGE : '', retaliations: [] };
  }

  if (state.announcementQueue.length && state.messagesToday < MAX_MESSAGES_PER_DAY) {
    const announcement = state.announcementQueue.shift();
    state.lastAnnouncementAt = now;
    remember(state, announcement.text);
    scheduleAmbient(state, now, random);
    return { state, message: announcement.text, retaliations: [] };
  }

  const retaliations = state.pendingRetaliations.filter(entry => entry.dueAt <= now);
  if (retaliations.length) {
    const dueIds = new Set(retaliations.map(entry => entry.id));
    state.pendingRetaliations = state.pendingRetaliations.filter(entry => !dueIds.has(entry.id));
  }
  if (state.messagesToday >= MAX_MESSAGES_PER_DAY) return { state, message: null, retaliations };
  if (state.pendingReply && now >= state.pendingReply.dueAt) {
    const text = state.pendingReply.text;
    state.pendingReply = null;
    remember(state, text);
    scheduleAmbient(state, now, random);
    return { state, message: text, retaliations };
  }
  if (!state.nextAmbientAt) scheduleAmbient(state, now, random);
  if (now >= state.nextAmbientAt) {
    const text = chooseMessage(state, random);
    remember(state, text);
    scheduleAmbient(state, now, random);
    return { state, message: text, retaliations };
  }
  return { state, message: null, retaliations };
}

function observe(input, chatText, now = Date.now(), random = Math.random) {
  const state = normalizeState(input, now, random);
  if (!state.enabled || !isSpeakingTime(now) || !state.greetedAt || state.pendingReply || state.messagesToday >= MAX_MESSAGES_PER_DAY) return state;
  const text = String(chatText || '');
  const direct = /\bdennis\b/i.test(text);
  if (!direct && randomUnit(random) >= 0.04) return state;
  if (direct && randomUnit(random) >= 0.65) return state;
  const reply = direct && randomUnit(random) < 0.58 ? 'Huh?' : chooseMessage(state, random);
  state.pendingReply = {
    dueAt: now + randomMs(direct ? 2 * 60_000 : 4 * 60_000, direct ? 8 * 60_000 : 12 * 60_000, random),
    text: reply
  };
  return state;
}

function publicProfile() {
  return {
    id: DENNIS_ID,
    name: DENNIS_NAME,
    avatarData: DENNIS_AVATAR,
    frameColor: DENNIS_FRAME,
    themeId: 'gunmetal',
    themeColor: '#000000',
    connected: true,
    isSynthetic: true,
    isTestPersona: false,
    score: 0,
    shadowCoins: 0,
    cosmetics: {},
    heroRole: null
  };
}

module.exports = {
  DENNIS_ID,
  DENNIS_NAME,
  DENNIS_AVATAR,
  DENNIS_FRAME,
  DENNIS_TIME_ZONE,
  MORNING_GREETING,
  MORNING_GREETINGS,
  RANDOM_MESSAGES,
  MAX_MESSAGES_PER_DAY,
  RETALIATION_MIN_MS,
  RETALIATION_MAX_MS,
  SPEAKING_START_MINUTE,
  SPEAKING_END_MINUTE,
  ANNOUNCER_MODES,
  dateKeyAt,
  isSpeakingTime,
  localMinuteTimestamp,
  normalizeState,
  scheduleRetaliation,
  setAnnouncerMode,
  queueGameAnnouncement,
  tick,
  observe,
  publicProfile
};
