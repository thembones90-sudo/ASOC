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
    telemetry.innerHTML = '<span><small>ROOM</small><b id="backdoor-room">LOCAL</b></span><span><small>HEROES</small><b id="backdoor-heroes">0</b></span><span><small>GAME STATE</small><b id="backdoor-state">STANDBY</b></span><span><small>REVISION</small><b id="backdoor-revision">0</b></span><span><small>LINK</small><b id="backdoor-link">OFFLINE</b></span><span><small>BUILD</small><b id="backdoor-build">UNKNOWN</b></span>';
    maintenance.appendChild(telemetry);

    const primaryGrid = document.createElement('div');
    primaryGrid.className = 'gm-backdoor-primary-grid';
    maintenance.appendChild(primaryGrid);
    const panels = document.createElement('div');
    panels.className = 'gm-backdoor-panels';
    panels.dataset.active = 'log';
    maintenance.appendChild(panels);
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
    const animationControl = document.createElement('label');
    animationControl.className = 'gm-battle-animation-control';
    animationControl.innerHTML = '<span>BATTLE MODE ANIMATION</span><select id="gm-battle-animation-select" aria-label="Battle Mode animation"></select><small>SERVER-SYNCHRONIZED // APPLIES ON NEXT BATTLE ENTRY</small>';
    const animationSelect = animationControl.querySelector('select');
    const presets = window.BattleAnimations?.list?.() || [{ id:'default', name:'DEFAULT' }, { id:'glitch-world', name:'GLITCH WORLD' }];
    animationSelect.innerHTML = presets.map(preset => `<option value="${preset.id}">${preset.name}</option>`).join('');
    animationSelect.addEventListener('change', () => this.app?.send?.({ type:'gm:setBattleAnimation', id:animationSelect.value }));
    appearance.appendChild(animationControl);
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
    panels.appendChild(log);

    const diagnostics = document.createElement('section');
    diagnostics.className = 'gm-runtime-diagnostics';
    diagnostics.innerHTML = '<div class="gm-backdoor-log-head"><strong>RUNTIME DIAGNOSTICS</strong><span>SOCKET · ERRORS · STALE STATE · EFFECT QUEUE</span></div><div class="gm-runtime-diagnostics-summary" id="gm-runtime-diagnostics-summary"></div><div class="gm-runtime-diagnostics-events" id="gm-runtime-diagnostics-events"><p>NO RUNTIME FAULTS RECORDED</p></div>';
    panels.appendChild(diagnostics);
    window.addEventListener('asoc:diagnostic', () => this.refreshDiagnostics());

    const realmAudit = document.createElement('section');
    realmAudit.className = 'gm-shadow-realm-audit';
    realmAudit.innerHTML = '<div class="gm-backdoor-log-head"><strong>SHADOW REALM LEDGER</strong><span>SENTENCES // RELEASES // RETURNS</span></div><div id="gm-shadow-realm-history" class="gm-shadow-realm-history"><p>NO SENTENCES RECORDED</p></div>';
    panels.appendChild(realmAudit);

    const records = makeModule('RECOUNT // RESULTS LEDGER', panels);
    records.id = 'records-section';
    records.classList.add('gm-records-section');
    let allTimeButton = document.getElementById('alltime-toggle-btn');
    let allTimePanel = document.getElementById('alltime-leaderboard');
    if (!allTimeButton) {
      allTimeButton = document.createElement('button');
      allTimeButton.type = 'button';
      allTimeButton.id = 'alltime-toggle-btn';
      allTimeButton.className = 'gm-global-btn gm-alltime-standings-btn';
      allTimeButton.textContent = 'ALL TIME STANDINGS';
    }
    if (!allTimePanel) {
      allTimePanel = document.createElement('div');
      allTimePanel.id = 'alltime-leaderboard';
      allTimePanel.className = 'alltime-leaderboard';
      allTimePanel.style.display = 'none';
    }
    records.appendChild(allTimeButton);
    records.appendChild(allTimePanel);
    const recountLedger = document.createElement('div');
    recountLedger.id = 'gm-recount-ledger';
    recountLedger.className = 'recount-ledger recount-ledger-gm';
    records.appendChild(recountLedger);
    window.RecountLedger?.mount(recountLedger, payload => this.app?.send?.(payload));

    // The four read-only panels share one tabbed pane so the console fits a
    // single screen instead of stacking four full-width blocks.
    const tabDefs = [
      ['log', 'EVENT LOG', 'LIVE // LOCAL AUDIT', log],
      ['diag', 'DIAGNOSTICS', 'SOCKET · ERRORS · STALE STATE · EFFECT QUEUE', diagnostics],
      ['realm', 'SHADOW REALM', 'SENTENCES // RELEASES // RETURNS', realmAudit],
      ['recount', 'RECOUNT', 'COMPLETED MATCH SCOREBOARDS', records]
    ];
    const tabBar = document.createElement('nav');
    tabBar.className = 'gm-backdoor-tabs';
    tabBar.setAttribute('role', 'tablist');
    tabBar.innerHTML = tabDefs.map(([key, label]) => `<button type="button" role="tab" data-bd-tab-btn="${key}">${label}</button>` ).join('') + '<em class="gm-backdoor-tab-hint"></em>';
    panels.insertBefore(tabBar, panels.firstChild);
    tabDefs.forEach(([key, , , section]) => { section.dataset.bdTab = key; });
    const selectTab = key => {
      const def = tabDefs.find(item => item[0] === key) || tabDefs[0];
      panels.dataset.active = def[0];
      tabBar.querySelectorAll('[data-bd-tab-btn]').forEach(button => {
        const on = button.dataset.bdTabBtn === def[0];
        button.classList.toggle('active', on);
        button.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      tabBar.querySelector('.gm-backdoor-tab-hint').textContent = def[2];
    };
    tabBar.addEventListener('click', event => {
      const button = event.target.closest('[data-bd-tab-btn]');
      if (button) selectTab(button.dataset.bdTabBtn);
    });
    selectTab('log');

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
    recovery.appendChild(layoutReset);

    const safeMode = document.createElement('button');
    safeMode.type = 'button';
    safeMode.id = 'gm-safe-mode-btn';
    safeMode.className = 'gm-global-btn gm-safe-mode-btn';
    safeMode.addEventListener('click', () => {
      const enabled = window.AsocRuntime?.setSafeMode?.(!window.AsocRuntime?.safeMode?.());
      if (enabled) window.AsocRuntime?.effects?.clear?.();
      this.refreshDiagnostics();
    });
    recovery.appendChild(safeMode);

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
      footerButton.innerHTML = '<span class="backdoor-action-icon" aria-hidden="true">⌁</span><span>BACKDOOR</span>';
      footerButton.classList.add('maintenance-toggle-btn');
    }

    // Utility and system controls intentionally remain direct children of the
    // battle panel. AMUSE pins those two docks to the bottom of the command rail;
    // moving them into the primary grid makes the direct-child layout rules miss.

    maintenance.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.classList.contains('gm-backdoor-return') || button.closest('.gm-backdoor-tabs')) return;
      const label = String(button.textContent || button.getAttribute('aria-label') || 'CONTROL').trim().replace(/\s+/g, ' ');
      this.recordEvent(`${label} // COMMAND ISSUED`);
    });
    advanced.addEventListener('toggle', () => this.recordEvent(advanced.open ? 'SEALED SYSTEMS // OPENED' : 'SEALED SYSTEMS // CLOSED'));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !maintenance.hidden) this.setOpen(false);
    });
    this.recordEvent('OPERATOR CONSOLE // READY');
    this.updateSessionSummary();
    this.refreshBuildIdentity();
    this.refreshDiagnostics();
  },

  recordEvent(message) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.eventLog.unshift({ time, message });
    this.eventLog = this.eventLog.slice(0, 40);
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
      footerButton.innerHTML = `<span class="backdoor-action-icon" aria-hidden="true">${open ? '↩' : '⌁'}</span><span>${open ? 'RETURN TO BATTLE' : 'BACKDOOR'}</span>`;
      footerButton.classList.toggle('active', !!open);
    }
    if (open) {
      this.updateSessionSummary();
      this.recordEvent('BACKDOOR // ACCESS GRANTED');
      this.app?.send?.({ type:'gm:shadowRealmHistory' });
      window.RecountLedger?.refresh?.();
      this.refreshBuildIdentity();
      this.refreshDiagnostics();
    }
    const scroll = document.querySelector('.gm-content');
    if (scroll) scroll.scrollTop = 0;
  },

  toggle() { this.setOpen(!!document.getElementById('gm-maintenance')?.hidden); },

  async refreshBuildIdentity() {
    const node = document.getElementById('backdoor-build');
    if (!node) return;
    try {
      const response = await fetch(`/api/build?t=${Date.now()}`, { cache: 'no-store' });
      const build = response.ok ? await response.json() : null;
      node.textContent = String(build?.buildId || 'UNKNOWN').slice(0, 12).toUpperCase();
      node.title = build ? `${build.buildId || ''} // ${build.startedAt || ''}` : '';
    } catch (_) { node.textContent = 'UNREACHABLE'; }
  },

  refreshDiagnostics() {
    const snapshot = window.AsocRuntime?.snapshot?.() || { events: [], queuedEffects: [] };
    const summary = document.getElementById('gm-runtime-diagnostics-summary');
    const events = document.getElementById('gm-runtime-diagnostics-events');
    const safeButton = document.getElementById('gm-safe-mode-btn');
    if (safeButton) {
      safeButton.textContent = snapshot.safeMode ? 'DISABLE SAFE MODE' : 'ENABLE SAFE MODE';
      safeButton.classList.toggle('active', !!snapshot.safeMode);
    }
    if (summary) summary.innerHTML = `<span><small>SAFE MODE</small><b>${snapshot.safeMode ? 'ON' : 'OFF'}</b></span><span><small>ACTIVE EFFECT</small><b>${this.escape(snapshot.activeEffect?.name || 'NONE')}</b></span><span><small>QUEUED</small><b>${snapshot.queuedEffects?.length || 0}</b></span><span><small>NETWORK</small><b>${snapshot.online ? 'ONLINE' : 'OFFLINE'}</b></span>`;
    if (events) events.innerHTML = snapshot.events?.length
      ? snapshot.events.slice(0, 20).map(entry => `<div><time>${new Date(entry.at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}</time><b>${this.escape(entry.kind)}</b><span>${this.escape(entry.message)}${entry.detail ? ` // ${this.escape(entry.detail)}` : ''}</span></div>`).join('')
      : '<p>NO RUNTIME FAULTS RECORDED</p>';
  },

  updateShadowRealmHistory(entries = [], now = Date.now()) {
    const node = document.getElementById('gm-shadow-realm-history');
    if (!node) return;
    if (!entries.length) { node.innerHTML='<p>NO SENTENCES RECORDED</p>'; return; }
    node.innerHTML = entries.slice(0, 30).map(entry => {
      const active = entry.status === 'BANISHED' && Number(entry.at)+Number(entry.durationMs) > Number(now);
      const status = active ? 'ACTIVE' : entry.status === 'RELEASED' ? 'RELEASED' : 'SERVED';
      const date = new Date(Number(entry.at)||Date.now()).toLocaleString([], { month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      return `<article class="is-${status.toLowerCase()}"><div><b>${this.escape(entry.playerName||'LITTLE HERO')}</b><span>${status} // OFFENSE ${Number(entry.offenseCount)||1}</span></div><p>${this.escape(entry.announcement||'')}</p><small>${date} // ${Math.round(Number(entry.durationMs||0)/1000)}S // MESSAGE ${this.escape(entry.messageId||'—')}</small></article>`;
    }).join('');
  },

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
      'backdoor-revision': String(Number(app.state?.revision ?? app.revision ?? 0) || 0),
      'backdoor-link': app.ws?.readyState === 1 ? 'STABLE' : 'OFFLINE',
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
    const animationSelect = document.getElementById('gm-battle-animation-select');
    if (animationSelect && animationSelect.value !== (app.battleAnimationId || 'default')) animationSelect.value = app.battleAnimationId || 'default';
  }
};

window.ControlSurfaces = ControlSurfaces;
