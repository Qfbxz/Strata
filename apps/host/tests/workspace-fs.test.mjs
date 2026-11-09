import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceFs } from '../server/workspace-fs.mjs';
import { execSync } from 'node:child_process';

/** The right-side workspace panel's server half: a file tree, a bounded file reader and a
 * whitelisted git view over ONE chat root (the same root the chat's files live in). Paths
 * outside the root are refused (the path-guard discipline), binaries are named not dumped,
 * and git ops are a fixed menu. */

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'strata-wsfs-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# hello\n中文内容行\n');
  writeFileSync(join(root, 'src', 'main.py'), 'print("hi")\n');
  writeFileSync(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 254]));
  return root;
}

test('the tree lists one directory level with kinds and sizes', () => {
  const root = fixture();
  t_after(root);
  const ws = createWorkspaceFs({ root });
  const rows = ws.list('');
  const names = rows.map(r => r.name);
  assert.deepEqual(names.sort(), ['README.md', 'blob.bin', 'src'].sort());
  const src = rows.find(r => r.name === 'src');
  assert.equal(src.dir, true);
  const file = rows.find(r => r.name === 'README.md');
  assert.equal(file.dir, false);
  assert.ok(file.size > 0);
});

test('a path that leaves the root is refused, whatever shape it takes', () => {
  const root = fixture();
  t_after(root);
  const ws = createWorkspaceFs({ root });
  for (const bad of ['../outside.txt', '..', 'src/../../secret', '/etc/passwd']) {
    assert.throws(() => ws.list(bad), /inside/, `list(${bad}) refused`);
    assert.throws(() => ws.read(bad), /inside/, `read(${bad}) refused`);
  }
});

test('a text file reads with its content; a binary is named, never dumped', () => {
  const root = fixture();
  t_after(root);
  const ws = createWorkspaceFs({ root });
  const md = ws.read('README.md');
  assert.equal(md.binary, false);
  assert.ok(md.content.includes('中文内容行'));
  const bin = ws.read('blob.bin');
  assert.equal(bin.binary, true);
  assert.equal(bin.content, undefined, 'binary content stays on the disk');
});

test('a read over the byte cap comes back truncated, with the real size stated', () => {
  const root = fixture();
  t_after(root);
  const ws = createWorkspaceFs({ root, maxBytes: 8 });
  const md = ws.read('README.md');
  assert.equal(md.truncated, true);
  assert.ok(md.content.length <= 8);
  assert.ok(md.size > 8);
});

test('git views answer through the fixed menu and nothing else', () => {
  const root = fixture();
  t_after(root);
  execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm one', { cwd: root });
  const ws = createWorkspaceFs({ root });
  const log = ws.git('log');
  assert.match(log, /one/);
  const status = ws.git('status');
  assert.match(status, /^## /, 'status --short --branch opens with the branch line');
  assert.throws(() => ws.git('push'), /menu/, 'push is not on the menu');
  assert.throws(() => ws.git('log; rm -rf /'), /menu/, 'no shell through the menu');
});

function t_after(root) { process.on('exit', () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })); }
