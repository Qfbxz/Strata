/**
 * Project instructions, the Claude-Code convention: a CLAUDE.md (or AGENTS.md, the cross-tool
 * convention) at the working folder — or above it — carries how the assistant should work in this
 * project. Both files are read when both exist (CLAUDE.md first), each bounded, the folder list
 * walking up a bounded number of parents so a project root's instructions reach subfolders too.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const NAMES = ['CLAUDE.md', 'AGENTS.md'];
const MAX_PARENTS = 6;
const DEFAULT_MAX_CHARS = 12_000;

/**
 * The project instructions for `cwd`, or null when no file names the convention anywhere above.
 * @param {string|null} cwd
 * @param {{maxChars?: number, io?: {readFileSync: typeof readFileSync, existsSync?: (p: string) => boolean}}} [opts]
 * @returns {{file: string, text: string}[] | null}
 */
export function projectInstructions(cwd, { maxChars = DEFAULT_MAX_CHARS, io = { readFileSync } } = {}) {
  if (!cwd) return null;
  let dir = resolve(String(cwd));
  const perFile = Math.max(1000, Math.floor(maxChars / NAMES.length));
  for (let up = 0; up <= MAX_PARENTS; up++) {
    const found = [];
    for (const name of NAMES) {
      const p = join(dir, name);
      let text = null;
      try { text = io.readFileSync(p, 'utf8'); } catch { continue; }
      if (!text.trim()) continue;
      found.push({ file: name, text: text.length > perFile ? text.slice(0, perFile) + '\n…' : text });
    }
    if (found.length) return found;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The system-prompt block for the project instructions, '' when there are none. */
export function projectInstructionsSection(instructions) {
  if (!instructions?.length) return '';
  const blocks = instructions.map(i => `Project instructions from ${i.file}:\n${i.text}`);
  return blocks.join('\n\n');
}
