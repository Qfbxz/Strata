/**
 * Finding skill folders under an outer directory, for the batch import.
 *
 * A skill is a folder holding a `SKILL.md` (`<name>/SKILL.md`). Collections a person
 * downloads often nest them deep: `<collection>/<category>/<skill>/SKILL.md`. The scan
 * walks the tree, treats a folder that holds a SKILL.md as one candidate and does not
 * descend into it (its other subfolders are that skill's own files, not more skills),
 * skips folders that never hold skills or are hidden, and stops at a bounded depth and
 * count so even a huge tree answers quickly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillFile } from './skill-files.mjs';

/** Folders that never hold skills (and are huge), so the scan neither reports nor walks them. */
export const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target', '__pycache__', '.venv', 'venv', '.next', '.cache', '.gradle', '.idea', '.vscode']);

/**
 * Depth-bounded scan of `root` for folders that hold a `SKILL.md`.
 * @param {string} root
 * @param {{maxDepth?: number, maxResults?: number, skip?: Set<string>, io?: {readdirSync: typeof readdirSync, readFileSync: typeof readFileSync}}} [opts]
 * @returns {{root: string, candidates: Array<{path: string, name: string, title: string|null, description: string|null, bodyChars: number}>, truncated: boolean, scannedDirs: number}}
 */
export function scanSkillFolders(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 6;
  const maxResults = opts.maxResults ?? 500;
  const skip = opts.skip ?? SCAN_SKIP_DIRS;
  const io = opts.io ?? { readdirSync, readFileSync };
  const candidates = [];
  let truncated = false;
  let scannedDirs = 0;
  const walk = (dir, depth) => {
    if (truncated || depth > maxDepth) return;
    scannedDirs++;
    let entries;
    try { entries = io.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some(e => e.isFile() && e.name === 'SKILL.md')) {
      let text = null;
      try { text = io.readFileSync(join(dir, 'SKILL.md'), 'utf8'); } catch { /* unreadable: still a candidate, without its words */ }
      const parsed = text === null ? { title: null, description: null } : parseSkillFile(text);
      candidates.push({
        path: dir,
        name: dir.split(/[\\/]/).filter(Boolean).pop() ?? dir,
        title: parsed.title ?? null,
        description: parsed.description ?? null,
        bodyChars: text === null ? 0 : text.length,
      });
      if (candidates.length >= maxResults) truncated = true;
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return { root, candidates, truncated, scannedDirs };
}

/** The folder name to copy to: the name itself, or `-2`, `-3`, … past what is already there. */
export function uniqueDest(base, exists) {
  if (!exists(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
}
