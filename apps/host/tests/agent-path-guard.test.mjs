/* P0-8 F2 contract for server/agent/path-guard.mjs — the Manual gate's read-only fast lane is
   fail-closed: an operand is exempt from approval only when it provably resolves INSIDE the
   chat's working directory. Everything else is reported outside and becomes an ask. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidatesFromCommand, fsToolOutside, outsidePaths, shellCommandOutside } from '../server/agent/path-guard.mjs';

function chat() {
  const cwd = realpathSync(mkdirSync(join(tmpdir(), 'guard-' + Math.random().toString(36).slice(2)), { recursive: true }));
  writeFileSync(join(cwd, 'notes.md'), 'hello');
  return cwd;
}

test('a read inside the chat folder needs no question', () => {
  const cwd = chat();
  assert.deepEqual(shellCommandOutside(cwd, 'cat ./notes.md'), []);
  assert.deepEqual(fsToolOutside(cwd, { file_path: './a.txt' }), []);
});

test('reads outside the chat folder are reported', () => {
  const cwd = chat();
  for (const cmd of ['cat ../secret.txt', 'cat /etc/passwd', 'cat ~/.ssh/id_rsa']) {
    const out = shellCommandOutside(cwd, cmd);
    assert.ok(out.length, `${cmd} must be reported (got ${JSON.stringify(out)})`);
  }
});

test('a symlink escape is caught through realpath', () => {
  const cwd = chat();
  const outside = join(tmpdir(), 'guard-outside-' + Math.random().toString(36).slice(2) + '.txt');
  writeFileSync(outside, 'secret');
  symlinkSync(outside, join(cwd, 'link'));
  const out = shellCommandOutside(cwd, 'cat link');
  assert.ok(out.includes('link'), `the symlink escape must be reported (got ${JSON.stringify(out)})`);
});

test('flag values and plain operands are both checked', () => {
  const cwd = chat();
  assert.ok(shellCommandOutside(cwd, 'grep -f /etc/passwd pattern').includes('/etc/passwd'));
  assert.ok(shellCommandOutside(cwd, 'git diff --no-index /etc/passwd /etc/hosts').includes('/etc/passwd'));
});

test('a Windows drive path on a Mac is outside by definition', () => {
  const cwd = chat();
  assert.ok(shellCommandOutside(cwd, 'Get-Content C:\\Users\\x\\.ssh\\id_rsa').length > 0);
});

test('quoted data without separators gains no friction', () => {
  const cwd = chat();
  assert.deepEqual(shellCommandOutside(cwd, "rg 'TODO'"), []);
  assert.deepEqual(shellCommandOutside(cwd, "rg 'a|b' 'x&y'"), []);
});

test('fs tools: the directory part is proven inside', () => {
  const cwd = chat();
  assert.deepEqual(fsToolOutside(cwd, { file_path: '../../.ssh/id_rsa' }).length > 0, true);
  assert.deepEqual(fsToolOutside(cwd, { path: '/etc/hosts' }).length > 0, true);
});

test('no cwd: everything is outside (fail-closed)', () => {
  assert.deepEqual(outsidePaths(null, ['./notes.md']), ['./notes.md']);
  assert.ok(shellCommandOutside(null, 'cat ./notes.md').length > 0);
});

test('candidatesFromCommand skips bare flags but keeps --flag=value forms', () => {
  const cwd = chat();
  const got = candidatesFromCommand('grep --ignore-file=../x.cfg --count TODO ./notes.md', cwd);
  assert.ok(got.includes('../x.cfg'), JSON.stringify(got));
  assert.ok(got.includes('./notes.md'), JSON.stringify(got));
  assert.ok(!got.includes('--count'), JSON.stringify(got));
});
