'use strict';
// SHADOW MARKET -- the V1 foundation of the Shadow Coin economy.
//
// HARD RULE: Shadow Coin never buys competence. Everything in this catalog is
// appearance, expression, prestige or theatre. Nothing here may touch score,
// clues, timers, votes, WOMF, hints, moderation or another player's gameplay
// state -- the server never reads cosmetics anywhere gameplay is decided.
//
// Prices are placeholders for V1; tune them here, nowhere else. Coins are
// real currency amounts (whole or tenths); player-store converts to tenths.
//
// Item shape:
//   id        stable key stored in profiles (never rename a shipped id)
//   kind      'appearance' | 'effect' | 'frame' | 'title' | 'command'
//   name      display name
//   price     purchase price in coins (tier I for tiered items)
//   tiers     optional [tier I price, tier II price, ...] upgrade track
//   tierNames optional labels per tier
//   requires  optional { stat, min, label } achievement gate: purchasable
//             only once the profile stat reaches `min`
//   relic     true -> earned only, never purchasable
//   command   (kind 'command') the /verb it unlocks
//   earn      (relics) { label, counter?, min? } how it is earned; counter
//             relics progress through profile.relicProgress[counter]

// Equip slots: one item id each. 'card' is the dossier background.
const SLOT_KINDS = Object.freeze(['appearance', 'effect', 'frame', 'title', 'celebration', 'name', 'sigil', 'card']);
const SHOWCASE_BASE_SLOTS = 1;

