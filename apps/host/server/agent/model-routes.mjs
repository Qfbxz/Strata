/**
 * Which model did the person mean, when they name one in the model picker's by-name field?
 *
 * People say "ask DeepSeek", "use the local model", "deepseek/deepseek-v3.2" or a display name in
 * other letters; a route key such as `api-1b2c3d4e-5f` is something nobody can guess. This module
 * turns what was asked into one route, or into a plain answer that says what to do next. The
 * picker hands the route's choice to the chat send path, which applies it to the chat's Harness
 * session through `session.selectModel` (Harness 0.2.3); until the next message nothing is switched.
 *
 * Pure and dependency free: the profile writes the route table, the model picker and the tests call it.
 *
 * A route is `{ provider, model, name, connection, local }`:
 *   provider    the route key in the Harness profile (what the Harness needs)
 *   model       the model id the server knows
 *   name        the name the person sees in the model picker
 *   connection  the connection's name ("OpenRouter") or "this computer" for a local model
 *   local       true for a model running in the Strata engine
 */

/** The words people use for the model that runs in Strata on this computer. */
const LOCAL_WORDS = new Set(['local', 'localmodel', 'localstrata', 'thelocalmodel', 'mylocalmodel', 'strata', 'stratalocal', 'stratamodel', 'localstratamodel', 'strataslocalmodel', 'default', 'thismodel', 'samemodel', 'themodel', 'thislocalmodel']);

/** Letters and digits only, lower case: "DeepSeek: V3.2" and "deepseek v3.2" meet. */
export const squash = value => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const words = value => String(value ?? '').toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter(Boolean);

/** Edit distance, capped: enough to tell "deepseek-v3.2" from "deepseek-v3.1" and "depseek" from "deepseek". */
function distance(a, b, cap = 4) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = row[0];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Every spelling by which this route can be asked for, as squashed strings (an exact spelling, not a guess). */
function exactKeys(route) {
  const keys = new Set();
  const add = value => { const s = squash(value); if (s) keys.add(s); };
  add(route.model); add(route.name);
  add(`${route.provider}/${route.model}`);
  add(`${route.connection}/${route.model}`); add(`${route.connection} ${route.name}`); add(`${route.connection}: ${route.name}`); add(`${route.name} ${route.connection}`);
  add(`${route.name} (${route.connection})`);
  return keys;
}

/** The loose pieces a guess can match: the id, its last part after a slash, the name and the connection. */
function looseForms(route) {
  const forms = [route.model, String(route.model).split('/').pop(), route.name, `${route.connection} ${route.name}`];
  return forms.map(squash).filter(Boolean);
}

/** One line for a model in a list the assistant or the person reads. */
export function routeLine(route) {
  const where = route.local ? 'running on this computer' : route.connection;
  return `${route.name} (${where}): provider "${route.provider}", model "${route.model}"`;
}

/** The whole list as text, kept short enough for a small model's context. */
export function routeList(routes, { max = 30 } = {}) {
  const lines = routes.slice(0, max).map(r => `- ${routeLine(r)}`);
  if (routes.length > max) lines.push(`- ...and ${routes.length - max} more (ask for the name of one of them, or the part of its id you know)`);
  return lines.join('\n');
}

/**
 * Resolve one request.
 * @param {Array<{provider:string,model:string,name:string,connection:string,local:boolean}>} routes
 * @param {{provider?:string, model?:string}} request what the caller wrote (either or both)
 * @returns {{status:'inherit'}|{status:'exact',route:object,how:string}|{status:'confirm',route:object,others:object[]}|{status:'ambiguous',options:object[]}|{status:'none'}}
 *   inherit: nothing was asked (the helper uses the chat's model); exact: one model; confirm: one close guess to check with the person;
 *   ambiguous: several models fit; none: nothing fits.
 */
export function resolveModel(routes, request = {}) {
  const provider = typeof request.provider === 'string' ? request.provider.trim() : '';
  const model = typeof request.model === 'string' ? request.model.trim() : '';
  if (!provider && !model) return { status: 'inherit' };
  // 1. The exact route the Harness knows.
  if (provider && model) {
    const hit = routes.find(r => r.provider === provider && r.model === model);
    if (hit) return { status: 'exact', route: hit, how: 'route' };
  }
  const texts = [model, provider, provider && model ? `${provider}/${model}` : '', provider && model ? `${provider} ${model}` : ''].filter(Boolean);
  const squashed = [...new Set(texts.map(squash).filter(Boolean))];
  // 2. A spelling of one route: its id, "provider/id", its name or "connection name", in any letters.
  const exact = routes.filter(r => { const keys = exactKeys(r); return squashed.some(s => keys.has(s)); });
  // A name that fits several routes of one model id on different connections is not decided by the id alone: prefer the one the other half names.
  if (exact.length > 1 && provider && model) {
    const both = exact.filter(r => { const c = squash(r.connection); return squash(provider) === c || squash(provider) === squash(r.provider); });
    if (both.length === 1) return { status: 'exact', route: both[0], how: 'spelling' };
  }
  if (exact.length === 1) return { status: 'exact', route: exact[0], how: 'spelling' };
  if (exact.length > 1) return { status: 'ambiguous', options: exact };
  // 3. The local model by its everyday words.
  const locals = routes.filter(r => r.local);
  if (squashed.some(s => LOCAL_WORDS.has(s)) && locals.length) {
    return locals.length === 1 ? { status: 'exact', route: locals[0], how: 'local' } : { status: 'ambiguous', options: locals };
  }
  // 4. A close guess: part of an id or a name, a small typo.
  const scored = [];
  for (const route of routes) {
    const forms = looseForms(route);
    let best = Infinity;
    for (const s of squashed) {
      for (const form of forms) {
        if (s.length >= 3 && form === s) best = Math.min(best, 0);
        else if (s.length >= 4 && (form.includes(s) || s.includes(form) && form.length >= 4)) best = Math.min(best, 1);
        else if (s.length >= 5) best = Math.min(best, distance(s, form, 2) <= 2 ? 2 : Infinity);
      }
      // every word the caller wrote appears in the id or the name ("flash deepseek")
      const wanted = words(texts.join(' '));
      const haystack = squash(`${route.name} ${route.model} ${route.connection}`);
      if (wanted.length && wanted.every(w => w.length >= 2 && haystack.includes(squash(w)))) best = Math.min(best, 1.5);
    }
    if (best < Infinity) scored.push({ route, score: best });
  }
  scored.sort((a, b) => a.score - b.score || a.route.name.length - b.route.name.length);
  if (!scored.length) return { status: 'none' };
  const top = scored[0];
  const close = scored.filter(s => s.score === top.score);
  if (close.length === 1) return { status: 'confirm', route: top.route, others: scored.slice(1, 4).map(s => s.route) };
  return { status: 'ambiguous', options: scored.slice(0, 6).map(s => s.route) };
}

