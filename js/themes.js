// Load the shared procedural audio engine synchronously on surfaces that do
// not include it explicitly (notably join.html). themes.js is parser-loaded,
// so document.write inserts audio.js before the following game scripts run.
if (!window.AsocAudio && document.readyState === 'loading') {
  document.write('<script src="js/audio.js"><\\/script>');
}

/* ASOC Little Hero theme registry.
 * Themes may style surrounding UI BACKGROUND surfaces only.
 * They must never recolor the authored game-board artwork or board elements.
 * LOCKED LINEUP: 01 SKYNET / 02 SUGARCOAT / 03 VERDANTIS /
 * 04 MY SINDRAGOSA / 05 DISCO INFERNO / 06 OUR THEME /
 * 07 THE UNDERCITY / 08 REVAN.
 */
const ASOCThemes = {
  DEFAULT_ID: 'gunmetal',
  presets: {
    gunmetal: {
      id: 'gunmetal',
      code: '01',
      name: 'SKYNET',
      subtitle: 'MACHINERY OF OPPRESSION // COLD STEEL',
      color: '#343A42',
      shellTop: '#11161C',
      shellBottom: '#07090C',
      railTop: '#151A20',
      railBottom: '#080A0D',
      statusTop: '#171C22',
      statusBottom: '#0A0D11',
      messageTop: '#151A20',
      messageBottom: '#0C0F13',
      bannerAccent: '#B92323',
      bannerGlow: 'rgba(185,35,35,.24)',
      borderAccent: '#687481',
      ambientStrength: 'rgba(126,139,151,.055)',
      ambient: 'rgba(126,139,151,.07)'
    },
    'pink-protocol': {
      id: 'pink-protocol',
      code: '02',
      name: 'SUGARCOAT',
      subtitle: 'SWEET VIOLENCE // PINK CIRCUITS',
      color: '#E06AB1',
      shellTop: '#1A1018',
      shellBottom: '#09070A',
      railTop: '#24131F',
      railBottom: '#100A0F',
      statusTop: '#2B1825',
      statusBottom: '#110A10',
      messageTop: '#311828',
      messageBottom: '#140B12',
      bannerAccent: '#FF8ACA',
      bannerGlow: 'rgba(224,106,177,.28)',
      borderAccent: '#9B5E80',
      ambientStrength: 'rgba(224,106,177,.065)',
      ambient: 'rgba(224,106,177,.14)'
    },
    verdantis: {
      id: 'verdantis',
      code: '03',
      name: 'VERDANTIS',
      subtitle: 'WILD SIGNAL // LIVING CIRCUITS',
      color: '#5FAF63',
      shellTop: '#101812',
      shellBottom: '#070B08',
      railTop: '#142018',
      railBottom: '#09100B',
      statusTop: '#18261B',
      statusBottom: '#0A110C',
      messageTop: '#19301E',
      messageBottom: '#0B150E',
      bannerAccent: '#9DE15D',
      bannerGlow: 'rgba(117,205,91,.30)',
      borderAccent: '#5D8057',
      ambientStrength: 'rgba(95,175,99,.075)',
      ambient: 'rgba(95,175,99,.13)'
    },
    'my-sindragosa': {
      id: 'my-sindragosa',
      code: '04',
      name: 'MY SINDRAGOSA',
      subtitle: 'FROZEN SIGNAL // GLACIAL CIRCUITS',
      color: '#79C8F2',
      shellTop: '#0F1820',
      shellBottom: '#070B0F',
      railTop: '#14222C',
      railBottom: '#091116',
      statusTop: '#182934',
      statusBottom: '#0A1218',
      messageTop: '#173142',
      messageBottom: '#0B1720',
      bannerAccent: '#B8E9FF',
      bannerGlow: 'rgba(121,200,242,.30)',
      borderAccent: '#648DA3',
      ambientStrength: 'rgba(121,200,242,.075)',
      ambient: 'rgba(121,200,242,.15)'
    },
    'disco-inferno': {
      id: 'disco-inferno',
      code: '05',
      name: 'DISCO INFERNO',
      subtitle: 'BURN SIGNAL // MOLTEN CIRCUITS',
      color: '#F06A2A',
      shellTop: '#1D120D',
      shellBottom: '#0A0706',
      railTop: '#27160F',
      railBottom: '#110A07',
      statusTop: '#311A11',
      statusBottom: '#130B08',
      messageTop: '#3A1B0F',
      messageBottom: '#180C08',
      bannerAccent: '#FF9B4A',
      bannerGlow: 'rgba(240,106,42,.30)',
      borderAccent: '#9A5B36',
      ambientStrength: 'rgba(240,106,42,.07)',
      ambient: 'rgba(240,106,42,.16)'
    },
    'our-theme': {
      id: 'our-theme',
      code: '06',
      name: 'OUR THEME',
      subtitle: 'RED STANDARD // SOVIET STEEL',
      color: '#B92522',
      shellTop: '#1D0F0F',
      shellBottom: '#090606',
      railTop: '#271211',
      railBottom: '#110908',
      statusTop: '#321514',
      statusBottom: '#140A09',
      messageTop: '#381716',
      messageBottom: '#180B0A',
      bannerAccent: '#D6B54E',
      bannerGlow: 'rgba(185,37,34,.28)',
      borderAccent: '#8A4B42',
      ambientStrength: 'rgba(185,37,34,.065)',
      ambient: 'rgba(185,37,34,.16)'
    },
    undead: {
      id: 'undead',
      code: '07',
      name: 'THE UNDERCITY',
      subtitle: 'PLAGUE SIGNAL // TOXIC CATACOMBS',
      color: '#7FBF3F',
      shellTop: '#141715',
      shellBottom: '#080908',
      railTop: '#1B201B',
      railBottom: '#0B0D0B',
      statusTop: '#222723',
      statusBottom: '#0D100D',
      messageTop: '#252D24',
      messageBottom: '#101310',
      bannerAccent: '#A9D84F',
      bannerGlow: 'rgba(127,191,63,.30)',
      borderAccent: '#718259',
      ambientStrength: 'rgba(127,191,63,.07)',
      ambient: 'rgba(127,191,63,.16)'
    },
    revan: {
      id: 'revan',
      code: '08',
      name: 'REVAN',
      subtitle: 'CRIMSON VIOLET // SIGNATURE CIRCUITS',
      color: '#A8328A',
      shellTop: '#1B0D18',
      shellBottom: '#09060A',
      railTop: '#24101E',
      railBottom: '#0F080D',
      statusTop: '#2B1224',
      statusBottom: '#110910',
      messageTop: '#341127',
      messageBottom: '#160914',
      bannerAccent: '#D44973',
      bannerGlow: 'rgba(168,50,138,.30)',
      borderAccent: '#864875',
      ambientStrength: 'rgba(168,50,138,.07)',
      ambient: 'rgba(180,42,95,.17)'
    }
  },

  get(id) {
    return this.presets[id] || this.presets[this.DEFAULT_ID];
  },

  applyToScreen(element, id) {
    if (!element) return;
    const theme = this.get(id);
    element.dataset.playerTheme = theme.id;
    element.style.setProperty('--player-theme', theme.color);
    element.style.setProperty('--theme-shell-top', theme.shellTop);
    element.style.setProperty('--theme-shell-bottom', theme.shellBottom);
    element.style.setProperty('--theme-rail-top', theme.railTop);
    element.style.setProperty('--theme-rail-bottom', theme.railBottom);
    element.style.setProperty('--theme-status-top', theme.statusTop);
    element.style.setProperty('--theme-status-bottom', theme.statusBottom);
    element.style.setProperty('--theme-message-top', theme.messageTop);
    element.style.setProperty('--theme-message-bottom', theme.messageBottom);
    element.style.setProperty('--theme-ambient', theme.ambient || 'rgba(126,139,151,.07)');
  },

  messageStyle(id) {
    const theme = this.get(id);
    return `--little-hero-theme:${theme.color};--theme-message-top:${theme.messageTop};--theme-message-bottom:${theme.messageBottom};`;
  }
};

window.ASOCThemes = ASOCThemes;
