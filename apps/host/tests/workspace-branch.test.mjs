/**
 * The branch manager's write op, unit level: checkout takes a plain branch name only (strict
 * refname guard — no flags, ranges, refspec magic, .lock or trailing slash), switches the real
 * repository, and surfaces git's own refusal for a name that does not exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceFs } from '../server/workspace-fs.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };

function repoWithBranches() {
  const root = mkdtempSync(join(tmpdir(), 'strata-branch-'));
  const git = (...args) => execFileSync('git', args, { cwd: root });
  git('init', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'one');
  git('add', '.'); git('add', 'a.txt');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'one');
  git('switch', '-c', 'feature/x');
  writeFileSync(join(root, 'b.txt'), 'two');
  git('add', 'b.txt');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'two');
  git('switch', 'main');
  return root;
}

test('checkout switches to a real branch and reports the switch', () => {
  const root = repoWithBranches();
  try {
    const ws = createWorkspaceFs({ root });
    const out = String(ws.git('checkout', 'feature/x'));
    assert.match(out, /Switched to feature\/x/);
    assert.equal(ws.git('status', '--short', '--branch').split('\n')[0], '## feature/x');
    assert.match(String(ws.git('checkout', 'main')), /Switched to main/);
  } finally { cleanup(root); }
});

test('the refname guard refuses flags, ranges, refspec magic, .lock and trailing slash', () => {
  const root = repoWithBranches();
  try {
    const ws = createWorkspaceFs({ root });
    for (const bad of ['--amend', '-b evil', 'a..b', 'HEAD^', 'refs/heads/x@{y}', 'pwn.lock', 'main/']) {
      assert.throws(() => ws.git('checkout', bad), /not a branch name/, bad);
    }
    // and the repo is untouched by every refusal
    assert.match(String(ws.git('status', '--short', '--branch')), /## main/);
  } finally { cleanup(root); }
});

test('git\'s own refusal for a missing branch surfaces as a plain error', () => {
  const root = repoWithBranches();
  try {
    const ws = createWorkspaceFs({ root });
    assert.throws(() => ws.git('checkout', 'no-such-branch'), /failed/);
  } finally { cleanup(root); }
});
