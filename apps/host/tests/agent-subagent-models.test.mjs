/**
 * The model picker's by-name field (server/agent/model-routes.mjs) and the chat it moves.
 *
 * Pure tests always run; the real-Harness tests need STRATA_HARNESS_DIR and skip loudly without it.
 * Harness 0.2.3 removed the subagent tool's per-call `model`/`provider` arguments and the
 * `list_subagent_models` discovery tool, and fenced subagent sessions away from `session.selectModel`:
 * a helper runs on its chat's model, and model choice belongs to the person, applied by the chat send
 * path through `session.selectModel` on the chat's own session. These tests prove that seam.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startScriptedWorker } from './helpers/scripted-worker.mjs';
import { createAgentBridge } from '../server/agent/agent-bridge.mjs';
import { resolveHarness } from '../server/agent/harness-runtime.mjs';
import { choiceOf, modelProblem, resolveChatModel, resolveModel, routeList } from '../server/agent/model-routes.mjs';
import { AGENT_PROMPT } from '../server/agent/preset.mjs';

const HARNESS = process.env.STRATA_HARNESS_DIR;
const skip = !HARNESS || !resolveHarness({ env: process.env }).ok ? 'STRATA_HARNESS_DIR is not set to a built Harness' : false;

const routes = [
  { provider: 'strata-local', model: 'gyro-gyro-s', name: 'qwen3.8-flash-next-gyro-gyro-s', connection: 'this computer', local: true },
  { provider: 'api-aaaa', model: 'deepseek/deepseek-v3.2', name: 'DeepSeek: DeepSeek V3.2', connection: 'OpenRouter', local: false },
  { provider: 'api-aaaa', model: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', connection: 'OpenRouter', local: false },
  { provider: 'api-bbbb', model: 'deepseek-chat', name: 'DeepSeek Chat', connection: 'DeepSeek', local: false },
];

test('nothing named: the chat keeps its model', () => {
  assert.equal(resolveModel(routes, {}).status, 'inherit');
  assert.equal(modelProblem(routes, {}), null);
});

test('exact route, exact id, provider/id, connection and name, in any letters', () => {
  const want = (request, id) => { const r = resolveModel(routes, request); assert.equal(r.status, 'exact', JSON.stringify(request)); assert.equal(r.route.model, id); };
  want({ provider: 'api-aaaa', model: 'deepseek/deepseek-v3.2' }, 'deepseek/deepseek-v3.2');
  want({ model: 'deepseek/deepseek-v3.2' }, 'deepseek/deepseek-v3.2');
  want({ model: 'DeepSeek/DeepSeek-V3.2' }, 'deepseek/deepseek-v3.2');
  want({ provider: 'openrouter', model: 'deepseek/deepseek-v3.2' }, 'deepseek/deepseek-v3.2');
  want({ model: 'openrouter/deepseek/deepseek-v3.2' }, 'deepseek/deepseek-v3.2');
  want({ model: 'DeepSeek: DeepSeek V3.2' }, 'deepseek/deepseek-v3.2');
  want({ model: 'deepseek chat' }, 'deepseek-chat');
  want({ model: 'Local' }, 'gyro-gyro-s');
  want({ provider: 'strata-local', model: 'gyro-gyro-s' }, 'gyro-gyro-s');
});

test('a close guess is answered with the one model it fits, several fits are listed, nothing fitting lists the models', () => {
  const guess = resolveModel(routes, { model: 'claude sonnet' });
  assert.equal(guess.status, 'confirm'); assert.equal(guess.route.model, 'anthropic/claude-sonnet-4.5');
  assert.match(modelProblem(routes, { model: 'claude sonnet' }), /Did you mean Anthropic: Claude Sonnet 4\.5/);
  const several = resolveModel(routes, { model: 'deepseek' });
  assert.equal(several.status, 'ambiguous'); assert.ok(several.options.length >= 2);
  const none = modelProblem(routes, { model: 'llama banana' });
  assert.match(none, /No model is called "llama banana"/); assert.match(none, /DeepSeek Chat/); assert.match(none, /Nothing was switched/);
  assert.match(modelProblem([], { model: 'x' }), /No other model is set up/);
  assert.match(routeList(routes), /running on this computer/);
});

test('the picker rows carry the app ids, so an exact fit becomes the choice the chat send route takes', () => {
  const profileRoutes = [
    { route: 'strata-local', kind: 'local', modelId: 'gyro-gyro-s', name: 'Local Scripted', connectionName: 'this computer', instanceId: 'inst-1', contextWindow: 32768 },
    { route: 'api-conn-1', kind: 'api', modelId: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', connectionName: 'OpenRouter', connectionId: 'conn-1', contextWindow: 32768 },
    // a response-settings copy (`~s0`) names a shape of another route, not a model of its own
    { route: 'api-conn-1~s0', kind: 'api', modelId: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2 (with your response settings)', connectionName: 'OpenRouter', contextWindow: 32768 },
  ];
  // the endpoint resolves over this view: shaped copies share every loose form with their model and
  // would turn one close guess into "more than one model fits"
  const pickerView = profileRoutes.filter(r => !String(r.route).includes('~'));
  const found = resolveChatModel(pickerView, 'DeepSeek V3.2');
  assert.equal(found.status, 'exact', found.message);
  assert.deepEqual(choiceOf(found.route), { connectionId: 'conn-1', modelId: 'deepseek/deepseek-v3.2' });
  assert.equal(found.message, 'DeepSeek V3.2 (OpenRouter).');
  const local = resolveChatModel(pickerView, 'the local model');
  assert.equal(local.status, 'exact');
  assert.deepEqual(choiceOf(local.route), { instanceId: 'inst-1' });
  assert.match(local.message, /running on this computer/);
  const guess = resolveChatModel(pickerView, 'deepseek v3');
  assert.equal(guess.status, 'confirm'); assert.match(guess.message, /Did you mean DeepSeek V3\.2/);
  const none = resolveChatModel(pickerView, 'llama banana');
  assert.equal(none.status, 'none'); assert.match(none.message, /Nothing was switched/);
});

test('the assistant is told to use the subagent tool for helpers and never to look for a model itself', () => {
  assert.match(AGENT_PROMPT, /ask a subagent/); assert.match(AGENT_PROMPT, /Never look for a model with shell commands/);
});

async function rig(t) {
  const local = await startScriptedWorker();
  const remote = await startScriptedWorker({ model: 'deepseek/deepseek-v3.2' });
  const dir = mkdtempSync(join(tmpdir(), 'strata-sub-'));
  const ws = join(dir, 'ws'); mkdirSync(ws, { recursive: true });
  const bridge = createAgentBridge({
    dataDir: dir, env: process.env, startTimeoutMs: 90_000,
    localInstances: () => [{ id: 'inst-1', label: 'Local Scripted', baseUrl: local.url, modelId: 'scripted-model', context: 32768, slots: 2 }],
    connections: () => [{ id: 'conn-1', name: 'OpenRouter', baseUrl: remote.url, protocol: 'openai-chat', apiKey: 'k', models: [{ id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', contextMax: 32768 }] }],
  });
  t.after(async () => { await bridge.close(); await local.close(); await remote.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } });
  const routes = () => bridge.status().routes;
  const call = async (chatId, args) => {
    const frames = [];
    await bridge.runTurn({ chatId, message: `SCRIPT:call subagent ${JSON.stringify(args)}`, workspacePath: ws, mode: 'bypass', onFrame: f => frames.push(f) });
    return { frames, text: frames.filter(f => f.type === 'delta').map(f => f.text).join('') };
  };
  const turn = async (chatId, message, choice = null) => {
    const frames = [];
    await bridge.runTurn({ chatId, message, workspacePath: ws, choice, mode: 'bypass', onFrame: f => frames.push(f) });
    return { frames, text: frames.filter(f => f.type === 'delta').map(f => f.text).join('') };
  };
  const selection = async chatId => {
    const rt = bridge._debug().rt;
    return rt.gw.rpc('session.models', { sessionId: bridge.sessionOf(chatId) });
  };
  return { local, remote, bridge, call, turn, routes, selection, ws };
}

// The two real-Harness tests below are the rebuilt model-choice path on the 0.2.3 seam: the person
// names a model in the picker, the host resolves the words (model-routes.mjs) into the chat send
// route's choice, and the turn applies it to the chat's own session with `session.selectModel`.
test('the real Harness: a name the person types lands the chat on that model (session.selectModel)', { skip }, async (t) => {
  const r = await rig(t);
  const found = resolveChatModel(r.routes(), 'DeepSeek V3.2');
  assert.equal(found.status, 'exact', found.message);
  const choice = choiceOf(found.route);
  assert.deepEqual(choice, { connectionId: 'conn-1', modelId: 'deepseek/deepseek-v3.2' });
  const { frames } = await r.turn('m1', 'SCRIPT:echo grey', choice);
  assert.ok(!frames.some(f => f.type === 'error'), `no error: ${JSON.stringify(frames.filter(f => f.type === 'error'))}`);
  assert.equal(frames.at(-1).type, 'done');
  // the chat itself reached the OpenRouter mock: the session runs on the named model now
  for (let i = 0; i < 60 && !r.remote.requests.length; i++) await new Promise(res => setTimeout(res, 250));
  assert.ok(r.remote.requests.length >= 1, 'the chat reached the remote mock');
  // and the Harness says the session's selection is the named model
  const models = await r.selection('m1');
  assert.equal(models.current.provider, found.route.provider);
  assert.equal(models.current.model, 'deepseek/deepseek-v3.2');
});

test('the real Harness: a close guess and an unknown model are answered in plain words and switch nothing', { skip }, async (t) => {
  const r = await rig(t);
  const guess = resolveChatModel(r.routes(), 'deepseek v3');
  assert.equal(guess.status, 'confirm');
  assert.match(guess.message, /Did you mean DeepSeek V3\.2/);
  const none = resolveChatModel(r.routes(), 'llama banana');
  assert.equal(none.status, 'none');
  assert.match(none.message, /No model is called "llama banana"/); assert.match(none.message, /DeepSeek V3\.2/, 'the list names the models');
  // the chat keeps its own model: a message after both failed resolves goes to the local engine
  const before = r.local.requests.length;
  await r.turn('m2', 'SCRIPT:echo hi');
  for (let i = 0; i < 40 && r.local.requests.filter(q => q.directive === 'echo').length < 1; i++) await new Promise(res => setTimeout(res, 250));
  assert.ok(r.local.requests.length > before, 'the chat answered on its own model');
  const models = await r.selection('m2');
  assert.equal(models.current.provider, 'strata-local', 'the session still selects the local model');
  await new Promise(res => setTimeout(res, 1500));
  assert.equal(r.remote.requests.length, 0, 'nothing was started on the named model');
});

test('the real Harness: the local model by its everyday words, and a helper that runs on the chat it serves', { skip }, async (t) => {
  const r = await rig(t);
  const local = resolveChatModel(r.routes(), 'the local model');
  assert.equal(local.status, 'exact', local.message);
  assert.deepEqual(choiceOf(local.route), { instanceId: 'inst-1' });
  const before = r.local.requests.length;
  await r.call('m4', { description: 'Local', prompt: 'SCRIPT:echo hi' });
  await r.call('m5', { description: 'Plain', prompt: 'SCRIPT:echo hi' });
  for (let i = 0; i < 40 && r.local.requests.filter(q => q.directive === 'echo').length < 2; i++) await new Promise(res => setTimeout(res, 250));
  assert.ok(r.local.requests.length > before, 'the helpers ran on the chat\'s own model');
  assert.equal(r.remote.requests.length, 0);
});

test('the real Harness: a helper that finishes while the chat model is still answering does not end the run early ("interrupted before it finished")', { skip }, async (t) => {
  // The chat model answers slowly; its helper runs on the same model and reports back mid-answer.
  const slow = await startScriptedWorker({ chunkDelayMs: 900 });
  const dir = mkdtempSync(join(tmpdir(), 'strata-race-')); const ws = join(dir, 'ws'); mkdirSync(ws, { recursive: true });
  const bridge = createAgentBridge({ dataDir: dir, env: process.env, startTimeoutMs: 90_000,
    localInstances: () => [{ id: 'inst-1', label: 'Slow chat model', baseUrl: slow.url, modelId: 'scripted-model', context: 32768, slots: 2 }],
    connections: () => [] });
  t.after(async () => { await bridge.close(); await slow.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ } });
  const frames = [];
  await bridge.runTurn({ chatId: 'race', message: `SCRIPT:call subagent ${JSON.stringify({ description: 'Quick', prompt: 'SCRIPT:echo hi' })}`, workspacePath: ws, mode: 'bypass', onFrame: f => frames.push(f) });
  assert.ok(!frames.some(f => f.type === 'error'), `no error: ${JSON.stringify(frames.filter(f => f.type === 'error'))}`);
  assert.equal(frames.at(-1).type, 'done');
  assert.match(frames.filter(f => f.type === 'delta').map(f => f.text).join(''), /Tool finished/, 'the chat model got to answer');
});
