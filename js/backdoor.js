const ControlSurfaces = {
  app: null,
  eventLog: [],

  init(app) {
    this.app = app;
    const content = document.querySelector('.gm-content');
    if (!content || document.getElementById('gm-maintenance')) return;
    const game = content.querySelector('.gm-module-game');
    const womf = content.querySelector('.gm-module-womf');
    const global = content.querySelector('.gm-module-global');
    const background = content.querySelector('.gm-module-background');
    const chat = content.querySelector('.gm-module-chat');
    const chatHeightSplitter = content.querySelector('#gm-chat-height-splitter');
    const scoring = content.querySelector('.gm-module-scoring');
    const multiplayer = content.querySelector('.gm-module-multiplayer');
    const tributeVault = content.querySelector('.gm-module-tribute-vault');

    const battle = document.createElement('div');
    battle.id = 'gm-battle-control';
    battle.className = 'gm-control-surface gm-battle-control';
    content.insertBefore(battle, content.firstChild);
    [chat, chatHeightSplitter, scoring, global].forEach(section => section && battle.appendChild(section));

    if (game) {
      const title = game.querySelector('.gm-section-title');
      if (title) title.textContent = '01 // SESSION';
      const strip = document.createElement('div');
      strip.id = 'battle-session-strip';
      strip.className = 'battle-session-strip';
      strip.innerHTML = '<span id="battle-session-mode">LOCAL</span><span id="battle-session-room" hidden>ROOM <b id="battle-session-code">—</b></span><span id="battle-session-heroes" hidden><b id="battle-session-player-count">0</b> HEROES</span>';
      game.appendChild(strip);
    }
    if (scoring) scoring.querySelector('.gm-section-title').textContent = 'Session';
    if (global) global.querySelector('.gm-section-title').textContent = 'Live Action';

    const maintenance = document.createElement('div');
    maintenance.id = 'gm-maintenance';
    maintenance.className = 'gm-control-surface gm-maintenance';
    maintenance.hidden = true;
    content.appendChild(maintenance);

    const header = document.createElement('header');
    header.className = 'gm-backdoor-header';
    header.innerHTML = '<div><strong>BACKDOOR // SYSTEM CONTROL</strong><span>SHADOW BROKER OPERATOR CONSOLE</span></div><button type="button" class="gm-backdoor-return">RETURN TO BATTLE</button>';
    header.querySelector('.gm-backdoor-return').addEventListener('click', () => this.setOpen(false));
    maintenance.appendChild(header);

    const telemetry = document.createElement('div');
    telemetry.className = 'gm-backdoor-telemetry';
    telemetry.innerHTML = '<span><small>ROOM</small><b id="backdoor-room">LOCAL</b></span><span><small>HEROES</small><b id="backdoor-heroes">0</b></span><span><small>GAME STATE</small><b id="backdoor-state">STANDBY</b></span><span><small>LAYOUT</small><b id="backdoor-layout">UNLOCKED</b></span>';
    maintenance.appendChild(telemetry);

    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'gm-backdoor-primary-grid';
    maintenance.appendChild(primaryGrid);
    const makeModule = (titleText, parent = maintenance) => {
      const section = document.createElement('section');
      section.className = 'gm-section gm-module maintenance-module';
      const title = document.createElement('h3');
      title.className = 'gm-section-title';
      title.textContent = titleText;
      section.appendChild(title);
      parent.appendChild(section);
      return section;
    };

    if (game) {
      game.classList.add('maintenance-module', 'gm-session-maintenance');
      primaryGrid.appendChild(game);
      const nextGame = document.getElementById('next-game-btn');
      if (nextGame) game.appendChild(nextGame);
    }

    const boardMaintenance = makeModule('02 // BOARD', primaryGrid);
    boardMaintenance.classList.add('gm-board-maintenance');
    const undo = document.getElementById('undo-btn');
    const resetBoard = document.getElementById('reset-board-btn');
    const revealAll = document.getElementById('reveal-hide-all-btn');
    const boardState = document.createElement('div');
    boardState.className = 'gm-maintenance-readout';
    boardState.innerHTML = '<small>BOARD LINK</small><strong>READY // SYNCHRONIZED</strong>';
    boardMaintenance.appendChild(boardState);
    const boardRow = document.createElement('div');
    boardRow.className = 'gm-board-control-row';
    [undo, revealAll].forEach(button => button && boardRow.appendChild(button));
    boardMaintenance.appendChild(boardRow);

    const appearance = makeModule('03 // APPEARANCE', primaryGrid);
    appearance.classList.add('gm-appearance-maintenance');
    const layoutStatus = document.createElement('div');
    layoutStatus.id = 'gm-layout-lock-status';
    layoutStatus.className = 'gm-layout-lock-status';
    appearance.appendChild(layoutStatus);
    const layoutLock = document.createElement('button');
    layoutLock.type = 'button';
    layoutLock.id = 'gm-layout-lock-btn';
    layoutLock.className = 'gm-global-btn gm-layout-lock-btn';
    layoutLock.setAttribute('aria-pressed', 'false');
    layoutLock.addEventListener('click', () => this.app?.toggleGMLayoutLock?.());
    appearance.appendChild(layoutLock);
    if (background) {
      background.querySelector('.gm-section-title')?.remove();
      background.classList.add('gm-appearance-background');
      appearance.appendChild(background);
    }
    this.app?.syncGMLayoutLockUI?.();

    const log = document.createElement('section');
    log.className = 'gm-backdoor-log';
    log.innerHTML = '<div class="gm-backdoor-log-head"><strong>SYSTEM EVENT LOG</strong><span>LIVE // LOCAL AUDIT</span></div><div id="gm-backdoor-log-entries" class="gm-backdoor-log-entries"></div>';
    maintenance.appendChild(log);

    const advanced = document.createElement('details');
    advanced.className = 'gm-advanced-maintenance';
    advanced.innerHTML = '<summary><span>⚠ SEALED SYSTEMS // DANGEROUS OPERATIONS</span><small>RECOVERY · WOMF · PLAYERS · RECORDS · VAULT</small></summary><div class="gm-advanced-maintenance-body"></div>';
    const advancedBody = advanced.querySelector('.gm-advanced-maintenance-body');
    maintenance.appendChild(advanced);

    const recovery = makeModule('Recovery / Reset', advancedBody);
    recovery.classList.add('gm-recovery-maintenance');
    const layoutReset = document.createElement('button');
    layoutReset.type = 'button';
    layoutReset.id = 'gm-layout-reset-btn';
    layoutReset.className = 'gm-global-btn reset-btn gm-layout-reset-btn';
    layoutReset.textContent = 'RESET PANEL LAYOUT';
    layoutReset.addEventListener('click', () => {
      if (!confirm('Reset GM panel width and Battle Chat height to defaults?')) return;
      this.app?.resetGMPanelLayout?.();
    });
    [resetBoard, layoutReset].forEach(button => button && recovery.appendChild(button));

    // RESET SCOREBOARD: wipes every Battle score and record, keeps Shadow Coins.
    const scoreboardReset = document.createElement('button');
    scoreboardReset.type = 'button';
    scoreboardReset.id = 'gm-scoreboard-reset-btn';
    scoreboardReset.className = 'gm-global-btn reset-btn gm-scoreboard-reset-btn';
    scoreboardReset.textContent = 'RESET SCOREBOARD';
    scoreboardReset.addEventListener('click', async () => {
      const typed = await window.AsocDialog?.prompt({
        title: 'RESET SCOREBOARD',
        message: 'Wipes every Little Hero\'s points, wins, records and the match history (RECOUNT rankings). Shadow Coins, cosmetics and relics are KEPT. A backup is saved first. Type RESET to confirm.',
        placeholder: 'RESET',
        maxLength: 5,
        required: true,
        confirmLabel: 'RESET SCOREBOARD',
        validate: value => (String(value).trim().toUpperCase() === 'RESET' ? '' : 'Type RESET to confirm')
      });
      if (!typed || String(typed).trim().toUpperCase() !== 'RESET') return;
      this.app?.send({ type: 'gm:resetScoreboard', confirm: 'RESET' });
    });
    recovery.appendChild(scoreboardReset);

    if (womf) {
      womf.querySelector('.gm-section-title').textContent = 'WOMF Intervention';
      womf.classList.add('maintenance-module');
      advancedBody.appendChild(womf);
    }
    if (tributeVault) {
      tributeVault.classList.add('maintenance-module');
      advancedBody.appendChild(tributeVault);
    }
    if (multiplayer) {
      multiplayer.querySelector('.gm-section-title').textContent = 'Player Administration';
      multiplayer.classList.add('maintenance-module');
      advancedBody.appendChild(multiplayer);
    }
    const records = makeModule('Records', advancedBody);
    records.id = 'records-section';
    records.style.display = 'none';
    const allTimeButton = document.getElementById('alltime-toggle-btn');
    const allTimePanel = document.getElementById('alltime-leaderboard');
    if (allTimeButton) records.appendChild(allTimeButton);
    if (allTimePanel) records.appendChild(allTimePanel);

    if (global) {
      const nema = document.getElementById('nema-asoc-btn');
      Array.from(global.querySelectorAll('.gm-global-controls')).forEach(group => {
        if (!group.children.length) group.remove();
        else group.style.gridTemplateColumns = '1fr';
      });
      if (nema) nema.style.width = '100%';
      if (!global.querySelector('button')) global.remove();
    }
    const footerButton = document.getElementById('library-btn-footer');
    if (footerButton) {
      footerButton.textContent = 'BACKDOOR';
      footerButton.classList.add('maintenance-toggle-btn');
    }
    maintenance.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.classList.contains('gm-backdoor-return')) return;
      const label = String(button.textContent || button.getAttribute('aria-label') || 'CONTROL').trim().replace(/\s+/g, ' ');
      this.recordEvent(`${label} // COMMAND ISSUED`);
    });
    advanced.addEventListener('toggle', () => this.recordEvent(advanced.open ? 'SEALED SYSTEMS // OPENED' : 'SEALED SYSTEMS // CLOSED'));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !maintenance.hidden) this.setOpen(false);
    });
    this.recordEvent('OPERATOR CONSOLE // READY');
    this.updateSessionSummary();
  },

  recordEvent(message) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.eventLog.unshift({ time, message });
    this.eventLog = this.eventLog.slice(0, 6);
    const entries = document.getElementById('gm-backdoor-log-entries');
    if (entries) entries.innerHTML = this.eventLog.map(entry => `<div><time>${entry.time}</time><span>${this.escape(entry.message)}</span></div>`).join('');
  },

  escape(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
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
    if (open) {
      this.updateSessionSummary();
      this.recordEvent('BACKDOOR // ACCESS GRANTED');
    }
    const scroll = document.querySelector('.gm-content');
    if (scroll) scroll.scrollTop = 0;
  },

  toggle() { this.setOpen(!!document.getElementById('gm-maintenance')?.hidden); },

  updateSessionSummary() {
    const app = this.app;
    if (!app) return;
    const multiplayer = app.mode === 'multiplayer';
    const players = (app.currentPlayers || []).filter(player => player?.connected !== false);
    const roomMode = String(app.roomMode || '').replaceAll('_', ' ') || (multiplayer ? 'ACTIVE' : 'STANDBY');
    const layoutLocked = document.body.classList.contains('gm-layout-locked');
    const values = {
      'battle-session-mode': multiplayer ? 'MULTIPLAYER' : 'LOCAL',
      'battle-session-code': multiplayer ? 'MASTER ROOM' : '—',
      'battle-session-player-count': String(players.length),
      'backdoor-room': multiplayer ? 'MASTER ROOM' : 'LOCAL',
      'backdoor-heroes': String(players.length),
      'backdoor-state': roomMode,
      'backdoor-layout': layoutLocked ? 'LOCKED' : 'UNLOCKED'
    };
    Object.entries(values).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });
    const strip = document.getElementById('battle-session-strip');
    if (strip) strip.hidden = !multiplayer;
    const room = document.getElementById('battle-session-room');
    const heroes = document.getElementById('battle-session-heroes');
    if (room) room.hidden = !multiplayer;
    if (heroes) heroes.hidden = !multiplayer;
  }
};

window.ControlSurfaces = ControlSurfaces;
