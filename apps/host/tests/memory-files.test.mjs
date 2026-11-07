/**
 * The memory panel's read layer, unit level: the plugin's own config names the root, the listing
 * is markdown-only and bounded, and a read can never leave the root (traversal refused).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { listMemoryFiles, memoryRoot, readMemoryFile } from '../server/memory-files.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };

test('the root comes from the plugin config when it exists, else the plugin default under ~/.dsh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-mem-'));
  try {
    const config = join(dir, 'dsh-auto-memory.json');
    writeFileSync(config, JSON.stringify({ memoryRoot: '~/dsh-memory/workspaces' }));
    assert.equal(memoryRoot(config), resolve(homedir(), 'dsh-memory/workspaces'), 'the ~ expands to the real home');
    writeFileSync(config, JSON.stringify({ userMemoryDir: join(dir, 'user-mem') }));
    assert.equal(memoryRoot(config), resolve(join(dir, 'user-mem')));
    assert.equal(memoryRoot(join(dir, 'absent.json')), resolve(homedir(), '.dsh', 'memory'), 'no config: the plugin default');
  } finally { cleanup(dir); }
});

test('the listing is markdown-only, bounded, newest first, and skips the noise', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-mem-list-'));
  try {
    mkdirSync(join(root, 'workspaces', 'proj-a'), { recursive: true });
    const old = join(root, 'MEMORY.md'), newer = join(root, 'workspaces', 'proj-a', 'decisions.md'), noise = join(root, 'state.json');
    writeFileSync(old, '# index');
    writeFileSync(newer, '- chose A');
    writeFileSync(noise, '{}');
    const now = Date.now();
    const future = now + 60_000;
    utimesSync(old, new Date(now - 5000), new Date(now - 5000));
    utimesSync(newer, new Date(future), new Date(future));
    const found = listMemoryFiles(root);
    assert.deepEqual(found.files.map(f => f.path === newer ? 'newer' : f.path === old ? 'old' : f.path), ['newer', 'old']);
    assert.equal(found.files.some(f => f.path === noise), false, 'non-markdown files are not memory');
    assert.equal(found.root, resolve(root));
    const cut = listMemoryFiles(root, { maxFiles: 1 });
    assert.equal(cut.files.length, 1);
  } finally { cleanup(root); }
});

test('a read stays inside the root and only markdown opens', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-mem-read-'));
  try {
    mkdirSync(join(root, 'inner'), { recursive: true });
    writeFileSync(join(root, 'MEMORY.md'), '# Memory index');
    writeFileSync(join(root, 'inner', 'notes.md'), 'typed notes');
    writeFileSync(join(root, 'secret.json'), '{"k":1}');
    assert.equal(readMemoryFile(root, 'MEMORY.md').content, '# Memory index');
    assert.equal(readMemoryFile(root, join('inner', 'notes.md')).content, 'typed notes');
    assert.throws(() => readMemoryFile(root, join('..', 'outside.md')), /outside the memory root/);
    assert.throws(() => readMemoryFile(root, 'secret.json'), /markdown/);
    assert.throws(() => readMemoryFile(root, ''), /outside the memory root|markdown/);
  } finally { cleanup(root); }
});
