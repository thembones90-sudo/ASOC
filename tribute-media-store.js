'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const REF = /^sha256:([a-f0-9]{64}):(image\/(?:png|jpeg|webp|gif))$/;

function create(root) {
  const dir = path.join(path.resolve(root), 'tribute-media');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  // Immutable content-addressed blob verification is cached only while the
  // underlying file metadata stays unchanged. Ordinary chat persistence must
  // not base64-encode and rehash every archived image on every message.
  const verifiedRefs = new Map();
  function fileIdentity(stat) {
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  }
  function check(ref) {
    const parsed = REF.exec(String(ref || ''));
    if (!parsed) return false;
    const filename = path.join(dir, parsed[1] + '.blob');
    try {
      const stat = fs.statSync(filename);
      if (!stat.isFile() || !stat.size) return false;
      const identity = fileIdentity(stat);
      if (verifiedRefs.get(ref) === identity) return true;
      const bytes = fs.readFileSync(filename);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== parsed[1]) {
        verifiedRefs.delete(ref);
        return false;
      }
      verifiedRefs.set(ref, identity);
      return true;
    } catch {
      verifiedRefs.delete(ref);
      return false;
    }
  }

  function putDataUrl(value) {
    const parsed = DATA_URL.exec(String(value || ''));
    if (!parsed) throw new Error('invalid tribute image data');
    const bytes = Buffer.from(parsed[2], 'base64');
    if (!bytes.length) throw new Error('empty tribute image data');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const target = path.join(dir, hash + '.blob');
    if (!fs.existsSync(target)) {
      const temp = path.join(dir, `.${hash}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
      let fd;
      try {
        fd = fs.openSync(temp, 'wx', 0o600);
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        try { fs.renameSync(temp, target); } catch (error) {
          if (!fs.existsSync(target)) throw error;
          fs.unlinkSync(temp);
        }
        if (process.platform !== 'win32') {
          const dirFd = fs.openSync(dir, 'r');
          try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
        }
      } catch (error) {
        if (fd !== undefined) try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(temp); } catch {}
        throw error;
      }
    }
    const stored = fs.readFileSync(target);
    const verified = stored.length === bytes.length && crypto.createHash('sha256').update(stored).digest('hex') === hash;
    if (!verified) throw new Error('tribute media verification failed');
    return `sha256:${hash}:${parsed[1]}`;
  }

  function read(ref) {
    const parsed = REF.exec(String(ref || ''));
    if (!parsed) return null;
    try {
      const bytes = fs.readFileSync(path.join(dir, parsed[1] + '.blob'));
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== parsed[1]) return null;
      return { type: parsed[2], buffer: bytes, dataUrl: `data:${parsed[2]};base64,${bytes.toString('base64')}` };
    } catch { return null; }
  }

  return { dir, putDataUrl, read, check };
}

module.exports = { create, DATA_URL, REF };
