/**
 * The batch skill import, unit level: the scan finds every `<skill>/SKILL.md` folder under an
 * outer directory (nested, bounded, skipping the folders that never hold skills), and the
 * destination naming pastes a `-2`, `-3` … suffix instead of failing on a name that is taken.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkillFolders, uniqueDest, SCAN_SKIP_DIRS } from '../server/skill-scan.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };
const makeSkill = (dir, { name, title, description, body = 'Do the thing.' }) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${title ? `title: ${JSON.stringify(title)}\n` : ''}${description ? `description: ${JSON.stringify(description)}\n` : ''}---\n\n${body}\n`);
};

test('the scan finds skills nested at several depths, with the words each frontmatter carries', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-skill-scan-'));
  try {
    makeSkill(join(root, 'code-review'), { name: 'code-review', title: 'Code review', description: 'Review a diff' });
    makeSkill(join(root, 'writing', 'drafts', 'outline'), { name: 'outline', description: 'Draft an outline' });
    makeSkill(join(root, 'a', 'b', 'c', 'd', 'deep-one'), { name: 'deep-one' });
    const found = scanSkillFolders(root);
    // The scan promises "found", not an order: walk order follows the filesystem's own listing order.
    assert.deepEqual(found.candidates.map(c => c.name).sort(), ['code-review', 'deep-one', 'outline']);
    const byName = Object.fromEntries(found.candidates.map(c => [c.name, c]));
    assert.deepEqual([byName['code-review'].title, byName['outline'].title, byName['deep-one'].title], ['Code review', null, null]);
    assert.deepEqual([byName['code-review'].description, byName['outline'].description, byName['deep-one'].description], ['Review a diff', 'Draft an outline', null]);
    assert.ok(found.candidates.every(c => c.bodyChars > 0));
    assert.equal(found.truncated, false);
    assert.equal(found.root, root);
  } finally { cleanup(root); }
});

test('a skill folder is a leaf: its own subfolders are files of that skill, not more skills', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-skill-scan-'));
  try {
    makeSkill(join(root, 'big-skill'), { name: 'big-skill' });
    makeSkill(join(root, 'big-skill', 'assets', 'inner'), { name: 'inner' });
    const found = scanSkillFolders(root);
    assert.deepEqual(found.candidates.map(c => c.name), ['big-skill']);
  } finally { cleanup(root); }
});

test('folders that never hold skills are neither reported nor walked', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-skill-scan-'));
  try {
    makeSkill(join(root, 'node_modules', 'a-package'), { name: 'a-package' });
    makeSkill(join(root, '.git', 'hooks'), { name: 'hooks' });
    makeSkill(join(root, '.hidden-collection'), { name: 'hidden' });
    makeSkill(join(root, 'dist', 'bundle'), { name: 'bundle' });
    makeSkill(join(root, 'real-one'), { name: 'real-one' });
    const found = scanSkillFolders(root);
    assert.deepEqual(found.candidates.map(c => c.name), ['real-one']);
    // and the skipped names are the reason: nothing under them was even looked at
    assert.ok(SCAN_SKIP_DIRS.has('node_modules') && SCAN_SKIP_DIRS.has('dist'));
  } finally { cleanup(root); }
});

test('the scan stops at its depth bound and at its result bound, and says so', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-skill-scan-'));
  try {
    makeSkill(join(root, 'a', 'b', 'c', 'd', 'e', 'too-deep'), { name: 'too-deep' });
    const found = scanSkillFolders(root, { maxDepth: 2 });
    assert.deepEqual(found.candidates, []);
    for (let i = 0; i < 5; i++) makeSkill(join(root, 'many', `skill-${i}`), { name: `skill-${i}` });
    const cut = scanSkillFolders(join(root, 'many'), { maxResults: 3 });
    assert.equal(cut.candidates.length, 3);
    assert.equal(cut.truncated, true);
  } finally { cleanup(root); }
});

test('a folder that cannot be read is skipped quietly; an unreadable SKILL.md stays a candidate without its words', () => {
  const ok = { withFileTypes: true };
  const dirs = {
    '/tree': [{ name: 'locked', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }, { name: 'open', isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }],
    '/tree/locked': new Error('permission denied'),
    '/tree/open': [{ name: 'SKILL.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }],
  };
  const io = {
    readdirSync(dir) { const e = dirs[dir]; if (e instanceof Error) throw e; return e; },
    readFileSync(path) { if (path === '/tree/open/SKILL.md') throw new Error('locked file'); return ''; },
  };
  const found = scanSkillFolders('/tree', { io });
  assert.deepEqual(found.candidates.map(c => c.name), ['open']);
  assert.deepEqual([found.candidates[0].title, found.candidates[0].description, found.candidates[0].bodyChars], [null, null, 0]);
  assert.ok(ok); // real fs callers pass { withFileTypes: true }; kept as documentation of the shape the io contract accepts
});

test('the import destination keeps its name when free, and takes a -2/-3 suffix when the name is taken', () => {
  assert.equal(uniqueDest('review', () => false), 'review');
  assert.equal(uniqueDest('review', name => name === 'review'), 'review-2');
  assert.equal(uniqueDest('review', name => name === 'review' || name === 'review-2'), 'review-3');
});

test('a symlinked skill folder, a symlinked collection and a symlinked SKILL.md are all found; a symlink cycle ends quietly', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-skill-scan-'));
  try {
    const outside = mkdtempSync(join(tmpdir(), 'strata-skill-farm-'));
    makeSkill(join(outside, 'far-skill'), { name: 'far-skill', description: 'Lives outside the tree' });
    // a symlinked skill folder and a symlinked whole collection sit inside the scanned tree
    symlinkSync(join(outside, 'far-skill'), join(root, 'linked-skill'), 'dir');
    symlinkSync(outside, join(root, 'linked-collection'), 'dir');
    // a skill whose SKILL.md is a symlink to a file elsewhere
    mkdirSync(join(root, 'linked-md'), { recursive: true });
    writeFileSync(join(outside, 'real-notes.md'), '---\nname: linked-md\ndescription: Notes live elsewhere\n---\n\nBody.\n');
    symlinkSync(join(outside, 'real-notes.md'), join(root, 'linked-md', 'SKILL.md'), 'file');
    // a cycle: a folder holding a link back to itself must not hang the walk
    makeSkill(join(root, 'loop', 'loop-real'), { name: 'loop-real' });
    symlinkSync(root, join(root, 'loop', 'self'), 'dir');

    const found = scanSkillFolders(root);
    // 'linked-skill' and 'linked-collection' both lead to the same real folder as their first
    // visitor, so 'far-skill' is reported once, under its own folder's name; a candidate is
    // always named for the folder the walk stood in.
    assert.deepEqual(found.candidates.map(c => c.name).sort(), ['far-skill', 'linked-md', 'loop-real']);
    const byName = Object.fromEntries(found.candidates.map(c => [c.name, c]));
    assert.equal(byName['linked-md'].description, 'Notes live elsewhere');
    assert.equal(found.candidates.filter(c => c.name === 'far-skill').length, 1);
  } finally { cleanup(root); }
});
