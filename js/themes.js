/* ASOC Little Hero theme registry.
 * Themes may style surrounding UI BACKGROUND surfaces only.
 * They must never recolor the authored game-board artwork or board elements.
 * LOCKED LINEUP: 01 SKYNET / 02 SUGARCOAT / 03 VERDANTIS /
 * 04 MY SINDRAGOSA / 05 DISCO INFERNO.
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
      ambient: 'rgba(121,200,242,.15)'
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