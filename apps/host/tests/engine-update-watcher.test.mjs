import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineUpdateWatcher, hasEngineUpdate } from '../server/engine-update-watcher.mjs';

/** The engine updates on its own schedule, apart from the app (the person's ask, 2026-11-06):
 * a quiet watcher checks on start and daily, caches the engine view, and the settings page can
 * show the badge without a hand-pressed check. Never throws, never blocks the host. */

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'strata-euw-'));
  return { dir, after: () => rmSync(dir, { recursive: true, force: true }) };
}

test('hasEngineUpdate is true only for an available (or installable) engine', () => {
  assert.equal(hasEngineUpdate({ status: 'available' }), true);
  assert.equal(hasEngineUpdate({ status: 'install' }), true);
  assert.equal(hasEngineUpdate({ status: 'current' }), false);
  assert.equal(hasEngineUpdate({ status: 'unavailable' }), false);
  assert.equal(hasEngineUpdate(null), false);
});

test('the watcher checks on start, caches the engine view, and says when it was checked', async t => {
  const f = fixture(); t.after(f.after);
  const views = [
    { status: 'available', installedVersion: '0.1.57', latestVersion: '0.1.58' },
    { status: 'current', installedVersion: '0.1.58' },
  ];
  let calls = 0;
  const watcher = createEngineUpdateWatcher({ check: async () => ({ engine: views[calls++], strata: {} }), intervalMs: 60_000, initialDelayMs: 0 });
  const first = await watcher.firstCheck();
  assert.equal(first.checkedAt instanceof Date, false); // an ISO string, not a Date, over the wire
  assert.equal(typeof first.checkedAt, 'string');
  assert.equal(first.engine.status, 'available');
  assert.equal(hasEngineUpdate(first.engine), true);
  const again = await watcher.poke();
  assert.equal(again.engine.status, 'current');
  assert.equal(hasEngineUpdate(again.engine), false);
  watcher.stop();
});

test('a failing check never throws: the last good view stands with an error note', async t => {
  const f = fixture(); t.after(f.after);
  let calls = 0;
  const watcher = createEngineUpdateWatcher({
    check: async () => {
      calls++;
      if (calls === 1) return { engine: { status: 'current' }, strata: {} };
      throw new Error('no route to host');
    },
    intervalMs: 60_000, initialDelayMs: 0,
  });
  await watcher.firstCheck();
  const after = await watcher.poke();
  assert.equal(after.engine.status, 'current');
  assert.match(after.error, /no route to host/);
  watcher.stop();
});

test('state before any check is honest emptiness', () => {
  const f = fixture();
  const watcher = createEngineUpdateWatcher({ check: async () => ({ engine: { status: 'current' } }), intervalMs: 60_000, initialDelayMs: 999_999 });
  const s = watcher.state();
  assert.equal(s.checkedAt, null);
  assert.deepEqual(s.engine, null);
  watcher.stop();
  f.after();
});
