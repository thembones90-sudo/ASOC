'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
async function durableFile(file, data) {
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
async function storeImage(dir, guard, buffer, contentType, slot, privateImage = false) {
  const ext = extensions[contentType];
  if (!ext) throw new Error('Unsupported image type');
  const release = await guard.claimCapacity(buffer.length);
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  const file = path.join(dir, name);
  try {
    // Marker is durable before the image can exist. The public media route
    // therefore cannot serve even a partially completed private upload.
    if (privateImage) await durableFile(file + '.private', 'private-tribute');
    await durableFile(file, buffer);
    if (process.platform !== 'win32') {
      const directory = await fs.open(dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
    guard.recordStored(slot, buffer.length);
    return '/uploads/chat/' + name;
  } catch (error) {
    await fs.unlink(file).catch(() => {});
    await fs.unlink(file + '.private').catch(() => {});
    throw error;
  } finally { release(); }
}
module.exports = { storeImage };
