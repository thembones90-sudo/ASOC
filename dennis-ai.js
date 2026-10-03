'use strict';

const DENNIS_ID = '__DENNIS_AI__';
const DENNIS_NAME = 'Dennis AI';
// Content-versioned URL: changing only roster avatarHash is not enough when a
// browser/service cache already owns the old bytes at the same asset URL.
const DENNIS_AVATAR = '/assets/profiles/dennis-ai.png?v=d27d496e';
const DENNIS_FRAME = '#000000';
const DENNIS_TIME_ZONE = 'Europe/Belgrade';
const MORNING_GREETING = 'Dobro jutro, ko se nije probudio, spasio se';
const MAX_MESSAGES_PER_DAY = 12;
const RETALIATION_MIN_MS = 10 * 60_000;
const RETALIATION_MAX_MS = 20 * 60_000;

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
  'Svi treba da pocrkaju'
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
    pendingRetaliations: []
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
    pendingRetaliations: normalizeRetaliations(input.pendingRetaliations)
  };
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

  // This branch always runs before replies/ambient chatter. It is therefore
  // impossible for Dennis to speak on a new local day before his greeting.
  if (!state.greetedAt) {
    if (now < state.greetingAt) return { state, message: null, retaliations: [] };
    state.greetedAt = now;
    remember(state, MORNING_GREETING);
    scheduleAmbient(state, now, random);
    return { state, message: MORNING_GREETING, retaliations: [] };
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
  if (!state.enabled || !state.greetedAt || state.pendingReply || state.messagesToday >= MAX_MESSAGES_PER_DAY) return state;
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
  RANDOM_MESSAGES,
  MAX_MESSAGES_PER_DAY,
  RETALIATION_MIN_MS,
  RETALIATION_MAX_MS,
  dateKeyAt,
  localMinuteTimestamp,
  normalizeState,
  scheduleRetaliation,
  tick,
  observe,
  publicProfile
};
