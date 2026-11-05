/* P0-5 Node-side contract for server/config-write.mjs — the same protocol as
   strata_control/atomic.py's WriteLock + guarded_write (exclusivity, 5-minute
   stale stealing, token-verified release, rotated backups, atomic 0600 writes). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, utimesSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withConfigLock, writeConfigAtomic } from '../server/config-write.mjs';

test('the lock is exclusive until released', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfglock-'));
  const file = join(dir, 'strata-a.json');
  writeFileSync(`${file}.lock`, '999999 0 foreign');
  assert.throws(() => withConfigLock(file, () => 1), /another writer holds/, { code: 'ELOCKED' });
});

test('a stale lock older than 5 minutes is stolen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfglock-'));
  const file = join(dir, 'strata-b.json');
  writeFileSync(`${file}.lock`, '999999 0 stale-crashed-writer');
  const old = new Date(Date.now() - 6 * 60000);
  utimesSync(`${file}.lock`, old, old);
  let ran = false;
  withConfigLock(file, () => { ran = true; });
  assert.ok(ran, 'the leftover was stolen without waiting the timeout');
  assert.ok(!existsSync(`${file}.lock`), 'the lock is released after the write');
});

test('writeConfigAtomic writes 0600 atomically and rotates backups', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfglock-'));
  const file = join(dir, 'strata-c.json');
  writeFileSync(file, '{"exe":"e1","args":["--one"]}', { mode: 0o600 });
  writeConfigAtomic(file, { exe: 'e2', args: ['--two'] });
  writeConfigAtomic(file, { exe: 'e3', args: ['--three'] });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).exe, 'e3');
  assert.equal(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).exe, 'e2', 'the previous version is .bak');
  assert.equal(JSON.parse(readFileSync(`${file}.bak.1`, 'utf8')).exe, 'e1', 'and .bak.1 keeps the one before');
  const mode = statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, 'run configs stay 0600');
  const leftovers = readdirSync(dir).filter((f) => f.includes('.ui-tmp') || f.includes('.tmp-'));
  assert.deepEqual(leftovers, [], 'no temp files survive the write');
});
