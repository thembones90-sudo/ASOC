const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const overlay = path.join(os.tmpdir(), `asoc-forge-export-${process.pid}`);
process.env.ASOC_DATA_DIR = overlay;
const store = require('../game-store');

const game = {
  title: 'EXPORT TEST', theme: 'EXPORT TEST', difficulty: 'PURPLE', background: 'assets/backgrounds/_default.svg',
  columns: {
    A: { clues: ['A1 WORD', 'A2 WORD', 'A3 WORD', 'A4 WORD'], solution: 'A SOLUTION' },
    B: { clues: ['B1 WORD', 'B2 WORD', 'B3 WORD', 'B4 WORD'], solution: 'B SOLUTION' },
    C: { clues: ['C1 WORD', 'C2 WORD', 'C3 WORD', 'C4 WORD'], solution: 'C SOLUTION' },
    D: { clues: ['D1 WORD', 'D2 WORD', 'D3 WORD', 'D4 WORD'], solution: 'D SOLUTION' }
  },
  finalSolution: 'FINAL ANSWER', story: 'Story', gmNotes: 'Notes', cellHints: { A1: 'Prepared A1 hint' }
};

(async () => {
  try {
    fs.mkdirSync(overlay, { recursive: true });
    const saved = store.saveGame(game);
    assert.ok(saved.game?.id, 'fixture saves');
    const exported = await store.exportXlsx(saved.game.id);
    assert.ok(Buffer.isBuffer(exported.buffer) && exported.buffer.length > 1000, 'export returns a real workbook buffer');
    assert.match(exported.filename, /\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.buffer);
    const board = workbook.getWorksheet('ASOC GAME');
    const notes = workbook.getWorksheet('ASOC NOTES');
    assert.equal(board.getCell('A1').text, 'A1 WORD');
    assert.equal(board.getCell('D5').text, 'D SOLUTION');
    assert.equal(board.getCell('A6').text, 'FINAL ANSWER');
    assert.ok(notes.getColumn(1).values.includes('HINT A1'), 'prepared hints export to the notes sheet');
    const imported = await store.importXlsx(exported.buffer, exported.filename);
    assert.equal(imported.game.theme, 'EXPORT TEST', 'theme survives the Excel round trip');
    assert.equal(imported.game.difficulty, 'PURPLE', 'difficulty survives the Excel round trip');
    assert.equal(imported.game.background, 'assets/backgrounds/_default.svg', 'background survives the Excel round trip');
    assert.equal(imported.game.story, 'Story', 'story survives the Excel round trip');
    assert.equal(imported.game.gmNotes, 'Notes', 'GM notes survive the Excel round trip');
    assert.equal(imported.game.cellHints.A1, 'Prepared A1 hint', 'prepared hints survive the Excel round trip');
    console.log('PASS Creator Excel round trip exports board, Final, metadata and prepared hints');
  } finally {
    fs.rmSync(overlay, { recursive: true, force: true });
    delete process.env.ASOC_DATA_DIR;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
