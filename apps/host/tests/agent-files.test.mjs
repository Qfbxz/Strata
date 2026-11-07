/**
 * The agents/ and hooks/ directories, unit level: what a Claude-Code-style agent file parses
 * into, how collections nest and dedupe across the app and workspace folders, and how hook
 * scripts are discovered and run with the payload on stdin (a pre-turn nonzero exit vetoes).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentCatalogSection, agentPersonaSection, parseAgentFile, scanAgentDirs } from '../server/agent-files.mjs';
import { runEventHooks, scanHookDirs } from '../server/turn-hooks.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };
const writeAgent = (dir, slug, text, folder = false) => {
  const path = folder ? join(dir, slug, 'AGENT.md') : join(dir, `${slug}.md`);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
};
const AGENT_MD = `---
name: Petro Reviewer
description: Reviews drilling reports against the standard
tools: read, grep, shell
model: qwen3.8-flash-next
---
Check every report against the standard. Refuse guesses.
`;

test('one agent file parses into name, description, tools, model and the instructions under the frontmatter', () => {
  const parsed = parseAgentFile(AGENT_MD);
  assert.deepEqual(
    { name: parsed.name, description: parsed.description, tools: parsed.tools, model: parsed.model },
    { name: 'Petro Reviewer', description: 'Reviews drilling reports against the standard', tools: ['read', 'grep', 'shell'], model: 'qwen3.8-flash-next' });
  assert.equal(parsed.instructions, 'Check every report against the standard. Refuse guesses.');
  // a tools YAML list and a bare file both work; no instructions means no agent
  const listed = parseAgentFile('---\nname: x\ntools:\n  - read\n  - edit\n---\nBody here.');
  assert.deepEqual(listed.tools, ['read', 'edit']);
  assert.deepEqual(parseAgentFile('---\nname: empty\n---\n'), { name: 'empty', description: null, tools: null, model: null, instructions: '' });
  const bare = parseAgentFile('Just instructions, no frontmatter.');
  assert.equal(bare.instructions, 'Just instructions, no frontmatter.');
  assert.equal(bare.name, null);
});

test('the scan finds agents as files and as folders, nests one collection level, and the app folder wins a clash', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-agents-'));
  const app = join(root, 'app'), work = join(root, 'work');
  try {
    writeAgent(app, 'reviewer', AGENT_MD);
    writeAgent(app, 'collection', '---\nname: nested-one\ndescription: nested\n---\nA.', true);
    writeAgent(join(app, 'collections'), 'nested-two', '---\nname: nested-two\n---\nB.', true);
    // the same agent name in the workspace folder: the app folder's copy wins
    writeAgent(work, 'reviewer', AGENT_MD.replace('Reviews drilling', 'WORKSIDE Reviews drilling'));
    // a different name in the workspace folder: a different agent, both are listed
    writeAgent(work, 'helper', '---\nname: Workspace Helper\ndescription: helps in this workspace\n---\nHelp.');
    mkdirSync(join(work, 'not-an-agent'));
    writeFileSync(join(work, 'not-an-agent', 'notes.txt'), 'no AGENT here');
    const found = scanAgentDirs([app, work]);
    const ids = found.map(a => a.id).sort();
    assert.deepEqual(ids, ['nested-one', 'nested-two', 'petro-reviewer', 'workspace-helper']);
    // the app folder's copy wins the name clash
    assert.equal(found.find(a => a.id === 'petro-reviewer').description, 'Reviews drilling reports against the standard');
    assert.equal(found.find(a => a.id === 'nested-one').instructions, 'A.');
    // folder agents carry their path
    assert.match(found.find(a => a.id === 'nested-two').path, /AGENT\.md$/);
  } finally { cleanup(root); }
});

test('a folder without usable instructions is not an agent, and the catalog and persona sections read well', () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-agents-'));
  try {
    writeAgent(root, 'empty-body', '---\nname: Empty\n---\n');
    writeAgent(root, 'real', '---\nname: Real\ndescription: does things\n---\nDo things well.');
    const found = scanAgentDirs([root]);
    assert.deepEqual(found.map(a => a.id), ['real']);
    const catalog = agentCatalogSection(found);
    assert.match(catalog, /Agents on this machine/);
    assert.match(catalog, /- real: does things/);
    assert.equal(agentCatalogSection([]), '');
    const persona = agentPersonaSection(found[0]);
    assert.match(persona, /You are working as the agent "Real"/);
    assert.match(persona, /Do things well\./);
    assert.equal(agentPersonaSection(null), '');
    // tools, when declared, name themselves in the persona
    assert.match(agentPersonaSection({ name: 'X', instructions: 'Y', tools: ['read', 'grep'] }), /Tools it may use: read, grep\./);
  } finally { cleanup(root); }
});

test('hook scripts are discovered per event folder, first folder wins per name, and a pre-turn nonzero exit vetoes with its stderr', async () => {
  const root = mkdtempSync(join(tmpdir(), 'strata-hooks-'));
  const app = join(root, 'app'), work = join(root, 'work');
  try {
    mkdirSync(join(app, 'pre-turn'), { recursive: true });
    writeFileSync(join(app, 'pre-turn', 'a-guard.sh'), '#!/bin/sh\nexit 0');
    writeFileSync(join(app, 'pre-turn', 'b-guard.sh'), '#!/bin/sh\nexit 0');
    mkdirSync(join(app, 'post-turn'), { recursive: true });
    writeFileSync(join(app, 'post-turn', 'log.sh'), '#!/bin/sh\ncat > /dev/null');
    mkdirSync(join(work, 'pre-turn'), { recursive: true });
    writeFileSync(join(work, 'pre-turn', 'a-guard.sh'), '#!/bin/sh\nexit 1');   // same name as the app's: the app folder wins
    writeFileSync(join(work, 'pre-turn', 'z-check.sh'), '#!/bin/sh\nexit 0');   // a distinct name: discovered too
    mkdirSync(join(work, '.hidden'), { recursive: true });
    const found = scanHookDirs([app, work]);
    assert.deepEqual(found.events['pre-turn'].map(s => s.path), [
      join(app, 'pre-turn', 'a-guard.sh'),                                      // app folder wins the name clash
      join(app, 'pre-turn', 'b-guard.sh'),
      join(work, 'pre-turn', 'z-check.sh'),                                     // sorted by name across folders
    ]);
    assert.equal(found.events['post-turn'].length, 1);
    assert.ok(found.known.includes('pre-turn'));
    assert.equal(found.events['.hidden'], undefined);
    // the runner: payload on stdin, name order, the deduped work copy never runs
    const runs = [];
    const result = await runEventHooks(found, 'pre-turn', { chatId: 'c1' }, {
      runner: async (path, payload) => { runs.push([path, payload]); return { code: 0, stdout: '', stderr: '' }; },
    });
    assert.equal(runs.length, 3);
    assert.match(runs[0][0], /app\/pre-turn\/a-guard\.sh$/);
    assert.deepEqual(runs[0][1], { chatId: 'c1' });
    assert.equal(result.vetoed, false);
    // a vetoing script stops the turn and names its reason; earlier results are kept
    const veto = await runEventHooks(found, 'pre-turn', {}, {
      runner: async path => (path.endsWith('b-guard.sh') ? { code: 2, stdout: '', stderr: 'no\n' } : { code: 0, stdout: '', stderr: '' }),
    });
    assert.equal(veto.vetoed, true);
    assert.equal(veto.reason, 'no');
    assert.equal(veto.results.length, 2, 'scripts ran in name order until the veto');
    // a non-veto event keeps going regardless of exit codes
    const post = await runEventHooks({ events: { 'post-turn': [{ name: 'log.sh', path: 'log.sh' }] } }, 'post-turn', {}, {
      runner: async () => ({ code: 1, stdout: 'ok', stderr: '' }),
    });
    assert.equal(post.vetoed, false);
    assert.equal(post.results[0].code, 1);
  } finally { cleanup(root); }
});

test('the real runner starts a script, feeds the payload on stdin, and reports exit, output and the timeout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-hook-run-'));
  try {
    const { runHookScript } = await import('../server/turn-hooks.mjs');
    const chmod = p => chmodSync(p, 0o755);
    const sh = join(dir, 'echo.sh');
    writeFileSync(sh, '#!/bin/sh\nread -r line\necho "got:$line"\nexit 0');
    chmod(sh);
    const ok = await runHookScript(sh, { hello: 'world' });
    assert.equal(ok.code, 0);
    assert.equal(ok.stdout.trim(), 'got:{"hello":"world"}');
    const failing = join(dir, 'nope.sh');
    writeFileSync(failing, '#!/bin/sh\necho "why" >&2\nexit 3');
    chmod(failing);
    const bad = await runHookScript(failing, {});
    assert.equal(bad.code, 3);
    assert.equal(bad.stderr.trim(), 'why');
    const slow = join(dir, 'slow.sh');
    writeFileSync(slow, '#!/bin/sh\nsleep 30');
    chmod(slow);
    const timed = await runHookScript(slow, {}, { timeoutMs: 300 });
    assert.equal(timed.code, -2);
    assert.match(timed.stderr, /timed out/);
  } finally { cleanup(dir); }
});
