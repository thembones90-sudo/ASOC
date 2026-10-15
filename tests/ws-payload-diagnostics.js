// OUTBOUND PAYLOAD DIAGNOSTICS -- privacy and math.
//   The server classifies every outbound WebSocket frame into a whitelisted
//   category and records byte counts so an oversized/queued backlog can be
//   attributed without logging anything sensitive. These cover the pure
//   module: categories are mapped, unknown types fold into 'other', the
//   aggregate math is exact, the periodic report is bounded and contains no
//   payload content.
const assert = require('assert/strict');
const diagnostics = require('../ws-payload-diagnostics');

diagnostics.reset();

// 1. Known frame types map to their own category.
for (const type of ['state:public', 'chat:update', 'chat:delta', 'chat:history', 'players:update', 'tribute:vault', 'timer:tick']) {
  assert.equal(diagnostics.frameCategory(JSON.stringify({ type, seq: 1, messages: [] })), type, `${type} is a known category`);
}

// 2. Unknown or hostile types can never introduce an arbitrary label.
assert.equal(diagnostics.frameCategory('{"type":"EXEC secret=/etc/passwd"}'), 'other');
assert.equal(diagnostics.frameCategory('{"type":"made:up:type"}'), 'other');
assert.equal(diagnostics.frameCategory('not json at all'), 'other');
assert.equal(diagnostics.frameCategory(Buffer.from('{"type":"chat:update","text":"hi"}')), 'chat:update');

// 3. Aggregate math is exact and split per category.
diagnostics.observe(JSON.stringify({ type: 'chat:update', text: 'x' }), 100);
diagnostics.observe(JSON.stringify({ type: 'chat:delta', text: 'y' }));
diagnostics.observe(JSON.stringify({ type: 'chat:update', text: 'zz' }));
diagnostics.observe(Buffer.alloc(diagnostics.LARGE_FRAME_BYTES + 10, 0x20), 9 * 1024 * 1024);
const snap = diagnostics.snapshot();
assert.equal(snap.frames, 4, 'every observed frame is counted');
assert.equal(snap.byCategory['chat:update'].frames, 2);
assert.equal(snap.byCategory['chat:delta'].frames, 1);
assert.equal(snap.byCategory.other.frames, 1, 'an unnamed buffer folds into other');
assert.equal(snap.largeFrames, 1, 'only frames at or above the threshold are large');
assert.equal(snap.byCategory.other.largeFrames, 1);
assert.equal(snap.maxBuffered, 9 * 1024 * 1024, 'the worst observed queue depth is tracked');
assert.ok(snap.bytes > 0 && snap.maxBytes >= diagnostics.LARGE_FRAME_BYTES);

// 4. The snapshot is aggregate-only: no payload text, name, room or token.
const serialized = JSON.stringify(snap);
for (const leak of ['x', 'y', 'zz', 'text', 'message', 'player', 'room', 'token', 'secret']) {
  assert.equal(serialized.includes(`"${leak}"`), false, `snapshot never contains "${leak}"`);
}

// 5. Reporting is bounded and content-free.
const logs = [];
const originalLog = console.log;
console.log = line => logs.push(line);
try {
  diagnostics.report();
} finally {
  console.log = originalLog;
}
assert.equal(logs.length, 1);
assert.match(logs[0], /^\[ws-payload\] \{/);
assert.equal(logs[0].includes('"text"'), false);

// 6. Reset clears every counter.
diagnostics.reset();
assert.deepEqual(diagnostics.snapshot(), { frames: 0, bytes: 0, maxBytes: 0, maxBuffered: 0, largeFrames: 0, byCategory: {} });

console.log('PASS payload diagnostics: whitelisted frame categories, exact aggregate math, bounded content-free reporting');
