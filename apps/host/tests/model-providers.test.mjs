import test from 'node:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelProviders, normalizeBaseUrl, PROVIDER_CATALOG } from '../server/model-providers.mjs';
import { createMockModelApi } from './mock-model-api.mjs';
import { assertPrivate } from './helpers/assert-private.mjs';

test('connections persist, redact keys, retain unchanged keys, and validate endpoints/models', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const service = createModelProviders({ directory });
  const draft = { kind: 'custom', name: 'Other PC', baseUrl: 'http://192.168.1.20:1234/v1/', protocol: 'openai-chat', apiKey: 'test-key', models: [{ id: 'my-model', name: 'My model' }] };
  const saved = service.save(draft).connections[0];
  assert.equal(saved.baseUrl, 'http://192.168.1.20:1234/v1');
  assert.equal(saved.apiKeySet, true); assert.equal('apiKey' in saved, false);
  assertPrivate(join(directory, 'model-providers.json'));
  service.save({ ...saved, apiKey: '' });
  assert.equal(JSON.parse(readFileSync(join(directory, 'model-providers.json')))[0].apiKey, 'test-key');
  const reopened = createModelProviders({ directory });
  assert.deepEqual(reopened.list(), service.list());
  reopened.save({ ...saved, apiKey: '', baseUrl: 'http://192.168.1.21:1234/v1' });
  assert.equal(reopened.list().connections[0].apiKeySet, false);
  assert.throws(() => service.save({ ...draft, models: [] }), /at least one/);
  assert.throws(() => service.save({ ...draft, models: [{ id: 'a' }, { id: 'a' }] }), /unique/);
  for (const url of ['file:///tmp', 'https://user:pass@example.com/v1', 'https://a/v1?key=secret', 'https://a/v1/chat/completions']) assert.throws(() => normalizeBaseUrl(url));
  reopened.remove(saved.id); assert.equal(reopened.list().connections.length, 0);
  assert.throws(() => reopened.resolve({ connectionId: saved.id, modelId: 'my-model' }), /no longer/);
});

test('discovery uses provider auth, pagination, and avoids redirect/error credential leaks', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const draft = { kind: 'custom', name: 'Mock', baseUrl: mock.baseUrl, protocol: 'openai-chat', apiKey: 'test-key', models: [{ id: 'mock-chat' }] };
  assert.equal((await service.discover(draft)).models.length, 2);
  assert.equal(mock.requests[0].headers.authorization, 'Bearer test-key');
  assert.equal((await service.discover({ ...draft, protocol: 'anthropic' })).models.length, 3);
  assert.equal(mock.requests[1].headers['x-api-key'], 'test-key');
  const before = mock.requests.length;
  await assert.rejects(service.discover({ ...draft, baseUrl: mock.baseUrl.replace('/v1', '/redirect') }), /Could not reach/);
  assert.equal(mock.requests.length, before + 1);
  await assert.rejects(service.discover({ ...draft, baseUrl: mock.baseUrl.replace('/v1', '/bad') }), err => !err.message.includes('test-key') && /credentials/.test(err.message));
});

for (const protocol of ['openai-chat', 'openai-responses', 'anthropic']) test(`${protocol} forwards history, streams text, and records reported usage`, async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const connection = service.save({ kind: 'custom', name: 'Mock', baseUrl: mock.baseUrl, protocol, apiKey: 'test-key', models: [{ id: 'mock-chat' }] }).connections[0];
  const frames = [];
  const result = await service.stream({ selection: { connectionId: connection.id, modelId: 'mock-chat' }, message: 'New prompt', history: [{ role: 'user', content: 'Earlier prompt' }, { role: 'assistant', content: 'Earlier answer' }], systemPrompt: 'Be clear.', onFrame: frame => frames.push(frame) });
  assert.match(frames.filter(f => f.type === 'delta').map(f => f.text).join(''), /Hello.*test API/);
  assert.equal(result.tokensIn, 14); assert.equal(result.tokensOut, 7); assert.equal(result.usageSource, 'reported');
  assert.equal(frames.at(-1).type, 'done');
  const body = mock.requests[0].body;
  assert.deepEqual((body.messages ?? body.input).slice(-3).map(m => m.content), ['Earlier prompt', 'Earlier answer', 'New prompt']);
  if (protocol === 'openai-responses') assert.equal(body.store, false);
});

test('truncated streams, provider stream errors, and cancellation preserve output without a false done', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const connection = service.save({ kind: 'custom', name: 'Mock', baseUrl: mock.baseUrl, protocol: 'openai-chat', apiKey: 'test-key', models: ['truncated', 'stream-error', 'slow'].map(id => ({ id })) }).connections[0];
  for (const modelId of ['truncated', 'stream-error']) {
    const frames = [];
    await assert.rejects(service.stream({ selection: { connectionId: connection.id, modelId }, message: 'Test', onFrame: frame => frames.push(frame) }), err => !err.message.includes('test-key'));
    assert.equal(frames.some(f => f.type === 'done'), false);
  }
  const controller = new AbortController(), frames = [];
  await assert.rejects(service.stream({ selection: { connectionId: connection.id, modelId: 'slow' }, message: 'Test', signal: controller.signal, onFrame: frame => { frames.push(frame); if (frame.type === 'delta') controller.abort(); } }), { name: 'AbortError' });
  assert.equal(frames.find(f => f.type === 'delta').text, 'Partial'); assert.equal(frames.some(f => f.type === 'done'), false);
});


