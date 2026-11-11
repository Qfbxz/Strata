/**
 * The Strata spill: a small Harness plugin that keeps oversized tool results out of the
 * model's context (plain ESM, loaded by absolute path from the profile).
 *
 * Why it exists. A tool that dumps a huge blob (a long shell dump, a wide grep) fills the
 * context window and the model pays for it on every later turn. This plugin keeps the whole
 * text on disk and shows the model a bounded head, a marker with the file path, and a bounded
 * tail — so the shape of the result survives and the middle can be read back on demand with
 * the assistant's own shell tools. The semantics follow the harness's own spill policy
 * (dsh-spill-policy): a size threshold, head/tail retention with the middle omitted, the full
 * text persisted, and failures degrade instead of losing the result.
 *
 * How it works. It listens on `tools/post-execute`, the seam where the finished result actually
 * exists: `tools/pre-execute` decisions carry no result text (they are allow/deny/cancel/ask),
 * so the result can only be rewritten after the tool ran. For a successful result whose text is
 * over `thresholdChars` the plugin writes the full text to `<spillDir>/<callId>.txt` (mode 0600)
 * and replaces the largest text of the result with the truncated version — in the decision's own
 * content when it carries one, otherwise in a copy of the raw result's content (an accept
 * without replacement content materializes the model-facing text from the raw result). A write
 * that fails never breaks the call: the result degrades to a plain truncation with no file
 * claim. The file tools (`read`, `read_image`) are never spilled, so the assistant can read a
 * spilled file back without it being spilled again (the same loop guard the reference policy
 * applies).
 *
 * There is no new tool surface: the marker text tells the assistant to read the file back with
 * `read` (offset/limit) or `grep`.
 *
 * 0.2.3 ships its own spill (dsh-spill-policy + dsh-spill-local, preview head only, inline cap
 * 50000 bytes). The two compose: this plugin spills first at its tighter threshold, so results
 * reach the Harness's retention already bounded and the Harness spill stays dormant below its cap;
 * the marker's retrieval hint matches the Harness's wording either way. HARNESS_ROADMAP P5 keeps
 * this plugin (its tail retention and measured token count are a superset of the upstream
 * preview) — the only host-side change is the marker copy.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'strata-spill';
/** No host services needed: the spill only touches the filesystem itself. */
export const inject = [];

/** Defaults for the config the profile passes in; each may be overridden per key. */
const DEFAULT_THRESHOLD_CHARS = 8_192;
const DEFAULT_HEAD_CHARS = 2_048;
const DEFAULT_TAIL_CHARS = 1_024;

/** Tools the assistant uses to read a spilled file back; spilling them would loop. */
const READ_BACK_TOOLS = new Set(['read', 'read_image']);

const positiveInt = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback);

/**
 * Cut a bounded head or tail without splitting a surrogate pair (an emoji cut in half would
 * corrupt both the preview and the tail).
 */
function boundedSlice(text, length, tail) {
  if (length <= 0) return tail ? text : '';
  let cut = tail ? text.length - length : length;
  if (cut <= 0) return tail ? text : '';
  if (!tail && cut >= text.length) return text;
  const before = text.charCodeAt(cut - 1);
  const at = text.charCodeAt(cut);
  if (before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff) cut += tail ? 1 : -1;
  return tail ? text.slice(cut) : text.slice(0, cut);
}

/**
 * The retained head and tail of one oversized text, plus how many characters the middle omits.
 * @returns {{headText:string, tailText:string, omitted:number}}
 */
function retention(text, config) {
  const head = positiveInt(config.headChars, DEFAULT_HEAD_CHARS);
  const tail = positiveInt(config.tailChars, DEFAULT_TAIL_CHARS);
  return { headText: boundedSlice(text, head, false), tailText: boundedSlice(text, tail, true), omitted: Math.max(0, text.length - head - tail) };
}

