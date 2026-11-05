/* P0-5: the shared write protocol for run configs — one writer at a time, atomic replaces,
   rotated backups. This is the Node side of strata_control/atomic.py's WriteLock +
   guarded_write (keep both sides in step: O_CREAT|O_EXCL lock file holding
   `pid timestamp rand`, stolen after 5 minutes, released only while our own token
   is still in it). */
import { chmodSync, copyFileSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export const CONFIG_LOCK_STALE_MS = 300000;   // 5 min — a crashed writer's leftover is stolen

/** Sync pause that works on the main thread (Atomics.wait throws there). */
function pause(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* busy: the held times here are single-digit milliseconds */ }
}

/** Run `fn()` while holding `<file>.lock`. Throws ELOCKED when another writer holds it past
    `timeoutMs`, steals a lock older than `staleMs` (a crashed writer's leftover), and releases
    only while our own token is still in the lock file (a stolen lock is never unlinked by us). */
export function withConfigLock(file, fn, { timeoutMs = 10000, staleMs = CONFIG_LOCK_STALE_MS } = {}) {
  const lock = `${file}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  const token = `${process.pid} ${(Date.now() / 1000).toFixed(6)} ${Math.floor(Math.random() * 2 ** 30)}`;
  const deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, 'wx');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) {
          unlinkSync(lock);                     // a crashed writer's leftover: steal it
          continue;
        }
      } catch { continue; }
      if (Date.now() >= deadline) {
        const err = new Error(`another writer holds ${lock}`);
        err.code = 'ELOCKED';
        throw err;
      }
      pause(50);
    }
  }
  try {
    writeSync(fd, token);
  } finally {
    closeSync(fd);
  }
  try {
    return fn();
  } finally {
    try {
      if (readFileSync(lock, 'utf8').trim() === token) unlinkSync(lock);
    } catch { /* a stolen lock is never unlinked by the writer that lost it */ }
  }
}

/** Rotate <file>.bak → .bak.1 → .bak.2 (the person's two most recent previous versions survive). */
export function rotateBackup(file) {
  const bak = `${file}.bak`, one = `${file}.bak.1`, two = `${file}.bak.2`;
  try { if (existsSyncSafe(one)) copyFileSync(one, two); } catch { /* a read-only copy is not fatal */ }
  try { if (existsSyncSafe(bak)) copyFileSync(bak, one); } catch { /* … */ }
}

function existsSyncSafe(p) {
  try { statSync(p); return true; } catch { return false; }
}

/** Write `next` as the run config at `path`: inside the config lock, with the previous version
    kept as .bak (rotated), written 0600 atomically (tmp + rename). */
export function writeConfigAtomic(path, next) {
  withConfigLock(path, () => {
    rotateBackup(path);                          // shift the previous backups first…
    try {
      copyFileSync(path, `${path}.bak`);         // …then snapshot the current version
      chmodSync(`${path}.bak`, 0o600);
    } catch { /* a first write has no previous version */ }
    const temp = `${path}.ui-tmp`;
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, JSON.stringify(next, null, 2) + '\n');
    } finally {
      closeSync(fd);
    }
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  });
}
