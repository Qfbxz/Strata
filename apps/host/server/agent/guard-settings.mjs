/**
 * The turn-guard thresholds the person can turn (Settings → Assistant files hosts the switches; this file is the arithmetic and the
 * validation). Both backstops are on by default with the roadmap's defaults (HARNESS_ROADMAP.md 阶段一 H1/H2); a threshold of 0 turns that
 * backstop off, and then the host behaves exactly as it did before the backstop existed.
 *
 *   identicalCalls  the same tool with the same arguments, this many times in a row, ends the turn (0 = the loop runs on)
 *   compactFailures automatic summarizing fails this many times in a row before the host stops retrying it in that chat (0 = never stops)
 */
const DEFAULTS = Object.freeze({ identicalCalls: 12, compactFailures: 3 });

/** The saved thresholds merged over the defaults: unknown keys dropped, anything but a whole number ≥ 0 treated as unset. */
export function guardSettingsView(saved) {
  const out = { ...DEFAULTS };
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const key of Object.keys(DEFAULTS)) {
      const v = saved[key];
      if (Number.isInteger(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}

/** Only the thresholds the Settings page may write; anything else is ignored, not invented. */
export function sanitizeGuardSettings(input) {
  const out = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of Object.keys(DEFAULTS)) {
      const v = input[key];
      if (Number.isInteger(v) && v >= 0) out[key] = v;
    }
  }
  return out;
}
