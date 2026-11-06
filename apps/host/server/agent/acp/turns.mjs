import { AcpAgent } from './transport.mjs';
import { runClaudeTurn } from './claude-stream.mjs';
import { runCodexTurn } from './codex-exec.mjs';
import { runDshTurn } from './dsh-headless.mjs';

/** One turn with an external agent CLI: the whole lifecycle, framed the way the chat already
 * renders. The agent is spawned per turn and torn down at its end - no long-lived child to
 * babysit. Claude Code speaks stream-json, Codex its exec JSONL, dsh its headless events
 * (their adapters); kimi, opencode and ZCode speak ACP. Errors fail loud in a frame the
 * chat shows. */

const TURN_TIMEOUT_MS = 30 * 60 * 1000; // an agent works for a long time; this is the wedge guard

export async function runAcpTurn({ backend, message, cwd, onFrame, signal }) {
    if (backend.adapter === 'claude-stream') return runClaudeTurn({ backend, message, cwd, onFrame, signal });
    if (backend.adapter === 'codex-exec') return runCodexTurn({ backend, message, cwd, onFrame, signal });
    if (backend.adapter === 'dsh-headless') return runDshTurn({ backend, message, cwd, onFrame, signal });
    const started = Date.now();
    const agent = new AcpAgent({ command: backend.command, args: backend.args ?? [], cwd, onFrame, signal });
    const wedge = setTimeout(() => { agent.cancel(); }, TURN_TIMEOUT_MS);
    try {
        await agent.start();
        await agent.newSession();
        const { stopReason } = await agent.prompt(message);
        return { stopReason, durationMs: Date.now() - started, tokensOut: null };
    } catch (err) {
        const error = err instanceof DOMException && err.name === 'AbortError' ? 'Cancelled. Partial output is preserved.'
            : String(err.message ?? err);
        onFrame({ type: 'error', message: error, code: 'acp-turn' });
        return { error, durationMs: Date.now() - started };
    } finally {
        clearTimeout(wedge);
        agent.close();
    }
}
