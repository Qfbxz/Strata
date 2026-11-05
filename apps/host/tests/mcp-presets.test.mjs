import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled = await build({stdin: {contents: "export * from './src/lib/mcp-presets';", resolveDir: process.cwd()}, bundle: true, write: false, platform: 'node', format: 'esm'});
const {MCP_PRESETS} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const {mcpRows} = await import('../server/agent/profile.mjs');

test('every preset is a real, wireable MCP server entry', () => {
  const env = {};
  const skipped = [];
  const servers = Object.fromEntries(MCP_PRESETS.map(p => [p.name, p.server]));
  const rows = mcpRows(servers, env, skipped);
  assert.equal(skipped.length, 0, `nothing dropped: ${JSON.stringify(skipped)}`);
  assert.equal(rows.length, MCP_PRESETS.length);
  for (const p of MCP_PRESETS) {
    assert.ok(p.server.command || p.server.url, `${p.id}: a command or a url`);
    assert.ok(p.about.length > 10, `${p.id}: a sentence about what it does`);
  }
});

test('the preset names the screen offers include the ones on this machine', () => {
  const ids = MCP_PRESETS.map(p => p.id);
  for (const wanted of ['playwright', 'screenhand']) assert.ok(ids.includes(wanted), `${wanted} is preset`);
});

test('the editor offers the presets as one-click fills (source canary)', async () => {
  const {readFile} = await import('node:fs/promises');
  const {resolve} = await import('node:path');
  const src = await readFile(resolve(import.meta.dirname, '../src/components/NativeMcpEditor.tsx'), 'utf8');
  assert.ok(src.includes('MCP_PRESETS'), 'the editor imports the preset catalog');
  assert.ok(src.includes('Known tool servers'), 'a one-click row heads the editor');
});
