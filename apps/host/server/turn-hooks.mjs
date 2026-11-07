/**
 * Hook scripts on disk, Claude-Code style: a person drops scripts under `<data>/hooks/<event>/`
 * (or a workspace's own `<workspace>/hooks/<event>/`) and the host runs them at that point of a
 * turn. The payload goes to the script's stdin as one JSON line; a nonzero exit of a `pre-turn`
 * script vetoes the turn and its stderr becomes the reason the person sees. Any event folder is
 * kept, so new lifecycle points can appear without this file learning them.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git', '.svn', 'dist', 'build', '__pycache__', '.venv']);
const KNOWN_EVENTS = ['session-start', 'pre-turn', 'post-turn'];

/**
 * The hook scripts per event under the given folders, first folder wins per (event, name).
 * @param {string[]} dirs
 * @returns {{events: Record<string, Array<{name: string, path: string}>>, known: string[]}}
 */
export function scanHookDirs(dirs, { io = { readdirSync } } = {}) {
  const events = {};
  const seen = new Set();
  for (const dir of dirs || []) {
    if (!dir) continue;
    let entries;
    try { entries = io.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const event = entry.name;
      let scripts;
      try { scripts = io.readdirSync(join(dir, event), { withFileTypes: true }); } catch { continue; }
      for (const s of scripts) {
        if (!s.isFile() || s.name.startsWith('.')) continue;
        const key = `${event}/${s.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        (events[event] ??= []).push({ name: s.name, path: join(dir, event, s.name) });
      }
    }
  }
  for (const list of Object.values(events)) list.sort((a, b) => a.name.localeCompare(b.name));
  return { events, known: KNOWN_EVENTS };
}

/**
 * Run one hook script with the payload on stdin. Resolves with {code, stdout, stderr}; a script
 * the host cannot start counts as a failed hook (code 127) whose stderr says so, never as a veto
 * by someone's intent.
 */
export function runHookScript(path, payload, { timeoutMs = 30_000, spawnFn = spawn, maxOutput = 200_000 } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnFn(path, [], { timeout: timeoutMs, windowsHide: true });
    } catch (e) {
      resolve({ code: 127, stdout: '', stderr: `could not start ${path}: ${e.message}` });
      return;
    }
    let stdout = '', stderr = '', done = false;
    const finish = code => {
      if (done) return;
      done = true;
      resolve({ code, stdout: stdout.slice(0, maxOutput), stderr: stderr.slice(0, maxOutput) });
    };
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });
    child.on('error', e => { stderr += `could not start ${path}: ${e.message}`; finish(127); });
    child.on('close', code => finish(code ?? -1));
    child.stdin?.on('error', () => { /* a script that closes stdin early is fine */ });
    child.stdin?.end(JSON.stringify(payload) + '\n');
    setTimeout(() => { if (!done) { child.kill('SIGKILL'); stderr += `\nhook timed out after ${timeoutMs} ms`; finish(-2); } }, timeoutMs).unref?.();
  });
}

/**
 * Run every script of one event in name order. `vetoOn` marks the events whose nonzero exit stops
 * the turn. Returns {vetoed, reason, results}.
 */
export async function runEventHooks(hooks, event, payload, { vetoOn = ['pre-turn'], timeoutMs = 30_000, runner = runHookScript } = {}) {
  const scripts = hooks?.events?.[event] ?? [];
  const results = [];
  let vetoed = false, reason = null;
  for (const script of scripts) {
    const r = await runner(script.path, payload, { timeoutMs });
    results.push({ name: script.name, code: r.code, stdout: r.stdout, stderr: r.stderr });
    if (!vetoed && vetoOn.includes(event) && r.code !== 0) {
      vetoed = true;
      reason = r.stderr.trim() || r.stdout.trim() || `${script.name} exited ${r.code}`;
      break;
    }
  }
  return { vetoed, reason, results };
}
