/**
 * The auto-continue badge's matcher: the plugin splices its continue prompt as a plain user
 * message, so the only tell is the exact text — an exact "Continue" value, or one of the
 * localized interruption texts. A longer user sentence that merely begins with "Continue"
 * must not light the badge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutoContinueSplice } from '../server/agent/agent-bridge.mjs';

test('an exact Continue value and the localized interruption texts are the auto-continue splice', () => {
  assert.equal(isAutoContinueSplice(JSON.stringify({ message: { role: 'user', content: 'Continue' } })), true);
  assert.equal(isAutoContinueSplice(JSON.stringify({ text: 'Continue' })), true);
  assert.equal(isAutoContinueSplice('…{"content":"继续。你上一轮只输出了内部推理"}…'), true);
  assert.equal(isAutoContinueSplice('{"text":"继续。宿主在你上一轮运行期间重启了; 从中断处继续"}'), true);
});

test('a longer user sentence or an unrelated splice does not count', () => {
  assert.equal(isAutoContinueSplice(JSON.stringify({ message: { role: 'user', content: 'Continue with the plan' } })), false);
  assert.equal(isAutoContinueSplice(JSON.stringify({ text: 'Background subagent 3f2a reported' })), false);
  assert.equal(isAutoContinueSplice('{"text":"继续检查 drilling report"}'), false, '继续 followed by other words is the person typing, not the plugin');
  assert.equal(isAutoContinueSplice(''), false);
  assert.equal(isAutoContinueSplice(undefined), false);
});