/**
 * Deep-collect every string in a value (objects, arrays, nested; cycles are cut with a WeakSet)
 * joined with newlines. The harness's discriminator fields (`kind`, `type`) are structural
 * labels, not result text, so they are skipped. Non-string leaves (numbers, nulls, functions,
 * Map/Set entries) are skipped too. This is the trigger measure for a spill: the whole result
 * text as the model sees it.
 * @param {unknown} value
 * @returns {string}
 */
export function collectText(value) {
  const seen = new WeakSet();
  const parts = [];
  const visit = (node) => {
    if (typeof node === 'string') { if (node) parts.push(node); return; }
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    for (const key of Object.keys(node)) {
      if (key === 'kind' || key === 'type') continue;
      visit(node[key]);
    }
  };
  visit(value);
  return parts.join('\n');
}

/** A call id is a file name; keep it to characters that are safe everywhere. */
const safeCallId = (callId) => String(callId ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * The model-facing marker for one spill: retained head + the note (how much was omitted, whether a
 * token count was measured, the file path) + retained tail. `tokens` rides along when the engine's
 * own counter could be asked; without it the marker stays honest and reports characters only.
 * @param {{chars:number, tokens?:number|null, path:string}} input
 * @returns {string}
 */
export function spillMarker({ chars, tokens, path }) {
  // The retrieval hint names the tools the way the Harness's own spill (dsh-spill-local, 0.2.3) names
  // them, so the model reads one spelling whichever mechanism spilled the text.
  const note = tokens != null && tokens > 0
    ? `spilled ${chars} chars (~${tokens} tokens), full: ${path}; read it back with read (offset/limit) or grep the path`
    : `spilled ${chars} chars, full: ${path}; read it back with read (offset/limit) or grep the path`;
  return `…[${note}]`;
}

/**
 * The spill plan for one result text: below the threshold nothing changes; over it the plan
 * names the spill file and the replacement text (retained head + marker + retained tail). The
 * marker carries the path and tells the assistant it can read the file back with its shell
 * tools. Writing the file is the caller's side effect, so this stays a pure function.
 * @param {string} text the full collected result text
 * @param {{spillDir?:string, thresholdChars?:number, headChars?:number, tailChars?:number, callId?:string}} config
 * @returns {{spill:boolean, replacement:string, path:string|null}}
 */
export function spillDecision(text, config = {}) {
  const threshold = positiveInt(config.thresholdChars, DEFAULT_THRESHOLD_CHARS);
  const dir = typeof config.spillDir === 'string' && config.spillDir ? config.spillDir : null;
  if (typeof text !== 'string' || text.length <= threshold || !dir) {
    return { spill: false, replacement: text, path: null };
  }
  const { headText, tailText, omitted } = retention(text, config);
  const path = join(dir, `${safeCallId(config.callId)}.txt`);
  const tokens = positiveInt(config.tokens, 0) || null;
  const replacement = `${headText}${spillMarker({ chars: omitted, tokens, path })}${tailText}`;
  return { spill: true, replacement, path, omitted };
}

/** The degrade path: the same truncation with no file claim, for a write that failed. */
function truncationOnly(text, config) {
  const { headText, tailText, omitted } = retention(text, config);
  return `${headText}…[spilled ${omitted} chars; saving the full output failed]${tailText}`;
}

/**
 * Replace the largest string field of a value with the given text, in place — the same object
 * flows up the waterfall and the harness materializes the result from it. A value that is
 * itself plain text comes back as the replacement text.
 */
function replaceLargestText(value, replacement) {
  if (typeof value === 'string') return replacement;
  if (!value || typeof value !== 'object') return value;
  const seen = new WeakSet();
  let target = null;
  const visit = (parent, key, node) => {
    if (typeof node === 'string') {
      if (!target || node.length > target.text.length) target = { parent, key, text: node };
      return;
    }
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) node.forEach((item, index) => visit(node, index, item));
    else for (const key of Object.keys(node)) visit(node, key, node[key]);
  };
  visit(null, null, value);
  if (target) target.parent[target.key] = replacement;
  return value;
}

