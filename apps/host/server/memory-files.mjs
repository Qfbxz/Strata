/**
 * The auto-memory plugin's memory files, read-only, for the app's memory panel. The plugin keeps
 * typed memory files plus a MEMORY.md index under its own root (its config names it, default
 * ~/.dsh/memory). Nothing here writes: the plugin owns its files, the app only shows them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

/** The memory root the auto-memory plugin uses, from its own saved config when it has one. */
export function memoryRoot(configFile = join(homedir(), '.dsh', 'dsh-auto-memory.json')) {
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8'));
    const root = String(parsed.memoryRoot ?? parsed.userMemoryDir ?? '').trim();
    if (root) return resolve(root.replace(/^~(?=\/|$)/, homedir()));
  } catch { /* no config: the plugin's default */ }
  return resolve(homedir(), '.dsh', 'memory');
}

const SKIP = new Set(['node_modules', '.git', 'archive']);

/**
 * Every markdown file under the root, shallow-bounded, newest first.
 * @returns {{root: string, files: Array<{path: string, bytes: number, mtime: number}>}}
 */
export function listMemoryFiles(root, { maxFiles = 200, maxDepth = 3, io = { readdirSync, statSync } } = {}) {
  const files = [];
  const walk = (dir, depth) => {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try { entries = io.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, depth + 1);
      else if (/\.md$/i.test(entry.name)) {
        try { const st = io.statSync(p); files.push({ path: p, bytes: st.size, mtime: st.mtimeMs }); } catch { /* vanished mid-listing */ }
      }
    }
  };
  walk(resolve(root), 0);
  files.sort((a, b) => b.mtime - a.mtime);
  return { root: resolve(root), files: files.slice(0, maxFiles) };
}

/** One memory file's content, by path relative to the root. Anything outside the root is refused. */
export function readMemoryFile(root, relative, { io = { readFileSync } } = {}) {
  const base = resolve(root);
  const target = resolve(base, String(relative ?? ''));
  if (target !== base && !target.startsWith(base + sep)) throw new Error('That path is outside the memory root.');
  if (!/\.md$/i.test(target)) throw new Error('Only markdown memory files can be shown.');
  // bounded: a memory file that huge is a bug in the writer, and the panel must not choke on it
  return { path: target, content: io.readFileSync(target, 'utf8').slice(0, 200_000) };
}
