import test from 'node:test';
import assert from 'node:assert/strict';
import { foldChildRecords } from '../server/agent/children.mjs';

/** UX-7's read-only child transcript: the subagent overview's log dialog folds the child's
 * session records (raw harness events or the follow stream's snapshot rows) into plain
 * chat rows. Bounded text, tools named not dumped, nothing crashes on junk. */

test('assistant messages become assistant rows, tool calls become named tool rows', () => {
  const rows = foldChildRecords([
    { type: 'event', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] } } } },
    { type: 'event', event: { type: 'tool/call', data: { name: 'read_file' } } },
    { type: 'event', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } } },
  ]);
  assert.deepEqual(rows, [
    { role: 'assistant', text: '第一段第二段' },
    { role: 'tool', text: 'read_file' },
    { role: 'assistant', text: 'done' },
  ]);
});

test('bare snapshot rows (no event wrapper) fold the same way', () => {
  const rows = foldChildRecords([
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'hi' }] } } },
    { type: 'tool/call', data: { name: 'bash' } },
  ]);
  assert.deepEqual(rows, [{ role: 'assistant', text: 'hi' }, { role: 'tool', text: 'bash' }]);
});

test('whitespace-only assistant text and unknown/junk events are dropped', () => {
  const rows = foldChildRecords([
    { type: 'event', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '   \n  ' }] } } } },
    { type: 'event', event: { type: 'step/start', data: {} } },
    null,
    {},
    { type: 'event', event: { data: { message: {} } } },
  ]);
  assert.deepEqual(rows, []);
});

test('a tool call with no name still reads as a tool row', () => {
  const rows = foldChildRecords([{ type: 'tool/call', data: {} }]);
  assert.deepEqual(rows, [{ role: 'tool', text: 'tool' }]);
});

test('assistant text is capped so one huge message cannot flood the dialog', () => {
  const rows = foldChildRecords([{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'x'.repeat(9000) }] } } }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text.length, 4000);
});

test('a missing or empty record list folds to no rows, not an error', () => {
  assert.deepEqual(foldChildRecords(undefined), []);
  assert.deepEqual(foldChildRecords([]), []);
});