/**
 * @param {object} ctx
 * @param {{spillDir: string, thresholdChars?: number, headChars?: number, tailChars?: number}} config
 *        `spillDir` is the folder spill files go to (an absolute path); without one the plugin
 *        registers nothing.
 */
export function apply(ctx, config = {}) {
  const spillDir = typeof config.spillDir === 'string' && config.spillDir ? config.spillDir : null;
  if (!spillDir) return;
  let dirReady = false;
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    const tool = String(exec?.name ?? '');
    if (READ_BACK_TOOLS.has(tool)) return decision;
    if (decision && typeof decision === 'object') {
      if (decision.kind && decision.kind !== 'accept') return decision;   // denials, blocks, cancellations flow through untouched
      if (Object.hasOwn(decision, 'value')) return decision;              // a canonical value exists; the text is only a projection of it
    }
    const threshold = positiveInt(config.thresholdChars, DEFAULT_THRESHOLD_CHARS);
    /** Write the full text and answer with the model-facing replacement (degrades on failure). */
    const spillText = (text, tokens = null) => {
      const plan = spillDecision(text, { ...config, spillDir, callId: exec?.callId, tokens });
      let replacement = plan.replacement;
      if (plan.spill) {
        try {
          if (!dirReady) { mkdirSync(spillDir, { recursive: true }); dirReady = true; }
          writeFileSync(plan.path, text, { mode: 0o600 });
          try { chmodSync(plan.path, 0o600); } catch { /* best effort: a fresh file was already written 0600 */ }
        } catch (e) {
          // Degrade to a plain truncation: never claim a file that is not there, never break the call.
          try { console.warn(`[strata-spill] could not save the full output of ${tool} (${e?.message ?? e}); keeping only the truncated result`); } catch { /* logging must never break a result */ }
          replacement = truncationOnly(text, config);
        }
      }
      return replacement;
    };
    const text = collectText(decision);
    const measure = async (full) => {
      // The engine's own count (the profile names the count URL and the key env var); anything that
      // goes wrong — an old engine, a busy server, a timeout — degrades to characters only.
      if (typeof config.countImpl === 'function') return await config.countImpl(full);
      if (typeof config.countUrl !== 'string' || !config.countUrl) return null;
      try {
        const key = config.keyEnv ? process.env[config.keyEnv] : '';
        const res = await fetch(config.countUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}`, 'x-api-key': key } : {}) },
          body: JSON.stringify({ model: config.model ?? '', messages: [{ role: 'user', content: full.slice(0, 200_000) }] }),
          signal: AbortSignal.timeout(2_000),
        });
        if (!res.ok) return null;
        const n = Number((await res.json())?.input_tokens);
        return Number.isFinite(n) && n > 0 ? n : null;
      } catch { return null; }
    };
    if (text.length > threshold) {
      // The decision carries the model-facing text itself: swap its largest text in place.
      const tokens = await measure(text).catch(() => null);
      return replaceLargestText(decision, spillText(text, tokens));
    }
    // An accept without replacement content materializes the model-facing text from the raw
    // result; spill that instead. The raw result is registry-owned, so the decision is rebuilt
    // around a copy rather than mutated.
    if (decision && typeof decision === 'object' && decision.kind === 'accept' && !('content' in decision)
      && result && Array.isArray(result.content)) {
      const raw = collectText(result.content);
      if (raw.length <= threshold) return decision;
      const tokens = await measure(raw).catch(() => null);
      const replacement = spillText(raw, tokens);
      try { return { ...decision, content: replaceLargestText(structuredClone(result.content), replacement) }; }
      catch { return decision; }   // an uncloneable result keeps its original text
    }
    return decision;
  }, { prepend: true });
}
