/**
 * The structured ask-user tool, v1 (plain ESM, no imports, loaded by absolute path from the profile).
 *
 * Why it exists. When the assistant needs a decision (a choice, a confirmation, missing information) the ask should be
 * a tool call the person can see in the transcript, not a silent habit buried in prose. This plugin registers
 * `ask_user_question` so the model can structure "I need to ask" — and v1 keeps the UI out of it: the tool returns
 * guidance telling the model to ask the question in its next reply, verbatim, and then wait for the answer as the
 * person's next message. No new card is drawn.
 *
 * How it registers. Through the Harness's tool registry (`ctx.tools.register`, the same seam
 * `@deepseek-ai/dsh-tool-ask-user` uses). The definition is written in the registry's compiled shape by hand because
 * this file must stay import-free: it loads from beside the host plugins, outside the harness bundle's node_modules,
 * so `@deepseek-ai/dsh-tools` (which `defineTool` comes from) does not resolve from here. The registry validates the
 * returned value against the declared output schema and renders it with `output.render`.
 *
 * The native twin. The app's standard preset already carries the Harness's own ask-user plugin
 * (`@deepseek-ai/dsh-tool-ask-user`, the "Questions for you" group), which registers a tool of the SAME name on the
 * agent plane. A scoped/agent-plane registration shadows a global one, so while that group is on, the native
 * interactive tool wins and this one stays invisible (a duplicate name only fails within one layer, and they are in
 * different layers). With the group switched off the native plugin is not loaded and this global registration
 * becomes the visible `ask_user_question`.
 *
 * The limit. `config.maxQuestions` (default 8) counts the tool's real asks per agent session (a helper has its own
 * count). Past the limit the tool answers with guidance to ask in the final reply instead, so a looping model cannot
 * keep firing questions. Each ask is also recorded on the session (`user-questions` event) for the host to read;
 * recording and counting both degrade without crashing when the session seam is absent.
 *
 * v2. A real question card (the person answers in the UI) would hang off the Harness's user-questions capability
 * (`ctx.userQuestions`, which the native plugin and the app's answer-above-the-message-box card already use, #4244).
 */

export const name = 'strata-ask-user';
export const inject = ['tools'];

/** The tool name as the model sees it (the same name the Harness's own ask-user plugin registers). */
export const TOOL_NAME = 'ask_user_question';
/** Questions one agent session may ask before the tool starts refusing with guidance. */
export const DEFAULT_MAX_QUESTIONS = 8;

/** The model-facing guidance for one ask: the verbatim question, the options when given, and the wait. */
export function guidanceFor(question, options = null) {
  let text = `Ask the user this question in your next reply, verbatim: ${question}`;
  if (Array.isArray(options) && options.length) text += `\nOffer these options: ${options.join(', ')}`;
  return `${text}\nThen end your reply and wait; the person's answer arrives as their next message.`;
}

/** The model-facing guidance once the question budget is spent. */
export function limitGuidance(max = DEFAULT_MAX_QUESTIONS) {
  return `This chat has used its ${max} ask_user_question questions. Ask in your final reply instead.`;
}

/** One ask, counted, recorded, and answered with guidance. The count and the record are independent degradations. */
export function askUserTool({ maxQuestions = DEFAULT_MAX_QUESTIONS, counts = new WeakMap() } = {}) {
  return {
    name: TOOL_NAME,
    description: 'Ask the person one question you need answered before you can go on — a choice, a confirmation, or missing information. ' +
      'This tool does not ask for you: it returns guidance to put the question in your next reply, and the answer arrives as the person\'s next message. ' +
      'Use it only when the answer changes what you do next.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The exact question to put to the person, in their words.' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional answers to offer. Put a recommended option first and end its label with "(Recommended)".' },
      },
      required: ['question'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { guidance: { type: 'string', description: 'What to do with the question.' } },
        required: ['guidance'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.guidance ?? '') }],
    },
    async execute(args, exec) {
      const question = typeof args?.question === 'string' ? args.question.trim() : '';
      if (!question) throw new Error('ask_user_question needs a non-empty "question" string');
      const options = Array.isArray(args?.options)
        ? args.options.filter(o => typeof o === 'string' && o.trim()).map(o => o.trim())
        : [];
      const agent = exec?.agent;
      if (agent) {
        const asked = counts.get(agent) ?? 0;
        if (asked >= maxQuestions) return { guidance: limitGuidance(maxQuestions) };
        counts.set(agent, asked + 1);
      }
      const session = agent?.session;
      if (session && typeof session.append === 'function') {
        try { session.append('user-questions', { question, ...(options.length ? { options } : {}) }); }
        catch { /* recording must never fail the ask */ }
      }
      return { guidance: guidanceFor(question, options.length ? options : null) };
    },
  };
}

/**
 * @param {object} ctx the composition context; `ctx.tools` is the Harness tool registry (the `inject` above)
 * @param {{maxQuestions?: number}} [config] the question budget per agent session
 */
export function apply(ctx, config = {}) {
  const given = config.maxQuestions;
  const max = Number.isInteger(given) && given >= 1 ? given : DEFAULT_MAX_QUESTIONS;
  try {
    ctx.tools.register(askUserTool({ maxQuestions: max, counts: new WeakMap() }));
  } catch (e) {
    try { console.warn(`[strata-ask-user] the ${TOOL_NAME} tool could not be registered (${e?.message ?? e}); the model will ask in plain text`); }
    catch { /* logging must never break the load */ }
  }
}
