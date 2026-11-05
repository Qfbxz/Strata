import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelProviders } from '../server/model-providers.mjs';
import { buildProfile, routeFor, LOCAL_EFFORTS } from '../server/agent/profile.mjs';

/** The MLX on this Mac connection: a keyless custom OpenAI-chat connection to the mlx-bridge
 * (tools/mlx_bridge.py) on 127.0.0.1. What must hold:
 * - it saves with NO api key (a local server wants none) and stays one entry when re-saved;
 * - the Harness profile treats it as the person's own private server: the chat-template thinking
 *   vocabulary, the local output budget (half its window), the local reasoning efforts, pictures on;
 * - its route resolves for a chat selection like any connection model. */

const MLX_DRAFT = {
  kind: 'custom', name: 'MLX on this Mac', baseUrl: 'http://127.0.0.1:8759/v1/', protocol: 'openai-chat', apiKey: '',
  models: [
    { id: 'Qwen3.8-27B-MLX-4bit', name: 'Qwen3.8 Flash-Next MLX·4bit', contextMax: 40960 },
    { id: 'Qwen2.5-0.5B-MLX-4bit', name: 'Qwen2.5 0.5B MLX·4bit', contextMax: 32768, vision: false },
  ],
};

test('an MLX connection saves with no key and re-saving stays one entry', t => {
  const directory = mkdtempSync(join(tmpdir(), 'strata-mlx-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const service = createModelProviders({ directory });
  const saved = service.save(MLX_DRAFT).connections[0];
  assert.equal(saved.kind, 'custom');
  assert.equal(saved.baseUrl, 'http://127.0.0.1:8759/v1');
  assert.equal(saved.apiKeySet, false);
  assert.equal('apiKey' in saved, false, 'the key must never come back to the UI');
  const again = service.save({ ...MLX_DRAFT, id: saved.id });
  assert.equal(again.connections.length, 1, 'idempotent upsert: one MLX connection');
  assert.equal(again.connections[0].id, saved.id);
});

test('the Harness profile gives the MLX connection the own-server treatment', t => {
  const directory = mkdtempSync(join(tmpdir(), 'strata-mlx-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const service = createModelProviders({ directory });
  const saved = service.save(MLX_DRAFT).connections[0];
  const profile = buildProfile({ local: [], connections: [{ ...saved, apiKey: '' }], gate: false });
  // the providers map ships inside the patch, as the llm-pi-ai entry's config (JSON-in-YAML)
  const entries = JSON.parse(profile.patch.replace(/^#[^\n]*\n/, ''));
  const providers = entries.find(e => e.id === 'llm-pi-ai').config.providers;
  const route = Object.keys(providers).find(r => r.startsWith('api-'));
  assert.ok(route, 'the connection builds a route');
  const p = providers[route];
  assert.equal(p.api, 'openai-completions');
  assert.equal(p.baseURL, 'http://127.0.0.1:8759/v1');
  // a keyless local server still gets a placeholder key env (the OpenAI client refuses to send nothing)
  assert.ok(p.apiKeyEnv, 'keyless private server gets a placeholder key env');
  assert.deepEqual(p.compat, { supportsStore: false, thinkingFormat: 'chat-template', chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled' }, reasoning_effort: { $var: 'thinking.effort', omitWhenOff: true } } });
  const [m1, m2] = p.models;
  // the local output budget: half of the model's own window, like a local model
  assert.equal(m1.maxTokens, 12288, 'localOutputBudget (30% of the window, cap 32K) applies to the own server');
  assert.equal(m1.input.includes('image'), true, 'pictures on by default for an OpenAI-style model');
  assert.deepEqual(m1.reasoningEfforts, LOCAL_EFFORTS);
  assert.equal(m1.reasoning, true);
  assert.equal(m2.input.includes('image'), false, 'an explicit vision:false keeps pictures off');
  const r = routeFor(profile, { connectionId: saved.id, modelId: 'Qwen3.8-27B-MLX-4bit' });
  assert.equal(r.route, route);
  assert.equal(r.modelId, 'Qwen3.8-27B-MLX-4bit');
  assert.equal(r.kind, 'api');
});

/** E2E against the real bridge: runs only when tools/mlx_bridge.py serves 8759 with a healthy
 * worker (run `python3 tools/mlx_bridge.py --check` first). Skipped otherwise, never faked. */
test('a chat completion really reaches the mlx-bridge and answers', { skip: !process.env.MLX_BRIDGE_E2E }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'strata-mlx-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const service = createModelProviders({ directory });
  const saved = service.save({ ...MLX_DRAFT, models: [{ id: process.env.MLX_BRIDGE_MODEL || 'Qwen2.5-0.5B-MLX-4bit' }] }).connections[0];
  const frames = [];
  const result = await service.stream({ selection: { connectionId: saved.id, modelId: saved.models[0].id }, message: '从1数到5，逗号分隔，不要解释。', history: [], systemPrompt: 'You are concise.', onFrame: frame => frames.push(frame) });
  const text = frames.filter(f => f.type === 'delta').map(f => f.text).join('');
  assert.ok(text.length > 0, 'the model answered');
  assert.ok(/[2-4]/.test(text), `the answer counts: ${text.slice(0, 40)}`);
  assert.equal(frames.at(-1).type, 'done');
  assert.ok(result.tokensOut > 0);
});
