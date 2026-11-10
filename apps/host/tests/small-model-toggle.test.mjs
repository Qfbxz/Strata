// The Settings switch "Small model sidecar" (E3) saves to the store and answers a merged view;
// an off sidecar stays off, and a wrong body is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function startHost(home, userHome) {
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...process.env, HOME: userHome, STRATA_HOME: home, STRATA_MODELS_DIR: join(home, 'models'), STRATA_PORT: String(port), STRATA_REAL_ENGINE: '0', STRATA_WORKSPACE: join(home, 'work') },
    stdio: 'ignore', windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  for (let i = 0; i < 100; i++) { try { if ((await call('/api/skills')).status === 200) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
  const stopped = new Promise(r => child.once('exit', r));
  return { call, stop: async () => { child.kill(); await stopped; } };
}

test('the small-model switch saves its settings and answers them merged over the defaults', { timeout: 60000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'strata-small-model-home-'));
  const userHome = await mkdtemp(join(tmpdir(), 'strata-small-model-user-'));
  const host = await startHost(home, userHome);
  try {
    const first = await host.call('/api/small-model');
    assert.equal(first.status, 200);
    assert.equal(first.data.enabled, false, 'the sidecar is off by default');
    assert.equal(first.data.idleUnloadS, 300);

    const saved = await host.call('/api/small-model', 'PUT', { enabled: true, idleUnloadS: 120, exe: '/engines/llama-server', model: '/m/vl.gguf', mmproj: '/m/mm.gguf', evil: 'x' });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.enabled, true);
    assert.equal(saved.data.idleUnloadS, 120);
    assert.equal(saved.data.evil, undefined, 'unknown keys are dropped, not invented');

    const again = await host.call('/api/small-model');
    assert.equal(again.data.enabled, true, 'the saved settings survive a fresh read');
    assert.equal(again.data.exe, '/engines/llama-server');

    const off = await host.call('/api/small-model', 'PUT', { enabled: false });
    assert.equal(off.status, 200);
    assert.equal(off.data.enabled, false);
  } finally { await host.stop(); await rm(home, { recursive: true, force: true }); await rm(userHome, { recursive: true, force: true }); }
});

test('a wrong small-model value is ignored, not invented, and the rest saves', { timeout: 60000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'strata-small-model-bad-'));
  const userHome = await mkdtemp(join(tmpdir(), 'strata-small-model-badu-'));
  const host = await startHost(home, userHome);
  try {
    const bad = await host.call('/api/small-model', 'PUT', { idleUnloadS: 'later', enabled: true, exe: '/e/llama-server' });
    assert.equal(bad.status, 200, 'the host ignores a wrong value the way the guard settings do');
    assert.equal(bad.data.idleUnloadS, 300, 'the wrong idle window fell back to the default');
    assert.equal(bad.data.enabled, true, 'the good keys in the same body still saved');
    assert.equal(bad.data.exe, '/e/llama-server');
    const after = await host.call('/api/small-model');
    assert.equal(after.data.idleUnloadS, 300);
    assert.equal(after.data.enabled, true);
  } finally { await host.stop(); await rm(home, { recursive: true, force: true }); await rm(userHome, { recursive: true, force: true }); }
});
