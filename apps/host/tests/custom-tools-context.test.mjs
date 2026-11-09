// The context_remaining tool (HARNESS_ROADMAP 阶段一 H4): the model can ask how much of its window is left, and the
// numbers are the ones the host executes (context-fit + profile.mjs), written by the host as one small JSON snapshot
// beside the custom tools file. The server re-reads the file on every call, so a new turn's numbers are current.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SERVER = fileURLToPath(new URL('../server/agent/custom-tools-mcp.mjs', import.meta.url));

async function withServer(t, snapshot) {
  const dir = mkdtempSync(join(tmpdir(), 'strata-ctx-'));
  const file = join(dir, 'context-budget.json');
  writeFileSync(file, JSON.stringify(snapshot));
  const child = spawn(process.execPath, [SERVER, 'context', file], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let line0 = null;
  const lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else lines.push(msg);
    }
  });
  let nextId = 0;
  const rpc = (method, params) => new Promise(resolve => { const id = ++nextId; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await new Promise(r => setTimeout(r, 150));
  t.after(async () => { child.kill(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } });
  return { rpc, lines, file, child };
}

test('the context mode serves context_remaining from the budget snapshot the host writes', async (t) => {
  const snapshot = { window: 32768, pressure: 9000, reply: 4096, headroom: 2048, room: 17632, compactAt: 24000 };
  const s = await withServer(t, snapshot);
  const list = await s.rpc('tools/list', {});
  assert.deepEqual(list.result.tools.map(t2 => t2.name), ['context_remaining']);
  assert.equal(list.result.tools[0].annotations.readOnlyHint, true, 'look-only: no approval for a number');

  const call = await s.rpc('tools/call', { name: 'context_remaining', arguments: {} });
  const text = call.result.content[0].text;
  for (const n of [snapshot.window, snapshot.pressure, snapshot.reply, snapshot.headroom, snapshot.room, snapshot.compactAt])
    assert.match(text, new RegExp(String(n)), `the answer carries ${n}`);
});

test('the answer follows the snapshot file: the numbers of a new turn are read on the next call', async (t) => {
  const s = await withServer(t, { window: 32768, pressure: 9000, reply: 4096, headroom: 2048, room: 17632, compactAt: 24000 });
  await s.rpc('tools/list', {});
  const first = await s.rpc('tools/call', { name: 'context_remaining', arguments: {} });
  assert.match(first.result.content[0].text, /17632/);
  writeFileSync(s.file, JSON.stringify({ window: 32768, pressure: 20000, reply: 4096, headroom: 2048, room: 6624, compactAt: 24000 }));
  const second = await s.rpc('tools/call', { name: 'context_remaining', arguments: {} });
  assert.match(second.result.content[0].text, /6624/, 'the refreshed snapshot is what the tool reads');
});

test('a snapshot without the numbers says the budget is not known yet', async (t) => {
  const s = await withServer(t, {});
  const call = await s.rpc('tools/call', { name: 'context_remaining', arguments: {} });
  assert.match(call.result.content[0].text, /not known yet|No budget/i, 'honest: nothing was measured');
});
