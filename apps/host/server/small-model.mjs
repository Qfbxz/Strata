/**
 * The small-model sidecar's settings (E3): a resident llama-server that serves session titles and
 * summaries on "model": "small", and turns pictures into text for a main model that has no vision
 * tower of its own.  Off by default - without it, titles and pictures go to the main model as
 * before.  The switch and the idle window live in the host's store; exe/model/mmproj point at the
 * sidecar binary (build-small/bin/llama-server) and the GGUF files, and the serve side reads the
 * whole block from its run config on the next start.
 */
const DEFAULTS = Object.freeze({ enabled: false, idleUnloadS: 300, exe: '', model: '', mmproj: '' });

function clean(saved) {
  const out = { ...DEFAULTS };
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    if (typeof saved.enabled === 'boolean') out.enabled = saved.enabled;
    if (Number.isFinite(saved.idleUnloadS) && saved.idleUnloadS >= 0) out.idleUnloadS = saved.idleUnloadS;
    for (const key of ['exe', 'model', 'mmproj']) {
      if (typeof saved[key] === 'string') out[key] = saved[key];
    }
  }
  return out;
}

/** The saved block merged over the defaults: unknown keys dropped, wrong types treated as unset. */
export function smallModelView(saved) {
  return clean(saved);
}

/** Only what the Settings page may write; anything else is ignored, not invented. */
export function sanitizeSmallModel(input) {
  return clean(input);
}

/** The run-config leaves this block maps to (serve reads them from the next start on). */
export function smallModelConfigLeaves(view) {
  const set = { 'small_model.enabled': view.enabled };
  if (view.idleUnloadS > 0) set['small_model.idle_unload_s'] = view.idleUnloadS;
  if (view.exe) set['small_model.exe'] = view.exe;
  if (view.model) set['small_model.model'] = view.model;
  if (view.mmproj) set['small_model.mmproj'] = view.mmproj;
  return set;
}
