'use strict';

const REPORT_EVERY = Math.max(1, Number(process.env.ASOC_COMMAND_REPORT_EVERY) || 500);
const CATEGORIES = new Set(['tribute:submit','gm:tributeReviewDecision','gm:tributeVaultUpdate','gm:tributeImageGet','gm:reliquaryAccess','chat:send','chat:history']);
const stats = { commands:0, bytes:0, maxBytes:0, maxQueueDepth:0, byCategory:new Map() };

function observe(type, bytes, queueDepth) {
  const category = CATEGORIES.has(type) ? type : 'other';
  const size = Math.max(0, Number(bytes) || 0);
  const depth = Math.max(0, Number(queueDepth) || 0);
  stats.commands++; stats.bytes += size;
  stats.maxBytes = Math.max(stats.maxBytes, size);
  stats.maxQueueDepth = Math.max(stats.maxQueueDepth, depth);
  const item = stats.byCategory.get(category) || { commands:0, bytes:0, maxBytes:0, maxQueueDepth:0 };
  item.commands++; item.bytes += size; item.maxBytes = Math.max(item.maxBytes,size); item.maxQueueDepth = Math.max(item.maxQueueDepth,depth);
  stats.byCategory.set(category,item);
  if (stats.commands % REPORT_EVERY === 0) console.log('[command-queue] '+JSON.stringify(snapshot()));
}
function snapshot() { return { commands:stats.commands,bytes:stats.bytes,maxBytes:stats.maxBytes,maxQueueDepth:stats.maxQueueDepth,byCategory:Object.fromEntries(stats.byCategory) }; }
function reset() { stats.commands=stats.bytes=stats.maxBytes=stats.maxQueueDepth=0;stats.byCategory.clear(); }
module.exports={observe,snapshot,reset};
