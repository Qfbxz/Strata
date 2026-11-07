/**
 * The agents personas, resolved by name at spawn time. The catalog in the system prompt names
 * each agent and its instructions file; when the assistant delegates and passes `persona: "<id>"`
 * (the file's slug), this plugin swaps the name for the file's full instructions before the
 * helper starts — so a helper speaks with the persona without the parent having to carry its
 * whole text. A persona that is not a registered id passes through untouched, and everything
 * here is skipped when the agents folders hold nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'strata-persona';

/** One agent's spawn-time payload from its file: the instructions text and, when the
 * frontmatter declares `tools`, the allow-list that restricts the helper to them. Null when the
 * id resolves to nothing. */
export function personaInstructions(agentsDir, id, io = { existsSync, readFileSync, readdirSync }) {
  if (!agentsDir || !id || /[/\\]/.test(String(id))) return null;
  const slug = String(id);
  const candidates = [join(agentsDir, `${slug}.md`), join(agentsDir, slug, 'AGENT.md')];
  for (const p of candidates) {
    try {
      if (!io.existsSync(p)) continue;
      const text = readFileSync(p, 'utf8').slice(0, 64_000);
      const m = /^---\n([\s\S]*?)\n---/.exec(text);
      const tools = m
        ? (new RegExp(`^tools:[ \\t]*(.*)$`, 'mi').exec(m[1])?.[1]?.trim() ?? '')
            .split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean).filter(t => t)
        : null;
      return { instructions: (m ? text.slice(m[0].length) : text).trim() || text.trim(), tools: tools?.length ? tools : null };
    } catch { /* unreadable: try the next shape */ }
  }
  return null;
}

export function apply(ctx, config = {}) {
  const agentsDirs = Array.isArray(config.agentsDirs) ? config.agentsDirs : (config.agentsDir ? [config.agentsDir] : []);
  if (!agentsDirs.length) return;
  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = String(exec?.name ?? '');
    if (tool !== 'subagent' && tool !== 'subagent_fork') return next(exec);
    const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : null;
    if (!args || typeof args.persona !== 'string') return next(exec);
    let resolved = null;
    for (const dir of agentsDirs) {
      resolved = personaInstructions(dir, args.persona.trim());
      if (resolved !== null) break;
    }
    if (resolved === null) return next(exec);
    // Rewrite in place (the runner reads this object after the hook chain) and continue with it.
    args.persona = `You are working as the agent "${args.persona.trim()}". Follow these instructions for this task.\n\n${resolved.instructions}`;
    // A tools list in the frontmatter restricts the helper to exactly those tools (the Harness
    // validates {allow, deny} and applies it as the child's tool scope).
    if (resolved.tools?.length) args.toolFilter = { allow: resolved.tools };
    return next(exec);
  });
}
