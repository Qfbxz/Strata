import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, advice, estimateTokens } from '../server/context-tiers.mjs';

/** The adjudicated context ladder (kimi verdict, 2026-11-06): loud advice before a send that
 * will not fit - with the tier to switch to - instead of a silent mid-drop. */

test('the ladder is A 256K, B 512K, C 1M with a 4K reserve inside C', () => {
  assert.deepEqual(TIERS.map(t => t.tier), ['A', 'B', 'C']);
  assert.equal(TIERS[2].maxContext, 1010000);
  assert.equal(TIERS[2].usable, 1006000);
});

test('a send that fits says nothing; one at 90%+ warns it is tight', () => {
  assert.equal(advice(1000, 262144).state, 'ok');
  const tight = advice(250000, 262144);
  assert.equal(tight.state, 'tight');
  assert.match(tight.message, /95%/);
});

test('a send over the window is told loudly which tier to switch to', () => {
  const over = advice(300000, 262144);
  assert.equal(over.state, 'over');
  assert.equal(over.tier, 'B');
  assert.match(over.message, /tier B/);
  assert.match(over.message, /compact/);
});

test('a send only the 1M tier holds names tier C and the model', () => {
  const over = advice(800000, 524288);
  assert.equal(over.tier, 'C');
  assert.match(over.message, /iq4_xs-v31-1m/);
});

test('a send beyond even 1M says so in plain words, with no tier to sell', () => {
  const over = advice(1200000, 524288);
  assert.equal(over.state, 'over');
  assert.equal(over.tier, null);
  assert.match(over.message, /beyond even the 1M tier/);
});

test('junk numbers never advise; the estimate is the honest quick bound', () => {
  assert.equal(advice(NaN, 524288).state, 'ok');
  assert.equal(advice(10, 0).state, 'ok');
  assert.ok(estimateTokens('四个汉字') >= 6);
});
