/**
 * Memory the direct chats can use, at the right moments: the auto-memory plugin injects its
 * MEMORY.md index into every Harness agent session; the direct model chats (a saved API model,
 * or the local engine without the agent) have no plugin, so this helper hands them the same
 * index — the compact catalog of what was learned — plus a nudge to consult it when relevant.
 * The injected text is bounded by the plugin's own idea of a budget (its config's
 * injectBudgetChars), and nothing here reads the memory files themselves: the index points,
 * the agent path can follow.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { memoryRoot } from './memory-files.mjs';

const DEFAULT_BUDGET = 2400; // the auto-memory plugin's own injectBudgetChars default

/** The plugin's budget from its saved config when it names one. */
function budget(configFile) {
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8'));
    const n = Number(parsed.injectBudgetChars);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET;
  } catch { return DEFAULT_BUDGET; }
}

/**
 * The system-prompt block that lets a direct chat use the memory, or '' when there is none.
 * Reads only the MEMORY.md index at the memory root — one small file, cached by the caller.
 * @param {{configFile?: string, io?: {readFileSync: typeof readFileSync, existsSync: typeof existsSync}}} [opts]
 */
export function memoryContextSection(opts = {}) {
  const root = memoryRoot(opts.configFile);
  const index = join(root, 'MEMORY.md');
  const io = opts.io ?? { readFileSync, existsSync };
  if (!io.existsSync(index)) return '';
  let text = '';
  try { text = io.readFileSync(index, 'utf8'); } catch { return ''; }
  if (!text.trim()) return '';
  const limit = budget(opts.configFile);
  const trimmed = text.length > limit ? text.slice(0, limit) + '\n…' : text;
  return `Memory from past work on this machine (consult it when the task touches something recorded here; ask and it can be read in full):\n${trimmed}`;
}
