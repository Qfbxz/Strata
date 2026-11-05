/* P0-7 persistence contract for server/store.mjs (plan STRATA-IMPROVEMENT-PLAN.md):
   1. a torn state.json must not silently become an empty library — the import fails loudly and the
      broken file is preserved as state.json.corrupt-<ts>;
   2. saves are atomic (tmp + fsync + rename) — no *.tmp-* leftovers beside state.json;
   3. save() still persists what update() changed (plain round-trip). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'strata-store-p0t7-'));
process.env.STRATA_HOME = scratch;
const DATA_DIR = join(scratch, 'data');
const STATE_FILE = join(DATA_DIR, 'state.json');

const store = await import('../server/store.mjs');
const { writeFileAtomic } = store;

test('a torn state.json fails the import loudly and is preserved as .corrupt', async () => {
  writeFileSync(STATE_FILE, '{"installed": {"some-model": {', 'utf8');
  await assert.rejects(import('../server/store.mjs?torn=1'), /not readable JSON/);
  const kept = readdirSync(DATA_DIR).find((f) => f.startsWith('state.json.corrupt-'));
  assert.ok(kept, 'the broken file is kept beside the real one');
  assert.ok(readFileSync(join(DATA_DIR, kept), 'utf8').includes('"some-model"'), 'the torn bytes survive verbatim');
});

test('save is atomic: valid JSON on disk, no temp leftovers', () => {
  store.update({ setup: { complete: true } });
  const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  assert.equal(parsed.setup.complete, true);
  const leftovers = readdirSync(DATA_DIR).filter((f) => f.startsWith('state.json.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('writeFileAtomic writes the bytes and cleans its temp file', () => {
  const target = join(DATA_DIR, 'atomic-probe.json');
  writeFileAtomic(target, '{"ok":true}');
  assert.equal(readFileSync(target, 'utf8'), '{"ok":true}');
  assert.deepEqual(readdirSync(DATA_DIR).filter((f) => f.startsWith('atomic-probe.json.tmp-')), []);
});

test('a missing state file is still a fresh install (no throw)', async () => {
  const other = mkdtempSync(join(tmpdir(), 'strata-store-fresh-'));
  process.env.STRATA_HOME = other;
  const fresh = await import('../server/store.mjs?fresh=' + Date.now());
  assert.deepEqual(fresh.get().installed, {});
  process.env.STRATA_HOME = scratch;
});