const CATALOG = Object.freeze([
  // ---- Avatar looks: permanent alternate treatments of the player's avatar.
  { id: 'look-noir', kind: 'appearance', name: 'NOIR', price: 3, desc: 'Monochrome interrogation-room contrast.' },
  { id: 'look-spectral', kind: 'appearance', name: 'SPECTRAL', price: 5, desc: 'A violet afterimage of who you were.' },
  { id: 'look-damaged', kind: 'appearance', name: 'DAMAGED', price: 5, desc: 'Scratched, cracked, still transmitting.' },

  // ---- Avatar effects: animated layers around the avatar.
  {
    id: 'fx-void-eye', kind: 'effect', name: 'VOID EYE', price: 4, tiers: [4, 6, 8, 10, 14],
    tierNames: ['STATIC GLOW', 'ANIMATED PULSE', 'SURROUNDING PARTICLES', 'REACTIVE GLITCH', 'FINAL-SOLVE ANIMATION'],
    desc: 'It watches. Upgrade it and it watches harder.'
  },
  { id: 'fx-smoke', kind: 'effect', name: 'SMOKE', price: 6, desc: 'Slow grey smoke curling off the frame.' },
  { id: 'fx-fire', kind: 'effect', name: 'FIRE', price: 8, desc: 'Engulfed in slow flames. Nobody is putting it out.' },
  { id: 'fx-frost', kind: 'effect', name: 'FROST', price: 8, desc: 'Cold light and a creeping rime.' },
  { id: 'fx-corruption', kind: 'effect', name: 'CORRUPTION', price: 10, desc: 'Something wrong is leaking in.' },
  { id: 'fx-glitch', kind: 'effect', name: 'GLITCH', price: 10, desc: 'Signal tearing at the edges.' },
  { id: 'fx-hearts', kind: 'effect', name: 'LOVESTRUCK', price: 8, desc: 'A pink glow and little hearts floating up.' },

  // ---- Frames.
  { id: 'frame-gilded', kind: 'frame', name: 'GILDED FRAME', price: 5, desc: 'Old gold, badly earned.' },
  { id: 'frame-blood', kind: 'frame', name: 'BLOOD FRAME', price: 5, desc: 'A red rim that pulses slowly.' },
  { id: 'frame-circuit', kind: 'frame', name: 'CIRCUIT FRAME', price: 6, desc: 'Machine-edged, with a travelling light.' },

  // ---- Titles.
  { id: 'title-little-heretic', kind: 'title', name: 'Little Heretic', price: 3 },
  { id: 'title-void-touched', kind: 'title', name: 'Void-Touched', price: 8 },
  { id: 'title-womf-survivor', kind: 'title', name: 'WOMF Survivor', price: 8 },
  { id: 'title-pattern-seeker', kind: 'title', name: 'Pattern Seeker', price: 6, requires: { stat: 'columnSolutions', min: 25, label: 'Solve 25 columns' } },
  { id: 'title-final-witness', kind: 'title', name: 'Final Witness', price: 15, requires: { stat: 'finalSolutions', min: 10, label: 'Solve 10 Finals' } },
  { id: 'title-broker-mistake', kind: 'title', name: "Shadow Broker's Mistake", relic: true, desc: 'Relic. Granted, never sold.' },

  // ---- Cosmetic /commands: permanent unlocks, pure theatre, cooldown-limited.
  { id: 'cmd-smite', kind: 'command', command: 'smite', name: '/smite', price: 6, desc: 'Call down a strike of judgement on someone.' },
  { id: 'cmd-freeze', kind: 'command', command: 'freeze', name: '/freeze', price: 5, desc: 'Encase someone in theatrical ice.' },
  { id: 'cmd-glitch', kind: 'command', command: 'glitch', name: '/glitch', price: 5, desc: 'Tear the signal around someone.' },
  { id: 'cmd-omen', kind: 'command', command: 'omen', name: '/omen', price: 7, desc: 'Announce a bad sign for the room.' },
  { id: 'cmd-rupture', kind: 'command', command: 'rupture', name: '/rupture', price: 8, desc: 'Crack reality open for a moment.' },
  { id: 'cmd-vanish', kind: 'command', command: 'vanish', name: '/vanish', price: 4, desc: 'Disappear in smoke. You are still here.' },
  { id: 'cmd-love', kind: 'command', command: 'love', name: '/love', price: 4, desc: 'Colourful hearts fly over the chat. Aim it: /love @Name.' },

  // ---- Correct-answer celebrations: play on YOUR accepted answers.
  { id: 'cel-broker-nod', kind: 'celebration', name: "THE BROKER'S NOD", price: 6, desc: 'A gold ACCEPTED stamp slams onto your answer.' },
  { id: 'cel-shatter', kind: 'celebration', name: 'SHATTER', price: 8, desc: 'Your answer cracks the glass it was written on.' },
  { id: 'cel-blood-ink', kind: 'celebration', name: 'BLOOD INK', price: 6, desc: 'Your answer rewrites itself in red.' },
  { id: 'cel-final-witness', kind: 'celebration', name: 'FINAL WITNESS', price: 12, requires: { stat: 'finalSolutions', min: 10, label: 'Solve 10 Finals' }, desc: 'Plays only when you take the Final. The room goes dark for you.' },

  // ---- Name styles.
  { id: 'name-ember', kind: 'name', name: 'EMBER NAME', price: 4, desc: 'Your name smoulders orange.' },
  { id: 'name-frost', kind: 'name', name: 'FROST NAME', price: 4, desc: 'Your name in cold blue light.' },
  { id: 'name-gold', kind: 'name', name: 'GILDED NAME', price: 6, desc: 'Your name in old gold.' },
  { id: 'name-void', kind: 'name', name: 'VOID NAME', price: 6, desc: 'Violet, and it flickers.' },
  { id: 'name-burnt', kind: 'name', name: 'BURNT NAME', price: 5, desc: 'Scorched at the edges.' },

  // ---- Sigils: a mark after your name.
  { id: 'sigil-eye', kind: 'sigil', name: 'EYE SIGIL', price: 3, desc: 'Watching.' },
  { id: 'sigil-skull', kind: 'sigil', name: 'SKULL SIGIL', price: 3, desc: 'Memento mori.' },
  { id: 'sigil-crown', kind: 'sigil', name: 'CROWN SIGIL', price: 5, desc: 'Presumptuous.' },
  { id: 'sigil-dagger', kind: 'sigil', name: 'DAGGER SIGIL', price: 3, desc: 'For the knife-work of deduction.' },
  { id: 'sigil-coin', kind: 'sigil', name: 'COIN SIGIL', price: 4, desc: 'Paid in shadow.' },

  // ---- Dossier: card backgrounds and relic showcase slots.
  { id: 'card-blood', kind: 'card', name: 'BLOOD DOSSIER', price: 5, desc: 'A red-stamped file.' },
  { id: 'card-void', kind: 'card', name: 'VOID DOSSIER', price: 5, desc: 'A file that should not exist.' },
  { id: 'card-gilded', kind: 'card', name: 'GILDED DOSSIER', price: 8, desc: 'Gold leaf on a confidential record.' },
  {
    id: 'showcase-slots', kind: 'showcase', name: 'RELIC SHOWCASE', price: 5, tiers: [5, 10],
    tierNames: ['SECOND RELIC SLOT', 'THIRD RELIC SLOT'],
    desc: 'Show more relics on your dossier. Everyone starts with one slot.'
  },

  // ---- Relics: earned only. Shown on the dossier.
  { id: 'relic-spun-returned', kind: 'relic', name: 'SPUN AND RETURNED', relic: true, earn: { label: 'Survive 5 WOMF spins', counter: 'wheelSurvivals', min: 5 }, desc: 'The Wheel passed over you five times.' },
  { id: 'relic-fastest-hand', kind: 'relic', name: 'FASTEST HAND', relic: true, earn: { label: 'Make the first solve in 10 matches', counter: 'firstSolves', min: 10 }, desc: 'First blood, ten times over.' },
  { id: 'relic-last-second-heretic', kind: 'relic', name: 'LAST-SECOND HERETIC', relic: true, earn: { label: 'Solve no column, then take the Final' }, desc: 'Silent all match. Then the only answer that mattered.' },
  { id: 'relic-word-killer', kind: 'relic', name: 'WORD KILLER', relic: true, earn: { label: 'Win KALADONT with the word KALADONT' }, desc: 'Ended it with the word itself.' }
]);

