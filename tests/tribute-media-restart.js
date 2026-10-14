'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { create } = require('../tribute-media-store');

const mode = process.argv[2];
if (mode === 'extract') {
  const root = process.argv[3], sourceFile = process.argv[4], compactFile = process.argv[5];
  const store = create(root);
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const compact = { rooms: source.rooms.map(room => ({ ...room, bloodTributes: room.bloodTributes.map(item => {
    const mediaRef = store.putDataUrl(item.imageData);
    const next = { ...item, mediaRef }; delete next.imageData; return next;
  }) })) };
  fs.writeFileSync(compactFile, JSON.stringify(compact), { mode: 0o600 });
  process.exit(0);
}
if (mode === 'extract-crash') {
  const root = process.argv[3], sourceFile = process.argv[4];
  const store = create(root), source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  for (const item of source.rooms[0].bloodTributes.slice(0, 17)) store.putDataUrl(item.imageData);
  process.exit(73);
}
if (mode === 'verify') {
  const root = process.argv[3], compactFile = process.argv[4], expectedFile = process.argv[5];
  const store = create(root), compact = JSON.parse(fs.readFileSync(compactFile, 'utf8')), expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const records = compact.rooms[0].bloodTributes;
  for (let index = 0; index < records.length; index++) {
    const media = store.read(records[index].mediaRef);
    if (!media || crypto.createHash('sha256').update(media.buffer).digest('hex') !== expected[index]) process.exit(2);
  }
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-tribute-restart-'));
try {
  const sourceFile = path.join(root, 'legacy.json'), compactFile = path.join(root, 'compact.json'), expectedFile = path.join(root, 'expected.json');
  const expected = [], tributes = [];
  for (let index = 0; index < 72; index++) {
    const seed = crypto.createHash('sha256').update('restart-' + index).digest();
    const bytes = Buffer.alloc(48 * 1024); for (let at=0; at<bytes.length; at+=seed.length) seed.copy(bytes, at);
    expected.push(crypto.createHash('sha256').update(bytes).digest('hex'));
    tributes.push({ id:'restart-'+index, imageData:'data:image/png;base64,'+bytes.toString('base64') });
  }
  fs.writeFileSync(sourceFile, JSON.stringify({rooms:[{code:'MASTER',bloodTributes:tributes}]}), { mode:0o600 });
  fs.writeFileSync(expectedFile, JSON.stringify(expected), { mode:0o600 });
  const crashed = spawnSync(process.execPath,[__filename,'extract-crash',root,sourceFile],{encoding:'utf8'});
  assert.equal(crashed.status,73,'synthetic extraction stops mid-conversion');
  assert.equal(fs.existsSync(compactFile),false,'mid-extraction crash publishes no compact recovery');
  assert.equal(JSON.parse(fs.readFileSync(sourceFile,'utf8')).rooms[0].bloodTributes.length,72,'mid-extraction crash preserves every inline original');
  const extract = spawnSync(process.execPath,[__filename,'extract',root,sourceFile,compactFile],{encoding:'utf8'});
  assert.equal(extract.status,0,extract.stderr);
  const compact = JSON.parse(fs.readFileSync(compactFile,'utf8'));
  assert.equal(compact.rooms[0].bloodTributes.length,72);
  assert.equal(compact.rooms[0].bloodTributes.some(item=>'imageData' in item),false,'compact recovery contains references only');
  assert.equal(JSON.parse(fs.readFileSync(sourceFile,'utf8')).rooms[0].bloodTributes[0].imageData,tributes[0].imageData,'legacy source remains untouched');
  const verify = spawnSync(process.execPath,[__filename,'verify',root,compactFile,expectedFile],{encoding:'utf8'});
  assert.equal(verify.status,0,verify.stderr);
  const missing = compact.rooms[0].bloodTributes[12];
  fs.unlinkSync(path.join(root,'tribute-media',missing.mediaRef.split(':')[1]+'.blob'));
  assert.equal(create(root).read(missing.mediaRef),null,'missing blob fails closed');
  assert.equal(JSON.parse(fs.readFileSync(compactFile,'utf8')).rooms[0].bloodTributes.length,72,'missing blob does not delete recovery metadata');
  assert.equal(JSON.parse(fs.readFileSync(sourceFile,'utf8')).rooms[0].bloodTributes[12].imageData,tributes[12].imageData,'missing blob does not alter legacy original');
  console.log('PASS tribute media restart: 72 compact references recover byte-for-byte in a new process; absent blob fails closed without deletion');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
