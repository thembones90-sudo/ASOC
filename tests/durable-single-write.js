// A one-target transaction must commit atomically without creating the
// multi-file recovery journal. Multi-target transactions retain the WAL.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'asoc-durable-one-'));
const script = `
  const fs=require('fs'),path=require('path');
  const io=require(${JSON.stringify(path.join(ROOT, 'durable-io.js'))});
  const root=process.env.ASOC_DATA_DIR;
  const one=path.join(root,'one.json');
  io.begin(); io.writeJson(one,{ok:1}); io.commit();
  if(fs.existsSync(path.join(root,'.runtime-transaction.json'))) throw Error('single write left WAL');
  if(JSON.parse(fs.readFileSync(one,'utf8')).ok!==1) throw Error('single write missing');
  const two=path.join(root,'two.json');
  io.begin(); io.writeJson(one,{ok:2}); io.writeJson(two,{ok:3}); io.commit();
  if(fs.existsSync(path.join(root,'.runtime-transaction.json'))) throw Error('multi write left WAL');
  if(JSON.parse(fs.readFileSync(one,'utf8')).ok!==2||JSON.parse(fs.readFileSync(two,'utf8')).ok!==3) throw Error('multi write missing');
`;
try {
  execFileSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, ASOC_DATA_DIR: data }, stdio: 'pipe' });
  assert.equal(fs.existsSync(path.join(data, '.runtime-transaction.json')), false);
  console.log('PASS durable single-write fast path: one target commits atomically without WAL; multi-target transaction still commits together');
} finally {
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
