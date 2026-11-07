/**
 * The spill plugin, unit level: deep text collection is nested and cycle safe, the spill
 * decision sits exactly on the character threshold, and the real apply smoke-spills an
 * oversized result to a 0600 file while replacing the model-facing text with head + marker +
 * tail. Denials, the read-back tools, and value-carrying decisions flow through untouched; a
 * failing spill write degrades to a plain truncation without claiming a file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, collectText, spillDecision } from '../server/agent/plugins/strata-spill.mjs';

const cleanup = dir => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } };

/** A fake harness context that only captures the listeners a plugin registers on one event. */
function capture(event) {
  const handlers = [];
  const ctx = { on(name, handler) { if (name === event) handlers.push(handler); } };
  return { ctx, handlers };
}

/** Run one async step with console.warn diverted, and give the lines back. */
async function captureWarnings(run) {
  const lines = [];
  const original = console.warn;
  console.warn = (...parts) => lines.push(parts.map(String).join(' '));
  try { await run(); } finally { console.warn = original; }
  return lines;
}

/** An oversized but recognizable result text: a clean head, a middle, a clean tail. */
const bigText = 'a'.repeat(2048) + 'MIDDLE'.repeat(1200) + 'z'.repeat(1024);
const acceptWith = text => ({ kind: 'accept', content: [{ type: 'text', text }] });
const execFor = (callId, name = 'grep') => ({ name, arguments: { query: 'x' }, callId });

test('collectText joins every string leaf of nested objects and arrays and cuts cycles', () => {
  const nested = { a: 'alpha', b: ['beta', { c: 'gamma', n: 42, empty: null, flag: true }] };
  assert.equal(collectText(nested), 'alpha\nbeta\ngamma');
  const cycle = { name: 'root', inner: { label: 'leaf' } };
  cycle.self = cycle;
  cycle.inner.back = cycle;
  assert.equal(collectText(cycle), 'root\nleaf');
  assert.equal(collectText('plain text'), 'plain text');
  assert.equal(collectText(0), '');
  assert.equal(collectText(undefined), '');
});

test('collectText skips the structural kind and type labels but keeps real text fields', () => {
  const decision = { kind: 'accept', content: [{ type: 'text', text: 'the actual result' }] };
  assert.equal(collectText(decision), 'the actual result');
});

test('spillDecision leaves a result at exactly the threshold alone and spills one over it', () => {
  const exactly = 'x'.repeat(8192);
  const noSpill = spillDecision(exactly, { spillDir: '/tmp/spills', callId: 'call-1' });
  assert.deepEqual(noSpill, { spill: false, replacement: exactly, path: null });
  const over = 'y'.repeat(8193);
  const plan = spillDecision(over, { spillDir: '/tmp/spills', callId: 'call-9' });
  assert.equal(plan.spill, true);
  assert.equal(plan.path, join('/tmp/spills', 'call-9.txt'));
  assert.ok(plan.replacement.startsWith(over.slice(0, 2048)), 'the retained head opens the replacement');
  assert.ok(plan.replacement.endsWith(over.slice(-1024)), 'the retained tail closes the replacement');
  assert.ok(plan.replacement.includes('…[spilled 5121 chars, full: '));
  assert.ok(plan.replacement.includes(plan.path));
  assert.ok(plan.replacement.includes('the assistant can read that file back with its shell tools'));
  assert.ok(!plan.replacement.slice(2048, -1024).includes('yyyy'), 'only the marker sits between head and tail');
});

test('spillDecision with no spill folder configured never spills', () => {
  const plan = spillDecision('z'.repeat(9000), {});
  assert.deepEqual(plan, { spill: false, replacement: 'z'.repeat(9000), path: null });
});

test('apply smoke: an oversized result is written to a 0600 file and replaced with head + marker + tail', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-spill-'));
  try {
    const spillDir = join(dir, 'spills');
    const { ctx, handlers } = capture('tools/post-execute');
    apply(ctx, { spillDir });
    assert.equal(handlers.length, 1, 'the plugin registered one post-execute handler');
    const handler = handlers[0];
    assert.ok(bigText.length > 8192, 'the fixture really is over the threshold');
    const decision = await handler(execFor('call-1'), {}, async () => acceptWith(bigText));
    const file = join(spillDir, 'call-1.txt');
    assert.equal(readFileSync(file, 'utf8'), bigText, 'the full text landed on disk unchanged');
    assert.equal(statSync(file).mode & 0o777, 0o600, 'the spill file is private');
    const shown = decision.content[0].text;
    assert.ok(shown.startsWith(bigText.slice(0, 2048)), 'the head survives inline');
    assert.ok(shown.endsWith(bigText.slice(-1024)), 'the tail survives inline');
    assert.ok(shown.includes('…[spilled'));
    assert.ok(shown.includes('full: '), 'the marker names the file');
    assert.ok(shown.includes(file));
    assert.ok(shown.includes('shell tools'), 'the marker tells the assistant how to read it back');
    assert.ok(shown.length < bigText.length, 'the inline text really got shorter');
  } finally { cleanup(dir); }
});

