// The Settings switch "Native skill packs" must hide every folder it names, not only the last one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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

async function pack(folder, name, body) {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: a native pack\n---\n\n${body}\n`);
}

test('the native skill-pack switch hides every native folder, and turning it back on restores them', { timeout: 60000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'strata-skill-toggle-home-'));
  const userHome = await mkdtemp(join(tmpdir(), 'strata-skill-toggle-user-'));
  await pack(join(userHome, '.kimi-code', 'skills', 'pack-ns'), 'pack-ns', 'From the Kimi folder.');
  await pack(join(userHome, '.agents', 'skills', 'pack-na'), 'pack-na', 'From the agents folder.');
  await pack(join(userHome, '.cc-switch', 'skills', 'pack-nc'), 'pack-nc', 'From the switch folder.');
  const host = await startHost(home, userHome);
  try {
    const ids = async () => (await host.call('/api/skills')).data.map(s => s.id);
    const first = await ids();
    for (const id of ['ns-pack-ns', 'na-pack-na', 'nc-pack-nc'])
      assert.ok(first.includes(id), `${id} lists while the switch is on`);

    assert.equal((await host.call('/api/features', 'PUT', { skillsNative: false })).status, 200);
    const off = await ids();
    for (const id of ['ns-pack-ns', 'na-pack-na', 'nc-pack-nc'])
      assert.ok(!off.includes(id), `${id} is gone while the switch is off`);
    assert.ok(off.length > 0, 'the bundled and app skills stay listed');

    assert.equal((await host.call('/api/features', 'PUT', { skillsNative: true })).status, 200);
    const again = await ids();
    for (const id of ['ns-pack-ns', 'na-pack-na', 'nc-pack-nc'])
      assert.ok(again.includes(id), `${id} comes back when the switch is on again`);
  }
  finally {
    await host.stop();
    await rm(home, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  }
});