/** What the person or assistant typed, for a message ("deepseek", "openrouter/deepseek"). */
export const asked = request => [request.provider, request.model].filter(v => typeof v === 'string' && v.trim()).join(' / ');

/**
 * What is said when a model name could not be settled (`null` when it can go ahead). Plain words, with
 * what fits and the next step; never a route key as the only thing said. Read by the person through the
 * model picker's by-name field (and kept word-for-word testable here).
 */
export function modelProblem(routes, request) {
  const result = resolveModel(routes, request);
  const what = asked(request);
  if (result.status === 'inherit' || result.status === 'exact') return null;
  if (!routes.length) return 'No other model is set up. Nothing was switched. Add a model in Models, or keep the chat on this one.';
  if (result.status === 'confirm') {
    const r = result.route;
    return `No model is called "${what}". Nothing was switched. Did you mean ${r.name} (${r.local ? 'running on this computer' : r.connection})? Ask for it again by that name to use it.`;
  }
  if (result.status === 'ambiguous') {
    return `More than one model fits "${what}". Nothing was switched. These fit:\n${routeList(result.options, { max: 8 })}\nName one of them by its name or id.`;
  }
  return `No model is called "${what}". Nothing was switched. These are the models that can be used:\n${routeList(routes)}\nName one of them, or add the model you want in Models.`;
}

/**
 * The model-picker rows the app's profile carries, in the shape `resolveModel` reads, with the app's
 * own ids riding along: the picker resolves a name back to a choice the chat send route applies
 * through the Harness `session.selectModel` seam (the 0.2.3 replacement for the removed per-call
 * model argument of the subagent tool).
 * @param {Array<{route:string,kind:string,modelId:string,name:string,connectionName:string,connectionId?:string,instanceId?:string}>} profileRoutes
 * @returns {Array<{provider:string,model:string,name:string,connection:string,local:boolean,connectionId?:string,instanceId?:string}>}
 */
export const pickerRoutes = profileRoutes => profileRoutes.map(r => ({
  provider: r.route, model: r.modelId, name: r.name, connection: r.connectionName, local: r.kind === 'local',
  ...(r.connectionId ? { connectionId: r.connectionId } : {}),
  ...(r.instanceId ? { instanceId: r.instanceId } : {}),
}));

/**
 * Resolve what the person typed into the model picker's by-name field against the profile's routes.
 * The returned `route`/`options` are the enriched rows, so `choiceOf` turns an exact hit into the
 * structured choice the chat send route already takes; `message` carries the plain words of
 * `modelProblem` for the cases that settled nothing.
 * @param {Array} profileRoutes the profile's route rows (the rows `agent.status().routes` carries)
 * @param {string} name whatever the person typed ("deepseek v3", "DeepSeek: V3.2", "local")
 * @returns {{status:'inherit'|'exact'|'confirm'|'ambiguous'|'none', route?:object, others?:object[], options?:object[], asked:string, message?:string}}
 */
export function resolveChatModel(profileRoutes, name) {
  const routes = pickerRoutes(profileRoutes);
  const request = { model: String(name ?? '') };
  const result = resolveModel(routes, request);
  const what = asked(request);
  if (result.status === 'inherit') return { status: 'inherit', asked: what };
  if (result.status === 'exact' || result.status === 'confirm') {
    const r = result.route;
    const where = r.local ? 'running on this computer' : r.connection;
    return { ...result, asked: what, message: result.status === 'confirm' ? `Did you mean ${r.name} (${where})? Nothing was switched yet.` : `${r.name} (${where}).` };
  }
  return { ...result, asked: what, message: modelProblem(routes, request) };
}

/**
 * The chat send route's structured model choice for one resolved route row: an API model by
 * connection and model id, a local engine model by its instance id.
 * @param {{connectionId?:string,instanceId?:string,model?:string}} route an enriched route row (as `pickerRoutes` builds them)
 * @returns {{connectionId:string,modelId:string}|{instanceId:string}|null} null for a row that is neither
 */
export function choiceOf(route) {
  if (route?.connectionId && route.model) return { connectionId: route.connectionId, modelId: route.model };
  if (route?.instanceId) return { instanceId: route.instanceId };
  return null;
}
