// SHADOW BROKER TRANSMOG CATALOG -- the one first-party list of Broker
// appearance sets. Loaded by the server (require) and by both pages
// (<script>), so equip validation and the wardrobe UI always agree.
//
// TRANSMOG changes appearance only. Nothing here may touch game logic: a set
// is pure presentation data (art, colours, effect names) resolved into the
// `brokerProfile` that clients paint with.
//
// Adding a set = drop art into assets/transmog/<folder>/ (see
// scripts/build-transmog-art.js) and add one entry below. Effects referenced
// by a set must exist in the effect lists here and in css/broker-transmog.css.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BrokerTransmogCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Every effect a set (or the CUSTOM forge) may use. Values are CSS hooks:
  // [data-broker-effect], [data-broker-message-effect], html[data-broker-aura].
  const AVATAR_EFFECTS = Object.freeze(['none', 'pulse', 'eclipse', 'glitch', 'inferno', 'frost', 'crown', 'warsong', 'omen', 'bloodfang', 'fel']);
  const MESSAGE_EFFECTS = Object.freeze(['none', 'void', 'blood', 'royal', 'static', 'frost', 'warsong', 'omen', 'bloodfang', 'fel']);
  const AURAS = Object.freeze(['none', 'void', 'blood', 'frost', 'warsong', 'royal', 'static', 'omen', 'bloodfang', 'fel']);
  const ENTRANCES = Object.freeze(['none', 'fade', 'shatter', 'slam', 'glitch', 'rise', 'strike', 'fel']);
  const SOUNDS = Object.freeze(['none', 'hum', 'drone', 'chime', 'horn', 'fanfare', 'static', 'toll', 'blade', 'fel']);

  // How an appearance becomes available. 'default' sets are always owned; the
  // others are owned once granted (manual, achievement, market, event,
  // seasonal, secret) -- see server.js brokerWardrobe.
  const UNLOCK_METHODS = Object.freeze(['default', 'manual', 'achievement', 'market', 'event', 'seasonal', 'secret']);

  const DEFAULT_ID = 'default-broker';
  const CUSTOM_ID = 'custom';

  const art = folder => ({ avatar: `assets/transmog/${folder}/avatar.webp`, thumb: `assets/transmog/${folder}/thumb.webp` });

  const SETS = Object.freeze([
    {
      id: 'default-broker', name: 'DEFAULT BROKER', tagline: 'The standard mechanical Shadow Broker.',
      category: 'origin', rarity: 'common', unlock: { method: 'default' }, ...art('default'),
      frameColor: '#9b5de0', accent: '#c486ef', avatarEffect: 'none', messageEffect: 'none', aura: 'none',
      entrance: 'fade', sound: 'hum', systemStyle: 'standard',
      sample: 'TRANSMISSION RECEIVED. CARRY ON, LITTLE HEROES.'
    },
    {
      id: 'void-broker', name: 'VOID BROKER', tagline: 'Dark matter in a mechanical shell.',
      category: 'elemental', rarity: 'rare', unlock: { method: 'default' }, ...art('void'),
      frameColor: '#7a2cff', accent: '#b98bff', avatarEffect: 'pulse', messageEffect: 'void', aura: 'void',
      entrance: 'rise', sound: 'drone', systemStyle: 'void',
      sample: 'THE VOID HEARD YOUR GUESS. THE VOID IS UNIMPRESSED.'
    },
    {
      id: 'blood-broker', name: 'BLOOD BROKER', tagline: 'Crimson circuitry, warm to the touch.',
      category: 'elemental', rarity: 'rare', unlock: { method: 'default' }, ...art('blood'),
      frameColor: '#e0182f', accent: '#ff6b7d', avatarEffect: 'inferno', messageEffect: 'blood', aura: 'blood',
      entrance: 'slam', sound: 'toll', systemStyle: 'blood',
      sample: 'BLOOD SIGNAL CONFIRMED. SOMEONE WILL PAY FOR THAT ANSWER.'
    },
    {
      id: 'whiteout-broker', name: 'WHITEOUT BROKER', tagline: 'Cold metal. Colder judgement.',
      category: 'elemental', rarity: 'rare', unlock: { method: 'default' }, ...art('whiteout'),
      frameColor: '#9fdcff', accent: '#e4f6ff', avatarEffect: 'frost', messageEffect: 'frost', aura: 'frost',
      entrance: 'shatter', sound: 'chime', systemStyle: 'frost',
      sample: 'WHITEOUT CONDITIONS. VISIBILITY ZERO. MERCY ALSO ZERO.'
    },
    {
      id: 'warsong-broker', name: 'WARSONG BROKER', tagline: 'Built for the battlefield, painted in it.',
      category: 'war', rarity: 'epic', unlock: { method: 'default' }, ...art('warsong'),
      frameColor: '#d4200f', accent: '#ff7a2e', avatarEffect: 'warsong', messageEffect: 'warsong', aura: 'warsong',
      entrance: 'slam', sound: 'horn', systemStyle: 'warsong',
      sample: 'THE WAR DRUMS DO NOT CARE ABOUT YOUR FEELINGS.'
    },
    {
      id: 'sovereign-broker', name: 'SOVEREIGN BROKER', tagline: 'Crowned by nobody. Obeyed by everyone.',
      category: 'royal', rarity: 'epic', unlock: { method: 'default' }, ...art('sovereign'),
      frameColor: '#f0b432', accent: '#c486ef', avatarEffect: 'crown', messageEffect: 'royal', aura: 'royal',
      entrance: 'rise', sound: 'fanfare', systemStyle: 'royal',
      sample: 'KNEEL. OR DO NOT. THE CROWN REMEMBERS EITHER WAY.'
    },
    {
      id: 'glitch-broker', name: 'GLITCH BROKER', tagline: 'Damaged transmission. Intact contempt.',
      category: 'signal', rarity: 'rare', unlock: { method: 'default' }, ...art('glitch'),
      frameColor: '#14e0c8', accent: '#ff2e72', avatarEffect: 'glitch', messageEffect: 'static', aura: 'static',
      entrance: 'glitch', sound: 'static', systemStyle: 'static',
      sample: 'S1GNAL C0RRUPT3D. Y0UR ANSW3R WAS ALS0 C0RRUPT3D.'
    },
    {
      id: 'omen-broker', name: 'OMEN BROKER', tagline: 'It saw this coming. It always does.',
      category: 'prophecy', rarity: 'epic', unlock: { method: 'default' }, ...art('omen'),
      frameColor: '#c9a050', accent: '#ffe2a0', avatarEffect: 'omen', messageEffect: 'omen', aura: 'omen',
      entrance: 'fade', sound: 'toll', systemStyle: 'omen',
      sample: 'THE EYE OPENS. IT HAS ALREADY READ YOUR NEXT MISTAKE.'
    },
    {
      id: 'bloodfang-broker', name: 'BLOODFANG', tagline: 'Elite executioner. Silent. Aristocratic. Deadly.',
      category: 'assassin', rarity: 'legendary', unlock: { method: 'default' }, ...art('bloodfang'),
      frameColor: '#8c0a1e', accent: '#ff2a48', avatarEffect: 'bloodfang', messageEffect: 'bloodfang', aura: 'bloodfang',
      entrance: 'strike', sound: 'blade', systemStyle: 'bloodfang',
      sample: 'YOU NEVER HEARD ME ENTER. YOU WILL NOT HEAR ME LEAVE.'
    },
    {
      id: 'illidan-broker', name: 'THE BETRAYER', tagline: 'Fel-scarred. Blindfolded. Not prepared to lose.',
      category: 'demonic', rarity: 'legendary', unlock: { method: 'default' }, ...art('illidan'),
      frameColor: '#3ee01f', accent: '#b6ff7a', avatarEffect: 'fel', messageEffect: 'fel', aura: 'fel',
      entrance: 'fel', sound: 'fel', systemStyle: 'fel',
      sample: 'YOU ARE NOT PREPARED. NONE OF YOU EVER ARE.'
    },
    {
      // Sealed preview of the unlock system: listed, never equippable until
      // granted. Its visuals are the default Broker on purpose.
      id: 'sealed-broker', name: 'THE SEALED ONE', tagline: 'An identity the Broker has not yet earned.',
      category: 'secret', rarity: 'mythic', unlock: { method: 'secret', hint: 'UNLOCK CONDITION UNKNOWN' }, ...art('default'),
      frameColor: '#4a4148', accent: '#8a7f88', avatarEffect: 'eclipse', messageEffect: 'none', aura: 'none',
      entrance: 'fade', sound: 'none', systemStyle: 'standard',
      sample: '???'
    }
  ].map(set => Object.freeze(set)));

  const byId = new Map(SETS.map(set => [set.id, set]));

  function get(id) { return byId.get(String(id || '')) || null; }

  // owned: Set/array of granted ids (beyond the always-owned defaults).
  function isUnlocked(id, owned) {
    const set = get(id);
    if (!set) return false;
    if (set.unlock.method === 'default') return true;
    const list = owned instanceof Set ? owned : new Set(Array.isArray(owned) ? owned.map(String) : []);
    return list.has(set.id);
  }

  // The painted profile for a set. Unknown ids resolve to DEFAULT BROKER.
  function resolveProfile(id) {
    const set = get(id) || get(DEFAULT_ID);
    return {
      transmogId: set.id,
      avatarData: set.avatar,
      frameColor: set.frameColor,
      accent: set.accent,
      avatarEffect: set.avatarEffect,
      messageEffect: set.messageEffect,
      aura: set.aura,
      entrance: set.entrance,
      sound: set.sound,
      systemStyle: set.systemStyle
    };
  }

  const pick = (list, value, fallback = 'none') => (list.includes(value) ? value : fallback);
  const HEX = /^#[0-9a-f]{6}$/i;
  const AVATAR_SRC = /^(data:image\/(?:png|jpeg|webp);base64,|\/|assets\/)/i;
  const MAX_AVATAR_CHARS = 2100000;

  // Sanitises any profile (custom forge input or a stored room profile).
  function cleanProfile(input, fallbackId = DEFAULT_ID) {
    const base = resolveProfile(fallbackId);
    const src = String(input?.avatarData || base.avatarData);
    return {
      transmogId: input?.transmogId === CUSTOM_ID ? CUSTOM_ID : (get(input?.transmogId) ? input.transmogId : base.transmogId),
      avatarData: AVATAR_SRC.test(src) && src.length <= MAX_AVATAR_CHARS ? src : base.avatarData,
      frameColor: HEX.test(String(input?.frameColor || '')) ? String(input.frameColor) : base.frameColor,
      accent: HEX.test(String(input?.accent || '')) ? String(input.accent) : (HEX.test(String(input?.frameColor || '')) ? String(input.frameColor) : base.accent),
      avatarEffect: pick(AVATAR_EFFECTS, input?.avatarEffect),
      messageEffect: pick(MESSAGE_EFFECTS, input?.messageEffect),
      aura: pick(AURAS, input?.aura),
      entrance: pick(ENTRANCES, input?.entrance, 'fade'),
      sound: pick(SOUNDS, input?.sound),
      systemStyle: typeof input?.systemStyle === 'string' && /^[a-z]{1,16}$/.test(input.systemStyle) ? input.systemStyle : 'standard'
    };
  }

  return {
    SETS, DEFAULT_ID, CUSTOM_ID, AVATAR_EFFECTS, MESSAGE_EFFECTS, AURAS, ENTRANCES, SOUNDS, UNLOCK_METHODS, MAX_AVATAR_CHARS,
    get, isUnlocked, resolveProfile, cleanProfile
  };
});
