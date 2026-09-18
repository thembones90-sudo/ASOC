const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'DEPLOY_MANIFEST.json');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

let gitSha = 'unknown';
try { gitSha = git(['rev-parse', 'HEAD']); } catch {}

let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
} catch (error) {
  console.error('Unable to enumerate tracked deployment files:', error.message);
  process.exit(1);
}

const files = tracked
  .filter(rel => rel !== 'DEPLOY_MANIFEST.json')
  .map(rel => {
    const abs = path.join(ROOT, rel);
    const stat = fs.statSync(abs);
    return {
      path: rel.replace(/\\/g, '/'),
      bytes: stat.size,
      sha256: sha256(abs)
    };
  });

const manifest = {
  generatedAt: new Date().toISOString(),
  gitSha,
  fileCount: files.length,
  files
};

fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`DEPLOY_MANIFEST.json generated for ${files.length} tracked files at ${gitSha.slice(0, 12)}`);
