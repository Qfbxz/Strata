/**
 * The Strata loop guard: a small Harness plugin that notices a model calling the same tool with
 * the same arguments over and over (plain ESM, loaded by absolute path from the profile).
 *
 * Why it exists. A stuck model can burn a whole context window (and the person's patience) on
 * an identical call repeated many times. The harness's own repeat detector (dsh-repeat-tool-
 * reminder) counts consecutive identical calls per agent and reminds the model; this plugin
 * ports the detection idea to the host: a per-session sliding window of call fingerprints, and
 * a warning when one fingerprint shows up three or more times inside the window. Like the
 * reference, it never changes arguments and never short-circuits a call — counting happens in
 * `tools/pre-execute`, so denied attempts count too (a model hammering a denied call is exactly
 * the loop worth naming).
 *
 * What it does. The fingerprint is the SHA-256 of the tool name and its arguments, canonicalized
 * with a deep key sort so two argument objects that differ only in property order count as the
 * same call. History is kept per session (`exec.agent.session.id`, an `anon` bucket when there
 * is none), at most `window` entries per session and at most 256 sessions in memory. When a
 * fingerprint repeats, the plugin warns into the host log — the pre-execute seam's allow
 * decision carries no field a reminder could ride (that seam is allow/deny/cancel/ask only),
 * so the log line plus the exported pure `loopDecision` are the surface; a reminder text can be
 * configured (`remindText`) and rides the warning.
 */

import { createHash } from 'node:crypto';

export const name = 'strata-loop-guard';
/** No host services needed: the guard only looks at calls and keeps its own counters. */
export const inject = [];

/** How many recent calls the sliding window keeps per session. */
const DEFAULT_WINDOW = 12;
/** A fingerprint repeating this many times inside the window is a loop. */
const REPEAT_AT = 3;
/** Sessions tracked at once; the oldest buckets drop out when a chat is older than this. */
const MAX_SESSIONS = 256;
/** The session bucket for a call whose agent or session id is missing. */
export const ANON_SESSION = 'anon';

/** The default reminder sentence (English, like every message in the host plugins). */
export const DEFAULT_REMIND_TEXT = 'You are repeating the exact same tool call with identical arguments. The earlier results are already in this conversation; inspect them and either change the approach or the arguments, or finish the task.';

const positiveInt = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback);

/**
 * Deep key-sort of a parsed-arguments value, so two objects that differ only in property order
 * canonicalize identically. A cycle (unreachable from real model JSON, but defended against)
 * is cut to a placeholder; a shared sub-object visited twice is preserved.
 */
function sortJsonValue(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item, seen));
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return '[cycle]';
    seen.add(value);
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortJsonValue(value[key], seen);
    seen.delete(value);
    return sorted;
  }
  return value;
}

/**
 * The stable fingerprint of one call: SHA-256 over the tool name and its canonical arguments.
 * Arguments that cannot be serialized fall back to a fixed stand-in instead of throwing.
 * @param {{name?: string, arguments?: unknown}} exec
 * @returns {string} the hex digest
 */
export function fingerprintOf(exec) {
  const tool = String(exec?.name ?? '');
  let canonical;
  try { canonical = JSON.stringify(sortJsonValue(exec?.arguments)) ?? 'null'; }
  catch { canonical = '"[unserializable]"'; }
  return createHash('sha256').update(tool + canonical).digest('hex');
}

/**
 * The loop verdict for one call against its session's recent fingerprints. The history is the
 * windowed bucket WITH the current fingerprint already appended (the caller records first, so
 * the window boundary stays exact): `count` is how often the current fingerprint sits inside
 * that window, and the third occurrence is a repeat.
 * @param {string[]} fingerprintHistory recent fingerprints, oldest first, current included
 * @param {string} current the current call's fingerprint
 * @returns {{repeat:boolean, count:number}}
 */
export function loopDecision(fingerprintHistory, current) {
  const history = Array.isArray(fingerprintHistory) ? fingerprintHistory : [];
  const count = history.reduce((n, fingerprint) => (fingerprint === current ? n + 1 : n), 0);
  return { repeat: count >= REPEAT_AT, count };
}

/**
 * @param {object} ctx
 * @param {{window?: number, remindText?: string}} config `window` is the sliding-window size
 *        per session; `remindText` is the sentence the warning carries.
 */
export function apply(ctx, config = {}) {
  const window = positiveInt(config.window, DEFAULT_WINDOW);
  const remindText = typeof config.remindText === 'string' && config.remindText ? config.remindText : DEFAULT_REMIND_TEXT;
  /** Session id -> recent fingerprints, oldest first, at most `window` entries. */
  const buckets = new Map();
  ctx.on('tools/pre-execute', async (exec, next) => {
    const fingerprint = fingerprintOf(exec);
    const session = String(exec?.agent?.session?.id ?? '') || ANON_SESSION;
    let bucket = buckets.get(session);
    if (!bucket) { bucket = []; buckets.set(session, bucket); }
    // Record first, trim to the window, then judge inside the window — so the boundary call
    // that just slid out can never tip a count.
    bucket.push(fingerprint);
    while (bucket.length > window) bucket.shift();
    const decision = loopDecision(bucket, fingerprint);
    // Keep the table bounded: once too many chats are tracked, the oldest buckets drop out.
    while (buckets.size > MAX_SESSIONS) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
    if (decision.repeat) {
      // No reminder can ride an allow decision (that seam is allow/deny/cancel/ask only), so
      // the loop shows up where operators look: the host log.
      try { console.warn(`[strata-loop-guard] session ${session}: tool ${String(exec?.name ?? '')} repeated ${decision.count} times in the last ${window} calls — ${remindText}`); } catch { /* logging must never break a call */ }
    }
    return next(exec);
  });
}
