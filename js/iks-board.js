// IKS OKS board -- the weaponized ritual board (assets/ui/iks-oks/), shared by
// the Little Hero panel (js/threefold.js) and the Shadow Broker arcade
// (js/gm-minigames.js). Game logic stays server-authoritative; this only
// renders a threefold game object.
//
// Art: board.webp is the full reference board (A:\ASOC ENGINE\Iks oks board.png
// scaled to 800px). Each of the nine cells is covered by a plate sliced from
// the same art -- plate-x (forged X), plate-o (violet ring), plate-empty (the
// O socket with its energy drained) -- placed at the plate's measured position
// on the 1254px source, so the interactive buttons sit exactly on the plates.
(() => {
  'use strict';
  const SOURCE = 1254;
  const PLATE = 218;
  const CENTER_X = [387.5, 627, 866.5];
  const CENTER_Y = [370.5, 618.5, 856.5];
  const pct = value => `${(value / SOURCE * 100).toFixed(3)}%`;
  const GRID = {
    left: CENTER_X[0] - PLATE / 2,
    top: CENTER_Y[0] - PLATE / 2,
    right: CENTER_X[2] + PLATE / 2,
    bottom: CENTER_Y[2] + PLATE / 2
  };

  // Last board seen per game, so only the newly placed mark flares and the
  // victory surge plays once (repaints from players:update never replay it).
  const lastBoards = new Map();
  const surged = new Set();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // game: threefold game object. options:
  //   cellAttr -- data attribute the host's click handler reads ("data-threefold-cell")
  //   canPlay  -- true when it is the viewer's move
  //   me       -- the viewer's mark ('X' | 'O'), tints the hover glow
  function html(game, { cellAttr = 'data-iks-cell', canPlay = false, me = '' } = {}) {
    if (!game || !Array.isArray(game.board)) return '';
    const board = game.board;
    const previous = lastBoards.get(game.id) || Array(9).fill('');
    if (lastBoards.size > 12) lastBoards.clear();
    lastBoards.set(game.id, board.slice());

    const winning = new Set(Array.isArray(game.winningLine) ? game.winningLine : []);
    const winner = game.complete && game.winnerId;
    const draw = game.complete && !game.winnerId;
    const surge = winner && !surged.has(game.id);
    if (surge) surged.add(game.id);

    const cells = board.map((mark, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const playable = !mark && canPlay && !game.complete;
      const classes = ['iks-cell',
        mark === 'X' ? 'is-x' : mark === 'O' ? 'is-o' : 'is-empty',
        playable ? 'is-playable' : '',
        mark && previous[i] !== mark ? 'is-new' : '',
        winning.has(i) ? 'is-win' : ''].filter(Boolean).join(' ');
      const style = `left:${pct(CENTER_X[col] - PLATE / 2)};top:${pct(CENTER_Y[row] - PLATE / 2)};width:${pct(PLATE)};height:${pct(PLATE)}`;
      const label = mark ? `${mark} at row ${row + 1}, column ${col + 1}` : `Empty, row ${row + 1}, column ${col + 1}`;
      return `<button type="button" class="${classes}" ${cellAttr}="${i}" style="${style}" aria-label="${label}" ${playable ? '' : 'disabled'}><span class="iks-plate" aria-hidden="true"></span><span class="iks-flare" aria-hidden="true"></span></button>`;
    }).join('');

    const line = winning.size === 3
      ? `<i class="threefold-win-line" data-line="${[...winning].join('-')}" aria-hidden="true"></i>`
      : '';
    const gridStyle = `left:${pct(GRID.left)};top:${pct(GRID.top)};width:${pct(GRID.right - GRID.left)};height:${pct(GRID.bottom - GRID.top)}`;
    const state = [winner ? 'has-winner' : '', surge ? 'is-surging' : '', draw ? 'is-draw' : '', canPlay && !game.complete ? 'is-my-turn' : ''].filter(Boolean).join(' ');
    return `<div class="iks-board ${state}" data-me="${esc(me)}" role="group" aria-label="IKS OKS board">` +
      `<img class="iks-board-frame" src="assets/ui/iks-oks/board.webp" alt="" draggable="false">` +
      cells +
      `<div class="iks-board-grid" style="${gridStyle}">${line}</div>` +
      `</div>`;
  }

  const IksBoard = { html, _reset() { lastBoards.clear(); surged.clear(); } };
  if (typeof window !== 'undefined') window.IksBoard = IksBoard;
  if (typeof module !== 'undefined' && module.exports) module.exports = IksBoard;
})();
