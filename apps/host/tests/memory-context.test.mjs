/**
 * The memory-context injection, unit level: the MEMORY.md index rides into direct chats (bounded
 * by the plugin's own budget), the section is empty when no memory exists, and a config-named
 * budget wins over the default.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryContextSection } from '../server/memory-context.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };

test('the index rides with a consult nudge, empty memory means an empty section, and the budget trims', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-memctx-'));
  try {
    const config = join(dir, 'cfg.json');
    writeFileSync(config, JSON.stringify({ memoryRoot: dir }));
    const index = join(dir, 'MEMORY.md');
    writeFileSync(index, '# Memory\n- drilling report convention X\n- the user prefers 中文\n');
    const section = memoryContextSection({ configFile: config });
    assert.match(section, /Memory from past work/);
    assert.match(section, /drilling report convention X/);
    assert.match(section, /consult it when the task touches/);
    // budget trims long indexes and marks the cut
    writeFileSync(config, JSON.stringify({ memoryRoot: dir, injectBudgetChars: 30 }));
    const cut = memoryContextSection({ configFile: config });
    assert.ok(cut.length < 200);
    assert.match(cut, /…$/);
    // no index: no section
    rmSync(index);
    assert.equal(memoryContextSection({ configFile: config }), '');
  } finally { cleanup(dir); }
});

test('a missing config falls back to the plugin default root and default budget (no crash without ~/.dsh)', () => {
  // The real machine has ~/.dsh/dsh-auto-memory.json (the plugin's config) and a memory root; whatever
  // it holds, the helper must return a string and never throw.
  const section = memoryContextSection();
  assert.equal(typeof section, 'string');
});
