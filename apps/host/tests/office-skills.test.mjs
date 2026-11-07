/**
 * The built-in Office skills: three skills with unique ids, real instructions, and nothing left
 * over from the harness they were ported from.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { officeSkills } from '../server/agent/plugins/office-skills.mjs';

test('three office skills with unique ids', () => {
  const skills = officeSkills();
  assert.equal(skills.length, 3);
  assert.deepEqual([...new Set(skills.map(s => s.id))].sort(), ['office-pptx', 'office-word', 'office-xlsx']);
});

test('each skill carries a real body and description', () => {
  for (const s of officeSkills()) {
    assert.ok(s.name?.trim().length > 0, `${s.id} has a name`);
    assert.ok(s.description?.trim().length > 0, `${s.id} has a description`);
    assert.ok(s.body?.trim().length > 500, `${s.id} has instructions longer than 500 characters`);
  }
});

test('no harness-specific wording survives in the bodies', () => {
  for (const s of officeSkills()) {
    for (const banned of ['DeepSeek Harness', 'load_workspace_dependencies', '@deepseek-ai', 'dsoffice', 'present({']) {
      assert.ok(!s.body.includes(banned), `${s.id} must not mention ${banned}`);
    }
  }
});
