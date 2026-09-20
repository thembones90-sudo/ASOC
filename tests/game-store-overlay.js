const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const overlay = path.join(os.tmpdir(), `asoc-gamestore-overlay-${process.pid}`);
process.env.ASOC_DATA_DIR = overlay;

const store = require('../game-store');

function cleanup() {
  try { fs.rmSync(overlay, { recursive: true, force: true }); } catch {}
}

function makeValidGame(title) {
  return {
    title,
    difficulty: 'GREEN',
    columns: {
      A: { clues: ['a1', 'a2', 'a3', 'a4'], solution: 'ASOL' },
      B: { clues: ['b1', 'b2', 'b3', 'b4'], solution: 'BSOL' },
      C: { clues: ['c1', 'c2', 'c3', 'c4'], solution: 'CSOL' },
      D: { clues: ['d1', 'd2', 'd3', 'd4'], solution: 'DSOL' }
    },
    finalSolution: 'FSOL'
  };
}

try {
  cleanup();
  fs.mkdirSync(overlay, { recursive: true });

  // 1. Bundled catalog still lists, and a create lands in the durable overlay
  //    only -- the bundled tree is never written to.
  const listedIds = store.listGameFiles().map(g => g.id);
  assert.ok(listedIds.includes('sample-001'), 'bundled sample game stays listed');

  const created = store.saveGame(makeValidGame('OVERLAY TEST'));
  assert.ok(!created.errors, 'saving a new game succeeds');
  assert.equal(fs.existsSync(path.join(store.GAMES_DIR, 'overlay-test.json')), false, 'bundled games/ untouched by a save');
  assert.equal(fs.existsSync(path.join(store.DURABLE_GAMES_DIR, 'overlay-test.json')), true, 'durable games/ holds the new file');
  assert.equal(store.listGameFiles().filter(g => g.id === created.game.id).length, 1, 'listing never shows the same game twice');

  // 2. Reads prefer the durable overlay: shadow the bundled sample by id.
  const sampleRaw = JSON.parse(fs.readFileSync(path.join(store.GAMES_DIR, 'sample-game.json'), 'utf8'));
  store.saveGame({ ...sampleRaw, title: 'SHADOW SAMPLE', modified: new Date().toISOString() });
  assert.equal(store.readGame('sample-001').title, 'SHADOW SAMPLE', 'durable copy shadows the bundled sample');

  // 3. A purely bundled game can never be deleted.
  const bundledFile = store.findGameFile('kurac-test');
  assert.ok(bundledFile, 'bundled kurac-test resolves');
  const refused = store.deleteGame('kurac-test');
  assert.ok(/read-only/i.test(refused.error || 'Bundled games are read-only'), 'bundled-only delete is refused');
  assert.equal(fs.existsSync(bundledFile), true, 'bundled file survives the refused delete');

  // 4. Deleting the durable sample shadow un-shadows the bundled original.
  const unshadow = store.deleteGame('sample-001');
  assert.equal(unshadow.success, true, 'durable shadow delete succeeds');
  assert.equal(store.readGame('sample-001').title !== 'SHADOW SAMPLE', true, 'bundled sample visible again after shadow delete');

  // 5. Background uploads land in the durable overlay; listings merge overlay
  //    with the bundled defaults.
  const uploaded = store.saveBackgroundUpload('brand-new.svg', Buffer.from('<svg/>'));
  assert.equal(uploaded.error, undefined, 'background upload succeeds');
  assert.equal(fs.existsSync(path.join(store.DURABLE_BACKGROUNDS_DIR, 'brand-new.svg')), true, 'durable backgrounds/ holds the upload');
  assert.equal(fs.existsSync(path.join(store.BACKGROUNDS_DIR, 'brand-new.svg')), false, 'bundled backgrounds/ untouched by an upload');
  const allBackgrounds = store.listBackgrounds();
  assert.ok(allBackgrounds.some(b => b.filename === 'brand-new.svg'), 'uploaded background listed');
  assert.ok(allBackgrounds.some(b => b.filename === '_default.svg'), 'bundled default background still listed');

// 6. Uploading a filename that already exists as a bundled asset NEVER
//    touches the bundled file: the durable copy shadows it (same-name
//    durable wins in listBackgrounds), and a repeat upload inside the
//    overlay gets the numeric suffix. In every case the bundled file stays
//    byte-identical.
  const bundledFingerprint = fs.readFileSync(path.join(store.BACKGROUNDS_DIR, 'sample-bg.svg'));
  const firstOverlay = store.saveBackgroundUpload('sample-bg.svg', Buffer.from('A'));
  assert.equal(firstOverlay.filename, 'sample-bg.svg', 'durable upload may legitimately shadow the bundled asset by name');
  assert.equal(fs.readFileSync(path.join(store.BACKGROUNDS_DIR, 'sample-bg.svg')).equals(bundledFingerprint), true, 'bundled background byte-identical after shadowing upload');
  const secondOverlay = store.saveBackgroundUpload('sample-bg.svg', Buffer.from('B'));
  assert.notEqual(secondOverlay.filename, 'sample-bg.svg', 'repeat overlay upload falls back to -2 suffix');
  assert.equal(fs.readFileSync(path.join(store.BACKGROUNDS_DIR, 'sample-bg.svg')).equals(bundledFingerprint), true, 'bundled background still byte-identical after second upload');

  console.log('PASS game-store durable overlay: writes/deletes hit the overlay, bundled tree read-only, durable shadows bundled');
} finally {
  cleanup();
  delete process.env.ASOC_DATA_DIR;
}