test('apply smoke: a plain oversized text result comes back as the truncated text itself', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-spill2-'));
  try {
    const spillDir = join(dir, 'spills');
    const { ctx, handlers } = capture('tools/post-execute');
    apply(ctx, { spillDir });
    const handler = handlers[0];
    const shown = await handler(execFor('call-2'), {}, async () => bigText);
    assert.equal(typeof shown, 'string');
    assert.ok(shown.includes(join(spillDir, 'call-2.txt')));
    assert.equal(readFileSync(join(spillDir, 'call-2.txt'), 'utf8'), bigText);
  } finally { cleanup(dir); }
});

test('apply smoke: an accept without its own content spills the raw result content instead', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-spill3-'));
  try {
    const spillDir = join(dir, 'spills');
    const { ctx, handlers } = capture('tools/post-execute');
    apply(ctx, { spillDir });
    const handler = handlers[0];
    const raw = { isError: false, content: [{ type: 'text', text: bigText }] };
    const decision = await handler(execFor('call-3'), raw, async () => ({ kind: 'accept' }));
    const shown = decision.content[0].text;
    assert.ok(shown.startsWith(bigText.slice(0, 2048)), 'the head survives inline');
    assert.ok(shown.endsWith(bigText.slice(-1024)), 'the tail survives inline');
    assert.ok(shown.includes(join(spillDir, 'call-3.txt')));
    assert.equal(readFileSync(join(spillDir, 'call-3.txt'), 'utf8'), bigText);
    assert.equal(raw.content[0].text, bigText, 'the registry-owned raw result is untouched');
  } finally { cleanup(dir); }
});

test('small results, denials, value decisions and the read-back tools flow through untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-spill4-'));
  try {
    const spillDir = join(dir, 'spills');
    const { ctx, handlers } = capture('tools/post-execute');
    apply(ctx, { spillDir });
    const handler = handlers[0];
    let ran = 0;
    const small = acceptWith('a small result');
    const smallOut = await handler(execFor('c-s'), {}, async () => { ran++; return small; });
    assert.equal(ran, 1);
    assert.equal(smallOut, small);
    assert.equal(smallOut.content[0].text, 'a small result');
    const denied = { kind: 'deny', reason: bigText };
    const deniedOut = await handler(execFor('c-d'), {}, async () => { ran++; return denied; });
    assert.equal(deniedOut, denied);
    assert.equal(deniedOut.reason, bigText);
    const valued = { kind: 'accept', value: { ok: true }, content: [{ type: 'text', text: bigText }] };
    const valuedOut = await handler(execFor('c-v'), {}, async () => { ran++; return valued; });
    assert.equal(valuedOut, valued);
    const readOut = await handler(execFor('c-r', 'read'), {}, async () => { ran++; return acceptWith(bigText); });
    assert.equal(readOut.content[0].text, bigText, 'read is never spilled: the model reads spill files back with it');
    const imageOut = await handler(execFor('c-i', 'read_image'), {}, async () => acceptWith(bigText));
    assert.equal(imageOut.content[0].text, bigText);
    assert.equal(existsSync(join(spillDir, 'c-s.txt')), false);
    assert.equal(existsSync(spillDir), false, 'nothing spilled, no folder created');
  } finally { cleanup(dir); }
});

test('a failing spill write degrades to a plain truncation, warns, and never throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strata-spill5-'));
  try {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'a file, so a folder cannot be made under it');
    const { ctx, handlers } = capture('tools/post-execute');
    apply(ctx, { spillDir: join(blocker, 'sub') });
    const handler = handlers[0];
    const lines = await captureWarnings(async () => {
      const decision = await handler(execFor('c-f'), {}, async () => acceptWith('b'.repeat(9000)));
      const shown = decision.content[0].text;
      assert.ok(shown.startsWith('b'.repeat(2048)), 'the head survives the degrade');
      assert.ok(shown.endsWith('b'.repeat(1024)), 'the tail survives the degrade');
      assert.ok(shown.includes('…[spilled 5928 chars; saving the full output failed]'));
      assert.ok(!shown.includes('full: '), 'no file is claimed when nothing was saved');
    });
    assert.ok(lines.some(line => line.includes('[strata-spill]')), 'the failure is visible in the host log');
    assert.equal(existsSync(join(blocker, 'sub')), false);
  } finally { cleanup(dir); }
});

test('a plugin without a spill folder registers nothing', () => {
  const { ctx, handlers } = capture('tools/post-execute');
  apply(ctx, {});
  apply(ctx, { spillDir: '' });
  assert.equal(handlers.length, 0, 'no folder, no handler');
});
