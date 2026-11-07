/**
 * The auto-memory plugin, placement level: the package the profile registers as `auto-memory`
 * (dsh-auto-memory) is really in the harness bundle's node_modules, really loads, and really
 * exports what a Harness plugin must export. A copy that was placed but cannot load is the
 * failure mode this test exists to catch (the plugin reads its own config from the harness home
 * at boot, so loading it is the honest smoke).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTO_MEMORY_PLUGIN } from '../server/agent/profile.mjs';

const bundleRoot = fileURLToPath(new URL('../../../apps/desktop/src-tauri/resources/harness/', import.meta.url));

test('the auto-memory plugin is in the harness bundle and loads as a Harness plugin', async () => {
  const pkg = 'node_modules/' + AUTO_MEMORY_PLUGIN;
  assert.equal(AUTO_MEMORY_PLUGIN, 'dsh-auto-memory');
  assert.ok(existsSync(bundleRoot + pkg + '/package.json'), 'the plugin package is placed in the repo harness bundle');
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(bundleRoot + pkg + '/package.json', 'utf8'));
  assert.equal(manifest.name, 'dsh-auto-memory');
  const loaded = await import(bundleRoot + pkg + '/lib/index.js');
  for (const face of ['name', 'apply', 'inject', 'Config']) assert.ok(loaded[face] !== undefined, `the plugin exports ${face}`);
});