const BY_ID = new Map(CATALOG.map(item => [item.id, item]));
const COMMAND_ITEMS = new Map(CATALOG.filter(item => item.kind === 'command').map(item => [item.command, item]));

function getItem(id) { return BY_ID.get(String(id || '')) || null; }
function tierCount(item) { return Array.isArray(item?.tiers) ? item.tiers.length : 1; }

// Price of the NEXT step for a profile that owns `ownedTier` (0 = not owned).
// null when nothing more can be bought.
function nextPrice(item, ownedTier) {
  if (!item || item.relic) return null;
  const tier = Math.max(0, Number(ownedTier) || 0);
  if (tier >= tierCount(item)) return null;
  return Array.isArray(item.tiers) ? item.tiers[tier] : item.price;
}

function requirementMet(item, profile) {
  if (!item?.requires) return true;
  return (Number(profile?.[item.requires.stat]) || 0) >= item.requires.min;
}

// Catalog as the client sees it, annotated for one profile.
function catalogFor(profile) {
  const owned = profile?.cosmetics?.owned || {};
  return CATALOG.map(item => {
    const tier = Number(owned[item.id]) || 0;
    const price = nextPrice(item, tier);
    const req = item.requires
      ? { label: item.requires.label, progress: Math.min(Number(profile?.[item.requires.stat]) || 0, item.requires.min), min: item.requires.min, met: requirementMet(item, profile) }
      : null;
    const earn = item.earn
      ? {
        label: item.earn.label,
        ...(item.earn.counter ? { progress: Math.min(Number(profile?.relicProgress?.[item.earn.counter]) || 0, item.earn.min), min: item.earn.min } : {})
      }
      : null;
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      desc: item.desc || '',
      relic: item.relic === true,
      command: item.command || null,
      tier,
      maxTier: tierCount(item),
      tierNames: item.tierNames || null,
      nextPrice: price,
      requires: req,
      earn
    };
  });
}

