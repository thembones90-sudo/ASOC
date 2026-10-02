'use strict';
// INFOSTUD -- the Shadow Broker's hidden personal storage for pictures and
// videos. Files live in <data>/infostud/<id>.<ext> with a small index.json.
// Never served statically: every read goes through the GM-authenticated
// /api/infostud routes in server.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv'
});

function create(dataDir, { maxFileBytes, maxTotalBytes }) {
  const dir = path.join(dataDir, 'infostud');
  const indexFile = path.join(dir, 'index.json');
  fs.mkdirSync(dir, { recursive: true });
  let index = null;
  const load = () => {
    if (index) return index;
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { index = { items: [] }; }
    if (!Array.isArray(index.items)) index.items = [];
    return index;
  };
  const save = () => {
    const tmp = indexFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(index));
    fs.renameSync(tmp, indexFile);
  };
  const totalBytes = () => load().items.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  const fileOf = item => path.join(dir, `${item.id}.${item.ext}`);
  const cleanName = name => String(name || 'file').replace(/[\u0000-\u001f\\/]+/g, ' ').trim().slice(0, 120) || 'file';

  return {
    ALLOWED,
    list() { return load().items.slice().sort((a, b) => b.at - a.at); },
    usage() { return { used: totalBytes(), max: maxTotalBytes, maxFile: maxFileBytes }; },
    get(id) { return load().items.find(item => item.id === String(id)) || null; },
    pathOf(item) { return fileOf(item); },

    // Streams `req` to disk. cb(error, item). Enforces type and both limits.
    receive(req, { type, name }, cb) {
      const ext = ALLOWED[String(type || '').toLowerCase()];
      if (!ext) return cb(Object.assign(new Error('ONLY PICTURES AND VIDEOS'), { status: 415 }));
      const room = maxTotalBytes - totalBytes();
      const declared = Number(req.headers['content-length']) || 0;
      if (declared > maxFileBytes) return cb(Object.assign(new Error('FILE TOO LARGE'), { status: 413 }));
      if (declared > room) return cb(Object.assign(new Error('INFOSTUD IS FULL'), { status: 507 }));
      const item = { id: crypto.randomBytes(12).toString('hex'), ext, type: String(type).toLowerCase(), name: cleanName(name), size: 0, at: Date.now() };
      const target = fileOf(item);
      const out = fs.createWriteStream(target, { flags: 'wx' });
      let size = 0;
      let failed = null;
      const fail = error => {
        if (failed) return;
        failed = error;
        req.unpipe?.(out);
        out.destroy();
        fs.rm(target, { force: true }, () => cb(error));
        req.resume();
      };
      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxFileBytes) fail(Object.assign(new Error('FILE TOO LARGE'), { status: 413 }));
        else if (size > room) fail(Object.assign(new Error('INFOSTUD IS FULL'), { status: 507 }));
      });
      req.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => {
        if (failed) return;
        if (!size) return fs.rm(target, { force: true }, () => cb(Object.assign(new Error('EMPTY FILE'), { status: 400 })));
        item.size = size;
        load().items.push(item);
        save();
        cb(null, item);
      });
      req.pipe(out);
    },

    remove(id) {
      const items = load().items;
      const i = items.findIndex(item => item.id === String(id));
      if (i < 0) return false;
      const [item] = items.splice(i, 1);
      save();
      fs.rm(fileOf(item), { force: true }, () => {});
      return true;
    }
  };
}

module.exports = { create, ALLOWED };
