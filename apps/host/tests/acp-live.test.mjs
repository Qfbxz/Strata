import test from 'node:test';
import assert from 'node:assert/strict';
import { runAcpTurn } from '../server/agent/acp/turns.mjs';
import { backendOf } from '../server/agent/acp/backends.mjs';

/** A real turn against the real CLI's ACP server (kimi by default). Skipped unless
 * STRATA_ACP_E2E names the backend (STRATA_ACP_E2E=kimi node --test …): never faked,
 * only run on a machine that has the CLI. */

const kind = process.env.STRATA_ACP_E2E ?? '';

test(`a real ${kind || 'ACP'} agent answers one prompt`, { skip: !kind }, async () => {
    const backend = backendOf(kind);
    assert.ok(backend, `${kind} is in the registry`);
    const frames = [];
    const result = await runAcpTurn({ backend, message: 'Reply with exactly: OK-ACP', cwd: process.cwd(), onFrame: f => frames.push(f) });
    const text = frames.filter(f => f.type === 'delta').map(f => f.text).join('');
    assert.equal('error' in result, false, `the turn errored: ${result.error}`);
    assert.ok(text.length > 0, 'the agent said something');
    assert.equal(frames.at(-1)?.type, 'done');
}, 120000);
