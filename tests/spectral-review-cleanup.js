'use strict';
const assert = require('node:assert/strict');
const { actionablePending } = require('../automation/spectral-adjudicator');
const entries = ['live', 'old', 'missing', 'judged', 'system', 'deleted', 'closed', 'live'].map(messageId => ({ messageId, target: messageId === 'closed' ? 'B' : 'A' }));
const context = { active: true, boardId: 'new-board', closedTargets: ['B'], messages: [
  { id: 'live', boardId: 'new-board' },
  { id: 'old', boardId: 'old-board' },
  { id: 'judged', boardId: 'new-board', verdict: 'wrong' },
  { id: 'system', boardId: 'new-board', source: 'spectralAdjudicator' },
  { id: 'deleted', boardId: 'new-board', deleted: true },
  { id: 'closed', boardId: 'new-board' }
] };
assert.deepEqual(actionablePending(entries, context), [entries[0]]);
assert.deepEqual(actionablePending(entries, { ...context, active: false }), []);
assert.deepEqual(actionablePending(entries, { ...context, boardId: 'next-board' }), []);
assert.deepEqual(actionablePending([null, {}, ...entries], context), [entries[0]]);
assert.equal(context.messages.find(m => m.id === 'judged').verdict, 'wrong', 'cleanup never changes historical verdicts');
console.log('PASS Spectra review cleanup: ended/old/missing/judged/deleted/system/closed and duplicate entries removed without changing verdicts');
