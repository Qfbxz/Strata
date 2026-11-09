// The compaction breaker (HARNESS_ROADMAP H2): automatic summarizing that keeps failing is stopped after three tries in a row,
// the chat gets one plain card and stays usable; a success starts the count again; 0 disables the breaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactBreaker } from '../server/agent/compact-breaker.mjs';

test('three failed auto-compactions in a row block the next automatic one', () => {
  const b = new CompactBreaker();
  assert.equal(b.blocked('c1'), false, 'nothing failed yet');
  b.failure('c1'); b.failure('c1');
  assert.equal(b.blocked('c1'), false, 'two failures are not three');
  b.failure('c1');
  assert.equal(b.blocked('c1'), true, 'three in a row: the breaker opens');
});

test('a success starts the count again', () => {
  const b = new CompactBreaker();
  b.failure('c1'); b.failure('c1'); b.failure('c1');
  assert.equal(b.blocked('c1'), true);
  b.success('c1');
  assert.equal(b.blocked('c1'), false, 'the breaker closed after a success');
  b.failure('c1'); b.failure('c1');
  assert.equal(b.blocked('c1'), false, 'the count started again, not continued');
});

test('sessions are tracked apart; the limit comes from the settings; 0 disables', () => {
  const b = new CompactBreaker();
  b.failure('a'); b.failure('a'); b.failure('a');
  assert.equal(b.blocked('b'), false, 'another chat is not blocked by this one');
  const off = new CompactBreaker({ compactFailures: 0 });
  off.failure('c'); off.failure('c'); off.failure('c'); off.failure('c');
  assert.equal(off.blocked('c'), false, '0 disables the breaker');
  const strict = new CompactBreaker({ compactFailures: 1 });
  strict.failure('d');
  assert.equal(strict.blocked('d'), true, 'the setting can tighten the limit');
});
