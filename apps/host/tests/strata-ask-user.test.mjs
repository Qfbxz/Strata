/**
 * The structured ask-user tool, unit level: the registered tool answers with guidance carrying the verbatim question
 * and options, the per-session limit answers with the limit text, and a missing or failing session seam degrades
 * without crashing. The registration itself must stay available when the registry or the config is wrong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, askUserTool, guidanceFor, limitGuidance, TOOL_NAME, DEFAULT_MAX_QUESTIONS } from '../server/agent/plugins/strata-ask-user.mjs';

/** A composition context that captures what the plugin registers, like the persona test's fake ctx. */
function hostWith() {
  const registered = [];
  const ctx = {
    tools: {
      register(definition) { registered.push(definition); return () => {}; },
    },
  };
  return { ctx, registered };
}

/** A fake agent session that records appends, like the Harness's session event log. */
function fakeAgent(append) {
  const appended = [];
  const session = {
    id: 's1',
    ...(append === null ? {} : { append: append ?? ((event, data) => { appended.push({ event, data }); }) }),
  };
  return { agent: { session }, appended };
}

const run = (tool, args, exec) => tool.execute(args, exec);

test('the tool registers under its name with a registry-shaped definition', () => {
  const { ctx, registered } = hostWith();
  apply(ctx, {});
  assert.equal(registered.length, 1, 'the plugin registers exactly one tool');
  const tool = registered[0];
  assert.equal(tool.name, TOOL_NAME);
  assert.equal(typeof tool.description, 'string');
  assert.deepEqual(tool.parameters.required, ['question'], 'a question is required');
  assert.equal(tool.parameters.properties.question.type, 'string');
  assert.equal(tool.parameters.properties.options.items.type, 'string');
  assert.equal(typeof tool.output.render, 'function', 'the registry requires output.render');
  assert.equal(tool.output.schema.type, 'object');
  // a missing or broken registry degrades instead of breaking the load
  assert.doesNotThrow(() => apply({}, {}));
  assert.doesNotThrow(() => apply({ tools: null }, {}));
});

test('an ask returns guidance with the verbatim question and the options, and records the question', async () => {
  const tool = askUserTool({ maxQuestions: 8 });
  const { agent, appended } = fakeAgent();
  const value = await run(tool, { question: 'Which GPU should I target?', options: ['AMD (Recommended)', 'NVIDIA'] }, { agent });
  assert.match(value.guidance, /Ask the user this question in your next reply, verbatim: Which GPU should I target\?/);
  assert.match(value.guidance, /Offer these options: AMD \(Recommended\), NVIDIA/);
  assert.match(value.guidance, /wait/, 'the model must be told to stop and wait for the answer');
  // the same text the model reads comes out of the registry's render
  const blocks = tool.output.render({ question: 'x' }, value);
  assert.deepEqual(blocks, [{ type: 'text', text: value.guidance }]);
  assert.deepEqual(appended, [{ event: 'user-questions', data: { question: 'Which GPU should I target?', options: ['AMD (Recommended)', 'NVIDIA'] } }]);
  // no options: guidance carries only the question, the record carries only the question
  const plain = await run(tool, { question: 'Go on?' }, { agent });
  assert.doesNotMatch(plain.guidance, /Offer these options/);
  assert.deepEqual(appended[1].data, { question: 'Go on?' });
  // a non-string option or an empty array is not an offer
  const messy = await run(tool, { question: 'Really?', options: ['yes', 42, '   ', 'no'] }, { agent });
  assert.match(messy.guidance, /Offer these options: yes, no/);
  const empty = await run(tool, { question: 'Really?', options: [] }, { agent });
  assert.doesNotMatch(empty.guidance, /Offer these options/);
});

test('past the limit the tool answers with the limit text and neither counts nor records', async () => {
  const { ctx, registered } = hostWith();
  apply(ctx, { maxQuestions: 2 });
  const tool = registered[0];
  const { agent, appended } = fakeAgent();
  assert.match((await run(tool, { question: 'q1' }, { agent })).guidance, /q1/);
  assert.match((await run(tool, { question: 'q2' }, { agent })).guidance, /q2/);
  const third = await run(tool, { question: 'q3' }, { agent });
  assert.match(third.guidance, /Ask in your final reply instead/);
  assert.match(third.guidance, /2/, 'the limit text names the budget');
  assert.equal(appended.length, 2, 'the refused ask is not recorded');
  // a refused ask does not spend the budget either: the count stays at 2
  assert.match((await run(tool, { question: 'q4' }, { agent })).guidance, /Ask in your final reply instead/);
  assert.equal(appended.length, 2);
  assert.match(guidanceFor('a'), /verbatim: a/, 'the pure helper builds the same guidance the tool returns');
  assert.equal(limitGuidance(3), 'This chat has used its 3 ask_user_question questions. Ask in your final reply instead.');
});

test('no session seam does not crash, and each such ask still gets guidance', async () => {
  const tool = askUserTool({});
  // no agent at all
  const bare = await run(tool, { question: 'Hello?' }, {});
  assert.match(bare.guidance, /verbatim: Hello\?/);
  // an agent whose session is absent
  const noSession = await run(tool, { question: 'Hello?' }, { agent: {} });
  assert.match(noSession.guidance, /verbatim: Hello\?/);
});

test('a session without append, or one whose append throws, degrades without crashing', async () => {
  const tool = askUserTool({});
  // session present, append missing
  const { agent: noAppend } = fakeAgent(null);
  const value = await run(tool, { question: 'Still works?' }, { agent: noAppend });
  assert.match(value.guidance, /verbatim: Still works\?/);
  // append present but failing
  const { agent: throwing } = fakeAgent(() => { throw new Error('log disk full'); });
  const value2 = await run(tool, { question: 'Still works?' }, { agent: throwing });
  assert.match(value2.guidance, /verbatim: Still works\?/);
});

test('a call without a question is refused with a plain error', async () => {
  const tool = askUserTool({});
  await assert.rejects(() => run(tool, {}, {}), /non-empty "question"/);
  await assert.rejects(() => run(tool, { question: '   ' }, {}));
  await assert.rejects(() => run(tool, { question: 7 }, {}));
});

test('a bad maxQuestions falls back to the default budget instead of failing the load', async () => {
  const { ctx, registered } = hostWith();
  apply(ctx, { maxQuestions: 0 });
  apply(ctx, { maxQuestions: 'eight' });
  assert.equal(registered.length, 2, 'both loads still registered their tool');
  const tool = registered[1];
  const { agent } = fakeAgent();
  for (let i = 0; i < DEFAULT_MAX_QUESTIONS; i++) {
    const value = await run(tool, { question: `q${i}` }, { agent });
    assert.doesNotMatch(value.guidance, /Ask in your final reply instead/);
  }
  assert.match((await run(tool, { question: 'one too many' }, { agent })).guidance, /Ask in your final reply instead/);
});

test('each agent session has its own budget', async () => {
  const tool = askUserTool({ maxQuestions: 1 });
  const a = fakeAgent();
  const b = fakeAgent();
  assert.match((await run(tool, { question: 'a1' }, { agent: a.agent })).guidance, /a1/);
  assert.match((await run(tool, { question: 'a2' }, { agent: a.agent })).guidance, /Ask in your final reply instead/);
  assert.match((await run(tool, { question: 'b1' }, { agent: b.agent })).guidance, /b1/, 'a helper session starts with its own budget');
});
