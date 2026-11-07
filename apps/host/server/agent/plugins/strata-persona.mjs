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

/** The instructions for one agents id (`<id>.md` file or `<id>/AGENT.md` folder), or null. */
export function personaInstructions(agentsDir, id, io = { existsSync, readFileSync, readdirSync }) {
  if (!agentsDir || !id || /[/\\]/.test(String(id))) return null;
  const slug = String(id);
  const candidates = [join(agentsDir, `${slug}.md`), join(agentsDir, slug, 'AGENT.md')];
  for (const p of candidates) {
    try { if (io.existsSync(p)) return readFileSync(p, 'utf8').slice(0, 64_000); } catch { /* unreadable: try the next shape */ }
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
    let instructions = null;
    for (const dir of agentsDirs) {
      instructions = personaInstructions(dir, args.persona.trim());
      if (instructions !== null) break;
    }
    if (instructions === null) return next(exec);
    // Rewrite in place (the runner reads this object after the hook chain) and continue with it.
    args.persona = `You are working as the agent "${args.persona.trim()}". Follow these instructions for this task.\n\n${instructions}`;
    return next(exec);
  });
}
