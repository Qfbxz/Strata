/**
 * The persona resolver, unit level: a helper spawned with `persona: "<agents id>"` gets the
 * file's instructions injected (file and folder shapes), an unknown id passes through untouched,
 * and nothing runs when no agents folders are configured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, personaInstructions } from '../server/agent/plugins/strata-persona.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };

function harnessWith(dirs) {
  const seen = [];
  const ctx = { on(event, handler) { if (event === 'tools/pre-execute') seen.push(handler); } };
  apply(ctx, { agentsDirs: dirs });
  assert.equal(seen.length, 1, 'the resolver registered one pre-execute handler');
  return seen[0];
}

test('a registered id resolves to the file instructions; folder and file shapes both work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-persona-'));
  try {
    writeFileSync(join(dir, 'reviewer.md'), '---\nname: reviewer\ntools: read, grep, shell\n---\n\nCheck every report.');
    mkdirSync(join(dir, 'planner'));
    writeFileSync(join(dir, 'planner', 'AGENT.md'), 'Plan before acting.');
    assert.deepEqual(personaInstructions(dir, 'reviewer'), { instructions: 'Check every report.', tools: ['read', 'grep', 'shell'] });
    assert.deepEqual(personaInstructions(dir, 'planner'), { instructions: 'Plan before acting.', tools: null });
    assert.equal(personaInstructions(dir, 'nope'), null);
    assert.equal(personaInstructions(dir, '../reviewer'), null, 'a slash means a path, not an id — refused');
  } finally { cleanup(dir); }
});

test('the pre-execute hook rewrites a registered persona in place and passes unknown ones through', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-persona2-'));
  try {
    writeFileSync(join(dir, 'reviewer.md'), '---\nname: reviewer\ntools: read, grep, shell\n---\n\nCheck every report.');
    const handler = harnessWith([dir]);
    const spawn = { name: 'subagent', arguments: { persona: 'reviewer', prompt: 'check this' } };
    let forwarded = null;
    return Promise.resolve(handler(spawn, e => { forwarded = e; return 'ran'; })).then(out => {
      assert.equal(out, 'ran');
      assert.match(spawn.arguments.persona, /Check every report\./);
      assert.match(spawn.arguments.persona, /You are working as the agent "reviewer"/);
      assert.equal(spawn.arguments.prompt, 'check this', 'the rest of the spawn is untouched');
      assert.deepEqual(spawn.arguments.toolFilter, { allow: ['read', 'grep', 'shell'] });
      assert.equal(forwarded, spawn, 'the same exec object is forwarded');
      // an unregistered persona passes through unchanged
      const other = { name: 'subagent', arguments: { persona: 'someone-else' } };
      return handler(other, e => { assert.equal(e.arguments.persona, 'someone-else'); assert.equal(e.arguments.toolFilter, undefined); return 'ran'; });
    });
  } finally { cleanup(dir); }
});

test('other tools never touch the spawn, and a folder-less config registers nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-persona3-'));
  try {
    writeFileSync(join(dir, 'reviewer.md'), '---\nname: reviewer\ntools: read, grep, shell\n---\n\nCheck every report.');
    const handler = harnessWith([dir]);
    const exec = { name: 'web_search', arguments: { query: 'x' } };
    let ran = false;
    return Promise.resolve(handler(exec, () => { ran = true; return 'ran'; })).then(() => {
      assert.equal(ran, true);
      assert.deepEqual(exec.arguments, { query: 'x' });
      // no agents folders configured: the plugin registers nothing at all
      const seen = [];
      const ctx = { on(event, handler2) { if (event === 'tools/pre-execute') seen.push(handler2); } };
      apply(ctx, { agentsDirs: [] });
      assert.equal(seen.length, 0, 'an empty configuration installs no resolver');
    });
  } finally { cleanup(dir); }
});
