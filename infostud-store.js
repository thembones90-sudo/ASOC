'use strict';
// INFOSTUD -- the Shadow Broker's hidden personal file storage: any file
// type, nested folders, rename / move / copy / delete, folder ZIP download.
// Files live in <data>/infostud/<id>.bin (v1 uploads keep <id>.<ext>) with a
// small index.json describing the tree -- or, when an R2 client is passed,
// in the R2 bucket (files/<id> + index.json), off the game volume entirely;
// the local index.json is then only a cache. Never served statically: every read
// goes through the GM-authenticated /api/infostud routes in server.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_NAME = 180;
// Panini-style sticker tiers, lowest to highest.
const RATINGS = Object.freeze(['bronze', 'silver', 'gold', 'platinum']);

function create(dataDir, { maxFileBytes, maxTotalBytes, diskReserveBytes = 512 * 1024 * 1024, remote = null }) {
  const dir = path.join(dataDir, 'infostud');
  const indexFile = path.join(dir, 'index.json');
  fs.mkdirSync(dir, { recursive: true });
  // Real free space on the data volume, minus a reserve the game itself
  // needs (save files, chat uploads). Infostud never eats into the reserve.
  const diskRoom = () => {
    if (remote) return Infinity;
    try {
      if (typeof fs.statfsSync !== 'function') return Infinity;
      const st = fs.statfsSync(dir);
      return Number(st.bavail) * Number(st.bsize) - diskReserveBytes;
    } catch { return Infinity; }
  };
  let index = null;

  // v1 items were flat files {id, ext, type, name, size, at}.
  const migrate = item => ({
    id: String(item.id),
    kind: item.kind === 'folder' ? 'folder' : 'file',
    name: String(item.name || 'file'),
    parentId: item.parentId ? String(item.parentId) : null,
    type: item.kind === 'folder' ? null : String(item.type || 'application/octet-stream'),
    ext: item.ext || null,
    size: Number(item.size) || 0,
    createdAt: Number(item.createdAt || item.at) || Date.now(),
    modifiedAt: Number(item.modifiedAt || item.at) || Date.now(),
    rating: RATINGS.includes(item.rating) ? item.rating : null
  });
  const load = () => {
    if (index) return index;
    try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { index = { items: [] }; }
    index.items = (Array.isArray(index.items) ? index.items : []).map(migrate);
    return index;
  };
  // With R2 the bucket copy of the index is the truth; writes are coalesced
  // so a burst of changes uploads only the latest tree.
  let remoteDirty = false;
  let remoteFlush = null;
  const flushRemote = () => {
    if (remoteFlush) return remoteFlush;
    remoteFlush = (async () => {
      while (remoteDirty) {
        remoteDirty = false;
        try { await remote.putBuffer('index.json', Buffer.from(JSON.stringify(index)), 'application/json'); }
        catch (error) { console.error('[infostud] R2 index write failed:', error.message); }
      }
      remoteFlush = null;
    })();
    return remoteFlush;
  };
  const save = () => {
    try {
      const tmp = indexFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(index));
      fs.renameSync(tmp, indexFile);
    } catch (error) {
      if (!remote) throw error;
      console.error('[infostud] local index cache write failed:', error.message);
    }
    if (remote) { remoteDirty = true; flushRemote(); }
  };
  const all = () => load().items;
  const get = id => all().find(item => item.id === String(id)) || null;
  const children = parentId => all().filter(item => item.parentId === (parentId || null));
  const descendants = id => {
    const out = [];
    const walk = pid => children(pid).forEach(child => { out.push(child); if (child.kind === 'folder') walk(child.id); });
    walk(id);
    return out;
  };
  const totalBytes = () => all().reduce((sum, item) => sum + (item.kind === 'file' ? item.size : 0), 0);
  const fileOf = item => path.join(dir, item.ext ? `${item.id}.${item.ext}` : `${item.id}.bin`);
  const keyOf = item => `files/${item.id}`;
  const dropBlob = item => {
    if (remote) remote.remove(keyOf(item)).catch(error => console.error('[infostud] R2 delete failed:', error.message));
    else fs.rm(fileOf(item), { force: true }, () => {});
  };
  const newId = () => crypto.randomBytes(12).toString('hex');
  const err = (message, status) => Object.assign(new Error(message), { status });

  const cleanName = name => String(name || '').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+$/, '').slice(0, MAX_NAME);
  // Windows-style: "name (2).ext" when the folder already has that name.
  const uniqueName = (parentId, wanted, exceptId) => {
    const taken = new Set(children(parentId).filter(i => i.id !== exceptId).map(i => i.name.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    const dot = wanted.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ''];
    for (let n = 2; ; n++) { const candidate = `${base} (${n})${ext}`; if (!taken.has(candidate.toLowerCase())) return candidate; }
  };
  const checkParent = parentId => {
    if (!parentId) return null;
    const parent = get(parentId);
    if (!parent || parent.kind !== 'folder') throw err('FOLDER NOT FOUND', 404);
    return parent.id;
  };
  const touch = parentId => { const p = parentId && get(parentId); if (p) p.modifiedAt = Date.now(); };
  const pathOfItem = item => {
    const names = [];
    for (let cur = item; cur; cur = cur.parentId ? get(cur.parentId) : null) names.unshift(cur.name);
    return names.join('/');
  };

  return {
    storage: remote ? 'r2' : 'disk',
    // Loads the tree from R2 (when used) before the first request.
    async init() {
      if (!remote) return;
      const buf = await remote.getBuffer('index.json');
      if (buf) {
        index = null;
        try { index = JSON.parse(buf.toString('utf8')); } catch { index = { items: [] }; }
        index.items = (Array.isArray(index.items) ? index.items : []).map(migrate);
        try { fs.writeFileSync(indexFile, JSON.stringify(index)); } catch {}
      } else {
        // Fresh bucket: files that only exist on the local disk cannot follow.
        index = { items: [] };
        save();
      }
    },
    flush() { return remote ? (remoteFlush || Promise.resolve()) : Promise.resolve(); },
    // Readable stream of a file's bytes.
    async open(item) { return remote ? remote.get(keyOf(item)) : fs.createReadStream(fileOf(item)); },
    list() { return all().slice(); },
    usage() {
      const used = totalBytes();
      const room = Math.max(0, Math.min(maxTotalBytes - used, diskRoom()));
      return { used, max: used + room, maxFile: Math.min(maxFileBytes, room) };
    },
    get,
    pathOf(item) { return fileOf(item); },
    displayPath: pathOfItem,

    createFolder({ name, parentId }) {
      const pid = checkParent(parentId);
      const clean = cleanName(name) || 'New folder';
      const now = Date.now();
      const folder = { id: newId(), kind: 'folder', name: uniqueName(pid, clean), parentId: pid, type: null, ext: null, size: 0, createdAt: now, modifiedAt: now };
      all().push(folder);
      touch(pid);
      save();
      return folder;
    },

    // Streams `req` to disk. cb(error, item). Any file type; size limits enforced.
    receive(req, { type, name, parentId, lastModified }, cb) {
      let pid;
      try { pid = checkParent(parentId); } catch (e) { req.resume(); return cb(e); }
      const room = Math.min(maxTotalBytes - totalBytes(), diskRoom());
      const declared = Number(req.headers['content-length']) || 0;
      if (declared > maxFileBytes) { req.resume(); return cb(err('FILE TOO LARGE', 413)); }
      if (declared > room) { req.resume(); return cb(err('INFOSTUD IS FULL', 507)); }
      const now = Date.now();
      const modified = Number(lastModified);
      const item = {
        id: newId(), kind: 'file', name: cleanName(name) || 'file', parentId: pid,
        type: /^[\w.+-]+\/[\w.+-]+$/.test(String(type || '')) ? String(type).toLowerCase() : 'application/octet-stream',
        ext: null, size: 0, createdAt: now, modifiedAt: Number.isFinite(modified) && modified > 0 && modified <= now + 60000 ? modified : now
      };
      const commit = size => {
        item.size = size;
        item.name = uniqueName(pid, item.name);
        all().push(item);
        touch(pid);
        save();
        cb(null, item);
      };
      if (remote) {
        // R2 needs the length up front; browsers always send it for a file.
        if (!declared) { req.resume(); return cb(err('LENGTH REQUIRED', 411)); }
        remote.put(keyOf(item), req, declared, item.type).then(() => commit(declared), error => {
          req.resume();
          remote.remove(keyOf(item)).catch(() => {});
          cb(error.status ? error : err('UPLOAD FAILED', 502));
        });
        return;
      }
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
        if (size > maxFileBytes) fail(err('FILE TOO LARGE', 413));
        else if (size > room) fail(err('INFOSTUD IS FULL', 507));
      });
      req.on('error', fail);
      out.on('error', fail);
      out.on('finish', () => {
        if (failed) return;
        commit(size);
      });
      req.pipe(out);
    },

    // Rename and/or move and/or rate. Moving a folder into itself or a
    // descendant is refused. A rating alone does not count as a modification.
    update(id, { name, parentId, rating }) {
      const item = get(id);
      if (!item) throw err('NOT FOUND', 404);
      if (rating !== undefined) item.rating = RATINGS.includes(rating) ? rating : null;
      if (name === undefined && parentId === undefined) { save(); return item; }
      let pid = item.parentId;
      if (parentId !== undefined) {
        pid = checkParent(parentId);
        if (item.kind === 'folder' && (pid === item.id || descendants(item.id).some(d => d.id === pid))) throw err('A FOLDER CANNOT GO INSIDE ITSELF', 400);
      }
      const wanted = name !== undefined ? cleanName(name) : item.name;
      if (!wanted) throw err('INVALID NAME', 400);
      const oldParent = item.parentId;
      item.parentId = pid;
      item.name = uniqueName(pid, wanted, item.id);
      item.modifiedAt = Date.now();
      touch(oldParent);
      if (pid !== oldParent) touch(pid);
      save();
      return item;
    },

    // Copy a file or a whole folder tree into parentId.
    async copy(id, { parentId }) {
      const source = get(id);
      if (!source) throw err('NOT FOUND', 404);
      const pid = checkParent(parentId);
      if (source.kind === 'folder' && (pid === source.id || descendants(source.id).some(d => d.id === pid))) throw err('A FOLDER CANNOT GO INSIDE ITSELF', 400);
      const bytes = source.kind === 'file' ? source.size : descendants(source.id).reduce((s, d) => s + (d.kind === 'file' ? d.size : 0), 0);
      if (bytes > Math.min(maxTotalBytes - totalBytes(), diskRoom())) throw err('INFOSTUD IS FULL', 507);
      const now = Date.now();
      // Blobs are copied first; the tree only changes once they all exist.
      const added = [];
      const clone = async (src, intoId, rename) => {
        const copy = { ...src, id: newId(), parentId: intoId, ext: null, createdAt: now, name: rename ? uniqueName(intoId, src.name) : src.name };
        if (src.kind === 'file') {
          if (remote) await remote.copy(keyOf(src), keyOf(copy));
          else fs.copyFileSync(fileOf(src), fileOf(copy));
        }
        added.push(copy);
        if (src.kind === 'folder') for (const child of children(src.id)) await clone(child, copy.id, false);
        return copy;
      };
      let result;
      try { result = await clone(source, pid, true); } catch (error) {
        added.filter(a => a.kind === 'file').forEach(dropBlob);
        throw error.status ? error : err('COPY FAILED', 502);
      }
      all().push(...added);
      touch(pid);
      save();
      return result;
    },

    // Wipe everything: every file and folder.
    purge() {
      const files = all().filter(i => i.kind === 'file');
      const count = all().length;
      index.items = [];
      save();
      files.forEach(dropBlob);
      return count;
    },

    remove(id) {
      const item = get(id);
      if (!item) return false;
      const doomed = [item, ...(item.kind === 'folder' ? descendants(item.id) : [])];
      const ids = new Set(doomed.map(d => d.id));
      index.items = all().filter(i => !ids.has(i.id));
      touch(item.parentId);
      save();
      doomed.filter(d => d.kind === 'file').forEach(dropBlob);
      return true;
    },

    // Store-only ZIP of a folder, streamed. Entries use data descriptors so
    // the CRC is computed while streaming; sizes stay under 4 GB by quota.
    async zipFolder(folder, res) {
      const entries = [];
      const walk = (pid, prefix) => children(pid).sort((a, b) => a.name.localeCompare(b.name)).forEach(child => {
        const p = prefix + child.name;
        if (child.kind === 'folder') { entries.push({ dir: true, name: p + '/', item: child }); walk(child.id, p + '/'); }
        else entries.push({ dir: false, name: p, item: child });
      });
      walk(folder.id, folder.name + '/');
      entries.unshift({ dir: true, name: folder.name + '/', item: folder });
      let offset = 0;
      const central = [];
      const write = buf => new Promise(resolve => { offset += buf.length; res.write(buf) ? resolve() : res.once('drain', resolve); });
      const dos = ms => { const d = new Date(ms); return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; };
      for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const { time, date } = dos(entry.item.modifiedAt);
        const flags = entry.dir ? 0x0800 : 0x0808;
        const start = offset;
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(flags, 6); head.writeUInt16LE(0, 8);
        head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt16LE(name.length, 26);
        await write(head); await write(name);
        let crc = 0, size = 0;
        if (!entry.dir) {
          crc = ~0 >>> 0;
          for await (const chunk of await this.open(entry.item)) {
            crc = crc32(chunk, crc);
            size += chunk.length;
            await write(chunk);
          }
          crc = (~crc) >>> 0;
          const desc = Buffer.alloc(16);
          desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(size, 8); desc.writeUInt32LE(size, 12);
          await write(desc);
        }
        central.push({ name, flags, time, date, crc, size, start, dir: entry.dir });
      }
      const cdStart = offset;
      for (const c of central) {
        const h = Buffer.alloc(46);
        h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(c.flags, 8); h.writeUInt16LE(0, 10);
        h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24);
        h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.dir ? 0x10 : 0, 38); h.writeUInt32LE(c.start, 42);
        await write(h); await write(c.name);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
      end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
      await write(end);
      res.end();
    }
  };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, crc) {
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

module.exports = { create, RATINGS };
