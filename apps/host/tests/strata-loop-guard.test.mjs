/**
 * The loop guard, unit level: a fingerprint is stable across argument key order and sensitive
 * to arguments and tool names, the third identical call inside the window is a repeat, different
 * arguments never count as a repeat, sessions are isolated buckets, and a fingerprint that slid
 * out of the window stops counting. The real handler never touches arguments and never
 * short-circuits a call; a repeat only shows up as a `[strata-loop-guard]` host-log warning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, fingerprintOf, loopDecision } from '../server/agent/plugins/strata-loop-guard.mjs';

/** A fake harness context that captures the one pre-execute handler the guard registers. */
function handlerOf(config = {}) {
  const handlers = [];
  const ctx = { on(event, handler) { if (event === 'tools/pre-execute') handlers.push(handler); } };
  apply(ctx, config);
  assert.equal(handlers.length, 1, 'the guard registered one pre-execute handler');
  return handlers[0];
}

/** Run one async step with console.warn diverted, and give the lines back. */
async function captureWarnings(run) {
  const lines = [];
  const original = console.warn;
  console.warn = (...parts) => lines.push(parts.map(String).join(' '));
  try { await run(); } finally { console.warn = original; }
  return lines;
}

const execOf = (name, args, session = 's1') => ({ name, arguments: args, agent: { session: { id: session } }, callId: `c-${name}-${JSON.stringify(args)}-${session}` });

test('a fingerprint is stable across argument key order and changes with arguments or tool', () => {
  const one = fingerprintOf({ name: 'grep', arguments: { query: 'x', limit: 5 } });
  assert.equal(one, fingerprintOf({ name: 'grep', arguments: { limit: 5, query: 'x' } }), 'key order does not matter');
  assert.notEqual(one, fingerprintOf({ name: 'grep', arguments: { query: 'y', limit: 5 } }));
  assert.notEqual(one, fingerprintOf({ name: 'read', arguments: { query: 'x', limit: 5 } }));
  assert.equal(fingerprintOf({ name: 'grep', arguments: { query: 'x', limit: 5 } }), one, 'repeats are stable');
});

test('loopDecision counts the current call inside the given window and repeats at three', () => {
  assert.deepEqual(loopDecision(['f'], 'f'), { repeat: false, count: 1 });
  assert.deepEqual(loopDecision(['f', 'f'], 'f'), { repeat: false, count: 2 });
  assert.deepEqual(loopDecision(['f', 'f', 'f'], 'f'), { repeat: true, count: 3 });
  assert.deepEqual(loopDecision(['f', 'f'], 'g'), { repeat: false, count: 0 }, 'the current fingerprint not in the window counts zero');
  assert.deepEqual(loopDecision(['g', 'f', 'g', 'f', 'f'], 'f'), { repeat: true, count: 3 });
  assert.deepEqual(loopDecision('not an array', 'f'), { repeat: false, count: 0 });
});

test('three identical calls warn once per call from the third on, without touching the call', async () => {
  const handler = handlerOf({});
  const exec = execOf('grep', { query: 'x' });
  let forwarded = 0;
  const next = () => { forwarded++; return { kind: 'allow' }; };
  const lines = await captureWarnings(async () => {
    for (let i = 0; i < 4; i++) assert.equal((await handler(exec, next)).kind, 'allow', 'the call is never short-circuited');
  });
  assert.equal(forwarded, 4, 'every call ran');
  assert.deepEqual(exec.arguments, { query: 'x' }, 'the arguments are untouched');
  assert.equal(lines.length, 2, 'calls one and two stay silent, three and four warn');
  assert.ok(lines[0].includes('[strata-loop-guard]'));
  assert.ok(lines[0].includes('grep repeated 3 times'));
  assert.ok(lines[1].includes('grep repeated 4 times'));
});

test('different arguments or a different tool are different fingerprints and never warn', async () => {
  const handler = handlerOf({});
  const lines = await captureWarnings(async () => {
    for (const query of ['x', 'y', 'x', 'y']) await handler(execOf('grep', { query }), () => ({ kind: 'allow' }));
    for (const name of ['grep', 'read', 'grep']) await handler(execOf(name, { query: 'same' }), () => ({ kind: 'allow' }));
  });
  assert.equal(lines.length, 0, 'no fingerprint reached three');
});

test('sessions are separate buckets: one session looping does not count the other', async () => {
  const handler = handlerOf({});
  const lines = await captureWarnings(async () => {
    await handler(execOf('grep', { query: 'x' }, 's-a'), () => ({ kind: 'allow' }));
    await handler(execOf('grep', { query: 'x' }, 's-a'), () => ({ kind: 'allow' }));
    await handler(execOf('grep', { query: 'x' }, 's-b'), () => ({ kind: 'allow' }));
    await handler(execOf('grep', { query: 'x' }, 's-b'), () => ({ kind: 'allow' }));
    await handler(execOf('grep', { query: 'x' }, 's-a'), () => ({ kind: 'allow' }));   // a reaches three
    await handler(execOf('grep', { query: 'x' }, 's-b'), () => ({ kind: 'allow' }));   // b reaches three
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('session s-a'));
  assert.ok(lines[1].includes('session s-b'));
});

test('a fingerprint that slid out of the window stops counting', async () => {
  const handler = handlerOf({ window: 4 });
  const lines = await captureWarnings(async () => {
    // A B A B A: inside the last four calls A only sits twice, so the third A of the run is silent.
    for (const query of ['a', 'b', 'a', 'b', 'a']) await handler(execOf('grep', { query }), () => ({ kind: 'allow' }));
    await handler(execOf('grep', { query: 'a' }), () => ({ kind: 'allow' }));   // now A sits three times in the window
  });
  assert.equal(lines.length, 1, 'the sliding window, not the run length, decides');
  assert.ok(lines[0].includes('grep repeated 3 times'));
});

test('calls without a session fall into the shared anon bucket and loops there warn', async () => {
  const handler = handlerOf({});
  const bare = { name: 'grep', arguments: { query: 'x' } };   // no agent, no session id
  const lines = await captureWarnings(async () => {
    for (let i = 0; i < 3; i++) await handler(bare, () => ({ kind: 'allow' }));
  });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('session anon'));
});