test('every API key preset discovers and streams with its configured protocol', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-presets-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  assert.ok(PROVIDER_CATALOG.length >= 20);
  assert.equal(new Set(PROVIDER_CATALOG.map(p => p.id)).size, PROVIDER_CATALOG.length);
  for (const preset of PROVIDER_CATALOG) {
    if (preset.baseUrl) assert.equal(normalizeBaseUrl(preset.baseUrl), preset.baseUrl);
    const draft = { kind: 'provider', provider: preset.id, baseUrl: mock.baseUrl, apiKey: 'test-key', models: [{ id: 'mock-chat' }] };
    assert.ok((await service.discover(draft)).models.length > 0, preset.name);
    const connection = service.save(draft).connections.at(-1);
    assert.equal(connection.protocol, preset.protocol);
    const frames = [];
    await service.stream({ selection: { connectionId: connection.id, modelId: 'mock-chat' }, message: 'Test', onFrame: f => frames.push(f) });
    assert.equal(frames.at(-1).type, 'done', preset.name);
    const request = mock.requests.at(-1);
    if (preset.protocol === 'anthropic') assert.equal(request.headers['x-api-key'], 'test-key');
    else assert.equal(request.headers.authorization, 'Bearer test-key');
    if (preset.protocol === 'openai-chat' && !['deepseek','openrouter','google','moonshotai'].includes(preset.id)) assert.equal(request.body.stream_options, undefined, 'optional usage parameter is not assumed for newly added providers');
  }
  assert.throws(() => service.save({ kind: 'provider', provider: 'qwen', apiKey: 'test-key', models: [{ id: 'test' }] }), /full http/);
});

test('a model switch refreshes the real context from the server, filling only the blanks', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const saved = service.save({ kind: 'custom', name: 'Local', baseUrl: mock.baseUrl, protocol: 'openai-chat', apiKey: '', models: [{ id: 'mock-chat' }, { id: 'hand-set', name: 'Hand set', contextMax: 40960 }] }).connections[0];
  const out = await service.refreshModelInfo(saved.id);
  assert.equal(out.models.find(m => m.id === 'mock-chat').contextMax, 32768, 'the blank gets the real window from /v1/models');
  assert.equal(out.models.find(m => m.id === 'hand-set').contextMax, 40960, 'a value the person set stays theirs');
  const later = createModelProviders({ directory }).list().connections[0];
  assert.equal(later.models.find(m => m.id === 'mock-chat').contextMax, 32768, 'persisted, not just returned');
  const unreachable = await service.refreshModelInfo('no-such-id');
  assert.equal(unreachable, null, 'an unknown connection: nothing to do');
});

test('a provider connection\'s catalog presets are overwritten by the server truth; anthropic connections refresh too', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const saved = service.save({ kind: 'custom', name: 'Local custom', baseUrl: mock.baseUrl, protocol: 'openai-chat', apiKey: '', models: [{ id: 'mock-chat', contextMax: 131072 }] }).connections[0];
  const kept = await service.refreshModelInfo(saved.id);
  assert.equal(kept.models[0].contextMax, 131072, 'a custom connection: the person\'s value stays even when the server differs');
  service.save({ kind: 'provider', provider: 'deepseek', apiKey: 'test-key', baseUrl: mock.baseUrl, models: [{ id: 'mock-chat', contextMax: 131072 }] });
  const providerRow = service.list().connections.find(c => c.kind === 'provider');
  const over = await service.refreshModelInfo(providerRow.id);
  assert.equal(over.models[0].contextMax, 32768, 'a provider connection: the server truth overwrites the catalog preset');
});

for (const [protocol, check] of [
  ['openai-chat', body => { assert.equal(body.reasoning_effort, 'high'); }],
  ['openai-responses', body => { assert.equal(body.reasoning, undefined, 'the Responses payload keeps its existing shape'); }],
  ['anthropic', body => { assert.equal(body.thinking, undefined, 'the Anthropic payload keeps its existing shape'); }],
]) test(`${protocol}: a chosen reasoning effort reaches the wire only on the chat protocol, and only for a model saved as thinking`, async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const connection = service.save({ kind: 'custom', name: 'Mock', baseUrl: mock.baseUrl, protocol, apiKey: 'test-key', models: [{ id: 'mock-chat', reasoning: true }] }).connections[0];
  await service.stream({ selection: { connectionId: connection.id, modelId: 'mock-chat' }, message: 'Hello', history: [], thinking: 'max', onFrame: () => {} });
  check(mock.requests.at(-1).body);
});

