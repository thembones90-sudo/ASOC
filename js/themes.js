/* ASOC Little Hero theme registry.
 * Themes may style surrounding UI BACKGROUND surfaces only.
 * They must never recolor the authored game-board artwork or board elements.
 */
const ASOCThemes = {
  DEFAULT_ID: 'gunmetal',
  presets: {
    gunmetal: {
      id: 'gunmetal',
      name: 'GUNMETAL',
      subtitle: 'CLASSIC ASOC // COLD STEEL',
      color: '#343A42',
      shellTop: '#11161C',
      shellBottom: '#07090C',
      railTop: '#151A20',
      railBottom: '#080A0D',
      statusTop: '#171C22',
      statusBottom: '#0A0D11',
      messageTop: '#151A20',
      messageBottom: '#0C0F13'
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
  },

  messageStyle(id) {
    const theme = this.get(id);
    return `--little-hero-theme:${theme.color};--theme-message-top:${theme.messageTop};--theme-message-bottom:${theme.messageBottom};`;
  }
};

window.ASOCThemes = ASOCThemes;