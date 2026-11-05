import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled = await build({stdin: {contents: "export * from './src/lib/native-catalog'; export * from './src/lib/model-display';", resolveDir: process.cwd()}, bundle: true, write: false, platform: 'node', format: 'esm'});
const {unlistedInstalled, unknownFamilies, modelDisplay} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const fam = (family, models) => ({family, title: family, about: '', experimental: false, images: false, sizes: models.map(id => ({id, model: id, about: '', download_gb: 1, ram_needed_gb: 2, experts_gb: 1, on_this_pc: null, installed: false}))});
const CATALOG = [fam('qwen', ['Q2_0', 'IQ3_S', 'IQ3_XXS']), fam('unsloth', ['UD-Q4_K_XL', 'UD-Q5_K_XL']), fam('gyro', ['Gyro-S', 'Gyro-M'])];
const inst = (model, model_name, ready = true) => ({model, model_name, ready, config: `strata-x.json`});

test('unlistedInstalled: every installed model the catalog does not list comes back', () => {
  const installed = [inst('Q2_0', 'Q2 0'), inst('IQ3_S', 'IQ3 S'), inst('qwen3.8-flash-next-iq3_s', 'IQ3 S (hand-tuned)'), inst('IST-DAS-2.00bpw', 'DeepSeek 2.00bpw')];
  const out = unlistedInstalled(installed, CATALOG);
  assert.deepEqual(out.map(m => m.model), ['qwen3.8-flash-next-iq3_s', 'IST-DAS-2.00bpw'],
    'catalog-listed models stay out, hand-written run configs come back');
});

test('unlistedInstalled: empty and null installed lists, and a full hit', () => {
  assert.deepEqual(unlistedInstalled([], CATALOG), []);
  assert.deepEqual(unlistedInstalled(null, CATALOG), []);
  assert.deepEqual(unlistedInstalled(undefined, CATALOG), []);
  const allListed = [inst('Q2_0', 'x'), inst('UD-Q5_K_XL', 'y'), inst('Gyro-S', 'z')];
  assert.deepEqual(unlistedInstalled(allListed, CATALOG), []);
});

test('unlistedInstalled: ready=false entries still count (they need the Files missing face, not silence)', () => {
  const out = unlistedInstalled([inst('hand-made', 'Hand made', false)], CATALOG);
  assert.equal(out.length, 1);
  assert.equal(out[0].ready, false);
});

test('unknownFamilies: the known families and title patterns drop nothing', () => {
  const families = [fam('qwen', []), fam('swift', []), fam('coder', []), fam('unsloth', []), fam('gyro', []), fam('deepseek41', []),
                    {family: 'something-else', title: 'Qwen3.8-Flash-Next GSQ-RCO', about: '', experimental: false, images: false, sizes: []}];
  assert.deepEqual(unknownFamilies(families), []);
});

test('unknownFamilies: a family neither known nor pattern-matched is named, never silently dropped', () => {
  const families = [fam('qwen', []), fam('mistral-thing', [])];
  assert.deepEqual(unknownFamilies(families), ['mistral-thing']);
});

test('modelDisplay: model_name is the main line, the id never gets shouted in caps', () => {
  assert.equal(modelDisplay(inst('qwen3.8-flash-next-iq3_s', 'IQ3_S (hand-tuned)')).main, 'IQ3_S (hand-tuned)');
  assert.equal(modelDisplay(inst('unsloth-ud-q4_k_xl', '')).main, 'Unsloth UD-Q4_K_XL', 'no model_name: the family short name');
});

test('modelDisplay: the sub line carries kv, context and disk', () => {
  const d = modelDisplay({...inst('m', 'Mine'), kv: 'int8', context: 131072, diskGb: 54.8});
  assert.equal(d.main, 'Mine');
  assert.match(d.sub, /KV int8/);
  assert.match(d.sub, /128K ctx/);
  assert.match(d.sub, /54\.8 GB/);
  assert.equal(modelDisplay(inst('m', 'Mine')).sub, '', 'nothing extra: an empty sub line');
});

test('the Models page and both chat pickers render the own-models blocks (source canary)', async () => {
  const {readFile} = await import('node:fs/promises');
  const {resolve} = await import('node:path');
  const root = resolve(import.meta.dirname, '..');
  const models = await readFile(resolve(root, 'src/components/NativeModels.tsx'), 'utf8');
  assert.ok(models.includes('unlistedInstalled(native?.installed?.models'), 'NativeModels computes the unlisted set');
  assert.ok(models.includes('On this computer, not in the catalog'), 'the own-models block renders');
  assert.ok(models.includes('loadUnlisted(m.model)'), 'an unlisted model loads straight from its run config');
  const picker = await readFile(resolve(root, 'src/components/ChatModelPicker.tsx'), 'utf8');
  assert.ok(picker.includes('pickerNativeModels(native?.installed?.models, native?.instances)'), 'the native picker lists downloaded-but-not-loaded models');
});