test('no chosen effort: nothing thinking-shaped goes on the wire (and off sends nothing)', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const connection = service.save({ kind: 'custom', name: 'Mock', baseUrl: mock.baseUrl, protocol: 'anthropic', apiKey: 'test-key', models: [{ id: 'mock-chat' }] }).connections[0];
  await service.stream({ selection: { connectionId: connection.id, modelId: 'mock-chat' }, message: 'Hello', history: [], onFrame: () => {} });
  assert.equal(mock.requests.at(-1).body.thinking, undefined, 'no choice: no thinking block');
  await service.stream({ selection: { connectionId: connection.id, modelId: 'mock-chat' }, message: 'Hello', history: [], thinking: 'off', onFrame: () => {} });
  assert.equal(mock.requests.at(-1).body.thinking, undefined, 'off: no thinking block');
});

test('a model the server does not report a window for takes the catalog value (glm-5.3 is 1M, not the 128K assumption)', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  // the mock's list has no context_length for "contextless-model"; the catalog table does not know it either -> stays blank.
  // glm-5.3-flash is served by the mock id list? No: the catalog value comes with the refresh only for ids in the list.
  const saved = service.save({ kind: 'custom', name: 'Z', baseUrl: mock.baseUrl, protocol: 'openai-chat', apiKey: '', models: [{ id: 'mock-chat' }] }).connections[0];
  const out = await service.refreshModelInfo(saved.id);
  assert.equal(out.models[0].contextMax, 32768, 'the server reported it: the real value');
});

test('glm-5.3-flash really gets its 1M window: a server that reports no context fields still yields the catalog value', async t => {
  // a private mock that answers a model list WITHOUT context fields (what Zhipu's list does),
  // carrying the glm id — the shared mock cannot serve this case
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'glm-5.3-flash', display_name: 'GLM 5.3 Flash' }, { id: 'glm-4.7', display_name: 'GLM 4.7' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); });
  const directory = mkdtempSync(join(tmpdir(), 'strata-glm-'));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const service = createModelProviders({ directory });
  const saved = service.save({ kind: 'custom', name: 'Z.ai', baseUrl: `http://127.0.0.1:${port}`, protocol: 'openai-chat', apiKey: '', models: [{ id: 'glm-5.3-flash' }, { id: 'glm-4.7' }] }).connections[0];
  const out = await service.refreshModelInfo(saved.id);
  const glm = out.models.find(m => m.id === 'glm-5.3-flash');
  const old = out.models.find(m => m.id === 'glm-4.7');
  assert.equal(glm.contextMax, 1000000, 'glm-5.3: the catalog\'s 1M, not the 128K assumption');
  assert.equal(old.contextMax, 256000, 'glm-4.7: the catalog\'s 256K');
  const later = createModelProviders({ directory }).list().connections[0];
  assert.equal(later.models.find(m => m.id === 'glm-5.3-flash').contextMax, 1000000, 'persisted');
});

test('the refresh runs once per connection within its TTL: the next message is instant (no second fetch)', async t => {
  const mock = await createMockModelApi(), directory = mkdtempSync(join(tmpdir(), 'strata-providers-'));
  t.after(async () => { await mock.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
  const service = createModelProviders({ directory });
  const saved = service.save({ kind: 'custom', name: 'Local', baseUrl: mock.baseUrl, protocol: 'openai-chat', apiKey: '', models: [{ id: 'mock-chat' }] }).connections[0];
  await service.refreshModelInfo(saved.id);
  const afterFirst = mock.requests.length;
  await service.refreshModelInfo(saved.id);
  await service.refreshModelInfo(saved.id);
  assert.equal(mock.requests.length, afterFirst, 'within the TTL the refresh answers from cache, no network round-trip');
  const row = service.list().connections[0].models.find(m => m.id === 'mock-chat');
  assert.equal(row.contextMax, 32768, 'the filled value still stands');
});

test('an anthropic base without /v1 reads its model list under /v1/models (zhipu serves it there)', async t => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    if (req.url.includes('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'glm-5.3-flash', display_name: 'GLM' }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); });
  const directory = mkdtempSync(join(tmpdir(), 'strata-zp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const service = createModelProviders({ directory });
  const saved = service.save({ kind: 'custom', name: 'Z', baseUrl: `http://127.0.0.1:${port}`, protocol: 'anthropic', apiKey: 'k', models: [{ id: 'glm-5.3-flash' }] }).connections[0];
  const out = await service.refreshModelInfo(saved.id);
  assert.equal(out.models[0].contextMax, 1000000, 'the catalog value lands through the /v1/models path');
  assert.ok(seen.some(u => u.includes('/v1/models')), `the list was read from /v1/models: ${seen.join(',')}`);
  assert.ok(!seen.some(u => /(?:^|\/)models\?/.test(u) && !u.includes('/v1/')), 'no bare /models request (it 404s on zhipu)');
});