// Relic items a profile may place in its showcase (relics + relic titles).
function isShowcaseable(item) { return !!item && item.relic === true; }

function showcaseSlots(profile) {
  return SHOWCASE_BASE_SLOTS + (Number(profile?.cosmetics?.owned?.['showcase-slots']) || 0);
}

// The public dossier another player sees when they open a profile.
function dossierFor(profile, { online = true } = {}) {
  const owned = profile?.cosmetics?.owned || {};
  const pub = publicCosmetics(profile);
  const card = getItem(profile?.cosmetics?.equipped?.card);
  const showcase = (profile?.cosmetics?.showcase || [])
    .map(getItem)
    .filter(item => isShowcaseable(item) && Number(owned[item.id]) > 0)
    .slice(0, showcaseSlots(profile))
    .map(item => ({ id: item.id, name: item.name, desc: item.desc || '' }));
  const relicCount = CATALOG.filter(item => item.relic && Number(owned[item.id]) > 0).length;
  const n = key => Math.max(0, Number(profile?.[key]) || 0);
  return {
    name: profile?.name || 'LITTLE HERO',
    online,
    cosmetics: pub,
    card: card && card.kind === 'card' && Number(owned[card.id]) > 0 ? card.id : null,
    showcase,
    relicCount,
    relicTotal: CATALOG.filter(item => item.relic).length,
    since: typeof profile?.createdAt === 'string' ? profile.createdAt : null,
    stats: {
      lifetimeScore: n('lifetimeScore'),
      gamesPlayed: n('gamesPlayed'),
      gamesWon: n('gamesWon'),
      columnSolutions: n('columnSolutions'),
      finalSolutions: n('finalSolutions'),
      bestColumnStreak: n('bestColumnStreak'),
      threefoldWins: n('threefoldWins')
    }
  };
}

