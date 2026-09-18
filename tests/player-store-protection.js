const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = path.join(os.tmpdir(), `asoc-player-protection-${process.pid}.json`);
process.env.ASOC_PLAYERS_FILE = db;

const store = require('../player-store');

function readDb() {
  return JSON.parse(fs.readFileSync(db, 'utf8'));
}

function cleanup() {
  for (const file of fs.readdirSync(path.dirname(db))) {
    if (file === path.basename(db) ||
        file === path.basename(db) + '.bak' ||
        file.startsWith(path.basename(db) + '.corrupt-') ||
        file.startsWith(path.basename(db) + '.tmp-')) {
      try { fs.unlinkSync(path.join(path.dirname(db), file)); } catch {}
    }
  }
}

try {
  cleanup();

  store.adjustProfile('Alice', { pointsDelta: 10 });
  store.adjustProfile('Alice', { pointsDelta: 5 });

  assert.equal(readDb().alice.lifetimeScore, 15);
  assert.equal(JSON.parse(fs.readFileSync(db + '.bak', 'utf8')).alice.lifetimeScore, 10);

  fs.writeFileSync(db, '{broken json', 'utf8');
  const recovered = store.loadPlayers();
  assert.equal(recovered.alice.lifetimeScore, 10);
  assert.ok(
    fs.readdirSync(path.dirname(db)).some(file =>
      file.startsWith(path.basename(db) + '.corrupt-')
    )
  );

  store.adjustProfile('Alice', { pointsDelta: 2 });
  assert.equal(readDb().alice.lifetimeScore, 12);

  fs.writeFileSync(db, '{main broken again', 'utf8');
  fs.writeFileSync(db + '.bak', '{backup broken too', 'utf8');
  const brokenMain = fs.readFileSync(db, 'utf8');

  const unavailable = store.loadPlayers();
  assert.deepEqual(unavailable, {});

  store.adjustProfile('Bob', { pointsDelta: 999 });
  assert.equal(fs.readFileSync(db, 'utf8'), brokenMain);

  console.log('PASS player-store corruption protection');
} finally {
  cleanup();
}
