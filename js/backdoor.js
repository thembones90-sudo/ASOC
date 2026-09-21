const ControlSurfaces = {
  app: null,

  init(app) {
    this.app = app;
    const content = document.querySelector('.gm-content');
    if (!content || document.getElementById('gm-maintenance')) return;

    const game = content.querySelector('.gm-module-game');
    const clues = content.querySelector('.gm-module-clues');
    const womf = content.querySelector('.gm-module-womf');
    const global = content.querySelector('.gm-module-global');
    const background = content.querySelector('.gm-module-background');
    const chat = content.querySelector('.gm-module-chat');
    const chatHeightSplitter = content.querySelector('#gm-chat-height-splitter');
    const clueHeightSplitter = content.querySelector('#gm-clue-height-splitter');
    const scoring = content.querySelector('.gm-module-scoring');
    const multiplayer = content.querySelector('.gm-module-multiplayer');

    const battle = document.createElement('div');
    battle.id = 'gm-battle-control';
    battle.className = 'gm-control-surface gm-battle-control';
    content.insertBefore(battle, content.firstChild);
    [chat, chatHeightSplitter, clues, clueHeightSplitter, womf, scoring, global].forEach(section => {
      if (section) battle.appendChild(section);
    });

    if (game) {
      const title = game.querySelector('.gm-section-title');
      if (title) title.textContent = 'Game Setup';
      const strip = document.createElement('div');
      strip.id = 'battle-session-strip';
      strip.className = 'battle-session-strip';
      strip.innerHTML =
        '<span id="battle-session-mode">LOCAL</span>' +
        '<span id="battle-session-room" style="display:none;">ROOM <b id="battle-session-code">—</b></span>' +
        '<span id="battle-session-heroes" style="display:none;"><b id="battle-session-player-count">0</b> HEROES</span>';
      game.appendChild(strip);
    }

    if (womf) {
      const title = womf.querySelector('.gm-section-title');
      if (title) title.textContent = 'WOMF Commands';
    }

    if (scoring) {
      const title = scoring.querySelector('.gm-section-title');
      if (title) title.textContent = 'Session';
    }

    if (global) {
      const title = global.querySelector('.gm-section-title');
      if (title) title.textContent = 'Live Action';
    }

    const maintenance = document.createElement('div');
    maintenance.id = 'gm-maintenance';
    maintenance.className = 'gm-control-surface gm-maintenance';
    maintenance.hidden = true;
    content.appendChild(maintenance);

    const makeModule = (titleText) => {
      const section = document.createElement('section');
      section.className = 'gm-section gm-module maintenance-module';
      const title = document.createElement('h3');
      title.className = 'gm-section-title';
      title.textContent = titleText;
      section.appendChild(title);
      maintenance.appendChild(section);
      return section;
    };

    if (game) {
      game.classList.add('maintenance-module');
      maintenance.appendChild(game);
      const nextGame = document.getElementById('next-game-btn');
      if (nextGame) {
        nextGame.style.width = '100%';
        nextGame.style.marginTop = '12px';
        game.appendChild(nextGame);
      }
    }

    const layoutMaintenance = makeModule('Interface Layout');
    layoutMaintenance.classList.add('gm-layout-maintenance');

    const layoutStatus = document.createElement('div');
    layoutStatus.id = 'gm-layout-lock-status';
    layoutStatus.className = 'gm-layout-lock-status';
    layoutMaintenance.appendChild(layoutStatus);

    const layoutControls = document.createElement('div');
    layoutControls.className = 'gm-global-controls gm-layout-maintenance-controls';
    layoutControls.style.gridTemplateColumns = '1fr 1fr';

    const layoutLock = document.createElement('button');
    layoutLock.type = 'button';
    layoutLock.id = 'gm-layout-lock-btn';
    layoutLock.className = 'gm-global-btn gm-layout-lock-btn';
    layoutLock.setAttribute('aria-pressed', 'false');
    layoutLock.addEventListener('click', () => this.app?.toggleGMLayoutLock?.());

    const layoutReset = document.createElement('button');
    layoutReset.type = 'button';
    layoutReset.id = 'gm-layout-reset-btn';
    layoutReset.className = 'gm-global-btn reset-btn gm-layout-reset-btn';
    layoutReset.textContent = 'RESET PANEL LAYOUT';
    layoutReset.addEventListener('click', () => {
      const confirmed = confirm('Reset GM panel width, Battle Chat height, and Clue Grid height to defaults?');
      if (!confirmed) return;
      this.app?.resetGMPanelLayout?.();
    });

    layoutControls.appendChild(layoutLock);
    layoutControls.appendChild(layoutReset);
    layoutMaintenance.appendChild(layoutControls);
    this.app?.syncGMLayoutLockUI?.();

    const boardMaintenance = makeModule('Board Maintenance');
    const undo = document.getElementById('undo-btn');
    const resetBoard = document.getElementById('reset-board-btn');
    const revealAll = document.getElementById('reveal-hide-all-btn');
    const boardGrid = undo?.parentElement;
    if (boardGrid && boardGrid.contains(resetBoard)) boardMaintenance.appendChild(boardGrid);
    if (revealAll) {
      revealAll.style.width = '100%';
      revealAll.style.marginTop = '8px';
      boardMaintenance.appendChild(revealAll);
    }

    if (background) {
      const title = background.querySelector('.gm-section-title');
      if (title) title.textContent = 'Visual Systems';
      background.classList.add('maintenance-module');
      maintenance.appendChild(background);
    }

    const womfMaintenance = makeModule('WOMF Maintenance');
    const womfReset = document.getElementById('womf-reset-btn');
    if (womfReset) {
      const oldParent = womfReset.parentElement;
      womfReset.style.width = '100%';
      womfMaintenance.appendChild(womfReset);
      if (oldParent) oldParent.style.gridTemplateColumns = '1fr';
    }

    if (multiplayer) {
      const title = multiplayer.querySelector('.gm-section-title');
      if (title) title.textContent = 'Multiplayer Administration';
      multiplayer.classList.add('maintenance-module');
      maintenance.appendChild(multiplayer);
    }

    const records = makeModule('Records');
    records.id = 'records-section';
    records.style.display = 'none';
    const allTimeButton = document.getElementById('alltime-toggle-btn');
    const allTimePanel = document.getElementById('alltime-leaderboard');
    if (allTimeButton) {
      allTimeButton.style.width = '100%';
      allTimeButton.style.marginTop = '0';
      records.appendChild(allTimeButton);
    }
    if (allTimePanel) records.appendChild(allTimePanel);

    if (global) {
      const nema = document.getElementById('nema-asoc-btn');
      const controls = Array.from(global.querySelectorAll('.gm-global-controls'));
      controls.forEach(group => {
        if (!group.children.length) group.remove();
        else group.style.gridTemplateColumns = '1fr';
      });
      if (nema) nema.style.width = '100%';
    }

    const footerButton = document.getElementById('library-btn-footer');
    if (footerButton) {
      footerButton.textContent = 'BACKDOOR';
      footerButton.classList.add('maintenance-toggle-btn');
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !maintenance.hidden) this.setOpen(false);
    });

    this.updateSessionSummary();
  },

  setOpen(open) {
    const battle = document.getElementById('gm-battle-control');
    const maintenance = document.getElementById('gm-maintenance');
    const footerButton = document.getElementById('library-btn-footer');
    if (!battle || !maintenance) return;

    battle.hidden = !!open;
    maintenance.hidden = !open;
    document.getElementById('gm-panel')?.classList.toggle('maintenance-open', !!open);

    if (footerButton) {
      footerButton.textContent = open ? 'RETURN TO BATTLE' : 'BACKDOOR';
      footerButton.classList.toggle('active', !!open);
    }

    const scroll = document.querySelector('.gm-content');
    if (scroll) scroll.scrollTop = 0;
  },

  toggle() {
    const maintenance = document.getElementById('gm-maintenance');
    this.setOpen(!!maintenance?.hidden);
  },

  updateSessionSummary() {
    const app = this.app;
    if (!app) return;
    const multiplayer = app.mode === 'multiplayer';
    const mode = document.getElementById('battle-session-mode');
    const room = document.getElementById('battle-session-room');
    const code = document.getElementById('battle-session-code');
    const heroes = document.getElementById('battle-session-heroes');
    const count = document.getElementById('battle-session-player-count');

    if (mode) mode.textContent = multiplayer ? 'MULTIPLAYER' : 'LOCAL';
    if (room) room.style.display = multiplayer ? 'inline' : 'none';
    if (code) code.textContent = multiplayer ? 'MASTER ROOM' : '—';
    if (heroes) heroes.style.display = multiplayer ? 'inline' : 'none';
    if (count) count.textContent = String((app.currentPlayers || []).length);
  }
};

window.ControlSurfaces = ControlSurfaces;
