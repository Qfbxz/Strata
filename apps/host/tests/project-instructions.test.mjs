/**
 * The CLAUDE.md / AGENTS.md project-instruction loader, unit level: both files read when both
 * exist, the walk-up reaches a project root's instructions from a subfolder, an empty file does
 * not count, and the section renders one labeled block per file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectInstructions, projectInstructionsSection } from '../server/project-instructions.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };

test('CLAUDE.md is read first, AGENTS.md joins it, and the walk-up reaches them from a subfolder', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-proj-'));
  try {
    writeFileSync(join(root, 'CLAUDE.md'), "Answer in the project's tone.");
    writeFileSync(join(root, 'AGENTS.md'), 'Never commit to the shared branch.');
    mkdirSync(join(root, 'deep', 'deeper'), { recursive: true });
    const deep = join(root, 'deep', 'deeper');
    const found = projectInstructions(deep);
    assert.deepEqual(found.map(i => i.file), ['CLAUDE.md', 'AGENTS.md']);
    assert.match(found[0].text, /project's tone/);
    assert.match(found[1].text, /shared branch/);
    const section = projectInstructionsSection(found);
    assert.match(section, /Project instructions from CLAUDE\.md/);
    assert.match(section, /Project instructions from AGENTS\.md/);
    // no files anywhere above: null
    const bare = mkdtempSync(join(tmpdir(), 'strata-proj-bare-'));
    try { assert.equal(projectInstructions(bare), null); assert.equal(projectInstructionsSection(null), ''); } finally { cleanup(bare); }
  } finally { cleanup(root); }
});

test('an empty file does not count, and each file is bounded with the cut marked', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-proj2-'));
  try {
    writeFileSync(join(root, 'CLAUDE.md'), '   ');
    const found = projectInstructions(root);
    assert.equal(found, null);
    const long = 'x'.repeat(5000);
    writeFileSync(join(root, 'CLAUDE.md'), long);
    const cut = projectInstructions(root, { maxChars: 4000 });
    assert.ok(cut[0].text.length < 4500);
    assert.match(cut[0].text, /…$/);
  } finally { cleanup(root); }
});
