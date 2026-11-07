/**
 * The feature switches behind the new file-loading surfaces, one persisted object the Settings
 * page edits and the host reads. Every switch defaults to on: the features themselves are opt-in
 * by what the person drops on disk, so an all-on default is still the unchanged default path.
 */
const DEFAULTS = Object.freeze({
  agents: true,              // <data>/agents + workspace agents personas and catalog
  hooks: true,               // <data>/hooks/<event>/ scripts run at the turn's edges
  memory: true,              // MEMORY.md index rides into direct chats
  projectInstructions: true, // CLAUDE.md / AGENTS.md from the working folder
  skillsNative: true,        // the native skill-pack folders list as read-only skills
  branchChip: true,          // the ⑂ branch chip beside the project chip
});

const KEYS = Object.keys(DEFAULTS);

/** The saved switches merged over the defaults: unknown keys dropped, non-boolean treated as unset. */
export function featuresView(saved) {
  const out = { ...DEFAULTS };
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const key of KEYS) if (typeof saved[key] === 'boolean') out[key] = saved[key];
  }
  return out;
}

/** Only the switches the Settings page may write; anything else is ignored, not invented. */
export function sanitizeFeatures(input) {
  const out = {};
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const key of KEYS) if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
}
