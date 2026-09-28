'use strict';

// AVATAR STORE -- Little Hero avatars live as image files on the durable
// volume instead of inline data URIs inside players.json / room state.
//
//   <ASOC_DATA_DIR>/avatars/<sha256[0..32]>.<png|jpg|webp>
//
// Files are content-addressed: the same image always maps to the same name,
// so identical avatars share one file and a published URL can be cached
// forever (immutable). The value stored and transmitted everywhere is the
// short URL "/avatars/<name>"; clients use it directly as an <img src>.
// Uploads still arrive as data URIs (join / appearance), are validated
// against their real file signature, and are converted here.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.ASOC_DATA_DIR ? path.resolve(process.env.ASOC_DATA_DIR) : __dirname;
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
const MAX_AVATAR_DATA_LENGTH = 200000; // data-URI characters, as before
const DATA_URI = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const AVATAR_URL = /^\/avatars\/([a-f0-9]{32}\.(?:png|jpg|webp))$/;
const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const CONTENT_TYPE = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

function signatureMatches(buffer, ext) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (ext === 'png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'jpg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (ext === 'webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function isAvatarUrl(value) {
  return typeof value === 'string' && AVATAR_URL.test(value);
}

function fileForUrl(value) {
  const match = AVATAR_URL.exec(String(value || ''));
  return match ? path.join(AVATAR_DIR, match[1]) : null;
}

function exists(value) {
  const file = fileForUrl(value);
  return !!file && fs.existsSync(file);
}

// Writes the image (if new) and returns its URL, or null when invalid.
function storeDataUri(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_AVATAR_DATA_LENGTH) return null;
  const match = DATA_URI.exec(value);
  if (!match) return null;
  const ext = EXT[match[1]];
  const bytes = Buffer.from(match[2], 'base64');
  if (!signatureMatches(bytes, ext)) return null;
  const name = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32) + '.' + ext;
  const target = path.join(AVATAR_DIR, name);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    let fd;
    try {
      fd = fs.openSync(tmp, 'wx', 0o644);
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmp, target);
    } catch (error) {
      if (fd !== undefined) try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
      if (!fs.existsSync(target)) throw error;
    }
  }
  return '/avatars/' + name;
}

// The single normalisation used at every storage boundary:
//   ''                 -> '' (explicitly no avatar)
//   data URI (valid)   -> stored file URL
//   existing file URL  -> unchanged
//   anything else      -> null (reject)
function normalize(value) {
  if (value === '') return '';
  if (isAvatarUrl(value)) return exists(value) ? value : null;
  return storeDataUri(value);
}

// For the HTTP route: { file, contentType } or null.
function resolveRequest(urlPath) {
  const match = AVATAR_URL.exec(String(urlPath || ''));
  if (!match) return null;
  const ext = match[1].split('.').pop();
  return { file: path.join(AVATAR_DIR, match[1]), contentType: CONTENT_TYPE[ext] };
}

module.exports = { AVATAR_DIR, MAX_AVATAR_DATA_LENGTH, isAvatarUrl, exists, storeDataUri, normalize, resolveRequest, signatureMatches };