// What other players see: equipped cosmetics only, resolved to safe tokens.
function publicCosmetics(profile) {
  const equipped = profile?.cosmetics?.equipped || {};
  const owned = profile?.cosmetics?.owned || {};
  const out = {};
  for (const slot of SLOT_KINDS) {
    const item = getItem(equipped[slot]);
    if (slot === 'card') continue; // dossier-only
    if (!item || item.kind !== slot || !(Number(owned[item.id]) > 0)) continue;
    if (slot === 'title') out.title = item.name;
    else out[slot] = item.id;
    if (slot === 'effect') out.effectTier = Math.min(tierCount(item), Number(owned[item.id]) || 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SHADOW ROULETTE -- 13 pockets, 0-12. 0 is the house number: it beats every
// bet except a straight bet on 0. Payouts are "N:1": a win returns the stake
// plus stake * N. Rewards are only ever Shadow Coin.
const ROULETTE_POCKETS = 13;
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12]);
const ROULETTE_MIN_WAGER = 0.1;
const ROULETTE_MAX_WAGER = 10;
const ROULETTE_CONFIRM_ABOVE = 5; // wagers above this need an explicit confirm
const ROULETTE_TRIOS = Object.freeze([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
const ROULETTE_QUADS = Object.freeze([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]);
const ROULETTE_PAYOUTS = Object.freeze({ number: 12, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, trio: 3, quad: 2 });

function rouletteColor(n) {
  if (n === 0) return 'zero';
  return ROULETTE_RED.has(n) ? 'red' : 'black';
}

// Validates a client bet. Returns { bet } or { error }.
function parseRouletteBet(raw) {
  const type = String(raw?.type || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ROULETTE_PAYOUTS, type)) return { error: 'Unknown bet' };
  const value = Number(raw?.value);
  if (type === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 12) return { error: 'Pick a number from 0 to 12' };
    return { bet: { type, value } };
  }
  if (type === 'trio') {
    if (!Number.isInteger(value) || value < 0 || value >= ROULETTE_TRIOS.length) return { error: 'Pick a 3-number group' };
    return { bet: { type, value } };
  }
  if (type === 'quad') {
    if (!Number.isInteger(value) || value < 0 || value >= ROULETTE_QUADS.length) return { error: 'Pick a 4-number group' };
    return { bet: { type, value } };
  }
  return { bet: { type } };
}

function betCovers(bet, n) {
  switch (bet.type) {
    case 'number': return n === bet.value;
    case 'trio': return ROULETTE_TRIOS[bet.value].includes(n);
    case 'quad': return ROULETTE_QUADS[bet.value].includes(n);
    case 'red': return n !== 0 && ROULETTE_RED.has(n);
    case 'black': return n !== 0 && !ROULETTE_RED.has(n);
    case 'odd': return n !== 0 && n % 2 === 1;
    case 'even': return n !== 0 && n % 2 === 0;
    case 'low': return n >= 1 && n <= 6;
    case 'high': return n >= 7 && n <= 12;
    default: return false;
  }
}

function betLabel(bet) {
  if (bet.type === 'number') return `NUMBER ${bet.value}`;
  if (bet.type === 'trio') return `GROUP ${ROULETTE_TRIOS[bet.value].join('-')}`;
  if (bet.type === 'quad') return `GROUP ${ROULETTE_QUADS[bet.value].join('-')}`;
  if (bet.type === 'low') return 'LOW 1-6';
  if (bet.type === 'high') return 'HIGH 7-12';
  return bet.type.toUpperCase();
}

const ROULETTE_WIN_LINES = Object.freeze([
  'THE SHADOW PROVIDES.',
  'THE WHEEL REMEMBERS YOUR NAME. FOR NOW.',
  'A GIFT. DO NOT GET USED TO IT.',
  'THE BROKER ALLOWS IT.'
]);
const ROULETTE_LOSS_LINES = Object.freeze([
  'THE SHADOW TAKES.',
  'NOTED. COLLECTED. FORGOTTEN.',
  'THE WHEEL WAS NEVER YOUR FRIEND.',
  'CONTRIBUTION RECEIVED.'
]);
const ROULETTE_ZERO_LINE = 'THE HOUSE REMEMBERS.';

// Pure resolution given a pocket; the server supplies the pocket from
// crypto.randomInt so tests can drive exact outcomes.
function resolveRoulette(bet, pocket, pickLine = list => list[0]) {
  const won = betCovers(bet, pocket);
  const odds = ROULETTE_PAYOUTS[bet.type];
  const line = won ? pickLine(ROULETTE_WIN_LINES) : pocket === 0 ? ROULETTE_ZERO_LINE : pickLine(ROULETTE_LOSS_LINES);
  return { pocket, color: rouletteColor(pocket), won, odds, line, label: betLabel(bet) };
}

function rouletteRules() {
  return {
    pockets: ROULETTE_POCKETS,
    red: Array.from(ROULETTE_RED),
    minWager: ROULETTE_MIN_WAGER,
    maxWager: ROULETTE_MAX_WAGER,
    confirmAbove: ROULETTE_CONFIRM_ABOVE,
    payouts: ROULETTE_PAYOUTS,
    trios: ROULETTE_TRIOS,
    quads: ROULETTE_QUADS
  };
}

module.exports = {
  SLOT_KINDS,
  CATALOG,
  COMMAND_ITEMS,
  getItem,
  tierCount,
  nextPrice,
  requirementMet,
  catalogFor,
  publicCosmetics,
  dossierFor,
  isShowcaseable,
  showcaseSlots,
  ROULETTE_MAX_WAGER,
  ROULETTE_MIN_WAGER,
  ROULETTE_CONFIRM_ABOVE,
  ROULETTE_PAYOUTS,
  parseRouletteBet,
  betCovers,
  resolveRoulette,
  rouletteRules,
  rouletteColor
};
