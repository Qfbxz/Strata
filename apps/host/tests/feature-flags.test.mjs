/**
 * The feature switches, unit level: defaults when nothing is saved, booleans only (a string
 * "false" does not flip a switch), unknown keys dropped, and the sanitizer never invents keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { featuresView, sanitizeFeatures } from '../server/feature-flags.mjs';

test('saved booleans override the all-on defaults; everything else keeps them', () => {
  assert.deepEqual(featuresView(undefined), { agents: true, hooks: true, memory: true, projectInstructions: true, skillsNative: true, branchChip: true });
  assert.equal(featuresView({ hooks: false }).hooks, false);
  assert.equal(featuresView({ hooks: false }).agents, true, 'the other switches stay at their defaults');
  assert.equal(featuresView({ memory: 'false' }).memory, true, 'a string is not a switch');
  assert.equal(featuresView('nonsense').agents, true);
  assert.equal(featuresView(['hooks']).hooks, true);
});

test('the sanitizer keeps only known boolean keys, in both directions', () => {
  assert.deepEqual(sanitizeFeatures({ hooks: false, extra: true, agents: 'yes' }), { hooks: false });
  assert.deepEqual(sanitizeFeatures(undefined), {});
  assert.deepEqual(sanitizeFeatures({ agents: true, branchChip: false }), { agents: true, branchChip: false });
  const view = featuresView(sanitizeFeatures({ agents: true, branchChip: false }));
  assert.equal(view.agents, true);
  assert.equal(view.branchChip, false);
});
